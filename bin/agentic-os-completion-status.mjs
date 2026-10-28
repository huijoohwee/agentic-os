/** Exact local completion preflight. No provider call, fetch, authority or effect. */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs'; import { isAbsolute, join } from 'node:path'; import { commonDir, currentBranch, headSha, isAncestor, observeGit, repoRoot, worktrees } from '../src/git.mjs'; import { privateDirectoryIdentity } from '../src/file-integrity.mjs'; import { trustedRepositoryProfile } from './agentic-os-auxiliary.mjs';
import { isLaneRef } from '../src/lane-id.mjs'; import { successorLineage } from '../src/lane-state.mjs';
import { integrationProof, successorIntegrationProof } from '../src/patch-identity.mjs';
import { observeRetainedQuarantineEvidence, observeRetainedWorktreeQuarantine, observeDiscardedQuarantineEvidence } from '../src/cleanup-quarantine.mjs';
import { verifySuccessorPreservation, readUserCleanupJson } from './agentic-os-cleanup-user.mjs';
import { validateGitHubTransitionPolicy } from '../src/github-transition-policy.mjs';
import { get as getLaneRecord } from '../src/lane-records.mjs';
import { governanceDigest } from '../src/governance.mjs';
import { DELIVERY_DISPOSITION_SET_PATH, bindRetirementOperationReceipts,
  validateDeliveryDispositionSet } from '../src/completion.mjs';
import { WORKTREE_CLEANUP_RECEIPT_SCHEMA } from '../src/cleanup-records.mjs';
const AUTHORITY_POLICY = '.github/adlc-authority-policy.json', TRANSITION_POLICY = '.agentic-os/github-transition-policy.json', AUTHORITY_WORKFLOW = '.github/workflows/adlc-authority.yml', TRANSITION_WORKFLOW = '.github/workflows/adlc-transition.yml';
const read = (cwd, args) => observeGit(args, { cwd, allowFail: true, maxBuffer: 131072 }), committed = (root, revision, path) => observeGit(['show', `${revision}:${path}`], { cwd: root, allowFail: true, raw: true, encoding: 'utf8', maxBuffer: 131072 });
export const retirementReviewLocator = (repository, laneRecord, preservationReceipt) => {
  const path = typeof repository === 'string' ? repository.replace(/^github\.com\//u, '') : '', lane = Number.isSafeInteger(laneRecord?.pr) && laneRecord.pr > 0 ? `https://github.com/${path}/pull/${laneRecord.pr}` : null, preserved = preservationReceipt?.adoption?.reviewLocator ?? null, locator = lane ?? preserved, match = typeof locator === 'string' ? /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)\/pull\/([1-9][0-9]*)$/u.exec(locator) : null; if (!/^[^/?#]+\/[^/?#]+$/u.test(path) || !match || match[1] !== path || lane && preserved !== lane) throw new TypeError('exact review locator is unavailable or inconsistent'); return locator;
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex'), lanePaths = (root, branch, head) => { const output = observeGit(['diff', '--name-only', '-z', '--no-renames', `refs/heads/${branch}...${head}`], { cwd: root, allowFail: true, raw: true, encoding: 'utf8', maxBuffer: 131072 }); return output === null ? null : output.split('\0').filter(Boolean).sort(); };
function sourceSupersessionReceipt(root, ref, profile, laneHead, record) {
  const directory = join(commonDir(root), 'agentic-os-supersessions'), path = join(directory, `${sha256(ref)}.json`); if (!lstatSync(path, { throwIfNoEntry: false })) return { receipt: null, error: null };
  try {
    const r = readUserCleanupJson(path, 'source-supersession', privateDirectoryIdentity(directory)), { receiptDigest, ...payload } = r, s = r.successor,
      changed = observeGit(['diff', '--name-only', '-z', '--no-renames', `${record?.baseSha}...${laneHead}`], { cwd: root, allowFail: true, raw: true, encoding: 'utf8', maxBuffer: 131072 })?.split('\0').filter(Boolean).sort();
    const valid = r.schema === 'agentic-os/cross-repository-supersession-receipt/v1' && receiptDigest === governanceDigest(payload) && r.repository === profile.repository && r.profileDigest === profile.profileDigest && r.ref === ref && r.sourceBase === record?.baseSha && r.head === laneHead && r.worktree === record?.worktree && r.sourceIntegrated === false && r.sourceSuperseded === true && r.providerAuthority === false && r.claimRetired === false && r.archivePrivate === true && r.archiveArchived === true && JSON.stringify(r.changedPaths) === JSON.stringify(changed) && JSON.stringify(r.replacedPaths) === JSON.stringify(changed) && typeof r.reason === 'string' && r.reason.trim().length >= 12 && /^[a-f0-9]{40}$/u.test(s?.merge ?? '') && s?.branch === ref && Number.isSafeInteger(s?.pr) && Array.isArray(s?.checks) && s.checks.length > 0 && s.checks.every(check => check?.conclusion === 'success') && record?.state === 'active' && record?.pr === null;
    return valid ? { receipt: r, error: null } : { receipt: null, error: 'invalid' };
  } catch { return { receipt: null, error: 'invalid' }; }
}
const finding = (code, owner, action) => ({ code, owner, action }), quarantines = p => p?.cleanup?.worktreeProjection === 'quarantine' && p?.cleanup?.worktreeRegistration === 'quarantine', observeBranchDisposition = (root, ref, laneHead, profile) => { const remote = /^refs\/remotes\/([^/]+)\//u.exec(profile.canonical.remoteRef ?? '')?.[1] ?? null, remoteTrackingRef = remote ? `refs/remotes/${remote}/${ref}` : null, remoteTrackingHead = remoteTrackingRef ? headSha(remoteTrackingRef, root) : null, cleanup = profile.cleanup ?? {}; return Object.freeze({ schema: 'agentic-os/branch-disposition/v1', policy: Object.freeze({ localBranch: cleanup.localBranch ?? 'retain', remoteBranch: cleanup.remoteBranch ?? 'retain', remoteTrackingRef: cleanup.remoteTrackingRef ?? 'retain', unreachableObjects: cleanup.unreachableObjects ?? 'retain' }), localRef: Object.freeze({ ref: `refs/heads/${ref}`, state: laneHead ? 'present' : 'absent', head: laneHead ?? null }), remoteTrackingRef: Object.freeze({ ref: remoteTrackingRef, state: remoteTrackingRef ? remoteTrackingHead ? 'present' : 'absent' : 'unavailable', head: remoteTrackingHead }), liveRemoteState: 'not-observed', deletionReceiptDigest: null }); };

const DOCS_ONLY_GLOBS = [/^docs\//u, /^guides\//u, /\.md$/u, /^AGENTS\.md$/u, /^README\.md$/u, /^DOCUMENTS\.md$/u, /^FLEET\.md$/u, /^PRD-.*\.md$/u];
function classifyChangeClass(root, ref) {
  const head = headSha(`refs/heads/${ref}`, root); if (!head) return 'unknown'; const diff = observeGit(['diff', '--name-only', `refs/heads/main...${head}`], { cwd: root, allowFail: true, maxBuffer: 65536 }); if (!diff) return 'unknown';
  const paths = diff.split('\n').filter(Boolean); return paths.length === 0 ? 'empty' : paths.length === 1 && paths[0] === DELIVERY_DISPOSITION_SET_PATH ? 'control-ledger-only' : paths.some(p => p.startsWith('docs/reports/')) && paths.every(p => p === DELIVERY_DISPOSITION_SET_PATH || p.startsWith('docs/reports/')) ? 'delivery-evidence-only' : paths.every(p => DOCS_ONLY_GLOBS.some(re => re.test(p))) ? 'docs-only' : 'mixed';
}
const APPLICABILITY = Object.freeze({ 'docs-only': { 'provider-authority-unverified': { applicable: false, reason: 'change-class: docs-only; local-consent sufficient per cleanup-user --no-ci' }, 'cleanup-receipt-unverified': { applicable: false, reason: 'change-class: docs-only; local-consent cleanup path available' } } });
const controlLedgerProof = row => row?.disposition === 'no-deploy' && row.evidencePath !== DELIVERY_DISPOSITION_SET_PATH && /excluded from (?:the )?product artifact/iu.test(row.reason);
function localCleanupReceipt(cleanupReceipt, ref, laneHead, laneRecord) {
  return cleanupReceipt?.schema === 'agentic-os/user-cleanup-receipt/v1' && cleanupReceipt.mode === 'explicit-local-user-consent-recovery'
    && cleanupReceipt.review?.branch === ref && cleanupReceipt.targetPath === laneRecord?.worktree ? cleanupReceipt : null;
}
const cleanupObserved = (root, ref, laneHead, laneRecord, cleanupReceipt, canonicalRef) => {
  return !laneHead ? false : cleanupReceipt?.schema === WORKTREE_CLEANUP_RECEIPT_SCHEMA
    ? cleanupReceipt.result === 'quarantined' && /^[0-9a-f]{64}$/u.test(cleanupReceipt.cleanupPlanDigest ?? '')
      && Boolean(observeRetainedQuarantineEvidence(root, ref, laneHead, cleanupReceipt.cleanupPlanDigest, { canonicalRef }))
    : observeRetainedWorktreeQuarantine(root, ref, laneHead, localCleanupReceipt(cleanupReceipt, ref, laneHead, laneRecord), canonicalRef);
};
function withApplicability(findings, changeClass) {
  const table = APPLICABILITY[changeClass] ?? {};
  return findings.map(item => { const entry = table[item.code]; return entry
    ? { ...item, applicableToChangeClass: { applicable: false, changeClass, reason: entry.reason } }
    : { ...item, applicableToChangeClass: { applicable: true, changeClass } }; });
}
function deployBound(root, revision) {
  const bytes = revision ? committed(root, revision, '.agentic-os-flight.json') : null;
  try { const value = bytes ? JSON.parse(bytes) : null; return Boolean(value) && [...value.operations ?? [], ...(value.checks ?? []).flatMap(item => item?.operations ?? [])].includes('production-activation'); } catch { return false; }
}
const enrollFail = (code, owner, action, extra = {}) => ({ authorityRepository: extra.authorityRepository ?? null, localPolicyCandidate: false, files: extra.files ?? {}, findings: [finding(code, owner, action)] });
function trustedAuthoritySource(targetRoot, targetRevision, repository, requestedRoot) { requestedRoot ??= process.env.AGENTIC_OS_AUTHORITY_ROOT ?? null; if (requestedRoot === null) return { root: targetRoot, revision: targetRevision, repository }; try { const root = realpathSync(requestedRoot), trusted = trustedRepositoryProfile(root), profile = trusted.profile, branch = /^refs\/heads\/([^/]+)$/u.exec(profile?.canonical?.localRef ?? '')?.[1], local = branch ? headSha(profile.canonical.localRef, root) : null;
  const current = isAbsolute(requestedRoot) && realpathSync(repoRoot(root)) === root && Boolean(branch) && profile.repository === trusted.trust.repository && currentBranch(root) === branch && local === trusted.revision && headSha(profile.canonical.remoteRef, root) === local && observeGit(['status', '--porcelain', '--untracked-files=all'], { cwd: root }) === ''; return current ? { root, revision: local, repository: profile.repository } : null; } catch { return null; } }
function enrollment(root, revision, repository, authorityRoot = null) { const source = trustedAuthoritySource(root, revision, repository, authorityRoot); if (!source) return enrollFail('authority-root-untrusted', 'authority-operator', 'Use an absolute trusted canonical authority checkout whose protected branch matches its remote-tracking ref and has no local changes.');
  const cache = new Map(); let cachedBytes = 0, readPolicy = (path) => { const key = `${source.revision}\0${path}`; if (cache.has(key)) return cache.get(key); const value = committed(source.root, source.revision, path), bytes = value === null ? 0 : Buffer.byteLength(value, 'utf8'); if (cache.size < 4 && bytes <= 64 * 1024 && cachedBytes + bytes <= 128 * 1024) { cache.set(key, value); cachedBytes += bytes; } return value; }, transitionBytes = readPolicy(TRANSITION_POLICY);
  if (transitionBytes === null) return enrollFail('authority-repository-unresolved', 'authority-operator', 'Identify an approved authority repository whose committed policy selects this target; local target files are not required.');
  let transition;
  try { transition = validateGitHubTransitionPolicy(JSON.parse(transitionBytes)); if (!transition.targetRepositories.includes(repository)) throw new Error('target not selected'); }
  catch { return enrollFail('transition-policy-invalid-or-target-unselected', 'authority-operator', 'Review the committed authority policy and target identity.'); }
  if (transition.authorityRepository !== source.repository) return enrollFail('external-authority-unverified', 'authority-operator', 'Verify that the selected authority repository identity matches the trusted policy root.', { authorityRepository: transition.authorityRepository });
  const files = [AUTHORITY_POLICY, TRANSITION_POLICY, AUTHORITY_WORKFLOW, TRANSITION_WORKFLOW];
  const present = Object.fromEntries(files.map((path) => [path, readPolicy(path) !== null]));
  const findings = files.filter((path) => !present[path]).map((path) => finding('enrollment-file-missing', 'repository-author', 'Enroll the reviewed authority or transition workflow through protected source integration.'));
  if (present[AUTHORITY_POLICY]) try { const candidate = JSON.parse(readPolicy(AUTHORITY_POLICY));
    if (typeof candidate.targetRepositoryPrefix !== 'string' || !repository.startsWith(candidate.targetRepositoryPrefix) || candidate.workflowPath !== AUTHORITY_WORKFLOW) throw new Error('target not selected');
  } catch { findings.push(finding('authority-policy-invalid-or-target-unselected', 'repository-author', 'Review the committed policy and target identity.')); }
  if (transition.workflowPath !== TRANSITION_WORKFLOW) findings.push(finding('transition-workflow-mismatch', 'authority-operator', 'Align the committed transition policy and workflow path.'));
  return { authorityRepository: source.repository, authorityRoot: source.root, authorityRevision: source.revision, files: present, localPolicyCandidate: findings.length === 0, findings };
}
export function deriveCloseoutVerdict({ sourceIntegrated, sourceSuperseded = false, canonicalCurrent, laneMounted, laneClean, laneHead, quarantineProfile, quarantineObserved, reservationReleased = false, preservationObserved = false, preservationDisposition = 'successor-preserved', recoveryDispositionSatisfied = false, lossDispositionVerified = false, retirementReceiptVerified = false, branchDisposition = null, deployBound: deploy, deliveryDisposition = null, deliveryDispositionInvalid = false, changeClass = 'unknown', localPolicyCandidate, findingCodes, lineagePredecessorRef = null }) {
  const has = code => findingCodes.includes(code), blocked = has('lane-ref-missing') || has('lane-dirty') || has('lane-dirty-state-unknown');
  const laneDisposition = blocked ? 'blocked' : sourceSuperseded ? 'superseded' : lossDispositionVerified ? 'current-quarantine-discard-acknowledged' : recoveryDispositionSatisfied ? 'retained-unrecoverable-accepted' : preservationObserved ? preservationDisposition : quarantineObserved ? 'quarantined' : reservationReleased ? 'released' : quarantineProfile && laneMounted ? 'awaiting-cleanup' : !quarantineProfile && laneMounted ? 'retained' : laneHead && !laneMounted ? 'unmounted' : 'blocked';
  const cleanupSatisfied = !blocked && (reservationReleased || (!quarantineProfile && laneMounted && laneClean === true) || quarantineObserved === true || lossDispositionVerified === true), preservationSatisfied = preservationObserved === true, retirementSatisfied = retirementReceiptVerified === true, authoredBytesAccountedFor = reservationReleased || (laneMounted && laneClean === true) || cleanupSatisfied || preservationSatisfied || recoveryDispositionSatisfied || lossDispositionVerified;
  const sourceSatisfied = sourceIntegrated || sourceSuperseded;
  const sourceComplete = sourceSatisfied && canonicalCurrent && authoredBytesAccountedFor && !blocked, retentionState = blocked ? 'blocked' : reservationReleased ? 'not-required' : quarantineObserved ? 'quarantined' : lossDispositionVerified ? 'discarded-with-ack' : recoveryDispositionSatisfied ? 'accepted-recovery' : preservationSatisfied ? 'preserved' : cleanupSatisfied ? 'retained' : quarantineProfile ? 'cleanup-pending' : 'not-required', missionComplete = sourceSatisfied && canonicalCurrent && (cleanupSatisfied || preservationSatisfied || recoveryDispositionSatisfied || lossDispositionVerified) && !blocked, sourceState = blocked ? 'blocked' : sourceComplete ? 'source_complete' : 'continuable', missionState = blocked ? 'blocked' : missionComplete ? 'source_complete' : 'continuable';
  const deliveryPending = sourceComplete && deploy && !deliveryDisposition, assessDeliveryScope = deliveryPending && changeClass === 'docs-only', deliveryState = deploy !== true ? 'not-required' : deliveryDispositionInvalid ? 'invalid' : !deliveryDisposition ? assessDeliveryScope ? 'scope-pending' : 'pending' : deliveryDisposition.disposition;
  const next = has('lane-dirty-state-unknown') ? ['resolve-unknown-lane-bytes', 'lane-owner', 'Recover and verify the missing worktree bytes, or record an explicit owner disposition before closeout.']
    : has('lane-dirty') ? ['preserve-lane-bytes', 'lane-owner', 'Preserve and resolve authored or untracked bytes before cleanup planning.']
      : has('lane-ref-missing') ? ['recover-lane-ref', 'lane-owner', 'Recover the exact local lane ref before completion.']
        : has('predecessor-integration-not-classified') ? lineagePredecessorRef ? ['reap-predecessor', 'review-owner', `npm run reap -- --ref=${lineagePredecessorRef}`] : ['repair-successor-lineage', 'lane-owner', 'Repair the malformed successor lineage before closeout.']
          : has('integration-not-classified') ? ['reap', 'review-owner', 'npm run reap -- --ref=<lane>']
            : laneDisposition === 'awaiting-cleanup' && localPolicyCandidate ? ['completion-close', 'authority-operator', 'npm run completion:scaffold -- --ref=<lane>']
              : laneDisposition === 'awaiting-cleanup' ? ['release-common-complete', 'cleanup-operator', 'npm run release:common -- complete --ref=<lane>']
                : has('canonical-not-current-clean') ? ['canonical-sync-plan', 'repository-operator', 'npm run sync:canonical -- plan']
                  : sourceComplete && deliveryDispositionInvalid ? ['repair-delivery-disposition', 'product-owner', 'Correct the committed product delivery disposition so its exact lane, candidate and evidence bindings validate.']
                    : assessDeliveryScope ? ['assess-delivery-scope', 'product-owner', 'Check whether the exact documentation paths enter a deployed surface; retain product evidence before closing or deploying.']
                      : sourceComplete && (preservationObserved || lossDispositionVerified) && !retirementSatisfied ? ['verify-preservation-retirement', 'authority-operator', 'Bind the exact integration and record-only retirement receipts with --integration-receipt and --retirement-receipt.']
                        : deliveryPending ? ['deploy-workflow', 'product-owner', 'Follow guides/DEPLOY-WORKFLOW.md and record exact Dev, Prod and Runtime delivery evidence before closeout.'] : null;
  return Object.freeze({ schema: 'agentic-os/closeout-verdict/v1', observationOnly: true, authorizesEffects: false, sourceIntegrated: sourceIntegrated === true, sourceSuperseded: sourceSuperseded === true, sourceDisposition: sourceIntegrated ? 'integrated' : sourceSuperseded ? 'superseded' : 'open', canonicalCurrent: canonicalCurrent === true, laneDisposition, cleanupSatisfied, sourceState, missionState, retentionState, deliveryState, preservationSatisfied, lossDispositionVerified, retirementSatisfied, branchDisposition, completionScope: deploy === true ? preservationObserved || lossDispositionVerified ? 'delivery-and-retirement-bound' : 'delivery-bound' : preservationObserved || lossDispositionVerified || retirementReceiptVerified ? 'retirement-bound' : sourceSuperseded ? 'supersession-bound' : 'source-only', deployBinding: Object.freeze({ present: deploy === true, operation: deploy ? 'production-activation' : null }), deliveryDisposition: deliveryDisposition ? Object.freeze({ disposition: deliveryDisposition.disposition, receiptDigest: deliveryDisposition.receiptDigest, setDigest: deliveryDisposition.setDigest }) : null, adlcState: blocked ? 'blocked' : sourceComplete && (preservationObserved || lossDispositionVerified) && !retirementSatisfied ? 'retirement_pending' : assessDeliveryScope ? 'delivery_scope_pending' : deliveryPending ? 'delivery_pending' : sourceComplete && retentionState === 'cleanup-pending' ? 'cleanup_pending' : sourceComplete ? 'complete' : 'continuable', nextAction: next ? Object.freeze({ id: next[0], owner: next[1], command: next[2] }) : null });
}
export function inspectCompletionStatus(root, ref, policy, profile, { successor = null, preservationReceipt = null, cleanupReceipt = null, integrationReceipt = null, retirementReceipt = null, retirementReceiptError = null, authorityRoot = null } = {}) {
  if (!isLaneRef(ref)) throw Object.assign(new TypeError('completion requires an exact lane ref'), { reason: 'blocked-invalid-lane-ref' });
  if (currentBranch(root) !== policy.protectedBranch) throw Object.assign(new Error('completion status runs from the canonical checkout'), { reason: 'blocked-canonical-required' });
  const canonical = headSha(profile.canonical.localRef, root), tracking = headSha(profile.canonical.remoteRef, root), canonicalClean = read(root, ['status', '--porcelain', '--untracked-files=all']) === '';
  const registrations = worktrees(root), lane = registrations.find(entry => entry.branch === ref) ?? null,
    laneHead = headSha(`refs/heads/${ref}`, root), laneRecord = getLaneRecord(ref, root), lineage = successorLineage(laneRecord), branchDisposition = observeBranchDisposition(root, ref, laneHead, profile);
  const lanePath = lane?.path ?? null, laneMounted = lanePath !== null, laneClean = laneMounted ? read(lanePath, ['status', '--porcelain', '--untracked-files=all']) === '' : null, recoveryDisposition = laneRecord?.recovery?.disposition, retainedPath = (() => { try { return realpathSync(laneRecord?.worktree); } catch { return null; } })(), retainedRegistration = registrations.find(entry => entry.path === retainedPath) ?? null, retainedHead = retainedRegistration ? headSha('HEAD', retainedRegistration.path) : null, retainedClean = Boolean(retainedRegistration && read(retainedRegistration.path, ['status', '--porcelain', '--untracked-files=all']) === ''), retainedCheckout = retainedRegistration ? { path: retainedRegistration.path, branch: retainedRegistration.branch, head: retainedHead, clean: retainedClean } : null;
  const quarantineProfile = quarantines(profile), quarantineObserved = Boolean(laneHead) && !laneMounted && cleanupObserved(root, ref, laneHead, laneRecord, cleanupReceipt, profile.canonical.localRef), discardedEvidence = Boolean(laneHead) && !laneMounted && cleanupReceipt?.schema === 'agentic-os/quarantine-retirement-receipt/v2' ? observeDiscardedQuarantineEvidence(root, ref, laneHead, cleanupReceipt.coordinate, { originalReceipt: cleanupReceipt }) : null;
  const reservationReleased = laneRecord?.state === 'integrated' && Array.isArray(laneRecord?.writePaths) && laneRecord.writePaths.length === 0;
  const acceptedMissingBytes = Boolean((retainedClean || quarantineObserved) && recoveryDisposition?.outcome === 'unrecoverable-accepted' && recoveryDisposition.ref === ref && recoveryDisposition.head === laneHead && recoveryDisposition.worktree === laneRecord?.worktree && recoveryDisposition.preserveCheckout === true && recoveryDisposition.preserveRef === true && recoveryDisposition.cleanupAuthorized === false && recoveryDisposition.deploymentAuthorized === false);
  const preservation = preservationReceipt ? verifySuccessorPreservation(root, preservationReceipt, { localOnly: true }) : null;
  const lossDispositionVerified = preservation?.disposition === 'current-quarantine-discard-acknowledged' || Boolean(discardedEvidence), lossDispositionReceiptDigest = preservation?.receiptDigest ?? (discardedEvidence ? cleanupReceipt.receiptDigest : null);
  const unknownDirtyState = laneRecord?.recovery?.dirtyState === 'unobservable-at-missing-path'
    && !acceptedMissingBytes && !lossDispositionVerified;
  if (preservation && ((laneMounted && preservation.disposition !== 'standalone-lane-retained') || (preservation.adoption.predecessorRef ?? preservation.adoption.targetRef) !== ref || (preservation.adoption.predecessorHead ?? preservation.adoption.targetHead) !== laneHead)) throw new TypeError('preservation does not bind this lane');
  successor ??= preservation?.adoption.predecessorRef ? { ...preservation.adoption, reviewedHead: preservation.adoption.successorHead,
    predecessorHead: preservation.adoption.predecessorHead, replacedPaths: preservation.adoption.replacedPaths } : null;
  let retirementReceiptBinding = null;
  if ((integrationReceipt === null) !== (retirementReceipt === null)) retirementReceiptError ??= 'receipt-pair-required';
  if (integrationReceipt !== null && retirementReceipt !== null && !retirementReceiptError) try {
    const reviewLocator = retirementReviewLocator(profile.repository, laneRecord, preservation);
    retirementReceiptBinding = bindRetirementOperationReceipts(integrationReceipt, retirementReceipt, {
      repository: profile.repository, reviewLocator, preservationReceipt: preservation,
    });
    if (!tracking || !isAncestor(retirementReceiptBinding.integratedRevision, tracking, root))
      throw new TypeError('retirement merge is not retained by current canonical source');
  } catch { retirementReceiptError = 'retirement-receipt-binding-invalid'; }
  const direct = laneHead && tracking ? integrationProof(tracking, laneHead, { cwd: root }) : null;
  const historical = !direct && successor && laneHead === successor.predecessorHead
    && tracking && read(root, ['merge-base', '--is-ancestor', successor.merge, tracking]) === ''
    ? successorIntegrationProof(successor.merge, laneHead, successor.reviewedHead,
      successor.replacedPaths, { cwd: root }) : null;
  const predecessorRetained = Boolean(lineage && lineage !== false && laneHead && isAncestor(lineage.predecessorHead, laneHead, root)), predecessorIntegration = lineage && lineage !== false && tracking && !predecessorRetained ? integrationProof(tracking, lineage.predecessorHead, { cwd: root }) ?? (successor?.predecessorRef === lineage.predecessorRef && successor?.predecessorHead === lineage.predecessorHead && read(root, ['merge-base', '--is-ancestor', successor.merge, tracking]) === '' ? successorIntegrationProof(successor.merge, lineage.predecessorHead, successor.reviewedHead, successor.replacedPaths, { cwd: root }) : null) : null, unverifiedLineage = lineage === false || lineage !== null && !predecessorRetained && !predecessorIntegration, projection = unverifiedLineage ? null : direct ?? historical;
  const supersession = sourceSupersessionReceipt(root, ref, profile, laneHead, laneRecord), sourceSuperseded = Boolean(!projection && lineage === null && supersession.receipt && laneMounted && laneClean === true && lanePath === laneRecord?.worktree);
  const changeClass = classifyChangeClass(root, ref);
  const dispositionBytes = canonical ? committed(root, canonical, DELIVERY_DISPOSITION_SET_PATH) : null;
  let deliveryDisposition = null, deliveryDispositionError = null;
  if (dispositionBytes !== null) try {
    const paths = laneHead && lanePaths(root, policy.protectedBranch, laneHead);
    if (!paths) throw Object.assign(new Error('lane paths unavailable'), { reason: 'blocked-delivery-disposition-lane-paths' });
    const set = JSON.parse(dispositionBytes), expected = { repository: profile.repository, ref, laneHead, paths, changeClass, deployBound: revision => deployBound(root, revision), candidateIsCurrent: revision => Boolean(canonical && isAncestor(revision, canonical, root)), laneIntegratedAtCandidate: (revision, head) => Boolean(integrationProof(revision, head, { cwd: root })), readEvidence: path => committed(root, canonical, path), sha256 };
    deliveryDisposition = validateDeliveryDispositionSet(set, expected);
    if (changeClass === 'control-ledger-only' && !deliveryDisposition) {
      const proof = set.dispositions.find(row => controlLedgerProof(row) && JSON.stringify(row.paths) === JSON.stringify([DELIVERY_DISPOSITION_SET_PATH])), proofPaths = proof && lanePaths(root, policy.protectedBranch, proof.laneHead), inherited = proof && validateDeliveryDispositionSet(set, { ...expected, ref: proof.ref, laneHead: proof.laneHead, paths: proofPaths });
      if (inherited) deliveryDisposition = Object.freeze({ ...inherited, ref, laneHead, paths, scopeRule: 'exact-control-ledger-artifact-exclusion', evidenceForRef: proof.ref });
    }
    if (deliveryDisposition && ((changeClass === 'control-ledger-only' || changeClass === 'delivery-evidence-only') && (deliveryDisposition.disposition !== 'no-deploy' || !controlLedgerProof(deliveryDisposition)))) throw Object.assign(new TypeError('delivery evidence no-deploy proof is incomplete'), { reason: `blocked-delivery-disposition-${changeClass === 'control-ledger-only' ? 'control-ledger' : 'evidence'}-exclusion-proof` });
  } catch (error) { deliveryDispositionError = error?.reason ?? 'blocked-delivery-disposition-invalid'; }
  const findings = [];
  if (!canonical || !tracking || canonical !== tracking || !canonicalClean) findings.push(finding('canonical-not-current-clean', 'repository-operator', 'Fetch and use the separately governed canonical synchronization workflow; preserve local bytes.'));
  if (!laneHead) findings.push(finding('lane-ref-missing', 'lane-owner', 'Recover the exact local lane ref before completion.'));
  else if (!laneMounted && !quarantineObserved && !reservationReleased && !preservation && !acceptedMissingBytes && !lossDispositionVerified) findings.push(finding('lane-registration-detached', 'lane-owner', 'Rebind the exact lane worktree path before cleanup planning.'));
  else if ((laneMounted && !laneClean) || (retainedCheckout && !retainedClean)) findings.push(finding('lane-dirty', 'lane-owner', 'Preserve and resolve authored or untracked bytes before cleanup planning.'));
  if (unknownDirtyState) findings.push(finding('lane-dirty-state-unknown', 'lane-owner', 'The worktree was reconstructed from the retained ref; recover or explicitly disposition bytes that may have existed only in the missing checkout.'));
  if (laneHead && !projection && !sourceSuperseded) findings.push(finding('integration-not-classified', 'review-owner', 'Run reap for this ref and complete the protected PR; a local match is not merge authority.'));
  if (supersession.error) findings.push(finding('source-supersession-receipt-invalid', 'lane-owner', 'Reconcile the exact supersession receipt with the unchanged lane, profile, and successor evidence.'));
  if (unverifiedLineage) findings.push(finding('predecessor-integration-not-classified', 'review-owner', lineage && lineage !== false ? `Run reap for predecessor ${lineage.predecessorRef}; the current successor's own integration does not prove that source content was retained.` : 'Repair the malformed successor lineage before closeout.'));
  const enrolled = canonical ? enrollment(root, canonical, profile.repository, authorityRoot) : null;
  if (enrolled) findings.push(...enrolled.findings);
  if (quarantineProfile && !quarantineObserved && !reservationReleased && !preservation && !acceptedMissingBytes && !lossDispositionVerified && enrolled?.localPolicyCandidate) findings.push(finding('provider-authority-unverified', 'authority-operator', 'Follow CLEANUP-AUTHORITY.md: bind the exact PR, checks, protection, issuance, integration and retirement winners.'));
  if (quarantineProfile && !quarantineObserved && !reservationReleased && !preservation && !acceptedMissingBytes && !lossDispositionVerified) findings.push(finding('cleanup-receipt-unverified', 'cleanup-operator', 'After live winner replay, assess and execute only the authorized exact quarantine plan.'));
  if (retirementReceiptError) findings.push(finding('provider-retirement-receipt-invalid', 'authority-operator',
    'Supply a valid integrate/retire receipt pair bound to this lane and its current merge.'));
  if ((preservation || lossDispositionVerified) && !retirementReceiptBinding) findings.push(finding('provider-retirement-unverified', 'authority-operator',
    lossDispositionVerified ? 'Prior local recovery bytes were explicitly discarded; bind the exact current integration and record-only retirement receipts.'
      : 'Source preservation is locally verified; bind the exact integration and record-only retirement receipts.'));
  if (deliveryDispositionError) findings.push(finding('delivery-disposition-invalid', 'product-owner',
    `Repair the exact committed delivery disposition (${deliveryDispositionError}); it must bind this lane, candidate, and committed evidence.`));
  const classifiedFindings = withApplicability(findings, changeClass);
  const closeout = deriveCloseoutVerdict({ sourceIntegrated: Boolean(projection), sourceSuperseded, canonicalCurrent: Boolean(canonical && tracking && canonical === tracking && canonicalClean), laneMounted, laneClean, laneHead: Boolean(laneHead), quarantineProfile, quarantineObserved, reservationReleased, preservationObserved: Boolean(preservation && !lossDispositionVerified), preservationDisposition: preservation?.disposition, recoveryDispositionSatisfied: acceptedMissingBytes, lossDispositionVerified, retirementReceiptVerified: Boolean(retirementReceiptBinding), branchDisposition, deployBound: deployBound(root, canonical), deliveryDisposition, deliveryDispositionInvalid: Boolean(deliveryDispositionError), changeClass, localPolicyCandidate: enrolled?.localPolicyCandidate === true, findingCodes: classifiedFindings.map((item) => item.code), lineagePredecessorRef: lineage && lineage !== false ? lineage.predecessorRef : null });
  return { schema: 'agentic-os/completion-status/v1', observationOnly: true, grantsAuthority: false, authorizesEffects: false, providerVerified: false, cleanupVerified: quarantineObserved, sourceSuperseded, supersession: sourceSuperseded ? { disposition: 'superseded', receiptDigest: supersession.receipt.receiptDigest, sourceIntegrated: false, providerAuthority: false, claimRetired: false, profileDigest: supersession.receipt.profileDigest, reason: supersession.receipt.reason, successor: supersession.receipt.successor } : null, preservationDispositionVerified: Boolean(preservation && !lossDispositionVerified), lossDispositionVerified, retirementReceiptBinding, retirementReceiptError,
    deliveryDisposition, deliveryDispositionError,
    preservationSatisfied: Boolean(preservation && !lossDispositionVerified), recoveryDispositionSatisfied: acceptedMissingBytes, lossDispositionReceiptDigest, preservationReceiptDigest: preservation && !lossDispositionVerified ? preservation.receiptDigest : null, ref, repository: profile.repository, profileDigest: profile.profileDigest, changeClass, canonicalRevision: canonical, remoteTrackingRevision: tracking, canonicalClean, lane: { path: lanePath, mounted: laneMounted, head: laneHead, clean: laneClean, retainedCheckout, dirtyState: lossDispositionVerified ? 'prior-recovery-bytes-discarded' : acceptedMissingBytes ? 'unrecoverable-accepted' : unknownDirtyState ? 'unobservable-at-missing-path' : laneMounted ? laneClean ? 'clean' : 'dirty' : 'unobserved', recoveryDisposition: acceptedMissingBytes ? recoveryDisposition : null }, lineage: lineage === false ? { valid: false, predecessorRef: null, predecessorHead: null, retainedBySuccessor: false, integrated: false } : lineage ? { valid: true, predecessorRef: lineage.predecessorRef, predecessorHead: lineage.predecessorHead, retainedBySuccessor: predecessorRetained, integrated: Boolean(predecessorIntegration || predecessorRetained && direct) } : null, integration: projection ? { kind: projection.kind, pathCount: projection.pathCount ?? null, ...(historical ? { reviewedHead: historical.reviewedHead, merge: historical.merge, replacements: historical.replacements.map(row => row.path) } : {}) } : null, enrollment: enrolled ? { authorityRepository: enrolled.authorityRepository, authorityRoot: enrolled.authorityRoot ?? null, authorityRevision: enrolled.authorityRevision ?? null, files: enrolled.files, localPolicyCandidate: enrolled.localPolicyCandidate } : null, closeout, findings: classifiedFindings };
}
export function runCompletionStatus(root, ref, policy, profile, out = console.log, { preservationPath = null, cleanupReceiptPath = null, integrationReceiptPath = null, retirementReceiptPath = null, authorityRoot = null } = {}) {
  const preservationReceipt = preservationPath ? readUserCleanupJson(preservationPath, 'preservation-receipt') : null, cleanupReceipt = cleanupReceiptPath ? readUserCleanupJson(cleanupReceiptPath, 'cleanup-receipt') : null;
  let integrationReceipt = null, retirementReceipt = null, retirementReceiptError = null;
  if (Boolean(integrationReceiptPath) !== Boolean(retirementReceiptPath)) retirementReceiptError = 'receipt-pair-required';
  else if (integrationReceiptPath) try {
    integrationReceipt = readUserCleanupJson(integrationReceiptPath, 'integration-operation-receipt');
    retirementReceipt = readUserCleanupJson(retirementReceiptPath, 'retirement-operation-receipt');
  } catch { retirementReceiptError = 'receipt-file-unreadable'; }
  out(JSON.stringify(inspectCompletionStatus(root, ref, policy, profile,
    { preservationReceipt, cleanupReceipt, integrationReceipt, retirementReceipt, retirementReceiptError, authorityRoot })));
  return 0;
}

/** Summarize local closeout from the exact lane or its registered canonical checkout. */
export function runCloseoutSummary(root, ref, policy, profile, out = console.log) {
  if (!isLaneRef(ref)) throw Object.assign(new TypeError('closeout requires an exact lane ref'), { reason: 'blocked-invalid-lane-ref' });
  const invocationRoot = realpathSync(repoRoot(root)), invocationBranch = currentBranch(invocationRoot), expectedCommon = realpathSync(commonDir(invocationRoot));
  if (invocationBranch !== policy.protectedBranch && invocationBranch !== ref)
    throw Object.assign(new Error(`run closeout from canonical ${policy.protectedBranch} or the exact lane ${ref}`), { reason: 'blocked-closeout-invocation-branch' });
  const registrations = worktrees(invocationRoot), canonicalEntry = registrations.find(row => row.branch === policy.protectedBranch && !row.detached);
  if (!canonicalEntry) throw Object.assign(new Error('the registered canonical checkout is unavailable'), { reason: 'blocked-closeout-canonical-missing' });
  const canonicalRoot = realpathSync(canonicalEntry.path);
  if (canonicalRoot !== canonicalEntry.path || realpathSync(repoRoot(canonicalRoot)) !== canonicalRoot
    || realpathSync(commonDir(canonicalRoot)) !== expectedCommon || currentBranch(canonicalRoot) !== policy.protectedBranch)
    throw Object.assign(new Error('the canonical checkout identity changed during closeout observation'), { reason: 'blocked-closeout-canonical-identity' });
  if (invocationBranch === ref) {
    const laneEntry = registrations.find(row => row.branch === ref);
    if (!laneEntry || realpathSync(laneEntry.path) !== invocationRoot)
      throw Object.assign(new Error('the invoked worktree is not the registered exact lane'), { reason: 'blocked-closeout-lane-identity' });
  }
  const canonicalProfile = trustedRepositoryProfile(canonicalRoot).profile;
  if (!canonicalProfile || canonicalProfile.repository !== profile.repository
    || canonicalProfile.profileDigest !== profile.profileDigest)
    throw Object.assign(new Error('lane and canonical trusted repository profiles do not match'), { reason: 'blocked-closeout-profile-mismatch' });
  const status = inspectCompletionStatus(canonicalRoot, ref, policy, canonicalProfile);
  const verdict = status.closeout, next = verdict.nextAction, branch = verdict.branchDisposition;
  out(`Closeout ${ref}: ${verdict.adlcState} (source ${verdict.sourceState}; delivery ${verdict.deliveryState}; retention ${verdict.retentionState}; ${verdict.completionScope})`); if (branch) out(`Branch disposition: local ${branch.policy.localBranch}; remote ${branch.policy.remoteBranch}; local ref ${branch.localRef.state}; remote-tracking ref ${branch.remoteTrackingRef.state}; live remote not observed.`);
  if (next) {
    out(`Next owner: ${next.owner} (${next.id})`);
    out(`Next step: ${next.command}`);
  } else out('Next owner: none reported by the local closeout observer.');
  const applicable = status.findings.filter(item => item.applicable !== false).slice(0, 3);
  if (applicable.length) out(`Findings: ${applicable.map(item => item.code).join(', ')}`);
  out('Read-only local observation; no provider refresh, integration, cleanup, deploy, promotion, or effect authorization.');
  return 0;
}
