import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, renameSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { executeCommand, lockReceipts, receiptDirectory } from '../bin/agentic-os-test-receipt.mjs';
import { runValidationStages } from '../bin/agentic-os-validation-stages.mjs';
const executor = new URL('../bin/agentic-os-test-receipt.mjs', import.meta.url).href;
const stagesModule = new URL('../bin/agentic-os-validation-stages.mjs', import.meta.url).href;
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'execution-economy-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  git('remote', 'add', 'origin', 'https://github.com/example/consumer.git');
  git('commit', '--allow-empty', '-m', 'baseline');
  return { root, git };
}
const noLocks = root => assert.equal(readdirSync(receiptDirectory(root, 'execution')).length, 0);

test('stage aliases cannot repeat one command, and preflight executes neither alias', async t => {
  const { root } = fixture(t), marker = join(root, '.git', 'executed');
  const args = ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
  await assert.rejects(runValidationStages(root, [
    { id: 'first', command: ['node', ...args], timeoutMs: 1000 },
    { id: 'alias', command: ['node', ...args], timeoutMs: 2000 },
  ], { out: () => {} }), /duplicate-command/);
  assert.equal(existsSync(marker), false);
});

test('overlapping commands are excluded across processes and release after timeout', async t => {
  const { root } = fixture(t), args = ['-e', 'setInterval(()=>{},1000)'];
  const pending = executeCommand(root, 'node', args, { timeoutMs: 1500 });
  assert.throws(() => executeCommand(root, process.execPath, args), /already-running/);
  const probe = `import {executeCommand} from ${JSON.stringify(executor)};
    try { await executeCommand(${JSON.stringify(root)},'node',${JSON.stringify(args)}); process.exitCode=2; }
    catch(error) { console.log(error.message); }`;
  assert.match(execFileSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' }), /already-running/);
  const independent = await executeCommand(root, 'node', ['-e', 'console.log("distinct")']);
  assert.equal(independent.exitCode, 0);
  assert.equal((await pending).reason, 'timeout'); noLocks(root);
});

test('shared-clone commands conflict across worktrees without preventing independent commands', async t => {
  const { root, git } = fixture(t), linked = join(root, 'linked');
  git('worktree', 'add', '--detach', linked, 'HEAD');
  const args = ['-e', 'setInterval(()=>{},1000)'];
  const pending = executeCommand(root, 'node', args, { timeoutMs: 300 });
  assert.throws(() => executeCommand(linked, 'node', args), /already-running/);
  await pending; noLocks(root);
});

test('recursive command cycles stop before spawning another copy', async t => {
  const { root } = fixture(t), script = join(root, '.git', 'recursive.mjs'), marker = join(root, '.git', 'calls');
  writeFileSync(script, `import {appendFileSync} from 'node:fs';
    import {executeCommand} from ${JSON.stringify(executor)};
    appendFileSync(${JSON.stringify(marker)}, 'one\\n');
    await executeCommand(${JSON.stringify(root)}, 'node', [${JSON.stringify(script)}]);`);
  const result = await executeCommand(root, 'node', [script], { timeoutMs: 3000 });
  assert.notEqual(result.exitCode, 0); assert.match(result.output, /blocked-command-recursion/);
  assert.equal(readFileSync(marker, 'utf8'), 'one\n'); noLocks(root);
});

test('spawn failure and synchronous spawn rejection retain no command lock', async t => {
  const { root } = fixture(t);
  assert.equal((await executeCommand(root, '/agentic-os-no-such-command', [])).reason, 'spawn-failed');
  noLocks(root);
  await assert.rejects(executeCommand(root, 'node', ['\0']), /null bytes/); noLocks(root);
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} drains nested native stages and only owned command locks`,
  { skip: process.platform === 'win32', timeout: 10000 }, async t => {
    const { root, git } = fixture(t), linked = join(root, 'linked');
    git('worktree', 'add', '--detach', linked, 'HEAD');
    const privatePath = name => join(root, '.git', name), ready = privatePath('ready'), nested = privatePath('nested.mjs');
    const leaf = `process.on('SIGTERM',()=>setTimeout(()=>process.exit(143),80)); `
      + `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(()=>{},1000)`;
    writeFileSync(nested, `import {runValidationStages} from ${JSON.stringify(stagesModule)};
      try { await runValidationStages(${JSON.stringify(linked)}, [{id:'leaf',command:['node','-e',${JSON.stringify(leaf)}],timeoutMs:5000}],{out:()=>{}}); }
      catch { process.exitCode=1; }`);
    const runner = `import {runValidationStages} from ${JSON.stringify(stagesModule)};
      try { await runValidationStages(${JSON.stringify(root)}, [{id:'nested',command:['node',${JSON.stringify(nested)}],timeoutMs:5000}],{out:()=>{}}); }
      catch { process.exitCode=1; }`;
    const owner = spawn(process.execPath, ['--input-type=module', '-e', runner], { stdio: 'ignore' });
    const exited = once(owner, 'exit');
    t.after(() => { owner.kill('SIGKILL'); if (existsSync(ready)) {
      try { process.kill(Number(readFileSync(ready, 'utf8')), 'SIGKILL'); } catch {} } });
    const until = Date.now() + 4000;
    while (!existsSync(ready) && Date.now() < until) await delay(20);
    assert.ok(existsSync(ready), 'nested command reached its ready marker');
    // A live independent command in this clone must keep its lock and process.
    const releaseForeign = privatePath('foreign-release');
    const foreign = executeCommand(root, 'node', ['-e',
      `setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(releaseForeign)}))process.exit(0)},20)`], { timeoutMs: 5000 });
    try {
      owner.kill(signal);
      await delay(10); owner.kill(signal);
      const [code] = await exited;
      assert.notEqual(code, 0);
      for (const stageRoot of [root, linked]) {
        const directory = join(receiptDirectory(stageRoot), 'stages');
        assert.equal(existsSync(join(directory, 'running')), false, 'owned stage lock released');
        const receipt = JSON.parse(readFileSync(join(directory, 'validation-stages.json'), 'utf8'));
        assert.equal(receipt.outcome, 'failed'); assert.equal(receipt.active, null);
        assert.equal(receipt.results.length, 1); assert.equal(receipt.results[0].reason, 'cancelled');
      }
      assert.equal(readdirSync(receiptDirectory(root, 'execution')).length, 1, 'only live foreign lock remains');
      assert.throws(() => process.kill(Number(readFileSync(ready, 'utf8')), 0), /ESRCH/, 'owned leaf is gone');
    } finally { writeFileSync(releaseForeign, 'release'); await foreign; }
    assert.equal((await foreign).exitCode, 0); noLocks(root);
  });

test('release refuses to remove a replacement lock owned by another executor', t => {
  const { root } = fixture(t), directory = receiptDirectory(root), release = lockReceipts(directory);
  renameSync(join(directory, 'running'), join(directory, 'retained-owner'));
  mkdirSync(join(directory, 'running'));
  assert.throws(release, /lock-drift/);
  assert.ok(existsSync(join(directory, 'running')));
});

test('uncooperative cancellation remains bounded and tears down the owned process group', async t => {
  const { root } = fixture(t);
  const result = await executeCommand(root, 'node', ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { timeoutMs: 500 });
  assert.equal(result.reason, 'timeout');
  assert.ok(result.elapsedMs < 3000, 'the existing 250 ms force deadline remains bounded'); noLocks(root);
});
