import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCiInputs, sealCiEvidence, lookupCiEvidence, verifyCiEvidence,
  validateCiEvidencePolicy, ciEvidenceArguments } from '../bin/agentic-os-ci-evidence.mjs';

const policy = () => ({ schema: 'agentic-os/ci-evidence-policy/v1', repository: 'github.com/owner/app',
  workflow: '.github/workflows/integration.yml', branch: 'main', job: 'Integration Gate',
  step: 'Check source', command: ['npm', 'run', 'check'], maxAgeSeconds: 3600,
  dependencies: [{ id: 'docs', repository: 'github.com/owner/docs', path: '../docs' }], environment: ['NODE_OPTIONS'] });
const now = Date.parse('2026-09-14T14:00:00Z');
function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'ci-evidence-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const root = join(folder, 'app'), docs = join(folder, 'docs');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const [cwd, repo] of [[root, 'app'], [docs, 'docs']]) {
    mkdirSync(cwd); git(cwd, 'init', '-b', 'main'); git(cwd, 'config', 'user.name', 'Test');
    git(cwd, 'config', 'user.email', 'test@example.invalid'); git(cwd, 'config', 'core.hooksPath', '/dev/null');
    git(cwd, 'remote', 'add', 'origin', `https://github.com/owner/${repo}.git`);
    writeFileSync(join(cwd, 'source.txt'), 'source\n');
    if (repo === 'app') writeFileSync(join(cwd, 'policy.json'), JSON.stringify(policy()));
    git(cwd, 'add', '.'); git(cwd, 'commit', '-m', 'fixture');
  }
  const env = { GITHUB_ACTIONS: 'true', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'owner/app',
    GITHUB_SHA: git(root, 'rev-parse', 'HEAD'), GITHUB_REF: 'refs/heads/main', RUNNER_ENVIRONMENT: 'github-hosted',
    ImageOS: 'ubuntu24', ImageVersion: '20260913.1.0', RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', NODE_OPTIONS: '--max-old-space-size=4096',
    GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: 'owner/app/.github/workflows/integration.yml@refs/heads/main',
    GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1' };
  const current = captureCiInputs(root, 'policy.json', env);
  const run = { id: 100, run_attempt: 1, workflow_id: 5, repository: { id: 7, full_name: 'owner/app' },
    head_repository: { id: 7, full_name: 'owner/app' }, head_sha: env.GITHUB_SHA, head_branch: 'main', event: 'push',
    path: policy().workflow, status: 'completed', conclusion: 'success', run_started_at: new Date(now - 100000).toISOString(),
    updated_at: new Date(now - 1000).toISOString(), html_url: 'https://github.com/owner/app/actions/runs/100' };
  const job = { id: 200, run_id: 100, run_attempt: 1, head_sha: env.GITHUB_SHA, name: 'Integration Gate',
    status: 'completed', conclusion: 'success', steps: [{ name: 'Check source', status: 'completed', conclusion: 'success' }] };
  const artifact = { id: 300, name: 'agentic-os-ci-evidence-100-1', expired: false, size_in_bytes: 2000,
    digest: 'sha256:' + 'd'.repeat(64), workflow_run: { id: 100, head_sha: env.GITHUB_SHA, repository_id: 7, head_repository_id: 7 } };
  const data = { branch: { protected: true, commit: { sha: env.GITHUB_SHA } },
    runs: { total_count: 1, workflow_runs: [run] }, jobs: { total_count: 1, jobs: [job] },
    artifacts: { total_count: 1, artifacts: [artifact] } };
  const api = endpoint => structuredClone(endpoint.includes('/branches/') ? data.branch : endpoint.includes('/workflows/')
    ? data.runs : endpoint.includes('/jobs?') ? data.jobs : endpoint.includes('/artifacts?') ? data.artifacts : assert.fail(endpoint));
  const evidence = sealCiEvidence(current, current, env, now - 2000);
  return { root, docs, git, env, current, data, api, evidence, run, job, artifact };
}

test('protected exact-input proof reuses a passed command without executing it or granting authority', t => {
  const f = fixture(t), lookup = lookupCiEvidence(f.current, f.api, now);
  const result = verifyCiEvidence(f.evidence, f.current, lookup, f.api, now);
  assert.equal(result.reused, true); assert.equal(result.authority, false);
  assert.equal(result.runUrl, 'https://github.com/owner/app/actions/runs/100');
  assert.deepEqual(result.command, ['npm', 'run', 'check']);
});
test('real tracked edits, dependency changes, runner changes and environment drift invalidate evidence', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'source.txt'), 'dirty');
  assert.throws(() => captureCiInputs(f.root, 'policy.json', f.env), /dirty-source/);
  writeFileSync(join(f.root, 'source.txt'), 'source\n');
  writeFileSync(join(f.docs, 'source.txt'), 'new docs\n');
  assert.throws(() => captureCiInputs(f.root, 'policy.json', f.env), /dirty-source/);
  f.git(f.docs, 'add', '.'); f.git(f.docs, 'commit', '-m', 'docs changed');
  const changed = captureCiInputs(f.root, 'policy.json', f.env);
  assert.notEqual(changed.inputDigest, f.current.inputDigest);
  assert.throws(() => sealCiEvidence(f.current, changed, f.env, now), /seal-context/);
  for (const update of [{ NODE_OPTIONS: 'different' }, { ImageVersion: 'new' }]) {
    assert.notEqual(captureCiInputs(f.root, 'policy.json', { ...f.env, ...update }).inputDigest, changed.inputDigest);
  }
  assert.throws(() => captureCiInputs(f.root, 'policy.json', { ...f.env, RUNNER_ENVIRONMENT: 'self-hosted' }), /runner-context/);
  assert.throws(() => sealCiEvidence(f.current, f.current, { ...f.env, GITHUB_EVENT_NAME: 'pull_request' }), /seal-context/);
  writeFileSync(join(f.root, 'policy.json'), JSON.stringify({ ...policy(), maxAgeSeconds: 10 }));
  assert.throws(() => captureCiInputs(f.root, 'policy.json', f.env), /uncommitted-policy|dirty-source/);
});
test('newer failed or pending runs cannot be hidden behind an older successful run', t => {
  const f = fixture(t);
  f.data.runs = { total_count: 2, workflow_runs: [f.run, { ...f.run, id: 101, conclusion: 'failure' }] };
  assert.throws(() => lookupCiEvidence(f.current, f.api, now), /run-not-reusable/);
  f.data.runs.workflow_runs[1] = { ...f.run, id: 101, status: 'in_progress', conclusion: null };
  assert.throws(() => lookupCiEvidence(f.current, f.api, now), /run-not-reusable/);
});
test('fork, wrong workflow, stale run, changed protected tip, skipped step and oversized evidence fail closed', t => {
  const f = fixture(t), baseline = structuredClone(f.data);
  const cases = [
    d => { d.branch.protected = false; }, d => { d.branch.commit.sha = 'a'.repeat(40); },
    d => { d.runs.workflow_runs[0].head_repository.id = 999; },
    d => { d.runs.workflow_runs[0].event = 'pull_request'; },
    d => { d.runs.workflow_runs[0].path = '.github/workflows/other.yml'; },
    d => { d.runs.workflow_runs[0].run_started_at = new Date(now - 3600001).toISOString(); },
    d => { d.jobs.jobs[0].steps[0].conclusion = 'skipped'; },
    d => { d.jobs.jobs.push(d.jobs.jobs[0]); d.jobs.total_count++; },
    d => { d.artifacts.artifacts[0].expired = true; },
    d => { d.artifacts.artifacts[0].size_in_bytes = 65537; },
    d => { d.artifacts.artifacts[0].workflow_run.head_repository_id = 999; },
    d => { d.artifacts.artifacts[0].digest = ''; },
    d => { d.runs.total_count = 11; },
  ];
  for (const mutate of cases) {
    Object.assign(f.data, structuredClone(baseline)); mutate(f.data);
    assert.throws(() => lookupCiEvidence(f.current, f.api, now), /blocked-ci-evidence/);
  }
});
test('fresh provider reobservation rejects attempt/artifact drift and tampered or partial receipts', t => {
  const f = fixture(t), lookup = lookupCiEvidence(f.current, f.api, now);
  f.data.artifacts.artifacts[0].id++;
  assert.throws(() => verifyCiEvidence(f.evidence, f.current, lookup, f.api, now), /provider-drift/);
  f.data.artifacts.artifacts[0].id--;
  for (const update of [{ authority: true }, { runAttempt: 2 }, { inputDigest: 'e'.repeat(64) },
    { command: ['true'] }, { input: { ...f.current.input, node: 'different' } }, { extra: true }]) {
    assert.throws(() => verifyCiEvidence({ ...f.evidence, ...update }, f.current, lookup, f.api, now), /evidence-binding/);
  }
  f.data.runs.workflow_runs[0].run_attempt = 2;
  assert.throws(() => verifyCiEvidence(f.evidence, f.current, lookup, f.api, now), /job-not-passed/);
});
test('policy and CLI accept only bounded explicit inputs', () => {
  assert.deepEqual(validateCiEvidencePolicy(policy()), policy());
  for (const update of [{ maxAgeSeconds: 86401 }, { environment: ['X', 'X'] }, { workflow: '../other.yml' },
    { dependencies: [{ id: 'source', repository: 'github.com/o/r', path: '../d' }] }]) {
    assert.throws(() => validateCiEvidencePolicy({ ...policy(), ...update }), /policy/);
  }
  assert.deepEqual(ciEvidenceArguments(['lookup', '--policy=p', '--output=o']), { mode: 'lookup', policy: 'p', output: 'o' });
  for (const args of [['lookup'], ['lookup', '--policy=p', '--output=o', '--output=x'], ['verify', '--execute=true']])
    assert.throws(() => ciEvidenceArguments(args), /arguments/);
});
test('the real CLI falls back without leaking input or contacting a provider outside CI', t => {
  const f = fixture(t), output = join(f.root, 'fallback.json');
  const stdout = execFileSync(process.execPath, [fileURLToPath(new URL('../bin/agentic-os-ci-evidence.mjs', import.meta.url)),
    'lookup', '--policy=policy.json', `--output=${output}`], { cwd: f.root, encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: 'false', NODE_OPTIONS: '', GH_TOKEN: 'do-not-print' } });
  const result = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(result.reused, false); assert.equal(result.authority, false);
  assert.equal(result.reason, 'blocked-ci-evidence:runner-context');
  assert.equal(stdout.includes('do-not-print'), false);
});
