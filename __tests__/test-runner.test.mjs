import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, runTests, validationChecks, runCheckPool, boundCiCoverage } from '../bin/agentic-os-tests.mjs';
import { snapshot } from '../bin/agentic-os-test-inputs.mjs';
import { executeCommand, lockReceipts, receiptDirectory, previousCheck, writeReceipt } from '../bin/agentic-os-test-receipt.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { collectWorkflowValue, readSelectedWorkflow, startWorkflow, workflowPaths } from '../bin/agentic-os-workflow.mjs';

function fixture(t, { evaluator = 'node -e "process.exit(0)"', body = '', workflow = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), workflow ? 'workflow-runner-' : 'test runner ')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  mkdirSync(join(root, 'test')); mkdirSync(join(root, '__tests__'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { evals: evaluator } }));
  writeFileSync(join(root, 'test/impact-contracts.json'), JSON.stringify({ schema: 'agentic-os/test-impact-contracts/v1',
    sentinels: ['small.test.mjs'], packaging: [], broad: ['package.json'], rules: [], dependencies: {} }));
  writeFileSync(join(root, '__tests__/small.test.mjs'), `import test from 'node:test'; test('behavior', () => { ${body} });\n`);
  if (workflow) {
    writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(createRepositoryProfile({ repository: 'github.com/example/test-runner',
      canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
      adapters: { repository: { id: 'git', version: '1' }, provider: null } })));
    writeFileSync(join(root, 'native-prd-tad-adr-mvp-gtm.md'), '# Native test-runner plan\n');
    git('config', '--local', 'agentic-os.workspaceRoot', join(root, '.git/workflow-workspace'));
  }
  git('add', '.'); git('commit', '-qm', 'base');
  const messages = [], invoke = extra => runTests(['affected', '--base=HEAD', ...(extra ?? [])], { root, out: text => messages.push(text) });
  const receipt = () => JSON.parse(readFileSync(join(receiptDirectory(root), 'last.json')));
  return { root, messages, invoke, receipt, git };
}
function declaredFixture(t, { blocked = false, memberId, ...options } = {}) {
  const f = fixture(t, { ...options, workflow: true }), repository = 'github.com/example/test-runner';
  const worktreeId = memberId ?? basename(f.root), revision = f.git('rev-parse', 'HEAD');
  const edges = [{ before: { memberId: worktreeId, phase: 'preparation' }, after: { memberId: worktreeId, phase: 'checks' } }];
  const execution = dependencies => ({ version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: dependencies } });
  startWorkflow(f.root, repository, { revision, planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId,
    execution: execution(blocked ? edges : []) });
  const block = () => {
    const selected = readSelectedWorkflow(f.root, repository), workspace = workflowPaths(f.root, repository).workspace;
    return collectWorkflowValue(f.root, repository, { ...selected.manifest, execution: execution(edges),
      members: selected.manifest.members.map(row => ({ ...row, file: resolve(workspace, row.file) })),
      previous: { file: selected.path, digest: selected.digest } });
  };
  return { ...f, block };
}
function localEnvironment(t) {
  const keys = ['CI', 'GITHUB_ACTIONS', 'AGENTIC_OS_CI_RUN'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  t.after(() => { for (const key of keys)
    before[key] === undefined ? delete process.env[key] : process.env[key] = before[key]; });
}
test('options are explicit and reject unknown, duplicate and empty input', () => {
  assert.equal(parseArguments([]).mode, 'affected');
  for (const args of [['unknown'], ['affected', '--skip'], ['affected', '--base='],
    ['affected', '--base=a', '--base=b'], ['fast', '--fresh'], ['affected', '--ci-run=0']]) assert.throws(() => parseArguments(args));
  assert.equal(parseArguments(['affected', '--ci-run=42'])['ci-run'], '42');
});
test('bound CI covering HEAD defers the local suite; identity drift and failed CI do not', async t => {
  const env = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  delete process.env.CI; delete process.env.GITHUB_ACTIONS;
  t.after(() => { for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const f = fixture(t, { evaluator: 'node -e "process.exit(9)"' });
  const observed = snapshot({ root: f.root, base: 'HEAD' });
  const observation = { source: { revision: observed.identity.headRevision, tree: observed.identity.headTree },
    status: 'running', ci: { runId: 42 }, coverage: { partial: true } };
  assert.deepEqual(boundCiCoverage(observed.identity, observation), { runId: 42, status: 'running' });
  assert.equal(boundCiCoverage(observed.identity, { ...observation, status: 'failed' }), null);
  assert.throws(() => boundCiCoverage(observed.identity, { ...observation,
    source: { revision: 'a'.repeat(40), tree: observed.identity.headTree } }), /blocked-ci-coverage-identity/u);
  const messages = [];
  assert.equal(await runTests(['affected', '--base=HEAD', '--ci-run=42'], {
    root: f.root, out: text => messages.push(text), ciObservation: observation }), 0);
  assert.ok(messages.some(message => message.startsWith('deferred local suite')));
  assert.ok(f.receipt().results.every(result => result.reusedFrom === 'bound-ci'));
  assert.equal(f.receipt().results.some(result => result.name === 'evaluators'), true);
});

test('public npm entrypoints forward baseline options before executing any checks', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const script of ['check', 'test', 'check:affected']) {
    const result = await executeCommand(root, 'npm', ['run', script, '--', '--base=-invalid']);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /blocked-test-ref/u, script);
    assert.doesNotMatch(result.output, /running evaluators|already-running/u);
  }
});
test('runner records commands, counts, byte identity, and reuses only the same local result', async t => {
  const env = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  delete process.env.CI; delete process.env.GITHUB_ACTIONS;
  t.after(() => { for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const f = fixture(t);
  assert.equal(await f.invoke(), 0); const first = f.receipt();
  assert.equal(first.authority, false); assert.equal(first.results[1].counts.pass, 1);
  assert.deepEqual(first.results.map(result => result.name), ['evaluators', '__tests__/small.test.mjs']);
  assert.equal(first.identity.sourceDigest.length, 64); assert.equal(first.identity.environmentDigest.length, 64);
  assert.equal(await f.invoke(), 0); assert.ok(f.messages.some(message => message.startsWith('reused local check')));
  assert.equal(f.receipt().results[1].validatedAt, first.results[1].validatedAt, 'reuse cannot renew check lifetime');
  f.messages.length = 0; assert.equal(await f.invoke(['--fresh']), 0);
  assert.equal(f.messages.some(message => message.startsWith('reused')), false);
  process.env.CI = 'true'; f.messages.length = 0; assert.equal(await f.invoke(), 0);
  assert.equal(f.messages.some(message => message.startsWith('reused')), false);
});
test('stale, failed, tampered, incomplete and mismatched check receipts are rejected', async t => {
  const f = fixture(t); assert.equal(await f.invoke(['--fresh']), 0);
  const directory = receiptDirectory(f.root), check = validationChecks(snapshot({ root: f.root, base: 'HEAD' }), f.receipt().plan)[1];
  const valid = previousCheck(directory, check); assert.ok(valid);
  const reuse = value => { writeReceipt(directory, `${check.id}.json`, value); return previousCheck(directory, check); };
  assert.equal(reuse({ ...valid, finishedAt: Date.now() - 3_600_001 }), null);
  assert.equal(reuse({ ...valid, outcome: 'failed' }), null);
  assert.equal(reuse({ ...valid, command: ['different'] }), null);
  assert.equal(reuse({ ...valid, result: { ...valid.result, counts: {} } }), null);
  assert.equal(reuse({ ...valid, authority: true }), null);
  writeReceipt(directory, `${check.id}.log`, 'altered diagnostics');
  assert.equal(reuse(valid), null);
});
test('cheap evaluator failure stops before behavior execution', async t => {
  const f = fixture(t, { evaluator: 'node -e "process.exit(9)"' });
  assert.equal(await f.invoke(), 1); const receipt = f.receipt();
  assert.equal(receipt.outcome, 'failed'); assert.equal(receipt.results.length, 1);
  assert.equal(receipt.results[0].exitCode, 9);
});
test('changed bytes during a passing test invalidate the result', async t => {
  const f = fixture(t);
  writeFileSync(join(f.root, '__tests__/small.test.mjs'),
    "import {writeFileSync} from 'node:fs'; import test from 'node:test'; test('mutates',()=>writeFileSync('drift.txt','changed'));\n");
  assert.equal(await f.invoke(), 1); assert.equal(f.receipt().outcome, 'blocked');
  assert.equal(f.receipt().error, 'blocked-test-input-drift');
});
test('concurrent calls cannot share or steal a worktree receipt', async t => {
  const f = fixture(t), directory = receiptDirectory(f.root), release = lockReceipts(directory);
  await assert.rejects(f.invoke(), /already-running/); release();
  assert.equal(await f.invoke(['--fresh']), 0);
});
test('command timeout, output overflow and missing executable fail with bounded diagnostics', async () => {
  const timeout = await executeCommand(process.cwd(), process.execPath,
    ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 });
  assert.equal(timeout.reason, 'timeout');
  const output = await executeCommand(process.cwd(), process.execPath,
    ['-e', 'process.stdout.write("x".repeat(10000))'], { outputBytes: 100 });
  assert.equal(output.reason, 'output-budget'); assert.ok(Buffer.byteLength(output.output) <= 100);
  const missing = await executeCommand(process.cwd(), '/nonexistent/agentic-test-executable', []);
  assert.equal(missing.reason, 'spawn-failed');
});

test('an unrelated committed document delta reuses a bounded check but reruns its changed inputs', async t => {
  const env = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  delete process.env.CI; delete process.env.GITHUB_ACTIONS;
  t.after(() => { for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const f = fixture(t);
  assert.equal(await f.invoke(), 0); const original = f.receipt().results[1].validatedAt;
  writeFileSync(join(f.root, 'unrelated.md'), '# Documentation'); f.git('add', '.'); f.git('commit', '-qm', 'docs');
  assert.equal(await f.invoke(), 0);
  assert.equal(f.receipt().results[1].reused, true);
  assert.equal(f.receipt().results[1].validatedAt, original);
  writeFileSync(join(f.root, '__tests__/small.test.mjs'), "import test from 'node:test'; test('new behavior',()=>{});\n");
  assert.equal(await f.invoke(), 0); assert.equal(f.receipt().results[1].reused, false);
});
test('plans explain coverage, reuse and measured/default cost without executing evaluators', async t => {
  const f = fixture(t, { evaluator: 'node -e "process.exit(9)"' });
  const messages = [];
  assert.equal(await runTests(['plan', '--base=HEAD'], { root: f.root, out: text => messages.push(text) }), 0);
  const plan = JSON.parse(messages[0]);
  assert.equal(plan.cost.selected, 1); assert.equal(plan.cost.skipped, 0);
  assert.ok(plan.cost.estimatedCommandMs > 0);
  assert.equal(plan.checks[0].estimateSource, 'default-budget-estimate');
  assert.ok(plan.suites[0].reasons.includes('safety-sentinel'));
});

test('passing siblings survive a failed batch and only the corrected check reruns', async t => {
  const env = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
  delete process.env.CI; delete process.env.GITHUB_ACTIONS;
  t.after(() => { for (const [key, value] of Object.entries(env)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  const f = fixture(t);
  writeFileSync(join(f.root, '__tests__/failure.test.mjs'), "import test from 'node:test'; test('failure',()=>{throw Error('expected')});\n");
  assert.equal(await f.invoke(), 1);
  const passed = f.receipt().results.find(result => result.name === '__tests__/small.test.mjs');
  assert.equal(passed.exitCode, 0);
  writeFileSync(join(f.root, '__tests__/failure.test.mjs'), "import test from 'node:test'; test('fixed',()=>{});\n");
  assert.equal(await f.invoke(), 0);
  assert.equal(f.receipt().results.find(result => result.name === passed.name).reused, true);
  assert.equal(f.receipt().results.find(result => result.name === '__tests__/failure.test.mjs').reused, false);
});

test('release check pool fills freed slots, bounds concurrency and preserves stage failure', async () => {
  const started=[], complete=new Map(); let active=0,max=0;
  const checks=Array.from({length:6},(_,i)=>({name:String(i),estimatedMs:6-i}));
  const running=runCheckPool(checks, async check=>{
    started.push(check.name);max=Math.max(max,++active);
    const ok=await new Promise(resolve=>complete.set(check.name,resolve));active--;return ok;
  });
  assert.deepEqual(started,['0','1','2','3']);
  complete.get('1')(true); await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(started,['0','1','2','3','4']);
  complete.get('2')(false); await new Promise(resolve=>setImmediate(resolve));
  for(const id of ['0','3','4'])complete.get(id)(true);
  await running; assert.equal(max,4);assert.equal(active,0);assert(!started.includes('5'));
});
test('release pool waits for active work after a rejection and runs every successful check once',async()=>{
 const checks=Array.from({length:7},(_,i)=>({name:String(i),estimatedMs:i})),visited=[];
 await runCheckPool(checks,async check=>{visited.push(check.name);return true}); assert.equal(new Set(visited).size,7);
 let release,done=false;const gate=new Promise(r=>release=r);
 const result=runCheckPool(checks,async check=>{if(check.name==='6')throw Error('drift');await gate;done=true;return true});
 release();await assert.rejects(result,/drift/);assert.equal(done,true);
});


test('CI executes behavior once, leaves budgets unobserved, and local validation still runs evaluators', async t => {
  const f = fixture(t, { evaluator: 'node -e "process.exit(9)"' });
  mkdirSync(join(f.root, '.github/workflows'), { recursive: true });
  writeFileSync(join(f.root, '.github/workflows/ci.yml'), readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url)));
  f.git('add', '.'); f.git('commit', '-qm', 'required CI contract');
  const revision = f.git('rev-parse', 'HEAD');
  const env = { GITHUB_ACTIONS: 'true', GITHUB_JOB: 'test', GITHUB_SHA: revision, GITHUB_REPOSITORY: 'example/owner',
    GITHUB_WORKFLOW_REF: 'example/owner/.github/workflows/ci.yml@refs/heads/main', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [key, value] of Object.entries(previous))
    value === undefined ? delete process.env[key] : process.env[key] = value; });
  assert.equal(await runTests(['affected', '--base=HEAD', '--committed', '--fresh'],
    { root: f.root, ci: true, out: () => {} }), 0);
  const receipt = f.receipt();
  assert.equal(receipt.results.length, 1); assert.equal(receipt.results[0].name, '__tests__/small.test.mjs');
  assert.equal(receipt.results[0].reused, false);
  assert.equal(receipt.externalRequiredChecks[0].status, 'not-observed');
  await assert.rejects(runTests(['affected', '--base=HEAD'], { root: f.root, ci: true }), /ci-options/);
  assert.equal(await f.invoke(['--fresh']), 1, 'local entrypoint must execute the failing evaluator');
  assert.equal(f.receipt().results[0].exitCode, 9);
});

test('declared prerequisites block every execution mode before discovery or child work', async t => {
  localEnvironment(t);
  const f = declaredFixture(t, { blocked: true, evaluator: 'node -e "process.exit(19)"' });
  for (const mode of ['fast', 'git', 'affected', 'all']) {
    const args = mode === 'fast' || mode === 'git' ? [mode] : [mode, '--base=missing-baseline'];
    await assert.rejects(runTests(args, { root: f.root, out: text => f.messages.push(text) }), /blocked-workflow-dependencies/);
  }
  assert.deepEqual(f.messages, []);
  assert.equal(existsSync(join(receiptDirectory(f.root), 'last.json')), false);
  assert.equal(await runTests(['plan', '--base=HEAD'], { root: f.root, out: text => f.messages.push(text) }), 0);
  assert.equal(JSON.parse(f.messages[0]).cost.selected, 1);
});

test('eligible declarations run and preserve native local reuse until a prerequisite changes', async t => {
  localEnvironment(t);
  const f = declaredFixture(t);
  assert.equal(await f.invoke(), 0);
  assert.equal(await f.invoke(), 0);
  const completed = f.receipt();
  assert.ok(completed.results.every(row => row.reused));
  f.block();
  await assert.rejects(f.invoke(), /blocked-workflow-dependencies/);
  assert.deepEqual(f.receipt(), completed, 'a blocked retry cannot renew or replace valid check evidence');
});

test('dependency drift after planning blocks bound CI reuse under the receipt lock', async t => {
  localEnvironment(t);
  const f = declaredFixture(t, { evaluator: 'node -e "process.exit(19)"' });
  const source = snapshot({ root: f.root, base: 'HEAD' }).identity;
  const observation = { source: { revision: source.headRevision, tree: source.headTree }, ci: { runId: 42 },
    get status() { f.block(); return 'passed'; } };
  assert.equal(await runTests(['affected', '--base=HEAD', '--ci-run=42'],
    { root: f.root, ciObservation: observation, out: text => f.messages.push(text) }), 1);
  assert.equal(f.receipt().outcome, 'blocked');
  assert.match(f.receipt().error, /blocked-workflow-dependencies/);
  assert.deepEqual(f.receipt().results, []);
  const release = lockReceipts(receiptDirectory(f.root)); release();
});

test('new prerequisites prevent local reuse and child execution at their effect boundaries', async t => {
  localEnvironment(t);
  for (const reuse of [false, true]) await t.test(reuse ? 'reuse' : 'child', async child => {
    const f = declaredFixture(child);
    if (reuse) assert.equal(await f.invoke(), 0);
    let blocked = false;
    const out = line => {
      f.messages.push(line);
      if (!blocked && (reuse ? line.startsWith('cost:') : line === 'running evaluators')) {
        blocked = true; f.block();
      }
    };
    assert.equal(await runTests(['affected', '--base=HEAD'], { root: f.root, out }), 1);
    assert.equal(blocked, true);
    assert.match(f.receipt().error, /blocked-workflow-dependencies/);
    assert.deepEqual(f.receipt().results, []);
    const release = lockReceipts(receiptDirectory(f.root)); release();
  });
});

test('selected workflow cannot disappear during execution or cover a different candidate', async t => {
  localEnvironment(t);
  const f = declaredFixture(t);
  let changed = false;
  assert.equal(await runTests(['affected', '--base=HEAD'], { root: f.root, out: line => {
    if (!changed && line === 'running evaluators') {
      changed = true; f.git('config', '--local', '--unset', 'agentic-os.workflowManifest');
    }
  } }), 1);
  assert.equal(f.receipt().error, 'blocked-workflow-effect-identity-drift');
  assert.deepEqual(f.receipt().results, []);
  const g = declaredFixture(t);
  writeFileSync(join(g.root, 'new.md'), '# New candidate'); g.git('add', '.'); g.git('commit', '-qm', 'different source');
  await assert.rejects(g.invoke(), /candidate-revision-drift/);
});

test('legacy selected roots and unrelated declared members preserve standalone execution', async t => {
  localEnvironment(t);
  const f = fixture(t, { workflow: true });
  startWorkflow(f.root, 'github.com/example/test-runner', { revision: f.git('rev-parse', 'HEAD'),
    planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId: basename(f.root) });
  assert.equal(await f.invoke(), 0);
  const unrelated = declaredFixture(t, { blocked: true, memberId: 'another-worktree' });
  assert.equal(await unrelated.invoke(), 0);
});

test('an enrolled run rejects a valid unrelated workflow selected before its child starts', async t => {
  localEnvironment(t);
  const f = declaredFixture(t);
  let switched = false;
  assert.equal(await runTests(['affected', '--base=HEAD'], { root: f.root, out: line => {
    if (!switched && line === 'running evaluators') {
      switched = true;
      startWorkflow(f.root, 'github.com/example/test-runner', { revision: f.git('rev-parse', 'HEAD'),
        planningPath: 'native-prd-tad-adr-mvp-gtm.md', worktreeId: 'unrelated-owner',
        execution: { version: 1, checkoutLimit: 1, dependencies: { version: 1, edges: [] } } });
    }
  } }), 1);
  assert.equal(switched, true);
  assert.equal(f.receipt().error, 'blocked-workflow-effect-identity-drift');
  assert.deepEqual(f.receipt().results, []);
  const release = lockReceipts(receiptDirectory(f.root)); release();
});

test('invalid selected evidence fails closed without enrolling a legacy repository', async t => {
  const f = fixture(t);
  f.git('config', '--local', 'agentic-os.workflowManifest', join(f.root, '.git/missing-manifest.json'));
  await assert.rejects(f.invoke(), /ENOENT/);
  assert.equal(existsSync(join(receiptDirectory(f.root), 'last.json')), false);
  assert.equal(existsSync(join(f.root, '.agentic-os.json')), false);
});

test('legacy fast and git share the receipt lock without fabricating an affected receipt', async t => {
  const f = fixture(t);
  writeFileSync(join(f.root, '__tests__/lane-state.test.mjs'), "import test from 'node:test'; test('fast', () => {});\n");
  for (const mode of ['fast', 'git']) {
    const release = lockReceipts(receiptDirectory(f.root));
    await assert.rejects(runTests([mode], { root: f.root, out: () => {} }), /already-running/); release();
    assert.equal(await runTests([mode], { root: f.root, out: text => f.messages.push(text) }), 0);
  }
  assert.equal(f.messages.filter(text => /# pass 1/u.test(text)).length, 2);
  assert.equal(existsSync(join(receiptDirectory(f.root), 'last.json')), false);
});

test('workflow guard owner bytes participate in every bounded check fingerprint', t => {
  const f = fixture(t), plan = { suites: [{ path: '__tests__/small.test.mjs', stage: 'behavior' }] };
  const check = () => validationChecks(snapshot({ root: f.root, base: 'HEAD' }), plan)[1];
  assert.equal(check().inputs.scope, 'inputs');
  mkdirSync(join(f.root, 'bin'));
  let before = check().fingerprint;
  for (const path of ['.agentic-os.json', 'bin/agentic-os-workflow.mjs',
    'bin/agentic-os-workflow-archive.mjs', 'bin/agentic-os-workflow-observation.mjs']) {
    writeFileSync(join(f.root, path), '// changed owner input\n');
    const after = check().fingerprint;
    assert.notEqual(after, before, path); before = after;
  }
});
