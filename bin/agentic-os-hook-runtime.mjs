/** Immutable, package-bound hook runtimes stored inside one clone's Git common directory. */
import { createHash } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { commonDir, repoRoot } from '../src/git.mjs';
import {
  assertPathIdentity, assertPrivateDirectoryIdentity, pathIdentity, privateDirectoryIdentity,
  writePrivateFileExclusive,
} from '../src/file-integrity.mjs';

const RUNTIME_SCHEMA = 'agentic-os/hook-runtime/v1';
const MANIFEST_NAME = 'runtime-manifest.json';
const MAX_RUNTIME_BYTES = 500_000;
const MAX_FILE_BYTES = MAX_RUNTIME_BYTES;
const MAX_MANIFEST_BYTES = 64 * 1024;
// Future releases must explicitly pin each previously shipped runtime identity before migrating it.
const TRUSTED_PRIOR_RUNTIME_IDS = new Set([
  'v1-c738e450c02b8e6ea7cc322e41db9f79ebb9bca15de10545e2a2364973428bd0',
  'v1-aeca6cdae21159346f98bbf744ae7a2b51d95b9040b048bb0cc64b40ea994c72',
  'v1-3feb0c450d39fe8b492c953c1809c622ae9e455505ab3557a44c855b02506913',
]);
const LEGACY_HOOK_SETS = Object.freeze([
  Object.freeze({
    'pre-commit': '124028d56aa2921cf5ff427d2c0b84d661d0214f3acee33f2c1ae5947017984e',
    'pre-push': '7c4a8dc0aec2bd13f7cde285b8a8636fa4f24c2ac8eb284d0efef24e6ebc9463',
  }),
]);
const FILES = Object.freeze([
  Object.freeze({ path: '.githooks/pre-commit', mode: 0o755,
    sha256: '5765f7d3d259e2b11f443c4b68a42d1184e2034e2458fb3451c73f7281337542' }),
  Object.freeze({ path: '.githooks/pre-push', mode: 0o755,
    sha256: '4e0d3796876b900f9d54750e2c537220bf26b15877aaede0096d0dc0838c5af7' }),
  Object.freeze({ path: 'src/guard-main.mjs', mode: 0o755,
    sha256: '74417d1754b6e2ed04fda07c0915b4cd37ffcb5047c9a043e8ec2be0353c57d8' }),
  Object.freeze({ path: 'src/git.mjs', mode: 0o644,
    sha256: '1f483041e700fc091d03624471a276584ce78b92c92b040e0f14600feadd2e62' }),
  Object.freeze({ path: 'src/quarantine.mjs', mode: 0o644,
    sha256: 'f70229577ab83dd398a7e958beb8082b1fe4ecb2683c5f225cc99917d970928d' }),
  Object.freeze({ path: 'src/git-repository.mjs', mode: 0o644,
    sha256: '293725c6285065e102ee55ef5890efe9eb204a29cb7f826d8d0ffb23f4814c26' }),
  Object.freeze({ path: 'src/catalog-input.mjs', mode: 0o644,
    sha256: '057c68168f09cf6b59042b3cd9ed7508314f722b6f881b8ade2b590ba5820667' }),
  Object.freeze({ path: 'src/file-integrity.mjs', mode: 0o644,
    sha256: 'efde3ea4eddeb8bf2e3a3dac8052e333fb38c21dc64de2fca2bcbd987c86579f' }),
  Object.freeze({ path: 'src/governance.mjs', mode: 0o644,
    sha256: 'cb8b7babb2e1340297d79b2fad1af1e95f558d60c4c53f456a101ac279e1b390' }),
  Object.freeze({ path: 'src/lane-id.mjs', mode: 0o644,
    sha256: 'ec8fe90dcbf2f853ed2c4e49efc7573c9cb73b55c4d09a2b4abf10de66b7134a' }),
  Object.freeze({ path: 'src/git-tracked.mjs', mode: 0o644,
    sha256: 'f67351f2b940dc6536d8ccd221662b85fedaa6fdd450efd9b2ca08c4087e2891' }),
  Object.freeze({ path: 'bin/agentic-os-filter-compare.mjs', mode: 0o644,
    sha256: 'afb14ae8138a1007b7fc2c5cf7ef9f905dc68201b1bd092a5e26b70bb46952a7' }),
]);
export const REQUIRED_HOOKS = Object.freeze(FILES
  .filter((file) => file.path.startsWith('.githooks/'))
  .map(({ path, sha256 }) => Object.freeze({ path, sha256 })));

/** Any runtime entry means this clone passed or partially entered managed setup before. */
export function hasHookRuntimeState(cwd) {
  const path = join(commonDir(repoRoot(cwd)), 'agentic-os', 'hook-runtimes');
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (!metadata) return false;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return true;
  try { return readdirSync(path).length > 0; } catch { return true; }
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function blocked(message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), {
    reason: 'blocked-hook-runtime-integrity',
  });
}
function sameNames(actual, expected) {
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((name, index) => name === sorted[index]);
}
function regularFile(path, maxBytes, label, beforeRead = null) {
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    const expected = pathIdentity(path, label);
    if (expected.kind !== 'file') throw new Error(`${label} must be a regular file`);
    descriptor = openSync(path, flags);
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.dev !== expected.dev || before.ino !== expected.ino)
      throw new Error(`${label} pathname changed before inspection`);
    if (before.size > BigInt(maxBytes)) throw new Error(`${label} byte budget exceeded`);
    beforeRead?.({ path, descriptor });
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new Error(`${label} byte budget exceeded`);
    const after = fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || after.size !== BigInt(offset)
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
      throw new Error(`${label} changed during inspection`);
    assertPathIdentity(expected, label);
    return { bytes: Buffer.from(buffer.subarray(0, offset)), mode: Number(after.mode & 0o777n),
      nlink: Number(after.nlink) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
function identity(files) {
  return { schema: RUNTIME_SCHEMA,
    files: files.map(({ path, mode, sha256 }) => ({ path, mode, sha256 })) };
}
function manifestFor(files) {
  const value = identity(files);
  const runtimeId = `v1-${digest(Buffer.from(JSON.stringify(value)))}`;
  const manifest = { schema: value.schema, runtimeId, files: value.files };
  return { runtimeId, manifest,
    manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) };
}
function sourceSnapshot(sourceRoot) {
  let sourceIdentity;
  try {
    sourceIdentity = pathIdentity(sourceRoot, 'packaged runtime root');
    if (sourceIdentity.kind !== 'directory') throw new Error('not a directory');
  } catch (error) { throw blocked(`packaged runtime root is unsafe: ${error.message}`, error); }
  const files = FILES.map((spec) => {
    let snapshot;
    try {
      snapshot = regularFile(join(sourceRoot, spec.path), MAX_FILE_BYTES,
        `packaged runtime ${spec.path}`);
    } catch (error) {
      throw blocked(`packaged runtime ${spec.path} is unsafe: ${error.message}`, error);
    }
    if (snapshot.mode !== spec.mode) {
      throw blocked(`packaged runtime ${spec.path} mode is ${snapshot.mode.toString(8)}; `
        + `expected ${spec.mode.toString(8)}`);
    }
    const actualDigest = digest(snapshot.bytes);
    if (spec.sha256 !== actualDigest)
      throw blocked(`packaged runtime ${spec.path} does not match its release-pinned digest`);
    return { ...spec, bytes: snapshot.bytes };
  });
  const described = manifestFor(files);
  const aggregateBytes = files.reduce((total, file) => total + file.bytes.length, 0)
    + described.manifestBytes.length;
  if (aggregateBytes > MAX_RUNTIME_BYTES)
    throw blocked(`packaged hook runtime exceeds ${MAX_RUNTIME_BYTES} aggregate bytes`);
  assertPathIdentity(sourceIdentity, 'packaged runtime root');
  return { files, aggregateBytes, ...described };
}

/** Select one content-addressed runtime from the exact invoked package closure. */
export function describeHookRuntime(cwd, { sourceRoot }) {
  const root = repoRoot(cwd);
  const snapshot = sourceSnapshot(sourceRoot);
  const managedRoot = join(commonDir(root), 'agentic-os', 'hook-runtimes');
  const path = join(managedRoot, snapshot.runtimeId);
  return { ...snapshot, managedRoot, path, hooksPath: join(path, '.githooks') };
}

function directoryHas(path, names) {
  try {
    const identity = pathIdentity(path, 'hook directory');
    if (identity.kind !== 'directory') return false;
    const actual = readdirSync(path).sort();
    assertPathIdentity(identity, 'hook directory');
    return sameNames(actual, names);
  } catch { return false; }
}
function privateDirectoryHas(path, names) {
  try {
    const identity = privateDirectoryIdentity(path, 'managed hook runtime directory');
    if (!identity) return false;
    const actual = readdirSync(path).sort();
    assertPrivateDirectoryIdentity(identity, 'managed hook runtime directory');
    return sameNames(actual, names);
  } catch { return false; }
}
function layoutOk(runtime, rootIdentity) {
  try { assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root'); } catch { return false; }
  const exact = privateDirectoryHas(runtime.path, ['.githooks', 'bin', MANIFEST_NAME, 'src'])
    && privateDirectoryHas(join(runtime.path, '.githooks'), ['pre-commit', 'pre-push'])
    && privateDirectoryHas(join(runtime.path, 'bin'), FILES
      .filter((file) => file.path.startsWith('bin/')).map((file) => basename(file.path)))
    && privateDirectoryHas(join(runtime.path, 'src'), FILES
      .filter((file) => file.path.startsWith('src/')).map((file) => basename(file.path)));
  try { assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root'); } catch { return false; }
  return exact;
}
const findingKey = (path) => path.startsWith('.githooks/')
  ? `hook.${basename(path)}` : `hook-runtime.${path}`;
function inspectFile(runtime, expected, rootIdentity, beforeFileInspection) {
  try {
    assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
    const actual = regularFile(join(runtime.path, expected.path), MAX_FILE_BYTES,
      `runtime ${expected.path}`, beforeFileInspection);
    assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
    const actualDigest = digest(actual.bytes);
    return {
      key: findingKey(expected.path),
      value: `${expected.sha256} mode ${expected.mode.toString(8)}`,
      actual: `${actualDigest} mode ${actual.mode.toString(8)} links ${actual.nlink}`,
      ok: actualDigest === expected.sha256 && actual.mode === expected.mode && actual.nlink === 1,
      why: 'the managed hook runtime must retain exact package-bound bytes and mode',
    };
  } catch (error) {
    return { key: findingKey(expected.path),
      value: `${expected.sha256} mode ${expected.mode.toString(8)}`,
      actual: `invalid: ${error.code ?? error.message}`, ok: false,
      why: 'the managed hook runtime must contain a bounded regular file' };
  }
}

/** Verify the complete executable dependency closure, manifest, and layout. */
export function inspectHookRuntime(runtime, { beforeFileInspection = null } = {}) {
  let rootIdentity = null;
  try { rootIdentity = privateDirectoryIdentity(runtime.path, 'managed hook runtime root'); } catch {}
  const entries = runtime.files.map((file) => inspectFile(
    runtime, file, rootIdentity, beforeFileInspection));
  try {
    assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
    const actual = regularFile(join(runtime.path, MANIFEST_NAME), MAX_MANIFEST_BYTES,
      'runtime manifest');
    assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
    entries.push({ key: 'hook-runtime.manifest',
      value: `${digest(runtime.manifestBytes)} mode 600`,
      actual: `${digest(actual.bytes)} mode ${actual.mode.toString(8)} links ${actual.nlink}`,
      ok: actual.bytes.equals(runtime.manifestBytes) && actual.mode === 0o600 && actual.nlink === 1,
      why: 'the manifest binds the complete executable dependency closure' });
  } catch (error) {
    entries.push({ key: 'hook-runtime.manifest', value: 'exact regular manifest mode 600',
      actual: `invalid: ${error.code ?? error.message}`, ok: false,
      why: 'the manifest binds the complete executable dependency closure' });
  }
  const exactLayout = layoutOk(runtime, rootIdentity);
  entries.push({ key: 'hook-runtime.layout', value: 'exact closed runtime layout',
    actual: exactLayout ? 'exact' : 'missing, extra, or unsafe entry', ok: exactLayout,
    why: 'unmanifested runtime entries cannot participate in hook execution' });
  return entries;
}
export function assertHookRuntime(runtime) {
  const failed = inspectHookRuntime(runtime).filter((entry) => !entry.ok);
  if (failed.length > 0)
    throw blocked(`managed hook runtime integrity failed: ${failed.map((entry) => entry.key).join(', ')}`);
}

function parseManifest(runtimePath) {
  let rootIdentity;
  try { rootIdentity = privateDirectoryIdentity(runtimePath, 'managed hook runtime root'); }
  catch (error) { throw blocked(error.message, error); }
  let snapshot;
  try {
    snapshot = regularFile(join(runtimePath, MANIFEST_NAME), MAX_MANIFEST_BYTES,
      'managed runtime manifest');
  } catch (error) {
    throw blocked(error.message, error);
  }
  if (snapshot.mode !== 0o600 || snapshot.nlink !== 1)
    throw blocked('managed runtime manifest mode or link count is invalid');
  try { assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root'); }
  catch (error) { throw blocked(error.message, error); }
  const text = snapshot.bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(snapshot.bytes))
    throw blocked('managed runtime manifest must be UTF-8');
  let manifest;
  try { manifest = JSON.parse(text); } catch { throw blocked('managed runtime manifest must be JSON'); }
  const keys = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
    ? Object.keys(manifest).sort() : [];
  if (!sameNames(keys, ['files', 'runtimeId', 'schema'])
    || manifest.schema !== RUNTIME_SCHEMA
    || typeof manifest.runtimeId !== 'string'
    || !/^v1-[0-9a-f]{64}$/u.test(manifest.runtimeId)
    || !Array.isArray(manifest.files) || manifest.files.length !== FILES.length) {
    throw blocked('managed runtime manifest contract is invalid');
  }
  const expected = new Map(FILES.map((file) => [file.path, file.mode]));
  const files = manifest.files.map((file) => {
    const fileKeys = file && typeof file === 'object' && !Array.isArray(file)
      ? Object.keys(file).sort() : [];
    if (!sameNames(fileKeys, ['mode', 'path', 'sha256'])
      || expected.get(file.path) !== file.mode
      || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(file.sha256)) {
      throw blocked('managed runtime file manifest is invalid');
    }
    return { path: file.path, mode: file.mode, sha256: file.sha256 };
  });
  if (new Set(files.map((file) => file.path)).size !== FILES.length)
    throw blocked('managed runtime file manifest contains duplicates');
  const calculated = manifestFor(files);
  if (calculated.runtimeId !== manifest.runtimeId || basename(runtimePath) !== manifest.runtimeId
    || !snapshot.bytes.equals(calculated.manifestBytes)) {
    throw blocked('managed runtime identity does not match its path or manifest');
  }
  return { files, runtimeId: manifest.runtimeId, manifest,
    manifestBytes: calculated.manifestBytes, managedRoot: dirname(runtimePath),
    path: runtimePath, hooksPath: join(runtimePath, '.githooks') };
}

/** Authenticate a previous managed runtime before changing core.hooksPath away from it. */
export function assertPriorManagedRuntime(hooksPath, selectedRuntime) {
  if (basename(hooksPath) !== '.githooks' || dirname(dirname(hooksPath)) !== selectedRuntime.managedRoot)
    return false;
  const prior = parseManifest(dirname(hooksPath));
  if (prior.runtimeId !== selectedRuntime.runtimeId
    && !TRUSTED_PRIOR_RUNTIME_IDS.has(prior.runtimeId)) {
    throw blocked(`prior managed runtime is not release-pinned: ${prior.runtimeId}`);
  }
  assertHookRuntime(prior);
  return true;
}

/** Recognize one moved clone's stale absolute path without trusting an arbitrary existing path. */
export function isRelocatedManagedRuntime(hooksPath, selectedRuntime) {
  if (basename(hooksPath) !== '.githooks') return false;
  const priorRuntime = dirname(hooksPath);
  const priorManagedRoot = dirname(priorRuntime);
  if (basename(priorRuntime) !== selectedRuntime.runtimeId
    || basename(priorManagedRoot) !== 'hook-runtimes'
    || basename(dirname(priorManagedRoot)) !== 'agentic-os'
    || lstatSync(priorRuntime, { throwIfNoEntry: false })) return false;
  assertHookRuntime(selectedRuntime);
  return true;
}

/** Authenticate the exact legacy self hooks; extra hook-manager entries fail closed. */
export function assertLegacyHookDirectory(path, selectedRuntime, { allowPinnedHistory = false } = {}) {
  const expected = selectedRuntime.files.filter((file) => file.path.startsWith('.githooks/'));
  if (!directoryHas(path, expected.map((file) => basename(file.path))))
    throw blocked(`legacy hook path is not the exact agentic-os hook set: ${path}`);
  const observed = {};
  for (const file of expected) {
    let actual;
    try {
      actual = regularFile(join(path, basename(file.path)), MAX_FILE_BYTES,
        `legacy hook ${basename(file.path)}`);
    } catch (error) { throw blocked(error.message, error); }
    if (actual.mode !== file.mode) throw blocked(`legacy hook mode differs: ${path}`);
    observed[basename(file.path)] = digest(actual.bytes);
  }
  const selected = Object.fromEntries(expected.map((file) => [basename(file.path), file.sha256]));
  const allowed = [selected, ...(allowPinnedHistory ? LEGACY_HOOK_SETS : [])];
  if (!allowed.some((set) => Object.entries(observed).every(([name, value]) => set[name] === value)))
    throw blocked(`legacy hook bytes are not a pinned agentic-os runtime: ${path}`);
}

function ensureDirectory(path, onEffect) {
  let metadata = lstatSync(path, { throwIfNoEntry: false });
  if (!metadata) {
    try {
      mkdirSync(path, { mode: 0o700 }); onEffect?.({ kind: 'directory-created', path });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  try {
    const identity = privateDirectoryIdentity(path, 'managed runtime ancestor');
    if (!identity) throw new Error('missing');
    return identity;
  } catch (error) { throw blocked(`managed runtime ancestor is unsafe: ${path}`, error); }
}
function writeRuntime(runtime, path, rootIdentity) {
  assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
  const directories = new Map();
  for (const name of ['.githooks', 'bin', 'src']) {
    assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
    const directory = join(path, name); mkdirSync(directory, { mode: 0o700 });
    directories.set(name, privateDirectoryIdentity(directory, `managed runtime ${name}`));
  }
  for (const file of runtime.files) {
    assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
    const parent = directories.get(file.path.split('/')[0]);
    assertPrivateDirectoryIdentity(parent, 'managed hook runtime file directory');
    const target = join(path, file.path);
    writePrivateFileExclusive(target, file.bytes, {
      maxBytes: MAX_FILE_BYTES, mode: file.mode, label: `managed runtime ${file.path}`,
    });
    assertPrivateDirectoryIdentity(parent, 'managed hook runtime file directory');
  }
  assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
  const manifest = join(path, MANIFEST_NAME);
  writePrivateFileExclusive(manifest, runtime.manifestBytes, {
    maxBytes: MAX_MANIFEST_BYTES, mode: 0o600, label: 'managed runtime manifest',
  });
  assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
}

/** Exclusively publish files into a new digest directory, manifest last; partial residue is retained. */
export function installHookRuntime(runtime, {
  onEffect = null, beforeRuntimeCreate = null, beforeWrite = null,
} = {}) {
  const stateRoot = ensureDirectory(dirname(runtime.managedRoot), onEffect);
  const managedRoot = ensureDirectory(runtime.managedRoot, onEffect);
  if (lstatSync(runtime.path, { throwIfNoEntry: false })) {
    assertHookRuntime(runtime);
    assertPrivateDirectoryIdentity(stateRoot, 'managed runtime state root');
    assertPrivateDirectoryIdentity(managedRoot, 'managed runtimes root');
    return false;
  }
  beforeRuntimeCreate?.({ runtime });
  assertPrivateDirectoryIdentity(stateRoot, 'managed runtime state root');
  assertPrivateDirectoryIdentity(managedRoot, 'managed runtimes root');
  try {
    mkdirSync(runtime.path, { mode: 0o700 });
    onEffect?.({ kind: 'directory-created', path: runtime.path });
  } catch (error) {
    if (error.code === 'EEXIST') {
      assertHookRuntime(runtime);
      return false;
    }
    throw error;
  }
  const rootIdentity = privateDirectoryIdentity(runtime.path, 'managed hook runtime root');
  if (!rootIdentity) throw blocked('managed hook runtime root is missing after creation');
  try {
    beforeWrite?.({ runtime });
    assertPrivateDirectoryIdentity(stateRoot, 'managed runtime state root');
    assertPrivateDirectoryIdentity(managedRoot, 'managed runtimes root');
    assertPrivateDirectoryIdentity(rootIdentity, 'managed hook runtime root');
    writeRuntime(runtime, runtime.path, rootIdentity);
    assertHookRuntime(runtime);
    return true;
  } catch (error) {
    throw blocked(`${error.message}; partial digest-named runtime residue retained at ${runtime.path}`,
      error);
  }
}
