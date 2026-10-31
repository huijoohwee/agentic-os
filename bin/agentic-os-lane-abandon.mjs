#!/usr/bin/env node
/** Exact local archive disposition for one unpublished dirty lane. */
import { createHash } from 'node:crypto';
import { mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { acquireOperationLock, commonDir, configuredRemote, currentBranch, finishOperationLock,
  headSha, observeGit, remoteRefSha, remoteTransport, repoRoot, worktrees } from '../src/git.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';
import { observeWorktreeCleanupTarget, quarantineWorktreeTarget, classifyExistingWorktreeQuarantine,
  observeRetainedQuarantineEvidence } from '../src/cleanup-quarantine.mjs';
import { governanceDigest, canonicalJson } from '../src/governance.mjs';
import { get as getLaneRecord } from '../src/lane-records.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
import { trustedRepositoryProfile } from './agentic-os-auxiliary.mjs';
import { createRetirementOpenReaderProbe } from './agentic-os-cleanup-user.mjs';
import { gh } from '../src/github-provider.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { privateDirectoryIdentity, assertPrivateDirectoryIdentity, readPrivateFile,
  writePrivateFileExclusive } from '../src/file-integrity.mjs';
import { createUnpublishedLaneAbandonmentPlan, createUnpublishedLaneAbandonmentReceipt,
  validateUnpublishedLaneAbandonmentPlan, validateUnpublishedLaneAbandonmentReceipt } from '../src/cleanup-records.mjs';

const PLAN_SCHEMA = 'agentic-os/unpublished-lane-abandonment-plan/v1';
const RECEIPT_DIRECTORY = 'agentic-os-unpublished-lane-abandonments';
const MODE = 'explicit-local-user-consent-recovery';
const LIMITS = Object.freeze({ projectionByteCeiling: 16 * 1024 ** 2, projectionEntryCeiling: 10_000,
  registrationByteCeiling: 16 * 1024 ** 2, registrationEntryCeiling: 10_000,
  sharedStateByteCeiling: 256 * 1024 ** 2, sharedStateEntryCeiling: 100_000 });
const SHA256 = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const fail = (code, message) => { throw Object.assign(new Error(message), { reason: `blocked-lane-abandonment-${code}` }); };
const utf8 = new TextDecoder('utf-8', { fatal: true });
const receiptPath = (root, ref) => join(commonDir(root), RECEIPT_DIRECTORY, `${SHA256(ref)}.json`);

function canonical(root, profile) {
  const local = headSha(profile.canonical.localRef, root), tracking = headSha(profile.canonical.remoteRef, root);
  if (currentBranch(root) !== profile.canonical.localRef.slice('refs/heads/'.length)
    || !local || local !== tracking || observeGitStatus(root) !== '')
    fail('canonical', 'canonical main must be current and clean');
  return local;
}
function observeGitStatus(root) {
  return observeGit(['status', '--porcelain', '--untracked-files=all'], { cwd: root });
}
function providerHasPullRequest(root, profile, ref) {
  const repository = profile.repository.replace(/^github\.com\//u, ''), rows = gh(
    ['pr', 'list', '--repo', repository, '--state', 'all', '--head', ref, '--json', 'number,headRefName'],
    { cwd: root, timeoutMs: 15_000 });
  if (!Array.isArray(rows)) fail('provider-observation', 'GitHub could not prove that this lane has no pull request');
  if (rows.length !== 0) fail('published', 'a pull request exists for this lane');
}
function assertUnpublished(root, profile, ref) {
  const remote = /^refs\/remotes\/([^/]+)\//u.exec(profile.canonical.remoteRef ?? '')?.[1];
  if (!remote) fail('remote-profile', 'canonical profile has no exact remote');
  const transport = remoteTransport(configuredRemote(remote, root), root);
  if (remoteRefSha(remote, ref, root, transport.fetchUrl) !== null)
    fail('published', 'a live remote branch exists for this lane');
  providerHasPullRequest(root, profile, ref);
}
function binding(root, ref, profile, expected = null) {
  if (!isLaneRef(ref)) fail('ref', 'one exact lane ref is required');
  const record = getLaneRecord(ref, root), entry = worktrees(root).find(row => row.branch === ref);
  const head = headSha(`refs/heads/${ref}`, root);
  if (!record || record.ref !== ref || record.state !== 'active' || record.pr !== null
    || record.base !== profile.canonical.remoteRef || !record.baseSha || !record.worktree
    || record.head !== head || !entry || entry.path !== record.worktree || entry.locked || entry.prunable
    || !head || !isAbsolute(entry.path) || resolve(entry.path) !== entry.path)
    fail('lane-binding', 'lane must be one exact active unpublished registered worktree');
  let path; try { path = realpathSync(record.worktree); } catch { fail('lane-path', 'lane worktree path is missing'); }
  const stat = lstatSync(path);
  if (path !== record.worktree || !stat.isDirectory() || stat.isSymbolicLink()
    || currentBranch(path) !== ref || headSha('HEAD', path) !== head
    || expected && (expected.head !== head || expected.targetPath !== path || expected.baseSha !== record.baseSha))
    fail('lane-drift', 'lane ref, checkout, or admitted base changed');
  if (record.recovery?.dirtyState === 'unobservable-at-missing-path')
    fail('lane-recovery', 'unknown prior checkout bytes require a separate recovery disposition');
  return { record, entry, ref, head, targetPath: path, baseSha: record.baseSha };
}
function mechanics(plan) {
  return { ...LIMITS, mode: MODE, repository: plan.repository, targetPath: plan.targetPath,
    expectedBranch: plan.ref, expectedHeadRevision: plan.head, expectedCanonicalRef: plan.canonicalRef,
    expectedCanonicalRevision: plan.canonicalRevision, profileDigest: plan.profileDigest,
    expiresAt: plan.expiresAt,
    recoveryInventoryDigest: plan.recoveryInventoryDigest,
    recoveryInventoryContentEntries: plan.recoveryInventoryContentEntries, planDigest: plan.planDigest };
}
function observe(root, plan, { forceFreshRecoveryInventory = false } = {}) {
  return observeWorktreeCleanupTarget(mechanics(plan), { cwd: root, forceFreshRecoveryInventory });
}
function makeEligibility(plan) {
  return { schema: 'agentic-os/user-cleanup-eligibility/v1', planDigest: plan.planDigest,
    profileDigest: plan.profileDigest, canonicalRevision: plan.canonicalRevision,
    evaluatedAt: plan.issuedAt, expiresAt: plan.expiresAt,
    projectionManifestDigest: plan.projectionManifest.digest, projectionBytes: plan.projectionManifest.bytes,
    projectionEntries: plan.projectionManifest.entries, registrationManifestDigest: plan.registrationManifest.digest,
    registrationBytes: plan.registrationManifest.bytes, registrationEntries: plan.registrationManifest.entries,
    peerRegistrationDigest: plan.peerRegistrationDigest, sharedRefDigest: plan.sharedRefDigest,
    objectInventoryDigest: plan.objectInventoryDigest, sharedStateBytes: plan.sharedStateBytes,
    sharedStateEntries: plan.sharedStateEntries };
}
function digestObservation(value) {
  return { projectionManifest: value.projectionManifest, registrationManifest: value.registrationManifest,
    peerRegistrationDigest: value.peerRegistrationDigest, sharedRefDigest: value.sharedRefDigest,
    objectInventoryDigest: value.objectInventoryDigest, sharedStateBytes: value.sharedStateBytes,
    sharedStateEntries: value.sharedStateEntries, recoveryInventoryDigest: value.recoveryInventoryDigest,
    recoveryInventoryContentEntries: value.recoveryInventoryContentEntries };
}
function assertObservation(plan, value) {
  if (value.observationDigest !== plan.observationDigest
    || !same(digestObservation(value), { projectionManifest: plan.projectionManifest,
      registrationManifest: plan.registrationManifest, peerRegistrationDigest: plan.peerRegistrationDigest,
      sharedRefDigest: plan.sharedRefDigest, objectInventoryDigest: plan.objectInventoryDigest,
      sharedStateBytes: plan.sharedStateBytes, sharedStateEntries: plan.sharedStateEntries,
      recoveryInventoryDigest: plan.recoveryInventoryDigest,
      recoveryInventoryContentEntries: plan.recoveryInventoryContentEntries }))
    fail('observation-drift', 'lane bytes, refs, objects, registration, or profile changed after planning');
}
function providerBinding(root, profile, ref, publicationCheck = assertUnpublished) {
  canonical(root, profile); binding(root, ref, profile); publicationCheck(root, profile, ref);
}
function readReceipt(root, ref) {
  const directory = join(commonDir(root), RECEIPT_DIRECTORY), path = receiptPath(root, ref);
  if (!lstatSync(directory, { throwIfNoEntry: false })) return null;
  const parent = privateDirectoryIdentity(directory, 'abandonment receipt directory');
  if (!parent) fail('receipt-directory', 'abandonment receipt directory is not private');
  try { return validateUnpublishedLaneAbandonmentReceipt(JSON.parse(utf8.decode(readPrivateFile(path, 64_000, 'abandonment receipt', parent)))); }
  catch (error) { if (error.code === 'ENOENT') return null; fail('receipt-invalid', error.message); }
}
function retainedReceipt(root, ref, laneHead, laneRecord, profile) {
  const receipt = readReceipt(root, ref); if (!receipt) return null;
  const plan = receipt.plan, coordinate = plan.planDigest, common = commonDir(root), archivePath = join(common, 'agentic-os-cleanup-quarantine', coordinate);
  if (plan.repository !== profile.repository || plan.profileDigest !== profile.profileDigest
    || plan.ref !== ref || plan.head !== laneHead || plan.baseSha !== laneRecord?.baseSha
    || plan.targetPath !== laneRecord?.worktree || receipt.archivePath !== archivePath
    || receipt.projectionPath !== join(archivePath, 'projection')
    || receipt.registrationPath !== join(archivePath, 'registration')
    || headSha(`refs/heads/${ref}`, root) !== laneHead
    || worktrees(root).some(row => row.branch === ref || row.path === plan.targetPath)) return null;
  const evidence = observeRetainedQuarantineEvidence(root, ref, laneHead, coordinate,
    { canonicalRef: profile.canonical.localRef });
  if (!evidence || evidence.operationDigest !== receipt.operationDigest
    || !same(evidence.projectionManifest, plan.projectionManifest)
    || !same(evidence.registrationManifest, plan.registrationManifest)) return null;
  return receipt;
}
export function observeUnpublishedLaneAbandonment(root, ref, laneHead, laneRecord, profile) {
  try { return retainedReceipt(root, ref, laneHead, laneRecord, profile); } catch { return null; }
}
export function planUnpublishedLaneAbandonment({ cwd = process.cwd(), ref, reason, now = Date.now,
  publicationCheck = assertUnpublished } = {}) {
  const root = realpathSync(repoRoot(cwd)), profile = trustedRepositoryProfile(root).profile;
  if (!profile || realpathSync(root) !== root) fail('repository-profile', 'trusted canonical repository profile is required');
  const canonicalRevision = canonical(root, profile), lane = binding(root, ref, profile);
  publicationCheck(root, profile, ref);
  if (readReceipt(root, ref)) fail('already-abandoned', 'an abandonment receipt already exists for this lane');
  const issuedAtMs = now(); if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) fail('clock', 'clock is invalid');
  const recovery = collectRecoveryInventory({ cwd: lane.targetPath, canonicalRef: profile.canonical.localRef,
    maxContentEntries: LIMITS.projectionEntryCeiling });
  if (recovery.branch !== ref || recovery.headRevision !== lane.head || recovery.canonicalRevision !== canonicalRevision)
    fail('recovery-inventory', 'exact dirty recovery inventory is unavailable');
  const body = { schema: PLAN_SCHEMA, repository: profile.repository, profileDigest: profile.profileDigest,
    ref, baseSha: lane.baseSha, head: lane.head, targetPath: lane.targetPath,
    canonicalRef: profile.canonical.localRef, canonicalRevision, reason,
    issuedAt: new Date(issuedAtMs).toISOString(), expiresAt: new Date(issuedAtMs + 300_000).toISOString(),
    recoveryInventoryDigest: governanceDigest(recovery),
    recoveryInventoryContentEntries: recovery.inventoryEntries.content };
  const provisional = { ...body, planDigest: '0'.repeat(64) }, observed = observe(root, provisional);
  const plan = createUnpublishedLaneAbandonmentPlan({ ...body,
    ...digestObservation(observed), observationDigest: observed.observationDigest });
  if (plan.schema !== PLAN_SCHEMA) fail('plan-schema', 'abandonment plan schema changed unexpectedly');
  return plan;
}
function createReceipt(root, plan, applied, now) {
  const archivePath = applied.artifacts.operationPath, operation = JSON.parse(utf8.decode(
    readBoundedStableFile(join(archivePath, 'operation.json'), 64_000, 'abandonment operation')));
  const evidence = observeRetainedQuarantineEvidence(root, plan.ref, plan.head, plan.planDigest,
    { canonicalRef: plan.canonicalRef });
  if (!evidence || !same(evidence.projectionManifest, plan.projectionManifest)
    || !same(evidence.registrationManifest, plan.registrationManifest))
    fail('archive-verification', 'exact retained projection and registration could not be verified');
  const payload = { schema: 'agentic-os/unpublished-lane-abandonment-receipt/v1', plan,
    planDigest: plan.planDigest, operationDigest: governanceDigest(operation), archivePath,
    projectionPath: join(archivePath, 'projection'), registrationPath: join(archivePath, 'registration'),
    executedAt: applied.result.executedAt ?? new Date(now()).toISOString(),
    archiveDigest: governanceDigest({ planDigest: plan.planDigest, operationDigest: governanceDigest(operation),
      projectionManifest: evidence.projectionManifest, registrationManifest: evidence.registrationManifest,
      recoveryInventoryDigest: plan.recoveryInventoryDigest }), authority: 'explicit-local-user-consent',
    stoppedAcknowledged: true, archivePrivate: true, archiveArchived: true,
    sourceIntegrated: false, sourceSuperseded: false, sourceAbandoned: true,
    providerAuthority: false, branchRefsMutated: false, objectDatabaseMutated: false,
    dataDeleted: false, claimRetired: false };
  return createUnpublishedLaneAbandonmentReceipt(payload);
}
export function applyUnpublishedLaneAbandonment(input, { cwd = process.cwd(), authorization,
  stopped = false, now = Date.now, probe = createRetirementOpenReaderProbe(),
  publicationCheck = assertUnpublished } = {}) {
  const plan = validateUnpublishedLaneAbandonmentPlan(input), root = realpathSync(repoRoot(cwd));
  if (root === plan.targetPath || realpathSync(commonDir(root)) !== realpathSync(commonDir(plan.targetPath)))
    fail('controller', 'cleanup controller must be a surviving peer in the target clone');
  if (stopped !== true || authorization !== `agentic-os:unpublished-lane-abandonment:${plan.planDigest}`)
    fail('authorization', 'apply requires the exact plan authorization and stopped-writer assertion');
  const lock = acquireOperationLock('agentic-os-unpublished-lane-abandonment', root);
  if (!lock) fail('busy', 'another lane abandonment operation is in progress');
  let result, error;
  try {
    const time = now(); if (!Number.isSafeInteger(time) || time < Date.parse(plan.issuedAt) || time >= Date.parse(plan.expiresAt)) fail('expired', 'plan expired');
    const existing = readReceipt(root, plan.ref); if (existing) {
      if (existing.planDigest !== plan.planDigest) fail('replay', 'another abandonment plan already closed this lane');
      result = retainedReceipt(root, plan.ref, plan.head, getLaneRecord(plan.ref, root), trustedRepositoryProfile(root).profile);
      if (!result) fail('receipt-drift', 'stored abandonment receipt no longer verifies');
    } else {
      const profile = trustedRepositoryProfile(root).profile; if (!profile) fail('repository-profile', 'trusted profile is unavailable');
      canonical(root, profile); publicationCheck(root, profile, plan.ref);
      const eligibility = makeEligibility(plan), mounted = worktrees(root).some(row => row.path === plan.targetPath && row.branch === plan.ref);
      let applied;
      if (mounted) {
        providerBinding(root, profile, plan.ref, publicationCheck);
        const bindingNow = binding(root, plan.ref, profile, plan), current = collectRecoveryInventory({ cwd: bindingNow.targetPath,
          canonicalRef: plan.canonicalRef, maxContentEntries: LIMITS.projectionEntryCeiling });
        if (governanceDigest(current) !== plan.recoveryInventoryDigest) fail('recovery-drift', 'dirty worktree bytes changed after planning');
        const before = observe(root, plan, { forceFreshRecoveryInventory: true }); assertObservation(plan, before);
        probe(plan.targetPath);
        applied = quarantineWorktreeTarget(mechanics(plan), before, { cwd: root, eligibility,
          authorizeEffects() {
            const fresh = now(); if (!Number.isSafeInteger(fresh) || fresh < Date.parse(plan.issuedAt) || fresh >= Date.parse(plan.expiresAt)) fail('expired', 'plan expired before quarantine');
            providerBinding(root, profile, plan.ref, publicationCheck); probe(plan.targetPath);
            assertObservation(plan, observe(root, plan, { forceFreshRecoveryInventory: true }));
            return new Date(fresh).toISOString();
          } });
      } else {
        if (headSha(`refs/heads/${plan.ref}`, root) !== plan.head
          || getLaneRecord(plan.ref, root)?.worktree !== plan.targetPath)
          fail('partial-effect', 'unmounted lane identity changed after partial quarantine');
        applied = classifyExistingWorktreeQuarantine(mechanics(plan), eligibility, { cwd: root });
        if (!applied) fail('partial-effect', 'lane is unmounted but the exact recoverable quarantine is not complete');
      }
      const receipt = createReceipt(root, plan, applied, now);
      const directory = join(commonDir(root), RECEIPT_DIRECTORY);
      if (!lstatSync(directory, { throwIfNoEntry: false })) mkdirSync(directory, { mode: 0o700 });
      const parent = privateDirectoryIdentity(directory, 'abandonment receipt directory');
      if (!parent) fail('receipt-directory', 'abandonment receipt directory is not private');
      const path = receiptPath(root, plan.ref);
      writePrivateFileExclusive(path, Buffer.from(canonicalJson(receipt)), { maxBytes: 64_000, label: 'abandonment receipt' });
      assertPrivateDirectoryIdentity(parent, 'abandonment receipt directory');
      result = retainedReceipt(root, plan.ref, plan.head, getLaneRecord(plan.ref, root), profile);
      if (!result) fail('receipt-postcondition', 'archive receipt did not verify after quarantine');
    }
  } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'unpublished lane abandonment', result, error,
    artifacts: error?.operationArtifacts ?? null });
}
function options(argv, expected) {
  const found = new Map(), flags = new Set();
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/u.exec(arg); if (!match) fail('arguments', 'arguments must be --key=value options');
    if (found.has(match[1]) || flags.has(match[1])) fail('arguments', `duplicate option ${match[1]}`);
    if (match[2] === undefined) flags.add(match[1]); else found.set(match[1], match[2]);
  }
  if ([...found.keys(), ...flags].some(key => !expected.includes(key))
    || expected.some(key => !found.has(key) && !flags.has(key))) fail('arguments', `expected options: ${expected.join(', ')}`);
  return { found, flags };
}
export function runLaneAbandon(argv = process.argv.slice(2), out = line => process.stdout.write(`${line}\n`),
  err = line => process.stderr.write(`${line}\n`)) {
  try {
    const [action, ...rest] = argv;
    if (action === 'plan') {
      const parsed = options(rest, ['ref', 'reason']), plan = planUnpublishedLaneAbandonment({ ref: parsed.found.get('ref'), reason: parsed.found.get('reason') });
      out(canonicalJson(plan)); return 0;
    }
    if (action === 'apply') {
      const parsed = options(rest, ['plan', 'authorize', 'stopped']);
      if (!parsed.flags.has('stopped')) fail('arguments', 'apply requires --stopped');
      const input = JSON.parse(utf8.decode(readBoundedStableFile(parsed.found.get('plan'), 64_000, 'abandonment plan')));
      out(canonicalJson(applyUnpublishedLaneAbandonment(input, { authorization: parsed.found.get('authorize'), stopped: true }))); return 0;
    }
    fail('arguments', 'usage: lane:abandon plan --ref=<lane> --reason=<text> | apply --plan=<json> --authorize=agentic-os:unpublished-lane-abandonment:<digest> --stopped');
  } catch (error) { err(`${error.reason ?? 'blocked-lane-abandonment'}: ${error.message}`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  process.exitCode = runLaneAbandon();
