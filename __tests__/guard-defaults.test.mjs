import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, OVERRIDE_ENV } from '../src/guard-main.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';

const GUARD = fileURLToPath(new URL('../src/guard-main.mjs', import.meta.url));

test('the guard refuses commits on the protected branch', () => {
  const verdict = evaluate({ branch: 'main', phase: 'commit', protectedBranch: 'main' });
  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, 'blocked-canonical-authoring');
  assert.match(verdict.message, /npm run lane/u);
});

test('the protected-branch refusal can append an actionable advisory', () => {
  const verdict = evaluate({
    branch: 'main',
    phase: 'commit',
    protectedBranch: 'main',
    advisory: 'No lane is open for this clone yet.',
  });
  assert.equal(verdict.allow, false);
  assert.match(verdict.message, /No lane is open for this clone yet\./u);
});

test('the guard allows lanes and refuses every unbound authoring surface', () => {
  assert.equal(evaluate({
    branch: 'agent/dev/scope', phase: 'commit', protectedBranch: 'main',
  }).allow, true);
  for (const branch of [null, 'feature/unbound']) {
    const verdict = evaluate({ branch, phase: 'commit', protectedBranch: 'main' });
    assert.equal(verdict.allow, false);
    assert.equal(verdict.reason, 'blocked-non-lane-authoring');
  }
});

test('the guard has an explicit, named override', () => {
  const verdict = evaluate({
    branch: 'main', phase: 'commit', override: '1', protectedBranch: 'main',
  });
  assert.equal(verdict.allow, true);
  assert.match(verdict.note, new RegExp(OVERRIDE_ENV));
  assert.equal(evaluate({ branch: 'main', phase: 'commit', override: '1' }).allow, true);
  assert.throws(() => evaluate({ branch: 'main', phase: 'commit' }),
    /canonical branch identity is required/u);
});

test('the guard allows solo unprotected canonical authoring and still refuses protected N=1', () => {
  assert.equal(evaluate({
    branch: 'main', phase: 'commit', protectedBranch: 'main', soloUnprotected: true,
  }).allow, true);
  assert.equal(evaluate({
    branch: 'main', phase: 'commit', protectedBranch: 'main', soloUnprotected: true,
  }).note, 'solo-unprotected canonical authoring');
  const protectedRefuse = evaluate({
    branch: 'main', phase: 'commit', protectedBranch: 'main', soloUnprotected: false,
  });
  assert.equal(protectedRefuse.allow, false);
  assert.equal(protectedRefuse.reason, 'blocked-canonical-authoring');
});

test('the hook allows unprotected canonical main and refuses protected canonical main', (t) => {
  const run = (capabilities, provider) => {
    const root = mkdtempSync(join(tmpdir(), 'agentic-os-guard-posture-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'ADLC Test'], { cwd: root });
    const profile = createRepositoryProfile({
      repository: provider ? 'github.com/example/unprotected' : 'local:unprotected',
      canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
      adapters: {
        repository: { id: 'git', version: '1' },
        provider: provider ? { id: 'github', version: '1' } : null,
      },
      capabilities,
    });
    writeFileSync(join(root, '.agentic-os.json'), `${JSON.stringify(profile, null, 2)}\n`);
    execFileSync('git', ['add', '.agentic-os.json'], { cwd: root });
    execFileSync('git', ['commit', '--quiet', '--message', 'profile'], { cwd: root });
    ensureRepositoryTrust(root, profile, { allowCreate: true });
    return spawnSync(process.execPath, [GUARD, 'commit'], {
      cwd: root, encoding: 'utf8', env: { ...process.env },
    });
  };

  const unprotected = run([], false);
  assert.equal(unprotected.status, 0, unprotected.stderr);
  const protectedRepo = run(['protected-integration:pull-request'], true);
  assert.equal(protectedRepo.status, 1);
  assert.match(protectedRepo.stderr, /blocked-canonical-authoring|read-only runtime/u);
});

test('explicit guard override precedes trust while ordinary missing trust fails closed', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-guard-bootstrap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });

  const ordinary = spawnSync(process.execPath, [GUARD, 'commit'], {
    cwd: root, encoding: 'utf8', env: { ...process.env },
  });
  assert.equal(ordinary.status, 1);
  assert.match(ordinary.stderr, /repository trust anchor is missing/u);

  const overridden = spawnSync(process.execPath, [GUARD, 'commit'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, [OVERRIDE_ENV]: '1' },
  });
  assert.equal(overridden.status, 0, overridden.stderr);
});
