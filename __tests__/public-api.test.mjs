import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  AGENTIC_OS_AUTHORITY_PATHS,
  CLASS_AUTHORITY_CONTROLLING,
  classifyPath,
} from '../src/autonomy-class.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  GITHUB_ADAPTER,
  createGitHubAdapter,
  enqueue,
  observeGitHubReview,
} from '../src/github-provider.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function providerRepository(
  t, origin = 'https://github.com/owner/repo.git', remote = 'origin',
) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-github-adapter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['remote', 'add', remote, origin], { cwd: root });
  return root;
}

test('package exports one stable public contract and explicit adapter subpaths', async () => {
  const root = await import('agentic-os');
  const records = await import('agentic-os/records');
  const git = await import('agentic-os/adapters/git');
  const github = await import('agentic-os/adapters/github');
  for (const operation of ['claim', 'continue', 'integrate', 'retire']) {
    assert.equal(typeof root[operation], 'function');
    assert.equal(records[operation], root[operation]);
  }
  assert.equal(typeof records.createAuthorityTransitionReceiptEnvelope, 'function');
  assert.equal(typeof records.validateAuthorityTransitionReceiptEnvelope, 'function');
  assert.equal(Object.hasOwn(records, 'createAuthorityTransitionReceipt'), false);
  assert.equal(typeof git.loadRepositoryProfile, 'function');
  assert.equal(typeof git.createGitRepositoryAdapter, 'function');
  assert.equal(typeof github.observeGitHubReview, 'function');
  assert.equal(typeof github.createGitHubAdapter, 'function');
  await assert.rejects(import('agentic-os/src/git.mjs'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});

test('published files contain public JSON and adapters without deleted deep imports', () => {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  }));
  const files = new Set(packed[0].files.map((entry) => entry.path));
  for (const path of [
    '.agentic-os.json',
    'src/governance.mjs',
    'src/git-repository.mjs',
    'src/github-provider.mjs',
    'docs/GOVERNANCE.md',
  ]) assert.equal(files.has(path), true, `${path} must be packed`);
  assert.equal(files.has('src/bounded-read.mjs'), false);
  assert.equal(files.has('src/readiness-test-reporter.mjs'), false);
  assert.equal(files.has('src/wip.mjs'), false);
});

test('new profile and public modules are exact authority-controlling surfaces', () => {
  for (const path of ['.agentic-os.json', 'src/governance.mjs', 'src/git-repository.mjs']) {
    assert.equal(AGENTIC_OS_AUTHORITY_PATHS.includes(path), true);
    assert.equal(classifyPath(path), CLASS_AUTHORITY_CONTROLLING);
  }
});

test('GitHub facade binds checkout origin, repository, base, source, and consumer authority', (t) => {
  const repository = providerRepository(t);
  const head = 'a'.repeat(40);
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/trunk', remoteRef: 'refs/remotes/origin/trunk' },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { ...GITHUB_ADAPTER },
    },
  });
  const review = {
    number: 7,
    state: 'OPEN',
    url: 'https://github.com/owner/repo/pull/7',
    headRefOid: head,
    headRefName: 'agent/device/scope',
    baseRefName: 'trunk',
    headRepository: { nameWithOwner: 'owner/repo', url: 'https://github.com/owner/repo' },
    baseRepository: { nameWithOwner: 'owner/repo', url: 'https://github.com/owner/repo' },
    isCrossRepository: false,
  };
  const calls = [];
  const observation = observeGitHubReview({
    ref: 'agent/device/scope',
    expectedHead: head,
    profile,
    cwd: repository,
    provider: (args) => { calls.push(args); return [review]; },
  });
  assert.equal(observation.sourceHeadBound, true);
  assert.equal(observation.baseBranch, 'trunk');
  assert.equal(observation.repositoryHost, 'github.com');
  assert.equal(observation.observedRemoteName, 'origin');
  assert.equal(observation.observedRemoteRepository, 'github.com/owner/repo');
  assert.deepEqual(observation.authority, { runtime: 'consumer', release: 'consumer' });
  assert.equal(calls[0][calls[0].indexOf('--repo') + 1], 'github.com/owner/repo');
  assert.equal(calls.every((args) => args[0] === 'pr' && args[1] === 'list'), true);
  assert.equal(Object.isFrozen(observation.review), true);
  assert.throws(() => { observation.review.state = 'MERGED'; }, TypeError);

  const mismatch = observeGitHubReview({
    ref: 'agent/device/scope',
    expectedHead: head,
    profile,
    cwd: repository,
    provider: () => [{ ...review, baseRefName: 'main' }],
  });
  assert.equal(mismatch.sourceHeadBound, false);
  assert.equal(mismatch.reason, 'review-identity-mismatch');
});

test('GitHub facade derives upstream from the profile and rejects divergent push URLs', (t) => {
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/trunk', remoteRef: 'refs/remotes/upstream/trunk' },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { ...GITHUB_ADAPTER },
    },
  });
  const repository = providerRepository(t, 'git@github.com:owner/repo.git', 'upstream');
  execFileSync('git', [
    'remote', 'add', 'origin', 'https://github.com/unrelated/repository.git',
  ], { cwd: repository });
  const observation = observeGitHubReview({
    ref: 'agent/device/scope', expectedHead: 'a'.repeat(40), profile, cwd: repository,
    provider: () => [],
  });
  assert.equal(observation.observedRemoteName, 'upstream');
  assert.equal(observation.observedRemoteRepository, 'github.com/owner/repo');

  execFileSync('git', [
    'remote', 'set-url', '--add', '--push', 'upstream', 'https://github.com/other/repo.git',
  ], { cwd: repository });
  let called = false;
  assert.throws(() => observeGitHubReview({
    ref: 'agent/device/scope', expectedHead: 'a'.repeat(40), profile, cwd: repository,
    provider: () => { called = true; },
  }), (error) => error?.reason === 'blocked-remote-transport-identity');
  assert.equal(called, false);
});

test('GitHub facade rejects unsafe refs and origin mismatch before provider access', (t) => {
  let called = false;
  const receipt = enqueue('--help', {
    expectedHead: 'a'.repeat(40),
    expectedRepository: 'github.com/owner/repo',
    provider: () => { called = true; },
  });
  assert.equal(receipt.reason, 'source-identity-missing');
  assert.equal(called, false);

  const repository = providerRepository(t, 'ssh://git@github.com/other/repo.git');
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: { localRef: 'refs/heads/trunk', remoteRef: 'refs/remotes/origin/trunk' },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { ...GITHUB_ADAPTER },
    },
  });
  assert.throws(() => observeGitHubReview({
    ref: 'agent/device/scope', expectedHead: 'a'.repeat(40), profile, cwd: repository,
    provider: () => { called = true; },
  }), (error) => error?.reason === 'blocked-provider-repository-identity');
  assert.equal(called, false);
});

test('GitHub factory consumes the canonical repository profile', () => {
  const prior = process.cwd();
  let observedCwd = null;
  try {
    process.chdir(ROOT);
    const adapter = createGitHubAdapter({
      repository: '.',
      provider: (args, options) => { observedCwd = options.cwd; return []; },
    });
    process.chdir(resolve(ROOT, '..'));
    assert.equal(adapter.id, 'github');
    assert.equal(adapter.version, '1');
    assert.equal(adapter.profile.repository, 'github.com/huijoohwee/agentic-os');
    assert.equal(Object.hasOwn(adapter, 'enqueue'), false);
    adapter.observe({ ref: 'agent/device/scope', expectedHead: 'a'.repeat(40) });
    assert.equal(observedCwd, ROOT);
  } finally {
    process.chdir(prior);
  }
});

test('GitHub handoff binds an explicit non-main canonical base', () => {
  const head = 'b'.repeat(40);
  let created = false;
  const calls = [];
  const review = {
    state: 'OPEN',
    url: 'https://github.com/owner/repo/pull/9',
    headRefOid: head,
    headRefName: 'agent/device/scope',
    baseRefName: 'trunk',
    headRepository: { nameWithOwner: 'owner/repo' },
    baseRepository: { nameWithOwner: 'owner/repo' },
    isCrossRepository: false,
    body: `Source-Head: ${head}`,
  };
  const provider = (args) => {
    calls.push(args);
    if (args[0] === 'api') return { data: { resource: review } };
    if (args[1] === 'list') return created ? [review] : [];
    if (args[1] === 'create') { created = true; return ''; }
    if (args[1] === 'view') return review;
    return null;
  };
  const receipt = enqueue('agent/device/scope', {
    expectedHead: head,
    expectedRepository: 'github.com/owner/repo',
    baseBranch: 'trunk',
    assertSourceHead: () => true,
    provider,
  });
  const create = calls.find((args) => args[1] === 'create');
  assert.equal(create[create.indexOf('--base') + 1], 'trunk');
  assert.equal(receipt.sourceHeadBound, true);
});

test('documentation states the unsigned and externally authenticated authority boundary', () => {
  const document = readFileSync(resolve(ROOT, 'docs/GOVERNANCE.md'), 'utf8');
  assert.match(document, /construct unsigned Coordination Requests/u);
  assert.match(document, /local SHA-256 digests prove canonical byte integrity, not actor identity/u);
  assert.match(document, /never sufficient to integrate, retire, delete, or clean/u);
  assert.match(document, /one unambiguous fetch URL and one equal push URL before provider/u);
});
