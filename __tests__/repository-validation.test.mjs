import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateValidationPolicy, selectValidationChecks, checkInputPatterns, VALIDATION_POLICY } from '../bin/agentic-os-validation-policy.mjs';
import { consumerSnapshotReader } from '../bin/agentic-os-validation-inputs.mjs';
import { validationArguments, resolveValidationCi, validationCheckDefinitions } from '../bin/agentic-os-validation.mjs';

const check = (id, inputs, requires = []) => ({ id, command: ['node', 'checks.mjs', id], inputs, requires, reuse: 'local', timeoutMs: 3000 });
const policy = () => ({ schema: 'agentic-os/repository-validation-policy/v1', repository: 'github.com/example/consumer',
  broadInputs: ['config/'], always: ['contract'], fallback: ['fallback'], checks: [
    check('contract', ['contracts/']), check('prepare', ['shared/']), check('a', ['a/'], ['prepare']),
    check('b', ['b/'], ['prepare']), { ...check('fallback', []), reuse: 'never' },
  ] });
const ids = plan => plan.checks.map(item => item.id);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'validation-consumer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Validation Test');
  git('remote', 'add', 'origin', 'https://github.com/example/consumer.git');
  mkdirSync(join(root, 'a')); mkdirSync(join(root, 'b'));
  writeFileSync(join(root, 'a/source.txt'), 'one'); writeFileSync(join(root, 'b/source.txt'), 'two');
  writeFileSync(join(root, VALIDATION_POLICY), JSON.stringify(policy()));
  git('add', '.'); git('commit', '-m', 'baseline'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, git };
}

test('selection closes declared prerequisites once and keeps mandatory checks', () => {
  const value = policy(), plan = selectValidationChecks(value, ['a/source.js', 'b/source.js']);
  assert.deepEqual(ids(plan), ['contract', 'prepare', 'a', 'b']);
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(checkInputPatterns(value, 'a'), ['shared/', 'a/']);
  assert.deepEqual(ids(selectValidationChecks(value, [])), ['contract']);
  assert.deepEqual(ids(selectValidationChecks(value, ['shared/compiler.js'])), ['contract', 'prepare', 'a', 'b']);
});

test('deleted and unknown paths retain fallback; policy, workflow and package changes broaden', () => {
  for (const path of [VALIDATION_POLICY, '.github/workflows/ci.yml', 'nested/package-lock.json', 'config/build.json']) {
    const plan = selectValidationChecks(policy(), [path]);
    assert.equal(plan.mode, 'broad'); assert.deepEqual(ids(plan), ['contract', 'fallback']);
  }
  const unknown = selectValidationChecks(policy(), ['deleted-old-owner.js']);
  assert.deepEqual(unknown.unmatchedPaths, ['deleted-old-owner.js']);
  assert.deepEqual(ids(unknown), ['contract', 'fallback']);
  assert.deepEqual(ids(selectValidationChecks(policy(), ['a/source.js'], { all: true })), ['contract', 'fallback']);
});

test('CI partitions intersect the affected plan and retain only required prerequisites', () => {
  const value=policy();
  assert.deepEqual(ids(selectValidationChecks(value,['a/source.js','b/source.js'],{only:['a']})),['prepare','a']);
  const skipped=selectValidationChecks(value,['a/source.js'],{only:['b']});
  assert.deepEqual(ids(skipped),[]);assert.deepEqual(skipped.partition,['b']);
  assert.throws(()=>selectValidationChecks(value,[],{only:['unknown']}),/unknown-partition-check/);
  assert.deepEqual(ids(selectValidationChecks(value,['package.json'],{only:['fallback']})),['fallback']);
});

test('invalid policies cannot claim a narrow green plan', () => {
  const invalid = [
    p => { p.checks[2].requires = ['absent']; },
    p => { p.checks[1].requires = ['a']; },
    p => { p.checks[2].inputs = ['../escape']; },
    p => { p.checks[2].inputs = ['a//']; },
    p => { p.checks[2].inputs = ['/absolute']; },
    p => { p.checks[2].command = ['sh', '-c', 'true']; },
    p => { p.checks[2].timeoutMs = 900_001; },
    p => { p.fallback = []; },
    p => { p.checks[4].reuse = 'local'; },
    p => { p.checks[2].reuse = 'local-plan'; },
    p => { p.checks[3].command = p.checks[2].command; },
    p => { p.bypass = true; },
  ];
  for (const mutate of invalid) {
    const value = policy(); mutate(value);
    assert.throws(() => validateValidationPolicy(value), /blocked-validation-policy/);
  }
});

test('whole-plan reuse binds revision, base and selection while allowing partition joins', t => {
  const { root } = fixture(t), first = consumerSnapshotReader({ root })();
  const value = policy(); value.checks[2].reuse = 'local-plan'; value.checks[2].inputs = ['*']; value.fallback = ['a'];
  const plan = selectValidationChecks(value, ['a/source.txt']);
  const fingerprint = (observed, selected = plan) => validationCheckDefinitions(value, selected, observed, 'owner').find(c => c.name === 'a').fingerprint;
  const original = fingerprint(first);
  assert.equal(fingerprint(first, selectValidationChecks(value, ['a/source.txt'], { only: ['a'] })), original);
  for (const field of ['headRevision', 'requestedBase', 'baseRevision', 'sourceDigest', 'indexDigest', 'environmentDigest'])
    assert.notEqual(fingerprint({ ...first, identity: { ...first.identity, [field]: 'changed' } }), original, field);
  assert.notEqual(fingerprint(first, selectValidationChecks(value, ['a/source.txt'], { all: true })), original);
});

test('working snapshots include committed, staged, unstaged, added and deleted bytes', t => {
  const { root, git } = fixture(t), observe = consumerSnapshotReader({ root });
  const baseline = observe(); assert.deepEqual(baseline.changed, []);
  writeFileSync(join(root, 'a/source.txt'), 'committed change'); git('add', '.'); git('commit', '-m', 'change');
  writeFileSync(join(root, 'b/source.txt'), 'staged change'); git('add', 'b/source.txt');
  writeFileSync(join(root, 'b/source.txt'), 'unstaged change');
  writeFileSync(join(root, 'new.txt'), 'new');
  const changed = observe(); assert.deepEqual(changed.changed, ['a/source.txt', 'b/source.txt', 'new.txt']);
  assert.notEqual(changed.identity.sourceDigest, baseline.identity.sourceDigest);
  renameSync(join(root, 'a/source.txt'), join(root, 'a/renamed.txt'));
  assert.deepEqual(observe().changed, ['a/renamed.txt', 'a/source.txt', 'b/source.txt', 'new.txt']);
  assert.throws(() => consumerSnapshotReader({ root, committed: true })(), /dirty-ci/);
  assert.throws(() => consumerSnapshotReader({ root, base: 'missing-base' })(), /blocked-test-git/);
});

test('same-length edits invalidate cached bytes; hidden index and symlink parents fail', t => {
  const { root, git } = fixture(t), observe = consumerSnapshotReader({ root });
  const before = observe().identity.sourceDigest;
  writeFileSync(join(root, 'a/source.txt'), 'two'); assert.notEqual(observe().identity.sourceDigest, before);
  git('update-index', '--assume-unchanged', 'a/source.txt');
  assert.throws(observe, /hidden-source/); git('update-index', '--no-assume-unchanged', 'a/source.txt');
  renameSync(join(root, 'a'), join(root, 'saved-a')); symlinkSync('saved-a', join(root, 'a'));
  assert.throws(observe, /validation-parent/);
});

test('bounded check fingerprints reuse unrelated revisions but invalidate dependency and environment changes', t => {
  const { root } = fixture(t), observe = consumerSnapshotReader({ root }), value = policy();
  const first = observe(), a = selectValidationChecks(value, ['a/source.txt']);
  const fingerprint = observed => validationCheckDefinitions(value, a, observed, 'owner-digest').find(c => c.name === 'a').fingerprint;
  const original = fingerprint(first);
  writeFileSync(join(root, 'b/source.txt'), 'unrelated');
  assert.equal(fingerprint(observe()), original);
  writeFileSync(join(root, 'a/source.txt'), 'related');
  assert.notEqual(fingerprint(observe()), original);
  assert.notEqual(fingerprint({ ...first, identity: { ...first.identity, environmentDigest: 'changed' } }), original);
  const broad = { ...a, checks: a.checks.map(check => ({ ...check, reasons: ['another-observation'] })) };
  assert.equal(validationCheckDefinitions(value, broad, first, 'owner-digest').find(c => c.name === 'a').fingerprint, original);
});

test('CI baseline cannot be overridden and a missing or mismatched event cannot pass', t => {
  const { root, git } = fixture(t);
  assert.throws(() => validationArguments(['ci', '--base=HEAD']), /CI owns/);
  assert.throws(() => validationArguments(['run', '--fresh', '--fresh']), /duplicate/);
  assert.throws(() => resolveValidationCi(root, {}), /ci-context/);
  const eventPath = join(tmpdir(), `validation-event-${process.pid}.json`);
  writeFileSync(eventPath, JSON.stringify({ before: git('rev-parse', 'HEAD'), after: git('rev-parse', 'HEAD') }));
  t.after(() => rmSync(eventPath, { force: true }));
  const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: git('rev-parse', 'HEAD') };
  assert.equal(resolveValidationCi(root, env).committed, true);
  assert.throws(() => resolveValidationCi(root, { ...env, GITHUB_SHA: '0'.repeat(40) }), /ci-checkout/);
  assert.equal(resolveValidationCi(root, { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }).all, true);
  const base=git('rev-parse','HEAD');writeFileSync(join(root,'a/source.txt'),'candidate');git('add','.');git('commit','-m','candidate');
  const head=git('rev-parse','HEAD'), merge=git('commit-tree','HEAD^{tree}','-p',base,'-p',head,'-m','provider merge');
  writeFileSync(eventPath,JSON.stringify({pull_request:{base:{sha:base},head:{sha:head},merge_commit_sha:merge}}));
  const headEnv={...env,GITHUB_EVENT_NAME:'pull_request',GITHUB_SHA:merge};
  assert.equal(resolveValidationCi(root,headEnv).checkout,'pull-request-head');
  assert.equal(resolveValidationCi(root,headEnv).base,base);
  for (const merge_commit_sha of [null, 'a'.repeat(40)]) {
    writeFileSync(eventPath,JSON.stringify({pull_request:{base:{sha:base},head:{sha:head},merge_commit_sha}}));
    assert.equal(resolveValidationCi(root,headEnv).checkout,'pull-request-head');
  }
  assert.equal(resolveValidationCi(root,{...headEnv,GITHUB_SHA:head}).checkout,'pull-request-head');
  const wrong=git('commit-tree','HEAD^{tree}','-p',head,'-p',base,'-m','reversed parents');
  assert.throws(()=>resolveValidationCi(root,{...headEnv,GITHUB_SHA:wrong}),/ci-checkout-parents/);
  assert.throws(()=>resolveValidationCi(root,{...headEnv,GITHUB_SHA:base}),/ci-checkout-parents/);
  const blob=git('rev-parse','HEAD:a/source.txt');
  assert.throws(()=>resolveValidationCi(root,{...headEnv,GITHUB_SHA:blob}),/blocked-test-git/);
  assert.throws(()=>resolveValidationCi(root,{...headEnv,GITHUB_SHA:'b'.repeat(40)}),/blocked-test-git/);
});
