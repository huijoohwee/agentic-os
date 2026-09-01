/** Read-only Git reference adapter for the provider-neutral governance contract. */

import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  commonDir,
  currentBranch,
  decodeNulFields,
  git,
  headSha,
  isAncestor,
  repoRoot,
  untrackedPaths,
  worktreeCleanupRisks,
  worktrees,
} from './git.mjs';
import { readBoundedFile } from './catalog-input.mjs';
import {
  RETAIN_ALL_CLEANUP,
  governanceDigest,
  validateRepositoryProfile,
} from './governance.mjs';

export const REPOSITORY_OBSERVATION_SCHEMA = 'agentic-os/repository-observation/v1';
export const REPOSITORY_PROFILE_FILENAME = '.agentic-os.json';
export const GIT_ADAPTER = Object.freeze({ id: 'git', version: '1' });
export const GIT_CAPABILITIES = Object.freeze([
  'read-only-repository-observation',
  'retain-all-cleanup',
  'shallow-observation-default',
  'deep-byte-audit-opt-in',
]);
const MAX_PROFILE_BYTES = 64 * 1024;
const MAX_OWNED_PATH_SAMPLE = 128;

function blocked(message, reason = 'blocked-repository-identity') {
  const error = new Error(message);
  error.reason = reason;
  throw error;
}

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(frozen);
  return Object.freeze(value);
}

function ref(value, prefix, root) {
  if (typeof value !== 'string' || !value.startsWith(prefix)
    || value.includes('\0') || git(['check-ref-format', value], { cwd: root, allowFail: true }) === null) {
    throw new TypeError(`canonical ref must be a valid ${prefix} ref`);
  }
  return value;
}

function identity(path) {
  const absolute = resolve(path);
  const metadata = lstatSync(absolute, { throwIfNoEntry: false });
  if (!metadata) return null;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    blocked(`registered worktree path is not a direct directory: ${absolute}`);
  }
  const canonicalPath = realpathSync(absolute);
  if (canonicalPath !== absolute) blocked(`registered worktree path resolves elsewhere: ${absolute}`);
  return { path: absolute, dev: metadata.dev, ino: metadata.ino };
}

function assertBinding(before, expectedCommon) {
  const after = identity(before.path);
  if (!after || after.dev !== before.dev || after.ino !== before.ino
    || realpathSync(repoRoot(before.path)) !== before.path
    || realpathSync(commonDir(before.path)) !== expectedCommon) {
    blocked(`registered worktree identity changed or belongs to another clone: ${before.path}`);
  }
}

function relation(localRevision, remoteRevision, root) {
  if (!localRevision || !remoteRevision) return 'unknown';
  if (localRevision === remoteRevision) return 'equal';
  if (isAncestor(localRevision, remoteRevision, root)) return 'behind';
  if (isAncestor(remoteRevision, localRevision, root)) return 'ahead';
  return 'diverged';
}

export function resolveRepositoryRoot(repository = process.cwd()) {
  return realpathSync(repoRoot(resolve(repository)));
}

function hiddenPaths(path) {
  const records = decodeNulFields(git(['ls-files', '-v', '-z'], {
    cwd: path, binary: true, allowFail: true,
  }));
  if (!records) blocked('Git hidden-path inventory is unavailable', 'blocked-invalid-path-inventory');
  return records.filter((record) => {
    const tag = record[0];
    return tag >= 'a' && tag <= 'z' || tag?.toUpperCase() === 'S';
  }).map((record) => record.slice(2));
}

function trackedProjection(path, cached) {
  const fields = decodeNulFields(git([
    'diff', ...(cached ? ['--cached'] : []), '--raw', '-z', '--no-renames', '--abbrev=64',
    ...(cached ? ['HEAD'] : []), '--',
  ], { cwd: path, binary: true, allowFail: true }));
  if (!fields || fields.length % 2 !== 0) {
    blocked('Git tracked projection is unavailable', 'blocked-invalid-path-inventory');
  }
  const entries = [];
  for (let index = 0; index < fields.length; index += 2) {
    const match = fields[index].match(
      /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/u,
    );
    if (!match) blocked('Git tracked projection is malformed', 'blocked-invalid-path-inventory');
    entries.push({
      path: fields[index + 1], status: match[5], oldMode: match[1], newMode: match[2],
      oldObject: match[3], newObject: match[4],
    });
  }
  return entries;
}

function pathSet(paths) {
  const hash = createHash('sha256').update('agentic-os/path-set/v1\0');
  paths.forEach((path) => hash.update(path).update('\0'));
  return {
    ownedPathCount: paths.length,
    ownedPathsDigest: hash.digest('hex'),
    ownedPathsTruncated: paths.length > MAX_OWNED_PATH_SAMPLE,
    ownedPaths: paths.slice(0, MAX_OWNED_PATH_SAMPLE),
  };
}

function risks(path, mode) {
  const headToIndex = trackedProjection(path, true);
  const indexToWorkingTree = trackedProjection(path, false);
  const exact = mode === 'deep' ? worktreeCleanupRisks(path) : null;
  return {
    dirtyTracked: headToIndex.length > 0 || indexToWorkingTree.length > 0,
    hidden: exact?.hidden ?? hiddenPaths(path),
    owned: untrackedPaths(path),
    tracked: exact?.tracked ?? null,
    headToIndex,
    indexToWorkingTree,
  };
}

function projection(entry, expectedCommon, mode) {
  const before = identity(entry.path);
  if (!before) {
    return {
      path: resolve(entry.path), present: false, branch: entry.branch, detached: entry.detached,
      headRevision: null, operationallyClean: null, dirtyTracked: null, hiddenPaths: null,
      headToIndex: null, indexToWorkingTree: null, trackedByteDriftPaths: null,
      ownedPathCount: null, ownedPathsDigest: null,
      ownedPathsTruncated: null, ownedPaths: null,
    };
  }
  assertBinding(before, expectedCommon);
  const observedRisks = risks(before.path, mode);
  const result = {
    path: before.path,
    present: true,
    branch: entry.branch,
    detached: entry.detached,
    headRevision: headSha('HEAD', before.path),
    operationallyClean: !observedRisks.dirtyTracked && observedRisks.hidden.length === 0
      && (observedRisks.tracked === null || observedRisks.tracked.length === 0),
    dirtyTracked: observedRisks.dirtyTracked,
    hiddenPaths: observedRisks.hidden,
    headToIndex: observedRisks.headToIndex,
    indexToWorkingTree: observedRisks.indexToWorkingTree,
    trackedByteDriftPaths: observedRisks.tracked,
    ...pathSet(observedRisks.owned),
  };
  assertBinding(before, expectedCommon);
  return result;
}

function capture(root, expectedCommon, profile, localRef, remoteRef, mode) {
  const localRevision = headSha(localRef, root);
  const remoteRevision = headSha(remoteRef, root);
  const projections = worktrees(root).map((entry) => projection(entry, expectedCommon, mode))
    .sort((left, right) => left.path.localeCompare(right.path));
  const canonical = projections.find((entry) => entry.branch === localRef.slice('refs/heads/'.length));
  const rootIdentity = identity(root);
  assertBinding(rootIdentity, expectedCommon);
  const commonIdentity = lstatSync(expectedCommon);
  return {
    schema: REPOSITORY_OBSERVATION_SCHEMA,
    configuredRepository: profile.repository,
    observedRepository: {
      root, commonDirectory: expectedCommon, rootDevice: rootIdentity.dev,
      rootInode: rootIdentity.ino, commonDevice: commonIdentity.dev, commonInode: commonIdentity.ino,
    },
    adapter: { ...GIT_ADAPTER },
    mode,
    invocationBranch: currentBranch(root),
    canonical: {
      localRef, localRevision, remoteRef, remoteRevision,
      relation: relation(localRevision, remoteRevision, root),
      projectionPath: canonical?.path ?? null,
      operationallyClean: canonical?.operationallyClean ?? null,
    },
    projections,
    capabilities: [...GIT_CAPABILITIES],
    authority: { runtime: 'consumer', release: 'consumer' },
    cleanup: { ...RETAIN_ALL_CLEANUP },
  };
}

export function loadRepositoryProfile({ repository = process.cwd(), profilePath } = {}) {
  const root = resolveRepositoryRoot(repository);
  const path = resolve(profilePath ?? join(root, REPOSITORY_PROFILE_FILENAME));
  if (path !== join(root, REPOSITORY_PROFILE_FILENAME)) {
    throw new TypeError(`repository profile must be ${REPOSITORY_PROFILE_FILENAME} at repository root`);
  }
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(path) !== path) {
    blocked('repository profile must be a direct regular file', 'blocked-repository-profile-identity');
  }
  const bytes = readBoundedFile(path, MAX_PROFILE_BYTES, 'repository profile', {
    expectedIdentity: { dev: metadata.dev, ino: metadata.ino }, expectedPath: path,
  });
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError('repository profile must be UTF-8');
  return validateRepositoryProfile(JSON.parse(text));
}

/** Capture a trusted ref once and read its committed profile from that immutable revision. */
export function observeRepositoryProfileAtRef({ repository = process.cwd(), ref } = {}) {
  const root = resolveRepositoryRoot(repository);
  if (typeof ref !== 'string' || !/^refs\/(?:heads|remotes)\//u.test(ref)
    || git(['check-ref-format', ref], { cwd: root, allowFail: true }) === null) {
    throw new TypeError('trusted repository profile ref is invalid');
  }
  const revision = git(['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: root, allowFail: true,
  });
  if (revision === null) return frozen({ revision: null, profile: null });
  const object = `${revision}:${REPOSITORY_PROFILE_FILENAME}`;
  const sizeText = git(['cat-file', '-s', object], { cwd: root, allowFail: true });
  let profile = null;
  if (sizeText !== null) {
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PROFILE_BYTES
      || git(['cat-file', '-t', object], { cwd: root }) !== 'blob') {
      throw new TypeError('trusted repository profile blob is invalid');
    }
    const bytes = git(['cat-file', 'blob', object], { cwd: root, binary: true });
    if (bytes.length !== size) throw new TypeError('trusted repository profile blob is invalid');
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError('repository profile must be UTF-8');
    profile = validateRepositoryProfile(JSON.parse(text));
  }
  if (headSha(ref, root) !== revision) {
    blocked('trusted canonical ref moved during profile observation', 'blocked-protected-ref-race');
  }
  return frozen({ revision, profile });
}

/** Compatibility projection for callers that only consume committed profile data. */
export function loadRepositoryProfileAtRef(options = {}) {
  return observeRepositoryProfileAtRef(options).profile;
}

export function observeRepository({
  repository = process.cwd(), profile: value, mode = 'shallow',
} = {}) {
  const profile = validateRepositoryProfile(value);
  if (profile.adapters.repository.id !== GIT_ADAPTER.id
    || profile.adapters.repository.version !== GIT_ADAPTER.version) {
    throw new TypeError('repository profile does not select git adapter version 1');
  }
  if (!['shallow', 'deep'].includes(mode)) throw new TypeError('observation mode is invalid');
  const root = resolveRepositoryRoot(repository);
  const expectedCommon = realpathSync(commonDir(root));
  const localRef = ref(profile.canonical.localRef, 'refs/heads/', root);
  const remoteRef = ref(profile.canonical.remoteRef, 'refs/remotes/', root);
  const first = capture(root, expectedCommon, profile, localRef, remoteRef, mode);
  const second = capture(root, expectedCommon, profile, localRef, remoteRef, mode);
  if (governanceDigest(first) !== governanceDigest(second)) {
    blocked('repository changed during observation', 'blocked-repository-observation-race');
  }
  return frozen({ ...second, observationDigest: governanceDigest(second) });
}

export function createGitRepositoryAdapter(options = {}) {
  const repository = resolveRepositoryRoot(options.repository ?? process.cwd());
  const profile = loadRepositoryProfile({ repository, profilePath: options.profilePath });
  const mode = options.mode ?? 'shallow';
  if (!['shallow', 'deep'].includes(mode)) throw new TypeError('observation mode is invalid');
  return Object.freeze({
    ...GIT_ADAPTER,
    capabilities: GIT_CAPABILITIES,
    profile,
    observe: () => observeRepository({ repository, profile, mode }),
  });
}
