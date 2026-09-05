/** Lane worktree lifecycle with atomic branch binding and external byte isolation. */
import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  acquireOperationLock, currentBranch, decodeNulFields, finishOperationLock, git, gitLines,
  headSha, isAncestor, observeGit, observeGitLines, refExists, remoteRefSha, remoteTransport,
  repoRoot, untrackedPaths, worktrees, worktreeCleanupRisks,
} from './git.mjs';
import { isLaneRef, laneDirName, laneRef, parseLaneRef } from './lane-id.mjs';
import { successorRecordPlan, transition } from './lane-state.mjs';
import * as laneRecords from './lane-records.mjs';
export const LANE_BRANCH_LIMIT = 256;
/** One registry parent, then one repository directory; override only the parent. */
export function worktreeRoot(cwd = process.cwd()) {
  const override = process.env.AGENTIC_OS_WORKTREE_ROOT, root = repoRoot(cwd);
  const registry = override ? resolve(override) : join(dirname(root), '.worktrees');
  return join(registry, basename(root));
}
export const lanePath = (scope, device, cwd = process.cwd()) =>
  join(worktreeRoot(cwd), laneDirName(scope, device));
/** Lane branches that exist locally. */
export function laneBranches(cwd = process.cwd()) {
  const branches = observeGitLines(['for-each-ref', '--format=%(refname:short)',
    'refs/heads/agent', `--count=${LANE_BRANCH_LIMIT + 1}`], { cwd });
  if (branches.length > LANE_BRANCH_LIMIT) {
    const error = Object.assign(new Error(`lane branch inventory exceeds ${LANE_BRANCH_LIMIT}; `
      + 'preserve every ref and recover or partition it before survey'),
    { reason: 'blocked-lane-inventory-over-budget' });
    throw error;
  }
  return branches;
}
/** Bounded normal-path count; deep reap retains the strict full-inventory stop. */
export function laneBranchSummary(cwd = process.cwd()) {
  const branches = observeGitLines(['for-each-ref', '--format=%(refname:short)',
    'refs/heads/agent', `--count=${LANE_BRANCH_LIMIT + 1}`], { cwd });
  return Object.freeze({ count: branches.length, truncated: branches.length > LANE_BRANCH_LIMIT });
}
/** One exact lane selection bypasses only the unrelated global inventory count. */
export function reapLaneBranches(ref = null, cwd = process.cwd()) {
  if (ref === null) return laneBranches(cwd);
  if (!isLaneRef(ref)) {
    const error = Object.assign(new TypeError(`invalid lane ref ${JSON.stringify(ref)}`),
      { reason: 'blocked-invalid-lane-ref' });
    throw error;
  }
  if (!refExists(`refs/heads/${ref}`, cwd)) {
    const error = Object.assign(new Error(`lane branch does not exist: ${ref}`),
      { reason: 'blocked-lane-ref-missing' });
    throw error;
  }
  return [ref];
}
export const registeredLaneBranches = (cwd = process.cwd()) =>
  worktrees(cwd).map((entry) => entry.branch).filter(isLaneRef);
export const worktreeFor = (ref, cwd = process.cwd()) =>
  worktrees(cwd).find((entry) => entry.branch === ref) ?? null;
export const staleWorktrees = (cwd = process.cwd()) =>
  worktrees(cwd).filter((entry) => !existsSync(entry.path));
/** Refuse an already-occupied lane identity before any provider evidence is fetched. */
export function assertProvisionable({ ref, scope, device, cwd = process.cwd() }) {
  const path = lanePath(scope, device, cwd);
  const registered = worktrees(cwd).find((entry) => entry.branch === ref || entry.path === path);
  let detail = null;
  if (existsSync(path)) detail = `lane worktree already exists: ${path}`;
  else if (refExists(`refs/heads/${ref}`, cwd)) detail = `lane branch already exists: ${ref}`;
  else if (registered) detail = `lane worktree is already registered: ${registered.path}`;
  if (detail) throw Object.assign(new Error(detail), { reason: 'blocked-lane-already-exists' });
  return Object.freeze({ ref, path });
}
function directDirectory(path) {
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (!metadata) return null;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw Object.assign(new Error(`worktree parent must be a direct directory: ${path}`),
      { reason: 'blocked-worktree-parent-identity' });
  }
  return Object.freeze({ path, dev: metadata.dev, ino: metadata.ino, mode: metadata.mode });
}
function createWorktreeParents(path, created) {
  const missing = [];
  for (let cursor = dirname(path);;) {
    if (directDirectory(cursor)) break;
    missing.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error('worktree parent has no existing directory ancestor');
    cursor = parent;
  }
  for (const directory of missing.reverse()) {
    try {
      mkdirSync(directory);
      const receipt = { path: directory, creationReturned: true, observationExact: false };
      created.push(receipt);
      Object.assign(receipt, directDirectory(directory), { observationExact: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      directDirectory(directory);
    }
  }
}
function provisionArtifacts({
  ref, path, baseSha, cwd, createdParents, worktreeAddReturned,
  postconditionHead = null, postconditionBranch = null, provisionCompleted = false,
}) {
  let branchSha = null, branchObservationExact = true;
  try { branchSha = headSha(`refs/heads/${ref}`, cwd); } catch { branchObservationExact = false; }
  let registeredWorktree = null, registrationObservationExact = true;
  try { registeredWorktree = worktreeFor(ref, cwd); } catch { registrationObservationExact = false; }
  let pathIdentity = null, pathObservationExact = true;
  try {
    const metadata = lstatSync(path, { throwIfNoEntry: false });
    if (metadata) pathIdentity = Object.freeze({ path, dev: metadata.dev, ino: metadata.ino,
      mode: metadata.mode, kind: metadata.isDirectory() && !metadata.isSymbolicLink()
        ? 'directory' : metadata.isSymbolicLink() ? 'symlink' : 'other' });
  } catch { pathObservationExact = false; }
  const artifacts = {
    effectsRetained: createdParents.length > 0 || branchSha !== null
      || registeredWorktree !== null || pathIdentity !== null,
    operation: 'provision-worktree', ref, path, baseSha, worktreeAddReturned,
    provisionCompleted,
    createdParentPaths: createdParents.map((entry) => entry.path),
    createdParents: createdParents.map((entry) => Object.freeze({ ...entry })),
    branchSha, branchObservationExact,
    registeredWorktree, registrationObservationExact,
    pathExists: pathIdentity !== null, pathIdentity, pathObservationExact,
    postconditionHead, postconditionBranch,
  };
  return Object.freeze(artifacts);
}
/** Bind one worktree to the captured SHA; reobserve and retain checkout failures. */
export function provision({ ref, scope, device, baseSha, cwd = process.cwd() }) {
  if (typeof baseSha !== 'string' || !/^[0-9a-f]{40,64}$/u.test(baseSha)) {
    throw new TypeError('provision requires one captured base object ID');
  }
  const { path } = assertProvisionable({ ref, scope, device, cwd });
  const createdParents = [];
  let worktreeAddReturned = false, observed = null, branch = null;
  try {
    createWorktreeParents(path, createdParents);
    git(['worktree', 'add', '-b', ref, path, baseSha], { cwd });
    worktreeAddReturned = true;
    observed = observeGit(['rev-parse', 'HEAD'], { cwd: path });
    branch = observeGit(['branch', '--show-current'], { cwd: path });
    if (observed !== baseSha || branch !== ref) {
      throw Object.assign(new Error('provisioned worktree does not match captured base and lane ref'), {
        reason: 'blocked-provision-postcondition',
      });
    }
  } catch (cause) {
    const artifacts = provisionArtifacts({ ref, path, baseSha, cwd, createdParents,
      worktreeAddReturned, postconditionHead: observed, postconditionBranch: branch });
    throw Object.assign(new Error(
      `lane provisioning failed; recovery required; retained artifacts ${JSON.stringify(artifacts)}`,
      { cause }), {
      reason: 'blocked-provision-recovery-required', artifacts, retainedOperation: true,
      operationArtifacts: artifacts, operationError: cause, operationResult: null,
    });
  }
  const artifacts = provisionArtifacts({ ref, path, baseSha, cwd, createdParents,
    worktreeAddReturned, postconditionHead: observed, postconditionBranch: branch,
    provisionCompleted: true });
  return Object.freeze({ schema: 'agentic-os/git-provision/v1', ...artifacts });
}
/** Observed facts for the lane state machine. */
export function inspect(ref, cwd = process.cwd(), baseRef, { includeIgnored = true } = {}) {
  if (typeof baseRef !== 'string' || baseRef.length === 0)
    throw new TypeError('lane inspection requires an explicit canonical base ref');
  const entry = worktreeFor(ref, cwd);
  if (!entry) return { registered: false, path: null, untracked: [], commits: 0 };
  const path = entry.path;
  return { registered: true, path, untracked: untrackedPaths(path, { includeIgnored }),
    commits: observeGitLines(['rev-list', `${baseRef}..${ref}`], { cwd }).length };
}
/** Compatibility cleanup requires the public authenticated retirement contract. */
export function retire() {
  const error = new Error('retirement requires an authenticated authority-transition receipt');
  error.reason = 'blocked-authenticated-cleanup-required';
  throw error;
}
const writeScopeError = (reason, message, detail = {}) =>
  Object.assign(new Error(message), { reason, ...detail });
export function parseWritePaths(value) {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError('at least one --write=<path[,path...]> reservation is required');
  const paths = [...new Set(value.split(',').map((path) => path.trim()))].sort();
  for (const path of paths) {
    const segments = path.split('/');
    if (!path || path.startsWith('/') || path.endsWith('/') || path.startsWith(':')
      || /[*?[]/u.test(path) || path.includes('\\') || path.includes('\0')
      || segments.some((part) => !part || part === '.' || part === '..'))
      throw writeScopeError('blocked-invalid-write-scope', `invalid Git write scope: ${path}`);
  }
  return paths;
}
const pathsOverlap = (left, right) => left === right
  || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
const pathIsReserved = (path, reservations) => reservations.some((reservation) =>
  path === reservation || path.startsWith(`${reservation}/`));
function observedLanePaths(entry, record, protectedRef, cwd) {
  const observed = worktreeCleanupRisks(entry.path, { includeIgnored: false });
  const dirty = [...new Set([...observed.tracked, ...observed.owned, ...observed.hidden])];
  const committed = gitLines(['diff', '--name-only',
    `${record?.baseSha ?? protectedRef}...refs/heads/${entry.branch}`], { cwd, allowFail: true });
  const reserved = (record?.writePaths ?? []).flatMap((path) => parseWritePaths(path));
  return [...new Set([...reserved, ...dirty, ...committed])].sort();
}
function assertDisjointReservationExcept({
  cwd, ref, writePaths, protectedRef, records, predecessorRef = null,
}) {
  const excluded = new Set([ref, predecessorRef].filter(Boolean));
  const active = worktrees(cwd).filter((entry) =>
    isLaneRef(entry.branch) && !excluded.has(entry.branch));
  if (active.length > 0 && writePaths.length === 0) throw writeScopeError(
    'blocked-write-scope-missing', 'concurrent admission requires --write=<path[,path...]>');
  for (const entry of active) {
    const occupied = observedLanePaths(entry, records[entry.branch], protectedRef, cwd);
    if (occupied.length === 0) throw writeScopeError('blocked-unproven-write-scope',
      `active lane has no declared or observable write scope: ${entry.branch}`, { ref: entry.branch });
    for (const requested of writePaths) for (const path of occupied) {
      if (pathsOverlap(requested, path)) throw writeScopeError('blocked-write-scope-overlap',
        `${ref} overlaps ${entry.branch}: ${requested} <> ${path}`,
        { ref: entry.branch, requested, occupied: path });
    }
  }
  return writePaths;
}
export const assertDisjointReservation = (input) => assertDisjointReservationExcept(input);
const successorError = (reason, message, detail = {}) => Object.assign(new Error(message),
  { reason, ...detail });
function successorBinding(predecessor, successor, tip, publishedHead, cwd) {
  const oldRef = `refs/heads/${predecessor}`, newRef = `refs/heads/${successor}`;
  const artifacts = { effectsRetained: false, operation: 'preserve-lane-successor', predecessorRef: oldRef,
    successorRef: newRef, tip, publishedHead, currentBranch: null, predecessorCurrentOid: null, successorCurrentOid: null };
  try {
    if (currentBranch(cwd) !== predecessor || headSha(oldRef, cwd) !== tip || refExists(newRef, cwd))
      throw successorError('blocked-successor-local-race', 'lane refs changed before successor binding');
    const input = ['start', `create ${newRef} ${tip}`, 'option no-deref', `symref-update HEAD ${newRef} oid ${tip}`,
      'prepare', 'commit', ''].join('\n');
    git(['update-ref', '--stdin'], { cwd, input });
    artifacts.effectsRetained = true;
  } catch (cause) {
    try { artifacts.currentBranch = currentBranch(cwd); } catch { /* retained state unknown */ }
    try { artifacts.predecessorCurrentOid = headSha(oldRef, cwd); } catch { /* unknown */ }
    try { artifacts.successorCurrentOid = headSha(newRef, cwd); } catch { /* unknown */ }
    artifacts.effectsRetained ||= artifacts.currentBranch === successor || artifacts.successorCurrentOid === tip;
    throw Object.assign(new Error('successor binding failed; exact retained refs are attached', { cause }), {
      reason: cause.reason ?? 'blocked-successor-binding', retainedOperation: true,
      artifacts: Object.freeze(artifacts), operationArtifacts: Object.freeze(artifacts) });
  }
  Object.assign(artifacts, { currentBranch: currentBranch(cwd), predecessorCurrentOid: headSha(oldRef, cwd), successorCurrentOid: headSha(newRef, cwd) });
  if (artifacts.currentBranch !== successor || artifacts.predecessorCurrentOid !== tip
    || artifacts.successorCurrentOid !== tip || headSha('HEAD', cwd) !== tip) throw Object.assign(
    new Error('successor binding exact postcondition failed'), { reason: 'blocked-successor-postcondition', retainedOperation: true,
      artifacts: Object.freeze(artifacts), operationArtifacts: Object.freeze(artifacts) });
  return Object.freeze({ schema: 'agentic-os/lane-successor-binding/v1', ...artifacts });
}
function assertSuccessorGit(cwd) {
  const match = /^git version (\d+)\.(\d+)/u.exec(git(['version'], { cwd }));
  if (!match || Number(match[1]) < 2 || Number(match[1]) === 2 && Number(match[2]) < 46) throw successorError(
    'blocked-git-symref-unsupported', 'successor requires Git 2.46 or newer for transactional symbolic refs');
}
/** Preserve a published lane and continue its clean descendant in the same linked worktree. */
export function runPublishedLaneSuccessor({ cwd, predecessorRef: boundRef, scope, explicitHead,
  remote, protectedRef, out }) {
  const bound = parseLaneRef(boundRef), successorRef = laneRef(scope, bound.device);
  const lock = acquireOperationLock('agentic-os-start', cwd);
  if (!lock) throw successorError('blocked-concurrent-successor', 'another admission owns the start lock');
  const artifacts = { effectsRetained: false, operation: 'successor', predecessorRef: boundRef,
    successorRef, expectedHead: null, tip: null, binding: null, cachePublication: null, cacheState: 'not-attempted', recoveryCommand: null };
  let result, error = null, plannedRecord = null;
  try { assertSuccessorGit(cwd);
    const currentStore = laneRecords.load(cwd), tip = headSha('HEAD', cwd);
    const plan = successorRecordPlan({ boundRef, successorRef, lanes: currentStore.lanes, explicitHead,
      protectedRef, tip, worktree: worktreeFor(boundRef, cwd)?.path, device: bound.device,
      scope, createdAt: new Date().toISOString() });
    if (plan.reason) throw successorError(plan.reason, plan.message);
    const { resuming, predecessorRef, predecessorRecord: currentRecord, expectedHead } = plan;
    plannedRecord = plan.plannedRecord;
    Object.assign(artifacts, { predecessorRef, cacheState: resuming ? plannedRecord.state : 'absent', expectedHead, tip });
    const transport = remoteTransport(remote, cwd);
    if (remoteRefSha(remote, predecessorRef, cwd, transport.fetchUrl) !== expectedHead) throw successorError(
      'blocked-published-head-drift', 'predecessor remote ref differs from expected head');
    if (!isAncestor(currentRecord.baseSha, expectedHead, cwd)) throw successorError(
      'blocked-successor-predecessor', 'recorded base is not an ancestor of the published head');
    if (currentBranch(cwd) !== boundRef || headSha(`refs/heads/${boundRef}`, cwd) !== tip
      || resuming && headSha(`refs/heads/${predecessorRef}`, cwd) !== tip)
      throw successorError('blocked-successor-local-race', 'local lane ref changed before binding');
    const destinationAbsent = resuming || !refExists(`refs/heads/${successorRef}`, cwd)
      && !currentStore.lanes[successorRef];
    const state = transition('published', 'successor', { onCanonicalBranch: false,
      dirtyTracked: git(['status', '--porcelain=v1', '-z'], { cwd, binary: true }).length !== 0,
      predecessorExact: true, descendant: Boolean(tip && isAncestor(expectedHead, tip, cwd)),
      destinationAbsent: destinationAbsent && remoteRefSha(remote, successorRef, cwd, transport.fetchUrl) === null });
    if (!state.ok) throw successorError(state.reason, `successor refused under lock by ${state.guard}`);
    const provision = transition('planned', 'provision', { baseFetched: true });
    if (!provision.ok) throw successorError(provision.reason, `activation refused by ${provision.guard}`);
    const currentPaths = (currentRecord.writePaths ?? []).flatMap((path) => parseWritePaths(path));
    if (currentPaths.length === 0) throw successorError('blocked-write-scope-missing',
      'successor requires inherited write paths');
    if (gitLines(['rev-list', '--min-parents=2', `${currentRecord.baseSha}..${tip}`], { cwd }).length)
      throw successorError('blocked-successor-merge', 'successor refuses merge commits in preserved history');
    const committed = decodeNulFields(git(['log', '--format=', '--name-only', '-z',
      `${currentRecord.baseSha}..${tip}`], { cwd, binary: true }));
    if (committed === null) throw successorError(
      'blocked-invalid-write-scope', 'committed path inventory is not strict UTF-8');
    const outside = [...new Set(committed)].filter((path) => !pathIsReserved(path, currentPaths));
    if (outside.length > 0) throw successorError('blocked-write-outside-reservation',
      `preserve ${outside.length} committed path(s) outside the inherited reservation`, { paths: outside });
    assertDisjointReservationExcept({ cwd, ref: successorRef,
      writePaths: currentPaths, protectedRef: currentRecord.base ?? protectedRef,
      records: currentStore.lanes, predecessorRef: boundRef });
    if (!plannedRecord.worktree) throw successorError('blocked-successor-postcondition',
      'bound worktree registration is unavailable');
    if (!resuming) {
      laneRecords.putExact(plannedRecord, null, cwd);
      artifacts.cacheState = 'planned';
    }
    if (boundRef !== successorRef) {
      if (remoteRefSha(remote, predecessorRef, cwd, transport.fetchUrl) !== expectedHead
        || remoteRefSha(remote, successorRef, cwd, transport.fetchUrl) !== null
        || currentBranch(cwd) !== boundRef || headSha(`refs/heads/${boundRef}`, cwd) !== tip
        || refExists(`refs/heads/${successorRef}`, cwd)
        || git(['status', '--porcelain=v1', '-z'], { cwd, binary: true }).length !== 0
        || JSON.stringify(laneRecords.get(successorRef, cwd)) !== JSON.stringify(plannedRecord))
        throw successorError('blocked-successor-admission-race', 'successor admission changed before binding');
      artifacts.binding = successorBinding(predecessorRef, successorRef, tip, expectedHead, cwd);
      artifacts.effectsRetained = true;
    }
    if (boundRef === successorRef) artifacts.effectsRetained = true;
    const boundWorktree = worktreeFor(successorRef, cwd)?.path; if (boundWorktree !== plannedRecord.worktree)
      throw successorError(
      'blocked-successor-postcondition', 'successor worktree registration changed');
    if (remoteRefSha(remote, predecessorRef, cwd, transport.fetchUrl) !== expectedHead
      || remoteRefSha(remote, successorRef, cwd, transport.fetchUrl) !== null)
      throw successorError('blocked-successor-remote-race', 'remote refs changed during binding');
    if (currentBranch(cwd) !== successorRef || headSha('HEAD', cwd) !== tip) throw successorError(
      'blocked-successor-postcondition', 'successor drifted after cache publication');
    const activeRecord = { ...plannedRecord, state: 'active' }; if (plannedRecord.state !== 'active')
      laneRecords.putExact(activeRecord, plannedRecord, cwd);
    if (JSON.stringify(laneRecords.get(successorRef, cwd)) !== JSON.stringify(activeRecord))
      throw successorError('blocked-successor-cache-race', 'successor cache activation changed');
    artifacts.cacheState = 'active';
    out(`successor ${successorRef}`); out(`predecessor ${predecessorRef} @ ${expectedHead}`);
    out(`worktree ${boundWorktree}`); result = 0;
  } catch (caught) {
    const retained = caught.operationArtifacts ?? caught.artifacts ?? null; if (retained?.operation === 'preserve-lane-successor') artifacts.binding = retained;
    artifacts.effectsRetained ||= retained?.operation === 'preserve-lane-successor' && retained.effectsRetained === true;
    if (caught.published === true || caught.publicationAttempted === true || retained?.refPublished === true) artifacts.effectsRetained = true;
    if (caught.publicationAttempted === true || caught.published === true || retained?.cacheRef) artifacts.cachePublication = {
      candidateOid: caught.candidateOid ?? retained?.candidateOid ?? null, expectedOid: caught.expectedOid ?? retained?.expectedOid ?? null,
      currentOid: caught.currentOid ?? retained?.currentOid ?? null,
      publicationAttempted: caught.publicationAttempted === true || caught.published === true || retained?.refPublished === true,
      refPublished: caught.published === true || retained?.refPublished === true };
    try { const projected = laneRecords.get(successorRef, cwd);
      if (!artifacts.effectsRetained && plannedRecord
        && JSON.stringify(projected) === JSON.stringify(plannedRecord)) artifacts.effectsRetained = true;
    } catch { /* final retained-state classification below */ }
    if (artifacts.effectsRetained) {
      try { const projected = laneRecords.get(successorRef, cwd), active = { ...plannedRecord, state: 'active' };
        artifacts.cacheState = !projected ? 'absent' : JSON.stringify(projected) === JSON.stringify(active)
          ? 'active' : JSON.stringify(projected) === JSON.stringify(plannedRecord) ? 'planned' : 'drifted';
      } catch { artifacts.cacheState = 'unreadable'; }
      artifacts.recoveryCommand = `npm run successor -- ${scope} --expected-head=${artifacts.expectedHead}`;
      const receipt = Object.freeze({ ...artifacts });
      error = Object.assign(new Error(`successor effects are preserved; without edits, rerun ${artifacts.recoveryCommand} after resolving any reported remote collision`,
        { cause: caught }), { reason: caught.reason ?? 'blocked-successor-retained',
        retainedOperation: true, artifacts: receipt, operationArtifacts: receipt,
        operationError: caught, operationResult: null });
    } else error = caught;
  }
  return finishOperationLock(lock, { label: 'successor', result, error, artifacts });
}
export function commitReservedChanges({ cwd, writePaths, message }) {
  if (typeof message !== 'string' || message.trim().length === 0 || message.length > 500)
    throw writeScopeError('blocked-invalid-commit-message', '--message must contain 1-500 characters');
  const before = worktreeCleanupRisks(cwd, { includeIgnored: false }),
    changed = [...new Set([...before.tracked, ...before.owned, ...before.hidden])].sort();
  if (changed.length === 0) return null;
  const outside = changed.filter((path) => !pathIsReserved(path, writePaths));
  if (outside.length > 0) throw writeScopeError('blocked-write-outside-reservation',
    `preserve ${outside.length} path(s) outside this lane reservation`, { paths: outside });
  git(['add', '--', ...writePaths], { cwd });
  const staged = gitLines(['diff', '--cached', '--name-only'], { cwd }); if (staged.length === 0)
    throw writeScopeError('blocked-empty-commit', 'no reserved changes were staged');
  const stagedOutside = staged.filter((path) => !pathIsReserved(path, writePaths));
  if (stagedOutside.length > 0) throw writeScopeError('blocked-staged-outside-reservation',
    `index contains ${stagedOutside.length} path(s) outside this lane reservation`, { paths: stagedOutside });
  git(['commit', '--message', message], { cwd });
  return Object.freeze({ head: git(['rev-parse', 'HEAD'], { cwd }), paths: staged });
}
