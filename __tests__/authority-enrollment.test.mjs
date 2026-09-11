import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, claim } from '../src/governance.mjs';
import { createRecoveryCandidate, RECOVERY_CANDIDATE_INVENTORY_ALGORITHM } from '../src/recovery-candidate.mjs';
import { deriveGitHubAuthorityInputDigest } from '../src/github-authority.mjs';
import { loadCommittedAuthorityPolicy, runAuthority } from '../bin/agentic-os-authority.mjs';

const policyPath = '.github/adlc-authority-policy.json';
const policy = loadCommittedAuthorityPolicy(policyPath);
const revision = 'a'.repeat(40), digest = 'b'.repeat(64);
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'authority-enrollment-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const event = join(directory, 'event.json');
  const candidate = createRecoveryCandidate({ targetRepository: 'github.com/huijoohwee/agentic-os',
    branch: 'agent/test/enrollment', canonicalBranch: 'main', headRevision: revision,
    canonicalRevision: 'c'.repeat(40), reviewLocator: 'https://github.com/huijoohwee/agentic-os/pull/1',
    predecessorEvidenceDigest: digest, inventoryAlgorithm: RECOVERY_CANDIDATE_INVENTORY_ALGORITHM,
    inventoryEntries: { index: 1, tracked: 1, visibleUntracked: 0, hidden: 0, ignoredRuntime: 0, content: 1 },
    indexInventoryDigest: digest, trackedInventoryDigest: digest, visibleUntrackedInventoryDigest: digest,
    hiddenInventoryDigest: digest, ignoredRuntimeInventoryDigest: digest, contentInventoryDigest: digest,
    observedAt: '2026-09-11T00:00:00.000Z', expiresAt: '2026-09-11T01:00:00.000Z' });
  const request = claim({ repository: candidate.targetRepository, authoritySubject: 'github-user:42',
    ownerSubject: 'github-user:42', scope: ['cleanup:enrollment-fixture'],
    dependentWork: [`effect-plan:sha256:${digest}`],
    immutableRevision: `candidate:sha256:${candidate.candidateDigest}`, reviewLocator: candidate.reviewLocator,
    observedAt: candidate.observedAt, expiresAt: candidate.expiresAt });
  const runtime = { ...policy, evidenceRepository: candidate.targetRepository,
    canonicalRevision: revision, workflowRevision: revision, workflowRef: policy.canonicalRef };
  const inputs = { authority_payload: canonicalJson({ request, candidate }),
    authority_input_digest: deriveGitHubAuthorityInputDigest({ request, candidate, policy: runtime }) };
  writeFileSync(event, JSON.stringify({ inputs }));
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REPOSITORY: 'huijoohwee/agentic-os', GITHUB_EVENT_PATH: event, GITHUB_RUN_ID: '1',
    GITHUB_REF: 'refs/heads/main', GITHUB_SHA: revision, GITHUB_WORKFLOW_SHA: revision,
    GITHUB_WORKFLOW_REF: 'huijoohwee/agentic-os/.github/workflows/adlc-authority.yml@refs/heads/main' };
  const output = [], stream = { write: text => output.push(text) };
  const run = () => runAuthority(['validate-event', `--event=${event}`, `--policy=${policyPath}`],
    { env, stdout: stream, stderr: stream, fetchImpl: () => { throw new Error('unexpected network'); } });
  return { event, inputs, env, output, run };
}
test('enrolled policy validates a bound input without token, network or success publication', async t => {
  const f = fixture(t); assert.equal(await f.run(), 0); assert.deepEqual(f.output, []);
  assert.deepEqual(policy.requiredStatusChecks, ['budgets', 'test']);
  assert.deepEqual(policy.allowedMergeMethods, ['squash']);
  assert.equal(policy.validitySeconds, 3600);
});
test('enrolled validator rejects changed digest, branch, workflow and noncanonical payload', async t => {
  for (const mutation of [f => { f.env.GITHUB_REF = 'refs/heads/other'; },
    f => { f.env.GITHUB_WORKFLOW_SHA = 'd'.repeat(40); },
    f => { f.inputs.authority_input_digest = '0'.repeat(64); },
    f => { f.inputs.authority_payload += '\n'; }]) {
    const f = fixture(t); mutation(f); writeFileSync(f.event, JSON.stringify({ inputs: f.inputs }));
    assert.equal(await f.run(), 1); assert.match(f.output.join(''), /authority validation failed/u);
  }
});
test('enrollment stays explicit, read-only, exact-target and credential-free', () => {
  const workflow = readFileSync('.github/workflows/adlc-authority.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /const target = "github.com\/huijoohwee\/agentic-os"/u);
  assert.match(workflow, /dispatch.request.repository !== target \|\| dispatch.candidate.targetRepository !== target/u);
  assert.match(workflow, /run: node bin\/agentic-os-authority.mjs validate-event/u);
  assert.doesNotMatch(workflow, /issue-github|secrets\.|contents: write|pull_request_target|schedule:|npm (?:ci|install)/u);
});
test('the enrolled workflow rejects either foreign request or foreign candidate before validation', t => {
  const f = fixture(t), workflow = readFileSync('.github/workflows/adlc-authority.yml', 'utf8');
  const script = workflow.match(/node --input-type=module -e '([\s\S]+?)\n          '/u)[1];
  const invoke = () => spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { env: { ...process.env, GITHUB_EVENT_PATH: f.event }, encoding: 'utf8' });
  assert.equal(invoke().status, 0);
  for (const field of ['request', 'candidate']) {
    const dispatch = JSON.parse(f.inputs.authority_payload);
    dispatch[field][field === 'request' ? 'repository' : 'targetRepository'] = 'github.com/huijoohwee/unrelated';
    writeFileSync(f.event, JSON.stringify({ inputs: { ...f.inputs, authority_payload: canonicalJson(dispatch) } }));
    const result = invoke(); assert.equal(result.status, 1);
    assert.match(result.stderr, /authority target is outside this enrollment/u);
  }
});
