import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const runGit = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function copiedRuntime(t) {
  const parent = mkdtempSync(join(tmpdir(), 'agentic-os-space-entrypoints-'));
  const runtime = join(parent, 'runtime with spaces');
  cpSync(SOURCE_ROOT, runtime, {
    recursive: true,
    filter: (source) => {
      const parts = relative(SOURCE_ROOT, source).split(sep);
      return !parts.includes('.git') && !parts.includes('node_modules');
    },
  });
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  return { parent, runtime };
}

test('space-bearing runtime paths execute guards and budget/readiness entrypoints', (t) => {
  const { parent, runtime } = copiedRuntime(t);
  const repository = join(parent, 'repository with spaces');
  mkdirSync(repository);
  runGit(repository, 'init', '--quiet', '--initial-branch=main');
  runGit(repository, 'config', 'user.name', 'Fixture');
  runGit(repository, 'config', 'user.email', 'fixture@example.invalid');
  const profile = createRepositoryProfile({
    repository: 'local:space-path-fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/upstream/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
  });
  writeFileSync(join(repository, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
  runGit(repository, 'add', '.agentic-os.json');
  runGit(repository, 'commit', '--quiet', '--message', 'profile');
  ensureRepositoryTrust(repository, profile, { allowCreate: true });
  const head = runGit(repository, 'rev-parse', 'HEAD');

  const preCommit = spawnSync(join(runtime, '.githooks', 'pre-commit'), [], {
    cwd: repository, encoding: 'utf8',
  });
  assert.equal(preCommit.status, 1, preCommit.stderr);
  assert.match(preCommit.stderr, /refusing to commit on "main"/u);

  const prePush = spawnSync(join(runtime, '.githooks', 'pre-push'), ['upstream', 'fixture'], {
    cwd: repository, encoding: 'utf8',
    input: `refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`,
  });
  assert.equal(prePush.status, 1, prePush.stderr);
  assert.match(prePush.stderr, /refusing to push directly to refs\/heads\/main/u);

  for (const [path, output] of [
    [['bin', 'agentic-os-module-budget.mjs'], /modules 28\/29/u],
    [['bin', 'agentic-os-doc-budget.mjs'], /always-load total/u],
    [['src', 'readiness-proof.mjs'], /readiness proof/u],
  ]) {
    const result = spawnSync(process.execPath, [join(runtime, ...path)], {
      cwd: runtime, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.status, 0, `${path.join('/')}: ${result.stderr}\n${result.stdout}`);
    assert.match(result.stdout, output);
  }
  const rank = spawnSync(process.execPath, [join(runtime, 'src', 'rank.mjs')], {
    cwd: runtime, encoding: 'utf8', timeout: 30_000,
  });
  assert.ok([0, 2].includes(rank.status), rank.stderr);
  assert.match(rank.stdout, /"schema": "agentic-os-feature-ranking\/v1"/u);
});
