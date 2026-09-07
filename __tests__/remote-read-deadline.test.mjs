import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { git } from '../src/git-tracked.mjs';
import { REMOTE_READ_TIMEOUT_MS } from '../bin/agentic-os-git-read.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'remote-read-deadline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = join(root, 'pids.json');
  const source = join(root, 'fake.mjs');
  writeFileSync(source, `import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const mode=process.env.READ_MODE;
if(mode==='success'){process.stdout.write('abc\\trefs/heads/main\\n');process.exit(0)}
if(mode==='failure'){process.stdout.write('partial');process.stderr.write('denied');process.exit(7)}
process.on('SIGTERM',()=>{});
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'});
writeFileSync(process.env.READ_MARKER,JSON.stringify([process.pid,child.pid]));
process.stdout.write(mode==='overflow'?'x'.repeat(65537):'abc\\trefs/heads/main\\n');
if(mode==='leader-exit')process.exit(0);
setInterval(()=>{},1000);
`);
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(join(root, 'git'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(source)}\n`, { mode: 0o755 });
  return { marker, run: (mode, timeout = 750) => git(['ls-remote', '--refs', '--', 'unused'], {
    cwd: root, remoteReadTimeoutMs: timeout, maxBuffer: 65536,
    env: { PATH: `${root}:${process.env.PATH}`, READ_MODE: mode, READ_MARKER: marker },
  }) };
}
const posix = { skip: process.platform === 'win32' };

test('remote read deadline preserves success and discards output on ordinary failure', posix, t => {
  const f = fixture(t);
  assert.equal(f.run('success'), 'abc\trefs/heads/main');
  assert.throws(() => f.run('failure'), error => error.name === 'GitError'
    && error.stderr === 'denied' && !error.message.includes('partial'));
  assert.equal(REMOTE_READ_TIMEOUT_MS, 15000);
});

for (const mode of ['hang', 'overflow', 'leader-exit']) test(`remote read ${mode} kills the transport tree and returns no partial evidence`, posix, async t => {
  const f = fixture(t), started = Date.now();
  assert.throws(() => f.run(mode), error => error.name === 'GitError'
    && /timed out|byte limit/u.test(error.stderr) && !error.stderr.includes('refs/heads/main'));
  assert.ok(Date.now() - started < 3000, 'a blocked read must not wait for the transport connection timeout');
  const pids = JSON.parse(readFileSync(f.marker, 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 50));
  for (const pid of pids) {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
    assert.ok(result.status !== 0 || result.stdout.trim().startsWith('Z'), `transport process ${pid} remains live`);
  }
});

test('invalid deadlines fail before a transport is started', posix, t => {
  const f = fixture(t);
  for (const timeout of [0, -1, 99, 15001, 1.5, NaN, Infinity, null, '750']) {
    assert.throws(() => f.run('hang', timeout), /invalid remote read deadline/u);
  }
  assert.equal(existsSync(f.marker), false);
});
