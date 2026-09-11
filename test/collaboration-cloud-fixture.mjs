/** Synthetic enrollment for the on-demand cloud proof; never reads the private workspace. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture, consolidate, policy } from '../__tests__/helpers/workspace.mjs';
import { git, observeGit, publishExactNewRef, remoteRefSha } from '../src/git.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { syncWorkspace } from '../bin/agentic-os-workspace-sync.mjs';
import { collaborationContext, observeBoard, updateBoard, BOARD_REF } from '../bin/agentic-os-collaboration-store.mjs';

export const SEED_REF = 'agentic-os/collaboration-fixture-v1';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const run = (cwd, args) => git(args, { cwd, maxBuffer: 65536, timeout: 15000 });
export function writeProof(path, value) {
  const bytes = JSON.stringify(value, null, 2) + '\n';
  assert.ok(Buffer.byteLength(bytes) <= 65536, 'proof byte budget');
  writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
}
export function readEnvelope(path) {
  const value = JSON.parse(readBoundedFile(path, 16384, 'cloud enrollment'));
  assert.equal(value.schema, 'agentic-os/cloud-collaboration-enrollment/v1');
  assert.match(value.runId, /^[0-9]+-[0-9]+$/u);
  for (const key of ['sourceSha', 'contextSha', 'runtimeSha', 'revision'])
    assert.match(value[key], /^[a-f0-9]{40}$/u);
  assert.match(value.bundleSha256, /^[a-f0-9]{64}$/u);
  assert.equal(value.boardRef, BOARD_REF); assert.equal(value.fixtureRef, SEED_REF);
  assert.ok(Number.isSafeInteger(value.startAt));
  return value;
}
export function checkoutState(root) {
  const read = args => observeGit(args, { cwd: root, maxBuffer: 65536 });
  const names = read(['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  assert.ok(names.length <= 32, 'synthetic file budget');
  return { head: run(root, ['rev-parse', 'HEAD']),
    index: hash(readFileSync(join(root, '.git/index'))),
    status: read(['status', '--porcelain=v1', '-z']),
    files: names.sort().map(path => [path, hash(readBoundedFile(join(root, path), 16384, 'fixture file'))]) };
}
export function prepareFixture(output, { remote, runId, runtimeSha, startDelayMs = 60000 }) {
  assert.match(runId, /^[0-9]+-[0-9]+$/u); assert.match(runtimeSha, /^[a-f0-9]{40}$/u);
  mkdirSync(output, { mode: 0o700 }); output = realpathSync(output);
  const cleanup = [], s = consolidate(fixture({ after: callback => cleanup.push(callback) }));
  try {
    // The one immutable synthetic workspace tree is reused across runs; no branch-per-run sprawl.
    run(s.container, ['remote', 'set-url', 'origin', remote]);
    const tree = run(s.container, ['rev-parse', 'HEAD^{tree}']);
    let contextSha = remoteRefSha('origin', SEED_REF, s.container, remote);
    if (contextSha) {
      run(s.container, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', contextSha]);
      assert.equal(run(s.container, ['rev-parse', `${contextSha}^{tree}`]), tree, 'foreign fixture tree');
    } else {
      contextSha = run(s.container, ['rev-parse', 'HEAD']);
      publishExactNewRef('origin', SEED_REF, contextSha, s.container, remote);
    }
    run(s.container, ['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin',
      `refs/heads/${SEED_REF}:refs/remotes/origin/${SEED_REF}`]);
    const config = { ...s.config, remote, branch: SEED_REF };
    writeFileSync(join(s.root, '.agentic-os-workspace.json'), JSON.stringify(config));
    s.commit(s.root); run(s.root, ['push', '--quiet', 'origin', 'main']);
    run(s.root, ['config', '--local', 'agentic-os.collaborationEnabled', 'true']);
    const profile = JSON.parse(readFileSync(join(s.root, '.agentic-os.json')));
    const synced = syncWorkspace(s.root, policy); assert.equal(synced.sourceRevision, contextSha);
    const context = collaborationContext(s.root, policy, profile), initial = observeBoard(context);
    const retained = initial.revision
      ? JSON.parse(run(context.source, ['show', `${initial.revision}:board.json`])).tasks : [];
    assert.equal(retained.length, 0, 'retained tasks require explicit reconciliation before another proof');
    assert.equal(initial.active, 0, 'foreign claims');
    const sourceSha = run(s.root, ['rev-parse', 'HEAD']);
    const bundle = join(output, 'consumer.bundle'); run(s.root, ['bundle', 'create', bundle, 'main']);
    const bundleBytes = readBoundedFile(bundle, 1048576, 'synthetic consumer bundle');
    let revision = initial.revision ?? 'absent';
    for (const [suffix, writePaths] of [['race', []], ['left', ['proof/left']],
      ['right', ['proof/right']], ['overlap', ['proof/left/nested']]]) {
      const published = updateBoard(context, 'submit', { expectedRevision: revision,
        id: `probe-${runId}-${suffix}`, sourceRevision: sourceSha, contextRevision: contextSha,
        objective: 'Synthetic cloud coordination validation; no product effects or model calls.',
        writePaths, maxSeconds: 300, maxTokens: 1 });
      revision = published.revision;
    }
    const envelope = { schema: 'agentic-os/cloud-collaboration-enrollment/v1', runId, runtimeSha,
      remote, fixtureRef: SEED_REF, boardRef: BOARD_REF, sourceSha, contextSha, revision,
      bundleSha256: hash(bundleBytes), startAt: Date.now() + startDelayMs };
    writeProof(join(output, 'enrollment.json'), envelope); return envelope;
  } finally { for (const action of cleanup.reverse()) action(); }
}
export function enrollPeer(input, destination) {
  const envelope = readEnvelope(join(input, 'enrollment.json'));
  const bundle = join(input, 'consumer.bundle');
  assert.equal(hash(readBoundedFile(bundle, 1048576, 'consumer bundle')), envelope.bundleSha256);
  mkdirSync(destination, { mode: 0o700 }); destination = realpathSync(destination);
  const root = join(destination, 'consumer'), workspace = join(destination, 'workspace');
  run(destination, ['clone', '--quiet', '--branch', 'main', '--', resolve(bundle), root]);
  assert.equal(run(root, ['rev-parse', 'HEAD']), envelope.sourceSha);
  run(destination, ['clone', '--quiet', '--single-branch', '--branch', SEED_REF, '--', envelope.remote, workspace]);
  assert.equal(run(workspace, ['rev-parse', 'HEAD']), envelope.contextSha, 'context drift');
  for (const cwd of [root, workspace]) {
    run(cwd, ['config', 'user.name', 'Cloud collaboration proof']);
    run(cwd, ['config', 'user.email', 'proof@example.invalid']);
  }
  const profile = JSON.parse(readFileSync(join(root, '.agentic-os.json')));
  ensureRepositoryTrust(root, profile, { allowCreate: true });
  run(root, ['config', '--local', 'agentic-os.workspaceRoot', workspace]);
  run(root, ['config', '--local', 'agentic-os.collaborationEnabled', 'true']);
  const synced = syncWorkspace(root, policy); assert.equal(synced.sourceRevision, envelope.contextSha);
  const context = collaborationContext(root, policy, profile);
  writeFileSync(join(root, 'unfinished.txt'), 'Preserve this untracked consumer draft.\n');
  writeFileSync(join(workspace, '.memory/README.md'), 'Preserve this dirty workspace draft.\n');
  return { envelope, context, root, workspace,
    before: { consumer: checkoutState(root), workspace: checkoutState(workspace) } };
}
export function removeFixture(path) {
  // Only the freshly created synthetic peer directory is passed by this harness.
  rmSync(path, { recursive: true });
}
