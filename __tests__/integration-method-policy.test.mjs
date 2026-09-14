import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRepositoryProfile, validateRepositoryProfile } from '../src/governance.mjs';
import { INTEGRATION_METHOD_POLICY, selectIntegrationMethod, integrationMethodChoiceReference, readIntegrationMethodChoice } from 'agentic-os/integration-policy';
import { effectivePullRequestPolicyMatches } from '../src/lane-state.mjs';
import { audit, effectivePullRequestMethods, plan, providerBlockingReasons, providerPolicy,
  PROVIDER_CAPABILITIES as C, pullRequestPolicyMatches, queuePolicyMatches } from '../src/queue.mjs';

const profile = (capabilities = [C.PULL_REQUEST, C.SQUASH_PREFERRED]) => createRepositoryProfile({
  repository: 'github.com/example/repo',
  canonical: { localRef: 'refs/heads/trunk', remoteRef: 'refs/remotes/origin/trunk' },
  adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
  capabilities, requiredChecks: ['Integration Gate'],
});
const preferred = profile(), policy = providerPolicy(preferred);
const state = () => ({ available: true, identityBound: true, repo: preferred.repository, policy,
  merge: { allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: false,
    delete_branch_on_merge: false },
  pullRequestRequired: true, pullRequestPolicySatisfied: true, linearHistoryRequired: false,
  effectiveMergeMethods: ['merge', 'squash'], requiredChecks: ['Integration Gate'],
  observationErrors: [],
});
const revisions = { expectedHead: 'a'.repeat(40), observedHead: 'a'.repeat(40),
  expectedBase: 'b'.repeat(40), observedBase: 'b'.repeat(40) };

test('reference profile selects squash preference without changing legacy strict semantics', () => {
  const reference = validateRepositoryProfile(JSON.parse(readFileSync(
    new URL('../.agentic-os.json', import.meta.url), 'utf8')));
  assert.equal(providerPolicy(reference).squashPreferredRequired, true);
  for (const file of ['adlc-authority-policy.json', 'adlc-authority-graph-policy.json']) {
    const authority = JSON.parse(readFileSync(new URL(`../.github/${file}`, import.meta.url), 'utf8'));
    assert.deepEqual(authority.allowedMergeMethods, ['merge', 'rebase', 'squash']);
  }
  const strict = providerPolicy(profile([C.PULL_REQUEST, C.SQUASH]));
  assert.equal(strict.squashOnlyRequired, true);
  assert.equal(strict.squashPreferredRequired, false);
  assert.equal(effectivePullRequestPolicyMatches(['merge', 'squash'], strict), false);
  for (const conflict of [C.SQUASH, C.LINEAR_HISTORY]) {
    assert.throws(() => providerPolicy(profile([C.SQUASH_PREFERRED, conflict])), /conflicts/u);
  }
  assert.throws(() => providerPolicy(profile([C.SQUASH_PREFERRED])), /pull-request/u);
  const local = { ...preferred, adapters: { repository: { id: 'git', version: '1' }, provider: null } };
  delete local.profileDigest;
  assert.throws(() => createRepositoryProfile(local), /provider adapter/u);
});

test('projection preserves merge backup, permits controlled provider rebase and keeps queues on squash', () => {
  const projected = plan(profile([C.PULL_REQUEST, C.SQUASH_PREFERRED, C.MERGE_QUEUE]));
  assert.deepEqual(projected.integration, INTEGRATION_METHOD_POLICY);
  assert.deepEqual(projected.repository, { delete_branch_on_merge: false, allow_auto_merge: true,
    allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true });
  assert.deepEqual(projected.incompatibleRules, ['required_linear_history']);
  assert.deepEqual(projected.providerOwnedRules.find(x => x.type === 'pull_request').constraints,
    [{ parameter: 'allowed_merge_methods', operator: 'effectiveEquals', values: ['merge', 'rebase', 'squash'] }]);
  assert.deepEqual(projected.providerOwnedRules.find(x => x.type === 'merge_queue').constraints,
    [{ parameter: 'merge_method', operator: 'oneOf', values: ['SQUASH'] }]);
  assert.equal(queuePolicyMatches({ merge_method: 'SQUASH' }, policy), true);
  for (const method of ['MERGE', 'REBASE', undefined]) {
    assert.equal(queuePolicyMatches({ merge_method: method }, policy), false);
  }
  assert.equal('integration' in plan(profile([])), false);
});

test('effective policy rejects lost backup, unknown methods and linear history', () => {
  assert.equal(pullRequestPolicyMatches({ allowed_merge_methods: ['squash', 'merge'] }, policy), true);
  assert.deepEqual(providerBlockingReasons(state(), policy), []);
  assert.equal(audit(state(), preferred).find(x => x.id === 'squash-preferred').ok, true);
  for (const methods of [[], ['squash'], ['merge'], ['squash', 'rebase'],
    ['squash', 'squash'], ['merge', 'squash', 'unknown']]) {
    assert.equal(effectivePullRequestPolicyMatches(methods, policy), false);
    assert.equal(pullRequestPolicyMatches({ allowed_merge_methods: methods }, policy), false);
    assert.ok(providerBlockingReasons({ ...state(), effectiveMergeMethods: methods }, policy)
      .includes('squash-preferred'));
  }
  const linear = { ...state(), linearHistoryRequired: true };
  assert.ok(providerBlockingReasons(linear, policy).includes('squash-preferred'));
  assert.equal(audit(linear, preferred).find(x => x.id === 'squash-preferred').ok, false);
  for (const constraint of [
    effectivePullRequestMethods(state().merge, [], { linearHistoryRequired: true }),
    effectivePullRequestMethods(state().merge, [{ parameters: { allowed_merge_methods: ['squash'] } }]),
  ]) assert.equal(effectivePullRequestPolicyMatches(constraint, policy), false);
  assert.ok(providerBlockingReasons({ ...state(), observationErrors: ['expanded-rulesets'] }, policy)
    .includes('ruleset-observation'));
});

test('selection defaults to squash and binds repository, profile, source and base without authority', () => {
  const selected = selectIntegrationMethod(preferred, state(), revisions);
  assert.equal(selected.method, 'squash');
  assert.equal(selected.authority, false);
  assert.equal(selected.repository, preferred.repository);
  assert.equal(selected.profileDigest, preferred.profileDigest);
  assert.equal(selected.headRevision, revisions.expectedHead);
  assert.equal(selected.baseRevision, revisions.expectedBase);
  assert.equal(selected.reason, null);
  assert.ok(Object.isFrozen(selected));
  const backup = selectIntegrationMethod(preferred, state(), { ...revisions,
    method: 'merge', reason: 'Preserve reviewed branch ancestry' });
  assert.equal(backup.method, 'merge');
  assert.equal(backup.reason, 'Preserve reviewed branch ancestry');
  for (const reason of [undefined, '', ' ', 'x'.repeat(1001), false]) {
    assert.throws(() => selectIntegrationMethod(preferred, state(), { ...revisions,
      method: 'merge', reason }), /explicit bounded reason/u);
  }
});

test('selection refuses stale handoffs, incomplete provider state, automatic fallback and unavailable methods', () => {
  for (const change of [{ repo: 'github.com/other/repo' }, { policy: {} }, { available: false },
    { identityBound: false }, { requiredChecks: [] }, { linearHistoryRequired: true },
    { effectiveMergeMethods: ['merge'] }, { observationErrors: ['ruleset-scope'] },
    { observationErrors: ['classic-protection'] }, { observationErrors: undefined },
    { merge: { ...state().merge, allow_rebase_merge: undefined } }]) {
    assert.throws(() => selectIntegrationMethod(preferred, { ...state(), ...change }, revisions),
      /observation/u);
  }
  for (const change of [{ expectedHead: undefined }, { expectedBase: 'HEAD' },
    { observedHead: 'c'.repeat(40) }, { observedBase: 'd'.repeat(40) }]) {
    assert.throws(() => selectIntegrationMethod(preferred, state(), { ...revisions, ...change }),
      /exact current/u);
  }
  assert.throws(() => selectIntegrationMethod(preferred, state(), { ...revisions, method: 'rebase',
    reason: 'Provider is not yet configured' }), /unavailable/u);
  assert.throws(() => selectIntegrationMethod(preferred, state(), { ...revisions, method: 'auto' }),
    /unsupported/u);
  assert.throws(() => selectIntegrationMethod(profile([]), state(), revisions), /not selected/u);
});


test('provider rebase requires an explicit bounded revision choice; queues remain squash', () => {
  const observed = { ...state(), effectiveMergeMethods: ['merge', 'rebase', 'squash'],
    merge: { ...state().merge, allow_rebase_merge: true } };
  assert.deepEqual(providerBlockingReasons(observed, policy), []);
  assert.equal(selectIntegrationMethod(preferred, observed, revisions).method, 'squash');
  const choice = selectIntegrationMethod(preferred, observed, { ...revisions,
    method: 'rebase', reason: 'Preserve each reviewed linear commit' });
  const reference = integrationMethodChoiceReference(choice);
  assert.deepEqual(readIntegrationMethodChoice(['effect-plan:sha256:' + 'c'.repeat(64), reference]), choice);
  for (const reason of [undefined, '', 'x'.repeat(1001), 'a\nb']) {
    assert.throws(() => selectIntegrationMethod(preferred, observed, { ...revisions, method: 'rebase', reason }),
      /explicit bounded reason/u);
  }
  for (const refs of [[reference, reference], [reference + '='], ['integration-method-choice:v2:abc'],
    ['integration-method-choice:v1:bad']]) assert.throws(() => readIntegrationMethodChoice(refs));
  for (const patch of [{ authority: true }, { extra: true }, { headRevision: 'HEAD' }, { method: 'auto' }])
    assert.throws(() => integrationMethodChoiceReference({ ...choice, ...patch }));
  assert.equal(readIntegrationMethodChoice([]), null);
  const neutral = { ...choice, repository: 'forge.example/team/repo' };
  assert.deepEqual(readIntegrationMethodChoice([integrationMethodChoiceReference(neutral)]), neutral);
  const queued = profile([C.PULL_REQUEST, C.SQUASH_PREFERRED, C.MERGE_QUEUE]);
  assert.throws(() => selectIntegrationMethod(queued, { ...observed, policy: providerPolicy(queued),
    strict: false, queueEnabled: true, queuePolicySatisfied: true, mergeGroupSupported: true },
  { ...revisions, method: 'rebase', reason: 'Queue cannot be bypassed' }), /queue requires squash/u);
});
