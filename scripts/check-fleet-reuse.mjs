import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { parseArgs } from 'node:util';
import { remoteRepositoryIdentity } from '../src/github-rest.mjs';

const policyFile = new URL('../catalog/fleet-ownership.json', import.meta.url);
const limits = { milliseconds: 10000, fileBytes: 500000 };
const decode = bytes => new TextDecoder('utf-8', {fatal: true}).decode(bytes);
const digestBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new TypeError(message); };
const oid = /^[a-f0-9]{40}$/u;

export function readOwnerSource(root, role, revision, limits, started = Date.now()) {
  const actualRoot = realpathSync(root);
  const git = args => {
    const remaining = limits.milliseconds - (Date.now() - started);
    if (remaining <= 0) fail('capability resolution time budget exceeded');
    return execFileSync('git', ['--no-optional-locks', ...args], { cwd: actualRoot,
      timeout: Math.min(2000, remaining), maxBuffer: limits.fileBytes });
  };
  if (realpathSync(decode(git(['rev-parse', '--show-toplevel'])).trim()) !== actualRoot
    || remoteRepositoryIdentity(decode(git(['config', '--get', 'remote.origin.url'])).trim())?.repository.toLowerCase() !== role.owner)
    fail('capability repository identity mismatch');
  if (decode(git(['rev-parse', '--verify', `${revision}^{commit}`])).trim() !== revision)
    fail('capability revision must name an exact commit');
  const entry = decode(git(['ls-tree', '--format=%(objectmode) %(objecttype) %(objectname)', revision, '--', role.source])).trim();
  const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})$/u);
  if (!match) fail('capability source must be one regular Git blob');
  const size = Number(decode(git(['cat-file', '-s', match[2]])).trim());
  if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes) fail('capability source exceeds byte budget');
  const bytes = git(['cat-file', 'blob', match[2]]);
  if (bytes.length !== size) fail('capability source size mismatch');
  const source = { repository: role.owner, revision, path: role.source, blob: match[2],
    sha256: digestBytes(bytes), bytes: size,
    url: role.owner.startsWith('github.com/')
      ? `https://${role.owner}/blob/${revision}/${role.source.split('/').map(encodeURIComponent).join('/')}` : null };
  return {source, bytes};
}

const git = (root, args, input, env) => execFileSync('git', ['--no-optional-locks', ...args], {
  cwd: root, input, env, timeout: 2500, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
});
const gitText = (root, args) => decode(git(root, args)).trim();
const overlaps = (a,b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
const manifestLock = 'package-lock.json';

function proofPaths(proof) {
  return [proof.pin, proof.projection, proof.manifest, proof.manifest && 'package.json',
    proof.manifest && manifestLock, proof.entry].filter(Boolean);
}

function readCandidate(root, rev, path) {
  const entry = gitText(root, ['ls-tree','--format=%(objectmode) %(objecttype) %(objectname)',rev,'--',path]);
  if (!/^100(?:644|755) blob [a-f0-9]{40}$/u.test(entry)) fail('missing or nonregular ' + path);
  const blob = entry.split(' ')[2];
  const max = path === manifestLock ? 1024 * 1024 : limits.fileBytes;
  if (Number(gitText(root,['cat-file','-s',blob])) > max) fail('oversized ' + path);
  return git(root, ['cat-file','blob',blob]);
}

function overridesPackage(overrides, name) {
  if (!overrides || typeof overrides !== 'object') return false;
  return Object.entries(overrides).some(([key, value]) => key === name || key.startsWith(name + '@') ||
    key.endsWith('/' + name) || overridesPackage(value, name));
}

// Parse the committed TypeScript entry without linking or executing its imports.
// The Graph validation host uses Node 22.13+; all other bindings skip this parser.
const parseImports = `
  import { SourceTextModule } from 'node:vm';
  import { stripTypeScriptTypes } from 'node:module';
  import { readFileSync } from 'node:fs';
  const module = new SourceTextModule(stripTypeScriptTypes(readFileSync(0, 'utf8')));
  process.stdout.write(JSON.stringify(module.moduleRequests?.map(r => r.specifier) ?? module.dependencySpecifiers));
`;
function directImports(bytes) {
  try {
    return JSON.parse(execFileSync(process.execPath, ['--no-warnings', '--experimental-vm-modules',
      '--input-type=module', '-e', parseImports], {
      input: bytes, timeout: 5000, maxBuffer: 64000, stdio: ['pipe','pipe','pipe'],
      env: {...process.env, NODE_OPTIONS: ''},
    }));
  } catch {
    fail('could not parse registered TypeScript entry using the Node 22.13+ qualification host');
  }
}

function checkPackage(role, read) {
  const {manifest, package: name, entry, specifier} = role.reuse;
  const project = JSON.parse(read(manifest));
  const host = manifest === 'package.json' ? project : JSON.parse(read('package.json'));
  if ([host, project].some(pkg => overridesPackage(pkg.overrides, name) || overridesPackage(pkg.resolutions, name))) {
    fail('consumer override of ' + name);
  }
  const lock = JSON.parse(read(manifestLock));
  const context = dirname(manifest) === '.' ? '' : dirname(manifest);
  const declared = project.dependencies?.[name];
  const prefix = role.owner.replace(/^github\.com\//u, '');
  const archive = 'https://codeload.github.com/' + prefix + '/tar.gz/';
  const hosted = 'github:' + prefix + '#';
  const base = [archive, hosted].find(value => typeof declared === 'string' && declared.startsWith(value));
  const revision = base && declared.slice(base.length);
  if (!oid.test(revision ?? '') || lock.packages?.[context]?.dependencies?.[name] !== declared) {
    fail('fork, floating revision or lock disagreement in ' + manifest);
  }
  const keys = [context && context + '/node_modules/' + name, 'node_modules/' + name].filter(Boolean);
  const resolved = keys.map(key => lock.packages[key]).find(Boolean);
  const origins = [archive + revision, 'git+ssh://git@github.com/' + prefix + '.git#' + revision,
    'git+https://github.com/' + prefix + '.git#' + revision];
  if (!origins.includes(resolved?.resolved) || !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(resolved.integrity ?? '')) {
    fail('unverified resolved package in ' + manifestLock);
  }
  if (entry) {
    const imports = directImports(read(entry));
    if (!imports.includes(specifier)) fail('registered static import missing from ' + entry);
  }
  return {revision, resolved: resolved.resolved, integrity: resolved.integrity};
}

function siblingOwner(root, role) {
  const common = gitText(root,['rev-parse','--path-format=absolute','--git-common-dir']);
  return join(dirname(dirname(common)),role.owner.split('/').at(-1));
}

function verify(role, root, revision, base, ownerRoot) {
  const proof = role.reuse;
  const read = path => readCandidate(root, revision, path);
  const dependency = proof.manifest && checkPackage(role, read);
  let expected = null, ownerRevision = dependency?.revision;
  if (proof.pin) {
    const pin = JSON.parse(read(proof.pin));
    if ((pin.repository ?? pin.owner) !== role.owner || pin.path !== role.source || !oid.test(pin.revision) ||
        (dependency && dependency.revision !== pin.revision) || (pin.compatibilityPath && pin.compatibilityPath !== proof.projection)) {
      fail('owner, path or revision mismatch in ' + proof.pin);
    }
    expected = digestBytes(read(proof.projection));
    if (pin.sha256 !== expected) fail('edited projection ' + proof.projection);
    ownerRevision = pin.revision;
  }
  // An unchanged protected pin is already a trusted input to candidate verification.
  // Explicit audit and changed pins additionally authenticate bytes in the offline owner checkout.
  if (base) {
    const sameProjectionPin = !proof.pin || !gitText(root,['diff','--name-only',base,revision,'--',proof.pin]);
    let samePackage = !dependency;
    if (dependency) {
      let previous;
      try {
        previous = checkPackage({...role, reuse: {...proof, entry: null}}, path => readCandidate(root, base, path));
      } catch {
        // A missing or malformed predecessor requires full owner verification on repair.
      }
      if (previous?.revision === dependency.revision && previous.integrity !== dependency.integrity) {
        fail('integrity changed for the same pinned owner revision');
      }
      samePackage = previous?.revision === dependency.revision && previous.resolved === dependency.resolved;
    }
    if (sameProjectionPin && samePackage) return;
  }
  const sourceRoot = ownerRoot ?? siblingOwner(root, role);
  const {source} = readOwnerSource(sourceRoot,role,ownerRevision,limits);
  git(sourceRoot,['merge-base','--is-ancestor',ownerRevision,'refs/remotes/origin/main']);
  if (expected && expected !== source.sha256) fail('projection differs from pinned owner source ' + role.source);
}

function enrolledBindings(repository) {
  const policy = JSON.parse(readBoundedFile(fileURLToPath(policyFile), limits.fileBytes, 'fleet policy'));
  return policy.responsibilities.filter(role => role.reuse?.consumer === repository);
}

// Both workflow hooks and the explicit audit inspect Git objects. No candidate code executes.
export function checkFleetReuse({root,repository,revision,base,writePaths,ownerRoot,ownerRoots}) {
  const bindings = enrolledBindings(repository);
  const checked = [], repairs = [];
  for (const role of bindings) {
    const paths = proofPaths(role.reuse);
    if (writePaths && !writePaths.some(write => paths.some(path => overlaps(write,path)))) continue;
    if (!writePaths && base && !gitText(root,['diff','--name-only',base,revision,'--',...paths])) continue;
    try {
      verify(role, root, revision, base, ownerRoots?.get(role.owner) ?? ownerRoot);
      checked.push(role.id);
    } catch (error) {
      const detail = 'fleet-reuse: ' + role.id + ' requires ' + role.owner + ' (' + paths.join(', ') + '): ' + error.message;
      // A scoped repair lane may open. Publication rechecks the committed candidate.
      if (!writePaths) throw new Error(detail);
      repairs.push(detail);
    }
  }
  return {repository, revision, checked, repairs};
}

// Write fixture objects and the index only in a disposable repository. Its object
// alternate makes even a large consumer tree available without a working copy.
function qualificationFixture(root, revision, role, fixture) {
  const path = role.reuse.projection ?? role.reuse.entry;
  if (!path) fail('missing refusal fixture for ' + role.id);
  const before = readCandidate(root, revision, path);
  let after, reason;
  if (role.reuse.projection) {
    after = Buffer.concat([before, Buffer.from('\n')]);
    reason = 'edited projection ' + path;
  } else {
    const source = decode(before);
    const replaced = source.replaceAll(role.reuse.specifier, './fleet-refusal-fixture');
    if (source === replaced) fail('fixture has no registered import to replace');
    after = Buffer.from(replaced);
    reason = 'registered static import missing from ' + path;
  }
  git(fixture, ['read-tree', revision]);
  const mode = gitText(root, ['ls-tree', '--format=%(objectmode)', revision, '--', path]);
  const blob = decode(git(fixture, ['hash-object', '-w', '--stdin'], after)).trim();
  git(fixture, ['update-index', '--cacheinfo', [mode, blob, path].join(',')]);
  const tree = gitText(fixture, ['write-tree']);
  const name = 'Fleet fixture', email = 'fixture@example.invalid', date = '2000-01-01T00:00:00Z';
  const candidate = decode(git(fixture, ['-c', 'commit.gpgsign=false', 'commit-tree', tree, '-p', revision,
    '-m', 'Qualification of ' + role.id], undefined, {...process.env, GIT_AUTHOR_NAME:name,
    GIT_COMMITTER_NAME:name, GIT_AUTHOR_EMAIL:email, GIT_COMMITTER_EMAIL:email, GIT_AUTHOR_DATE:date,
    GIT_COMMITTER_DATE:date})).trim();
  return {candidate, path, reason};
}

function qualify({root, repository, revision, ownerRoot, fetchOwners}) {
  const roles = enrolledBindings(repository);
  if (!roles.length) fail('no enrolled reuse bindings for ' + repository);
  const scratch = mkdtempSync(join(tmpdir(), 'fleet-qualification-'));
  const ownerRoots = new Map();
  try {
    if (fetchOwners) {
      if (ownerRoot) fail('select cached or fetched owner sources');
      for (const owner of new Set(roles.map(role => role.owner))) {
        if (!/^github\.com\/[a-z0-9-]+\/[a-z0-9._-]+$/u.test(owner)) fail('unsupported owner origin');
        const checkout = join(scratch, 'owner-' + ownerRoots.size);
        execFileSync('git', ['clone', '--quiet', '--no-checkout', '--single-branch', '--branch', 'main',
          '--no-tags', 'https://' + owner + '.git', checkout], {timeout: 60000, stdio: ['ignore','pipe','pipe'],
          env: {...process.env, GIT_TERMINAL_PROMPT: '0'}});
        ownerRoots.set(owner, checkout);
      }
    } else {
      for (const role of roles) ownerRoots.set(role.owner, ownerRoot ?? siblingOwner(root, role));
    }
    const options = {root, repository, revision, ownerRoot, ownerRoots};
    const accepted = checkFleetReuse(options);
    const fixture = join(scratch, 'fixture');
    git(scratch, ['init', '--quiet', fixture]);
    const objects = gitText(root, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']);
    if (/[\r\n]/u.test(objects)) fail('unsupported Git object directory');
    writeFileSync(join(fixture, '.git/objects/info/alternates'), objects + '\n');
    const refused = roles.map(role => {
      const {candidate, path, reason} = qualificationFixture(root, revision, role, fixture);
      try {
        checkFleetReuse({...options, root: fixture, revision: candidate});
      } catch (error) {
        if (!error.message.startsWith('fleet-reuse: ' + role.id + ' requires ' + role.owner + ' (') ||
            !error.message.endsWith('): ' + reason)) throw error;
        return {capability: role.id, owner: role.owner, candidate, path, reason};
      }
      fail('accepted substituted candidate for ' + role.id);
    });
    return {repository, revision, accepted: accepted.checked, refused};
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const {values} = parseArgs({options:{root:{type:'string'},'owner-root':{type:'string'},
      qualify:{type:'boolean'},'fetch-owners':{type:'boolean'},'expected-repository':{type:'string'},
      'expected-revision':{type:'string'}}});
    const root = resolve(values.root ?? '.');
    const repository = remoteRepositoryIdentity(gitText(root,['remote','get-url','origin']))?.repository.toLowerCase();
    if (!repository) fail('unrecognized repository origin');
    const revision = gitText(root,['rev-parse','HEAD']);
    const options = {root, repository, revision, ownerRoot:values['owner-root']};
    if (values['expected-repository'] !== undefined && repository !== values['expected-repository'].toLowerCase()) fail('candidate repository mismatch');
    if (values['expected-revision'] !== undefined && revision !== values['expected-revision']) fail('candidate revision mismatch');
    if (values['fetch-owners'] && !values.qualify) fail('--fetch-owners requires --qualify');
    const result = values.qualify ? qualify({...options, fetchOwners:values['fetch-owners']}) : checkFleetReuse(options);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
