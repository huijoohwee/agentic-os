/**
 * Thin git wrapper. Array argv only, never a shell string, so no path or scope
 * value can be interpolated into a command.
 */
import { lstatSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { acquireDirectoryLock, finishOperationLock,
  OperationLockError } from './file-integrity.mjs';
import { git, observeGit, observeGitLines, parseWorktreeList } from './git-tracked.mjs';
import { copyWorktreeEntriesToQuarantine } from './quarantine.mjs';
export { retireCleanProjectionUnderExclusiveContract } from './quarantine.mjs';
export { GitError, git, gitLines, observeGit, observeGitLines } from './git-tracked.mjs';
export { decodeNulFields, dirtyTracked, trackedChanges, untrackedPaths,
  worktreeCleanupRisks } from './git-tracked.mjs';
export { finishOperationLock, OperationLockError };
function gitPath(args, cwd, label) {
  const output = observeGit(args, { cwd, raw: true });
  if (!output.endsWith('\n')) throw new Error(`${label} is not newline-terminated`);
  return output.slice(0, -1);
}
export const repoRoot = (cwd = process.cwd()) => gitPath(['rev-parse', '--show-toplevel'], cwd, 'repository root');
export const gitDir = (cwd = process.cwd()) => gitPath(['rev-parse', '--path-format=absolute', '--git-dir'], cwd, 'Git directory');
/** Shared across every worktree of one clone. rerere's cache lives here. */
export const commonDir = (cwd = process.cwd()) => gitPath(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd, 'Git common directory');
/** Serialize cooperating operations in a clone. A null result means another holder exists. */
export const acquireOperationLock = (name, cwd = process.cwd()) => acquireDirectoryLock(join(commonDir(cwd), `${name}.lock`));
/** Verify every depended-on ref and advance one ref in a single reference transaction. */
export function atomicAdvanceRef(ref, newOid, oldOid, expectedRefs, cwd = process.cwd()) {
  for (const candidate of [ref, ...expectedRefs.map(([expectedRef]) => expectedRef)]) {
    const symbolicTarget = observeGit(['symbolic-ref', '--quiet', candidate], {
      cwd, allowFail: true,
    });
    if (symbolicTarget !== null) throw Object.assign(new Error(
      `exact reference transaction refuses symbolic ref ${candidate} -> ${symbolicTarget}`,
    ), { reason: 'blocked-symbolic-reference', ref: candidate, symbolicTarget });
  }
  const input = [
    'start',
    ...expectedRefs.flatMap(([expectedRef, expectedOid]) => [
      'option no-deref', `verify ${expectedRef} ${expectedOid}`,
    ]),
    'option no-deref',
    `update ${ref} ${newOid} ${oldOid}`,
    'prepare', 'commit', '',
  ].join('\n');
  git(['update-ref', '--stdin'], { cwd, input });
}
/** Refuse pre-existing symlink/non-directory parents; exclusivity covers swaps after this check. */
export function assertDirectoryAncestors(path, cwd = process.cwd(), { allowMissing = false } = {}) {
  const parts = path.split('/').slice(0, -1);
  let cursor = cwd;
  for (const part of parts) {
    cursor = join(cursor, part);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat && allowMissing) return;
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      const error = new Error(`unsafe directory ancestor for ${path}: ${cursor}`);
      error.reason = 'blocked-directory-ancestor';
      throw error;
    }
  }
}
/** Copy exact worktree paths into distinct bounded Git-private storage; sources stay untouched. */
export function quarantineWorktreeEntries(
  name, entries, verify, cwd = process.cwd(), manifest = null, limits = null,
) {
  entries.forEach((entry) => assertDirectoryAncestors(entry.path, cwd));
  return copyWorktreeEntriesToQuarantine({ name, entries, verify, sourceRoot: cwd,
    storageRoot: commonDir(cwd), manifest, limits });
}
/** Expand dirty inventory to every current tracked/nonignored path without changing bytes. */
export function worktreePreservationEntries(baseEntries, inventory) {
  const dirty = new Map(inventory.map((entry) => [entry.path, entry]));
  const entries = [];
  for (const [path, prior] of baseEntries) {
    const entry = dirty.get(path);
    dirty.delete(path);
    if (entry?.kind === 'deleted') continue;
    entries.push(entry ? { path, mode: entry.mode, size: entry.size, sha256: entry.sha256 }
      : { path, mode: prior.mode, size: prior.size, oid: prior.oid });
  }
  for (const entry of dirty.values()) {
    if (entry.kind !== 'deleted')
      entries.push({ path: entry.path, mode: entry.mode, size: entry.size,
        sha256: entry.sha256 });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
export function currentBranch(cwd = process.cwd()) { const name = observeGit(
  ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, allowFail: true }); return name || null; }
export const headSha = (ref = 'HEAD', cwd = process.cwd()) =>
  observeGit(['rev-parse', '--verify', ref], { cwd, allowFail: true });
/** Exact configured remote name, safe as a positional Git argument. */
export function configuredRemote(remote, cwd = process.cwd()) {
  if (typeof remote !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(remote)
    || !observeGitLines(['remote'], { cwd }).includes(remote))
    throw Object.assign(new Error(`configured Git remote is unavailable: ${String(remote)}`),
      { reason: 'blocked-configured-remote' });
  return remote;
}
/** One captured transport; hidden push URLs and ambiguous URL sets fail closed. */
export function remoteTransport(remote, cwd = process.cwd()) {
  const name = configuredRemote(remote, cwd);
  const fetchUrls = observeGitLines(['remote', 'get-url', '--all', name], { cwd });
  const pushUrls = observeGitLines(['remote', 'get-url', '--push', '--all', name], { cwd });
  if (fetchUrls.length !== 1 || pushUrls.length !== 1 || fetchUrls[0] !== pushUrls[0])
    throw Object.assign(new Error(`Git remote transport is ambiguous: ${name}`),
      { reason: 'blocked-remote-transport-identity' });
  return Object.freeze({ name, fetchUrl: fetchUrls[0], pushUrl: pushUrls[0],
    displayUrl: redactedTransportUrl(fetchUrls[0]), urlDigest: transportDigest(fetchUrls[0]) });
}
function redactedTransportUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol) return parsed.hostname ? `${parsed.protocol}//${parsed.hostname.toLowerCase()}/...` : 'opaque://...';
  } catch { /* non-URL Git transports are handled below */ }
  const match = String(url).match(/^(?:[^@/\s:]+@)?([A-Za-z0-9.-]+):/u);
  return match ? `ssh://${match[1].toLowerCase()}/...` : 'opaque://...';
}
function transportDigest(url) { return createHash('sha256').update(String(url)).digest('hex'); }
function transportRace(message) {
  return Object.assign(new Error(message), { reason: 'blocked-remote-transport-race' });
}
function capturedTransport(remote, cwd, expectedUrl) {
  const transport = remoteTransport(remote, cwd);
  if (expectedUrl !== null && transport.fetchUrl !== expectedUrl)
    throw transportRace('Git remote changed before the captured operation');
  return transport;
}

function retainedGitEffect(reason, message, cause, artifacts) {
  const operationArtifacts = Object.freeze({ ...artifacts });
  return Object.assign(new Error(message, cause ? { cause } : undefined), {
    reason, retainedOperation: true, artifacts: operationArtifacts,
    operationArtifacts, operationError: cause ?? null, operationResult: null,
  });
}

function remoteOidAtUrl(url, remoteRef, cwd) {
  const output = git(['ls-remote', '--refs', '--', url, remoteRef], { cwd });
  if (output === '') return null;
  const lines = output.split('\n').filter(Boolean);
  if (lines.length !== 1) throw new Error('remote ref advertisement is ambiguous');
  const match = lines[0].match(/^([0-9a-f]{40}(?:[0-9a-f]{24})?)\s+(.+)$/u);
  if (!match || match[2] !== remoteRef)
    throw new Error('remote ref advertisement is malformed');
  return match[1];
}

function remoteBranchRef(ref, cwd) {
  const remoteRef = `refs/heads/${ref}`;
  if (typeof ref !== 'string' || ref.includes('\0')
    || observeGit(['check-ref-format', remoteRef], { cwd, allowFail: true }) === null) {
    throw Object.assign(new Error('remote branch ref is invalid'), {
      reason: 'blocked-remote-ref-identity',
    });
  }
  return remoteRef;
}
/** Exact SHA currently advertised for one remote branch, or null. */
export function remoteRefSha(remote, ref, cwd = process.cwd(), expectedUrl = null) {
  const transport = capturedTransport(remote, cwd, expectedUrl);
  const oid = remoteOidAtUrl(transport.fetchUrl, remoteBranchRef(ref, cwd), cwd);
  if (remoteTransport(remote, cwd).fetchUrl !== transport.fetchUrl)
    throw transportRace('Git remote changed during observation');
  return oid;
}
/** Create one remote ref at one captured OID; refuse if the ref already exists. */
export function publishExactNewRef(remote, ref, oid, cwd = process.cwd(), expectedUrl = null) {
  const transport = capturedTransport(remote, cwd, expectedUrl);
  const remoteRef = remoteBranchRef(ref, cwd);
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid ?? ''))
    throw new TypeError('remote publication requires one full object ID');
  const priorOid = remoteOidAtUrl(transport.fetchUrl, remoteRef, cwd);
  if (priorOid !== null) throw Object.assign(new Error(
    `remote ref already exists at ${priorOid}: ${remoteRef}`,
  ), { reason: 'blocked-remote-ref-exists', remoteRef, currentOid: priorOid });
  const artifacts = {
    effectsRetained: false, operation: 'publish-exact-new-ref', remote: transport.name,
    url: transport.displayUrl, urlDigest: transport.urlDigest, remoteRef, candidateOid: oid, priorOid,
    publicationAttempted: true, pushCompleted: false, refPublished: false,
    writeResultUnknown: false, reobservationExact: false, remoteRefCurrentOid: null,
  };
  try {
    git([
      'push',
      `--force-with-lease=${remoteRef}:`,
      '--',
      transport.fetchUrl,
      `${oid}:${remoteRef}`,
    ], { cwd });
    Object.assign(artifacts, { effectsRetained: true, pushCompleted: true, refPublished: true });
  } catch (cause) {
    artifacts.writeResultUnknown = true;
    try {
      artifacts.remoteRefCurrentOid = remoteOidAtUrl(transport.fetchUrl, remoteRef, cwd);
      artifacts.reobservationExact = true;
      if (artifacts.remoteRefCurrentOid === oid)
        Object.assign(artifacts, { effectsRetained: true, refPublished: true });
    } catch { /* the write outcome remains explicitly unknown */ }
    throw retainedGitEffect('blocked-remote-publication-result-unknown',
      'remote publication did not return a trustworthy result; exact reobservation is attached',
      cause, artifacts);
  }
  try {
    artifacts.remoteRefCurrentOid = remoteOidAtUrl(transport.fetchUrl, remoteRef, cwd);
    artifacts.reobservationExact = true;
    if (remoteTransport(remote, cwd).fetchUrl !== transport.fetchUrl)
      throw transportRace('Git remote changed during publication');
    if (artifacts.remoteRefCurrentOid !== oid)
      throw Object.assign(new Error('published Git ref does not advertise the captured OID'),
        { reason: 'blocked-remote-publication-proof' });
  } catch (cause) {
    throw retainedGitEffect(cause.reason ?? 'blocked-remote-publication-proof',
      'remote publication succeeded but its exact postcondition failed', cause, artifacts);
  }
  return Object.freeze({ schema: 'agentic-os/git-publication/v1', ...artifacts });
}
export function refExists(ref, cwd = process.cwd()) {
  return observeGit(['rev-parse', '--verify', '--quiet', ref], {
    cwd, allowFail: true,
  }) !== null;
}
export function isAncestor(maybeAncestor, descendant, cwd = process.cwd()) {
  return observeGit(['merge-base', '--is-ancestor', maybeAncestor, descendant], {
    cwd, allowFail: true,
  }) !== null;
}

function remoteTrackingSnapshot(remote, cwd) {
  const prefix = `refs/remotes/${remote}/`;
  return observeGitLines([
    'for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)', prefix,
  ], { cwd }).map((line) => {
    const fields = line.split('\0');
    if (fields.length !== 3 || !fields[0].startsWith(prefix)
      || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(fields[1])
      || fields[2] && !fields[2].startsWith('refs/')) {
      throw new Error('remote-tracking ref inventory is malformed');
    }
    return Object.freeze({ ref: fields[0], oid: fields[1], symbolicTarget: fields[2] || null });
  }).sort((left, right) => left.ref.localeCompare(right.ref));
}

function remoteTrackingChanges(before, after) {
  const prior = new Map(before.map((entry) => [entry.ref, entry]));
  const current = new Map(after.map((entry) => [entry.ref, entry]));
  return [...new Set([...prior.keys(), ...current.keys()])].sort().flatMap((ref) => {
    const left = prior.get(ref) ?? null, right = current.get(ref) ?? null;
    return left?.oid === right?.oid && left?.symbolicTarget === right?.symbolicTarget ? []
      : [Object.freeze({ ref, before: left, after: right })];
  });
}

export function fetch(remote, cwd = process.cwd(), expectedUrl = null) {
  // Remote-tracking-ref pruning is a separately governed cleanup effect.
  const transport = capturedTransport(remote, cwd, expectedUrl);
  const before = remoteTrackingSnapshot(transport.name, cwd);
  const artifacts = {
    effectsRetained: false, operation: 'fetch', remote: transport.name,
    url: transport.displayUrl, urlDigest: transport.urlDigest, fetchAttempted: true, fetchCompleted: false,
    fetchHeadWritten: false, autoMaintenanceRun: false,
    writeResultUnknown: false, objectWriteResultUnknown: false,
    reobservationExact: false, refsBefore: before, refsAfter: null, refChanges: null,
  };
  try {
    git(['-c', 'fetch.writeCommitGraph=false', 'fetch', '--no-tags', '--atomic',
      '--no-write-fetch-head', '--no-auto-maintenance',
      '--', transport.fetchUrl,
      `+refs/heads/*:refs/remotes/${transport.name}/*`], { cwd });
    artifacts.fetchCompleted = true;
  } catch (cause) {
    Object.assign(artifacts, { writeResultUnknown: true, objectWriteResultUnknown: true });
    try {
      artifacts.refsAfter = remoteTrackingSnapshot(transport.name, cwd);
      artifacts.refChanges = remoteTrackingChanges(before, artifacts.refsAfter);
      artifacts.reobservationExact = true;
      artifacts.effectsRetained = artifacts.refChanges.length > 0;
    } catch { /* the retained local ref state remains explicitly unknown */ }
    throw retainedGitEffect('blocked-fetch-result-unknown',
      'fetch did not return a trustworthy result; exact local ref reobservation is attached',
      cause, artifacts);
  }
  try {
    artifacts.refsAfter = remoteTrackingSnapshot(transport.name, cwd);
    artifacts.refChanges = remoteTrackingChanges(before, artifacts.refsAfter);
    artifacts.reobservationExact = true;
    artifacts.effectsRetained = artifacts.refChanges.length > 0;
    const after = remoteTransport(remote, cwd);
    if (after.fetchUrl !== transport.fetchUrl)
      throw transportRace('Git remote changed during fetch');
  } catch (cause) {
    artifacts.writeResultUnknown = !artifacts.reobservationExact;
    artifacts.objectWriteResultUnknown = !artifacts.reobservationExact;
    throw retainedGitEffect(cause.reason ?? 'blocked-fetch-postcondition',
      'fetch completed but its exact postcondition failed', cause, artifacts);
  }
  return Object.freeze({ schema: 'agentic-os/git-fetch/v1', ...artifacts });
}

export function worktrees(cwd = process.cwd()) {
  return parseWorktreeList(observeGit(['worktree', 'list', '--porcelain', '-z'], {
    cwd, binary: true, maxBuffer: 16 * 1024 * 1024,
  }));
}

/** Commits on `ref` that are not on `base`, oldest first. */
export function commitsAhead(base, ref, cwd = process.cwd()) {
  return observeGitLines(['rev-list', '--reverse', `${base}..${ref}`], { cwd });
}
