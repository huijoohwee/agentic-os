import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalJson, claim } from '../../src/governance.mjs';
import { MAX_STRING_BYTES } from '../../src/catalog-input.mjs';
import { RECOVERY_CANDIDATE_INVENTORY_ALGORITHM, createRecoveryCandidate } from '../../src/recovery-candidate.mjs';
import { deriveGitHubAuthorityInputDigest, GITHUB_RETROSPECTIVE_RECOVERY_MODE }
  from '../../src/github-authority.mjs';
import { validateGitHubAuthorityIssuance } from '../../src/github-authority-issuer.mjs';
import {
  createEffectPlan,
  effectPlanByteDigest,
  encodeEffectPlan,
} from '../../src/completion.mjs';
import {
  createGitHubAuthorityLiveVerificationReceipt,
  createGitHubAuthorityReadProvider,
  deriveGitHubAuthorityRunName,
  validateGitHubAuthorityLiveVerificationReceipt,
  verifyGitHubAuthorityIssuanceLive,
} from '../../src/github-authority-client.mjs';
import {
  MAX_AUTHORITY_EVENT_BYTES,
  MAX_AUTHORITY_INPUT_BYTES,
  MAX_AUTHORITY_RESPONSE_BYTES,
  loadAuthorityDispatch,
  parseAuthorityArguments,
  runAuthority,
} from '../../bin/agentic-os-authority.mjs';

const hash = (value, length = 64) => value.repeat(length);
const HEAD = hash('a', 40), WORKFLOW = HEAD, TARGET_BASE = hash('c', 40);
const TARGET_HEAD = hash('d', 40), PARENT = hash('e', 40), BASE_TREE = hash('f', 40);
const EVIDENCE_TREE = hash('1', 40), BLOB = hash('2', 40), PUBLICATION = hash('3', 40);
const MERGE = hash('7', 40), LIVE_TARGET = hash('8', 40), TARGET_TREE = hash('9', 40);
const STARTED = '2026-09-02T00:10:00.000Z', COMPLETED = '2026-09-02T00:10:30.000Z';
const COMMITTED = '2026-09-02T00:11:00.000Z';
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
function dispatch(requestOverrides = {}) {
  const bound = candidate();
  return { request: claim({
    repository: bound.targetRepository, authoritySubject: 'github-user:42', ownerSubject: 'github-user:42',
    scope: ['recovery:fixture'], dependentWork: [`effect-plan:sha256:${hash('e')}`],
    immutableRevision: `candidate:sha256:${bound.candidateDigest}`, reviewLocator: bound.reviewLocator,
    observedAt: '2026-09-02T00:00:00.000Z', expiresAt: '2026-09-02T01:00:00.000Z',
    ...requestOverrides,
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
function ambientMetadata(count = 96) {
  return { deepAmbient: Array.from({ length: 32 }).reduce((value) => ({ next: value }), 'leaf'),
    ...Object.fromEntries(Array.from({ length: count }, (_, index) => [`ambient_${index}`, index])) };
}
function githubUserMetadata() {
  return {
    node_id: 'MDQ6VXNlcjQy', avatar_url: 'https://avatars.example/42', gravatar_id: '',
    url: 'https://api.github.com/users/example', html_url: 'https://github.com/example',
    followers_url: 'https://api.github.com/users/example/followers', type: 'User',
    site_admin: false, name: 'Example Owner', company: null, blog: '', location: null,
    email: null, hireable: null, bio: null, public_repos: 1, public_gists: 0,
    followers: 0, following: 0, created_at: '2020-01-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z', private_gists: 0, total_private_repos: 1,
    owned_private_repos: 1, disk_usage: 1, collaborators: 0,
    two_factor_authentication: true,
    plan: { name: 'free', space: 1, collaborators: 0, private_repos: 1 },
  };
}
function content(value, sha) {
  const bytes = Buffer.from(typeof value === 'string' ? value : canonicalJson(value), 'utf8');
  return response({ type: 'file', encoding: 'base64', content: bytes.toString('base64'), sha });
}
function commit(sha, parents, tree, date = COMMITTED) {
  return response({ sha, parents: parents.map((parent) => ({ sha: parent })), tree: { sha: tree }, committer: { date } });
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
  if (type === 'update') {
    const descriptor = { type, ruleset_id: options.id };
    if (options.updateAllows) return { ...descriptor, parameters: { update_allows_fetch_and_merge: true } };
    if (options.updateExtraParameter) return { ...descriptor, parameters: { update_allows_fetch_and_merge: false, unexpected: true } };
    return descriptor;
  }
  if (type === 'deletion' && options.evidenceDeletionParameters) {
    return { type, ruleset_id: options.id, parameters: {} };
  }
  return { type, ruleset_id: options.id, parameters: null };
}
function fixture(t, options = {}, root = sandbox(t)) {
  const source = options.source ?? dispatch(), staticPolicy = policy(), fullPolicy = effectivePolicy(staticPolicy);
  const digest = options.digest ?? deriveGitHubAuthorityInputDigest({ request: source.request,
    candidate: source.candidate, policy: fullPolicy,
    ...(source.issuanceMode === undefined ? {} : { issuanceMode: source.issuanceMode }) });
  const eventPath = join(root, 'event.json');
  writeFileSync(join(root, 'policy.json'), canonicalJson(staticPolicy));
  writeFileSync(eventPath, canonicalJson({ inputs: {
    authority_payload: options.payload ?? canonicalJson(source), authority_input_digest: digest,
  } }));
  const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '1', GITHUB_REPOSITORY: 'example/evidence',
    GITHUB_TOKEN: 'environment-secret', GITHUB_EVENT_PATH: eventPath, GITHUB_RUN_ID: '101', GITHUB_REF: 'refs/heads/release/2026',
    GITHUB_SHA: HEAD, GITHUB_WORKFLOW_REF: 'example/evidence/.github/workflows/authority.yml@refs/heads/release/2026', GITHUB_WORKFLOW_SHA: WORKFLOW };
  const calls = [], reads = { run: 0, workflow: 0, actor: 0 };
  const canonicalRules = ['pull_request', 'required_status_checks', 'deletion', 'non_fast_forward'];
  const evidenceRules = ['update', 'deletion', 'non_fast_forward',
    ...(options.evidenceCreation ? ['creation'] : [])];
  let published = false, stored = null, evidencePath = null;
  const entries = (types, id, extra = {}) => types.map((type) => rule(type, { id, ...extra }));
  const ruleset = (id, types, bypass, extra = {}) => ({ id: Number(id), enforcement: 'active',
    rules: [...entries(types, id, extra).map(({ type, parameters }) => ({ type, parameters })),
      ...(extra.extraDetailRule ? [{ type: 'required_signatures', parameters: null }] : [])], bypass_actors: bypass });
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url), route = `${init.method} ${decodeURIComponent(parsed.pathname)}`;
    calls.push({ route, init, parsed });
    if (route === 'GET /repos/example/evidence/contents/policy.json') {
      assert.equal(parsed.searchParams.get('ref'), HEAD); return content(options.noncanonicalRemotePolicy
        ? JSON.stringify(staticPolicy, null, 2) : staticPolicy, hash('4', 40));
    }
    if (route === 'GET /repos/example/evidence/contents/.github/workflows/authority.yml') {
      assert.equal(parsed.searchParams.get('ref'), WORKFLOW); return content('name: authority\n', hash('5', 40));
    }
    if (route === 'GET /repos/example/evidence/actions/runs/101') {
      reads.run += 1; const late = reads.run >= 4;
      return response({
      id: 101, url: RUN, event: 'workflow_dispatch', run_attempt: 1, repository: { full_name: 'example/evidence' },
      head_branch: 'release/2026', head_sha: HEAD, path: options.workflowPath ?? '.github/workflows/authority.yml',
      status: late && options.lateRunStatus ? options.lateRunStatus : options.runStatus ?? 'completed', conclusion: options.runConclusion === undefined
        ? 'success' : options.runConclusion, workflow_id: 501,
      display_title: late && options.lateDisplayTitle ? options.lateDisplayTitle : options.displayTitle ?? deriveGitHubAuthorityRunName({
        authorityInputDigest: digest, workflowRevision: WORKFLOW,
      }),
      run_started_at: STARTED, updated_at: options.completedAt ?? COMPLETED,
      actor: { id: 42, login: 'example' }, triggering_actor: { id: 42, login: 'example' },
    }); }
    if (route === 'GET /repos/example/evidence/actions/workflows/501') {
      reads.workflow += 1; const late = reads.workflow >= 4;
      return response({
      id: options.workflowResourceId ?? 501, path: options.workflowResourcePath
        ?? '.github/workflows/authority.yml', state: late && options.lateWorkflowState
        ? options.lateWorkflowState : options.workflowState ?? 'active',
    }); }
    if (route === 'GET /users/example') return response({ id: 42, login: 'example' });
    if (route === 'GET /user') {
      reads.actor += 1;
      const authenticatedActor = reads.actor >= 2 && options.lateAuthenticatedActor
        ? options.lateAuthenticatedActor : options.authenticatedActor
          ?? { id: 42, login: 'example' };
      return response({ ...githubUserMetadata(), ...authenticatedActor });
    }
    if (route === 'GET /repos/example/target') return response({
      ...(options.ambientTargetRepositoryMetadata ? ambientMetadata(93) : {}),
      ...(options.oversizedTargetMetadata ? { padding: 'x'.repeat(MAX_AUTHORITY_RESPONSE_BYTES) } : {}),
      id: 77, full_name: 'example/target', owner: {
        ...(options.ambientTargetRepositoryMetadata ? ambientMetadata(93) : {}),
        id: options.ownerId ?? 42,
        login: options.deepOwnerLogin
          ? Array.from({ length: 32 }).reduce((value) => ({ next: value }), 'example') : 'example',
        type: 'User',
      },
    });
    if (route === 'GET /repos/example/target/git/ref/heads/main') return response({ ref: 'refs/heads/main', object: { type: 'commit', sha: options.liveTargetBase ?? TARGET_BASE } });
    if (route === 'GET /repos/example/target/git/ref/heads/agent/device/recovery') return response({ ref: 'refs/heads/agent/device/recovery', object: { type: 'commit', sha: options.targetHead ?? TARGET_HEAD } });
    if (route === 'GET /repos/example/target/pulls/7') return response({ number: 7, html_url: 'https://github.com/example/target/pull/7',
      state: options.retrospective ? 'closed' : 'open', merged: options.retrospective ? true : undefined,
      merged_at: options.retrospective ? options.mergedAt ?? '2026-09-02T00:08:00Z' : null,
      draft: false,
      head: { repo: { ...(options.ambientTargetReviewMetadata ? ambientMetadata(79) : {}), full_name: 'example/target' },
        ref: 'agent/device/recovery', sha: TARGET_HEAD },
      base: { repo: { ...(options.ambientTargetReviewMetadata ? ambientMetadata(79) : {}), full_name: 'example/target' },
        ref: 'main', sha: options.pullBase ?? TARGET_BASE } });
    if (route === 'GET /repos/example/target/issues/7/events') {
      const events = [{ id: 901, event: 'merged', commit_id: MERGE,
        commit_url: `https://api.github.com/repos/example/target/commits/${MERGE}`,
        created_at: options.mergedAt ?? '2026-09-02T00:08:00Z' }];
      if (options.duplicateMergeEvent) events.push({ ...events[0], id: 902 });
      return response(events, 200, options.eventNext
        ? { link: '<https://api.github.com/next>; rel="next"' } : {});
    }
    if (route === `GET /repos/example/target/git/commits/${TARGET_HEAD}`)
      return commit(TARGET_HEAD, [TARGET_BASE], options.candidateTree ?? TARGET_TREE,
        '2026-09-02T00:07:00Z');
    if (route === `GET /repos/example/target/git/commits/${MERGE}`)
      return commit(MERGE, [options.mergeParent ?? TARGET_BASE],
        options.mergeTree ?? TARGET_TREE, '2026-09-02T00:08:00Z');
    if (route === `GET /repos/example/target/compare/${MERGE}...${LIVE_TARGET}`)
      return response({ status: options.compareStatus ?? 'ahead', base_commit: { sha: MERGE },
        merge_base_commit: { sha: options.mergeBase ?? MERGE },
        commits: options.emptyCompareCommits ? [] : [{ sha: options.compareTip ?? LIVE_TARGET }] });
    if (route === 'GET /repos/example/evidence/rules/branches/release/2026') {
      assert.equal(parsed.searchParams.get('per_page'), '100');
      return options.rulesObject ? response({ rules: entries(canonicalRules, '11') }) : response(entries(canonicalRules, '11', { emptyChecks: options.emptyChecks }));
    }
    if (route.startsWith('GET /repos/example/evidence/rules/branches/agentic-os/evidence/')) {
      assert.equal(parsed.searchParams.get('per_page'), '100');
      return response([
        ...entries(evidenceRules, '12', { updateAllows: options.updateAllows,
          updateExtraParameter: options.updateExtraParameter,
          evidenceDeletionParameters: options.evidenceDeletionParameters }),
        ...(options.extraEvidenceRuleset ? entries(['creation'], '13') : []),
      ]);
    }
    if (route === 'GET /repos/example/evidence/rulesets/11') {
      assert.equal(parsed.searchParams.get('includes_parents'), 'true'); return response(ruleset('11', canonicalRules, [], {
        emptyChecks: options.emptyChecks, extraDetailRule: options.extraDetailRule,
      }));
    }
    if (route === 'GET /repos/example/evidence/rulesets/12') return response(ruleset('12', evidenceRules,
      options.evidenceBypass ? [{ actor_type: 'RepositoryRole', actor_id: 5, bypass_mode: 'always' }] : [],
      { updateAllows: options.updateAllows,
        updateExtraParameter: options.updateExtraParameter,
        evidenceDeletionParameters: options.evidenceDeletionParameters }));
    if (route === 'GET /repos/example/evidence/rulesets/13' && options.extraEvidenceRuleset) {
      return response(ruleset('13', ['creation'], []));
    }
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
      const body = JSON.parse(init.body); assert.deepEqual(Object.keys(body).sort(), ['ref', 'sha']);
      if (options.refCreateRace || options.refCreateRaceStored) {
        stored = options.refCreateRaceStored ?? stored;
        published = true;
        return response({ message: 'Reference already exists' }, 422);
      }
      published = true; return response({ ref: body.ref, object: { sha: PUBLICATION } }, 201);
    }
    throw new Error(`unexpected ${route}`);
  };
  const execute = (command, stdout = stream(), stderr = stream()) => runAuthority([
    command, `--event=${eventPath}`, '--policy=policy.json',
    ...(command === 'issue-github' ? ['--repository=github.com/example/evidence', '--run-id=101'] : []),
  ], { env, fetchImpl, now: () => NOW, stdout, stderr }).then((code) => ({ code, stdout, stderr }));
  return { source, env, calls, fetchImpl, eventPath, policyPath: join(root, 'policy.json'),
    run: (stdout, stderr) => execute('issue-github', stdout, stderr),
    validate: (stdout, stderr) => execute('validate-event', stdout, stderr) };
}

export { hash, HEAD, WORKFLOW, TARGET_BASE, TARGET_HEAD, PARENT, BASE_TREE, EVIDENCE_TREE, BLOB, PUBLICATION, MERGE, LIVE_TARGET, TARGET_TREE, STARTED, COMPLETED, COMMITTED, NOW, RUN, candidate, dispatch, policy, effectivePolicy, response, ambientMetadata, githubUserMetadata, content, commit, stream, sandbox, rule, fixture };
