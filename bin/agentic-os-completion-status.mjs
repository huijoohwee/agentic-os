/** Exact local completion preflight. No provider call, fetch, authority or effect. */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonDir, currentBranch, headSha, observeGit } from '../src/git.mjs';
import { isLaneRef } from '../src/lane-id.mjs';
import { integrationProof } from '../src/patch-identity.mjs';
import { worktreeFor } from '../src/worktree.mjs';
import { validateGitHubTransitionPolicy } from '../src/github-transition-policy.mjs';
const AUTHORITY_POLICY = '.github/adlc-authority-policy.json', TRANSITION_POLICY = '.agentic-os/github-transition-policy.json';
const AUTHORITY_WORKFLOW = '.github/workflows/adlc-authority.yml', TRANSITION_WORKFLOW = '.github/workflows/adlc-transition.yml';
const read = (cwd, args) => observeGit(args, { cwd, allowFail: true, maxBuffer: 16384 });
const committed = (root, revision, path) => read(root, ['show', `${revision}:${path}`]);
const finding = (code, owner, action) => ({ code, owner, action });
const quarantines = (p) => p?.cleanup?.worktreeProjection === 'quarantine' && p?.cleanup?.worktreeRegistration === 'quarantine';
function observeQuarantinedLane(root, ref) {
  try {
    const base = join(commonDir(root), 'agentic-os-cleanup-quarantine'), names = readdirSync(base), stat = lstatSync(base);
    const expected = `ref: refs/heads/${ref}\n`;
    if (!stat.isDirectory() || stat.isSymbolicLink() || names.length > 32) return false;
    return names.some((name) => {
      if (!/^[0-9a-f]{64}$/u.test(name)) return false;
      try {
        const registration = join(base, name, 'registration'), head = join(registration, 'HEAD');
        const p = lstatSync(join(base, name, 'projection')), r = lstatSync(registration), h = lstatSync(head);
        return p.isDirectory() && !p.isSymbolicLink() && r.isDirectory() && !r.isSymbolicLink()
          && h.isFile() && !h.isSymbolicLink() && h.size <= 256 && readFileSync(head, 'utf8') === expected;
      } catch { return false; }
    });
  } catch { return false; }
}
function deployBound(root, revision) {
  const bytes = revision ? committed(root, revision, '.agentic-os-flight.json') : null;
  try {
    const value = bytes ? JSON.parse(bytes) : null;
    return Boolean(value) && [...value.operations ?? [], ...(value.checks ?? []).flatMap((item) => item?.operations ?? [])].includes('production-activation');
  } catch { return false; }
}
function enrollFail(code, owner, action, extra = {}) {
  return { authorityRepository: extra.authorityRepository ?? null, localPolicyCandidate: false, files: extra.files ?? {}, findings: [finding(code, owner, action)] };
}
function enrollment(root, revision, repository) {
  const transitionBytes = committed(root, revision, TRANSITION_POLICY);
  if (transitionBytes === null) return enrollFail('authority-repository-unresolved', 'authority-operator', 'Identify an approved authority repository whose committed policy selects this target; local target files are not required.');
  let transition;
  try {
    transition = validateGitHubTransitionPolicy(JSON.parse(transitionBytes));
    if (!transition.targetRepositories.includes(repository)) throw new Error('target not selected');
  } catch { return enrollFail('transition-policy-invalid-or-target-unselected', 'authority-operator', 'Review the committed authority policy and target identity.'); }
  if (transition.authorityRepository !== repository) return enrollFail('external-authority-unverified', 'authority-operator', 'Verify the selected authority repository, policy and workflow at their live trust root.', { authorityRepository: transition.authorityRepository });
  const files = [AUTHORITY_POLICY, TRANSITION_POLICY, AUTHORITY_WORKFLOW, TRANSITION_WORKFLOW];
  const present = Object.fromEntries(files.map((path) => [path, committed(root, revision, path) !== null]));
  const findings = files.filter((path) => !present[path]).map((path) => finding('enrollment-file-missing', 'repository-author', 'Enroll the reviewed authority or transition workflow through protected source integration.'));
  if (present[AUTHORITY_POLICY]) {
    try {
      const candidate = JSON.parse(committed(root, revision, AUTHORITY_POLICY));
      if (typeof candidate.targetRepositoryPrefix !== 'string' || !repository.startsWith(candidate.targetRepositoryPrefix) || candidate.workflowPath !== AUTHORITY_WORKFLOW) throw new Error('target not selected');
    } catch { findings.push(finding('authority-policy-invalid-or-target-unselected', 'repository-author', 'Review the committed policy and target identity.')); }
  }
  if (transition.workflowPath !== TRANSITION_WORKFLOW) findings.push(finding('transition-workflow-mismatch', 'authority-operator', 'Align the committed transition policy and workflow path.'));
  return { authorityRepository: repository, files: present, localPolicyCandidate: findings.length === 0, findings };
}
export function deriveCloseoutVerdict({ sourceIntegrated, canonicalCurrent, laneMounted, laneClean, laneHead, quarantineProfile, quarantineObserved, deployBound: deploy, localPolicyCandidate, findingCodes }) {
  const has = (code) => findingCodes.includes(code), blocked = has('lane-ref-missing') || has('lane-dirty');
  const laneDisposition = blocked ? 'blocked' : quarantineObserved ? 'quarantined' : quarantineProfile && laneMounted ? 'awaiting-cleanup' : !quarantineProfile && laneMounted ? 'retained' : laneHead && !laneMounted ? 'unmounted' : 'blocked';
  const cleanupSatisfied = !quarantineProfile && laneMounted && laneClean !== false || quarantineObserved === true;
  const sourceComplete = sourceIntegrated && canonicalCurrent && cleanupSatisfied && !blocked;
  const next = has('lane-dirty') ? ['preserve-lane-bytes', 'lane-owner', 'Preserve and resolve authored or untracked bytes before cleanup planning.'] : has('lane-ref-missing') ? ['recover-lane-ref', 'lane-owner', 'Recover the exact local lane ref before completion.'] : has('integration-not-classified') ? ['reap', 'review-owner', 'npm run reap -- --ref=<lane>'] : laneDisposition === 'awaiting-cleanup' && localPolicyCandidate ? ['completion-close', 'authority-operator', 'npm run completion:scaffold -- --ref=<lane>'] : laneDisposition === 'awaiting-cleanup' ? ['release-common-complete', 'cleanup-operator', 'npm run release:common -- complete --ref=<lane>'] : has('canonical-not-current-clean') ? ['canonical-sync-plan', 'repository-operator', 'npm run sync:canonical -- plan'] : sourceComplete && deploy ? ['deploy-workflow', 'product-owner', 'Follow guides/DEPLOY-WORKFLOW.md for the enrolled production-activation checks.'] : null;
  return Object.freeze({ schema: 'agentic-os/closeout-verdict/v1', observationOnly: true, authorizesEffects: false, sourceIntegrated: sourceIntegrated === true, canonicalCurrent: canonicalCurrent === true, laneDisposition, cleanupSatisfied, deployBinding: Object.freeze({ present: deploy === true, operation: deploy ? 'production-activation' : null }), missionState: blocked ? 'blocked' : sourceComplete ? 'source_complete' : 'continuable', nextAction: next ? Object.freeze({ id: next[0], owner: next[1], command: next[2] }) : null });
}
export function inspectCompletionStatus(root, ref, policy, profile) {
  if (!isLaneRef(ref)) throw Object.assign(new TypeError('completion requires an exact lane ref'), { reason: 'blocked-invalid-lane-ref' });
  if (currentBranch(root) !== policy.protectedBranch) throw Object.assign(new Error('completion status runs from the canonical checkout'), { reason: 'blocked-canonical-required' });
  const canonical = headSha(profile.canonical.localRef, root), tracking = headSha(profile.canonical.remoteRef, root);
  const lane = worktreeFor(ref, root), laneHead = headSha(`refs/heads/${ref}`, root);
  const canonicalClean = read(root, ['status', '--porcelain', '--untracked-files=all']) === '';
  const lanePath = lane?.path ?? null, laneMounted = lanePath !== null;
  const laneClean = laneMounted ? read(lanePath, ['status', '--porcelain', '--untracked-files=all']) === '' : null;
  const projection = laneHead && tracking ? integrationProof(tracking, laneHead, { cwd: root }) : null;
  const quarantineProfile = quarantines(profile);
  const quarantineObserved = Boolean(laneHead) && !laneMounted && quarantineProfile && observeQuarantinedLane(root, ref);
  const findings = [];
  if (!canonical || !tracking || canonical !== tracking || !canonicalClean) findings.push(finding('canonical-not-current-clean', 'repository-operator', 'Fetch and use the separately governed canonical synchronization workflow; preserve local bytes.'));
  if (!laneHead) findings.push(finding('lane-ref-missing', 'lane-owner', 'Recover the exact local lane ref before completion.'));
  else if (!laneMounted && !quarantineObserved) findings.push(finding('lane-registration-detached', 'lane-owner', 'Rebind the exact lane worktree path before cleanup planning.'));
  else if (laneMounted && !laneClean) findings.push(finding('lane-dirty', 'lane-owner', 'Preserve and resolve authored or untracked bytes before cleanup planning.'));
  if (laneHead && !projection) findings.push(finding('integration-not-classified', 'review-owner', 'Run reap for this ref and complete the protected PR; a local match is not merge authority.'));
  const enrolled = canonical ? enrollment(root, canonical, profile.repository) : null;
  if (enrolled) findings.push(...enrolled.findings);
  if (quarantineProfile && !quarantineObserved && enrolled?.localPolicyCandidate) findings.push(finding('provider-authority-unverified', 'authority-operator', 'Follow CLEANUP-AUTHORITY.md: bind the exact PR, checks, protection, issuance, integration and retirement winners.'));
  if (quarantineProfile && !quarantineObserved) findings.push(finding('cleanup-receipt-unverified', 'cleanup-operator', 'After live winner replay, assess and execute only the authorized exact quarantine plan.'));
  const closeout = deriveCloseoutVerdict({ sourceIntegrated: Boolean(projection), canonicalCurrent: Boolean(canonical && tracking && canonical === tracking && canonicalClean), laneMounted, laneClean, laneHead: Boolean(laneHead), quarantineProfile, quarantineObserved, deployBound: deployBound(root, canonical), localPolicyCandidate: enrolled?.localPolicyCandidate === true, findingCodes: findings.map((item) => item.code) });
  return { schema: 'agentic-os/completion-status/v1', observationOnly: true, grantsAuthority: false, authorizesEffects: false, providerVerified: false, cleanupVerified: quarantineObserved, ref, repository: profile.repository, profileDigest: profile.profileDigest, canonicalRevision: canonical, remoteTrackingRevision: tracking, canonicalClean, lane: { path: lanePath, mounted: laneMounted, head: laneHead, clean: laneClean }, integration: projection ? { kind: projection.kind, pathCount: projection.pathCount ?? null } : null, enrollment: enrolled ? { authorityRepository: enrolled.authorityRepository, files: enrolled.files, localPolicyCandidate: enrolled.localPolicyCandidate } : null, closeout, findings };
}
export function runCompletionStatus(root, ref, policy, profile, out = console.log) {
  out(JSON.stringify(inspectCompletionStatus(root, ref, policy, profile)));
  return 0;
}
