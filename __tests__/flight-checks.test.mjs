import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';

const CLI = fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const writeJson = (file, value) => writeFileSync(file, canonicalJson(value) + '\n');
function fixture(t, { body = 'process.exit(0);', kind = 'browser', timeoutMs = 2000, second = false } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'flight-gate-')), root = join(parent, 'repo');
  t.after(() => rmSync(parent, { recursive: true, force: true })); mkdirSync(root);
  git(root, 'init', '-q', '--initial-branch=main'); git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  const profile = createRepositoryProfile({ repository: 'github.com/example/gate',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null }, capabilities: [], requiredChecks: [] });
  writeJson(join(root, '.agentic-os.json'), profile);
  const command = { id: 'browser-fidelity', owner: 'consumer', kind, operations: ['activation', 'release-alias'],
    script: 'check.mjs', args: [], environment: ['CHECK_COUNTER'], timeoutMs };
  const manifest = { schema: 'agentic-os/flight-requirements/v3', maxAgeSeconds: 900,
    operations: ['publication', 'activation', 'release-alias'], requirements: [], checks: [command] };
  if (second) manifest.checks.push({ ...structuredClone(command), id: 'second', script: 'second.mjs', environment: ['SECOND_COUNTER'] });
  writeJson(join(root, '.agentic-os-flight.json'), manifest);
  writeFileSync(join(root, 'check.mjs'), "import {appendFileSync} from 'node:fs';\nappendFileSync(process.env.CHECK_COUNTER,'called\\n');\n" + body);
  if (second) writeFileSync(join(root, 'second.mjs'), "import {appendFileSync} from 'node:fs'; appendFileSync(process.env.SECOND_COUNTER,'called\\n'); process.exit(1);");
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'reviewed');
  const head = git(root, 'rev-parse', 'HEAD'); git(root, 'update-ref', 'refs/remotes/origin/main', head);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const contextFile = join(parent, 'context.json');
  const context = { schema: 'agentic-os/flight-check-context/v1', sourceRevision: head,
    artifactDigest: 'a'.repeat(64), configurationDigest: 'b'.repeat(64) };
  writeJson(contextFile, context);
  return { root, parent, context, contextFile, manifest, counter: join(parent, 'counter'), secondCounter: join(parent, 'second-counter') };
}
const args = (f, operation = 'activation') => [CLI, 'flight', 'gate', `--operation=${operation}`, `--context=${f.contextFile}`];
const env = f => ({ ...process.env, CHECK_COUNTER: f.counter, SECOND_COUNTER: f.secondCounter });
function gate(f, operation) {
  const result = spawnSync(process.execPath, args(f, operation), { cwd: f.root, env: env(f), encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined, result.error?.message);
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : null };
}
const calls = file => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').length : 0;
function recommit(f) {
  git(f.root, 'add', '.'); git(f.root, 'commit', '-qm', 'reviewed change');
  f.context.sourceRevision = git(f.root, 'rev-parse', 'HEAD');
  git(f.root, 'update-ref', 'refs/remotes/origin/main', f.context.sourceRevision); writeJson(f.contextFile, f.context);
}

test('gate executes the real enrolled browser check and preserves private diagnostics without granting activation authority', t => {
  const f = fixture(t, { body: 'console.error("private-diagnostic-marker");' });
  const result = gate(f);
  assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(calls(f.counter), 1);
  assert.equal(result.report.authorizesEffects, false); assert.equal(result.report.productionReady, false);
  assert.equal(result.report.successReused, false); assert.equal(result.report.checks[0].outcome, 'passed');
  assert.doesNotMatch(result.stdout, /private-diagnostic-marker/);
  const log = result.report.checks[0].logs.stderr.path;
  assert.match(readFileSync(log, 'utf8'), /private-diagnostic-marker/); assert.equal(statSync(log).mode & 0o777, 0o600);
});
test('failed candidate stops immediately across invocations and operation aliases; no earlier check runs twice', t => {
  const f = fixture(t, { second: true });
  assert.equal(gate(f).status, 1); assert.equal(calls(f.counter), 1); assert.equal(calls(f.secondCounter), 1);
  const repeated = gate(f, 'release-alias');
  assert.equal(repeated.report.code, 'blocked-flight-check-history');
  assert.equal(repeated.report.blocked[0].reason, 'unchanged-failed-check');
  assert.equal(calls(f.counter), 1); assert.equal(calls(f.secondCounter), 1);
  f.contextFile = join(f.parent, 'relocated-context.json'); writeJson(f.contextFile, f.context);
  const otherRoot = join(f.parent, 'other-worktree'); git(f.root, 'worktree', 'add', '-q', '-b', 'agent/fixture/other', otherRoot);
  f.root = otherRoot;
  assert.equal(gate(f).report.code, 'blocked-flight-check-history');
  assert.equal(calls(f.counter), 1); assert.equal(calls(f.secondCounter), 1);
});
test('empty commits cannot reset the failure; changed configuration must execute a fresh check', t => {
  const f = fixture(t, { body: 'process.exit(1);' }); assert.equal(gate(f).status, 1);
  git(f.root, 'commit', '--allow-empty', '-qm', 'new run label');
  f.context.sourceRevision = git(f.root, 'rev-parse', 'HEAD');
  git(f.root, 'update-ref', 'refs/remotes/origin/main', f.context.sourceRevision); writeJson(f.contextFile, f.context);
  assert.equal(gate(f).report.code, 'blocked-flight-check-history'); assert.equal(calls(f.counter), 1);
  f.context.configurationDigest = 'c'.repeat(64); writeJson(f.contextFile, f.context);
  const changed = gate(f); assert.equal(changed.status, 1); assert.equal(changed.report.checks[0].outcome, 'failed');
  assert.equal(calls(f.counter), 2);
});
test('missing browser enrollment, dirty source and stale context stop before starting any child', t => {
  const noBrowser = fixture(t, { kind: 'command' });
  assert.equal(gate(noBrowser).report.code, 'blocked-flight-browser-check-missing'); assert.equal(calls(noBrowser.counter), 0);
  const dirty = fixture(t); writeFileSync(join(dirty.root, 'check.mjs'), 'unreviewed');
  assert.equal(gate(dirty).report.code, 'blocked-flight-check-source-unreviewed'); assert.equal(calls(dirty.counter), 0);
  const stale = fixture(t); stale.context.sourceRevision = 'd'.repeat(40); writeJson(stale.contextFile, stale.context);
  assert.equal(gate(stale).report.code, 'blocked-flight-check-source-unreviewed'); assert.equal(calls(stale.counter), 0);
});
test('timeout and excessive diagnostics remain interrupted failures; repeated invocation cannot retry them', t => {
  for (const options of [{ body: 'setInterval(()=>{},100);', timeoutMs: 300 },
    { body: 'process.stdout.write("x".repeat(100000));' }]) {
    const f = fixture(t, options), result = gate(f);
    assert.equal(result.status, 1); assert.equal(result.report.checks[0].outcome, 'interrupted');
    assert.ok(result.report.checks[0].logs.stdout.bytes <= 65536);
    assert.equal(gate(f).report.code, 'blocked-flight-check-history'); assert.equal(calls(f.counter), 1);
  }
});
test('checks that change source cannot let the activation gate pass', t => {
  const f = fixture(t, { body: "appendFileSync('check.mjs','// drift');" });
  const result = gate(f); assert.equal(result.status, 1); assert.equal(result.report.checks[0].outcome, 'drift');
});
test('success is checked freshly with a finite lifetime attempt bound', t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) assert.equal(gate(f).status, 0);
  const exhausted = gate(f); assert.equal(exhausted.status, 1);
  assert.equal(exhausted.report.blocked[0].reason, 'check-attempt-budget-exhausted'); assert.equal(calls(f.counter), 3);
});
test('malformed enrollment and noncanonical context bytes fail before execution', t => {
  const f = fixture(t); f.manifest.checks[0].script = '../outside.mjs';
  writeJson(join(f.root, '.agentic-os-flight.json'), f.manifest); recommit(f);
  assert.equal(gate(f).report.code, 'blocked-flight-check-enrollment-invalid'); assert.equal(calls(f.counter), 0);
  const other = fixture(t); writeFileSync(other.contextFile, JSON.stringify(other.context));
  assert.equal(gate(other).report.code, 'blocked-flight-check-context-invalid'); assert.equal(calls(other.counter), 0);
});
test('a started attempt without a result survives a later invocation as unresolved evidence', t => {
  const f = fixture(t, { body: 'process.exit(1);' }), first = gate(f);
  const check = first.report.checks[0];
  rmSync(join(dirname(check.logs.stdout.path), `${check.attempt}-result.json`));
  const again = gate(f);
  assert.equal(again.status, 1); assert.equal(again.report.blocked[0].reason, 'interrupted-check-needs-reconciliation');
  assert.equal(calls(f.counter), 1);
});
test('missing enrolled prerequisites report every owner before any check can execute', t => {
  const f = fixture(t);
  f.manifest.requirements = ['first', 'second'].map(id => ({ id, owner: id + '-owner', kind: 'environment',
    input: `AGENTIC_OS_ABSENT_${id.toUpperCase()}`, sha256: null, expiresAt: null,
    phases: ['pre'], operations: ['activation'], remedy: 'Supply the declared prerequisite.' }));
  writeJson(join(f.root, '.agentic-os-flight.json'), f.manifest); recommit(f);
  const result = gate(f); assert.equal(result.status, 1); assert.equal(result.report.code, 'blocked-flight-prerequisites');
  assert.deepEqual(result.report.findings.map(item => item.owner), ['first-owner', 'second-owner']);
  assert.equal(calls(f.counter), 0);
});
test('concurrent invocations share the clone lock and cannot execute the same check twice', async t => {
  const f = fixture(t, { timeoutMs: 10000, body: "import {existsSync} from 'node:fs'; const timer=setInterval(()=>{if(existsSync(process.env.CHECK_COUNTER+'.release')) clearInterval(timer);},20);" });
  const child = spawn(process.execPath, args(f), { cwd: f.root, env: env(f), stdio: ['ignore', 'pipe', 'pipe'] });
  const ended = new Promise(resolve => child.on('close', resolve));
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(f.counter) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls(f.counter), 1);
    const contender = gate(f); assert.equal(contender.status, 1);
    assert.equal(contender.report.code, 'blocked-flight-checks-concurrent');
  } finally { writeFileSync(f.counter + '.release', 'release'); }
  assert.equal(await ended, 0); assert.equal(calls(f.counter), 1);
});
