import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRepositoryProfile } from '../src/governance.mjs';
import { integrationMethodChoiceReference } from '../src/lane-state.mjs';
import { observeIntegrationMethod } from '../bin/agentic-os-integration-proof.mjs';
import { createGitHubProtectionProjection } from '../src/github-authority-issuer.mjs';
import { observeGitHubIntegrationProof } from '../src/github-transition-proof.mjs';

const oid = (n) => n.toString(16).padStart(40, '0');
const base = oid(1), head = oid(3), merged = oid(5);
const target = { repository: 'github.com/example/repo', owner: 'example', name: 'repo', path: '/repos/example/repo' };
function fixture(method = 'rebase') {
  const profile = createRepositoryProfile({ repository: target.repository,
    canonical: { localRef: 'refs/heads/main', remoteRef: 'refs/remotes/origin/main' },
    adapters: { repository: { id: 'git', version: '1' }, provider: { id: 'github', version: '1' } },
    capabilities: ['protected-integration:pull-request', 'integration-method:squash-preferred'],
    requiredChecks: ['test'] });
  const choice = { schema: 'agentic-os/integration-method-selection/v1', authority: false,
    repository: target.repository, profileDigest: profile.profileDigest,
    headRevision: head, baseRevision: base, method, reason: method === 'squash' ? null : 'Reviewed fallback' };
  const rows = new Map(), calls = [];
  function row(revision, parent, tree, message) {
    rows.set(revision, { sha: revision, parents: [{ sha: parent }], tree: { sha: tree }, message,
      author: { name: 'Author', email: 'author@example.test', date: '2026-09-14T00:00:00Z' } });
  }
  row(oid(2), base, oid(12), 'first'); row(head, oid(2), oid(13), 'second');
  row(oid(4), base, oid(12), 'first'); row(merged, oid(4), oid(13), 'second');
  const state = { profile, choice, rows, calls, row };
  const input = { predecessorIssuance: { storedBundle: { authorityBundle: {
    request: { dependentWork: [integrationMethodChoiceReference(choice)] } } } } };
  const api = { exact: (value) => value, call: async (verb, path) => {
    assert.equal(verb, 'GET'); calls.push(path);
    if (path.endsWith('/branches/main/protection')) return state.classic ?? { status: 404 };
    if (path.includes('/contents/')) {
      assert.equal(path, `${target.path}/contents/.agentic-os.json?ref=${base}`);
      return { type: 'file', path: '.agentic-os.json', encoding: 'base64',
        content: Buffer.from(JSON.stringify(state.profile)).toString('base64') };
    }
    const value = rows.get(path.split('/').at(-1));
    assert.ok(value, path); return value;
  }, commit: async () => ({ tree: oid(13) }) };
  const options = { api, target, input, candidate: { headRevision: head, canonicalRevision: base },
    mergedCommit: { revision: merged, parents: [oid(4)], tree: oid(13) },
    allowedMethods: ['merge', 'rebase', 'squash'], canonicalRef: 'refs/heads/main' };
  return { ...state, state, options, choose(patch) {
    Object.assign(choice, patch);
    input.predecessorIssuance.storedBundle.authorityBundle.request.dependentWork = [integrationMethodChoiceReference(choice)];
  } };
}

test('rebase proof binds the pre-integration choice and exact ordered commit sequence', async () => {
  const f = fixture(), result = await observeIntegrationMethod(f.options);
  assert.equal(result.method, 'rebase');
  assert.deepEqual(result.integrationMethodEvidence.choice, f.choice);
  assert.equal(result.integrationMethodEvidence.sequence.commitCount, 2);
  assert.deepEqual(result.integrationMethodEvidence.sequence.commitPairs.map(x => x.sourceRevision), [oid(2), head]);
  assert.equal(f.calls.length, 6);
  assert.equal(f.calls.filter(x => x.includes('/contents/')).length, 1);
});

test('rebase rejects absent, retrospective, duplicate, foreign and stale choices', async () => {
  for (const change of [
    f => { f.options.input.predecessorIssuance = null; },
    f => { f.options.retrospective = true; },
    f => { f.state.classic = { status: 200, required_linear_history: { enabled: true } }; },
    f => { f.state.classic = { status: 503 }; },
    f => { f.options.activeRuleTypes = ['required_linear_history']; },
    f => { const refs = f.options.input.predecessorIssuance.storedBundle.authorityBundle.request.dependentWork; refs.push(refs[0]); },
    f => f.choose({ repository: 'github.com/other/repo' }),
    f => f.choose({ headRevision: oid(8) }),
    f => f.choose({ baseRevision: oid(8) }),
    f => f.choose({ profileDigest: 'f'.repeat(64) }),
    f => { f.options.allowedMethods = ['merge', 'squash']; },
    f => { f.options.input.request = { dependentWork: [integrationMethodChoiceReference(f.choice)] };
      f.options.input.predecessorIssuance = null; },
  ]) {
    const f = fixture(); change(f); await assert.rejects(observeIntegrationMethod(f.options), /integration|choice/u);
  }
});

test('provider settings cannot override a strict committed profile or a selected queue', async () => {
  for (const capabilities of [['protected-integration:pull-request', 'integration-method:squash'],
    ['protected-integration:pull-request', 'integration-method:squash-preferred', 'tested-protected-ordering:merge-queue']]) {
    const f = fixture(), { profileDigest: omitted, ...source } = f.profile;
    assert.ok(omitted);
    f.state.profile = createRepositoryProfile({ ...source, capabilities });
    f.choose({ profileDigest: f.state.profile.profileDigest });
    await assert.rejects(observeIntegrationMethod(f.options), /strict profiles|queue requires squash/u);
  }
});

test('rebase refuses changed content, identity, order, length, base and merge topology', async () => {
  for (const change of [
    f => { f.rows.get(merged).tree.sha = oid(90); },
    f => { f.rows.get(merged).message = 'amended'; },
    f => { f.rows.get(merged).author.email = 'someone@example.test'; },
    f => { f.rows.get(merged).parents.push({ sha: base }); },
    f => { f.rows.get(merged).parents[0].sha = base; f.options.mergedCommit.parents = [base]; },
    f => { f.rows.get(oid(4)).parents[0].sha = merged; },
    f => { f.rows.get(oid(4)).parents[0].sha = oid(99); },
    f => { f.options.mergedCommit.revision = head; },
    f => { f.options.mergedCommit.tree = oid(90); },
  ]) {
    const f = fixture(); change(f); await assert.rejects(observeIntegrationMethod(f.options));
  }
});

test('observation remains bounded at 32 commits', async () => {
  const f = fixture(); f.rows.clear();
  for (let i = 1; i <= 33; i++) {
    f.row(oid(100 + i), i === 1 ? base : oid(99 + i), oid(300 + i), `commit ${i}`);
    f.row(oid(200 + i), i === 1 ? base : oid(199 + i), oid(300 + i), `commit ${i}`);
  }
  f.choose({ headRevision: oid(133) }); f.options.candidate.headRevision = oid(133);
  f.options.mergedCommit = { revision: oid(233), parents: [oid(232)], tree: oid(333) };
  await assert.rejects(observeIntegrationMethod(f.options), /32 commits/u);
  assert.equal(f.calls.length, 66);
});

test('merge backup fails safely; legacy squash remains valid only when rebase is unavailable', async () => {
  const f = fixture('merge'); f.options.mergedCommit.parents = [base, head];
  assert.equal((await observeIntegrationMethod(f.options)).method, 'merge');
  f.options.mergedCommit.parents = [oid(9), head];
  await assert.rejects(observeIntegrationMethod(f.options), /chosen head and base/u);
  f.options.input.predecessorIssuance = null;
  assert.deepEqual(await observeIntegrationMethod(f.options), { method: 'merge' });
  f.options.mergedCommit.parents = [base];
  await assert.rejects(observeIntegrationMethod(f.options), /ambiguous/u);
  f.options.allowedMethods = ['merge', 'squash'];
  assert.deepEqual(await observeIntegrationMethod(f.options), { method: 'squash' });
  const s = fixture('squash'); s.options.mergedCommit.parents = [base];
  assert.equal((await observeIntegrationMethod(s.options)).method, 'squash');
  s.options.mergedCommit.parents = [oid(8)];
  await assert.rejects(observeIntegrationMethod(s.options), /protected base/u);
});

function protectedFixture() {
  const f = fixture(), digest = 'a'.repeat(64), locator = 'https://github.com/example/repo/pull/7';
  const time = '2026-09-14T00:15:00.000Z';
  const identity = { repository: target.repository, repositoryId: '77', owner: { id: '42', login: 'example' } };
  const rules = { repository: target.repository, ref: 'refs/heads/main', rulesets: [{
    id: '21', enforcement: 'active', bypassActors: [], rules: [
      { type: 'deletion', parameters: null }, { type: 'non_fast_forward', parameters: null },
      { type: 'pull_request', parameters: { allowed_merge_methods: ['merge', 'rebase', 'squash'] } },
      { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false,
        required_status_checks: [{ context: 'test', integration_id: 15368 }] } },
    ] }] };
  const protection = createGitHubProtectionProjection(rules);
  const bundle = f.options.input.predecessorIssuance.storedBundle.authorityBundle;
  Object.assign(bundle, { candidate: { targetRepository: target.repository, branch: 'agent/device/work',
    canonicalBranch: 'main', headRevision: head, canonicalRevision: base },
  policy: { evidenceRepository: target.repository, canonicalRef: 'refs/heads/main' },
  evidenceRef: 'refs/heads/adlc/authority/test', evidencePath: 'authority-evidence/test.json',
  workflowRun: { locator: 'https://api.github.com/repos/example/repo/actions/runs/1' },
  challenge: { expiresAt: '2026-09-14T01:00:00.000Z' } });
  const publication = { evidenceRepository: target.repository, evidenceRef: bundle.evidenceRef,
    evidencePath: bundle.evidencePath, publicationRevision: oid(90), parentRevision: base,
    committedAt: '2026-09-14T00:05:00.000Z', storedDigest: digest, receiptDigest: digest };
  const stored = f.options.input.predecessorIssuance.storedBundle;
  Object.assign(stored, { storedDigest: digest, targetRepository: identity,
    preProtection: { evidence: protection, canonical: structuredClone(protection) } });
  Object.assign(f.options.input.predecessorIssuance, { issuanceDigest: digest,
    transitionReceipt: { receiptDigest: digest }, publicationReceipt: publication });
  Object.assign(f.options.input, { request: { reviewLocator: locator, authoritySubject: 'github-user:42' },
    plan: { target: { resource: locator, immutableRevision: merged }, parametersDigest: digest } });
  const initialProvider = { readRun: async () => bundle.workflowRun,
    readActor: async () => ({ subject: 'github-user:42' }), readBundle: async () => stored,
    readRules: async () => rules, readPublication: async () => ({ repository: target.repository,
      ref: publication.evidenceRef, path: publication.evidencePath, revision: publication.publicationRevision,
      parentRevision: base, committedAt: publication.committedAt, storedDigest: digest }) };
  const get = f.options.api.call, check = { id: 701, name: 'test', app: { id: 15368 },
    status: 'completed', conclusion: 'success', head_sha: head, completed_at: '2026-09-14T00:14:00Z' };
  const suite = { id: 801, actor_id: 42, actor_name: 'example', before_sha: base, after_sha: merged,
    ref: 'refs/heads/main', result: 'pass', pushed_at: time,
    rule_evaluations: rules.rulesets[0].rules.map(rule => ({ rule_type: rule.type,
      enforcement: 'active', result: 'pass', rule_source: { type: 'ruleset', id: 21 } })) };
  f.options.api.call = async (verb, path) => {
    if (path === target.path) return { full_name: 'example/repo', id: 77, owner: { id: 42, login: 'example' } };
    if (path.endsWith('/pulls/7')) return { number: 7, html_url: locator, state: 'closed', merged: true,
      draft: false, merged_at: time, head: { repo: { full_name: 'example/repo' }, ref: bundle.candidate.branch, sha: head },
      base: { repo: { full_name: 'example/repo' }, ref: 'main', sha: base } };
    if (path.includes('/issues/7/events')) return [{ id: 901, event: 'merged', commit_id: merged,
      commit_url: `https://api.github.com${target.path}/commits/${merged}`, created_at: time }];
    if (path.includes('/check-runs?')) return { total_count: 1, check_runs: [check] };
    if (path.endsWith('/check-runs/701')) return check;
    if (path.includes('/rule-suites?')) return [suite];
    if (path.endsWith('/rule-suites/801')) return suite;
    return get(verb, path);
  };
  f.options.api.commit = async (_, revision) => revision === merged ? f.options.mergedCommit : { tree: oid(13) };
  f.options.api.gitRef = async (_, ref) => ref === 'refs/heads/main' ? merged : head;
  f.options.api.sha = value => value;
  f.options.api.rules = async () => ({ projection: protection, versions: [{ id: '21', updatedAt: '2026-09-14T00:01:00.000Z' }] });
  return { ...f, initialProvider, suite, proofOptions: { ...f.options, initialProvider, requirePlanBinding: false } };
}

test('protected integration authenticates choice before merge and binds the complete rebase proof on replay', async () => {
  const f = protectedFixture(), proof = await observeGitHubIntegrationProof(f.proofOptions);
  assert.equal(proof.mergeMethod, 'rebase');
  assert.equal(proof.integrationMethodEvidence.sequence.commitCount, 2);
  f.options.input.plan.parametersDigest = proof.proofDigest;
  assert.deepEqual(await observeGitHubIntegrationProof({ ...f.proofOptions, requirePlanBinding: true,
    expectedProof: proof }), proof);
  f.suite.before_sha = oid(4);
  await assert.rejects(observeGitHubIntegrationProof(f.proofOptions), /rule suite identity/u);
  f.suite.before_sha = base;
  f.initialProvider.readActor = async () => ({ subject: 'github-user:other' });
  await assert.rejects(observeGitHubIntegrationProof(f.proofOptions), /no longer live and exact/u);
});

test('protected rebase rejects choices published after integration and changed effect plan bindings', async () => {
  const f = protectedFixture();
  f.options.input.predecessorIssuance.publicationReceipt.committedAt = '2026-09-14T00:16:00.000Z';
  // The provider publication observes the same late immutable record.
  const prior = f.initialProvider.readPublication;
  f.initialProvider.readPublication = async () => ({ ...await prior(), committedAt: '2026-09-14T00:16:00.000Z' });
  await assert.rejects(observeGitHubIntegrationProof(f.proofOptions), /outside the predecessor authority window/u);
  const valid = protectedFixture();
  await assert.rejects(observeGitHubIntegrationProof({ ...valid.proofOptions, requirePlanBinding: true }),
    /effect plan or stored winner/u);
});
