import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicAdvanceRef, fetch, GitError, git, remoteTransport } from '../src/git.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-exact-ref-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(['init', '--quiet', '--initial-branch=main'], { cwd: root });
  git(['config', 'user.name', 'Fixture'], { cwd: root });
  git(['config', 'user.email', 'fixture@example.invalid'], { cwd: root });
  writeFileSync(join(root, 'base.txt'), 'base\n');
  git(['add', 'base.txt'], { cwd: root });
  git(['commit', '--quiet', '--message', 'base'], { cwd: root });
  const prior = git(['rev-parse', 'HEAD'], { cwd: root });
  const tree = git(['rev-parse', 'HEAD^{tree}'], { cwd: root });
  const target = git(['commit-tree', tree, '-p', prior, '-m', 'target'], { cwd: root });
  return { root, prior, target };
}

test('exact ref transactions never dereference symbolic local, target, or recovery refs', async (t) => {
  for (const role of ['local', 'target', 'recovery']) await t.test(role, (child) => {
    const { root, prior, target } = fixture(child);
    const refs = {
      local: 'refs/heads/canonical',
      target: 'refs/remotes/upstream/canonical',
      recovery: 'refs/agentic-os/recovery',
    };
    for (const ref of Object.values(refs)) git(['update-ref', ref, prior], { cwd: root });
    const referent = `refs/heads/${role}-referent`;
    git(['update-ref', referent, prior], { cwd: root });
    git(['symbolic-ref', refs[role], referent], { cwd: root });

    assert.throws(() => atomicAdvanceRef(refs.local, target, prior, [
      [refs.target, prior], [refs.recovery, prior],
    ], root), (error) => error.reason === 'blocked-symbolic-reference'
      && error.ref === refs[role] && error.symbolicTarget === referent);

    assert.equal(git(['symbolic-ref', refs[role]], { cwd: root }), referent);
    assert.equal(git(['rev-parse', referent], { cwd: root }), prior);
    for (const [name, ref] of Object.entries(refs)) {
      assert.equal(git(['rev-parse', ref], { cwd: root }), prior,
        `${name} ref or its referent must not move`);
    }
  });
});

test('an exact direct-ref transaction advances only its selected local ref', (t) => {
  const { root, prior, target } = fixture(t);
  const local = 'refs/heads/canonical';
  const protectedRef = 'refs/remotes/upstream/canonical';
  const recovery = 'refs/agentic-os/recovery';
  for (const ref of [local, protectedRef, recovery]) git(['update-ref', ref, prior], { cwd: root });

  atomicAdvanceRef(local, target, prior, [
    [protectedRef, prior], [recovery, prior],
  ], root);

  assert.equal(git(['rev-parse', local], { cwd: root }), target);
  assert.equal(git(['rev-parse', protectedRef], { cwd: root }), prior);
  assert.equal(git(['rev-parse', recovery], { cwd: root }), prior);
});

test('transport receipts and Git failures never expose credential-like remote bytes', (t) => {
  const { root } = fixture(t);
  const secret = 'credential-like-transport-token';
  const bare = join(root, secret);
  git(['init', '--quiet', '--bare', bare], { cwd: root });
  git(['remote', 'add', 'origin', `file://${bare}`], { cwd: root });

  const transport = remoteTransport('origin', root);
  const receipt = fetch('origin', root);
  assert.equal(transport.displayUrl, 'opaque://...');
  assert.match(transport.urlDigest, /^[0-9a-f]{64}$/u);
  assert.equal(receipt.url, 'opaque://...');
  assert.match(receipt.urlDigest, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(receipt), new RegExp(secret, 'u'));

  const failure = new GitError(['fetch', `https://user:${secret}@example.invalid/repo`], 128,
    `fatal: unable to read https://user:${secret}@example.invalid/repo`);
  assert.doesNotMatch(`${failure.message}\n${failure.stderr}\n${failure.args.join(' ')}`,
    new RegExp(secret, 'u'));
});
