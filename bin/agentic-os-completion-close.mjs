#!/usr/bin/env node
/** Provider-authenticated closeout and native zero-candidate lane quarantine. */
import { realpathSync, mkdirSync, readdirSync } from 'node:fs'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url'; import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { repoRoot, currentBranch, headSha, isAncestor, observeGit, decodeNulFields, worktreeInventory, acquireOperationLock, finishOperationLock, commonDir, fetch as gitFetch } from '../src/git.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { validateWorktreeCleanupPlan, assessWorktreeCleanupEligibility, executeWorktreeCleanup } from '../src/cleanup.mjs';
import { createWorktreeCleanupPlan, deriveCleanupOwnerStateDigest, validateCleanupEvidenceReceipt } from '../src/cleanup-records.mjs';
import { encodeEffectPlan, effectPlanByteDigest, validateAuthenticatedTransitionOperationReceipt } from '../src/completion.mjs';
import { validateGitHubTransitionInput } from '../src/github-transition-client.mjs';
import { get, list } from '../src/lane-records.mjs'; import { isLaneRef } from '../src/lane-id.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';
import { classifyExistingWorktreeQuarantine, observeWorktreeCleanupTarget, quarantineWorktreeTarget } from '../src/cleanup-quarantine.mjs';
import { createGitHubTransitionAuthorityVerifier } from '../src/github-transition-authority.mjs';
import { deriveCompletionCleanupContinuation } from '../src/completion.mjs';
import { trustedRepositoryProfile } from './agentic-os-auxiliary.mjs'; import { inspectCompletionStatus } from './agentic-os-completion-status.mjs';
import { providerPolicy } from '../src/queue.mjs'; import { option, flag } from './agentic-os-argv.mjs';
import { privateDirectoryIdentity, assertPrivateDirectoryIdentity, readPrivateFile, writePrivateFileExclusive } from '../src/file-integrity.mjs';

const PLAN_SCHEMA = 'agentic-os/completion-close-plan/v1';
export const EMPTY_ACTIVE_LANE_RETIREMENT_PLAN = 'agentic-os/empty-active-lane-retirement-plan/v1';
export const EMPTY_ACTIVE_LANE_RETIREMENT_ELIGIBILITY = 'agentic-os/empty-active-lane-retirement-eligibility/v1';
export const EMPTY_ACTIVE_LANE_RETIREMENT_RECEIPT = 'agentic-os/empty-active-lane-retirement-receipt/v1';
const BUNDLE_KEYS = ['cleanup', 'integrationVerifier', 'retirementVerifier'];
const CLEANUP_KEYS = ['plan', 'integrationReceipt', 'integrationPlanBytes', 'retirementReceipt', 'retirementPlanBytes', 'integrationRequest', 'retirementRequest', 'preservationReceipt', 'noRemainingValueReceipt'];
const CONFIG_KEYS = ['repository', 'targetRepository', 'operationInput', 'workflowRun', 'policy'];
const SCAFFOLD_SCHEMA = 'agentic-os/completion-bundle-scaffold/v1', DERIVE_TTL_MS = 900000;
const EMPTY_LANE_LIMITS = Object.freeze({ projectionByteCeiling: 4 * 1024 ** 3, projectionEntryCeiling: 250_000, registrationByteCeiling: 16 * 1024 ** 2, registrationEntryCeiling: 20_000, sharedStateByteCeiling: 20 * 1024 ** 3, sharedStateEntryCeiling: 500_000 });
const same = (left, right) => canonicalJson(left) === canonicalJson(right), sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value), iso = value => new Date(value).toISOString();
function fail(reason, message) { throw Object.assign(new Error(message), { reason }); } function exact(value, keys, label, optional = []) { if (!value || typeof value !== 'object' || Array.isArray(value) || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))) fail('blocked-completion-input', `${label} must have exactly ${keys.join(', ')}${optional.length ? ` and optional ${optional.join(', ')}` : ''}`); }
function jsonFile(path, ceiling, label) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readBoundedStableFile(path, ceiling, label))); } catch (error) { fail('blocked-completion-input', `${label}: ${error.message}`); } } function serializableBundle(value) { try { return JSON.parse(JSON.stringify(value, (_key, entry) => Buffer.isBuffer(entry) || entry instanceof Uint8Array ? [...entry] : entry?.type === 'Buffer' && Array.isArray(entry.data) ? entry.data : entry)); } catch (error) { fail('blocked-completion-input', `completion bundle: ${error.message}`); } }
function planBytes(value, label) { const entries = Buffer.isBuffer(value) || value instanceof Uint8Array ? [...value] : value; if (!Array.isArray(entries) || entries.length === 0 || entries.length > 500_000 || entries.some(entry => !Number.isInteger(entry) || entry < 0 || entry > 255)) fail('blocked-completion-input', `${label} must be a bounded byte array`); return Buffer.from(entries); }
const isPlaceholder = value => typeof value === 'string' && value.startsWith('REPLACE_WITH_');
function setDerived(target, path, value) { const parts = path.split('.'); let node = target; for (const key of parts.slice(0, -1)) node = node[key]; const key = parts.at(-1), prior = node[key]; if (!isPlaceholder(prior) && !same(prior, value)) fail('blocked-completion-input', `${path} conflicts with authenticated evidence`); node[key] = value; }
export function deriveCompletionBundleFields(value, { now = Date.now } = {}) {
  const bundle = serializableBundle(value); exact(bundle, BUNDLE_KEYS, 'completion bundle'); exact(bundle.cleanup, CLEANUP_KEYS, 'cleanup evidence', ['cleanupContinuation']);
  const cleanup = bundle.cleanup, operations = {};
  for (const name of ['integration', 'retirement']) {
    const verifier = bundle[`${name}Verifier`], transition = name === 'integration' ? 'integrate' : 'retire'; let input;
    try { input = validateGitHubTransitionInput(verifier.operationInput); } catch (error) { fail('blocked-completion-input', `${name} operation input: ${error.message}`); }
    if (input.request.requestedTransition !== transition || input.plan.target.repository !== verifier.targetRepository) fail('blocked-completion-target-mismatch', `${name} operation does not target its declared repository`);
    const bytes = encodeEffectPlan(input.plan), byteDigest = effectPlanByteDigest(bytes);
    setDerived(cleanup, `${name}Request`, input.request); setDerived(cleanup, `${name}PlanBytes`, [...bytes]);
    operations[name] = { input, bytes, byteDigest };
  }
  const integration = operations.integration, retirement = operations.retirement, integratePlan = integration.input.plan;
  for (const [key, value] of Object.entries({
    integratedResource: integratePlan.target.resource, integratedImmutableRevision: integratePlan.target.immutableRevision,
    candidateDigest: integratePlan.candidateDigest, snapshotDigest: integratePlan.snapshotDigest,
    integrationProofDigest: integratePlan.parametersDigest, integrationPlanByteDigest: integration.byteDigest,
    integrationPredecessorDigest: integratePlan.authority.predecessorDigest,
  })) setDerived(cleanup.plan, key, value);
  const receipts = {};
  for (const name of ['integration', 'retirement']) {
    const receipt = validateAuthenticatedTransitionOperationReceipt(cleanup[`${name}Receipt`]), operation = operations[name];
    if (receipt.requestDigest !== operation.input.request.requestDigest || receipt.planDigest !== operation.input.plan.planDigest || receipt.planByteDigest !== operation.byteDigest) fail('blocked-completion-input', `${name} receipt does not match its operation input`);
    receipts[name] = receipt;
  }
  const integrated = receipts.integration.transitionReceipt;
  setDerived(cleanup.plan, 'integrationReceiptDigest', receipts.integration.receiptDigest);
  setDerived(cleanup.plan, 'ownerStateDigest', deriveCleanupOwnerStateDigest({ claimId: integrated.resultClaimId, leaseEpoch: integrated.resultLeaseEpoch, fenceRevision: integrated.resultFenceRevision, state: integrated.resultState }));
  for (const name of ['preservation', 'noRemainingValue']) setDerived(cleanup.plan, `${name === 'preservation' ? 'preservation' : 'noRemainingValue'}ReceiptDigest`, validateCleanupEvidenceReceipt(cleanup[`${name}Receipt`]).receiptDigest);
  cleanup.plan = createWorktreeCleanupPlan(cleanup.plan);
  cleanup.integrationPlanBytes = integration.bytes; cleanup.retirementPlanBytes = retirement.bytes;
  cleanup.cleanupContinuation = deriveCompletionCleanupContinuation(cleanup, now);
  return bundle;
}
function validateCompletionScaffold(value, status, profile, now) {
  const plan = value?.bundleTemplate?.cleanup?.plan, derivedAt = Date.parse(value?.derivedAt ?? ''), expiresAt = Date.parse(plan?.expiresAt ?? '');
  if (value?.schema !== SCAFFOLD_SCHEMA || value.ref !== status.ref || value.repository !== status.repository
    || value.profileDigest !== profile.profileDigest || value.canonicalRevision !== status.canonicalRevision
    || value.canonicalRef !== profile.canonical.localRef || !same(value.lane, status.lane) || !same(value.integration, status.integration))
    fail('blocked-completion-target-mismatch', 'scaffold no longer matches the exact lane, integration, profile, and canonical source');
  if (!status.lane.mounted || !status.lane.path || !Number.isFinite(derivedAt) || !Number.isFinite(expiresAt)
    || new Date(expiresAt).toISOString() !== plan.expiresAt || expiresAt !== derivedAt + DERIVE_TTL_MS || now < derivedAt || now >= expiresAt)
    fail('blocked-completion-input', 'scaffold is unmounted, expired, or missing its exact derived inventory window');
  const inventory = collectRecoveryInventory({ cwd: status.lane.path, canonicalRef: profile.canonical.localRef, maxContentEntries: plan.projectionEntryCeiling });
  if (inventory.branch !== status.ref || inventory.headRevision !== status.lane.head || inventory.canonicalRevision !== status.canonicalRevision
    || governanceDigest(inventory) !== plan.recoveryInventoryDigest || inventory.inventoryEntries.content !== plan.recoveryInventoryContentEntries)
    fail('blocked-recovery-inventory-drift', 'scaffold inventory no longer matches the exact lane');
  return value.bundleTemplate;
}
export function materializeCompletionCloseBundle(value, { now = Date.now, status = null, profile = null } = {}) {
  const source = value?.schema === SCAFFOLD_SCHEMA ? validateCompletionScaffold(value, status, profile, now()) : value;
  const result = deriveCompletionBundleFields(source, { now });
  result.cleanup.integrationPlanBytes = planBytes(result.cleanup.integrationPlanBytes, 'integrationPlanBytes');
  result.cleanup.retirementPlanBytes = planBytes(result.cleanup.retirementPlanBytes, 'retirementPlanBytes'); return result;
}
export function completionCloseBundleDigest(value) { return governanceDigest(serializableBundle(value)); }
export function validateCompletionCloseArguments(argv) {
  const [mode, ...args] = argv, confirmApply = mode === 'apply' && args.some(arg => arg?.startsWith?.('--confirm=')), names = mode === 'plan' ? ['ref', 'bundle'] : mode === 'apply' ? confirmApply ? ['ref', 'bundle', 'confirm', 'stopped'] : ['ref', 'bundle', 'plan', 'authorize', 'stopped'] : null;
  if (!names || args.length !== names.length) fail('blocked-completion-arguments', 'usage: completion-close plan --ref=<lane> --bundle=<json> | apply --ref=<lane> --bundle=<json> (--confirm=<digest> | --plan=<json> --authorize=<digest>) --stopped');
  const found = new Map(); for (const arg of args) { const match = arg.match(/^--([a-z]+)(?:=(.+))?$/u); if (!match || !names.includes(match[1]) || found.has(match[1]) || (match[1] === 'stopped' ? match[2] !== undefined : match[2] === undefined)) fail('blocked-completion-arguments', `invalid or duplicate argument ${arg}`); found.set(match[1], match[2] ?? true); }
  if (names.some(name => !found.has(name))) fail('blocked-completion-arguments', 'required argument missing'); return { mode, ref: found.get('ref'), bundle: found.get('bundle'), plan: found.get('plan'), authorize: found.get('authorize'), confirm: found.get('confirm'), stopped: found.get('stopped') === true };
}
export function validateCompletionCloseBundle(value, status) {
  exact(value, BUNDLE_KEYS, 'completion bundle'); exact(value.cleanup, CLEANUP_KEYS, 'cleanup evidence', ['cleanupContinuation']); exact(value.integrationVerifier, CONFIG_KEYS, 'integration verifier'); exact(value.retirementVerifier, CONFIG_KEYS, 'retirement verifier'); const plan = validateWorktreeCleanupPlan(value.cleanup.plan);
  if (plan.repository !== status.repository || plan.targetPath !== status.lane.path || plan.expectedBranch !== status.ref || plan.expectedHeadRevision !== status.lane.head || plan.expectedCanonicalRevision !== status.canonicalRevision || value.integrationVerifier.targetRepository !== status.repository || value.retirementVerifier.targetRepository !== status.repository || value.integrationVerifier.operationInput?.request?.requestedTransition !== 'integrate' || value.retirementVerifier.operationInput?.request?.requestedTransition !== 'retire') fail('blocked-completion-target-mismatch', 'bundle is not bound to the exact clean registered lane'); return value;
}
function context(root, ref) {
  const canonical = realpathSync(repoRoot(root)); if (realpathSync(root) !== canonical) fail('blocked-canonical-required', 'run from the canonical checkout'); const profile = trustedRepositoryProfile(canonical).profile;
  if (!profile) fail('blocked-repository-profile-missing', 'committed trusted profile required'); const status = inspectCompletionStatus(canonical, ref, providerPolicy(profile), profile); const blocker = status.findings.find(item => ['canonical-not-current-clean', 'lane-ref-missing', 'lane-registration-detached', 'lane-dirty', 'integration-not-classified'].includes(item.code)); if (blocker) fail(`blocked-${blocker.code}`, blocker.action); return { canonical, status, profile };
}
function verifier(config, token) { if (!token) fail('blocked-provider-credentials', 'GITHUB_TOKEN is required for live winner verification'); return createGitHubTransitionAuthorityVerifier({ ...config, token }); }
function options(root, bundle, token, now = Date.now) { return { cwd: root, now, verifyIntegrationAuthority: verifier(bundle.integrationVerifier, token), verifyRetirementAuthority: verifier(bundle.retirementVerifier, token) }; }
export async function planCompletionClose(root, ref, bundle, { token = process.env.GITHUB_TOKEN, now = Date.now } = {}) {
  const { canonical, status, profile } = context(root, ref), bundleDigest = completionCloseBundleDigest(bundle), runtime = materializeCompletionCloseBundle(bundle, { now, status, profile }); validateCompletionCloseBundle(runtime, status); const eligibility = await assessWorktreeCleanupEligibility(runtime.cleanup, options(canonical, runtime, token, now)); return { schema: PLAN_SCHEMA, ref, repository: status.repository, targetPath: status.lane.path, canonicalRevision: status.canonicalRevision, laneHead: status.lane.head, bundleDigest, eligibility, authorizationDigest: eligibility.eligibilityDigest, effectsAuthorized: false };
}
export async function applyCompletionClose(root, ref, bundle, planned, authorization, { token = process.env.GITHUB_TOKEN, stopped = false, now = Date.now } = {}) {
  if (!stopped) fail('blocked-completion-stop-acknowledgement', 'stop writers before applying cleanup'); const { canonical, status, profile } = context(root, ref), bundleDigest = completionCloseBundleDigest(bundle), runtime = materializeCompletionCloseBundle(bundle, { now, status, profile }); validateCompletionCloseBundle(runtime, status); exact(planned, ['schema', 'ref', 'repository', 'targetPath', 'canonicalRevision', 'laneHead', 'bundleDigest', 'eligibility', 'authorizationDigest', 'effectsAuthorized'], 'completion plan');
  if (planned.schema !== PLAN_SCHEMA || planned.ref !== ref || planned.repository !== status.repository || planned.targetPath !== status.lane.path || planned.canonicalRevision !== status.canonicalRevision || planned.laneHead !== status.lane.head || planned.bundleDigest !== bundleDigest || planned.authorizationDigest !== planned.eligibility?.eligibilityDigest || authorization !== planned.authorizationDigest || planned.effectsAuthorized !== false) fail('blocked-completion-plan-drift', 'exact plan, bundle and authorization must agree'); return executeWorktreeCleanup({ ...runtime.cleanup, eligibility: planned.eligibility, authorizationDigest: authorization }, options(canonical, runtime, token, now));
}

function emptyLaneBinding(root, ref, profile) {
  const branch = profile?.canonical?.localRef?.match(/^refs\/heads\/(.+)$/u)?.[1]; if (!isLaneRef(ref)) fail('blocked-empty-active-lane-retirement-ref', 'retirement requires one exact --ref=<lane>'); if (!branch) fail('blocked-empty-active-lane-retirement-profile', 'profile must bind refs/heads/<branch> as canonical source'); if (currentBranch(root) !== branch) fail('blocked-empty-active-lane-retirement-canonical', `retirement runs from canonical ${branch}`);
  const canonical = headSha(profile.canonical.localRef, root), tracking = headSha(profile.canonical.remoteRef, root), record = get(ref, root); if (!sha(canonical) || canonical !== tracking || observeGit(['status', '--porcelain', '--untracked-files=all'], { cwd: root }) !== '') fail('blocked-empty-active-lane-retirement-canonical', 'canonical source must be current and clean');
  if (!record || record.state !== 'active' || record.pr !== null || (Object.hasOwn(record, 'head') && record.head !== record.baseSha) || record.base !== profile.canonical.remoteRef || !sha(record.baseSha) || typeof record.worktree !== 'string' || record.recovery?.dirtyState === 'unobservable-at-missing-path') fail('blocked-empty-active-lane-retirement-state', 'retirement requires an active lane cache record with no candidate head, PR, or unresolved bytes');
  const lane = worktreeInventory(root).find(row => row.branch === ref) ?? null, laneHead = headSha(`refs/heads/${ref}`, root); let recordedPath = null; try { recordedPath = realpathSync(record.worktree); } catch { /* Missing cache target remains ineligible. */ }
  if (!lane || lane.path !== recordedPath || lane.locked || lane.prunable || lane.detached || lane.head !== laneHead || laneHead !== record.baseSha) fail('blocked-empty-active-lane-retirement-target', 'lane must remain one mounted, unlocked, non-prunable clean reservation at its admitted base');
  if (observeGit(['status', '--porcelain', '--untracked-files=all'], { cwd: lane.path }) !== '') fail('blocked-empty-active-lane-retirement-dirty', 'empty active retirement refuses dirty or untracked lane bytes'); if (!isAncestor(record.baseSha, canonical, root)) fail('blocked-empty-active-lane-retirement-base', 'admitted base is not retained by the current canonical source'); return Object.freeze({ ref, canonical, baseSha: record.baseSha, head: laneHead, targetPath: lane.path, repository: profile.repository, profileDigest: profile.profileDigest, reservationReleaseDigest: emptyLaneReservationReleaseDigest(record, root) });
}
function emptyLaneReservationReleaseDigest(record, root) { const handoff = record.handoff; if (handoff == null) return null; const releases = handoff?.reservationPathReleases, blocked = () => fail('blocked-empty-active-lane-retirement-handoff', 'handoff must contain only exact unchanged releases from the admitted base');
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff) || !same(Object.keys(handoff).sort(), ['reservationPathReleases']) || !Array.isArray(releases) || releases.length < 1 || releases.length > 128) blocked(); const seen = new Set(), remaining = [...(record.writePaths ?? []), ...list(root).filter(item => item.ref !== record.ref && ['active', 'published'].includes(item.state)).flatMap(item => item.writePaths ?? [])]; if (!releases.every(evidence => {
    const { digest, ...body } = evidence ?? {}, { path, lanePathEntry: entry, protectedPathEntry } = body, keys = ['schema', 'path', 'laneHead', 'protectedHead', 'lanePathEntry', 'protectedPathEntry', 'bytesDiffer', 'digest'];
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || !same(Object.keys(evidence).sort(), keys.sort()) || body.schema !== 'agentic-os/reservation-path-release/v1' || typeof path !== 'string' || path.length > 4096 || path.trim() !== path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || seen.has(path) || body.laneHead !== record.baseSha || body.protectedHead !== record.baseSha || body.bytesDiffer !== false || !same(entry, protectedPathEntry) || !/^[0-9a-f]{64}$/u.test(digest ?? '') || governanceDigest(body) !== digest || !entry || typeof entry !== 'object' || Array.isArray(entry) || !same(Object.keys(entry).sort(), ['mode', 'oid', 'type']) || !['100644', '100755'].includes(entry.mode) || entry.type !== 'blob' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(entry.oid ?? '') || remaining.some(item => item === path || item.startsWith(`${path}/`) || path.startsWith(`${item}/`))) return false;
    const rows = decodeNulFields(observeGit(['--literal-pathspecs', 'ls-tree', '-z', record.baseSha, '--', path], { cwd: root, binary: true })), row = rows?.length === 1 ? rows[0] : '', tab = row.indexOf('\t'), [mode, type, oid] = row.slice(0, tab).split(' '); if (tab < 0 || row.slice(tab + 1) !== path || !same({ mode, type, oid }, entry)) return false; seen.add(path); return true;
  })) blocked(); return governanceDigest(releases);
}
function emptyLaneMechanics(plan) { return { ...EMPTY_LANE_LIMITS, mode: 'empty-active-lane-retirement', repository: plan.repository, targetPath: plan.targetPath, expectedBranch: plan.ref, expectedHeadRevision: plan.head, detachedRecovery: false, expectedCanonicalRef: plan.canonicalRef, expectedCanonicalRevision: plan.canonicalRevision, profileDigest: plan.profileDigest, recoveryInventoryDigest: plan.recoveryInventoryDigest, recoveryInventoryContentEntries: plan.recoveryInventoryContentEntries, planDigest: plan.planDigest }; }
export function planEmptyActiveLaneRetirement({ root, ref, profile, issuedAt = Date.now() } = {}) {
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) fail('blocked-empty-active-lane-retirement-clock', 'retirement clock is invalid'); const bound = emptyLaneBinding(root, ref, profile), inventory = collectRecoveryInventory({ cwd: bound.targetPath, canonicalRef: profile.canonical.localRef, maxContentEntries: EMPTY_LANE_LIMITS.projectionEntryCeiling });
  if (inventory.branch !== bound.ref || inventory.headRevision !== bound.head || inventory.canonicalRevision !== bound.canonical || inventory.inventoryEntries.hidden || inventory.inventoryEntries.visibleUntracked) fail('blocked-empty-active-lane-retirement-inventory', 'lane recovery inventory must be clean and exactly bound'); const base = { schema: EMPTY_ACTIVE_LANE_RETIREMENT_PLAN, repository: bound.repository, ref: bound.ref, targetPath: bound.targetPath, head: bound.head, baseSha: bound.baseSha, canonicalRef: profile.canonical.localRef, canonicalRevision: bound.canonical, profileDigest: bound.profileDigest, reservationReleaseDigest: bound.reservationReleaseDigest, recoveryInventoryDigest: governanceDigest(inventory), recoveryInventoryContentEntries: inventory.inventoryEntries.content, issuedAt, expiresAt: issuedAt + 300_000 };
  const observation = observeWorktreeCleanupTarget(emptyLaneMechanics({ ...base, planDigest: 'pending' }), { cwd: root }), content = { ...base, observationDigest: observation.observationDigest }; return Object.freeze({ ...content, planDigest: governanceDigest(content) });
}
function emptyLaneEligibility(plan, observation) { return Object.freeze({ schema: EMPTY_ACTIVE_LANE_RETIREMENT_ELIGIBILITY, planDigest: plan.planDigest, profileDigest: observation.profileDigest, canonicalRevision: observation.canonicalRevision, projectionManifestDigest: observation.projectionManifest.digest, projectionBytes: observation.projectionManifest.bytes, projectionEntries: observation.projectionManifest.entries, registrationManifestDigest: observation.registrationManifest.digest, registrationBytes: observation.registrationManifest.bytes, registrationEntries: observation.registrationManifest.entries, recoveryInventoryDigest: observation.recoveryInventoryDigest, recoveryInventoryContentEntries: observation.recoveryInventoryContentEntries, peerRegistrationDigest: observation.peerRegistrationDigest, sharedRefDigest: observation.sharedRefDigest, objectInventoryDigest: observation.objectInventoryDigest, sharedStateBytes: observation.sharedStateBytes, sharedStateEntries: observation.sharedStateEntries, evaluatedAt: iso(plan.issuedAt), expiresAt: iso(plan.expiresAt) }); }
function applyEmptyActiveLaneRetirement(plan, { root, profile, now = Date.now } = {}) {
  const time = now(); if (!Number.isSafeInteger(time) || time < plan.issuedAt || time >= plan.expiresAt) fail('blocked-empty-active-lane-retirement-expired', 'retirement plan is no longer current'); const current = planEmptyActiveLaneRetirement({ root, ref: plan.ref, profile, issuedAt: plan.issuedAt }); if (!same(current, plan)) fail('blocked-empty-active-lane-retirement-drift', 'lane or cleanup observation changed before quarantine'); const mechanics = emptyLaneMechanics(plan), before = observeWorktreeCleanupTarget(mechanics, { cwd: root }); if (before.observationDigest !== plan.observationDigest) fail('blocked-empty-active-lane-retirement-drift', 'cleanup target changed before quarantine'); const eligible = emptyLaneEligibility(plan, before);
  if (classifyExistingWorktreeQuarantine(mechanics, eligible, { cwd: root })) fail('blocked-empty-active-lane-retirement-replayed', 'retirement is already quarantined and must not run another effect'); const applied = quarantineWorktreeTarget(mechanics, before, { cwd: root, eligibility: eligible, authorizeEffects: () => { const effectTime = now(); if (!Number.isSafeInteger(effectTime) || effectTime < plan.issuedAt || effectTime >= plan.expiresAt) fail('blocked-empty-active-lane-retirement-expired', 'retirement plan expired before its effect'); return iso(effectTime); } });
  return Object.freeze({ schema: EMPTY_ACTIVE_LANE_RETIREMENT_RECEIPT, authority: 'native-zero-candidate-retirement', providerAuthority: false, sourceIntegrationAuthority: false, deploymentAuthority: false, ref: plan.ref, head: plan.head, baseSha: plan.baseSha, canonicalRevision: plan.canonicalRevision, reservationReleaseDigest: plan.reservationReleaseDigest, planDigest: plan.planDigest, stoppedAcknowledged: true, noCandidateCommitted: true, bytesDeleted: false, branchesMutated: false, objectsMutated: false, ...applied.result, ...applied.artifacts, result: 'quarantined' });
}
function emptyLaneLocked(root, operation) { const lock = acquireOperationLock('agentic-os-empty-active-lane-retirement', root); if (!lock) fail('blocked-empty-active-lane-retirement-busy', 'another empty active lane retirement is in progress'); let result, error; try { result = operation(); } catch (caught) { error = caught; } return finishOperationLock(lock, { label: 'empty active lane retirement', result, error, artifacts: error?.operationArtifacts ?? null }); }
export function runEmptyActiveLaneRetirement({ root, argv, profile, out = line => process.stdout.write(`${line}\n`), err = line => process.stderr.write(`${line}\n`), now = Date.now } = {}) { try { return emptyLaneLocked(root, () => { const plan = planEmptyActiveLaneRetirement({ root, ref: option(argv, 'ref'), profile, issuedAt: now() }); out(JSON.stringify(plan)); out(JSON.stringify(applyEmptyActiveLaneRetirement(plan, { root, profile, now }))); return 0; }); } catch (error) { err(`${error.reason ?? 'blocked-empty-active-lane-retirement'}: ${error.message}`); return 1; } }

/** Run one explicitly selected closeout through existing owners; retries reobserve each effect. */
export async function runAuthorizedCloseout({ ref, expectedHead, effects, stopped = false, authorityHead = null,
  observe, promote, synchronize, integrate, cleanup, release, readReceipt, saveReceipt, out = () => {} }) {
  if (!isLaneRef(ref) || !sha(expectedHead) || !Array.isArray(effects) || effects.length === 0
    || new Set(effects).size !== effects.length || effects.some(effect => !['merge', 'sync', 'cleanup'].includes(effect))
    || effects.includes('cleanup') && !stopped || authorityHead !== null && authorityHead !== expectedHead)
    fail('blocked-closeout-selection', 'Select one exact head and authorized effects; cleanup requires stopped writers');
  const selected = new Set(effects), completed = [];
  const inspect = async () => {
    const state = await observe();
    if (state.ref !== ref || state.head !== expectedHead || state.reviewHead !== expectedHead)
      fail('blocked-closeout-head-drift', 'Source or review head changed; retain work and reobserve');
    return state;
  };
  const report = (state, code, nextAction) => {
    out(JSON.stringify({ schema: 'agentic-os/progressive-completion/v2', authority: false, event: 'summary',
      ref, head: expectedHead, selectedEffects: effects, completedEffects: completed,
      sourceComplete: state.sourceComplete === true, workspaceClosed: !state.mounted && state.cleanupSatisfied === true,
      deliveryState: state.deliveryState ?? 'not-required', nextAction }));
    return code;
  };
  let state = await inspect();
  if (state.reviewState === 'OPEN') {
    if (!selected.has('merge')) return report(state, 2, 'authorize-merge');
    const result = await promote({ expectedHead, authorityHead });
    if (result.receipt) await saveReceipt('merge', result.receipt);
    state = await inspect();
    if (result.code !== 0 || state.reviewState === 'OPEN') return report(state, result.code || 2, 'wait-required-review-checks');
  }
  if (state.reviewState !== 'MERGED') fail('blocked-closeout-review', 'Closeout requires the exact merged review');
  completed.push('merge');
  if (!state.canonicalCurrent) {
    if (!selected.has('sync')) return report(state, 2, 'authorize-sync');
    const receipt = await synchronize();
    await saveReceipt('sync', receipt);
    state = await inspect();
    if (!state.canonicalCurrent) fail('blocked-closeout-sync', 'Canonical source did not reach the verified target');
  }
  completed.push('sync');
  await integrate();
  state = await inspect();
  let receipt = await readReceipt('cleanup');
  if (state.mounted || !state.cleanupSatisfied) {
    if (!selected.has('cleanup')) return report(state, 2, 'authorize-cleanup');
    if (state.mounted && !state.clean) fail('blocked-closeout-dirty', 'Preserve the dirty worktree; no cleanup was attempted');
    const result = await cleanup({ stopped: true });
    if (result.code !== 0) return report(await inspect(), result.code, 'cleanup-refused');
    receipt = result.receipt;
    if (!receipt) fail('blocked-closeout-cleanup-receipt', 'Cleanup returned without its owner receipt');
    await saveReceipt('cleanup', receipt);
    state = await inspect();
  }
  if (!state.cleanupSatisfied || state.mounted) return report(state, 2, 'verify-cleanup-receipt');
  completed.push('cleanup');
  await saveReceipt('allocation', await release(receipt));
  return report(state, 0, state.deliveryState === 'pending' ? 'deploy-workflow' : null);
}
/** Bounded private evidence, never authority. Each retry reobserves native owners. */
function closeoutEvidence(root, ref, head) {
  const directory = join(commonDir(root), `agentic-os-closeout-${governanceDigest({ ref, head })}`);
  try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const parent = privateDirectoryIdentity(directory), ceiling = 500_000;
  const entries = () => { assertPrivateDirectoryIdentity(parent); const names = readdirSync(directory).sort();
    if (names.length > 128 || names.some(name => !/^[a-z-]+-[0-9]{13}-[a-f0-9]{64}\.json$/u.test(name))) fail('blocked-closeout-evidence', 'Unexpected or excessive closeout evidence; retain it for inspection'); return names; };
  const read = name => {
    const file = entries().filter(entry => new RegExp(`^${name}-[0-9]{13}-`, 'u').test(entry)).at(-1); if (!file) return null;
    const envelope = JSON.parse(readPrivateFile(join(directory, file), ceiling, 'closeout evidence', parent));
    if (envelope.ref !== ref || envelope.head !== head || !file.endsWith(`-${governanceDigest(envelope)}.json`)) fail('blocked-closeout-evidence', 'Closeout evidence identity differs');
    return envelope.value;
  };
  const save = (name, value) => {
    if (!/^[a-z-]+$/u.test(name)) fail('blocked-closeout-evidence', 'Invalid effect name');
    if (same(read(name), value)) return;
    if (entries().length >= 128) fail('blocked-closeout-evidence', 'Closeout evidence limit reached');
    const envelope = { ref, head, value }, path = join(directory, `${name}-${Date.now()}-${governanceDigest(envelope)}.json`);
    assertPrivateDirectoryIdentity(parent); writePrivateFileExclusive(path, Buffer.from(canonicalJson(envelope)), { maxBytes: ceiling }); assertPrivateDirectoryIdentity(parent);
    return path;
  };
  return { read, save, directory };
}
/** The default END composes existing owners; advanced providers remain lazy. */
export async function runCoreCloseout({ root, argv, policy, profile, integrate, out = console.log, err = console.error }) {
  const ref = option(argv, 'ref'), expectedHead = option(argv, 'expected-head'), effects = (option(argv, 'effects') ?? '').split(',');
  if (!isLaneRef(ref) || !sha(expectedHead) || currentBranch(root) !== policy.protectedBranch)
    fail('blocked-closeout-selection', 'END requires canonical source, one lane, and its exact head');
  if (!profile.repository.startsWith('github.com/')) fail('blocked-closeout-provider', 'No default closeout adapter is registered for this provider');
  const lock = acquireOperationLock('agentic-os-closeout', root); if (!lock) fail('blocked-closeout-concurrent', 'Another closeout owns this clone');
  let result, error;
  try {
    const journal = closeoutEvidence(root, ref, expectedHead);
    const remote = profile.canonical.remoteRef.match(/^refs\/remotes\/([^/]+)\//u)?.[1];
    if (!remote) fail('blocked-closeout-remote', 'Canonical remote is missing');
    gitFetch(remote, root);
    const { observeGitHubReview } = await import('../src/github-provider.mjs');
    const complete = await import('./agentic-os-release-common-complete.mjs');
    const [{ planCanonicalSync, applyCanonicalSync }, { applyUserCleanup }, { releaseCommonLocalCleanupPolicy }, workflow] = await Promise.all([
      import('../src/canonical-sync.mjs'), import('./agentic-os-cleanup-user.mjs'), import('../src/cleanup.mjs'), import('./agentic-os-workflow.mjs')]);
    const observe = () => {
      const observed = observeGitHubReview({ ref, expectedHead, profile, cwd: root });
      if (!observed.sourceHeadBound) fail('blocked-closeout-review', observed.reason);
      if (get(ref, root)?.pr !== observed.review.number) fail('blocked-closeout-review', 'Cached PR identity differs from the live exact-head review');
      const status = inspectCompletionStatus(root, ref, policy, profile, { cleanupReceipt: journal.read('cleanup'), allowUntrackedCanonical: true });
      if (status.lane.head !== expectedHead || observed.review.headRefOid !== expectedHead)
        fail('blocked-closeout-head-drift', 'Lane or review changed after selection');
      return { ref, head: status.lane.head, reviewHead: observed.review.headRefOid, reviewState: observed.review.state,
        canonicalCurrent: status.closeout.canonicalCurrent, mounted: status.lane.mounted, clean: status.lane.clean,
        cleanupSatisfied: status.closeout.cleanupSatisfied, sourceComplete: status.closeout.sourceState === 'source_complete', deliveryState: status.closeout.deliveryState };
    };
    const capture = callback => line => { const value = JSON.parse(line); callback(value); out(line); };
    result = await runAuthorizedCloseout({ ref, expectedHead, effects, stopped: flag(argv, 'stopped'), authorityHead: option(argv, 'authority-head'),
      observe, readReceipt: journal.read, saveReceipt: journal.save, out,
      promote: async ({ authorityHead }) => {
        let planned, receipt;
        const code = await complete.runSourcePromotion({ root, argv: ['plan', `--ref=${ref}`], profile, out: capture(value => { planned = value.plan; }) });
        if (code !== 0) return { code };
        if (planned?.head !== expectedHead) fail('blocked-closeout-head-drift', 'Promotion plan head differs');
        journal.save('promotion-plan', planned);
        // Native promotion reads a plan envelope; retain it separately from the audit envelope.
        const planPath = join(journal.directory, `native-plan-${Date.now()}-${governanceDigest(planned)}.json`);
        writePrivateFileExclusive(planPath, Buffer.from(JSON.stringify(planned)), { maxBytes: 65_536 });
        const applied = await complete.runSourcePromotion({ root, argv: ['apply', `--plan=${planPath}`, `--authorize=sha256:${planned.digest}`,
          ...(authorityHead ? [`--authority-head=${authorityHead}`] : [])], profile, out: capture(value => { receipt = value; }) });
        if (applied === 0) gitFetch(remote, root);
        return { code: applied, receipt };
      },
      synchronize: async () => {
        gitFetch(remote, root);
        const plan = planCanonicalSync({ cwd: root, branch: policy.protectedBranch, targetRef: profile.canonical.remoteRef, preserveUntracked: true, fastForwardClean: true });
        if (plan.inventory.length) fail('blocked-closeout-dirty-canonical', 'Canonical authored bytes require the recovery workflow');
        journal.save('sync-plan', plan);
        return applyCanonicalSync(plan, { cwd: root, authorization: plan.authorization, exclusive: plan.exclusiveAuthorization });
      },
      integrate: async () => { if (await integrate() !== 0) fail('blocked-closeout-integration', 'Native integration classification refused'); },
      cleanup: async () => {
        let receipt;
        if (!observe().mounted) {
          const plan = journal.read('cleanup-plan'); if (!plan) fail('blocked-closeout-cleanup-receipt', 'No retained native cleanup plan; use recovery');
          if (plan.head !== expectedHead || plan.branch !== ref) fail('blocked-closeout-head-drift', 'Retained cleanup plan differs from selection');
          receipt = applyUserCleanup(plan, { cwd: root, authorization: `agentic-os:user-cleanup:${plan.planDigest}`, stopped: true,
            resolvePolicy: (cwd, mode) => { const selected = releaseCommonLocalCleanupPolicy(root, profile, { allowUntrackedCanonical: true }); if (cwd !== root || mode !== selected.mode) fail('blocked-closeout-policy', 'Cleanup binding changed'); return selected; } });
          return { code: 0, receipt };
        }
        const code = await complete.runReleaseCommonLocalCleanup({ root, ref, profile, err, allowUntrackedCanonical: true, out: capture(value => {
          if (value.schema === 'agentic-os/user-cleanup-plan/v1') {
            if (value.head !== expectedHead || value.branch !== ref) fail('blocked-closeout-head-drift', 'Native cleanup plan differs from selection');
            journal.save('cleanup-plan', value);
          }
          else if (value.schema === 'agentic-os/user-cleanup-receipt/v1') receipt = value;
        }) });
        return { code, receipt };
      },
      release: async receipt => {
        const status = inspectCompletionStatus(root, ref, policy, profile, { cleanupReceipt: receipt, allowUntrackedCanonical: true });
        if (status.closeout.missionState !== 'source_complete' || !status.closeout.cleanupSatisfied || status.lane.mounted)
          fail('blocked-closeout-release', 'Native source and cleanup proof are incomplete');
        return workflow.releaseWorkflowAllocation(root, profile.repository, ref);
      },
    });
  } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'closeout', result, error });
}
async function main() { const args = validateCompletionCloseArguments(process.argv.slice(2)), root = process.cwd(), bundle = jsonFile(args.bundle, 4_194_304, 'completion-bundle'), planned = args.mode === 'apply' ? args.confirm ? await planCompletionClose(root, args.ref, bundle) : jsonFile(args.plan, 65_536, 'completion-plan') : null, result = args.mode === 'plan' ? await planCompletionClose(root, args.ref, bundle) : await applyCompletionClose(root, args.ref, bundle, planned, args.confirm ?? args.authorize, { stopped: args.stopped }); process.stdout.write(`${canonicalJson(result)}\n`); }
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch(error => { process.stderr.write(`completion-close: ${error.reason ?? 'error'}: ${error.message}\n`); process.exitCode = 1; });
