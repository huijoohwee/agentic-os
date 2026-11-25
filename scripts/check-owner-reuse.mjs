// Compare committed trees. Historical citations and pinned projections are bounded to their audited path.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const policyFile = new URL('../catalog/owner-reuse.json', import.meta.url);
const readPolicy = () => JSON.parse(readFileSync(policyFile));
const oid = /^[a-f\d]{40}$/;
const bound = 16 * 1024 * 1024;
const git = (cwd, args) => execFileSync('git', ['--no-replace-objects', ...args],
  { cwd, encoding: 'utf8', maxBuffer: bound, timeout: 60000, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
const sources = {
  'agentic-gateway': /^(?:(?:resolver|references|provider-profiles|presets)\.mjs|(?:transfer|connectors)\/[^/]+\.(?:mjs|json|py)|catalog\/PROMPT-PRESETS\.md)$/,
  'agentic-design-system': /^(?:site\/(?:[^/]+\.(?:js|mjs|css|json)|(?:tokens|vendor)\/[^/]+\.(?:json|css))|packages\/react-[^/]+\/src\/.+\.tsx?)$/,
  'agentic-sheets': /^sheets\/[^/]+\.(?:mjs|css|json)$/,
  'agentic-base': /^(?:src\/.*\.mjs|packages\/views-react\/src\/.+\.(?:ts|tsx|mjs))$/,
  'agentic-geo': /^src\/core\.mjs$/,
};
function tree(cwd, rev) {
  const rows = new Map();
  for (const record of git(cwd, ['ls-tree', '-rz', rev]).split('\0')) {
    if (!record) continue;
    const split = record.indexOf('\t'), [mode, kind, hash] = record.slice(0, split).split(' ');
    if (kind === 'blob') rows.set(record.slice(split + 1), { hash, mode });
  }
  return rows;
}
const regular = entry => ['100644', '100755'].includes(entry?.mode);
const read = (root, rev, path) => git(root, ['show', rev + ':' + path]);
function catalog(workspace, {pins, baselines}) {
  const gateway = join(workspace, 'agentic-gateway'), revision = pins['agentic-gateway'];
  const index = read(gateway, revision, 'references/index.json');
  if (createHash('sha256').update(index).digest('hex') !== JSON.parse(read(gateway, revision, 'references/pin.json')).indexDigest) throw Error('Gateway index digest mismatch');
  const refs = JSON.parse(index).entries;
  const assets = [];
  for (const [owner, select] of Object.entries(sources)) {
    const root = join(workspace, owner), rev = pins[owner];
    git(root, ['merge-base', '--is-ancestor', rev, 'refs/remotes/origin/main']);
    const files = tree(root, rev);
    const paths = [...files.keys()].filter(path => select.test(path) && regular(files.get(path)) && !/\.(?:test|spec)\./.test(path)).sort();
    const history = git(root, ['log', '--format=', '--raw', '--no-abbrev', '--no-renames', rev, '--', ...paths]);
    const versions = new Map(paths.map(path => [path, new Set([files.get(path).hash])]));
    for (const line of history.split('\n')) {
      const match = /^:\d+ 100(?:644|755) [a-f\d]{40} ([a-f\d]{40}) [AMT]\t(.+)$/.exec(line);
      if (match && versions.has(match[2])) versions.get(match[2]).add(match[1]);
    }
    for (const [path, hashes] of versions) assets.push([owner, path, files.get(path).hash, ...[...hashes].filter(hash => hash !== files.get(path).hash).sort()]);
  }
  for (const { owner, path, revision, digest } of refs) {
    const root = join(workspace, owner);
    git(root, ['merge-base', '--is-ancestor', revision, 'refs/remotes/origin/main']);
    if (createHash('sha256').update(read(root, revision, path)).digest('hex') !== digest) throw Error('Invalid Gateway body: ' + path);
    assets.push([owner, path, git(root, ['rev-parse', revision + ':' + path]).trim()]);
  }
  return { baselines, pins, references: refs.map(({id, owner, path}) => ({id, owner, path})), assets };
}
function serialize(policy) {
  return JSON.stringify({baselines: policy.baselines, pins: policy.pins, references: policy.references}, null, 2).slice(0, -2) +
    ',\n  "assets": [\n' + policy.assets.map(row => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n';
}
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function directReferences(root, rev, repo, policy, paths) {
  // Gateway describes the owner index. An owner can cite its own published sources.
  const refs = policy.references.filter(ref => ref.owner !== repo);
  if (!refs.length) return new Map();
  const pattern = refs.map(({owner, path}) => escape(owner) + '([/@:]((blob|raw|tree)/)?[[:alnum:]_.-]+)?[/:]' + escape(path)).join('|');
  if (paths && !paths.length) return new Map();
  if (paths?.length > 128) {
    const counts = new Map();
    for (let i = 0; i < paths.length; i += 128) for (const [k,v] of directReferences(root, rev, repo, policy, paths.slice(i,i+128))) counts.set(k,v);
    return counts;
  }
  const result = spawnSync('git', ['--no-replace-objects','--literal-pathspecs','grep','-IzoE',pattern,rev,'--',...(paths ?? [])], {cwd:root,encoding:'utf8',maxBuffer:bound,timeout:60000});
  if (result.error || ![0,1].includes(result.status)) throw result.error ?? Error(result.stderr);
  const counts = new Map();
  for (const match of result.stdout.matchAll(/([^\0]+)\0([^\n]+)\n/g)) {
    const path = match[1].slice(rev.length + 1);
    if (repo === 'agentic-gateway' && /^references\/(README\.md|index\.json|owners\.json)$/.test(path)) continue;
    const key = path + '\0' + match[2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
function packageOwner(name) {
  return Object.keys(sources).find(owner => name === owner || name.startsWith('@' + owner + '/'));
}
function overridden(settings) {
  return Object.entries(settings ?? {}).some(([key, value]) => Object.keys(sources).some(owner =>
    key.split('/').includes(owner) || key === '@' + owner || key.startsWith('@' + owner + '/') || key.startsWith(owner + '@')) ||
    (typeof value === 'object' && value !== null && overridden(value)));
}
function checkPackages(root, revision, files, errors) {
  const locks = new Map();
  function locked(path) {
    if (!locks.has(path)) locks.set(path, JSON.parse(read(root, revision, path)).packages);
    return locks.get(path);
  }
  for (const [path, entry] of files) {
    if (basename(path) !== 'package.json') continue;
    if (!regular(entry)) { errors.push(path + ': package manifest must be a file'); continue; }
    const pkg = JSON.parse(read(root, revision, path));
    if (overridden(pkg.overrides) || overridden(pkg.resolutions)) errors.push(path + ': owner package override');
    for (const section of ['dependencies','devDependencies','optionalDependencies']) {
      for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
        const owner = packageOwner(name);
        if (!owner && Object.keys(sources).some(id => spec.startsWith('npm:' + id + '@') || spec.startsWith('npm:@' + id + '/'))) {
          errors.push(path + ': use the owner package name for ' + name);
        }
        if (!owner) continue;
        const pin = spec.match(/[#/]([a-f\d]{40})$/)?.[1], identity = 'huijoohwee/' + owner;
        const archive = 'https://codeload.github.com/' + identity + '/tar.gz/' + pin;
        let dir = dirname(path), lock;
        while (true) {
          const candidate = join(dir, 'package-lock.json');
          if (files.has(candidate)) { lock = locked(candidate); break; }
          if (dir === '.') break;
          dir = dirname(dir);
        }
        const context = path.slice(dir === '.' ? 0 : dir.length + 1, -'package.json'.length).replace(/\/$/, '');
        let install = context, resolved;
        while (true) {
          resolved = lock?.[join(install, 'node_modules', name)];
          if (resolved || !install) break;
          install = dirname(install);
          if (install === '.') install = '';
        }
        if (!pin || ![archive, 'github:' + identity + '#' + pin].includes(spec) ||
          lock?.[context]?.[section]?.[name] !== spec || ![archive, ...['ssh://git@','https://'].map(protocol =>
            'git+' + protocol + 'github.com/' + identity + '.git#' + pin)].includes(resolved?.resolved) ||
          !/^sha512-[A-Za-z0-9+/]{86}==$/.test(resolved?.integrity ?? '')) errors.push(path + ': expected locked ' + owner + ' package for ' + name);
      }
    }
  }
}
export function audit(root, repo, baseline, revision, policy = readPolicy()) {
  if (![baseline, revision].every(value => oid.test(value))) throw Error('Expected full Git commit IDs');
  if (policy.baselines && createHash('sha256').update(repo + '@' + baseline).digest('hex') !== policy.baselines[repo]) {
    throw Error('Unknown repository or unapproved consumer baseline');
  }
  const previous = tree(root, baseline), candidate = tree(root, revision), errors = [];
  const byHash = new Map();
  for (const [owner,path,...hashes] of policy.assets) for (const hash of hashes) {
    if (!byHash.has(hash)) byHash.set(hash, new Set());
    byHash.get(hash).add(owner + '/' + path);
  }
  const manifest = '.agentic-os/owner-projections.json', enrolled = new Set();
  if (candidate.has(manifest)) {
    if (!regular(candidate.get(manifest))) throw Error('Invalid owner projection manifest');
    const records = JSON.parse(read(root, revision, manifest));
    for (const [path, {owner, source, pin}] of Object.entries(records)) {
      const asset = policy.assets.find(row => row[0] === owner && row[1] === source);
      const file = candidate.get(path);
      if (!asset || pin !== policy.pins[owner] || !regular(file) || file.hash !== asset[2]) {
        errors.push(path + ': projection does not match its pinned owner bytes');
      } else enrolled.add(path);
    }
  }
  let copies = 0;
  for (const [path, current] of candidate) {
    const before = previous.get(path), now = byHash.get(current.hash), was = byHash.get(before?.hash);
    if (now?.has(repo + '/' + path) || was?.has(repo + '/' + path)) continue;
    if (now) copies++;
    if (enrolled.has(path)) continue;
    if (current.hash === before?.hash && current.mode === before?.mode) continue;
    if (now || was) {
      if (!regular(current) || !now || !was || ![...now].some(key => was.has(key))) {
        errors.push(path + ': reuse the owner package or refresh an enrolled projection from ' + [...(was ?? now)][0]);
      }
    }
  }
  const changed = baseline === revision ? undefined : [...candidate.keys()].filter(path => previous.get(path)?.hash !== candidate.get(path).hash);
  const existing = directReferences(root, baseline, repo, policy, changed);
  const current = baseline === revision ? existing : directReferences(root, revision, repo, policy, changed);
  for (const [key, count] of current) if (count > (existing.get(key) ?? 0)) errors.push(key.replace('\0', ': ') + ' must resolve through Gateway references');
  checkPackages(root, revision, candidate, errors);
  return { repo, baseline, revision, files: candidate.size, projections: copies, referenceScope: changed ? 'changed files' : 'full tree', directReferences: [...current.values()].reduce((a,b) => a+b, 0), errors };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options:Object.fromEntries(['build','root','repo','base','revision'].map(key => [key,{type:'string'}]))});
  if (values.build) writeFileSync(policyFile, serialize(catalog(values.build, readPolicy())));
  else {
    const result = audit(values.root ?? '.', values.repo, values.base, values.revision);
    console.log(JSON.stringify(result));
    if (result.errors.length) process.exitCode = 1;
  }
}
