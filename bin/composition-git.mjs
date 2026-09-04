/** Trusted, configuration-scrubbed Git observations for composition evidence. */
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { decodeNulFields, gitBlobOid } from '../src/git-tracked.mjs';

const CANDIDATES = process.platform === 'win32'
  ? Object.freeze([]) : Object.freeze(['/usr/bin/git', '/bin/git']);
const CONFIG = Object.freeze([
  ['core.fsmonitor', 'false'], ['core.untrackedCache', 'false'], ['diff.external', ''],
  ['core.commitGraph', 'false'],
  ['core.attributesfile', '/dev/null'], ['core.excludesfile', '/dev/null'],
]);

const TRUSTED = resolveTrustedGit();
export const TRUSTED_COMPOSITION_GIT = TRUSTED.path;

export function observeCompositionGit(args, {
  cwd = process.cwd(), allowFail = false, binary = false, raw = false,
  maxBuffer = 4_194_304,
} = {}) {
  if (!Array.isArray(args) || args.length === 0
    || args.some(value => typeof value !== 'string' || value.includes('\0'))) {
    if (allowFail) return null;
    throw new TypeError('composition Git arguments invalid');
  }
  assertTrustedGit(TRUSTED_COMPOSITION_GIT, TRUSTED.stat);
  const safeArgs = args[0] === 'diff'
    ? ['diff', '--no-ext-diff', '--no-textconv', ...args.slice(1)] : args;
  try {
    const output = execFileSync(TRUSTED_COMPOSITION_GIT, safeArgs, {
      cwd, env: observationEnvironment(), encoding: binary ? undefined : 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer,
    });
    assertTrustedGit(TRUSTED_COMPOSITION_GIT, TRUSTED.stat);
    return binary || raw ? output : output.trim();
  } catch (error) {
    if (allowFail) return null;
    const status = Number.isInteger(error?.status) ? error.status : -1;
    throw new Error(`trusted composition Git observation failed (${status})`);
  }
}

/** Read one regular candidate file and prove its bytes are the exact HEAD blob. */
export function readCompositionHeadFile(rootValue, revision, relative, maximum, label) {
  if (typeof rootValue !== 'string' || rootValue === '' || typeof relative !== 'string'
    || relative === '' || path.isAbsolute(relative) || path.posix.normalize(relative) !== relative
    || relative.startsWith('../') || relative.includes('\\')
    || !/^[0-9a-f]{40}$/u.test(revision ?? '')) {
    throw coded('composition_head_file_path_invalid');
  }
  let root, target;
  try {
    root = realpathSync(rootValue); target = path.resolve(root, relative);
    if (!inside(root, target) || realpathSync(target) !== target || !lstatSync(target).isFile()) {
      throw new Error();
    }
  } catch { throw coded('composition_head_file_unreadable'); }
  const fields = decodeNulFields(observeCompositionGit([
    '--literal-pathspecs', 'ls-tree', '-z', revision, '--', relative,
  ], { cwd: root, binary: true, allowFail: true }));
  if (!fields || fields.length !== 1) throw coded('composition_head_file_untracked');
  const tab = fields[0].indexOf('\t');
  const match = tab < 0 ? null
    : fields[0].slice(0, tab).match(/^100(?:644|755) blob ([0-9a-f]{40}(?:[0-9a-f]{24})?)$/u);
  if (!match || fields[0].slice(tab + 1) !== relative) {
    throw coded('composition_head_file_untracked');
  }
  let bytes;
  try { bytes = readBoundedFile(target, maximum, label, { expectedPath: target }); }
  catch { throw coded('composition_head_file_unreadable'); }
  if (gitBlobOid(bytes, match[1]) !== match[1]) {
    throw coded('composition_head_file_bytes_unbound');
  }
  return Object.freeze({ absolute: target, bytes, oid: match[1] });
}

export function compositionRevision(root) {
  if (typeof root !== 'string' || root === '') return null;
  const revision = observeCompositionGit(['rev-parse', '--verify', 'HEAD'], {
    cwd: root, allowFail: true,
  });
  return /^[0-9a-f]{40}$/u.test(revision ?? '') ? revision : null;
}

/** Decode exactly one nonempty UTF-8 value and its one terminating NUL. */
export function decodeSingleCompositionConfigValue(value) {
  if (!Buffer.isBuffer(value) || value.length < 2 || value.at(-1) !== 0
    || value.subarray(0, -1).includes(0)) return null;
  const bytes = value.subarray(0, -1), decoded = bytes.toString('utf8');
  return decoded !== '' && Buffer.from(decoded, 'utf8').equals(bytes) ? decoded : null;
}

/** Require raw origin configuration and Git's effective fetch/push targets to agree exactly. */
export function compositionOriginUrl(root) {
  const raw = decodeSingleCompositionConfigValue(observeCompositionGit([
    'config', '--no-includes', '--null', '--get-all', 'remote.origin.url',
  ], { cwd: root, binary: true, allowFail: true }));
  const rawPush = observeCompositionGit([
    'config', '--no-includes', '--null', '--get-all', 'remote.origin.pushurl',
  ], { cwd: root, binary: true, allowFail: true });
  if (raw === null || rawPush !== null) return null;
  const expected = Buffer.from(`${raw}\n`, 'utf8');
  const fetch = observeCompositionGit(['remote', 'get-url', '--all', 'origin'], {
    cwd: root, binary: true, allowFail: true,
  });
  const push = observeCompositionGit(['remote', 'get-url', '--push', '--all', 'origin'], {
    cwd: root, binary: true, allowFail: true,
  });
  return Buffer.isBuffer(fetch) && fetch.equals(expected)
    && Buffer.isBuffer(push) && push.equals(expected) ? raw : null;
}

function resolveTrustedGit() {
  for (const candidate of CANDIDATES) {
    try {
      const canonical = realpathSync(candidate);
      const stat = assertTrustedGit(canonical);
      return Object.freeze({ path: canonical, stat });
    } catch {}
  }
  throw new Error('trusted composition Git executable unavailable');
}
function assertTrustedGit(target, expected = null) {
  if (realpathSync(target) !== target) throw new Error('trusted composition Git path changed');
  const stat = lstatSync(target, { bigint: true });
  if (!stat.isFile() || stat.nlink < 1n || stat.mode & 0o022n
    || stat.uid !== 0n || expected && !sameIdentity(stat, expected)) {
    throw new Error('trusted composition Git executable is mutable or invalid');
  }
  return stat;
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.uid === right.uid && left.gid === right.gid && left.nlink === right.nlink
    && left.size === right.size && left.ctimeNs === right.ctimeNs && left.mtimeNs === right.mtimeNs;
}
function observationEnvironment() {
  const environment = {
    LANG: 'C', LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_COUNT: String(CONFIG.length),
  };
  CONFIG.forEach(([key, value], index) => {
    environment[`GIT_CONFIG_KEY_${index}`] = key;
    environment[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return environment;
}
function inside(root, target) { const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }
function coded(code) { return Object.assign(new Error(code), { code }); }
