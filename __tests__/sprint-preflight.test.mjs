import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../src/git.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { put } from '../src/lane-records.mjs';
import { validateReviewBody, pullRequestText } from '../bin/agentic-os-review-body.mjs';
import { validateValidationPolicy } from '../bin/agentic-os-validation-policy.mjs';

test('invalid review input preserves authored bytes and stops before commit hooks or fetch', t => {
  const parent = mkdtempSync(join(tmpdir(), 'sprint-preflight-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), lane = join(parent, 'lane'), bare = join(parent, 'remote.git');
  mkdirSync(root);
  const run = (args, cwd = root) => git(args, { cwd });
  run(['init', '-q', '--initial-branch=main']);
  run(['config', 'user.name', 'Fixture']); run(['config', 'user.email', 'fixture@example.invalid']);
  const profile = createRepositoryProfile({ repository: 'local:fixture',
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: null } });
  writeFileSync(join(root, '.agentic-os.json'), JSON.stringify(profile) + '\n');
  writeFileSync(join(root, 'source.txt'), 'base\n');
  run(['add', '.']); run(['commit', '-qm', 'base']);
  run(['init', '-q', '--bare', bare]); run(['remote', 'add', 'origin', bare]);
  run(['push', '-q', 'origin', 'main']);
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  const ref = 'agent/test/sprint-preflight', head = run(['rev-parse', 'HEAD']);
  run(['worktree', 'add', '-q', '-b', ref, lane]);
  put({ ref, device: 'test', scope: 'sprint-preflight', state: 'active',
    base: 'refs/remotes/origin/main', baseSha: head, worktree: lane,
    writePaths: ['source.txt'] }, lane);
  writeFileSync(join(lane, 'source.txt'), 'authored change\n');
  const hooks = join(parent, 'hooks'), effect = join(parent, 'hook-ran');
  mkdirSync(hooks); writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\ntouch '${effect}'\n`, { mode: 0o755 });
  run(['config', 'core.hooksPath', hooks]);
  const body = join(parent, 'review.md'); writeFileSync(body, 'Source-Head: invented');
  const before = run(['status', '--porcelain'], lane);
  for (const title of [null, 'invalid\ntitle']) {
    if (title !== null) writeFileSync(body, 'Valid body');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/agentic-os.mjs', import.meta.url)),
      'land', '--message=change', `--body-file=${body}`, ...(title === null ? [] : [`--title=${title}`])], { cwd: lane, encoding: 'utf8', timeout: 20000 });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, title === null ? /blocked-review-body-invalid/ : /blocked-review-title-invalid/);
    assert.equal(run(['rev-parse', 'HEAD'], lane), head);
    assert.equal(run(['status', '--porcelain'], lane), before);
    assert.equal(readFileSync(join(lane, 'source.txt'), 'utf8'), 'authored change\n');
    assert.equal(existsSync(effect), false);
    assert.equal(existsSync(join(root, '.git', 'FETCH_HEAD')), false);
    assert.equal(run(['--git-dir', bare, 'for-each-ref', '--format=%(refname)', `refs/heads/${ref}`]), '');
  }
  for (const title of ['', ' ', ' padded', 'trailing ', 'x'.repeat(257), 'x\rY', 'x\0Y', 'x\u007fY', 'x\u0085Y', 'x\u2028Y', 'x\u2029Y'])
    assert.throws(() => validateReviewBody(lane, ref, body, title), { reason: 'blocked-review-title-invalid' });
  for (const title of ['Final review', 'é'.repeat(256), 'Literal $() `title`'])
    assert.equal(pullRequestText(lane, ref, head, head, body, title).title, title);
  assert.equal(pullRequestText(lane, ref, head, head).title, 'sprint-preflight: 0 commits');
});

test('repository-owned review metadata rejects stale successor scope before publication', t => {
  const root = mkdtempSync(join(tmpdir(), 'review-body-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(['init', '-q', '--initial-branch=main'], { cwd: root });
  git(['config', 'user.name', 'Fixture'], { cwd: root }); git(['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  writeFileSync(join(root, 'source'), 'base'); git(['add', '.'], { cwd: root }); git(['commit', '-qm', 'base'], { cwd: root });
  const policy = { schema: 'agentic-os/repository-validation-policy/v1', repository: 'github.com/example/repo',
    broadInputs: [], always: [], fallback: ['check'], checks: [{ id: 'check', command: ['node', 'check.mjs'],
      inputs: ['*'], requires: [], reuse: 'never', timeoutMs: 1000 }], reviewBodyCheck: 'review.mjs' };
  writeFileSync(join(root, '.agentic-os-validation.json'), JSON.stringify(policy));
  writeFileSync(join(root, 'review.mjs'), `import {readFileSync} from 'node:fs';
    const {schema,ref,body}=JSON.parse(readFileSync(0,'utf8'));
    if(schema!=='agentic-os/review-body-input/v1'||!body.includes('scope: #'+ref.split('/')[2]+'\\n'))process.exit(1);`);
  const body = join(root, 'review.md');
  writeFileSync(body, '---\nscope: #old\n---\nReview');
  assert.throws(() => validateReviewBody(root, 'agent/test/new', body), { reason: 'blocked-review-body-invalid' });
  assert.throws(() => validateReviewBody(root, 'agent/test/new', null), { reason: 'blocked-review-body-invalid' });
  writeFileSync(body, '---\nscope: #new\n---\nReview');
  assert.doesNotThrow(() => validateReviewBody(root, 'agent/test/new', body));
  for (const reviewBodyCheck of ['../escape.mjs', '/absolute.mjs', 'script.mjs;echo', null])
    assert.throws(() => validateValidationPolicy({ ...policy, reviewBodyCheck }));
  writeFileSync(join(root, 'review.mjs'), 'process.stderr.write("invalid scope");process.exit(2)');
  assert.throws(() => validateReviewBody(root, 'agent/test/new', body), /invalid scope/);
});
