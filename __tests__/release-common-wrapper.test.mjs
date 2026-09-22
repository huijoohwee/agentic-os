import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const wrapper = fileURLToPath(new URL('../bin/agentic-os-release-common-wrapper.mjs', import.meta.url));
test('consumer shim delegates every command to its own native CLI without consumer npm scripts', t => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-wrapper-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); mkdirSync(bin);
  copyFileSync(wrapper, join(bin, 'wrapper.mjs'));
  writeFileSync(join(bin, 'agentic-os.mjs'), `
    process.stdout.write(JSON.stringify(process.argv.slice(2)));
    process.exit(Number(process.env.FIXTURE_EXIT));
  `);
  for (const command of ['start', 'publish', 'finish', 'close', 'complete', 'successor', 'help']) {
    const args = [command, '--ref=agent/device/lane', '--message=literal $() and spaces'];
    const result = spawnSync(process.execPath, [join(bin, 'wrapper.mjs'), '--repo-label=consumer', '--', ...args], {
      cwd: root, env: { ...process.env, PATH: '', FIXTURE_EXIT: '2' }, encoding: 'utf8',
    });
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ['release-common', ...args]);
  }
});

test('consumer shim returns failure when its native process is interrupted', t => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-wrapper-signal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(wrapper, join(root, 'wrapper.mjs'));
  writeFileSync(join(root, 'agentic-os.mjs'), "process.kill(process.pid, 'SIGTERM');\n");
  const result = spawnSync(process.execPath, [join(root, 'wrapper.mjs'), '--', 'complete'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
});
