import { lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { currentBranch, observeGit, repoRoot, remoteTransport, acquireOperationLock, finishOperationLock, observeGitLines, worktrees, commonDir } from '../src/git.mjs';
import { loadRepositoryTrust } from '../src/git-repository.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';
import { observeWorktreeCleanupTarget, classifyExistingWorktreeQuarantine, quarantineWorktreeTarget, observeRetainedQuarantineEvidence, observeQuarantineManifest } from '../src/cleanup-quarantine.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { privateDirectoryIdentity, legacyPrivateDirectoryIdentity, assertPrivateDirectoryIdentity, writePrivateFileExclusive,
  readPrivateFile, captureExactTree, pathIdentity, removeExactTree, unlinkExactPath,
  tightenLegacyPrivateDirectory } from '../src/file-integrity.mjs';
import { inferMergedReviewWorkflow, observeMergedReview, reviewOptions, refuse } from './agentic-os-cleanup-review.mjs';
import { option } from './agentic-os-argv.mjs';
import { RECOVERY_MODE, RECOVERY_LIMITS, recoveryPolicy, recoveryIntegration } from './agentic-os-cleanup-recovery.mjs';
import { classifyLaneChangeClass, SUPPORTED_CHANGE_CLASSES, successorIntegrationProof, exactCurrentIntegrationProof } from '../src/patch-identity.mjs';
import { get } from '../src/lane-records.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
import { validateGitHubTransitionPolicy, selectPreservationAdoption } from '../src/github-transition-policy.mjs';
import { SUCCESSOR_PRESERVATION_SCHEMA, SUCCESSOR_PRESERVATION_PLAN_SCHEMA,
  CURRENT_QUARANTINE_SCHEMA, CURRENT_QUARANTINE_PLAN_SCHEMA,
  validateRetentionDispositionPlan, validateRetentionDispositionReceipt } from '../src/cleanup-records.mjs';
const SCHEMA = 'agentic-os/user-cleanup-plan/v1', MODE = 'explicit-local-user-consent';
const NO_CI_MODE = 'explicit-local-user-consent-no-ci';
const KEY = 'agentic-os.userCleanup';
const LIMITS = Object.freeze({ projectionByteCeiling: 16 * 1024 * 1024, projectionEntryCeiling: 10000,
  registrationByteCeiling: 16 * 1024 * 1024, registrationEntryCeiling: 10000,
  sharedStateByteCeiling: 256 * 1024 * 1024, sharedStateEntryCeiling: 100000 });
const read = (cwd, args, options = {}) => observeGit(args, { cwd, maxBuffer: 65536, ...options });
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
function refuseUnknownLaneBytes(targetPath, root) {
  const branch = currentBranch(targetPath), record = branch && isLaneRef(branch) ? get(branch, root) : null;
  if (record?.recovery?.dirtyState === 'unobservable-at-missing-path')
    refuse('lane-dirty-state-unknown', 'reconstructed lane bytes remain unresolved; preserve and disposition them before cleanup');
}
export const readUserCleanupJson = (path, label, parent = null) => JSON.parse(new TextDecoder('utf-8', { fatal: true })
  .decode(parent ? readPrivateFile(path, 64000, label, parent) : readBoundedStableFile(path, 64000, label)));
function resolveChangeClass(declared, observed) {
  if (declared === undefined) return { declared: null, observed, fastPath: false };
  if (!SUPPORTED_CHANGE_CLASSES.includes(declared)) refuse('unsupported-change-class');
  const fastPath = declared === 'docs-only';
  if (fastPath && observed !== declared)
    refuse('change-class-mismatch', `declared --change-class=docs-only but observed ${observed}`);
  return { declared, observed, fastPath };
}
const fields = (value, names) => {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).sort().join(',') !== names.split(',').sort().join(',')) refuse('shape');
};
function policy(root, mode = MODE, { changeClass = undefined } = {}) {
  if (realpathSync(repoRoot(root)) !== root || read(root, ['symbolic-ref', '--quiet', 'HEAD']) !== 'refs/heads/main')
    refuse('canonical-controller');
  const enrollment = mode === RECOVERY_MODE ? 'quarantine-recovery' : mode === NO_CI_MODE ? 'quarantine-no-ci' : 'quarantine';
  if (![MODE, NO_CI_MODE, RECOVERY_MODE].includes(mode)
    || read(root, ['config', '--local', '--get-all', KEY], { allowFail: true }) !== enrollment)
    refuse('local-enrollment-required');
  if (mode !== RECOVERY_MODE && changeClass !== 'docs-only'
    && (lstatSync(join(root, '.agentic-os.json'), { throwIfNoEntry: false })
    || read(root, ['ls-tree', 'refs/heads/main', '--', '.agentic-os.json'])
    || loadRepositoryTrust(root, { required: false }))) refuse('profile-governed-repository');
  const remoteUrl = remoteTransport('origin', root).fetchUrl;
  const match = remoteUrl.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u);
  if (!match || match[1].split('/').some(s => s === '.' || s === '..')) refuse('remote-identity');
  const canonical = read(root, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  if (read(root, ['rev-parse', '--verify', 'HEAD']) !== canonical
    || read(root, ['rev-parse', '--verify', 'refs/remotes/origin/main']) !== canonical
    || read(root, ['status', '--porcelain', '--untracked-files=all'])) refuse('canonical-not-clean');
  return { root, repository: match[1], remoteUrl, canonical, localRef: 'refs/heads/main',
    mode, enrollment: mode === MODE ? KEY : `${KEY}=${enrollment}`,
    ...(mode === RECOVERY_MODE ? recoveryPolicy(root, match[1]) : {}),
    selectedEffects: ['quarantine-projection', 'quarantine-registration'] };
}
function resolvePolicy(root, mode, resolver = null, options = {}) {
  return typeof resolver === 'function' ? resolver(root, mode, options) : policy(root, mode, options);
}
function observePolicy(mechanics, root, resolver = null) {
  const current = resolvePolicy(root, mechanics.mode, resolver);
  if (governanceDigest(current) !== mechanics.profileDigest || current.canonical !== mechanics.expectedCanonicalRevision
    || `github.com/${current.repository}` !== mechanics.repository) refuse('local-policy-drift');
  return { root, canonicalRevision: current.canonical,
    profile: { profileDigest: governanceDigest(current), canonical: { localRef: current.localRef } } };
}
function mechanics(plan) {
  return { ...(plan.mode === RECOVERY_MODE ? RECOVERY_LIMITS : LIMITS), mode: plan.mode, repository: `github.com/${plan.repository}`, targetPath: plan.targetPath,
    expectedBranch: plan.detachedHead ? null : plan.successor?.predecessorRef ?? plan.mergedProjection?.branch ?? plan.branch,
    expectedHeadRevision: plan.detachedHead ?? plan.successor?.predecessorHead ?? plan.mergedProjection?.head ?? plan.head,
    detachedRecovery: Boolean(plan.detachedHead),
    expectedCanonicalRef: 'refs/heads/main',
    expectedCanonicalRevision: plan.canonical, profileDigest: plan.policyDigest,
    recoveryInventoryDigest: plan.inventoryDigest, recoveryInventoryContentEntries: plan.inventoryContentEntries,
    planDigest: plan.planDigest };
}
function eligibility(plan) {
  const o = plan.observation;
  return { schema: 'agentic-os/user-cleanup-eligibility/v1', planDigest: plan.planDigest,
    profileDigest: plan.policyDigest, canonicalRevision: plan.canonical,
    projectionManifestDigest: o.projectionManifest.digest, projectionBytes: o.projectionManifest.bytes,
    projectionEntries: o.projectionManifest.entries, registrationManifestDigest: o.registrationManifest.digest,
    registrationBytes: o.registrationManifest.bytes, registrationEntries: o.registrationManifest.entries,
    peerRegistrationDigest: o.peerRegistrationDigest, sharedRefDigest: o.sharedRefDigest,
    objectInventoryDigest: o.objectInventoryDigest, sharedStateBytes: o.sharedStateBytes,
    sharedStateEntries: o.sharedStateEntries, evaluatedAt: new Date(plan.issuedAt).toISOString(),
    expiresAt: new Date(plan.expiresAt).toISOString() };
}
function mergedState(plan, options, observed = observeMergedReview(plan, { cwd: plan.root, ...options })) {
  if (!same(observed, plan.review)) refuse('review-drift');
  if (plan.mode === RECOVERY_MODE) {
    if (!same(recoveryIntegration(plan, read), plan.integration)) refuse('integration-drift');
  } else if (plan.changeClass?.fastPath !== true
    && read(plan.root, ['rev-parse', '--verify', `${plan.head}^{tree}`])
    !== read(plan.root, ['rev-parse', '--verify', `${plan.merge}^{tree}`])) refuse('merge-tree-drift');
  if (read(plan.root, ['merge-base', '--is-ancestor', plan.merge, plan.canonical], { allowFail: true }) === null)
    refuse('merge-not-canonical');
  const advertisement = options.observeRemote ? options.observeRemote(plan)
    : read(plan.root, ['ls-remote', '--refs', '--', plan.remoteUrl, 'refs/heads/main']);
  if (advertisement !== `${plan.canonical}\trefs/heads/main`) refuse('remote-main-drift');
}
function validatePlan(input) {
  const bytes = canonicalJson(input); if (Buffer.byteLength(bytes) > 64000) refuse('plan-size');
  const plan = JSON.parse(bytes);
  fields(plan, 'schema,mode,root,repository,remoteUrl,pr,requiredChecks,workflow,targetPath,branch,head,canonical,merge,review,inventoryDigest,inventoryContentEntries,policyDigest,observation,issuedAt,expiresAt,planDigest'
    + (plan.mode === RECOVERY_MODE ? ',integration,recoveryPolicy' : '')
    + (Object.hasOwn(plan, 'detachedHead') ? ',detachedHead' : '')
    + (Object.hasOwn(plan, 'reviewedEquivalentCommit') ? ',reviewedEquivalentCommit' : '')
    + (Object.hasOwn(plan, 'successor') ? ',successor' : '')
    + (Object.hasOwn(plan, 'mergedProjection') ? ',mergedProjection' : '')
    + (Object.hasOwn(plan, 'historicalCheckGap') ? ',historicalCheckGap' : '')
    + (Object.hasOwn(plan, 'changeClass') ? ',changeClass' : ''));
  reviewOptions(plan);
  const { planDigest, ...content } = plan;
  if (plan.schema !== SCHEMA || ![MODE, NO_CI_MODE, RECOVERY_MODE].includes(plan.mode) || governanceDigest(content) !== planDigest
    || typeof plan.root !== 'string' || typeof plan.targetPath !== 'string' || plan.targetPath === plan.root
    || !['head', 'canonical', 'merge'].every(k => /^[a-f0-9]{40}$/u.test(plan[k]))
    || !['policyDigest', 'inventoryDigest', 'planDigest'].every(k => /^[a-f0-9]{64}$/u.test(plan[k]))
    || !Number.isSafeInteger(plan.issuedAt) || !Number.isSafeInteger(plan.expiresAt)
    || plan.issuedAt < 0 || plan.expiresAt <= plan.issuedAt || plan.expiresAt - plan.issuedAt > 900000
    || (Object.hasOwn(plan, 'detachedHead') && (plan.mode !== RECOVERY_MODE
      || typeof plan.detachedHead !== 'string' || !/^[a-f0-9]{40}$/u.test(plan.detachedHead)))
    || (Object.hasOwn(plan, 'reviewedEquivalentCommit') && (plan.mode !== RECOVERY_MODE || !plan.detachedHead
      || !/^[a-f0-9]{40}$/u.test(plan.reviewedEquivalentCommit)))
    || (Object.hasOwn(plan, 'successor') && (plan.mode !== RECOVERY_MODE || plan.detachedHead
      || !plan.successor || Object.keys(plan.successor).sort().join(',') !== 'predecessorHead,predecessorRef,replacedPaths'
      || typeof plan.successor.predecessorRef !== 'string'
      || !/^[a-f0-9]{40}$/u.test(plan.successor.predecessorHead)
      || !Array.isArray(plan.successor.replacedPaths)))
    || (Object.hasOwn(plan, 'mergedProjection') && (plan.mode !== RECOVERY_MODE || plan.detachedHead || plan.successor || !plan.mergedProjection || Object.keys(plan.mergedProjection).sort().join(',') !== 'branch,head' || !isLaneRef(plan.mergedProjection.branch) || plan.mergedProjection.branch === plan.branch || plan.mergedProjection.head !== plan.merge))
    || (Object.hasOwn(plan, 'historicalCheckGap') && (!plan.historicalCheckGap || !plan.mergedProjection || !plan.review?.historicalCheckGap || plan.review.historicalCheckGap.checkRunsObserved !== 0 || !same(plan.review.historicalCheckGap.requiredChecks, plan.requiredChecks)))
    || plan.head !== plan.review?.head || plan.merge !== plan.review?.merge || plan.branch !== plan.review?.branch)
    refuse('plan-binding');
  return plan;
}
function locked(root, operation) {
  const lock = acquireOperationLock('agentic-os-worktree-cleanup', root); if (!lock) refuse('busy');
  let result, error;
  try { result = operation(); } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'user-cleanup', result, error, artifacts: error?.operationArtifacts ?? null });
}
const RETIRE_SCHEMA = 'agentic-os/quarantine-retirement-plan/v2';
const RETIRE_RESUME_SCHEMA = 'agentic-os/quarantine-retirement-plan/v3';
function retirementPrivateDirectory(path, label) { const id = pathIdentity(path, label), mode = Number(id.mode & 0o7777n), checked = mode === 0o700 ? privateDirectoryIdentity(path, label) : mode === 0o755 ? legacyPrivateDirectoryIdentity(path, label) : null; if (id.kind !== 'directory' || typeof process.getuid === 'function' && id.uid !== BigInt(process.getuid()) || !checked || checked.dev !== id.dev || checked.ino !== id.ino || checked.uid !== id.uid || checked.mode !== id.mode) refuse('retirement-registration'); return [String(id.dev), String(id.ino), String(id.uid), mode]; }
function retirementResumeFacts(root, common, coordinate, op, record, e, projection, registration, names) {
  const intentPath = join(op, 'retirement.intent.json'), intent = readUserCleanupJson(intentPath, 'retirement intent', privateDirectoryIdentity(op, 'cleanup operation')); let prior; try { fields(intent, 'authorizedAt,authorizationDigest,intentDigest,plan,planDigest,schema'); prior = intent.plan; fields(prior, 'authority,branch,branchTip,common,coordinate,eligibilityDigest,expiresAt,head,issuedAt,operationDigest,preservationReceiptDigest,projection,registration,registrationRoot,recoveryBytesDiscarded,retentionPolicy,root,schema,rootMode,planDigest'); } catch { refuse('retirement-state'); } const { planDigest, ...content } = prior;
  if (intent.schema !== 'agentic-os/quarantine-retirement-intent/v2' || governanceDigest(Object.fromEntries(Object.entries(intent).filter(([key]) => key !== 'intentDigest'))) !== intent.intentDigest || prior.schema !== RETIRE_SCHEMA || governanceDigest(content) !== planDigest || intent.planDigest !== planDigest || intent.authorizationDigest !== governanceDigest(`agentic-os:quarantine-retirement:${planDigest}`) || !Number.isSafeInteger(intent.authorizedAt) || intent.authorizedAt < prior.issuedAt || intent.authorizedAt >= prior.expiresAt) refuse('retirement-state');
  const registrationRoot = retirementPrivateDirectory(registration, 'retirement-registration'), projectionRoot = privateDirectoryIdentity(projection, 'retirement-projection'), expectedNames = ['operation.json','projection','registration','retirement.intent.json',...(names.includes('preservation.json') ? ['preservation.json'] : [])].sort();
  const headText = new TextDecoder('utf-8', { fatal: true }).decode(readBoundedStableFile(join(registration, 'HEAD'), 256, 'retirement-head')), log = new TextDecoder('utf-8', { fatal: true }).decode(readBoundedStableFile(join(registration, 'logs/HEAD'), 16 * 1024 ** 2, 'retirement-head-log')).trimEnd().split('\n').at(-1)?.split(' ') ?? [], head = /^0{40}(?:0{24})?$/u.test(log[1] ?? '') ? log[0] : log[1];
  if (!projectionRoot || (projectionRoot.mode & 0o7777n) !== 0o700n || !same(names, expectedNames) || prior.root !== root || prior.common !== common || prior.coordinate !== coordinate || prior.operationDigest !== governanceDigest(record) || prior.eligibilityDigest !== governanceDigest(e) || !Array.isArray(prior.registrationRoot) || prior.registrationRoot.length !== 4 || ![0o700, 0o755].includes(prior.registrationRoot[3]) || ![0o700, 0o755].includes(prior.rootMode) || prior.registrationRoot.slice(0, 3).some((value, index) => value !== registrationRoot[index]) || registrationRoot[3] !== 0o700 || !isLaneRef(prior.branch) || !/^[a-f0-9]{40}$/.test(prior.head) || !/^[a-f0-9]{40}$/.test(prior.branchTip) || headText !== `ref: refs/heads/${prior.branch}\n` || head !== prior.head || worktrees(root).some(row => row.branch === prior.branch) || read(root, ['rev-parse', '--verify', `refs/heads/${prior.branch}^{commit}`], { allowFail: true }) !== prior.branchTip || prior.preservationReceiptDigest !== (names.includes('preservation.json') ? governanceDigest(readUserCleanupJson(join(op, 'preservation.json'), 'retirement-preservation')) : null)) refuse('retirement-state');
  const projectionManifest = observeQuarantineManifest(projection, { byteCeiling: Math.max(e.projectionBytes, LIMITS.projectionByteCeiling), entryCeiling: Math.max(e.projectionEntries, LIMITS.projectionEntryCeiling), retainedHardlinks: true }), projectionTree = retirementTree(projection), registrationTree = retirementTree(registration);
  if (!sameRetirementTree(projectionTree, retirementTree(projection)) || !sameRetirementTree(registrationTree, retirementTree(registration))) refuse('retirement-drift');
  return { root: prior.root, common, coordinate, operationDigest: prior.operationDigest, eligibilityDigest: prior.eligibilityDigest, branch: prior.branch, head: prior.head, branchTip: prior.branchTip, projection: projectionManifest, registration: prior.registration, registrationRoot: prior.registrationRoot, preservationReceiptDigest: prior.preservationReceiptDigest, operationPath: op, projectionPath: projection, registrationPath: registration, rootMode: prior.rootMode, resumeIntentDigest: intent.intentDigest, residualTreeDigest: governanceDigest(projectionTree), residualRegistrationTreeDigest: governanceDigest(registrationTree) };
}
function retirementFacts(root, coordinate) {
  if (!/^[a-f0-9]{64}$/u.test(coordinate ?? '')) refuse('retirement-coordinate');
  const common = realpathSync(commonDir(root)), base = join(common, 'agentic-os-cleanup-quarantine'), op = join(base, coordinate);
  if (!privateDirectoryIdentity(base, 'cleanup quarantine') || !privateDirectoryIdentity(op, 'cleanup operation')) refuse('retirement-path');
  const record = readUserCleanupJson(join(op, 'operation.json'), 'retirement-operation'), e = record.eligibility, names = readdirSync(op).sort();
  if (record.schema !== 'agentic-os/worktree-quarantine-operation/v1' || e?.schema !== 'agentic-os/user-cleanup-eligibility/v1' || e.planDigest !== coordinate) refuse('retirement-schema');
  const projection = join(op, 'projection'), registration = join(op, 'registration'), registrationRoot = retirementPrivateDirectory(registration, 'retirement-registration'), decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (names.includes('retirement.intent.json')) return retirementResumeFacts(root, common, coordinate, op, record, e, projection, registration, names);
  const match = /^ref: refs\/heads\/(.+)\n$/u.exec(decode(readBoundedStableFile(join(registration, 'HEAD'), 256, 'retirement-head')));
  if (!match || !isLaneRef(match[1])) refuse('retirement-ref');
  const log = decode(readBoundedStableFile(join(registration, 'logs/HEAD'), 16 * 1024 ** 2, 'retirement-head-log')).trimEnd().split('\n').at(-1)?.split(' ') ?? [], head = /^0{40}(?:0{24})?$/u.test(log[1] ?? '') ? log[0] : log[1], evidence = observeRetainedQuarantineEvidence(root, match[1], head, coordinate);
  if (!evidence || worktrees(root).some(row => row.branch === match[1])) refuse('retirement-evidence');
  const stat = lstatSync(projection, { bigint: true }), mode = stat.mode & 0o7777n; if (!stat.isDirectory() || stat.isSymbolicLink() || typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid()) || ![0o700n, 0o755n].includes(mode)) refuse('retirement-projection');
  const expected = ['operation.json', 'projection', 'registration', ...(names.includes('preservation.json') ? ['preservation.json'] : [])].sort();
  if (!same(names, expected) || !same(registrationRoot, retirementPrivateDirectory(registration, 'retirement-registration'))) refuse('retirement-state');
  return { root, common, coordinate, operationDigest: governanceDigest(record), eligibilityDigest: governanceDigest(e), branch: match[1], head,
    branchTip: read(root, ['rev-parse', '--verify', `refs/heads/${match[1]}^{commit}`], { allowFail: true }), projection: evidence.projectionManifest,
    registration: evidence.registrationManifest, registrationRoot, preservationReceiptDigest: names.includes('preservation.json') ? governanceDigest(readUserCleanupJson(join(op, 'preservation.json'), 'retirement-preservation')) : null, operationPath: op, projectionPath: projection, registrationPath: registration, rootMode: Number(mode) };
}
function retirementTree(path) { const paths = [], visit = root => { for (const name of readdirSync(root).sort()) { const child = join(root, name), id = pathIdentity(child, 'retirement-tree'); paths.push(child); if (id.kind === 'directory') visit(child); } }; visit(path); return paths.map(value => retirementIdentity(pathIdentity(value, 'retirement-tree'))); }
const retirementIdentity = id => [id.path, id.kind, id.dev, id.ino, id.mode, id.nlink, id.size, id.uid, id.mtimeNs, id.ctimeNs].map(String); function sameRetirementTree(left, right) { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((row, index) => Array.isArray(row) && Array.isArray(right[index]) && row.length === right[index].length && row.every((value, field) => value === right[index][field])); }
export function planQuarantineRetirement({ cwd = process.cwd(), coordinate, now = Date.now } = {}) {
  const root = realpathSync(repoRoot(cwd)); if (currentBranch(root) !== 'main' || read(root, ['status', '--porcelain', '--untracked-files=all'])) refuse('retirement-controller');
  return locked(root, () => { const facts = retirementFacts(root, coordinate), time = now(); if (!Number.isSafeInteger(time)) refuse('retirement-clock');
    const payload = { schema: facts.resumeIntentDigest ? RETIRE_RESUME_SCHEMA : RETIRE_SCHEMA, authority: 'explicit-local-user-consent', ...Object.fromEntries(Object.entries(facts).filter(([key]) => !['operationPath','projectionPath','registrationPath'].includes(key))), retentionPolicy: 'manual-per-coordinate-no-age-eviction', recoveryBytesDiscarded: true, issuedAt: time, expiresAt: time + 900000 };
    return { ...payload, planDigest: governanceDigest(payload) }; });
}
export function applyQuarantineRetirement(plan, { cwd = process.cwd(), authorization, stopped, discardRecovery, now = Date.now, probe = path => { try { execFileSync('lsof', ['-t', '+D', path], { timeout: 120000, stdio: ['ignore','pipe','pipe'] }); refuse('retirement-open-files'); } catch (error) { if (error.reason) throw error; if (error.status !== 1 || error.stderr?.length) refuse('retirement-open-scan'); } } } = {}) {
  const resume = plan?.schema === RETIRE_RESUME_SCHEMA;
  fields(plan, 'authority,branch,branchTip,common,coordinate,eligibilityDigest,expiresAt,head,issuedAt,operationDigest,preservationReceiptDigest,projection,registration,registrationRoot,recoveryBytesDiscarded,retentionPolicy,root,schema,rootMode,planDigest' + (resume ? ',residualRegistrationTreeDigest,residualTreeDigest,resumeIntentDigest' : ''));
  const root = realpathSync(repoRoot(cwd)), { planDigest, ...body } = plan;
  if ((!resume && body.schema !== RETIRE_SCHEMA) || !/^[a-f0-9]{64}$/u.test(planDigest ?? '') || !Number.isSafeInteger(body.issuedAt) || !Number.isSafeInteger(body.expiresAt) || body.expiresAt - body.issuedAt !== 900000 || root !== body.root || governanceDigest(body) !== planDigest || authorization !== `agentic-os:quarantine-retirement:${planDigest}` || stopped !== true || discardRecovery !== true) refuse('retirement-authorization');
  if (currentBranch(root) !== 'main' || read(root, ['status', '--porcelain', '--untracked-files=all'])) refuse('retirement-controller');
  return locked(root, () => { const facts = retirementFacts(root, body.coordinate), expected = { ...body }; delete expected.issuedAt; delete expected.expiresAt;
    const observed = { ...facts }; ['operationPath','projectionPath','registrationPath'].forEach(key => delete observed[key]);
    const time = now(); if (!Number.isSafeInteger(time) || time < body.issuedAt || time >= body.expiresAt) refuse('retirement-expired');
    if (Object.keys(expected).some(key => !same(expected[key], key === 'schema' ? body.schema : key === 'authority' ? 'explicit-local-user-consent' : key === 'retentionPolicy' ? 'manual-per-coordinate-no-age-eviction' : key === 'recoveryBytesDiscarded' ? true : observed[key]))) refuse('retirement-drift');
    const projectionTree = retirementTree(facts.projectionPath), registrationTree = retirementTree(facts.registrationPath); probe(facts.projectionPath); probe(facts.registrationPath);
    const fresh = retirementFacts(root, body.coordinate); if (!same(fresh.projection, body.projection) || !same(fresh.registration, body.registration) || !same(fresh.registrationRoot, body.registrationRoot) || fresh.preservationReceiptDigest !== body.preservationReceiptDigest || fresh.operationDigest !== body.operationDigest || fresh.branchTip !== body.branchTip || resume && (fresh.resumeIntentDigest !== body.resumeIntentDigest || fresh.residualTreeDigest !== body.residualTreeDigest || fresh.residualRegistrationTreeDigest !== body.residualRegistrationTreeDigest) || !sameRetirementTree(projectionTree, retirementTree(facts.projectionPath)) || !sameRetirementTree(registrationTree, retirementTree(facts.registrationPath))) refuse('retirement-drift'); const intentPath = join(facts.operationPath, 'retirement.intent.json'), receiptPath = join(facts.operationPath, 'retirement.json'), priorIntent = resume ? readUserCleanupJson(intentPath, 'retirement intent', privateDirectoryIdentity(facts.operationPath, 'cleanup operation')) : null; if (Boolean(lstatSync(intentPath, { throwIfNoEntry: false })) !== resume || lstatSync(receiptPath, { throwIfNoEntry: false })) refuse('retirement-state');
    const intentContent = { schema: 'agentic-os/quarantine-retirement-intent/v2', planDigest, plan, authorizationDigest: governanceDigest(authorization), authorizedAt: time }, intent = resume ? priorIntent : { ...intentContent, intentDigest: governanceDigest(intentContent) }; if (!resume) writePrivateFileExclusive(intentPath, Buffer.from(canonicalJson(intent)), { maxBytes: 64000, label: 'retirement intent' });
    try { if (!resume && !same(retirementPrivateDirectory(facts.registrationPath, 'retirement registration'), body.registrationRoot)) refuse('retirement-registration-drift');
      if (!resume && body.registrationRoot[3] === 0o755) tightenLegacyPrivateDirectory(facts.registrationPath, 'retirement registration', { onTightenAttempt: e => { if (e.dev !== body.registrationRoot[0] || e.ino !== body.registrationRoot[1]) refuse('retirement-registration-drift'); } }); const privateRegistration = privateDirectoryIdentity(facts.registrationPath, 'retirement registration'); if (!privateRegistration || [String(privateRegistration.dev), String(privateRegistration.ino), String(privateRegistration.uid)].some((value, index) => value !== body.registrationRoot[index]) || (privateRegistration.mode & 0o7777n) !== 0o700n || !sameRetirementTree(registrationTree, retirementTree(facts.registrationPath))) refuse('retirement-registration-drift'); if (!resume && facts.rootMode === 0o755) tightenLegacyPrivateDirectory(facts.projectionPath, 'retirement projection'); const tightenedTree = retirementTree(facts.projectionPath); if (!sameRetirementTree(projectionTree, tightenedTree)) refuse('retirement-tree-drift'); const rootId = privateDirectoryIdentity(facts.projectionPath, 'retirement projection'), entries = captureExactTree(rootId, tightenedTree.map(row => row[0]), 'retirement projection');
      if (!sameRetirementTree(tightenedTree, entries.map(retirementIdentity))) refuse('retirement-tree-drift'); removeExactTree(rootId, entries, 'retirement projection');
      if (!sameRetirementTree(registrationTree, retirementTree(facts.registrationPath)) || read(root, ['rev-parse', '--verify', `refs/heads/${facts.branch}^{commit}`], { allowFail: true }) !== body.branchTip) refuse('retirement-registration-drift');
      const receipt = { schema: 'agentic-os/quarantine-retirement-receipt/v2', planDigest, coordinate: body.coordinate, receiptPath,
        authorizationDigest: intent.authorizationDigest, ...(resume ? { originalPlanDigest: priorIntent.planDigest, originalIntentDigest: priorIntent.intentDigest, resumeAuthorizationDigest: governanceDigest(authorization), resumedLogicalBytesUnlinked: body.projection.bytes } : {}), branch: body.branch, retainedHead: body.head, branchTip: body.branchTip, operationDigest: body.operationDigest, eligibilityDigest: body.eligibilityDigest,
        logicalBytesUnlinked: resume ? priorIntent.plan.projection.bytes : body.projection.bytes, recoveryBytesDiscarded: true, stoppedAcknowledged: true, bytesDeleted: true, projectionRootModeBefore: body.rootMode,
        projectionRootPermissionsTightened: body.rootMode === 0o755, registrationRootModeBefore: body.registrationRoot[3], registrationRootPermissionsTightened: body.registrationRoot[3] === 0o755, physicalFreeSpaceIncreaseProven: false, registrationRetained: true,
        branchRefsMutated: false, objectDatabaseMutated: false, providerAuthority: false, claimRetired: false,
        operatingSystemExclusivityProven: false, executedAt: time };
      const signed = { ...receipt, receiptDigest: governanceDigest(receipt) }; writePrivateFileExclusive(receiptPath, Buffer.from(canonicalJson(signed)), { maxBytes: 64000, label: 'retirement receipt' }); unlinkExactPath(pathIdentity(intentPath, 'retirement intent'), 'retirement intent'); return signed;
    } catch (error) { Object.assign(error, { operationArtifacts: { intentPath, receiptPath, planDigest, effectMayBePartial: true } }); throw error; }
  });
}
export function planUserCleanup({ cwd = process.cwd(), target, pr, requiredChecks, workflow,
  noCI = false, recovery = false, detached = false, mergedProjection = false, historicalCheckGap = false, changeClass = undefined, successor = undefined,
  reviewedEquivalentCommit = undefined }, options = {}) {
  const policyResolver = options.resolvePolicy ?? null;
  if (noCI && recovery) refuse('incompatible-modes');
  if (typeof detached !== 'boolean' || detached && !recovery) refuse('detached-recovery-required');
  if (typeof mergedProjection !== 'boolean' || mergedProjection && (!recovery || detached || successor)) refuse('merged-projection-options');
  if (typeof historicalCheckGap !== 'boolean' || historicalCheckGap && (!recovery || !mergedProjection)) refuse('historical-check-gap-options');
  if (reviewedEquivalentCommit !== undefined && (!recovery || !detached || successor || !/^[a-f0-9]{40}$/u.test(reviewedEquivalentCommit))) refuse('equivalent-options');
  if (recovery && changeClass !== undefined) refuse('incompatible-modes');
  if (successor && (!recovery || detached || typeof successor.predecessorRef !== 'string'
    || !/^[a-f0-9]{40}$/u.test(successor.predecessorHead ?? '')))
    refuse('successor-options');
  if (changeClass !== undefined && !SUPPORTED_CHANGE_CLASSES.includes(changeClass)) refuse('unsupported-change-class');
  const root = realpathSync(repoRoot(cwd));
  const mode = recovery ? RECOVERY_MODE : noCI ? NO_CI_MODE : MODE;
  reviewOptions({ repository: 'placeholder/repository', pr, requiredChecks, workflow, mode });
  return locked(root, () => {
    const current = resolvePolicy(root, mode, policyResolver, { changeClass }), targetPath = realpathSync(target);
    refuseUnknownLaneBytes(targetPath, root);
    if (recovery && current.requiredChecks.some(name => !requiredChecks.includes(name))) refuse('profile-checks-missing');
    if (targetPath !== target || targetPath === root || lstatSync(target).isSymbolicLink()) refuse('target-path');
    const review = observeMergedReview({ ...current, pr, requiredChecks, workflow, historicalCheckGap }, { cwd: root, ...options });
    if (read(target, ['status', '--porcelain', '--untracked-files=all'])) refuse('target-not-clean');
    const inventory = collectRecoveryInventory({ cwd: target, canonicalRef: 'refs/heads/main',
      allowDetached: detached, maxContentEntries: options.maxContentEntries ?? (recovery ? RECOVERY_LIMITS : LIMITS).projectionEntryCeiling });
    if (successor && (inventory.branch !== successor.predecessorRef
      || inventory.headRevision !== successor.predecessorHead)) refuse('successor-target-drift');
    if (detached && inventory.branch !== null) refuse('target-not-detached');
    if (mergedProjection && (!isLaneRef(inventory.branch) || inventory.branch === review.branch || inventory.headRevision !== review.merge)) refuse('merged-projection-target');
    if (inventory.inventoryEntries.hidden || inventory.inventoryEntries.visibleUntracked) refuse('hidden-or-untracked-work');
    const observedChangeClass = classifyLaneChangeClass(targetPath);
    const changeClassInfo = resolveChangeClass(changeClass, observedChangeClass);
    const issuedAt = options.now?.() ?? Date.now();
    const plan = { schema: SCHEMA, mode, root, repository: current.repository, remoteUrl: current.remoteUrl,
      pr, requiredChecks, workflow, targetPath, branch: review.branch, head: review.head, canonical: current.canonical,
      merge: review.merge, review, inventoryDigest: governanceDigest(inventory),
      inventoryContentEntries: inventory.inventoryEntries.content, policyDigest: governanceDigest(current),
      observation: null, issuedAt, expiresAt: issuedAt + 900000,
      ...(detached ? { detachedHead: inventory.headRevision } : {}),
      ...(reviewedEquivalentCommit ? { reviewedEquivalentCommit } : {}),
      ...(successor ? { successor: { predecessorRef: successor.predecessorRef,
        predecessorHead: successor.predecessorHead, replacedPaths: successor.replacedPaths } } : {}),
      ...(mergedProjection ? { mergedProjection: { branch: inventory.branch, head: inventory.headRevision } } : {}),
      ...(historicalCheckGap ? { historicalCheckGap: true } : {}),
      ...(changeClassInfo.declared ? { changeClass: changeClassInfo } : {}) };
    if (recovery) Object.assign(plan, { integration: recoveryIntegration(plan, read), recoveryPolicy: current });
    mergedState(plan, options, review);
    plan.observation = observeWorktreeCleanupTarget(mechanics(plan), { cwd: root,
      observePolicy: (configured, configuredRoot) => observePolicy(configured, configuredRoot, policyResolver) });
    plan.planDigest = governanceDigest(plan);
    return validatePlan(plan);
  });
}
export function planRecoveryCleanupFromLane({ cwd = process.cwd(), ref } = {}, options = {}) {
  const root = realpathSync(repoRoot(cwd));
  if (!isLaneRef(ref)) refuse('recovery-lane-ref');
  const current = resolvePolicy(root, RECOVERY_MODE, options.resolvePolicy ?? null), record = get(ref, root);
  if (!record || !['published', 'queued', 'integrated'].includes(record.state) || !Number.isSafeInteger(record.pr) || record.pr < 1
    || typeof record.worktree !== 'string' || !/^[a-f0-9]{40}$/u.test(record.head ?? ''))
    refuse('recovery-lane-binding');
  let targetPath; try { targetPath = realpathSync(record.worktree); } catch { refuse('recovery-lane-target'); }
  if (targetPath !== record.worktree || currentBranch(targetPath) !== ref || read(targetPath, ['rev-parse', '--verify', 'HEAD']) !== record.head) refuse('recovery-lane-binding');
  const requiredChecks = [...current.requiredChecks].sort(), workflow = inferMergedReviewWorkflow({ repository: current.repository, pr: record.pr, requiredChecks }, { cwd: root, ...options });
  const plan = planUserCleanup({ cwd: root, target: targetPath, pr: record.pr, requiredChecks, workflow, recovery: true }, options);
  if (plan.targetPath !== targetPath || plan.pr !== record.pr || plan.branch !== ref || plan.head !== record.head) refuse('recovery-lane-binding');
  return plan;
}
export function applyUserCleanup(input, { cwd = process.cwd(), authorization, stopped, now = Date.now, ...options } = {}) {
  const plan = validatePlan(input), root = realpathSync(repoRoot(cwd));
  const policyResolver = options.resolvePolicy ?? null;
  if (root !== plan.root || authorization !== `agentic-os:user-cleanup:${plan.planDigest}` || stopped !== true)
    refuse('explicit-authorization-required');
  return locked(root, () => {
    refuseUnknownLaneBytes(plan.targetPath, root);
    const m = mechanics(plan), eligible = eligibility(plan);
    observePolicy(m, root, policyResolver); mergedState(plan, options);
    if (plan.mode === RECOVERY_MODE && (!same(resolvePolicy(root, plan.mode, policyResolver), plan.recoveryPolicy)
      || plan.recoveryPolicy.requiredChecks.some(name => !plan.requiredChecks.includes(name)))) refuse('recovery-policy-drift');
    const configuredObservePolicy = (configured, configuredRoot) =>
      observePolicy(configured, configuredRoot, policyResolver);
    let applied = classifyExistingWorktreeQuarantine(m, eligible, {
      cwd: root, observePolicy: configuredObservePolicy,
    });
    if (!applied) {
      if (now() < plan.issuedAt || now() >= plan.expiresAt) refuse('expired');
      if (read(plan.targetPath, ['status', '--porcelain', '--untracked-files=all'])) refuse('target-not-clean');
      const before = observeWorktreeCleanupTarget(m, {
        cwd: root, observePolicy: configuredObservePolicy,
      });
      if (!same(before, plan.observation)) refuse('observation-drift');
      try {
        applied = quarantineWorktreeTarget(m, before, {
          cwd: root, eligibility: eligible, observePolicy: configuredObservePolicy,
          authorizeEffects() {
            const time = now(); if (time < plan.issuedAt || time >= plan.expiresAt) refuse('expired');
            observePolicy(m, root, policyResolver); return new Date(time).toISOString();
          } });
      } catch (error) {
        Object.assign(error, { retainedOperation: true, operationResult: null,
          operationError: { reason: error.reason ?? null, message: error.message },
          operationArtifacts: { ...error.operationArtifacts, effectsRetained: true, planDigest: plan.planDigest,
            targetPath: plan.targetPath, mode: plan.mode } }); throw error;
      }
    }
    return { schema: 'agentic-os/user-cleanup-receipt/v1', mode: plan.mode, planDigest: plan.planDigest,
      authority: 'explicit-local-user-consent', providerAuthority: false, protectionProven: false, claimRetired: false,
      selectedChecksVerified: plan.mode !== NO_CI_MODE && !plan.historicalCheckGap, noCI: plan.mode === NO_CI_MODE,
      ...(plan.changeClass?.fastPath ? { changeClass: plan.changeClass, authorityTerminalState: 'local-consent' } : {}),
      ...(plan.mode === RECOVERY_MODE ? { recoveryPolicy: plan.recoveryPolicy, integration: plan.integration,
        historicalIntegrationMethodProven: false, ...(plan.reviewedEquivalentCommit ? { sourceIntegrated: false, historicalDraft: 'superseded' } : {}) } : {}),
      localPolicyDigest: plan.policyDigest, stoppedAcknowledged: true, canonicalRevision: plan.canonical,
      review: plan.review, ...(plan.detachedHead ? { detachedHead: plan.detachedHead } : {}),
      ...(plan.mergedProjection ? { mergedProjection: plan.mergedProjection } : {}),
      ...(plan.historicalCheckGap ? { historicalCheckGap: { ...plan.review.historicalCheckGap, requiredChecks: [...plan.review.historicalCheckGap.requiredChecks] } } : {}),
      ...(plan.successor ? { successor: plan.successor } : {}),
      ...applied.result, ...applied.artifacts, result: 'quarantined',
      bytesDeleted: false, branchesMutated: false, objectsMutated: false, operatingSystemExclusivityProven: false };
  });
}
const UNIFIED_MODE_FLAGS = Object.freeze({ 'local-consent': [], recovery: ['--recovery'], 'no-ci': [] });
export function runUnifiedCleanup(root, argv, out = console.log) {
  if (!['plan', 'apply', 'sweep', 'retire'].includes(argv[0])) refuse('cleanup-arguments', 'usage: cleanup <plan|apply|sweep|retire> [options]');
  return runUserCleanup(root, argv, out, { unified: true });
}
export function runUserCleanup(root, argv, out = console.log, { unified = false } = {}) {
  if (argv[0] === 'retire') {
    if (argv[1] === 'plan' && argv.length === 3 && argv[2].startsWith('--coordinate=')) out(canonicalJson(planQuarantineRetirement({ cwd: root, coordinate: option(argv, 'coordinate') })));
    else if (argv[1] === 'apply' && argv.length === 6 && argv[2].startsWith('--plan=') && argv[3].startsWith('--authorize=') && argv[4] === '--stopped' && argv[5] === '--discard-recovery') out(canonicalJson(applyQuarantineRetirement(readUserCleanupJson(option(argv, 'plan'), 'retirement-plan'), { cwd: root, authorization: option(argv, 'authorize'), stopped: true, discardRecovery: true })));
    else refuse('retirement-arguments', 'usage: cleanup-user retire plan --coordinate=<digest> | apply --plan=<file> --authorize=<token> --stopped --discard-recovery');
    return 0;
  }
  if (['preservation-plan', 'preservation-apply'].includes(argv[0])) {
    const planning = argv[0] === 'preservation-plan';
    const input = readUserCleanupJson(option(argv, planning ? 'adoption' : 'plan'), planning ? 'preservation-adoption' : 'preservation-plan');
    if (planning && input.adoption) fields(input, 'adoption,originalReceipt');
    const result = planning ? planSuccessorPreservation({ cwd: root, adoption: input.adoption ?? input,
      originalReceipt: input.originalReceipt, policyRoot: option(argv, 'policy-root'), workflow: option(argv, 'workflow') })
      : applySuccessorPreservation(input, { cwd: root, authorization: option(argv, 'authorize'), stopped: argv.includes('--stopped') });
    out(canonicalJson(result)); return 0;
  }
  if (argv[0] === 'sweep') return runUserCleanupSweep(root, argv, out);
  if (argv[0] === 'plan') {
    const modeFlag = unified ? option(argv, 'mode') || 'local-consent' : null;
    if (unified && !Object.hasOwn(UNIFIED_MODE_FLAGS, modeFlag)) refuse('cleanup-arguments', `unknown mode ${modeFlag}`);
    const recovery = modeFlag === 'recovery' || (!unified && argv.includes('--recovery'));
    const ref = option(argv, 'ref');
    if (ref !== null) {
      if (!recovery) refuse('recovery-lane-mode');
      out(canonicalJson(planRecoveryCleanupFromLane({ cwd: root, ref })));
      return 0;
    }
    const noCI = modeFlag === 'no-ci', pr = Number(option(argv, 'pr'));
    const changeClass = option(argv, 'change-class') || undefined;
    const plan = planUserCleanup({ cwd: root, target: option(argv, 'target'), pr,
      requiredChecks: noCI ? [] : unified && !option(argv, 'checks') ? [] : option(argv, 'checks').split(','),
      workflow: noCI ? null : option(argv, 'workflow'), noCI,
      recovery, detached: argv.includes('--detached'),
      mergedProjection: argv.includes('--merged-projection'),
      historicalCheckGap: argv.includes('--historical-check-gap'),
      reviewedEquivalentCommit: option(argv, 'reviewed-equivalent-commit') || undefined,
      changeClass });
    out(canonicalJson(plan)); return 0;
  }
  const plan = readUserCleanupJson(option(argv, 'plan'), 'user-cleanup-plan');
  out(canonicalJson(applyUserCleanup(plan, { cwd: root, authorization: option(argv, 'authorize'), stopped: argv.includes('--stopped') })));
  return 0;
}
const SWEEP_SCHEMA = 'agentic-os/user-cleanup-sweep/v1';
const SWEEP_LIMIT = 256;
const sweepRefFormat = '%(refname:short)%09%(objectname)%09%(objecttype)%09%(committerdate:unix)';
export function projectUserCleanupSweep({ refs, mergedBranches, activeBranches, staleDays, now = Date.now() }) {
  if (!Array.isArray(refs) || !Array.isArray(mergedBranches) || !Array.isArray(activeBranches))
    refuse('sweep-inventory-shape');
  if (refs.length > SWEEP_LIMIT || mergedBranches.length > SWEEP_LIMIT) refuse('lane-inventory-over-budget');
  if (!Number.isSafeInteger(staleDays) || staleDays < 0) refuse('stale-days-invalid');
  if (!Number.isSafeInteger(now)) refuse('sweep-clock-invalid');
  const merged = new Set(mergedBranches), active = new Set(activeBranches), seen = new Set();
  if (merged.size !== mergedBranches.length || mergedBranches.some(branch => !isLaneRef(branch)))
    refuse('sweep-merged-inventory');
  const staleThreshold = staleDays > 0 ? now - staleDays * 86400000 : 0;
  const candidates = [];
  for (const row of refs) {
    if (typeof row !== 'string') refuse('sweep-ref-shape');
    const fields = row.split('\t');
    if (fields.length !== 4) refuse('sweep-ref-shape');
    const [branch, head, type, rawTime] = fields;
    if (!isLaneRef(branch) || seen.has(branch) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(head)
      || type !== 'commit' || !/^-?\d+$/u.test(rawTime)) refuse('sweep-ref-shape');
    seen.add(branch);
    const commitMs = Number(rawTime) * 1000;
    if (!Number.isSafeInteger(commitMs) || !Number.isFinite(new Date(commitMs).getTime())) refuse('sweep-commit-time');
    const isMerged = merged.has(branch), mounted = active.has(branch);
    const stale = staleDays > 0 ? commitMs < staleThreshold : true;
    if (!stale) continue;
    candidates.push({ branch, head, merged: isMerged, stale, mounted,
      commitTime: new Date(commitMs).toISOString() });
  }
  if (mergedBranches.some(branch => !seen.has(branch))) refuse('sweep-ref-drift');
  return candidates;
}
export function observeUserCleanupSweep(root, { staleDays, requireMerged = false,
  requireNoActiveWorktree = false, now = Date.now, observeLines = observeGitLines,
  listWorktrees = worktrees, observePolicy = cwd => policy(cwd, MODE) } = {}) {
  if (!Number.isSafeInteger(staleDays) || staleDays < 0) refuse('stale-days-invalid');
  const current = observePolicy(root), canonical = current.canonical;
  const refs = observeLines(['for-each-ref', `--format=${sweepRefFormat}`, '--count=257', 'refs/heads/agent'], { cwd: root });
  if (refs.length > SWEEP_LIMIT) refuse('lane-inventory-over-budget');
  const mergedBranches = observeLines(['for-each-ref', `--merged=${canonical}`,
    '--format=%(refname:short)', '--count=257', 'refs/heads/agent'], { cwd: root });
  if (mergedBranches.length > SWEEP_LIMIT) refuse('lane-inventory-over-budget');
  const activeBranches = listWorktrees(root).map(row => row.branch).filter(Boolean);
  const candidates = projectUserCleanupSweep({ refs, mergedBranches, activeBranches, staleDays, now: now() })
    .filter(candidate => !requireMerged || candidate.merged)
    .filter(candidate => !requireNoActiveWorktree || !candidate.mounted);
  return { current, candidates };
}
function runUserCleanupSweep(root, argv, out = console.log) {
  const staleDays = Number(option(argv, 'stale-older-than') ?? '0');
  const requireMerged = argv.includes('--merged');
  const requireNoActiveWorktree = argv.includes('--no-active-worktree');
  const { current, candidates } = observeUserCleanupSweep(root, { staleDays, requireMerged, requireNoActiveWorktree });
  const canonical = current.canonical;
  const sweep = {
    schema: SWEEP_SCHEMA, observationOnly: true, authorizesEffects: false,
    repository: current.repository, canonicalRevision: canonical,
    staleOlderThanDays: staleDays, requireMerged, requireNoActiveWorktree,
    candidateCount: candidates.length, candidates,
    authority: 'explicit-local-user-consent', providerAuthority: false,
    nextAction: candidates.length > 0
      ? 'For each candidate, run cleanup-user plan --target=<worktree-path> --change-class=<class> then apply with --authorize=<plan-digest> --stopped'
      : 'no stale lane refs match the sweep criteria',
  };
  out(canonicalJson(sweep));
  return 0;
}
function preservationPolicy(root) {
  root = realpathSync(repoRoot(root));
  const trust = loadRepositoryTrust(root), revision = read(root, ['rev-parse', 'refs/heads/main']);
  if (trust.canonical.localRef !== 'refs/heads/main' || trust.canonical.remoteRef !== 'refs/remotes/origin/main'
    || read(root, ['symbolic-ref', '--quiet', 'HEAD']) !== trust.canonical.localRef
    || read(root, ['rev-parse', 'HEAD']) !== revision
    || read(root, ['rev-parse', 'refs/remotes/origin/main']) !== revision
    || read(root, ['status', '--porcelain', '--untracked-files=all'])) refuse('preservation-policy-canonical');
  const bytes = read(root, ['show', `${revision}:.agentic-os/github-transition-policy.json`]);
  const policy = validateGitHubTransitionPolicy(JSON.parse(bytes));
  if (policy.authorityRepository !== trust.repository || policy.authorityRef !== 'refs/heads/main')
    refuse('preservation-policy-trust');
  return { root, revision, repository: trust.repository, policy };
}
function preservationObservation(root, adoption, policyRoot, workflow, options = {}) {
  const current = policy(root, RECOVERY_MODE), authority = preservationPolicy(policyRoot);
  selectPreservationAdoption(authority.policy, adoption);
  if (adoption.repository !== `github.com/${current.repository}`) refuse('preservation-repository');
  const retained = adoption.schema === 'agentic-os/current-quarantine-adoption/v1';
  const refs = retained ? [adoption.targetRef, adoption.targetRef] : [adoption.predecessorRef, adoption.successorRef];
  if (refs.some(ref => !isLaneRef(ref)) || !retained && refs[0] === refs[1]) refuse('preservation-refs');
  const peers = worktrees(root), cacheDigest = governanceDigest(refs.map(ref => get(ref, root)));
  if (peers.some(peer => refs.includes(peer.branch))) refuse('preservation-mounted');
  const heads = refs.map(ref => read(root, ['rev-parse', '--verify', `refs/heads/${ref}^{commit}`]));
  if (heads[0] !== (retained ? adoption.targetHead : adoption.predecessorHead)
    || heads[1] !== (retained ? adoption.targetHead : adoption.successorHead))
    refuse('preservation-head-drift');
  const direct = retained ? exactCurrentIntegrationProof(adoption.merge, heads[0], { cwd: root }) : null;
  const integration = retained ? direct && { kind: 'current-quarantined', predecessorHead: heads[0], reviewedHead: heads[1],
    merge: adoption.merge, pathCount: direct.pathCount, replacements: [] }
    : successorIntegrationProof(adoption.merge, heads[0], heads[1], adoption.replacedPaths, { cwd: root });
  if (!integration || read(root, ['merge-base', '--is-ancestor', adoption.merge, current.canonical], { allowFail: true }) === null)
    refuse('preservation-integration');
  const review = options.localReview ?? observeMergedReview({ repository: current.repository,
    pr: Number(adoption.reviewLocator.split('/').at(-1)), requiredChecks: current.requiredChecks,
    workflow, mode: RECOVERY_MODE }, { cwd: root, ...options });
  if (review.url !== adoption.reviewLocator || review.head !== heads[1]
    || review.branch !== refs[1] || review.merge !== adoption.merge) refuse('preservation-review');
  const observed = observeRetainedQuarantineEvidence(root, refs[1], heads[1], adoption.quarantineCoordinate,
    retained ? { originalReceipt: options.originalReceipt, canonicalRef: current.localRef } : {});
  const retention = observed && retained ? { ...observed, originalReceipt: options.originalReceipt } : observed;
  if (!retention) refuse('preservation-retention');
  if (retained && retention.originalReceiptDigest !== adoption.originalReceiptDigest) refuse('preservation-original-receipt');
  if (!same(current, policy(root, RECOVERY_MODE)) || !same(authority, preservationPolicy(policyRoot))
    || !same(peers, worktrees(root)) || cacheDigest !== governanceDigest(refs.map(ref => get(ref, root)))
    || refs.some((ref, index) => read(root, ['rev-parse', `refs/heads/${ref}`]) !== heads[index]))
    refuse('preservation-observation-race');
  const state = { root, policyRoot: authority.root, policyRevision: authority.revision,
    policyRepository: authority.repository, workflow, predecessorHead: heads[0], successorHead: heads[1],
    peerRegistrationDigest: governanceDigest(peers), cacheDigest };
  return { repository: adoption.repository, canonicalRevision: current.canonical,
    profileDigest: current.repositoryProfileDigest, policyDigest: governanceDigest(authority.policy),
    review, integration, retention, state };
}
export function planSuccessorPreservation({ cwd = process.cwd(), adoption, originalReceipt, policyRoot, workflow }, options = {}) {
  const root = realpathSync(repoRoot(cwd)), issued = (options.now ?? Date.now)();
  const retained = adoption.schema === 'agentic-os/current-quarantine-adoption/v1';
  const facts = preservationObservation(root, adoption, policyRoot, workflow, { ...options, originalReceipt });
  const payload = { schema: retained ? CURRENT_QUARANTINE_PLAN_SCHEMA : SUCCESSOR_PRESERVATION_PLAN_SCHEMA,
    disposition: retained ? 'current-quarantine-retained' : 'successor-preserved',
    adoption, adoptionDigest: governanceDigest(adoption), ...facts,
    issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 900000).toISOString(),
    physicalCleanupPerformed: false, providerAuthority: false, claimRetired: false,
    [retained ? 'historicalQuarantineAuthorityProven' : 'historicalSuccessionAuthorityProven']: false };
  return validateRetentionDispositionPlan({ ...payload, planDigest: governanceDigest(payload) });
}
function preservationCarrier(root, planDigest) {
  return join(realpathSync(commonDir(root)), 'agentic-os-cleanup-quarantine', planDigest, 'preservation.json');
}
function readPreservationCarrier(path) {
  const base = privateDirectoryIdentity(dirname(dirname(path)), 'preservation base');
  const parent = privateDirectoryIdentity(dirname(path), 'preservation directory');
  if (!base || !parent) refuse('preservation-carrier');
  const stored = readUserCleanupJson(path, 'preservation-carrier', parent);
  assertPrivateDirectoryIdentity(base, 'preservation base');
  return stored;
}
export function verifySuccessorPreservation(root, input, options = {}) {
  const receipt = validateRetentionDispositionReceipt(input);
  const { planDigest, planIssuedAt, ...planState } = receipt.state;
  const { receiptDigest, ...content } = receipt;
  validateRetentionDispositionPlan({ ...content, schema: receipt.disposition === 'current-quarantine-retained'
    ? CURRENT_QUARANTINE_PLAN_SCHEMA : SUCCESSOR_PRESERVATION_PLAN_SCHEMA,
    state: planState, issuedAt: planIssuedAt, planDigest });
  if (!/^[a-f0-9]{64}$/u.test(planDigest ?? '')) refuse('preservation-carrier');
  const stored = readPreservationCarrier(preservationCarrier(root, planDigest));
  if (!same(receipt, stored)) refuse('preservation-carrier');
  const facts = preservationObservation(root, receipt.adoption, receipt.state.policyRoot, receipt.state.workflow,
    { ...options, originalReceipt: receipt.retention.originalReceipt, ...(options.localOnly ? { localReview: receipt.review } : {}) });
  for (const name of Object.keys(facts)) {
    const expected = name === 'state' ? { ...facts.state, planDigest, planIssuedAt } : facts[name];
    if (!same(receipt[name], expected)) refuse('preservation-drift');
  }
  if (!same(receipt, readPreservationCarrier(preservationCarrier(root, planDigest)))) refuse('preservation-carrier');
  return receipt;
}
export function applySuccessorPreservation(input, { cwd = process.cwd(), authorization, stopped, ...options } = {}) {
  const plan = validateRetentionDispositionPlan(input), root = realpathSync(repoRoot(cwd));
  options.originalReceipt = plan.retention.originalReceipt;
  if (root !== plan.state.root || stopped !== true
    || authorization !== `agentic-os:successor-preservation:${plan.planDigest}`) refuse('preservation-authorization');
  delete options.localOnly; delete options.localReview;
  return locked(root, () => {
    const path = preservationCarrier(root, plan.planDigest);
    const base = privateDirectoryIdentity(dirname(dirname(path)), 'preservation base');
    if (!base) refuse('preservation-carrier');
    if (lstatSync(path, { throwIfNoEntry: false })) {
      const stored = readPreservationCarrier(path);
      if (stored.state?.planDigest !== plan.planDigest || stored.state?.planIssuedAt !== plan.issuedAt)
        refuse('preservation-replay-plan');
      const verified = verifySuccessorPreservation(root, stored, options);
      assertPrivateDirectoryIdentity(base, 'preservation base');
      return verified;
    }
    const now = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < Date.parse(plan.issuedAt) || now >= Date.parse(plan.expiresAt))
      refuse('preservation-expired');
    const facts = preservationObservation(root, plan.adoption, plan.state.policyRoot, plan.state.workflow, options);
    if (Object.keys(facts).some(name => !same(facts[name], plan[name]))) refuse('preservation-drift');
    const issued = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(issued) || issued < now || issued >= Date.parse(plan.expiresAt))
      refuse('preservation-expired');
    const { planDigest, ...content } = plan;
    const payload = { ...content, schema: plan.disposition === 'current-quarantine-retained' ? CURRENT_QUARANTINE_SCHEMA : SUCCESSOR_PRESERVATION_SCHEMA,
      state: { ...plan.state, planDigest, planIssuedAt: plan.issuedAt }, issuedAt: new Date(issued).toISOString() };
    const receipt = validateRetentionDispositionReceipt({ ...payload, receiptDigest: governanceDigest(payload) });
    assertPrivateDirectoryIdentity(base, 'preservation base');
    mkdirSync(dirname(path), { mode: 0o700 });
    assertPrivateDirectoryIdentity(base, 'preservation base');
    const parent = privateDirectoryIdentity(dirname(path), 'preservation directory');
    if (!parent) refuse('preservation-carrier');
    writePrivateFileExclusive(path, Buffer.from(canonicalJson(receipt)), { maxBytes: 64000, label: 'preservation carrier' });
    const stored = validateRetentionDispositionReceipt(readUserCleanupJson(path, 'preservation-carrier', parent));
    assertPrivateDirectoryIdentity(base, 'preservation base');
    if (!same(receipt, stored)) refuse('preservation-carrier');
    return stored;
  });
}
