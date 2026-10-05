import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { load, put, get, putExact } from '../src/lane-records.mjs';
import { fileURLToPath } from 'node:url';
import { cmdStart } from '../bin/agentic-os-admission.mjs';
import { readSelectedWorkflow } from '../bin/agentic-os-workflow.mjs';
import { createRepositoryProfile } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { lanePath, runPublishedLaneSuccessor } from '../src/worktree.mjs';
import { worktrees } from '../src/git.mjs';
import { planLaneAlignment, prepareLaneAlignment, applyLaneAlignment, validateLaneAlignmentInput } from '../bin/agentic-os-lane-alignment.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 }).trim();
const bytes = (cwd, revision, path) => execFileSync('git', ['show', `${revision}:${path}`], { cwd });
function write(root, path, value, mode = 0o644) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value); chmodSync(join(root, path), mode);
}
const commit = (cwd, message = 'fixture') => { git(cwd, 'add', '--all'); git(cwd, 'commit', '--quiet', '-m', message); return git(cwd, 'rev-parse', 'HEAD'); };
function fixture(t, incoming = 'incoming/new module.sh', squash = false) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'lane-alignment-'))), root = join(parent, 'repo'), lane = join(parent, 'lane');
  const priorGlobal = process.env.GIT_CONFIG_GLOBAL, priorSystem = process.env.GIT_CONFIG_NOSYSTEM;
  process.env.GIT_CONFIG_GLOBAL = join(parent, 'global-config'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, ''); mkdirSync(root);
  t.after(() => {
    if (priorGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = priorGlobal;
    if (priorSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = priorSystem;
    rmSync(parent, { recursive: true, force: true });
  });
  git(root, 'init', '--quiet', '--initial-branch=main');
  for (const [key, value] of [['user.name', 'Fixture'], ['user.email', 'fixture@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false'], ['core.filemode', 'true']]) git(root, 'config', key, value);
  write(root, 'owned/edit.txt', 'base edit\n'); write(root, 'owned/delete.txt', 'base delete\n');
  write(root, 'owned/tool.sh', '#!/bin/sh\nexit 0\n', 0o755); write(root, 'legacy.txt', 'base legacy\n');
  const base = commit(root), remote = join(parent, 'remote.git');
  git(root, 'init', '--quiet', '--bare', remote); git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '--quiet', '-u', 'origin', 'main');
  const predecessor = 'agent/test/published', ref = 'agent/test/successor';
  git(root, 'worktree', 'add', '--quiet', '-b', predecessor, lane, base);
  write(lane, 'legacy.txt', 'old94 retained UI\n'); write(lane, 'lane/committed.txt', 'published UI\n');
  const head = commit(lane); git(lane, 'push', '--quiet', 'origin', predecessor); git(lane, 'switch', '--quiet', '-c', ref);
  const prior = { ref: predecessor, state: 'published', head, base: 'refs/remotes/origin/main', baseSha: base, worktree: lane, writePaths: ['owned', 'lane', 'legacy.txt'] };
  put(prior, root); put({ ...prior, ref, state: 'active', handoff: { schema: 'agentic-os-lane-successor/v1', predecessorRef: predecessor, predecessorHead: head } }, root);
  if (squash) git(root, 'merge', '--squash', predecessor);
  else write(root, incoming, '#!/bin/sh\nprintf protected\n', 0o755);
  const target = commit(root, squash ? 'protected squash fixture' : 'fixture'); git(root, 'push', '--quiet', 'origin', 'main');
  if (squash) {
    assert.notEqual(target, head, 'a squash fixture must have a distinct protected commit');
    assert.equal(git(root, 'rev-parse', `${target}^{tree}`), git(root, 'rev-parse', `${head}^{tree}`));
  }
  const dirtyBytes = Buffer.from([0, 255, 13, 10, 82, 69, 84, 65, 73, 78]);
  write(lane, 'owned/edit.txt', dirtyBytes); rmSync(join(lane, 'owned/delete.txt'));
  chmodSync(join(lane, 'owned/tool.sh'), 0o644); write(lane, 'owned/- option "quote".txt', Buffer.from('untracked\0bytes\r\n'), 0o755);
  const args = { cwd: lane, ref, expectedHead: head, targetRef: 'refs/remotes/origin/main', expectedTarget: target, stopped: true };
  return { root, lane, ref, predecessor, prior, head, target, incoming, args, dirtyBytes };
}
const plan = (f, overrides = {}) => planLaneAlignment({ ...f.args, ...overrides });
function refusal(reason, fn) { assert.throws(fn, error => error.reason === `blocked-lane-alignment-${reason}` || String(error.message).includes(`blocked-lane-alignment-${reason}`)); }
function unchanged(f, head = f.head) {
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(readFileSync(join(f.lane, 'owned/edit.txt')), f.dirtyBytes);
  assert.equal(existsSync(join(f.lane, 'owned/delete.txt')), false);
  assert.equal(git(f.lane, 'diff', '--cached', '--name-only'), '');
}

test('alignment joins both histories and preserves exact dirty bytes, modes and published predecessor', t => {
  const f = fixture(t), beforeStatus = git(f.lane, 'status', '--porcelain'), beforeCache = load(f.root);
  const fresh = plan(f); unchanged(f); assert.equal(fresh.candidateHead, null);
  assert.equal(git(f.lane, 'status', '--porcelain'), beforeStatus); assert.deepEqual(load(f.root), beforeCache);
  const prepared = prepareLaneAlignment(fresh); unchanged(f);
  const receipt = applyLaneAlignment(prepared);
  assert.equal(receipt.schema, 'agentic-os/lane-alignment-receipt/v1');
  assert.equal(receipt.previousHead, f.head); assert.equal(receipt.targetHead, f.target); unchanged(f, receipt.head);
  assert.deepEqual(git(f.lane, 'rev-list', '--parents', '-n', '1', receipt.head).split(' ').slice(1), [f.head, f.target]);
  assert.equal(git(f.root, 'rev-parse', f.predecessor), f.head); assert.deepEqual(JSON.parse(JSON.stringify(load(f.root).lanes[f.predecessor])), f.prior);
  assert.deepEqual(bytes(f.lane, receipt.head, 'legacy.txt'), Buffer.from('old94 retained UI\n'));
  assert.deepEqual(bytes(f.lane, receipt.head, 'lane/committed.txt'), bytes(f.lane, f.head, 'lane/committed.txt'));
  assert.deepEqual(bytes(f.lane, receipt.head, f.incoming), bytes(f.root, f.target, f.incoming));
  assert.match(git(f.lane, 'ls-tree', receipt.head, '--', f.incoming), /^100755 /u);
  assert.equal(lstatSync(join(f.lane, 'owned/tool.sh')).mode & 0o777, 0o644);
  assert.equal(lstatSync(join(f.lane, 'owned/- option "quote".txt')).mode & 0o777, 0o755);
  assert.deepEqual(readFileSync(join(f.lane, 'owned/- option "quote".txt')), Buffer.from('untracked\0bytes\r\n'));
  assert.deepEqual(new Set(receipt.preservedDirtyPaths), new Set(['owned/edit.txt', 'owned/delete.txt', 'owned/tool.sh', 'owned/- option "quote".txt']));
  assert.equal(git(f.root, 'status', '--porcelain'), '', 'canonical fixture remains untouched');
});

test('staged index, unstopped writer and published successor refuse without touching authored bytes', async t => {
  for (const reason of ['index', 'intent', 'stopped', 'published']) await t.test(reason, sub => {
    const f = fixture(sub);
    if (reason === 'index') git(f.lane, 'add', '--', 'owned/edit.txt');
    if (reason === 'intent') git(f.lane, 'add', '-N', '--', 'owned/- option "quote".txt');
    if (reason === 'published') git(f.lane, 'push', '--quiet', 'origin', f.ref);
    refusal(reason === 'intent' ? 'index' : reason, () => plan(f, reason === 'stopped' ? { stopped: false } : {}));
    assert.equal(git(f.lane, 'rev-parse', 'HEAD'), f.head); assert.deepEqual(readFileSync(join(f.lane, 'owned/edit.txt')), f.dirtyBytes);
  });
});

test('head and protected target drift after planning fail before checkout', async t => {
  for (const reason of ['head', 'target']) await t.test(reason, sub => {
    const f = fixture(sub), prepared = prepareLaneAlignment(plan(f));
    if (reason === 'head') git(f.lane, 'commit', '--allow-empty', '--quiet', '-m', 'concurrent head');
    else { write(f.root, 'later.txt', 'concurrent main\n'); commit(f.root); git(f.root, 'push', '--quiet', 'origin', 'main'); }
    const head = git(f.lane, 'rev-parse', 'HEAD'); refusal(reason, () => applyLaneAlignment(prepared)); unchanged(f, head);
    assert.equal(git(f.root, 'rev-parse', f.predecessor), f.head);
  });
});

test('committed overlap, dirty overlap and file/directory prefixes cannot silently replace either owner', async t => {
  for (const incoming of ['legacy.txt', 'owned/edit.txt', 'owned/collision', 'lane']) await t.test(incoming, sub => {
    const f = fixture(sub, incoming);
    if (incoming === 'owned/collision') write(f.lane, 'owned/collision/child.txt', 'untracked child\n');
    refusal('overlap', () => plan(f)); unchanged(f);
    if (incoming === 'owned/collision') assert.equal(readFileSync(join(f.lane, 'owned/collision/child.txt'), 'utf8'), 'untracked child\n');
  });
});

test('prepared and completed recovery reuse the exact candidate without losing dirty work', t => {
  const f = fixture(t), prepared = prepareLaneAlignment(plan(f));
  const recovered = plan(f); assert.equal(recovered.resume, true); assert.equal(recovered.candidateHead, prepared.candidateHead);
  const first = applyLaneAlignment(recovered); unchanged(f, first.head);
  const completed = plan(f); assert.equal(completed.resume, true); assert.equal(completed.candidateHead, first.head);
  const replay = applyLaneAlignment(completed); assert.equal(replay.head, first.head); assert.equal(replay.resumed, true); unchanged(f, first.head);
});

test('new authored bytes after planning are retained rather than restored from the old dirty snapshot', t => {
  const f = fixture(t), prepared = prepareLaneAlignment(plan(f));
  f.dirtyBytes = Buffer.from('new owner bytes\0after planning'); writeFileSync(join(f.lane, 'owned/edit.txt'), f.dirtyBytes);
  refusal('dirty', () => applyLaneAlignment(prepared)); unchanged(f);
});

test('a corrupted recovery journal fails closed and retains the original history and dirty bytes', t => {
  const f = fixture(t), prepared = prepareLaneAlignment(plan(f));
  writeFileSync(prepared.journalPath, '{corrupt journal');
  refusal('journal', () => plan(f)); unchanged(f); assert.equal(git(f.root, 'rev-parse', f.predecessor), f.head);
});

test('non-regular dirty objects and oversized dirty files refuse before checkout', async t => {
  for (const kind of ['symlink', 'oversized']) await t.test(kind, sub => {
    const f = fixture(sub), path = join(f.lane, 'owned/unsafe');
    if (kind === 'symlink') symlinkSync('edit.txt', path); else writeFileSync(path, Buffer.alloc(500_001));
    assert.throws(() => plan(f), /blocked-lane-alignment-(?:dirty|path)|worktree entry byte budget exceeded/u); unchanged(f);
    if (kind === 'symlink') assert.equal(lstatSync(path).isSymbolicLink(), true); else assert.equal(lstatSync(path).size, 500_001);
  });
});

test('alignment input rejects unknown keys instead of silently accepting a forged declaration', () => {
  const input = { schema: 'agentic-os/lane-alignment-input/v1', scope: 'successor', device: 'test', mission: '/tmp/mission.json', expectedHead: 'a'.repeat(40), expectedTarget: 'b'.repeat(40), stopped: true };
  assert.equal(validateLaneAlignmentInput(input).scope, input.scope);
  assert.throws(() => validateLaneAlignmentInput({ ...input, ref: 'refs/heads/main' }));
  assert.throws(() => validateLaneAlignmentInput({ ...input, stopped: 'true' }));
});

test('dedicated CLI reuses the native successor allocation and completes workflow binding; overlap has no effects', async t => {
  for (const mode of ['native completion', 'overlap refusal', 'interrupted START resume', 'squash completion', 'squash interrupted START resume']) await t.test(mode, async sub => {
    const overlapping = mode === 'overlap refusal', squash = mode.startsWith('squash');
    const f = fixture(sub), policy = { protectedBranch: 'main', protectedRef: 'refs/remotes/origin/main' };
    const profile = createRepositoryProfile({ repository: 'github.com/example/alignment', canonical: { localRef: 'refs/heads/main', remoteRef: policy.protectedRef }, adapters: { repository: { id: 'git', version: '1' }, provider: null } });
    write(f.root, '.agentic-os.json', JSON.stringify(profile)); write(f.root, 'prd-tad-adr-mvp-gtm.md', '# Plan\n');
    write(f.root, '.gitignore', 'node_modules/\n'); write(f.root, 'native-owned.txt', 'native base\n'); commit(f.root); git(f.root, 'push', '--quiet', 'origin', 'main');
    ensureRepositoryTrust(f.root, profile, { allowCreate: true });
    const services = { out() {}, err() {}, projectCache: (record, cwd) => put(record, cwd), effectReceipt: (_operation, receipt) => receipt, remoteName: () => 'origin', requireCanonical: () => assert.equal(git(f.root, 'branch', '--show-current'), 'main') };
    assert.equal(await cmdStart(f.root, ['native-first', '--device=test-device', '--write=native-owned.txt', '--plan=prd-tad-adr-mvp-gtm.md', '--checkout-limit=1'], policy, profile, services), 0);
    const lane = lanePath('native-first', 'test-device', f.root), predecessor = 'agent/test-device/native-first';
    write(lane, 'native-owned.txt', 'published native UI\n'); const head = commit(lane); git(lane, 'push', '--quiet', 'origin', predecessor);
    const prior = get(predecessor, f.root); putExact({ ...prior, state: 'published', head, handoff: { schema: 'agentic-os-provider-handoff/v1', provider: 'github-gh' } }, prior, f.root);
    assert.equal(runPublishedLaneSuccessor({ cwd: lane, predecessorRef: predecessor, scope: 'native-next', explicitHead: head, remote: 'origin', protectedRef: policy.protectedRef, out() {} }), 0);
    write(lane, 'native-owned.txt', 'unfinished native owner\0bytes'); write(lane, 'node_modules/keep.bin', Buffer.from([0, 255, 1]));
    if (squash) git(f.root, 'merge', '--squash', predecessor);
    else write(f.root, overlapping ? 'native-owned.txt' : 'incoming/native-advance.txt', 'protected advance\n');
    const target = commit(f.root, squash ? 'protected native squash fixture' : 'fixture'); git(f.root, 'push', '--quiet', 'origin', 'main');
    if (squash) {
      assert.notEqual(target, head, 'native squash integration must differ from its predecessor');
      assert.equal(git(f.root, 'rev-parse', `${target}^{tree}`), git(f.root, 'rev-parse', `${head}^{tree}`));
    }
    const before = readSelectedWorkflow(f.root, profile.repository, { required: true }), count = worktrees(f.root).length, cache = JSON.stringify(load(f.root));
    const input = join(dirname(f.root), 'alignment-input.json'); writeFileSync(input, JSON.stringify({ schema: 'agentic-os/lane-alignment-input/v1', scope: 'native-next', device: 'test-device', mission: before.path, expectedHead: head, expectedTarget: target, stopped: true }));
    const invoke = () => execFileSync(process.execPath, [fileURLToPath(new URL('../bin/agentic-os-lane-alignment.mjs', import.meta.url)), `--input=${input}`], { cwd: f.root, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
    if (overlapping) {
      assert.throws(invoke, error => String(error.stderr).includes('blocked-lane-alignment-overlap'));
      assert.equal(git(lane, 'rev-parse', 'HEAD'), head); assert.equal(JSON.stringify(load(f.root)), cache);
      assert.equal(readSelectedWorkflow(f.root, profile.repository, { required: true }).digest, before.digest);
    } else {
      if (mode.endsWith('interrupted START resume')) {
        let receipt, caught;
        const lock = join(git(f.root, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'config.lock');
        const owner = { planLaneAlignment, prepareLaneAlignment, applyLaneAlignment(value) {
          receipt = applyLaneAlignment(value); writeFileSync(lock, 'fixture'); return receipt;
        } };
        const start = mission => cmdStart(f.root, ['native-next', '--device=test-device', `--mission=${mission}`, `--expected-head=${head}`, '--readmit'], policy, profile,
          { ...services, refresh: { expectedTarget: target, stopped: true, owner } });
        await assert.rejects(start(before.path), error => { caught = error; return true; });
        assert.equal(caught.operationArtifacts.alignmentReceipt.head, receipt.head);
        assert.equal(caught.operationArtifacts.provisionReceipt, null);
        assert.equal(git(lane, 'rev-parse', 'HEAD'), receipt.head);
        assert.equal(readFileSync(join(lane, 'native-owned.txt'), 'utf8'), 'unfinished native owner\0bytes');
        const pending = readSelectedWorkflow(f.root, profile.repository, { required: true });
        assert.equal(pending.manifest.allocations.length, 1);
        assert.equal(pending.manifest.allocations[0].state, 'pending');
        assert.equal(pending.manifest.allocations[0].headRevision, receipt.head);
        const candidate = receipt.head; rmSync(lock); owner.applyLaneAlignment = applyLaneAlignment;
        assert.equal(await start(pending.path), 0); assert.equal(git(lane, 'rev-parse', 'HEAD'), candidate);
      } else invoke();
      const after = readSelectedWorkflow(f.root, profile.repository, { required: true });
      assert.equal(after.manifest.allocations.length, 1); assert.equal(after.manifest.allocations[0].path, lane);
      assert.equal(after.manifest.allocations[0].ref, 'agent/test-device/native-next');
      assert.equal(after.manifest.allocations[0].headRevision, git(lane, 'rev-parse', 'HEAD'));
      assert.equal(after.manifest.allocations[0].state, 'active');
      assert.equal(after.members[0].child.source.revision, git(lane, 'rev-parse', 'HEAD'));
      assert.notEqual(after.manifest.allocations[0].headRevision, head);
      assert.deepEqual(git(lane, 'show', '-s', '--format=%P', 'HEAD').split(' '), [head, target]);
      if (squash) assert.equal(git(lane, 'rev-parse', 'HEAD^{tree}'), git(lane, 'rev-parse', `${head}^{tree}`));
      else assert.equal(readFileSync(join(lane, 'incoming/native-advance.txt'), 'utf8'), 'protected advance\n');
    }
    assert.equal(worktrees(f.root).length, count); assert.equal(git(f.root, 'rev-parse', predecessor), head);
    assert.equal(readFileSync(join(lane, 'native-owned.txt'), 'utf8'), 'unfinished native owner\0bytes');
    assert.deepEqual(readFileSync(join(lane, 'node_modules/keep.bin')), Buffer.from([0, 255, 1]));
    assert.equal(git(lane, 'diff', '--cached', '--name-only'), '');
  });
});

function squashFixture(t) {
  const f = fixture(t, undefined, true);
  write(f.lane, 'legacy.txt', 'later committed toolbar behavior\n');
  git(f.lane, 'add', '--', 'legacy.txt'); git(f.lane, 'commit', '--quiet', '-m', 'later edit');
  f.head = git(f.lane, 'rev-parse', 'HEAD'); f.args.expectedHead = f.head;
  write(f.lane, 'legacy.txt', Buffer.from('later dirty toolbar\0bytes'));
  return f;
}

test('squash-equivalent native predecessor preserves later committed and dirty overlap through preparation and replay', t => {
  const f = squashFixture(t), before = git(f.lane, 'status', '--porcelain'), beforeTree = git(f.lane, 'rev-parse', 'HEAD^{tree}');
  const observed = plan(f); assert.equal(observed.squashPredecessor.head, f.prior.head);
  const prepared = prepareLaneAlignment(observed); unchanged(f);
  assert.equal(git(f.lane, 'status', '--porcelain'), before);
  const receipt = applyLaneAlignment(plan(f)); unchanged(f, receipt.head);
  assert.equal(git(f.lane, 'rev-parse', 'HEAD^{tree}'), beforeTree);
  assert.equal(git(f.lane, 'status', '--porcelain'), before);
  assert.equal(git(f.lane, 'show', '-s', '--format=%P', 'HEAD'), `${f.head} ${f.target}`);
  assert.deepEqual(readFileSync(join(f.lane, 'legacy.txt')), Buffer.from('later dirty toolbar\0bytes'));
  assert.equal(git(f.root, 'rev-parse', f.predecessor), f.prior.head);
  assert.equal(receipt.head, prepared.candidateHead);
  assert.equal(applyLaneAlignment(plan(f)).resumed, true);
});

test('squash equivalence refuses missing or wrong native lineage, nonancestor and changed protected tree or mode', async t => {
  for (const kind of ['missing', 'wrong-head', 'foreign-worktree', 'nonancestor', 'tree', 'mode']) await t.test(kind, sub => {
    const f = squashFixture(sub), current = get(f.ref, f.root);
    if (kind === 'missing') { const next = { ...current }; delete next.handoff; putExact(next, current, f.root); }
    if (kind === 'wrong-head') putExact({ ...current, handoff: { ...current.handoff, predecessorHead: f.target } }, current, f.root);
    if (kind === 'foreign-worktree') putExact({ ...current, worktree: f.root }, current, f.root);
    if (kind === 'nonancestor') {
      const other = git(f.root, 'commit-tree', `${f.target}^{tree}`, '-m', 'unrelated predecessor');
      git(f.root, 'update-ref', `refs/heads/${f.predecessor}`, other);
      git(f.root, 'push', '--quiet', '--force', 'origin', f.predecessor);
      put({ ...f.prior, head: other }, f.root);
      putExact({ ...current, handoff: { ...current.handoff, predecessorHead: other } }, current, f.root);
    }
    if (kind === 'tree' || kind === 'mode') {
      if (kind === 'tree') write(f.root, 'legacy.txt', 'different protected content\n');
      else chmodSync(join(f.root, 'owned/tool.sh'), 0o644);
      f.target = commit(f.root); git(f.root, 'push', '--quiet', 'origin', 'main'); f.args.expectedTarget = f.target;
    }
    refusal('overlap', () => plan(f)); unchanged(f);
  });
});

test('squash predecessor refs and lineage are reobserved during prepare, apply and completed replay', async t => {
  for (const phase of ['prepare', 'apply', 'replay']) for (const drift of ['local', 'remote', 'lineage']) await t.test(`${phase}-${drift}`, sub => {
    const f = squashFixture(sub); let value = plan(f), expected = f.head;
    if (phase !== 'prepare') value = prepareLaneAlignment(value);
    if (phase === 'replay') expected = applyLaneAlignment(value).head;
    if (drift === 'local') git(f.root, 'update-ref', `refs/heads/${f.predecessor}`, f.head);
    if (drift === 'remote') git(f.root, 'push', '--quiet', 'origin', `${f.head}:refs/heads/${f.predecessor}`);
    if (drift === 'lineage') { const prior = get(f.ref, f.root), next = { ...prior }; delete next.handoff; putExact(next, prior, f.root); }
    const effect = phase === 'prepare' ? () => prepareLaneAlignment(value) : phase === 'apply' ? () => applyLaneAlignment(value) : () => plan(f);
    assert.throws(effect, /blocked-lane-alignment-(?:squash-lineage|journal)/u); unchanged(f, expected);
  });
});


test('a failure after the squash ancestry CAS reports retained effects and preserves new dirty bytes', t => {
  const f = squashFixture(t), prepared = prepareLaneAlignment(plan(f)), hooks = join(dirname(f.root), 'test-hooks');
  write(hooks, 'reference-transaction', `#!/bin/sh
[ "$1" = committed ] || exit 0
while read old new ref; do
  if [ "$ref" = refs/heads/${f.ref} ]; then
    printf 'post-CAS owner edit' > '${f.lane}/owned/edit.txt'
  fi
done
`, 0o755);
  git(f.root, 'config', 'core.hooksPath', hooks);
  assert.throws(() => applyLaneAlignment(prepared), error => {
    assert.equal(error.retainedOperation, true);
    assert.equal(error.operationArtifacts.refPublished, true);
    assert.equal(error.operationArtifacts.candidateHead, prepared.candidateHead);
    assert.equal(error.operationArtifacts.targetHead, f.target);
    return error.reason === 'blocked-lane-alignment-dirty';
  });
  assert.equal(git(f.lane, 'rev-parse', 'HEAD'), prepared.candidateHead);
  assert.equal(readFileSync(join(f.lane, 'owned/edit.txt'), 'utf8'), 'post-CAS owner edit');
  assert.equal(existsSync(prepared.journalPath), true);
});


test('prepared squash recovery rechecks the protected target before returning retained pins', t => {
  const f = squashFixture(t), prepared = prepareLaneAlignment(plan(f));
  write(f.root, 'later-protected.txt', 'protected advanced\n'); commit(f.root); git(f.root, 'push', '--quiet', 'origin', 'main');
  refusal('target', () => prepareLaneAlignment(prepared)); unchanged(f);
});
