/** Exact local completion preflight. No provider call, fetch, authority or effect. */
import { currentBranch, headSha, observeGit } from '../src/git.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
import { integrationProof } from '../src/patch-identity.mjs';
import { worktreeFor } from '../src/worktree.mjs';
import { validateGitHubTransitionPolicy } from '../src/github-transition-policy.mjs';

const AUTHORITY_POLICY = '.github/adlc-authority-policy.json';
const TRANSITION_POLICY = '.agentic-os/github-transition-policy.json';
const AUTHORITY_WORKFLOW = '.github/workflows/adlc-authority.yml';
const TRANSITION_WORKFLOW = '.github/workflows/adlc-transition.yml';
const read = (cwd, args) => observeGit(args, { cwd, allowFail: true, maxBuffer: 16384 });

function committed(root, revision, path) {
  return read(root, ['show', `${revision}:${path}`]);
}

function enrollment(root, revision, repository) {
  const transitionBytes = committed(root, revision, TRANSITION_POLICY);
  if (transitionBytes === null) return { authorityRepository: null, localPolicyCandidate: false,
    files: {}, findings: [{ code: 'authority-repository-unresolved', owner: 'authority-operator',
      action: 'Identify an approved authority repository whose committed policy selects this target; local target files are not required.' }] };
  let transition;
  try {
    transition = validateGitHubTransitionPolicy(JSON.parse(transitionBytes));
    if (!transition.targetRepositories.includes(repository)) throw new Error('target not selected');
  } catch {
    return { authorityRepository: null, localPolicyCandidate: false, files: {},
      findings: [{ code: 'transition-policy-invalid-or-target-unselected', path: TRANSITION_POLICY,
        owner: 'authority-operator', action: 'Review the committed authority policy and target identity.' }] };
  }
  if (transition.authorityRepository !== repository)
    return { authorityRepository: transition.authorityRepository, localPolicyCandidate: false, files: {},
      findings: [{ code: 'external-authority-unverified', owner: 'authority-operator',
        action: 'Verify the selected authority repository, policy and workflow at their live trust root.' }] };
  const files = [AUTHORITY_POLICY, TRANSITION_POLICY, AUTHORITY_WORKFLOW, TRANSITION_WORKFLOW];
  const present = Object.fromEntries(files.map((path) => [path, committed(root, revision, path) !== null]));
  const findings = files.filter((path) => !present[path]).map((path) => ({
    code: 'enrollment-file-missing', path, owner: 'repository-author',
    action: 'Enroll the reviewed authority or transition workflow through protected source integration.',
  }));
  if (present[AUTHORITY_POLICY]) {
    try {
      const candidate = JSON.parse(committed(root, revision, AUTHORITY_POLICY));
      if (typeof candidate.targetRepositoryPrefix !== 'string'
        || !repository.startsWith(candidate.targetRepositoryPrefix)
        || candidate.workflowPath !== AUTHORITY_WORKFLOW) throw new Error('target not selected');
    } catch {
      findings.push({ code: 'authority-policy-invalid-or-target-unselected', path: AUTHORITY_POLICY,
        owner: 'repository-author', action: 'Review the committed policy and target identity.' });
    }
  }
  if (transition.workflowPath !== TRANSITION_WORKFLOW)
    findings.push({ code: 'transition-workflow-mismatch', path: TRANSITION_WORKFLOW,
      owner: 'authority-operator', action: 'Align the committed transition policy and workflow path.' });
  return { authorityRepository: repository, files: present,
    localPolicyCandidate: findings.length === 0, findings };
}

export function inspectCompletionStatus(root, ref, policy, profile) {
  if (!isLaneRef(ref)) throw Object.assign(new TypeError('completion requires an exact lane ref'),
    { reason: 'blocked-invalid-lane-ref' });
  if (currentBranch(root) !== policy.protectedBranch)
    throw Object.assign(new Error('completion status runs from the canonical checkout'),
      { reason: 'blocked-canonical-required' });
  const canonical = headSha(profile.canonical.localRef, root);
  const tracking = headSha(profile.canonical.remoteRef, root);
  const lane = worktreeFor(ref, root);
  const laneHead = headSha(`refs/heads/${ref}`, root);
  const canonicalClean = read(root, ['status', '--porcelain', '--untracked-files=all']) === '';
  const laneClean = lane ? read(lane.path, ['status', '--porcelain', '--untracked-files=all']) === '' : null;
  const projection = laneHead && tracking ? integrationProof(tracking, laneHead, { cwd: root }) : null;
  const findings = [];
  if (!canonical || !tracking || canonical !== tracking || !canonicalClean)
    findings.push({ code: 'canonical-not-current-clean', owner: 'repository-operator',
      action: 'Fetch and use the separately governed canonical synchronization workflow; preserve local bytes.' });
  if (!lane || !laneHead) findings.push({ code: 'lane-unbound-or-ref-missing', owner: 'lane-owner',
    action: 'Recover the exact lane registration or ref before completion.' });
  else if (!laneClean) findings.push({ code: 'lane-dirty', owner: 'lane-owner',
    action: 'Preserve and resolve authored or untracked bytes before cleanup planning.' });
  if (laneHead && !projection) findings.push({ code: 'integration-not-classified', owner: 'review-owner',
    action: 'Run reap for this ref and complete the protected PR; a local match is not merge authority.' });
  const enrolled = canonical ? enrollment(root, canonical, profile.repository) : null;
  if (enrolled) findings.push(...enrolled.findings);
  findings.push({ code: 'provider-authority-unverified', owner: 'authority-operator',
    action: 'Follow CLEANUP-AUTHORITY.md: bind the exact PR, checks, protection, issuance, integration and retirement winners.' });
  findings.push({ code: 'cleanup-receipt-unverified', owner: 'cleanup-operator',
    action: 'After live winner replay, assess and execute only the authorized exact quarantine plan.' });
  return { schema: 'agentic-os/completion-status/v1', observationOnly: true, grantsAuthority: false,
    authorizesEffects: false, providerVerified: false, cleanupVerified: false,
    ref, repository: profile.repository, profileDigest: profile.profileDigest,
    canonicalRevision: canonical, remoteTrackingRevision: tracking, canonicalClean,
    lane: { path: lane?.path ?? null, head: laneHead, clean: laneClean },
    integration: projection ? { kind: projection.kind, pathCount: projection.pathCount ?? null } : null,
    enrollment: enrolled ? { authorityRepository: enrolled.authorityRepository,
      files: enrolled.files, localPolicyCandidate: enrolled.localPolicyCandidate } : null,
    findings };
}

export function runCompletionStatus(root, ref, policy, profile, out = console.log) {
  out(JSON.stringify(inspectCompletionStatus(root, ref, policy, profile)));
  return 0;
}
