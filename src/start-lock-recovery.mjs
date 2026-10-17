/** Explicit, identity-bound recovery for a crashed clone-wide START directory lock. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  opendirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync,
  writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commonDir, currentBranch, headSha, repoRoot } from './git.mjs';
import { flag, option, positional } from '../bin/agentic-os-argv.mjs';

const PLAN_SCHEMA = 'agentic-os/start-lock-recovery-plan/v1';
const MARKER_SCHEMA = 'agentic-os/start-lock-recovery-marker/v1';
const fail = (reason, message) => { throw Object.assign(new Error(message), {
  reason: `blocked-start-lock-recovery-${reason}`, }); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

function identity(stat, times = true) {
  const value = { dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid),
    mode: String(stat.mode & 0o7777n) };
  if (times) value.nlink = String(stat.nlink);
  if (times) Object.assign(value, { ctimeNs: String(stat.ctimeNs), mtimeNs: String(stat.mtimeNs) });
  return value;
}
const stableIdentity = (left, right) => canonical(left) === canonical(right);
function directoryIdentity(path, label, times = false) {
  const before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!before?.isDirectory() || before.isSymbolicLink()) fail('identity', `${label} must be a direct directory`);
  const value = identity(before, times), after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!after?.isDirectory() || after.isSymbolicLink() || !stableIdentity(value, identity(after, times)))
    fail('identity-race', `${label} changed during observation`);
  return value;
}
function readMarker(directory) {
  const handle = opendirSync(directory);
  let entries;
  try { entries = [handle.readSync(), handle.readSync()].filter(Boolean); }
  finally { handle.closeSync(); }
  if (entries.length !== 1 || entries[0].name !== 'recovery.json') return null;
  const path = join(directory, 'recovery.json'), before = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!before?.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || (before.mode & 0o7777n) !== 0o600n || before.size > 131072n
      || process.getuid && before.uid !== BigInt(process.getuid())) return null;
  const bytes = readFileSync(path), after = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!after?.isFile() || !stableIdentity(identity(before), identity(after)))
    fail('marker-race', 'recovery marker changed during observation');
  let marker;
  try { marker = JSON.parse(bytes.toString('utf8')); } catch { return null; }
  if (!validMarker(marker)) return null;
  return marker;
}
function validPlan(plan) {
  if (!plan || plan.schema !== PLAN_SCHEMA || !sha(plan.planDigest)) return false;
  const { planDigest, ...body } = plan;
  return digest(body) === planDigest;
}
function validMarker(marker) {
  if (!marker || marker.schema !== MARKER_SCHEMA || !marker.originalPlan
      || !validPlan(marker.originalPlan) || !marker.replacementIdentity
      || typeof marker.archivePath !== 'string' || !sha(marker.markerDigest)) return false;
  const { markerDigest, ...body } = marker;
  return digest(body) === markerDigest;
}
function markerFor(plan, replacementIdentity, archivePath) {
  const body = { schema: MARKER_SCHEMA, originalPlan: plan, replacementIdentity, archivePath };
  return { ...body, markerDigest: digest(body) };
}
export function recoveryDirectoryIdentity(path) {
  return directoryIdentity(path, 'recovery directory');
}
export function createStartLockRecoveryMarker(plan, replacementIdentity, archivePath) {
  if (!validPlan(plan)) fail('plan', 'marker requires an exact recovery plan');
  return markerFor(plan, replacementIdentity, archivePath);
}
function archivePathFor(common, planDigest) {
  return join(common, `.agentic-os-start-recovered-${planDigest}`);
}
function archiveReceipt(common, planDigest) {
  const path = archivePathFor(common, planDigest);
  if (!existsSync(path)) return null;
  const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!stat?.isDirectory() || stat.isSymbolicLink()) fail('archive', 'recovery archive path is occupied');
  const marker = readMarker(path);
  if (!marker || marker.originalPlan.planDigest !== planDigest || marker.archivePath !== path)
    fail('archive', 'recovery archive does not match the exact plan');
  return { schema: 'agentic-os/start-lock-recovery-receipt/v1', status: 'already-recovered',
    planDigest, archivePath: path, processOwnershipVerified: false,
    startAdmissionAuthority: false, integrationAuthority: false, deploymentAuthority: false };
}
function inspect(root) {
  const repository = realpathSync(repoRoot(root));
  if (repository !== resolve(repository)) fail('repository-path', 'canonical repository path must be resolved');
  const common = realpathSync(commonDir(repository));
  const rootIdentity = directoryIdentity(repository, 'repository root');
  const commonIdentity = directoryIdentity(common, 'Git common directory');
  const branch = currentBranch(repository), head = headSha('HEAD', repository);
  if (!branch || !head) fail('repository-state', 'a named branch and exact HEAD are required');
  const lockPath = join(common, 'agentic-os-start.lock');
  const before = lstatSync(lockPath, { bigint: true, throwIfNoEntry: false });
  if (!before) fail('missing', 'START lock is absent; no recovery is needed');
  if (!before.isDirectory() || before.isSymbolicLink()) fail('lock-type', 'START lock must be a direct directory');
  if (process.getuid && before.uid !== BigInt(process.getuid()))
    fail('lock-owner', 'START lock is owned by another operating-system user');
  const lockIdentity = identity(before), handle = opendirSync(lockPath);
  let entry;
  try { entry = handle.readSync(); }
  finally { handle.closeSync(); }
  const after = lstatSync(lockPath, { bigint: true, throwIfNoEntry: false });
  if (!after?.isDirectory() || after.isSymbolicLink()
      || !stableIdentity(lockIdentity, identity(after))) fail('lock-race', 'START lock changed during observation');
  let phase, markerDigest = null, originalPlanDigest = null;
  if (!entry) phase = 'stale-empty-lock';
  else {
    const marker = readMarker(lockPath);
    if (!marker || entry.name !== 'recovery.json')
      fail('nonempty', 'START lock is nonempty and is not a recognized interrupted recovery');
    phase = 'interrupted-recovery'; markerDigest = marker.markerDigest;
    originalPlanDigest = marker.originalPlan.planDigest;
    if (marker.archivePath !== archivePathFor(common, originalPlanDigest)
        || !stableIdentity(identity(after, false), marker.replacementIdentity))
      fail('marker-binding', 'interrupted recovery marker does not bind this exact lock');
  }
  const body = { schema: PLAN_SCHEMA, phase, repository, rootIdentity, commonDirectory: common,
    commonIdentity, branch, head, lock: { path: lockPath, identity: lockIdentity,
      markerDigest, originalPlanDigest }, processOwnershipVerified: false,
    requiresOperatorStoppedAcknowledgement: true };
  return { ...body, planDigest: digest(body) };
}
export function planStartLockRecovery(root) { return inspect(root); }
function writeMarkerDirectory(common, plan, archivePath) {
  const directory = join(common, `.agentic-os-start-recovery-${randomUUID()}`);
  mkdirSync(directory, { mode: 0o700 });
  const replacementIdentity = directoryIdentity(directory, 'staged recovery directory');
  const marker = markerFor(plan, replacementIdentity, archivePath), markerPath = join(directory, 'recovery.json');
  const descriptor = openSync(markerPath, 'wx', 0o600);
  try { writeFileSync(descriptor, JSON.stringify(marker)); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  return { directory, marker };
}
function discardStaged(staged) {
  if (!existsSync(staged.directory)) return;
  const live = directoryIdentity(staged.directory, 'staged recovery directory');
  const marker = readMarker(staged.directory);
  if (!stableIdentity(live, staged.marker.replacementIdentity)
      || marker?.markerDigest !== staged.marker.markerDigest) return;
  unlinkSync(join(staged.directory, 'recovery.json'));
  rmdirSync(staged.directory);
}
function finishRecovery(common, lockPath, marker) {
  if (existsSync(marker.archivePath)) {
    const receipt = archiveReceipt(common, marker.originalPlan.planDigest);
    if (receipt) return receipt;
    fail('archive', 'recovery archive destination already exists');
  }
  const live = directoryIdentity(lockPath, 'recovery lock');
  if (!stableIdentity(live, marker.replacementIdentity)) fail('lock-drift', 'recovery lock identity changed before finalization');
  try { renameSync(lockPath, marker.archivePath); }
  catch (error) {
    const receipt = archiveReceipt(common, marker.originalPlan.planDigest);
    if (receipt) return receipt;
    throw error;
  }
  return { schema: 'agentic-os/start-lock-recovery-receipt/v1', status: 'recovered',
    originalPlanDigest: marker.originalPlan.planDigest, recoveryPlanDigest: null,
    recoveredLockIdentity: marker.originalPlan.lock.identity, archivePath: marker.archivePath,
    processOwnershipVerified: false, operatorStoppedAcknowledgement: true,
    startAdmissionAuthority: false, integrationAuthority: false, deploymentAuthority: false };
}
export function applyStartLockRecovery(root, { planDigest, authorization, stopped }) {
  if (stopped !== true) fail('stopped', 'apply requires --stopped after all START writers have stopped');
  if (!sha(planDigest) || authorization !== `agentic-os:start-lock-recovery:${planDigest}`)
    fail('authorization', 'exact plan digest authorization is required');
  const repository = realpathSync(repoRoot(root)), common = realpathSync(commonDir(repository));
  const prior = archiveReceipt(common, planDigest);
  if (prior) return prior;
  const current = inspect(repository), lockPath = current.lock.path;
  let originalPlan;
  if (current.planDigest === planDigest && current.phase === 'stale-empty-lock') originalPlan = current;
  else if (current.phase === 'interrupted-recovery'
      && (current.planDigest === planDigest || current.lock.originalPlanDigest === planDigest)) {
    const marker = readMarker(lockPath);
    if (!marker) fail('marker', 'interrupted recovery marker is invalid');
    originalPlan = marker.originalPlan;
    return { ...finishRecovery(common, lockPath, marker), recoveryPlanDigest: planDigest };
  } else fail('stale-plan', 'repository or START lock differs from the exact authorized plan');
  const archivePath = archivePathFor(common, originalPlan.planDigest);
  if (existsSync(archivePath)) fail('archive', 'recovery archive destination already exists');
  const staged = writeMarkerDirectory(common, originalPlan, archivePath);
  let handedOff = false;
  try {
    const stageMarker = readMarker(staged.directory);
    if (!stageMarker || stageMarker.markerDigest !== staged.marker.markerDigest
        || !stableIdentity(directoryIdentity(staged.directory, 'staged recovery directory'),
          staged.marker.replacementIdentity)) fail('stage', 'staged recovery marker changed');
    const fresh = inspect(repository);
    if (fresh.planDigest !== originalPlan.planDigest || fresh.phase !== 'stale-empty-lock')
      fail('stale-plan', 'START lock changed before atomic recovery handoff');
    try { renameSync(staged.directory, lockPath); handedOff = true; }
    catch (error) {
      const raced = inspect(repository);
      if (raced.phase !== 'interrupted-recovery' || raced.lock.originalPlanDigest !== originalPlan.planDigest) throw error;
      handedOff = true;
    }
    const marker = readMarker(lockPath);
    if (!marker || marker.originalPlan.planDigest !== originalPlan.planDigest)
      fail('postcondition', 'recovery handoff marker is missing or changed');
    const receipt = finishRecovery(common, lockPath, marker);
    return { ...receipt, recoveryPlanDigest: planDigest };
  } catch (error) {
    if (!handedOff) discardStaged(staged);
    throw error;
  }
}
export function runStartLockRecovery(root, argv, out) {
  try {
    const [operation] = positional(argv);
    if (operation === 'plan') {
      const plan = planStartLockRecovery(root);
      out(JSON.stringify({ ...plan, authorization: `agentic-os:start-lock-recovery:${plan.planDigest}` }));
    } else {
      out(JSON.stringify(applyStartLockRecovery(root, { planDigest: option(argv, 'plan-digest'),
        authorization: option(argv, 'authorize'), stopped: flag(argv, 'stopped') })));
    }
    return 0;
  } catch (error) {
    out(JSON.stringify({ error: error.reason ?? 'blocked-start-lock-recovery', message: error.message }));
    return 1;
  }
}
