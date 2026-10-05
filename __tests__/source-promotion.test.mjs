import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sourcePromotionChecks, validateSourcePromotionPlan,
  SOURCE_PROMOTION_SCHEMA } from '../bin/agentic-os-release-common-complete.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const required = ['test', 'budgets'];
const run = (name, id, conclusion, started) => ({ name, id, app: { slug: 'github-actions', id: 15368 },
  status: conclusion === null ? 'in_progress' : 'completed', conclusion, started_at: started,
  completed_at: conclusion === null ? null : started });

test('source promotion accepts only newest complete successful required runs', () => {
  const checks = [run('test', 1, 'success', '2026-10-05T10:00:00Z'),
    run('test', 2, null, '2026-10-05T11:00:00Z'), run('budgets', 3, 'success', '2026-10-05T10:30:00Z')];
  assert.throws(() => sourcePromotionChecks(checks, required), /test is pending/u);
  checks[1] = run('test', 2, 'failure', '2026-10-05T11:00:00Z');
  assert.throws(() => sourcePromotionChecks(checks, required), /test is pending, failed/u);
  checks[1] = run('test', 2, 'success', '2026-10-05T11:00:00Z');
  assert.deepEqual(sourcePromotionChecks(checks, required).map(({ name }) => name), ['budgets', 'test']);
});

test('source promotion plan digest binds repo, source, base and required policy', () => {
  const core = { schema: SOURCE_PROMOTION_SCHEMA, repository: 'owner/repo', ref: 'agent/device/task',
    pr: 7, head: 'a'.repeat(40), base: 'b'.repeat(40), profileDigest: 'c'.repeat(64), authorityClass: 'docs-only',
    requiredChecks: ['budgets', 'test'], checks: [], method: 'squash', createdAt: 1, expiresAt: 300001 };
  const plan = { ...core, digest: sha(core) };
  assert.equal(validateSourcePromotionPlan(plan, { repository: core.repository, ref: core.ref,
    head: core.head, base: core.base, profileDigest: core.profileDigest, requiredChecks: ['test', 'budgets'] }), plan);
  assert.throws(() => validateSourcePromotionPlan({ ...plan, base: 'd'.repeat(40) }, {
    repository: core.repository, ref: core.ref, head: core.head, base: core.base,
    profileDigest: core.profileDigest, requiredChecks: required,
  }), /plan does not match/u);
});

test('release-common exposes only explicit plan and confirmed apply grammars', () => {
  assert.equal(validateCommandArguments('release-common', ['promote', 'plan', '--ref=agent/device/task']), null);
  assert.equal(validateCommandArguments('release-common', ['promote', 'apply', '--plan=p', '--authorize=sha256:x']), null);
  assert.match(validateCommandArguments('release-common', ['promote', 'apply', '--plan=p']), /missing --authorize/u);
  assert.match(validateCommandArguments('release-common', ['promote', 'apply', '--plan=p', '--authorize=x', '--admin']), /unknown/u);
});
