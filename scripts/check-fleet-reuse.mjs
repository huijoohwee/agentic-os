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
const short = owner => owner.split('/').at(-1);
const primary = proof => proof.document ?? proof.snapshot ?? proof.pin ?? proof.manifest;
// A consumer declares each owner package once, as a runtime or a development dependency.
const declaredIn = (pkg, name) => [pkg?.dependencies?.[name], pkg?.devDependencies?.[name]].filter(spec => spec !== undefined);

function proofPaths(proof) {
  return [...new Set([proof.pin, proof.projection, proof.manifest, proof.manifest && 'package.json',
    proof.manifest && manifestLock, proof.entry, proof.snapshot, proof.document].filter(Boolean))];
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
  const specs = declaredIn(project, name), declared = specs[0];
  const prefix = role.owner.replace(/^github\.com\//u, '');
  const archive = 'https://codeload.github.com/' + prefix + '/tar.gz/';
  const hosted = 'github:' + prefix + '#';
  const base = [archive, hosted].find(value => typeof declared === 'string' && declared.startsWith(value));
  const revision = base && declared.slice(base.length);
  const locked = declaredIn(lock.packages?.[context], name);
  if (specs.length !== 1 || !oid.test(revision ?? '') || locked.length !== 1 || locked[0] !== declared) {
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

// A snapshot names one exact owner revision: a flat owner map or a consumer artifact source record.
function snapshotRevision(role, read) {
  const value = JSON.parse(read(role.reuse.snapshot));
  return value?.source?.repository === role.owner ? value.source.revision : value?.[short(role.owner)];
}

// Read the governed links from the visible Shared concerns table and its pinned definition.
function documentRevision(role, read) {
  const {document, referenceIds} = role.reuse;
  const markdown = decode(read(document)).replace(/<!--[\s\S]*?(?:-->|$)/gu, '')
    .replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\2[ \t]*$/gmu, '');
  const definitions = markdown.split('\n').filter(line => /^ {0,3}\[gateway\]:/iu.test(line));
  const url = definitions[0]?.trim().replace(/^\[gateway\]:[ \t]*/iu, '') ?? '';
  const revision = url.split('/').at(-3);
  if (definitions.length !== 1 || !oid.test(revision ?? '') ||
      url !== 'https://' + role.owner + '/blob/' + revision + '/references/README.md') fail('invalid Gateway index pin in ' + document);
  const section = markdown.split(/^## Shared concerns[ \t]*$/mu)[1]?.split(/^## /mu)[0] ?? '';
  const links = section.split('\n').filter(line => line.startsWith('|') && line.endsWith('|'))
    .flatMap(line => [...line.matchAll(/(?:^|[ |,(])\[`(guideline\/[a-z0-9-]+)`\]\[gateway\](?=[ ,)|.]|$)/gu)].map(match => match[1]));
  for (const id of referenceIds) {
    if (links.filter(link => link === id).length !== 1) fail('expected one Gateway link for ' + id + ' in ' + document);
  }
  return revision;
}

// The declared owner revision of one binding, without validating it.
function pinnedRevision(role, read) {
  const proof = role.reuse;
  try {
    if (proof.document) return documentRevision(role, read);
    if (proof.snapshot) return snapshotRevision(role, read);
    if (proof.pin) return JSON.parse(read(proof.pin)).revision;
    return (declaredIn(JSON.parse(read(proof.manifest)), proof.package)[0] ?? '').match(/[#/]([a-f0-9]{40})$/u)?.[1];
  } catch { return undefined; }
}

function siblingOwner(root, role) {
  const common = gitText(root,['rev-parse','--path-format=absolute','--git-common-dir']);
  return join(dirname(dirname(common)),role.owner.split('/').at(-1));
}

// Returns the pinned owner revision when the registered source later changed on the protected branch.
function verify(role, root, revision, base, ownerRoot, read) {
  const proof = role.reuse;
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
  if (proof.document) ownerRevision = documentRevision(role, read);
  if (proof.snapshot) {
    ownerRevision = snapshotRevision(role, read);
    if (!oid.test(ownerRevision ?? '')) fail('floating snapshot revision in ' + proof.snapshot);
  }
  // An unchanged protected pin is already a trusted input to candidate verification.
  // Explicit audit and changed pins additionally authenticate bytes in the offline owner checkout.
  if (base) {
    const unchanged = path => !path || !gitText(root,['diff','--name-only',base,revision,'--',path]);
    const sameProjectionPin = unchanged(proof.pin) && unchanged(proof.snapshot) && unchanged(proof.document);
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
    if (sameProjectionPin && samePackage) return null;
  }
  const sourceRoot = ownerRoot ?? siblingOwner(root, role);
  const {source} = readOwnerSource(sourceRoot,role,ownerRevision,limits);
  // A lane or fork commit can carry identical bytes yet disappear with its branch.
  try { git(sourceRoot,['merge-base','--is-ancestor',ownerRevision,'refs/remotes/origin/main']); }
  catch { fail('pinned revision ' + ownerRevision + ' is not on the owner protected branch'); }
  if (proof.document) {
    const ownerFile = path => readOwnerSource(sourceRoot, {...role, source:path}, ownerRevision, limits).bytes;
    const entries = JSON.parse(ownerFile('references/index.json')).entries;
    const headings = decode(ownerFile('references/README.md')).split('\n');
    for (const id of proof.referenceIds) {
      if (entries.filter(row => row.id === id && row.kind === 'guideline').length !== 1 || !headings.includes('### ' + id))
        fail('missing pinned Gateway guideline ' + id);
    }
  }
  if (expected && expected !== source.sha256) fail('projection differs from pinned owner source ' + role.source);
  let current = null;
  try { current = gitText(sourceRoot,['rev-parse','--verify','refs/remotes/origin/main:' + role.source]); } catch { /* moved or removed */ }
  return current === source.blob ? null : ownerRevision;
}

const readPolicy = () => JSON.parse(readBoundedFile(fileURLToPath(policyFile), limits.fileBytes, 'fleet policy'));

// One responsibility may enroll several consumer proofs. Each binding carries exactly one.
export function fleetBindings(repository, policy = readPolicy()) {
  return policy.responsibilities.flatMap(role => [role.reuse ?? []].flat()
    .filter(proof => proof.consumer === repository).map(reuse => ({...role, reuse})));
}

// An enrolled consumer may not carry an owner dependency that no binding names.
function checkCoverage(policy, bindings, repository, root, revision, read) {
  const packages = new Set(policy.responsibilities.flatMap(role => [role.reuse ?? []].flat())
    .map(proof => proof.package).filter(Boolean));
  const owners = policy.repositories.map(entry => entry.id)
    .filter(id => id !== repository && id.startsWith('github.com/'))
    .map(id => [id, new RegExp('(?:github\\.com[/:]|^github:)' + id.slice(11).replace(/[.]/gu, '\\.') + '(?:\\.git)?(?:[#/]|$)', 'iu')]);
  const manifests = decode(execFileSync('git', ['--no-optional-locks','ls-tree','-r','--name-only',revision],
    {cwd: root, timeout: 5000, maxBuffer: 16 * 1024 * 1024})).split('\n')
    .filter(path => /(?:^|\/)package\.json$/u.test(path) && !/(?:^|\/)node_modules\//u.test(path));
  if (manifests.length > 64) fail('manifest budget exceeded');
  for (const manifest of manifests) {
    let project;
    try { project = JSON.parse(read(manifest)); } catch { continue; }
    for (const [name, spec] of ['dependencies','devDependencies','optionalDependencies']
      .flatMap(section => Object.entries(project?.[section] ?? {}))) {
      const owner = owners.find(([, origin]) => origin.test(String(spec)))?.[0];
      if (!owner && !packages.has(name)) continue;
      if (!bindings.some(role => role.reuse.manifest === manifest && role.reuse.package === name
        && (!owner || role.owner === owner))) fail('unregistered owner dependency ' + name + ' in ' + manifest);
    }
  }
}

// Both workflow hooks and the explicit audit inspect Git objects. No candidate code executes.
// `only` restricts the audit to one binding; `fresh` refuses a pin whose registered source moved on.
export function checkFleetReuse({root,repository,revision,base,writePaths,ownerRoot,ownerRoots,fresh,only}) {
  const policy = readPolicy(), bindings = fleetBindings(repository, policy);
  const cache = new Map();
  const read = path => cache.get(path) ?? cache.set(path, readCandidate(root, revision, path)).get(path);
  const checked = [], repairs = [], stale = [];
  const explicit = !writePaths && !base && !only;
  if (explicit && bindings.length) {
    try { checkCoverage(policy, bindings, repository, root, revision, read); }
    catch (error) { throw new Error('fleet-reuse: ' + error.message + '; enroll it in catalog/fleet-ownership.json'); }
  }
  for (const role of only ? [only] : bindings) {
    const paths = proofPaths(role.reuse);
    if (writePaths && !writePaths.some(write => paths.some(path => overlaps(write,path)))) continue;
    if (!writePaths && base && !gitText(root,['diff','--name-only',base,revision,'--',...paths])) continue;
    try {
      const behind = verify(role, root, revision, base, ownerRoots?.get(role.owner) ?? ownerRoot, read);
      // One consumer candidate selects one revision of each owner.
      const mine = pinnedRevision(role, read);
      const rival = bindings.find(other => other.owner === role.owner && pinnedRevision(other, read) !== mine);
      if (rival) fail('conflicting ' + short(role.owner) + ' revisions in ' + primary(role.reuse) + ' and ' + primary(rival.reuse));
      if (behind && fresh) fail('stale pin ' + behind + ': ' + role.source + ' changed on the owner protected branch');
      if (behind) stale.push({capability: role.id, owner: role.owner, revision: behind, source: role.source, path: primary(role.reuse)});
      checked.push(bindings.filter(other => other.id === role.id).length > 1 ? role.id + '@' + primary(role.reuse) : role.id);
    } catch (error) {
      const detail = 'fleet-reuse: ' + role.id + ' requires ' + role.owner + ' (' + paths.join(', ') + '): ' + error.message;
      // A scoped repair lane may open. Publication rechecks the committed candidate.
      if (!writePaths) throw new Error(detail);
      repairs.push(detail);
    }
  }
  return {repository, revision, checked, repairs, stale};
}

// Write fixture objects and the index only in a disposable repository. Its object
// alternate makes even a large consumer tree available without a working copy.
function qualificationFixture(root, revision, role, fixture) {
  const proof = role.reuse, path = proof.projection ?? proof.entry ?? primary(proof);
  const before = readCandidate(root, revision, path);
  let after, reason;
  if (proof.document) {
    const id = proof.referenceIds[0], label = '[`' + id + '`]';
    after = Buffer.from(decode(before).replace(label + '[gateway]', label + '(./local-guideline.md)'));
    reason = 'expected one Gateway link for ' + id + ' in ' + path;
  } else if (proof.projection) {
    after = Buffer.concat([before, Buffer.from('\n')]);
    reason = 'edited projection ' + path;
  } else if (!proof.entry) {
    const value = JSON.parse(decode(before));
    if (proof.snapshot) {
      if (value.source?.repository === role.owner) value.source.revision = 'main'; else value[short(role.owner)] = 'main';
      reason = 'floating snapshot revision in ' + path;
    } else {
      for (const section of ['dependencies','devDependencies']) {
        if (value[section]?.[proof.package]) value[section][proof.package] = 'github:fleet-refusal/fixture#' + '0'.repeat(40);
      }
      reason = 'fork, floating revision or lock disagreement in ' + path;
    }
    after = Buffer.from(JSON.stringify(value));
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

function qualify({root, repository, revision, ownerRoot, fetchOwners, fresh}) {
  const roles = fleetBindings(repository);
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
    const options = {root, repository, revision, ownerRoot, ownerRoots, fresh};
    const accepted = checkFleetReuse(options);
    const fixture = join(scratch, 'fixture');
    git(scratch, ['init', '--quiet', fixture]);
    const objects = gitText(root, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']);
    if (/[\r\n]/u.test(objects)) fail('unsupported Git object directory');
    writeFileSync(join(fixture, '.git/objects/info/alternates'), objects + '\n');
    const refused = roles.map(role => {
      const {candidate, path, reason} = qualificationFixture(root, revision, role, fixture);
      try {
        checkFleetReuse({...options, root: fixture, revision: candidate, only: role});
      } catch (error) {
        if (!error.message.startsWith('fleet-reuse: ' + role.id + ' requires ' + role.owner + ' (') ||
            !error.message.endsWith('): ' + reason)) throw error;
        return {capability: role.id, owner: role.owner, candidate, path, reason};
      }
      fail('accepted substituted candidate for ' + role.id);
    });
    return {repository, revision, accepted: accepted.checked, refused, stale: accepted.stale};
  } finally {
    rmSync(scratch, {recursive: true, force: true});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const {values} = parseArgs({options:{root:{type:'string'},'owner-root':{type:'string'},
      qualify:{type:'boolean'},'fetch-owners':{type:'boolean'},fresh:{type:'boolean'},'expected-repository':{type:'string'},
      'expected-revision':{type:'string'}}});
    const root = resolve(values.root ?? '.');
    const repository = remoteRepositoryIdentity(gitText(root,['remote','get-url','origin']))?.repository.toLowerCase();
    if (!repository) fail('unrecognized repository origin');
    const revision = gitText(root,['rev-parse','HEAD']);
    const options = {root, repository, revision, ownerRoot:values['owner-root'], fresh:values.fresh};
    if (values['expected-repository'] !== undefined && repository !== values['expected-repository'].toLowerCase()) fail('candidate repository mismatch');
    if (values['expected-revision'] !== undefined && revision !== values['expected-revision']) fail('candidate revision mismatch');
    if (values['fetch-owners'] && !values.qualify) fail('--fetch-owners requires --qualify');
    if (options.ownerRoot && new Set(fleetBindings(repository).map(role => role.owner)).size > 1) {
      fail('--owner-root serves one owner; use sibling owner checkouts or --fetch-owners');
    }
    const result = values.qualify ? qualify({...options, fetchOwners:values['fetch-owners']}) : checkFleetReuse(options);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
