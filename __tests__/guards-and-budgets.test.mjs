import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, OVERRIDE_ENV } from '../src/guard-main.mjs';
import { violations as docViolations, BUDGET as DOC_BUDGET } from '../src/doc-budget.mjs';
import {
  violations as moduleViolations,
  BUDGET as MODULE_BUDGET,
  FORBIDDEN_SUFFIXES,
} from '../src/module-budget.mjs';
import { deviceSegment, laneRef, isLaneRef, parseLaneRef, assertScope } from '../src/lane-id.mjs';
import { capFacts, CAPS, lanesForDevice, stackDepth } from '../src/wip.mjs';
import { REQUIRED_CONFIG } from '../src/config.mjs';
import { QUEUE_POLICY, audit, plan } from '../src/queue.mjs';

test('the guard refuses commits on the protected branch', () => {
  const verdict = evaluate({ branch: 'main', phase: 'commit' });
  assert.equal(verdict.allow, false);
  assert.equal(verdict.reason, 'blocked-main-authoring');
  assert.match(verdict.message, /npm run lane/);
});

test('the guard allows lanes and detached provisioning', () => {
  assert.equal(evaluate({ branch: 'agent/dev/scope', phase: 'commit' }).allow, true);
  assert.equal(evaluate({ branch: null, phase: 'commit' }).allow, true);
});

test('the guard has an explicit, named override', () => {
  const verdict = evaluate({ branch: 'main', phase: 'commit', override: '1' });
  assert.equal(verdict.allow, true);
  assert.match(verdict.note, new RegExp(OVERRIDE_ENV));
});

test('lane refs round-trip and reject malformed scopes', () => {
  const ref = laneRef('pricing-table', 'box-1.local');
  assert.equal(ref, 'agent/box-1.local/pricing-table');
  assert.equal(isLaneRef(ref), true);
  assert.deepEqual(parseLaneRef(ref), { device: 'box-1.local', scope: 'pricing-table' });

  assert.equal(isLaneRef('main'), false);
  assert.equal(isLaneRef('agent/dev'), false);
  assert.throws(() => assertScope('Pricing_Table'));
  assert.throws(() => assertScope('-leading'));
  assert.ok(deviceSegment('Hui.MacBook Pro').length > 0);
});

test('caps are derived per device, not globally', () => {
  const refs = ['agent/a/one', 'agent/a/two', 'agent/b/three'];
  assert.equal(lanesForDevice(refs, 'a').length, 2);
  const facts = capFacts(refs, 'a', { baseRef: 'origin/main', protectedRef: 'origin/main' });
  assert.equal(facts.openLanes, 2);
  assert.equal(facts.wipCap, CAPS.openLanesPerDevice);
  assert.equal(facts.stackDepth, 1);
  assert.equal(stackDepth('agent/a/one', 'origin/main'), 2);
});

test('required git config includes the conflict-memory settings', () => {
  const keys = REQUIRED_CONFIG.map((entry) => entry.key);
  for (const key of ['rerere.enabled', 'rerere.autoupdate', 'rebase.updateRefs']) {
    assert.ok(keys.includes(key), `${key} must be required`);
  }
  for (const entry of REQUIRED_CONFIG) {
    assert.ok(entry.why.length > 10, `${entry.key} needs a stated reason`);
  }
});

test('the plan batches, requires a PR, and turns require-up-to-date off', () => {
  assert.equal(QUEUE_POLICY.merge_method, 'SQUASH');
  assert.ok(QUEUE_POLICY.max_entries_to_merge > 1, 'batching is the point of the queue');

  const rules = plan().ruleset.rules;
  const byType = (type) => rules.find((rule) => rule.type === type);

  assert.ok(byType('pull_request'), 'every change must go through a pull request');
  assert.equal(byType('pull_request').parameters.required_approving_review_count, 0);
  assert.equal(
    byType('required_status_checks').parameters.strict_required_status_checks_policy,
    false,
    'require-branches-up-to-date must be off or the queue fights the authors',
  );
  assert.ok(byType('merge_queue'), 'the queue rule is the whole point');
  assert.ok(byType('non_fast_forward'), 'history must not be rewritten');
});

test('the audit refuses strict mode from either configuration surface', () => {
  const findings = audit({
    available: true,
    strict: true,
    requiredChecks: ['test', 'budgets'],
    merge: { allow_squash_merge: true, delete_branch_on_merge: true },
    queueEnabled: true,
    queueRuleset: { name: 'q' },
    openPrs: [],
  });
  const strictFinding = findings.find((finding) => finding.id === 'strict-off');
  assert.equal(strictFinding.ok, false);
  assert.match(strictFinding.detail, /restack treadmill/);
});

test('the audit flags an unenabled queue, missing checks, and excess WIP', () => {
  const findings = audit({
    available: true,
    strict: false,
    requiredChecks: [],
    merge: { allow_squash_merge: true, delete_branch_on_merge: true },
    queueEnabled: false,
    openPrs: Array.from({ length: 45 }, (_, index) => ({ number: index })),
  });
  assert.equal(findings.find((finding) => finding.id === 'merge-queue').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'required-checks').ok, false);
  assert.equal(findings.find((finding) => finding.id === 'wip').ok, false);
});

test('this repository is inside its own documentation budget', () => {
  const { found, total } = docViolations();
  assert.deepEqual(found, [], `doc budget violations: ${JSON.stringify(found, null, 2)}`);
  assert.ok(total <= DOC_BUDGET.alwaysLoadBytes);
});

test('this repository is inside its own module budget', () => {
  const { found, entries, total } = moduleViolations();
  assert.deepEqual(found, [], `module budget violations: ${JSON.stringify(found, null, 2)}`);
  assert.ok(entries.length <= MODULE_BUDGET.modules);
  assert.ok(total <= MODULE_BUDGET.totalLines);
});

test('per-scenario module families are forbidden by name', () => {
  assert.ok(FORBIDDEN_SUFFIXES.includes('-controller.mjs'));
  assert.ok(FORBIDDEN_SUFFIXES.includes('-repository-adapter.mjs'));
});
