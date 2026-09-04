import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { classifyPath, CLASS_AUTHORITY_CONTROLLING } from '../src/autonomy-class.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const REF = 'agent/test/flight';
const ENV = 'AGENTIC_OS_TEST_FLIGHT_INPUT';
const hash = (value) => createHash('sha256').update(value).digest('hex');
test('prerequisite enrollment is an authority-controlling policy surface', () => {
  assert.equal(classifyPath('.agentic-os-flight.json'), CLASS_AUTHORITY_CONTROLLING);
});
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function requirement(overrides = {}) {
  return { id: 'evaluator', owner: 'external-evaluator', kind: 'environment', input: ENV,
    sha256: null, expiresAt: null, phases: ['pre', 'in', 'post'],
    remedy: 'Supply the evaluator context outside the candidate.', ...overrides };
}
function fixture(t, requirements = [requirement()]) {
  const parent = mkdtempSync(join(tmpdir(), 'flight-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), lane = join(parent, 'lane'), bare = join(parent, 'remote.git');
  mkdirSync(root);
  git(root, 'init', '-q', '--initial-branch=main');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  const profile = createRepositoryProfile({ repository: 'github.com/example/flight',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null },
    capabilities: [], requiredChecks: [] });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile) + '\n');
  const manifest = { schema: 'agentic-os/flight-requirements/v1', maxAgeSeconds: 900, requirements };
  writeFileSync(join(root, '.agentic-os-flight.json'), canonicalJson(manifest) + '\n');
  writeFileSync(join(root, 'source.txt'), 'base\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  git(parent, 'init', '-q', '--bare', bare);
  git(root, 'remote', 'add', 'origin', bare); git(root, 'push', '-q', 'origin', 'main');
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  git(root, 'worktree', 'add', '-q', '-b', REF, lane);
  writeFileSync(join(lane, 'source.txt'), 'candidate\n');
  git(lane, 'add', '.'); git(lane, 'commit', '-qm', 'candidate');
  return { parent, root, lane, bare, profile, manifest, checkpoint: join(parent, 'checkpoint.json') };
}
function cli(subject, args, { cwd = subject.lane, supplied = 'private-value-never-report' } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8',
    env: { ...process.env, [ENV]: supplied }, timeout: 20_000 });
  return { ...result, report: args[0] === 'flight' && result.stdout.trim().startsWith('{')
    ? JSON.parse(result.stdout) : null };
}
function pre(subject) {
  const result = cli(subject, ['flight', 'pre']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  writeFileSync(subject.checkpoint, result.stdout);
  return result.report;
}
function later(subject, phase = 'in', options) {
  return cli(subject, ['flight', phase, `--checkpoint=${subject.checkpoint}`, `--ref=${REF}`], options);
}
function rewriteCheckpoint(subject, change) {
  const { digest, ...value } = JSON.parse(readFileSync(subject.checkpoint, 'utf8'));
  change(value);
  writeFileSync(subject.checkpoint, JSON.stringify({ ...value, digest: hash(canonicalJson(value)) }));
}

test('pre-flight reports all missing prerequisites with owner/remedy and never exposes values', (t) => {
  const subject = fixture(t, [requirement(), requirement({ id: 'executor', input: 'ABSENT_EXECUTOR' })]);
  const result = cli(subject, ['flight', 'pre'], { supplied: '' });
  assert.equal(result.status, 1);
  assert.equal(result.report.findings.length, 2);
  assert.equal(result.report.inputs[0].owner, 'external-evaluator');
  assert.match(result.report.inputs[0].remedy, /Supply/u);
  assert.equal(result.report.observationOnly, true);
  assert.equal(result.report.authorizesEffects, false);
  const secret = cli(subject, ['flight', 'pre']);
  assert.equal(secret.stdout.includes('private-value-never-report'), false);
});

test('in-flight binds the clean source, profile, requirements and prerequisite availability', (t) => {
  const subject = fixture(t);
  pre(subject);
  assert.equal(later(subject).status, 0);
  const missing = later(subject, 'in', { supplied: '' });
  assert.equal(missing.status, 1);
  assert.ok(missing.report.findings.some((item) => item.code === 'input-missing'));
  writeFileSync(join(subject.lane, 'source.txt'), 'changed after checkpoint\n');
  assert.ok(later(subject).report.findings.some((item) => item.code === 'candidate-byte-risk'));
  git(subject.lane, 'add', '.'); git(subject.lane, 'commit', '-qm', 'changed');
  assert.ok(later(subject).report.findings.some((item) => item.code === 'checkpoint-drift'));
});

test('checkpoint corruption, failed reports, stale and future observations cannot pass in-flight', (t) => {
  const subject = fixture(t);
  const checkpoint = pre(subject);
  writeFileSync(subject.checkpoint, JSON.stringify({ ...checkpoint, ok: false }));
  assert.equal(later(subject).report.code, 'blocked-flight-checkpoint-invalid');
  for (const delta of [-901_000, 60_000]) {
    pre(subject);
    rewriteCheckpoint(subject, (value) => { value.observedAt = new Date(Date.now() + delta).toISOString(); });
    assert.ok(later(subject).report.findings.some((item) => item.code === 'checkpoint-expired'));
  }
  pre(subject);
  rewriteCheckpoint(subject, (value) => { value.authorizesEffects = true; });
  assert.equal(later(subject).report.code, 'blocked-flight-checkpoint-invalid');
});

test('post-flight distinguishes integration, projection cleanup and canonical synchronization', (t) => {
  const subject = fixture(t);
  pre(subject);
  let result = later(subject, 'post', { cwd: subject.root });
  assert.equal(result.report.completion.integration, null);
  assert.equal(result.report.completion.worktreeAbsent, false);
  git(subject.root, 'merge', '--squash', REF); git(subject.root, 'commit', '-qm', 'integrated');
  const integrated = git(subject.root, 'rev-parse', 'HEAD');
  git(subject.root, 'update-ref', 'refs/remotes/origin/main', integrated);
  result = later(subject, 'post', { cwd: subject.root });
  assert.equal(result.report.completion.integration.kind, 'exact-tree-projection');
  assert.equal(result.report.ok, false);
  git(subject.root, 'worktree', 'remove', subject.lane);
  result = later(subject, 'post', { cwd: subject.root });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.completion.runtimeEvidenceVerified, false);
  assert.equal(result.report.completion.authorityRetirementVerified, false);
  assert.equal(result.report.authorizesEffects, false);
  symlinkSync(join(subject.parent, 'absent'), subject.lane);
  assert.equal(later(subject, 'post', { cwd: subject.root }).report.completion.worktreeAbsent, false);
  git(subject.root, 'update-ref', 'refs/remotes/origin/main', git(subject.root, 'rev-parse', 'HEAD^'));
  assert.equal(later(subject, 'post', { cwd: subject.root }).report.completion.canonicalSynchronized, false);
});

test('public evidence is pinned, expiring, bounded and external; its presence never authenticates it', (t) => {
  const content = '{"outcome":"passed"}\n';
  const subject = fixture(t, [requirement({ kind: 'evidence', sha256: hash(content),
    expiresAt: new Date(Date.now() + 600_000).toISOString() })]);
  const file = join(subject.parent, 'public-evidence.json');
  writeFileSync(file, content);
  const run = (supplied) => cli(subject, ['flight', 'pre'], { supplied });
  assert.equal(run(file).status, 0);
  writeFileSync(file, '{"outcome":"failed"}\n');
  assert.equal(run(file).report.inputs[0].code, 'evidence-digest-mismatch');
  const linked = join(subject.parent, 'link'); symlinkSync(file, linked);
  assert.equal(run(linked).report.inputs[0].code, 'evidence-unavailable');
  assert.equal(run(join(subject.lane, 'source.txt')).report.inputs[0].code, 'evidence-location-invalid');
  writeFileSync(file, 'a'.repeat(131_073));
  assert.equal(run(file).report.inputs[0].code, 'evidence-unavailable');
});

test('phase grammar, unknown fields, duplicate JSON keys and oversized manifests fail closed', (t) => {
  const subject = fixture(t), external = join(subject.parent, 'requirements.json');
  for (const args of [['flight', 'wat'], ['flight', 'in'], ['flight', 'pre', '--checkpoint=x'],
    ['flight', 'pre', '--apply'], ['flight', 'pre', '--ref=a', '--ref=b']]) {
    assert.equal(cli(subject, args).status, 1);
  }
  for (const bytes of [canonicalJson({ ...subject.manifest, run: 'touch unwanted' }) + '\n',
    canonicalJson(subject.manifest).replace('{', '{"schema":"duplicate",') + '\n', ' '.repeat(65_537)]) {
    writeFileSync(external, bytes);
    assert.equal(cli(subject, ['flight', 'pre', `--requirements=${external}`]).status, 1);
  }
  symlinkSync(join(subject.root, '.agentic-os-flight.json'), external + '.link');
  assert.equal(cli(subject, ['flight', 'pre', `--requirements=${external}.link`]).status, 1);
  assert.equal(existsSync(join(subject.lane, 'unwanted')), false);
});

test('land refuses missing enrolled prerequisites before committing or publishing candidate edits', (t) => {
  const subject = fixture(t), head = git(subject.lane, 'rev-parse', 'HEAD');
  // A candidate cannot disable prerequisites selected from the canonical commit.
  writeFileSync(join(subject.lane, '.agentic-os-flight.json'), canonicalJson({ ...subject.manifest,
    requirements: [] }) + '\n');
  const result = cli(subject, ['land', '--message=must not commit'], { supplied: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-flight-prerequisites/u);
  assert.equal(git(subject.lane, 'rev-parse', 'HEAD'), head);
  assert.notEqual(git(subject.lane, 'status', '--porcelain'), '');
  assert.equal(spawnSync('git', ['--git-dir', subject.bare, 'show-ref', '--verify', `refs/heads/${REF}`]).status, 128);
});

test('expired public evidence stops pre-flight and a cross-clone checkpoint cannot be reused', (t) => {
  const old = fixture(t, [requirement({ kind: 'evidence', sha256: hash('expired'),
    expiresAt: '2000-01-01T00:00:00.000Z' })]);
  const file = join(old.parent, 'public.json'); writeFileSync(file, 'expired');
  assert.equal(cli(old, ['flight', 'pre'], { supplied: file }).report.inputs[0].code, 'evidence-expired');
  const a = fixture(t), b = fixture(t);
  pre(a); writeFileSync(b.checkpoint, readFileSync(a.checkpoint));
  assert.ok(later(b).report.findings.some((item) => item.code === 'checkpoint-drift'));
});

test('land refuses a canonical manifest stale against the fetched upstream policy', (t) => {
  const subject = fixture(t), canonicalHead = git(subject.root, 'rev-parse', 'HEAD');
  writeFileSync(join(subject.lane, '.agentic-os-flight.json'), canonicalJson({ ...subject.manifest,
    requirements: [requirement({ id: 'new-policy' })] }) + '\n');
  git(subject.lane, 'add', '.'); git(subject.lane, 'commit', '-qm', 'upstream policy fixture');
  const head = git(subject.lane, 'rev-parse', 'HEAD');
  // Model fetched upstream policy while the local canonical checkout remains at its old commit.
  git(subject.root, 'update-ref', 'refs/remotes/origin/main', head);
  const result = cli(subject, ['land']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked-flight-requirements-stale/u);
  assert.equal(git(subject.root, 'rev-parse', 'HEAD'), canonicalHead);
  assert.equal(git(subject.lane, 'rev-parse', 'HEAD'), head);
  assert.equal(spawnSync('git', ['--git-dir', subject.bare, 'show-ref', '--verify', `refs/heads/${REF}`]).status, 128);
});
