import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROVIDER = new URL('../src/github-provider.mjs', import.meta.url).href;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const HEAD = 'a'.repeat(40);
const REVIEW = {
  number: 1, state: 'OPEN', url: 'https://github.com/owner/repo/pull/1',
  headRefOid: HEAD, headRefName: 'agent/device/timeout', baseRefName: 'main',
  headRepository: { nameWithOwner: 'owner/repo' }, isCrossRepository: false,
  body: `Source-Head: ${HEAD}`, mergeQueueEntry: { id: 'queue-entry' },
};

function fixture(t, mode) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-provider-deadline-'));
  const support = join(root, 'bin'), executable = join(support, 'gh');
  const script = join(root, 'provider.mjs'), log = join(root, 'calls.jsonl');
  mkdirSync(support);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(script, `
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2), mode = process.env.PROVIDER_DEADLINE_MODE;
appendFileSync(process.env.PROVIDER_DEADLINE_LOG, JSON.stringify({ args, pid: process.pid }) + '\\n');
const result = (value) => { process.stdout.write(JSON.stringify(value)); process.exit(0); };
if (mode === 'success') {
  if (args[0] === '--version') { process.stdout.write('gh fixture\\n'); process.exit(0); }
  result({ args, input: readFileSync(0, 'utf8') });
}
if (mode === 'http-error') {
  process.stderr.write('HTTP 403: denied\\n'); process.exit(1);
}
if (mode === 'write-timeout') {
  if (args[0] === 'pr' && args[1] === 'list') result([]);
  if (args[0] === 'pr' && args[1] === 'view') result(${JSON.stringify(REVIEW)});
  if (args[0] === 'api' && args[1] === 'graphql') result({ data: { resource: ${JSON.stringify(REVIEW)} } });
  if (args[0] !== 'pr' || args[1] !== 'create') process.exit(97);
  writeFileSync(process.env.PROVIDER_DEADLINE_EFFECT, 'review created\\n');
}
process.on('SIGTERM', () => {});
process.stderr.write('HTTP 404: branch not protected\\n');
process.stdout.write('{"partial":');
setTimeout(() => process.exit(0), 8_000);
`);
  writeFileSync(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`);
  chmodSync(executable, 0o755);
  return {
    root,
    calls: () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse),
    run(code) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e',
        `import * as provider from ${JSON.stringify(PROVIDER)};\n${code}`], {
        cwd: root, encoding: 'utf8', timeout: 6_000,
        env: { ...process.env, PATH: `${support}:${process.env.PATH}`,
          PROVIDER_DEADLINE_MODE: mode, PROVIDER_DEADLINE_LOG: log,
          PROVIDER_DEADLINE_EFFECT: join(root, 'effect') },
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    },
  };
}

test('direct provider read hard-kills a hung process and discards partial HTTP evidence', (t) => {
  const subject = fixture(t, 'hang');
  const observed = subject.run(`
    const start = Date.now();
    const value = provider.gh(['api', 'repos/owner/repo'], { timeoutMs: 1_500 });
    console.log(JSON.stringify({ value, elapsed: Date.now() - start,
      error: provider.lastError, httpStatus: provider.lastHttpStatus }));
  `);
  assert.equal(observed.value, null);
  assert.match(observed.error, /timed out after 1500ms/u);
  assert.equal(observed.httpStatus, null);
  assert.ok(observed.elapsed < 3_000, 'SIGTERM resistance must not keep the caller blocked');
  const calls = subject.calls();
  assert.equal(calls.length, 1);
  assert.throws(() => process.kill(calls[0].pid, 0), { code: 'ESRCH' });
});

test('the availability probe also terminates a hung executable', (t) => {
  const subject = fixture(t, 'hang');
  assert.equal(subject.run(`console.log(JSON.stringify(provider.ghAvailable({ timeoutMs: 1_500 })));`), false);
  const calls = subject.calls();
  assert.deepEqual(calls.map(({ args }) => args), [['--version']]);
  assert.throws(() => process.kill(calls[0].pid, 0), { code: 'ESRCH' });
});

test('invalid deadlines cannot disable the subprocess bound or execute the provider', (t) => {
  const subject = fixture(t, 'success');
  const observed = subject.run(`
    const results = [0, -1, 15_001, 1.5, NaN, Infinity, '250', null].map((timeoutMs) => ({
      available: provider.ghAvailable({ timeoutMs }),
      value: provider.gh(['api', 'unreachable'], { timeoutMs }), error: provider.lastError,
    }));
    console.log(JSON.stringify(results));
  `);
  assert.ok(observed.every((entry) => entry.available === false && entry.value === null
    && /timeoutMs must be an integer/u.test(entry.error)));
  assert.throws(() => subject.calls(), { code: 'ENOENT' });
});

test('successful commands preserve argument and input bytes under the default deadline', (t) => {
  const subject = fixture(t, 'success');
  const observed = subject.run(`
    const available = provider.ghAvailable();
    const value = provider.gh(['api', 'repo with spaces;literal'], { input: 'body\\nline 2' });
    console.log(JSON.stringify({ available, value, error: provider.lastError, status: provider.lastHttpStatus }));
  `);
  assert.equal(observed.available, true);
  assert.deepEqual(observed.value, { args: ['api', 'repo with spaces;literal'], input: 'body\nline 2' });
  assert.equal(observed.error, null);
  assert.equal(observed.status, null);
});

test('ordinary provider failures retain their HTTP status and diagnostic', (t) => {
  const subject = fixture(t, 'http-error');
  assert.deepEqual(subject.run(`
    const value = provider.gh(['api', 'repos/owner/repo']);
    console.log(JSON.stringify({ value, error: provider.lastError, status: provider.lastHttpStatus }));
  `), { value: null, error: 'HTTP 403: denied', status: 403 });
});

test('a timed-out write stays unknown after an exact read and is never retried', (t) => {
  const subject = fixture(t, 'write-timeout');
  const receipt = subject.run(`
    const receipt = provider.enqueue('agent/device/timeout', {
      expectedHead: ${JSON.stringify(HEAD)}, expectedRepository: 'github.com/owner/repo', baseBranch: 'main',
      body: ${JSON.stringify(REVIEW.body)}, assertSourceHead: () => true,
      provider: (args, options) => provider.gh(args, { ...options, timeoutMs: 1_500 }),
    });
    console.log(JSON.stringify(receipt));
  `);
  assert.equal(readFileSync(join(subject.root, 'effect'), 'utf8'), 'review created\n');
  assert.equal(receipt.ok, false);
  assert.equal(receipt.reason, 'review-write-result-unknown');
  assert.equal(receipt.reviewMutationAttempted, true);
  assert.equal(receipt.reviewWriteResultUnknown, true);
  assert.equal(receipt.reviewReobservationExact, true);
  assert.equal(receipt.reviewRequiresAttention, true);
  assert.deepEqual(subject.calls().map(({ args }) => args.slice(0, 2)), [
    ['pr', 'list'], ['pr', 'create'], ['pr', 'view'], ['api', 'graphql'],
  ]);
});
