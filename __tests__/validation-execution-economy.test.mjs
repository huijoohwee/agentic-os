import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { executeCommand, receiptDirectory } from '../bin/agentic-os-test-receipt.mjs';
import { runValidationStages } from '../bin/agentic-os-validation-stages.mjs';
const executor = new URL('../bin/agentic-os-test-receipt.mjs', import.meta.url).href;
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
