/** Exact local completion preflight. No provider call, fetch, authority or effect. */
import { currentBranch, headSha, isAncestor, observeGit } from '../src/git.mjs';
import { isLaneRef } from '../src/lane-id.mjs'; import { successorLineage } from '../src/lane-state.mjs';
import { integrationProof, successorIntegrationProof } from '../src/patch-identity.mjs';
import { worktreeFor } from '../src/worktree.mjs';
import { observeRetainedWorktreeQuarantine } from '../src/cleanup-quarantine.mjs';
import { verifySuccessorPreservation, readUserCleanupJson } from './agentic-os-cleanup-user.mjs';
import { validateGitHubTransitionPolicy } from '../src/github-transition-policy.mjs';
import { get as getLaneRecord } from '../src/lane-records.mjs';
const AUTHORITY_POLICY = '.github/adlc-authority-policy.json', TRANSITION_POLICY = '.agentic-os/github-transition-policy.json';
const AUTHORITY_WORKFLOW = '.github/workflows/adlc-authority.yml', TRANSITION_WORKFLOW = '.github/workflows/adlc-transition.yml';
const read = (cwd, args) => observeGit(args, { cwd, allowFail: true, maxBuffer: 16384 });
const committed = (root, revision, path) => read(root, ['show', `${revision}:${path}`]);
const finding = (code, owner, action) => ({ code, owner, action });
const quarantines = (p) => p?.cleanup?.worktreeProjection === 'quarantine' && p?.cleanup?.worktreeRegistration === 'quarantine';

/**
 * Classify whether a finding is applicable given the lane's change class.
 * Findings marked `applicable: false` are not blockers for low-risk change classes
 * (e.g., docs-only), where local consent is sufficient and the protected authority
 * chain is not required. This is observation-only classification; it does not
 * authorize effects or grant cleanup authority.
 */
const DOCS_ONLY_GLOBS = [/^docs\//u, /^guides\//u, /\.md$/u, /^AGENTS\.md$/u, /^README\.md$/u, /^DOCUMENTS\.md$/u, /^FLEET\.md$/u, /^PRD-.*\.md$/u];
function classifyChangeClass(root, ref) {
  const head = headSha(`refs/heads/${ref}`, root);
  if (!head) return 'unknown';
  const diff = observeGit(['diff', '--name-only', `refs/heads/main...${head}`], { cwd: root, allowFail: true, maxBuffer: 65536 });
  if (!diff) return 'unknown';
  const paths = diff.split('\n').filter(Boolean);
  if (paths.length === 0) return 'empty';
  const allDocs = paths.every((p) => DOCS_ONLY_GLOBS.some((re) => re.test(p)));
  return allDocs ? 'docs-only' : 'mixed';
}
const APPLICABILITY = Object.freeze({
  'docs-only': {
    'provider-authority-unverified': { applicable: false, reason: 'change-class: docs-only; local-consent sufficient per cleanup-user --no-ci' },
    'cleanup-receipt-unverified': { applicable: false, reason: 'change-class: docs-only; local-consent cleanup path available' },
  },
});
function withApplicability(findings, changeClass) {
  const table = APPLICABILITY[changeClass] ?? {};
  return findings.map((item) => {
    const entry = table[item.code];
    if (!entry) return { ...item, applicableToChangeClass: { applicable: true, changeClass } };
    return { ...item, applicableToChangeClass: { applicable: false, changeClass, reason: entry.reason } };
  });
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
export function deriveCloseoutVerdict({ sourceIntegrated, canonicalCurrent, laneMounted, laneClean, laneHead, quarantineProfile, quarantineObserved, preservationObserved = false, preservationDisposition = 'successor-preserved', deployBound: deploy, changeClass = 'unknown', localPolicyCandidate, findingCodes, lineagePredecessorRef = null }) {
  const has = (code) => findingCodes.includes(code), blocked = has('lane-ref-missing')
    || has('lane-dirty') || has('lane-dirty-state-unknown');
  const laneDisposition = blocked ? 'blocked' : preservationObserved ? preservationDisposition : quarantineObserved ? 'quarantined' : quarantineProfile && laneMounted ? 'awaiting-cleanup' : !quarantineProfile && laneMounted ? 'retained' : laneHead && !laneMounted ? 'unmounted' : 'blocked';
  const cleanupSatisfied = !blocked && (!quarantineProfile && laneMounted && laneClean !== false || quarantineObserved === true);
  const preservationSatisfied = preservationObserved === true;
  const sourceComplete = sourceIntegrated && canonicalCurrent && (cleanupSatisfied || preservationSatisfied) && !blocked;
  const assessDeliveryScope = sourceComplete && deploy && changeClass === 'docs-only';
  const next = has('lane-dirty-state-unknown') ? ['resolve-unknown-lane-bytes', 'lane-owner', 'Recover and verify the missing worktree bytes, or record an explicit owner disposition before closeout.']
    : has('lane-dirty') ? ['preserve-lane-bytes', 'lane-owner', 'Preserve and resolve authored or untracked bytes before cleanup planning.']
      : has('lane-ref-missing') ? ['recover-lane-ref', 'lane-owner', 'Recover the exact local lane ref before completion.']
        : has('predecessor-integration-not-classified') ? lineagePredecessorRef ? ['reap-predecessor', 'review-owner', `npm run reap -- --ref=${lineagePredecessorRef}`] : ['repair-successor-lineage', 'lane-owner', 'Repair the malformed successor lineage before closeout.']
        : has('integration-not-classified') ? ['reap', 'review-owner', 'npm run reap -- --ref=<lane>']
          : laneDisposition === 'awaiting-cleanup' && localPolicyCandidate ? ['completion-close', 'authority-operator', 'npm run completion:scaffold -- --ref=<lane>']
            : laneDisposition === 'awaiting-cleanup' ? ['release-common-complete', 'cleanup-operator', 'npm run release:common -- complete --ref=<lane>']
              : has('canonical-not-current-clean') ? ['canonical-sync-plan', 'repository-operator', 'npm run sync:canonical -- plan']
                : assessDeliveryScope ? ['assess-delivery-scope', 'product-owner', 'Check whether the exact documentation paths enter a deployed surface; retain product evidence before closing or deploying.']
                  : sourceComplete && preservationSatisfied ? ['verify-preservation-retirement', 'authority-operator', 'Verify the independently authenticated record-only retirement receipt before Full END ADLC.']
                    : sourceComplete && deploy ? ['deploy-workflow', 'product-owner', 'Follow guides/DEPLOY-WORKFLOW.md for the enrolled production-activation checks.'] : null;
  return Object.freeze({ schema: 'agentic-os/closeout-verdict/v1', observationOnly: true, authorizesEffects: false, sourceIntegrated: sourceIntegrated === true, canonicalCurrent: canonicalCurrent === true, laneDisposition, cleanupSatisfied, preservationSatisfied, deployBinding: Object.freeze({ present: deploy === true, operation: deploy ? 'production-activation' : null }), missionState: blocked ? 'blocked' : sourceComplete ? 'source_complete' : 'continuable', adlcState: blocked ? 'blocked' : sourceComplete && preservationSatisfied ? 'retirement_pending' : assessDeliveryScope ? 'delivery_scope_pending' : sourceComplete && deploy ? 'delivery_pending' : sourceComplete ? 'complete' : 'continuable', nextAction: next ? Object.freeze({ id: next[0], owner: next[1], command: next[2] }) : null });
}
export function inspectCompletionStatus(root, ref, policy, profile, { successor = null, preservationReceipt = null } = {}) {
  if (!isLaneRef(ref)) throw Object.assign(new TypeError('completion requires an exact lane ref'), { reason: 'blocked-invalid-lane-ref' });
  if (currentBranch(root) !== policy.protectedBranch) throw Object.assign(new Error('completion status runs from the canonical checkout'), { reason: 'blocked-canonical-required' });
  const canonical = headSha(profile.canonical.localRef, root), tracking = headSha(profile.canonical.remoteRef, root);
  const lane = worktreeFor(ref, root), laneHead = headSha(`refs/heads/${ref}`, root), laneRecord = getLaneRecord(ref, root), unknownDirtyState = laneRecord?.recovery?.dirtyState === 'unobservable-at-missing-path', lineage = successorLineage(laneRecord);
  const canonicalClean = read(root, ['status', '--porcelain', '--untracked-files=all']) === '';
  const lanePath = lane?.path ?? null, laneMounted = lanePath !== null;
  const laneClean = laneMounted ? read(lanePath, ['status', '--porcelain', '--untracked-files=all']) === '' : null;
  const preservation = preservationReceipt ? verifySuccessorPreservation(root, preservationReceipt, { localOnly: true }) : null;
  if (preservation && (laneMounted || (preservation.adoption.predecessorRef ?? preservation.adoption.targetRef) !== ref
    || (preservation.adoption.predecessorHead ?? preservation.adoption.targetHead) !== laneHead)) throw new TypeError('preservation does not bind this lane');
  successor ??= preservation?.adoption.predecessorRef ? { ...preservation.adoption, reviewedHead: preservation.adoption.successorHead,
    predecessorHead: preservation.adoption.predecessorHead, replacedPaths: preservation.adoption.replacedPaths } : null;
  const direct = laneHead && tracking ? integrationProof(tracking, laneHead, { cwd: root }) : null;
  const historical = !direct && successor && laneHead === successor.predecessorHead
    && tracking && read(root, ['merge-base', '--is-ancestor', successor.merge, tracking]) === ''
    ? successorIntegrationProof(successor.merge, laneHead, successor.reviewedHead,
      successor.replacedPaths, { cwd: root }) : null;
  const predecessorRetained = Boolean(lineage && lineage !== false && laneHead && isAncestor(lineage.predecessorHead, laneHead, root)), predecessorIntegration = lineage && lineage !== false && tracking && !predecessorRetained ? integrationProof(tracking, lineage.predecessorHead, { cwd: root }) : null, unverifiedLineage = lineage === false || lineage !== null && !predecessorRetained && !predecessorIntegration, projection = unverifiedLineage ? null : direct ?? historical;
  const quarantineProfile = quarantines(profile);
  const quarantineObserved = Boolean(laneHead) && !laneMounted && observeRetainedWorktreeQuarantine(root, ref, laneHead);
  const changeClass = classifyChangeClass(root, ref);
  const findings = [];
  if (!canonical || !tracking || canonical !== tracking || !canonicalClean) findings.push(finding('canonical-not-current-clean', 'repository-operator', 'Fetch and use the separately governed canonical synchronization workflow; preserve local bytes.'));
  if (!laneHead) findings.push(finding('lane-ref-missing', 'lane-owner', 'Recover the exact local lane ref before completion.'));
  else if (!laneMounted && !quarantineObserved && !preservation) findings.push(finding('lane-registration-detached', 'lane-owner', 'Rebind the exact lane worktree path before cleanup planning.'));
  else if (laneMounted && !laneClean) findings.push(finding('lane-dirty', 'lane-owner', 'Preserve and resolve authored or untracked bytes before cleanup planning.'));
  if (unknownDirtyState) findings.push(finding('lane-dirty-state-unknown', 'lane-owner', 'The worktree was reconstructed from the retained ref; recover or explicitly disposition bytes that may have existed only in the missing checkout.'));
  if (laneHead && !projection) findings.push(finding('integration-not-classified', 'review-owner', 'Run reap for this ref and complete the protected PR; a local match is not merge authority.'));
  if (unverifiedLineage) findings.push(finding('predecessor-integration-not-classified', 'review-owner', lineage && lineage !== false ? `Run reap for predecessor ${lineage.predecessorRef}; the current successor's own integration does not prove that source content was retained.` : 'Repair the malformed successor lineage before closeout.'));
  const enrolled = canonical ? enrollment(root, canonical, profile.repository) : null;
  if (enrolled) findings.push(...enrolled.findings);
  if (quarantineProfile && !quarantineObserved && !preservation && enrolled?.localPolicyCandidate) findings.push(finding('provider-authority-unverified', 'authority-operator', 'Follow CLEANUP-AUTHORITY.md: bind the exact PR, checks, protection, issuance, integration and retirement winners.'));
  if (quarantineProfile && !quarantineObserved && !preservation) findings.push(finding('cleanup-receipt-unverified', 'cleanup-operator', 'After live winner replay, assess and execute only the authorized exact quarantine plan.'));
  if (preservation) findings.push(finding('provider-retirement-unverified', 'authority-operator',
    'Source preservation is locally verified; bind the independent live record-only retirement receipt before Full END ADLC.'));
  const classifiedFindings = withApplicability(findings, changeClass);
  const closeout = deriveCloseoutVerdict({ sourceIntegrated: Boolean(projection), canonicalCurrent: Boolean(canonical && tracking && canonical === tracking && canonicalClean), laneMounted, laneClean, laneHead: Boolean(laneHead), quarantineProfile, quarantineObserved, preservationObserved: Boolean(preservation), preservationDisposition: preservation?.disposition, deployBound: deployBound(root, canonical), changeClass, localPolicyCandidate: enrolled?.localPolicyCandidate === true, findingCodes: classifiedFindings.map((item) => item.code), lineagePredecessorRef: lineage && lineage !== false ? lineage.predecessorRef : null });
  return { schema: 'agentic-os/completion-status/v1', observationOnly: true, grantsAuthority: false, authorizesEffects: false, providerVerified: false, cleanupVerified: quarantineObserved, preservationDispositionVerified: Boolean(preservation),
    preservationSatisfied: Boolean(preservation), preservationReceiptDigest: preservation?.receiptDigest ?? null, ref, repository: profile.repository, profileDigest: profile.profileDigest, changeClass, canonicalRevision: canonical, remoteTrackingRevision: tracking, canonicalClean, lane: { path: lanePath, mounted: laneMounted, head: laneHead, clean: laneClean, dirtyState: unknownDirtyState ? 'unobservable-at-missing-path' : laneMounted ? laneClean ? 'clean' : 'dirty' : 'unobserved' }, lineage: lineage === false ? { valid: false, predecessorRef: null, predecessorHead: null, retainedBySuccessor: false, integrated: false } : lineage ? { valid: true, predecessorRef: lineage.predecessorRef, predecessorHead: lineage.predecessorHead, retainedBySuccessor: predecessorRetained, integrated: Boolean(predecessorIntegration || predecessorRetained && direct) } : null, integration: projection ? { kind: projection.kind, pathCount: projection.pathCount ?? null, ...(historical ? { reviewedHead: historical.reviewedHead, merge: historical.merge, replacements: historical.replacements.map(row => row.path) } : {}) } : null, enrollment: enrolled ? { authorityRepository: enrolled.authorityRepository, files: enrolled.files, localPolicyCandidate: enrolled.localPolicyCandidate } : null, closeout, findings: classifiedFindings };
}
export function runCompletionStatus(root, ref, policy, profile, out = console.log, { preservationPath = null } = {}) {
  const preservationReceipt = preservationPath ? readUserCleanupJson(preservationPath, 'preservation-receipt') : null;
  out(JSON.stringify(inspectCompletionStatus(root, ref, policy, profile, { preservationReceipt })));
  return 0;
}
