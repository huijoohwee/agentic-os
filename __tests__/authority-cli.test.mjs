import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalJson, claim } from '../src/governance.mjs';
import { RECOVERY_CANDIDATE_INVENTORY_ALGORITHM, createRecoveryCandidate } from '../src/recovery-candidate.mjs';
import { deriveGitHubAuthorityInputDigest } from '../src/github-authority.mjs';
import { validateGitHubAuthorityIssuance } from '../src/github-authority-issuer.mjs';
import { parseAuthorityArguments, runAuthority } from '../bin/agentic-os-authority.mjs';

const hash = (value, length = 64) => value.repeat(length);
const HEAD = hash('a', 40), WORKFLOW = hash('b', 40), TARGET_BASE = hash('c', 40);
const TARGET_HEAD = hash('d', 40), PARENT = hash('e', 40), BASE_TREE = hash('f', 40);
const EVIDENCE_TREE = hash('1', 40), BLOB = hash('2', 40), PUBLICATION = hash('3', 40);
const STARTED = '2026-09-02T00:10:00.000Z', COMMITTED = '2026-09-02T00:11:00.000Z';
const NOW = Date.parse('2026-09-02T00:20:00.000Z');
const RUN = 'https://api.github.com/repos/example/evidence/actions/runs/101';

function candidate() {
  return createRecoveryCandidate({
    targetRepository: 'github.com/example/target', branch: 'agent/device/recovery', canonicalBranch: 'main',
    headRevision: TARGET_HEAD, canonicalRevision: TARGET_BASE, reviewLocator: 'https://github.com/example/target/pull/7',
    predecessorEvidenceDigest: hash('4'), inventoryAlgorithm: RECOVERY_CANDIDATE_INVENTORY_ALGORITHM,
    inventoryEntries: { index: 1, tracked: 1, visibleUntracked: 0, hidden: 0, ignoredRuntime: 0, content: 1 },
    indexInventoryDigest: hash('5'), trackedInventoryDigest: hash('6'), visibleUntrackedInventoryDigest: hash('7'),
    hiddenInventoryDigest: hash('8'), ignoredRuntimeInventoryDigest: hash('9'), contentInventoryDigest: hash('0'),
    observedAt: '2026-09-02T00:05:00.000Z', expiresAt: '2026-09-02T00:55:00.000Z',
  });
}
function dispatch() {
  const bound = candidate();
  return { request: claim({
    repository: bound.targetRepository, authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
    scope: ['recovery:fixture'], dependentWork: [`effect-plan:sha256:${hash('e')}`],
    immutableRevision: `candidate:sha256:${bound.candidateDigest}`, reviewLocator: bound.reviewLocator,
    observedAt: '2026-09-02T00:00:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z',
  }), candidate: bound };
}
function policy() {
  return {
    targetRepositoryPrefix: 'github.com/example/', canonicalRef: 'refs/heads/release/2026',
    workflowPath: '.github/workflows/authority.yml', confirmationClass: 'interactive-provider',
    requiredStatusChecks: ['Integration Gate'], allowedMergeMethods: ['squash'],
    evidenceRefPrefix: 'refs/heads/agentic-os/evidence/', evidencePathPrefix: 'authority-evidence/', validitySeconds: 3_600,
  };
}
function effectivePolicy(staticPolicy) {
  return { evidenceRepository: 'github.com/example/evidence', targetRepositoryPrefix: staticPolicy.targetRepositoryPrefix,
    canonicalRef: staticPolicy.canonicalRef, canonicalRevision: HEAD, workflowPath: staticPolicy.workflowPath,
    workflowRef: 'refs/heads/release/2026', workflowRevision: WORKFLOW, confirmationClass: staticPolicy.confirmationClass,
    requiredStatusChecks: staticPolicy.requiredStatusChecks, allowedMergeMethods: staticPolicy.allowedMergeMethods,
    evidenceRefPrefix: staticPolicy.evidenceRefPrefix, evidencePathPrefix: staticPolicy.evidencePathPrefix,
    validitySeconds: staticPolicy.validitySeconds };
}
function response(value, status = 200, headers = {}) { return new Response(JSON.stringify(value), { status, headers }); }
function content(value, sha) {
  const bytes = Buffer.from(typeof value === 'string' ? value : canonicalJson(value), 'utf8');
  return response({ type: 'file', encoding: 'base64', content: bytes.toString('base64'), sha });
}
function commit(sha, parents, tree, date = COMMITTED) {
  return response({ sha, parents: parents.map((parent) => ({ sha: parent })), tree: { sha: tree }, commit: { committer: { date } } });
}
function stream() { const values = []; return { values, write(value) { values.push(value); } }; }
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-authority-cli-')), previous = process.cwd();
  process.chdir(root);
  t.after(() => { process.chdir(previous); rmSync(root, { recursive: true, force: true }); });
  return root;
}
function rule(type, options = {}) {
  if (type === 'required_status_checks') return { type, ruleset_id: options.id, parameters: {
    required_status_checks: options.emptyChecks ? [] : [{ context: 'Integration Gate', integration_id: 15368 }],
    strict_required_status_checks_policy: false,
  } };
  if (type === 'pull_request') return { type, ruleset_id: options.id, parameters: { allowed_merge_methods: ['squash'] } };
  if (type === 'update') return { type, ruleset_id: options.id, parameters: { update_allows_fetch_and_merge: Boolean(options.updateAllows) } };
  return { type, ruleset_id: options.id, parameters: null };
}
function fixture(t, options = {}, root = sandbox(t)) {
  const source = dispatch(), staticPolicy = policy(), fullPolicy = effectivePolicy(staticPolicy);
  const digest = options.digest ?? deriveGitHubAuthorityInputDigest({ request: source.request, candidate: source.candidate, policy: fullPolicy });
  const eventPath = join(root, 'event.json');
  writeFileSync(join(root, 'policy.json'), canonicalJson(staticPolicy));
  writeFileSync(eventPath, canonicalJson({ inputs: {
    authority_payload: options.payload ?? canonicalJson(source), authority_input_digest: digest,
  } }));
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'example/evidence',
    GITHUB_TOKEN: 'environment-secret', GITHUB_EVENT_PATH: eventPath, GITHUB_RUN_ID: '101', GITHUB_REF: 'refs/heads/release/2026',
    GITHUB_SHA: HEAD, GITHUB_WORKFLOW_REF: 'example/evidence/.github/workflows/authority.yml@refs/heads/release/2026', GITHUB_WORKFLOW_SHA: WORKFLOW };
  const calls = [], canonicalRules = ['pull_request', 'required_status_checks', 'deletion', 'non_fast_forward'];
  const creationRules = ['creation'], immutableRules = ['update', 'deletion', 'non_fast_forward'];
  let published = false, stored = null, evidencePath = null;
  const entries = (types, id, extra = {}) => types.map((type) => rule(type, { id, ...extra }));
  const ruleset = (id, types, bypass, extra = {}) => ({ id: Number(id), enforcement: 'active',
    rules: [...entries(types, id, extra).map(({ type, parameters }) => ({ type, parameters })),
      ...(extra.extraDetailRule ? [{ type: 'required_signatures', parameters: null }] : [])], bypass_actors: bypass });
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url), route = `${init.method} ${decodeURIComponent(parsed.pathname)}`;
    calls.push({ route, init, parsed });
    if (route === 'GET /repos/example/evidence/contents/policy.json') {
      assert.equal(parsed.searchParams.get('ref'), HEAD); return content(staticPolicy, hash('4', 40));
    }
    if (route === 'GET /repos/example/evidence/contents/.github/workflows/authority.yml') {
      assert.equal(parsed.searchParams.get('ref'), WORKFLOW); return content('name: authority\n', hash('5', 40));
    }
    if (route === 'GET /repos/example/evidence/actions/runs/101') return response({
      id: 101, url: RUN, event: 'workflow_dispatch', run_attempt: 1, repository: { full_name: 'example/evidence' },
      head_branch: 'release/2026', head_sha: HEAD, path: options.workflowPath ?? '.github/workflows/authority.yml',
      run_started_at: STARTED, actor: { id: 42, login: 'example' }, triggering_actor: { id: 42, login: 'example' },
    });
    if (route === 'GET /users/example') return response({ id: 42, login: 'example' });
    if (route === 'GET /repos/example/target') return response({ id: 77, full_name: 'example/target', owner: { id: options.ownerId ?? 42, login: 'example', type: 'User' } });
    if (route === 'GET /repos/example/target/git/ref/heads/main') return response({ ref: 'refs/heads/main', object: { type: 'commit', sha: TARGET_BASE } });
    if (route === 'GET /repos/example/target/git/ref/heads/agent/device/recovery') return response({ ref: 'refs/heads/agent/device/recovery', object: { type: 'commit', sha: options.targetHead ?? TARGET_HEAD } });
    if (route === 'GET /repos/example/target/pulls/7') return response({ number: 7, html_url: 'https://github.com/example/target/pull/7',
      state: 'open', merged_at: null, draft: false, head: { repo: { full_name: 'example/target' }, ref: 'agent/device/recovery', sha: TARGET_HEAD },
      base: { repo: { full_name: 'example/target' }, ref: 'main', sha: TARGET_BASE } });
    if (route === 'GET /repos/example/evidence/rules/branches/release/2026') {
      assert.equal(parsed.searchParams.get('per_page'), '100');
      return options.rulesObject ? response({ rules: entries(canonicalRules, '11') }) : response(entries(canonicalRules, '11', { emptyChecks: options.emptyChecks }));
    }
    if (route.startsWith('GET /repos/example/evidence/rules/branches/agentic-os/evidence/')) {
      assert.equal(parsed.searchParams.get('per_page'), '100');
      return response([...entries(creationRules, '12'), ...entries(immutableRules, '13', { updateAllows: options.updateAllows })]);
    }
    if (route === 'GET /repos/example/evidence/rulesets/11') {
      assert.equal(parsed.searchParams.get('includes_parents'), 'true'); return response(ruleset('11', canonicalRules, [], {
        emptyChecks: options.emptyChecks, extraDetailRule: options.extraDetailRule,
      }));
    }
    if (route === 'GET /repos/example/evidence/rulesets/12') return response(ruleset('12', creationRules, [{ actor_type: 'Integration', actor_id: 15368, bypass_mode: 'always' }]));
    if (route === 'GET /repos/example/evidence/rulesets/13') return response(ruleset('13', immutableRules, [], { updateAllows: options.updateAllows }));
    if (route.startsWith('GET /repos/example/evidence/git/ref/heads/agentic-os/evidence/')) {
      return published ? response({ ref: `refs/heads/${decodeURIComponent(parsed.pathname).split('/heads/')[1]}`, object: { type: 'commit', sha: PUBLICATION } }) : new Response('', { status: 404 });
    }
    if (route.startsWith('GET /repos/example/evidence/contents/authority-evidence/')) return published ? content(stored, BLOB) : new Response('', { status: 404 });
    if (route === 'GET /repos/example/evidence/git/ref/heads/release/2026') return response({ ref: 'refs/heads/release/2026', object: { type: 'commit', sha: HEAD } });
    if (route === `GET /repos/example/evidence/git/commits/${HEAD}`) return commit(HEAD, [PARENT], BASE_TREE, STARTED);
    if (route === `GET /repos/example/evidence/git/commits/${PUBLICATION}`) return commit(PUBLICATION, [HEAD], EVIDENCE_TREE);
    if (route === `GET /repos/example/evidence/git/trees/${BASE_TREE}`) return response({
      sha: options.wrongTreeSha ? hash('0', 40) : BASE_TREE,
      truncated: options.truncatedTree ? null : false,
      tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: hash('6', 40) }],
    });
    if (route === `GET /repos/example/evidence/git/trees/${EVIDENCE_TREE}`) {
      const tree = [{ path: 'README.md', mode: '100644', type: 'blob', sha: hash('6', 40) },
        { path: 'authority-evidence', mode: '040000', type: 'tree', sha: hash('8', 40) },
        { path: evidencePath, mode: '100644', type: 'blob', sha: BLOB }];
      if (options.extraTree) tree.push({ path: 'surprise.md', mode: '100644', type: 'blob', sha: hash('7', 40) });
      return response({ sha: EVIDENCE_TREE, truncated: false, tree });
    }
    if (route === 'POST /repos/example/evidence/git/blobs') {
      const body = JSON.parse(init.body); stored = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')); return response({ sha: BLOB }, 201);
    }
    if (route === 'POST /repos/example/evidence/git/trees') {
      const body = JSON.parse(init.body); assert.equal(body.base_tree, BASE_TREE); assert.equal(body.tree.length, 1);
      evidencePath = body.tree[0].path; assert.doesNotMatch(evidencePath, /%2f/iu); return response({ sha: EVIDENCE_TREE }, 201);
    }
    if (route === 'POST /repos/example/evidence/git/commits') {
      const body = JSON.parse(init.body); assert.deepEqual(body.parents, [HEAD]); assert.equal(body.tree, EVIDENCE_TREE); return response({ sha: PUBLICATION }, 201);
    }
    if (route === 'POST /repos/example/evidence/git/refs') {
      const body = JSON.parse(init.body); assert.deepEqual(Object.keys(body).sort(), ['ref', 'sha']); published = true; return response({ ref: body.ref, object: { sha: PUBLICATION } }, 201);
    }
    throw new Error(`unexpected ${route}`);
  };
  return { source, env, calls, fetchImpl, eventPath, run: (stdout = stream(), stderr = stream()) => runAuthority([
    'issue-github', `--event=${eventPath}`, '--policy=policy.json',
  ], { env, fetchImpl, now: () => NOW, stdout, stderr }).then((code) => ({ code, stdout, stderr })) };
}

test('authority command accepts only a current workflow dispatch event and committed policy', () => {
  assert.deepEqual(parseAuthorityArguments(['issue-github', '--event=event.json', '--policy', 'policy.json']), {
    command: 'issue-github', eventPath: 'event.json', policyPath: 'policy.json',
  });
  assert.throws(() => parseAuthorityArguments(['issue-github', '--input=x', '--policy=y']), /only --event and --policy/u);
  assert.throws(() => parseAuthorityArguments(['issue-github', '--event=x']), /policy path/u);
});

test('issues, replays, and live-verifies one GitHub-fenced authority issuance', async (t) => {
  const api = fixture(t), first = await api.run();
  assert.equal(first.code, 0, first.stderr.values.join('')); assert.deepEqual(first.stderr.values, []);
  const issuance = JSON.parse(first.stdout.values.join(''));
  assert.deepEqual(validateGitHubAuthorityIssuance(issuance), issuance);
  assert.equal(issuance.publicationReceipt.parentRevision, HEAD);
  assert.equal(issuance.publicationReceipt.targetRepository.review.headRevision, TARGET_HEAD);
  assert.ok(api.calls.filter((call) => call.route === 'GET /repos/example/evidence/actions/runs/101').length >= 3);
  assert.equal(api.calls.filter((call) => call.route === 'POST /repos/example/evidence/git/refs').length, 1);
  assert.equal(api.calls.some((call) => call.init.method === 'PATCH'), false);
  assert.equal(api.calls.every((call) => call.parsed.origin === 'https://api.github.com' && call.init.redirect === 'error'), true);
  assert.equal(api.calls.every((call) => call.init.headers.authorization === 'Bearer environment-secret'), true);
  assert.equal(first.stdout.values.join('').includes('environment-secret'), false);
  const second = await api.run();
  assert.equal(second.code, 0); assert.deepEqual(JSON.parse(second.stdout.values.join('')), issuance);
  assert.equal(api.calls.filter((call) => call.route === 'POST /repos/example/evidence/git/refs').length, 1);
});

test('fails closed for forged input, weak or inexact rules, target drift, and inexact trees', async (t) => {
  const root = sandbox(t);
  for (const options of [
    { digest: hash('f') }, { workflowPath: '.github/workflows/authority.yml@refs/heads/release/2026' },
    { rulesObject: true }, { emptyChecks: true }, { updateAllows: true }, { extraDetailRule: true },
    { targetHead: hash('9', 40) }, { extraTree: true }, { wrongTreeSha: true }, { truncatedTree: true },
  ]) {
    const api = fixture(t, options, root), result = await api.run();
    assert.equal(result.code, 1, JSON.stringify(options));
    assert.match(result.stderr.values.join(''), /authority issuance failed:/u);
    assert.doesNotMatch(result.stderr.values.join(''), /environment-secret/u);
  }
});
