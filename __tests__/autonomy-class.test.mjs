import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  AGENTIC_OS_AUTHORITY_PATHS,
  AUTONOMY_CLASS_SCHEMA,
  CLASS_ADDITIVE_CONTRACT,
  CLASS_AUTHORITY_CONTROLLING,
  CLASS_BEHAVIORAL,
  CLASS_DOCS_ONLY,
  CLASS_ORDER,
  CLASS_TEST_ONLY,
  classifyPath,
  classifyWriteSet,
  collectWriteSet,
  coversClass,
  parseNameStatusZ,
} from '../src/autonomy-class.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function put(root, path, text) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-autonomy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Autonomy Fixture');
  git(root, 'config', 'user.email', 'autonomy@example.invalid');
  put(root, 'docs/old name.md', 'rename me\n');
  put(root, '.github/workflows/ci.yml', 'name: CI\n');
  const profile = createRepositoryProfile({
    repository: 'example.invalid/owner/repository',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  put(root, '.agentic-os.json', `${JSON.stringify(profile, null, 2)}\n`);
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'base');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const base = git(root, 'rev-parse', 'HEAD');

  renameSync(join(root, 'docs/old name.md'), join(root, 'docs/new name.md'));
  renameSync(join(root, '.github/workflows/ci.yml'), join(root, 'docs/retired gate.yml'));
  put(root, 'src/new module.mjs', 'export const added = true;\n');
  put(root, 'docs/tab\tname.md', 'tab path\n');
  put(root, 'docs/line\nbreak.md', 'newline path\n');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'candidate');
  return { root, base, head: git(root, 'rev-parse', 'HEAD') };
}

test('paths derive documentation, test, additive, and behavioral classes', () => {
  assert.equal(classifyPath('docs/guide.md'), CLASS_DOCS_ONLY);
  assert.equal(classifyPath('README.md'), CLASS_DOCS_ONLY);
  assert.equal(classifyPath('__tests__/feature.test.mjs'), CLASS_TEST_ONLY);
  assert.equal(classifyWriteSet([{ path: 'src/new-feature.mjs', added: true }]).class,
    CLASS_ADDITIVE_CONTRACT);
  assert.equal(classifyWriteSet([{ path: 'src/feature.mjs', added: false }]).class,
    CLASS_BEHAVIORAL);
});

test('only additive tests are test-only; weakening existing tests controls authority', () => {
  assert.equal(classifyWriteSet([
    { path: '__tests__/new.test.mjs', status: 'A', added: true },
  ]).class, CLASS_TEST_ONLY);
  for (const entry of [
    { path: '__tests__/guard.test.mjs', status: 'M', added: false },
    { path: '__tests__/guard.test.mjs', status: 'D', added: false },
    {
      previousPath: '__tests__/guard.test.mjs', path: 'docs/retired-test.md',
      status: 'R100', added: false,
    },
  ]) {
    const report = classifyWriteSet([entry]);
    assert.equal(report.class, CLASS_AUTHORITY_CONTROLLING);
    assert.equal(report.escalates, true);
    assert.ok(report.escalatingPaths.includes('__tests__/guard.test.mjs'));
  }
});

test('the classifier and every agentic-os authority surface control authority', () => {
  assert.ok(AGENTIC_OS_AUTHORITY_PATHS.includes('src/autonomy-class.mjs'));
  assert.ok(AGENTIC_OS_AUTHORITY_PATHS.includes('src/mcp-stdio.mjs'));
  for (const path of [
    'src/authority-record.mjs',
    'src/recovery-candidate.mjs',
    'src/recovery-inventory.mjs',
    'src/github-authority.mjs',
    'src/github-authority-issuer.mjs',
    'src/github-authority-operation.mjs',
    'bin/agentic-os-authority.mjs',
  ]) assert.ok(AGENTIC_OS_AUTHORITY_PATHS.includes(path), path);
  assert.equal(classifyPath('src/canonical-sync.mjs'), CLASS_AUTHORITY_CONTROLLING);
  for (const path of AGENTIC_OS_AUTHORITY_PATHS) {
    assert.equal(classifyPath(path), CLASS_AUTHORITY_CONTROLLING, path);
  }
  for (const path of [
    '.githooks/pre-push',
    '.github/workflows/ci.yml',
    '.circleci/config.yml',
    '.gitlab-ci.yml',
    'CODEOWNERS',
    'config/secrets.json',
    'scripts/writer-lease.mjs',
    'src/admission-policy.ts',
    'tools/release.sh',
    'lib/provider-queue.go',
    'bin/publish.py',
  ]) {
    assert.equal(classifyPath(path), CLASS_AUTHORITY_CONTROLLING, path);
  }
  assert.equal(classifyPath('src/feature.mjs'), null);
});

test('mixed changes resolve upward and authority is outside every standing grant', () => {
  const report = classifyWriteSet([
    'docs/notes.md',
    { path: '__tests__/feature.test.mjs', added: true },
    { path: 'src/feature.mjs', added: true },
    { path: 'src/queue.mjs', added: false },
  ]);
  assert.equal(report.schema, AUTONOMY_CLASS_SCHEMA);
  assert.equal(report.class, CLASS_AUTHORITY_CONTROLLING);
  assert.equal(report.escalates, true);
  assert.deepEqual(report.escalatingPaths, ['src/queue.mjs']);
  for (const grantCeiling of CLASS_ORDER) {
    assert.equal(coversClass({ grantCeiling, derivedClass: report.class }), false);
  }
  assert.equal(coversClass({
    grantCeiling: CLASS_BEHAVIORAL,
    derivedClass: CLASS_ADDITIVE_CONTRACT,
  }), true);
  assert.deepEqual(classifyWriteSet([]), {
    schema: AUTONOMY_CLASS_SCHEMA,
    class: CLASS_DOCS_ONLY,
    escalates: false,
    paths: [],
    escalatingPaths: [],
  });
});

test('NUL name-status parsing preserves whitespace and both rename endpoints', () => {
  const parsed = parseNameStatusZ(Buffer.from([
    'A',
    'src/new module.mjs',
    'M',
    'docs/tab\tand\nnewline.md',
    'R075',
    '.github/workflows/ci.yml',
    'docs/retired gate.yml',
    '',
  ].join('\0')));
  assert.deepEqual(parsed, [
    { path: 'src/new module.mjs', status: 'A', added: true },
    { path: 'docs/tab\tand\nnewline.md', status: 'M', added: false },
    {
      path: 'docs/retired gate.yml',
      previousPath: '.github/workflows/ci.yml',
      status: 'R075',
      added: false,
    },
  ]);
  const report = classifyWriteSet(parsed);
  assert.equal(report.class, CLASS_AUTHORITY_CONTROLLING);
  assert.deepEqual(report.escalatingPaths, ['.github/workflows/ci.yml']);
});

test('the NUL parser fails closed on truncated, invalid, and escaping records', () => {
  assert.throws(() => parseNameStatusZ('M\0docs/file.md'), /NUL-terminated/u);
  assert.throws(() => parseNameStatusZ('Q\0docs/file.md\0'), /invalid git name-status/u);
  assert.throws(() => parseNameStatusZ('R100\0docs/old.md\0'), /incomplete git name-status/u);
  assert.throws(() => parseNameStatusZ('M\0../outside\0'), /repository-relative/u);
});

test('write-set collection binds an argv-only merge-base diff with rename detection', () => {
  let observed;
  const entries = collectWriteSet({
    repository: '/repo with spaces',
    base: 'origin/main',
    head: 'HEAD',
    runGit: (args, options) => {
      observed = { args, options };
      return Buffer.from('A\0src/new module.mjs\0');
    },
  });
  assert.deepEqual(observed, {
    args: [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      'origin/main...HEAD',
      '--',
    ],
    options: { cwd: '/repo with spaces' },
  });
  assert.deepEqual(entries, [{ path: 'src/new module.mjs', status: 'A', added: true }]);
  assert.throws(() => collectWriteSet({
    repository: '/repo',
    base: '--output=/tmp/unsafe',
    head: 'HEAD',
    runGit: () => { throw new Error('must not execute'); },
  }), /not a Git option/u);
});

test('a moving base does not add unrelated upstream paths to the lane write set', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-autonomy-diverged-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Autonomy Fixture');
  git(root, 'config', 'user.email', 'autonomy@example.invalid');
  put(root, 'README.md', 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'base');
  git(root, 'switch', '--quiet', '-c', 'candidate');
  put(root, 'docs/lane.md', 'lane change\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'lane');
  const head = git(root, 'rev-parse', 'HEAD');
  git(root, 'switch', '--quiet', 'main');
  put(root, '.github/workflows/upstream.yml', 'name: unrelated upstream\n');
  git(root, 'add', '.');
  git(root, 'commit', '--quiet', '-m', 'upstream');
  const movingBase = git(root, 'rev-parse', 'HEAD');

  const entries = collectWriteSet({ repository: root, base: movingBase, head });
  assert.deepEqual(entries, [{ path: 'docs/lane.md', status: 'A', added: true }]);
  assert.equal(classifyWriteSet(entries).class, CLASS_DOCS_ONLY);
});

test('real git diff and CLI preserve spaces, tabs, newlines, and authority renames', (t) => {
  const { root, base, head } = fixture(t);
  const entries = collectWriteSet({ repository: root, base, head });
  const names = entries.map((entry) => entry.path);
  assert.ok(names.includes('docs/new name.md'));
  assert.ok(names.includes('docs/tab\tname.md'));
  assert.ok(names.includes('docs/line\nbreak.md'));
  assert.ok(entries.some((entry) => (
    entry.previousPath === '.github/workflows/ci.yml'
    && entry.path === 'docs/retired gate.yml'
  )));
  assert.equal(classifyWriteSet(entries).class, CLASS_AUTHORITY_CONTROLLING);

  const run = spawnSync(process.execPath, [
    join(projectRoot, 'bin/agentic-os.mjs'),
    'autonomy-class',
    `--base=${base}`,
    `--head=${head}`,
    '--json',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 2, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.schema, AUTONOMY_CLASS_SCHEMA);
  assert.equal(report.class, CLASS_AUTHORITY_CONTROLLING);
  assert.deepEqual(report.escalatingPaths, ['.github/workflows/ci.yml']);
});

test('the package exposes the concise classifier command', () => {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['autonomy:class'], 'node bin/agentic-os.mjs autonomy-class');
  assert.equal(pkg.scripts.authority, 'node bin/agentic-os-authority.mjs');
});
