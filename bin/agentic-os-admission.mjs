import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { acquireOperationLock, finishOperationLock, currentBranch, decodeNulFields, git, gitLines, headSha,
  fetch as gitFetch, observeGit, observeGitLines, remoteRefSha, remoteTransport, repoRoot, trackedChanges,
  untrackedPaths, worktrees } from '../src/git.mjs';
import { snapshotWorktreeEntry } from '../src/file-integrity.mjs';
import { assertDevice, deviceSegment, isLaneRef, laneRef, parseLaneRef } from '../src/lane-id.mjs';
import { DEFAULT_TASK_CHECKOUTS, MAX_TASK_CHECKOUTS, assertCheckoutPlacement } from '../src/canonical-resources.mjs';
import * as store from '../src/lane-records.mjs';
import { readmissionPredecessors } from '../src/lane-state.mjs';
import { isBoundLane } from '../src/guard-main.mjs';
import { provision, assertProvisionable, assertDisjointReservation, committedLanePaths, lanePath, parseWritePaths } from '../src/worktree.mjs';
import { recoverLaneRecordFromMission } from '../src/lane-cache-legacy.mjs';
import { assertProfileCurrent } from './agentic-os-auxiliary.mjs';
import { option, positional, flag } from './agentic-os-argv.mjs';
import { hash } from './agentic-os-test-inputs.mjs';
import { startWorkflow, readSelectedWorkflow, collectWorkflowValue, assertWorkflowEffect, workflowPaths, validateWorkflowPlanning, WORKFLOW_PHASES } from './agentic-os-workflow.mjs';
const fail = (reason, message, facts = {}) => { throw Object.assign(new Error(message), { reason: `blocked-admission-${reason}`, ...facts }); };
const scopeDigest = paths => hash(JSON.stringify([...paths].sort())); const covered = (path, paths) => paths.some(parent => path === parent || path.startsWith(`${parent}/`));
export const matchesSelectedSourcePendingReadmit = ({ row, alignment, ref, path, head, expectedTarget, recoveringSuccessor }) =>
  recoveringSuccessor === true && row?.state === 'pending' && row.operation === 'readmit'
  && alignment?.schema === 'agentic-os/lane-selected-source-transplant-plan/v1' && alignment.ref === ref
  && alignment.cwd === path && alignment.expectedTarget === expectedTarget && alignment.stopped === true
  && /^[a-f0-9]{40}$/u.test(alignment.expectedHead ?? '') && alignment.liveHead === head
  && Array.isArray(alignment.selectedPaths) && alignment.selectedPaths.length > 0
  && scopeDigest(alignment.selectedPaths) === row.writeDigest
  && (alignment.candidateHead === null || /^[a-f0-9]{40}$/u.test(alignment.candidateHead)
    && [alignment.expectedHead, alignment.candidateHead].includes(alignment.liveHead));
export const matchesSelectedSourceTransplantSuccessor = ({ row, record, predecessor, alignment, ref, path,
  worktreeId, expectedTarget, predecessorCurrent, predecessorAncestor, baseLineageCompatible = false }) => {
  const handoff = record?.handoff, paths = predecessor?.writePaths;
  return row?.state === 'pending' && row.operation === 'readmit' && row.ref === ref && row.path === path
    && row.worktreeId === worktreeId && (baseLineageCompatible === true || row.baseRevision === record.baseSha)
    && row.predecessorRef === predecessor?.ref
    && predecessorCurrent === true && predecessorAncestor === true
    && ['published', 'queued', 'integrated'].includes(predecessor.state)
    && predecessor.worktree === path && predecessor.base === record.base
    && (baseLineageCompatible === true || predecessor.baseSha === record.baseSha)
    && Array.isArray(paths) && scopeDigest(paths) === row.previousWriteDigest
    && paths.every(file => covered(file, record.writePaths ?? []))
    && record.state === 'active' && record.ref === ref && record.worktree === path
    && handoff?.schema === 'agentic-os-lane-selected-source-transplant/v1'
    && handoff.preservedHead === alignment?.expectedHead && handoff.sourceBase === alignment?.expectedBase
    && handoff.targetHead === expectedTarget && handoff.planDigest === alignment?.digest
    && Array.isArray(handoff.selectedPaths) && Array.isArray(alignment?.selectedPaths)
    && JSON.stringify(handoff.selectedPaths) === JSON.stringify(alignment.selectedPaths)
    && alignment.schema === 'agentic-os/lane-selected-source-transplant-plan/v1' && alignment.ref === ref
    && alignment.cwd === path && alignment.expectedTarget === expectedTarget && alignment.stopped === true
    && record.head === alignment.liveHead && scopeDigest(record.writePaths ?? []) === row.writeDigest
    && scopeDigest(alignment.selectedPaths) === row.writeDigest;
};
const limitValue = text => text === null ? null : !/^(0|[1-9][0-9]?)$/u.test(text) || Number(text) > MAX_TASK_CHECKOUTS ? fail('allowance', `checkout-limit must be an explicit integer from 0 to ${MAX_TASK_CHECKOUTS}`) : Number(text);
const selectedAgain = (root, repository, prior) => {
  const fresh = readSelectedWorkflow(root, repository, { input: prior.path, required: true });
  if (fresh.digest !== prior.digest) fail('workflow-drift', 'Selected immutable workflow changed; retain the allocation and re-read its successor');
  return fresh;
};
function successor(root, repository, selected, changes) {
  selectedAgain(root, repository, selected);
  const workspace = workflowPaths(root, repository).workspace;
  const value = { ...selected.manifest, ...changes,
    members: changes.members ?? selected.members.map(row => ({ ...row.ref, file: row.path })),
    previous: { file: selected.path, digest: selected.digest },
    releaseEvidence: (selected.manifest.releaseEvidence ?? []).map(row => ({ ...row, file: resolve(dirname(selected.path), row.file) })) };
  if (value.codebaseIndex?.snapshot) value.codebaseIndex = { ...value.codebaseIndex,
    snapshot: { ...value.codebaseIndex.snapshot, file: resolve(workspace, value.codebaseIndex.snapshot.file) } };
  const collected = collectWorkflowValue(root, repository, value, resolve(root, 'workflow-input.json'));
  return readSelectedWorkflow(root, repository, { input: collected.manifest, required: true });
}
function withMember(root, repository, selected, worktreeId, revision) {
  const member = selected.members.find(row => row.child.context.worktreeId === worktreeId && row.child.source.repository === repository);
  if (member?.child.source.revision === revision) return selected;
  const child = collectWorkflowValue(root, repository, { schema: 'agentic-os/workflow-observation-input/v1',
    id: worktreeId, source: { repository, revision, tree: headSha(`${revision}^{tree}`, root) },
    context: { workflowId: selected.manifest.id, worktreeId }, expected: WORKFLOW_PHASES, phases: [] }, resolve(root, 'workflow-input.json'));
  const replacement = { id: member?.ref.id ?? worktreeId, file: child.manifest, digest: child.digest };
  const members = selected.members.map(row => row === member ? replacement : { ...row.ref, file: row.path });
  if (!member) members.push(replacement);
  return successor(root, repository, selected, { members });
}
function recordAllocation(root, repository, selected, allocation) {
  const allocations = (selected.manifest.allocations ?? []).filter(row => row.worktreeId !== allocation.worktreeId);
  allocations.push(allocation);
  return successor(root, repository, selected, { allocations });
}
export function checkoutCapacity(selected, repository, inventory, explicitLimit = null) {
  const own = new Set(selected.members.filter(row => row.child.source.repository === repository).map(row => row.child.context.worktreeId));
  const consumed = new Set((selected.manifest.allocations ?? []).filter(row => own.has(row.worktreeId) && ['pending', 'active'].includes(row.state)).map(row => row.worktreeId));
  for (const row of inventory) if (own.has(basename(row.path))) consumed.add(basename(row.path));
  return { limit: Math.min(selected.manifest.execution?.checkoutLimit ?? explicitLimit, MAX_TASK_CHECKOUTS), consumed: consumed.size, worktreeIds: [...consumed].sort() };
}
function observeExisting(root, ref, path, record, expectedHead, requested, policy, allocation, readmit = false, recovery = null) {
  const registered = worktrees(root).find(row => row.branch === ref && row.path === path);
  let recoveryReceipt = null;
  if (!record && recovery?.enabled) {
    const restored = recoverLaneRecordFromMission({ ref, path, expectedHead, policy, allocation, selected: recovery.selected,
      repository: recovery.repository, writePaths: requested, root }, store.newRecord);
    record = restored.record; recoveryReceipt = restored.receipt;
  }
  if (!registered || !record || record.state !== 'active' || record.worktree !== path || !isBoundLane(ref, path)
    || currentBranch(path) !== ref || record.pr !== null) fail('existing-identity', 'Reuse requires one live bound active unpublished lane');
  const head = headSha('HEAD', path);
  if (expectedHead && head !== expectedHead) fail('head-drift', 'The active lane no longer has the expected head'); if (registered.head && registered.head !== head) fail('head-drift', 'Registered head changed');
  if (!record.baseSha || observeGit(['merge-base', '--is-ancestor', record.baseSha, head], { cwd: root, allowFail: true }) === null) fail('base-binding', 'The existing lane must retain its admitted source ancestry'); const reserved = parseWritePaths((record.writePaths ?? []).join(',')), authoredScope = readmit ? [...new Set([...reserved, ...requested])] : reserved;
  const authored = [...committedLanePaths(head, headSha(policy.protectedRef, root), root),
    ...gitLines(['diff', '--name-only', 'HEAD'], { cwd: path }),
    ...gitLines(['ls-files', '--others', '--exclude-standard'], { cwd: path })];
  if (authored.some(file => !covered(file, authoredScope))) fail('unreserved-bytes', 'Preserve authored bytes outside the current reservation; do not adopt them');
  const remote = policy.protectedRef.match(/^refs\/remotes\/([^/]+)\//u)?.[1];
  if (!remote) fail('remote', 'Protected remote binding is missing'); const transport = remoteTransport(remote, root);
  if (remoteRefSha(remote, ref, root, transport.fetchUrl) !== null) fail('published', 'Published candidates are immutable; use the native successor operation'); assertDisjointReservation({ cwd: root, ref, writePaths: requested, protectedRef: policy.protectedRef, records: store.load(root).lanes });
  const lineage = readmissionPredecessors(record, store.load(root).lanes, allocation,
    (older, newer) => observeGit(['merge-base', '--is-ancestor', older, newer], { cwd: root, allowFail: true }) !== null);
  if (lineage === false) fail('successor-lineage', 'Invalid retained successor identity'); if (lineage.some(link => remoteRefSha(remote, link.predecessorRef, root, transport.fetchUrl) !== link.predecessorHead
    || observeGit(['merge-base', '--is-ancestor', link.predecessorHead, head], { cwd: root, allowFail: true }) === null))
    fail('successor-lineage', 'Retained successor needs exact published predecessor and preserved ancestry');
  if (recoveryReceipt) { store.putExact(record, null, root); recovery.artifacts.effectsRetained = true; recovery.artifacts.allocation = recoveryReceipt; }
  return { head, reserved, lineage, record, recoveryReceipt };
}
export async function cmdStart(root, argv, policy, profile, services) {
  const { out, err, projectCache, effectReceipt, remoteName, requireCanonical, refresh = null } = services;
  const [scope] = positional(argv), device = assertDevice(option(argv, 'device') ?? deviceSegment());
  if (!scope) { err('usage: start <scope> --write=<paths>'); return 1; }
  const ref = laneRef(scope, device);
  let path = lanePath(scope, device, root), worktreeId = basename(path);
  const requested = option(argv, 'write') === null ? [] : parseWritePaths(option(argv, 'write'));
  const planningPath = option(argv, 'plan'), input = option(argv, 'mission');
  let explicitLimit = limitValue(option(argv, 'checkout-limit'));
  const readmit = flag(argv, 'readmit'), expectedHead = option(argv, 'expected-head');
  if (expectedHead !== null && !/^[a-f0-9]{40}$/u.test(expectedHead)) fail('head', 'expected-head must be an exact commit SHA');
  if (readmit && (!input || !expectedHead)) fail('readmit-binding', 'readmit requires an exact mission and expected-head');
  const refreshMethods = refresh?.owner ? { plan: refresh.owner.plan ?? refresh.owner.planLaneAlignment,
    prepare: refresh.owner.prepare ?? refresh.owner.prepareLaneAlignment,
    apply: refresh.owner.apply ?? refresh.owner.applyLaneAlignment } : null;
  if (refresh && (!readmit || refresh.stopped !== true || !/^[a-f0-9]{40}$/u.test(refresh.expectedTarget ?? '')
    || ['plan', 'prepare', 'apply'].some(key => typeof refreshMethods?.[key] !== 'function')))
    fail('refresh-binding', 'Refresh requires stopped-writer readmission and one exact protected target');
  const lock = acquireOperationLock('agentic-os-start', root);
  if (!lock) { err('blocked-concurrent-start: another lane admission owns the clone-wide start lock'); return 1; }
  let result, error, selected, allocation;
  const artifacts = { effectsRetained: false, ref, worktree: null, baseSha: null, protectedRef: policy.protectedRef, fetchedProtectedSha: null, fetchCompleted: false,
    provisioned: false, branchSha: null, registeredWorktree: null, pathExists: false, fetchReceipt: null, provisionReceipt: null, alignmentReceipt: null, allocation: null, workflow: null };
  try {
    const fetched = effectReceipt('fetch', gitFetch(remoteName(policy, root), root));
    Object.assign(artifacts, { fetchReceipt: fetched, fetchCompleted: true, fetchedProtectedSha: headSha(policy.protectedRef, root) });
    artifacts.effectsRetained ||= fetched.effectsRetained;
    requireCanonical(root, policy);
    const records = store.load(root).lanes;
    const bound = worktrees(root).find(row => row.branch === ref);
    if (bound) { path = bound.path; worktreeId = basename(path); }
    selected = readSelectedWorkflow(root, profile.repository, { input, required: input !== null, worktreeId, ref, navigation: Boolean(input || !planningPath || readmit) });
    if (!selected && planningPath && explicitLimit === null) explicitLimit = DEFAULT_TASK_CHECKOUTS;
    const enrolled = Boolean(selected?.manifest.execution || input || planningPath || explicitLimit !== null || readmit);
    assertCheckoutPlacement(path, worktrees(root));
    if (input && selected) selectedAgain(root, profile.repository, selected);
    if (enrolled) {
      if (!selected?.manifest.execution && explicitLimit === null) fail('allowance-required', 'Declare the mission checkout limit before creation or explicit legacy adoption'); if (selected?.manifest.execution && explicitLimit !== null && selected.manifest.execution.checkoutLimit !== explicitLimit) fail('allowance-drift', 'A retry cannot reset or enlarge the existing mission allowance');
      if (selected && planningPath && selected.manifest.planning.path !== planningPath) fail('planning-drift', 'The selected mission binds a different plan'); if (!selected && !planningPath) fail('plan-required', 'A new declared mission requires a committed planning document');
      if (!selected) validateWorkflowPlanning(root, profile.repository, { revision: headSha(policy.protectedRef, root), planningPath }); const row = selected?.manifest.allocations?.find(item => item.worktreeId === worktreeId);
      const registered = worktrees(root).find(item => item.branch === ref || item.path === path);
      if (registered) {
        let record = records[ref];
        let alignment = refresh ? refreshMethods.plan({ cwd: path, ref, expectedHead,
          targetRef: policy.protectedRef, expectedTarget: refresh.expectedTarget, stopped: refresh.stopped,
          ...(refresh.input ?? {}) }) : null;
        if (alignment?.candidateHead) Object.assign(artifacts, { effectsRetained: true, worktree: path, alignmentReceipt: { phase: 'observed-preparation', journalPath: alignment.journalPath,
          oldRef: alignment.oldRef, candidateRef: alignment.candidateRef, head: alignment.candidateHead } });
        const reusePaths = refresh ? parseWritePaths((record?.writePaths ?? []).join(',')) : requested;
        const identity = observeExisting(root, ref, path, record, alignment?.liveHead ?? expectedHead, reusePaths, policy, row, readmit,
          { enabled: readmit && !refresh, selected, repository: profile.repository, artifacts });
        record = identity.record;
        if (!selected) fail('mission-required', 'Existing lanes need their exact workflow identity; no new root is created for reuse');
        if (!selected.members.some(item => item.child.context.worktreeId === worktreeId && item.child.source.repository === profile.repository)) fail('member-binding', 'The existing lane is not a member of the selected mission');
        const liveDigest = scopeDigest(identity.reserved), recoveringReadmit = row?.state === 'pending' && row.operation === 'readmit';
        const successorReadmit = row && row.ref !== ref && identity.lineage.some(link => link.predecessorRef === row.ref);
        const writePaths = readmit ? [...new Set([...identity.reserved, ...requested])].sort() : identity.reserved, nextDigest = scopeDigest(writePaths);
        const recertification = readmit && row?.state === 'active' && row.ref === ref && row.writeDigest !== liveDigest
          && row.headRevision === selected.members.find(item => item.child.context.worktreeId === worktreeId && item.child.source.repository === profile.repository)?.child.source.revision
          && observeGit(['merge-base', '--is-ancestor', row.headRevision, identity.head], { cwd: root, allowFail: true }) !== null;
        const predecessorPaths = row?.predecessorRef && records[row.predecessorRef]
          ? parseWritePaths(records[row.predecessorRef].writePaths.join(',')) : [];
        const predecessor = row?.predecessorRef ? records[row.predecessorRef] : null;
        const baseRevisionCompatible = Boolean(row?.baseRevision && record.baseSha
          && observeGit(['merge-base', '--is-ancestor', row.baseRevision, record.baseSha], { cwd: root, allowFail: true }) !== null);
        const baseLineageCompatible = Boolean(predecessor && predecessor.base === record.base
          && row?.baseRevision && predecessor.baseSha
          && observeGit(['merge-base', '--is-ancestor', row.baseRevision, predecessor.baseSha], { cwd: root, allowFail: true }) !== null
          && observeGit(['merge-base', '--is-ancestor', predecessor.baseSha, record.baseSha], { cwd: root, allowFail: true }) !== null);
        const remoteName = policy.protectedRef.match(/^refs\/remotes\/([^/]+)\//u)?.[1];
        const selectedSourceAttempt = recoveringReadmit && readmit
          && alignment?.schema === 'agentic-os/lane-selected-source-transplant-plan/v1';
        const predecessorCurrent = Boolean(selectedSourceAttempt && predecessor && remoteName
          && remoteRefSha(remoteName, row.predecessorRef, root, remoteTransport(remoteName, root).fetchUrl) === predecessor.head);
        const predecessorAncestor = Boolean(selectedSourceAttempt && predecessor?.head && alignment?.expectedHead
          && observeGit(['merge-base', '--is-ancestor', predecessor.head, alignment.expectedHead], { cwd: root, allowFail: true }) !== null);
        const selectedSourceSuccessor = recoveringReadmit && readmit && matchesSelectedSourceTransplantSuccessor({
          row, record, predecessor, alignment, ref, path, worktreeId, expectedTarget: refresh?.expectedTarget,
          predecessorCurrent, predecessorAncestor, baseLineageCompatible,
        });
        const recoveringSuccessor = recoveringReadmit && readmit && row.ref === ref
          && (identity.lineage.some(link => link.predecessorRef === row.predecessorRef) || selectedSourceSuccessor)
          && scopeDigest(predecessorPaths) === row.previousWriteDigest && predecessorPaths.every(file => covered(file, identity.reserved)) && nextDigest === row.writeDigest;
        const recoveringHeadAdvance = recoveringReadmit && readmit && !alignment && row.worktreeId === worktreeId
          && row.ref === ref && row.path === path && baseRevisionCompatible && row.predecessorRef === undefined
          && row.headRevision !== identity.head && nextDigest === row.writeDigest && (row.previousWriteDigest === liveDigest || row.writeDigest === liveDigest && record.head === identity.head)
          && observeGit(['merge-base', '--is-ancestor', row.headRevision, identity.head], { cwd: root, allowFail: true }) !== null;
        const recoveringSelectedSource = matchesSelectedSourcePendingReadmit({ row, alignment, ref, path, head: identity.head, expectedTarget: refresh?.expectedTarget, recoveringSuccessor });
        if (successorReadmit && !readmit) fail('successor-readmit', 'Explicit readmit must bind the retained successor to its existing mission slot');
        if (row && (row.path !== path || row.ref !== ref && !successorReadmit || row.writeDigest !== liveDigest && !successorReadmit && !recertification && !recoveringSuccessor && !(recoveringReadmit && row.previousWriteDigest === liveDigest))) fail('reservation-drift', 'Native scope evidence no longer matches the live lane projection');
        if (!readmit && requested.some(file => !covered(file, identity.reserved))) fail('scope-expansion', 'Use explicit active readmit for additional paths');
        if (row?.state === 'pending' && (!expectedHead || row.headRevision !== identity.head && !(alignment && row.headRevision === alignment.candidateHead) && !recoveringHeadAdvance && !recoveringSelectedSource || recoveringReadmit && !readmit)) fail('recovery-required', 'Pending allocation requires exact retained-head reconciliation; do not reprovision');
        if (recoveringReadmit && nextDigest !== row.writeDigest) fail('recovery-scope', 'Retry must retain the exact pending reservation expansion');
        if (!selected.manifest.execution) selected = successor(root, profile.repository, selected, { execution: { version: 1, checkoutLimit: explicitLimit, dependencies: { version: 1, edges: [] } } });
        if (recertification) store.putExact({ ...record, head: identity.head, writePaths }, record, root);
        if (expectedHead) selected = withMember(root, profile.repository, selected, worktreeId, identity.head);
        assertWorkflowEffect({ root, repository: profile.repository, phase: 'preparation', worktreeId, revision: identity.head, ref });
        if (alignment) {
          alignment = refreshMethods.prepare(alignment);
          Object.assign(artifacts, { effectsRetained: true, worktree: path,
            alignmentReceipt: { phase: 'prepared', journalPath: alignment.journalPath,
              oldRef: alignment.oldRef, candidateRef: alignment.candidateRef, head: alignment.candidateHead } });
        }
        allocation = recoveringHeadAdvance || recoveringSelectedSource && alignment ? row : { worktreeId, ref, path, baseRevision: row?.baseRevision ?? record.baseSha, headRevision: alignment?.candidateHead ?? identity.head,
          writeDigest: nextDigest, state: readmit ? 'pending' : 'active', operation: readmit ? 'readmit' : row?.operation ?? 'create',
          ...(readmit ? { previousWriteDigest: recoveringReadmit ? row.previousWriteDigest : successorReadmit || recertification ? row.writeDigest : liveDigest } : {}),
          ...(row?.recoveredFromHead ? { recoveredFromHead: row.recoveredFromHead } : {}),
          ...(row?.selectedSourceRecovery ? { selectedSourceRecovery: row.selectedSourceRecovery } : {}),
          ...(successorReadmit ? { predecessorRef: row.ref } : row?.predecessorRef ? { predecessorRef: row.predecessorRef } : {}) };
        if (alignment) Object.assign(artifacts, { allocation, workflow: selected.path });
        if (JSON.stringify(row) !== JSON.stringify(allocation)) selected = recordAllocation(root, profile.repository, selected, allocation);
        if (alignment) artifacts.workflow = selected.path;
        if (readmit) {
          selectedAgain(root, profile.repository, selected);
          observeExisting(root, ref, path, store.get(ref, root), identity.head, writePaths, policy, row, true);
          if (liveDigest !== nextDigest || record.head !== identity.head) store.putExact({ ...record, head: identity.head, writePaths }, record, root);
          if (alignment) {
            const receipt = refreshMethods.apply(alignment);
            Object.assign(artifacts, { effectsRetained: true, alignmentReceipt: receipt, allocation, workflow: selected.path });
            identity.head = receipt.head;
            selected = withMember(root, profile.repository, selected, worktreeId, identity.head);
            const currentRecord = store.get(ref, root); if (!currentRecord || currentRecord.state !== 'active' || ['ref', 'device', 'scope', 'base', 'baseSha', 'worktree', 'pr'].some(field => currentRecord[field] !== record[field]) || JSON.stringify(currentRecord.writePaths ?? []) !== JSON.stringify(writePaths) || ![record.head, alignment.candidateHead, identity.head].includes(currentRecord.head)) fail('alignment-record-drift', 'Lane identity changed while refresh was applying; preserve the owner record and reconcile from its current head');
            if (currentRecord.head !== identity.head) store.putExact({ ...currentRecord, head: identity.head }, currentRecord, root);
            out(JSON.stringify(receipt));
          }
          const { previousWriteDigest, ...completed } = allocation;
          const selectedSourceRecovery = recoveringSelectedSource && alignment ? {
            schema: 'agentic-os/workflow-selected-source-recovery/v1', priorAllocationHead: row.headRevision,
            sourceHead: alignment.expectedHead, sourceBase: alignment.expectedBase, targetHead: alignment.expectedTarget,
            selectedPaths: alignment.selectedPaths, planDigest: alignment.digest,
          } : null;
          allocation = { ...completed, ...(recoveringHeadAdvance ? { headRevision: identity.head, recoveredFromHead: row.headRevision } : {}),
            ...(selectedSourceRecovery ? { headRevision: identity.head, selectedSourceRecovery } : {}), state: 'active' };
          selected = recordAllocation(root, profile.repository, selected, allocation);
        }
        out(JSON.stringify({ schema: 'agentic-os/start-admission/v1', authority: false, status: readmit ? 'readmitted' : 'reused',
          ref, worktree: path, head: identity.head, writeDigest: allocation.writeDigest, workflow: selected.path, digest: selected.digest, ...(recertification ? { recertified: { previousWriteDigest: row.writeDigest, writeDigest: allocation.writeDigest, providerAuthority: false, integrationProof: false, cleanupAuthority: false } } : {}), ...(identity.recoveryReceipt ? { recovery: identity.recoveryReceipt } : {}), created: false }));
        result = 0;
      } else {
        if (refresh) fail('refresh-missing', 'Refresh never provisions another checkout');
        if (readmit) fail('readmit-missing', 'No registered existing lane matches the readmission request');
        if (row) fail('recovery-required', 'A retained allocation still consumes capacity; reconcile it without another checkout');
        const limit = Math.min(selected?.manifest.execution?.checkoutLimit ?? explicitLimit, MAX_TASK_CHECKOUTS);
        const capacity = selected ? checkoutCapacity(selected, profile.repository, worktrees(root), explicitLimit) : { consumed: 0 };
        if (limit === 0 || capacity.consumed >= limit) fail('capacity', limit === 0 ? `Mission ${selected?.manifest.id ?? 'new task'} allows no checkout. Declare a separate task with a positive --checkout-limit.` : `Checkout allowance exhausted for workflow ${selected.manifest.id} (${capacity.consumed}/${limit}). Resume/reconcile its allocation or pass a committed --plan for a new task.`, { capacity: { ...capacity, limit } });
      }
    }
    if (result !== 0) {
      assertProvisionable({ ref, scope, device, cwd: root });
      if (selected?.manifest.execution) {
        selectedAgain(root, profile.repository, selected);
        const member = selected.members.find(row => row.child.context.worktreeId === worktreeId && row.child.source.repository === profile.repository);
        assertWorkflowEffect({ root, repository: profile.repository, phase: 'preparation', worktreeId,
          revision: member?.child.source.revision ?? headSha(policy.protectedRef, root), ref });
      }
      const baseSha = assertProfileCurrent(root, policy, profile);
      artifacts.baseSha = baseSha;
      if (!baseSha) fail('base', 'Protected base is unavailable after native fetch');
      assertDisjointReservation({ cwd: root, ref, writePaths: requested, protectedRef: policy.protectedRef, records: store.load(root).lanes });
      if (enrolled) {
        if (!selected) {
          const initial = startWorkflow(root, profile.repository, { revision: baseSha, planningPath, worktreeId,
            execution: { version: 1, checkoutLimit: explicitLimit, dependencies: { version: 1, edges: [] } } });
          selected = readSelectedWorkflow(root, profile.repository, { input: initial.manifest, required: true });
        } else {
          if (!selected.manifest.execution) selected = successor(root, profile.repository, selected,
            { execution: { version: 1, checkoutLimit: explicitLimit, dependencies: { version: 1, edges: [] } } });
          selected = withMember(root, profile.repository, selected, worktreeId, baseSha);
        }
        assertWorkflowEffect({ root, repository: profile.repository, phase: 'preparation', worktreeId, revision: baseSha, ref });
        allocation = { worktreeId, ref, path, baseRevision: baseSha, headRevision: baseSha,
          writeDigest: scopeDigest(requested), state: 'pending', operation: 'create' };
        selected = recordAllocation(root, profile.repository, selected, allocation);
        artifacts.allocation = allocation; artifacts.workflow = selected.path; artifacts.effectsRetained = true;
        selectedAgain(root, profile.repository, selected);
      }
      const context = (await import('./agentic-os-workspace.mjs')).hydrateWorkspace(root, policy, { revision: baseSha });
      if (context.status !== 'disabled') out(`${context.schema ? 'workspace' : 'memory'} ${JSON.stringify(context)}`);
      if (enrolled && selected) selectedAgain(root, profile.repository, selected);
      const created = effectReceipt('provision-worktree', provision({ ref, scope, device, baseSha, cwd: root }));
      Object.assign(artifacts, { worktree: created.path, provisioned: true, provisionReceipt: created, effectsRetained: true });
      projectCache({ ...store.newRecord({ ref, device, scope, base: policy.protectedRef, baseSha, worktree: created.path, writePaths: requested }), state: 'active' }, root);
      if (enrolled && allocation) selected = recordAllocation(root, profile.repository, selected, { ...allocation, state: 'active' });
      out(`lane ${ref}\nworktree ${created.path}\nbase ${policy.protectedRef} @ ${baseSha.slice(0, 9)}`);
      out(JSON.stringify({ schema: 'agentic-os/start-admission/v1', authority: false, status: 'created', ref,
        worktree: created.path, head: baseSha, workflow: selected?.path ?? null, enforcement: enrolled ? 'declared-mission' : 'legacy-standalone' }));
      result = 0;
    }
  } catch (caught) {
    error = caught;
    const retained = caught.operationArtifacts ?? caught.artifacts;
    if (retained) {
      artifacts[retained.operation === 'lane-alignment' ? 'alignmentReceipt'
        : retained.operation === 'fetch' ? 'fetchReceipt' : 'provisionReceipt'] = retained;
      artifacts.branchSha = retained.branchSha ?? null;
      artifacts.registeredWorktree = retained.registeredWorktree ?? null;
      artifacts.pathExists = retained.pathExists === true;
      artifacts.worktree = retained.path ?? retained.registeredWorktree?.path ?? artifacts.worktree;
      artifacts.effectsRetained ||= retained.effectsRetained === true;
    }
  }
  if (error && refresh && artifacts.effectsRetained) Object.assign(error, { retainedOperation: true,
    operationError: error.operationError ?? { reason: error.reason ?? null, message: error.message },
    operationArtifacts: artifacts, operationResult: null });
  return finishOperationLock(lock, { label: 'start', result, error, artifacts });
}
const REBIND_SCHEMA = 'agentic-os/lane-rebind-plan/v1', REBIND_MAX_PATHS = 1_024,
  REBIND_MAX_FILE_BYTES = 10_000_000, REBIND_MAX_TOTAL_BYTES = 64_000_000;
const rebindHash = value => createHash('sha256').update(value).digest('hex');
const rebindBlock = (reason, message) => Object.assign(new Error(message), {
  reason: `blocked-lane-rebind-${reason}`,
});
function rebindCanonical(value) {
  if (Array.isArray(value)) return `[${value.map(rebindCanonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${rebindCanonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const rebindDigest = value => rebindHash(rebindCanonical(value));
function refInventoryDigest(root) {
  return rebindHash(observeGitLines(['for-each-ref', '--format=%(refname) %(objectname)',
    'refs/heads', 'refs/remotes'], { cwd: root }).join('\n'));
}
function rebindPaths(output) {
  const paths = decodeNulFields(output);
  if (!paths || paths.length > REBIND_MAX_PATHS) throw rebindBlock('path-inventory', 'path inventory is unavailable or exceeds its bound');
  return [...new Set(paths)].sort();
}
function laneChangedPaths(base, head, cwd) {
  const output = observeGit(['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`], {
    cwd, binary: true, allowFail: true,
  });
  if (output === null) throw rebindBlock('path-inventory', `cannot compare ${head} with ${base}`);
  return output.length ? rebindPaths(output) : [];
}
function validateRebindPath(path) {
  let parsed;
  try { parsed = parseWritePaths(path); } catch { throw rebindBlock('path-inventory', `unsupported reserved path: ${path}`); }
  if (parsed.length !== 1 || parsed[0] !== path) throw rebindBlock('path-inventory', `unsupported reserved path: ${path}`);
}
function laneDirtyEvidence(path) {
  const tracked = trackedChanges(path), names = new Set([
    ...tracked.headToIndex.map(row => row.path), ...tracked.indexToWorkingTree.map(row => row.path),
    ...untrackedPaths(path, { includeIgnored: false }),
  ]);
  if (names.size > REBIND_MAX_PATHS) throw rebindBlock('dirty-budget', 'dirty path inventory exceeds its bound');
  let total = 0;
  const entries = [...names].sort().map(name => {
    validateRebindPath(name);
    const absolute = resolve(path, name), stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) return { path: name, kind: 'deleted' };
    try {
      const item = snapshotWorktreeEntry(absolute, { maxBytes: REBIND_MAX_FILE_BYTES,
        aggregateBytes: REBIND_MAX_TOTAL_BYTES - total, budget: { bytes: 0 }, label: 'lane rebind dirty entry' });
      total += item.bytes.length;
      return { path: name, kind: item.kind, mode: item.mode, size: item.bytes.length,
        sha256: rebindHash(item.bytes) };
    } catch (error) { throw rebindBlock('dirty-entry', `${name}: ${error.message}`); }
  });
  const index = observeGit(['ls-files', '--stage', '-z'], { cwd: path, binary: true });
  const status = observeGit(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd: path, binary: true });
  return { entries, indexSha256: rebindHash(index), statusSha256: rebindHash(status), bytes: total };
}
function planLaneRecertification({ cwd, ref, base, baseSha, targetPath, expectedHead, pr = null, mounted: suppliedMounted = false, createdAt: suppliedCreatedAt = null }) {
  if (!isLaneRef(ref)) throw rebindBlock('ref', 'an exact agent/<device>/<scope> ref is required');
  const root = repoRoot(cwd), identity = parseLaneRef(ref);
  if (currentBranch(root) !== 'main' || observeGit(['status', '--porcelain', '--untracked-files=all'], { cwd: root }) !== '')
    throw rebindBlock('canonical', 'recertification must run from clean canonical main');
  if (store.get(ref, root)) throw rebindBlock('record', 'recertification requires the exact lane record to be absent');
  if (typeof base !== 'string' || !/^refs\/remotes\/[^/]+\/main$/u.test(base)
    || typeof baseSha !== 'string' || !/^[0-9a-f]{40}$/u.test(baseSha)
    || typeof expectedHead !== 'string' || !/^[0-9a-f]{40}$/u.test(expectedHead)
    || pr !== null && (!Number.isSafeInteger(pr) || pr < 1))
    throw rebindBlock('request', 'recertification requires exact base, base SHA, head SHA and optional positive PR number');
  if (typeof targetPath !== 'string' || !isAbsolute(targetPath) || resolve(targetPath) !== targetPath) throw rebindBlock('restore-path', 'recertification target must be an exact absolute path');
  const targetStat = lstatSync(targetPath, { throwIfNoEntry: false }), registrations = worktrees(root),
    mounted = suppliedMounted || Boolean(targetStat), entry = registrations.find(row => row.branch === ref);
  if (mounted ? !targetStat?.isDirectory() || targetStat.isSymbolicLink() || entry?.path !== targetPath
    || realpathSync(targetPath) !== targetPath || currentBranch(targetPath) !== ref
    : targetStat || entry || registrations.some(row => row.path === targetPath))
    throw rebindBlock('restore-path', 'recertification target must be absent or the exact mounted lane');
  if (!mounted) {
    const parent = dirname(targetPath), parentInfo = lstatSync(parent, { throwIfNoEntry: false });
    if (!parentInfo?.isDirectory() || parentInfo.isSymbolicLink() || realpathSync(parent) !== parent) throw rebindBlock('restore-parent', 'recertification target parent must be an existing canonical directory');
  }
  const head = headSha(`refs/heads/${ref}`, root);
  if (!head || head !== expectedHead) throw rebindBlock('branch', 'local lane ref does not match the exact expected head');
  const remote = base.match(/^refs\/remotes\/([^/]+)\/main$/u)?.[1];
  const protectedHead = headSha(base, root), canonicalHead = headSha('HEAD', root);
  if (!remote || !protectedHead || canonicalHead !== headSha('refs/heads/main', root) || canonicalHead !== protectedHead
    || headSha(baseSha, root) !== baseSha || observeGit(['merge-base', '--is-ancestor', baseSha, head], { cwd: root, allowFail: true }) !== ''
    || observeGit(['merge-base', '--is-ancestor', baseSha, protectedHead], { cwd: root, allowFail: true }) !== '') throw rebindBlock('base', 'clean canonical main and the exact lane must descend from the recorded base SHA');
  const transport = remoteTransport(remote, root), remoteHead = remoteRefSha(remote, ref, root, transport.fetchUrl);
  if (mounted ? remoteHead !== null : remoteHead !== head)
    throw rebindBlock('published-head', mounted ? 'mounted recovery requires an unpublished remote lane' : 'live remote lane ref must exactly match the expected local head');
  const dirty = mounted ? laneDirtyEvidence(targetPath) : null;
  const writePaths = [...new Set([...laneChangedPaths(baseSha, head, root), ...(dirty?.entries ?? []).map(row => row.path)])].sort();
  if (!writePaths.length || writePaths.length > REBIND_MAX_PATHS) throw rebindBlock('reservation', 'retained commits have no bounded changed-path reservation');
  writePaths.forEach(validateRebindPath);
  try { assertDisjointReservation({ cwd: root, ref, writePaths, protectedRef: base, records: store.load(root).lanes }); }
  catch (error) { throw rebindBlock('path-overlap', error.message); }
  const createdAt = suppliedCreatedAt ?? new Date().toISOString();
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) throw rebindBlock('request', 'recertification timestamp must be an exact ISO timestamp');
  const updatedRecord = mounted
    ? { ref, device: identity.device, scope: identity.scope, state: 'active', base, baseSha, worktree: targetPath, pr: null, createdAt, writePaths }
    : { ref, device: identity.device, scope: identity.scope, state: 'published', base, baseSha, worktree: targetPath, pr, createdAt, head, writePaths, recovery: { schema: 'agentic-os/lane-recovery/v1', dirtyState: 'unobservable-at-missing-path' } };
  const body = { schema: REBIND_SCHEMA, mode: mounted ? 'mounted' : 'recertify', ref, root, targetPath, previousRecordSha256: rebindDigest(null), previousHead: null, head,
    protectedRef: base, protectedHead, baseSha, remoteHead, expectedHead, pr, refsSha256: refInventoryDigest(root), writePathsBefore: [], writePathsAfter: writePaths,
    addedPaths: writePaths, dirty, restoredDirtyState: mounted ? 'exact-local-inventory' : 'unobservable-at-missing-path', updatedRecord,
    request: { base, baseSha, targetPath, expectedHead, pr, ...(mounted ? { mounted: true } : {}), createdAt } };
  return { ...body, digest: rebindDigest(body) };
}
function planLaneRebindCore({ cwd = process.cwd(), ref, mode, ...request }) {
  if (!isLaneRef(ref)) throw rebindBlock('ref', 'an exact agent/<device>/<scope> ref is required');
  if (mode === 'recertify') return planLaneRecertification({ cwd, ref, ...request });
  if (!['mounted', 'restore'].includes(mode)) throw rebindBlock('mode', 'mode must be mounted, restore or recertify');
  const root = repoRoot(cwd);
  if (currentBranch(root) !== 'main') throw rebindBlock('canonical', 'lane identity recovery must run from canonical main');
  const record = store.get(ref, root);
  if (!record && mode === 'mounted' && request.mounted === true)
    return planLaneRecertification({ cwd: root, ref, ...request });
  const publishedRestore = record?.state === 'published' && mode === 'restore' && Number.isSafeInteger(record.pr) && record.pr > 0;
  if (!record || record.state !== 'active' && !publishedRestore) throw rebindBlock('record', 'recovery requires one exact active lane or PR-bound published restore');
  if (!record.worktree || !isAbsolute(record.worktree) || !record.base || !record.baseSha) throw rebindBlock('record', 'lane record lacks an exact worktree or base binding');
  const targetPath = resolve(record.worktree), head = headSha(`refs/heads/${ref}`, root);
  if (!head) throw rebindBlock('branch', `local branch is missing: ${ref}`);
  if (!record.head || !headSha(record.head, root) || head !== record.head
    && observeGit(['merge-base', '--is-ancestor', record.head, head], { cwd: root, allowFail: true }) === null) throw rebindBlock('ancestry', 'observed branch is not the recorded head or its descendant');
  const registrations = worktrees(root), entry = registrations.find(row => row.branch === ref),
    pathEntry = registrations.find(row => row.path === targetPath);
  if (mode === 'mounted') {
    if (!entry || entry.path !== targetPath || currentBranch(targetPath) !== ref
      || headSha('HEAD', targetPath) !== head || realpathSync(targetPath) !== targetPath) throw rebindBlock('identity', 'mounted worktree, branch, path or head differs from its recorded identity');
  } else {
    if (entry || pathEntry || existsSync(targetPath)) throw rebindBlock('restore-path', 'recorded worktree path or branch is already mounted or occupied');
    const parent = resolve(targetPath, '..');
    if (realpathSync(parent) !== parent) throw rebindBlock('restore-parent', 'recorded parent path is not canonical');
  }
  const protectedHead = headSha(record.base, root);
  if (!protectedHead) throw rebindBlock('base', `recorded protected base is unavailable: ${record.base}`);
  const dirty = mode === 'mounted' ? laneDirtyEvidence(targetPath)
    : { entries: [], indexSha256: null, statusSha256: null, bytes: 0 };
  const writePaths = [...new Set([...(record.writePaths ?? []), ...laneChangedPaths(record.base, head, root),
    ...dirty.entries.map(row => row.path)])].sort();
  if (!writePaths.length || writePaths.length > REBIND_MAX_PATHS) throw rebindBlock('reservation', 'expanded reservation is empty or exceeds its bound');
  writePaths.forEach(validateRebindPath);
  try { assertDisjointReservation({ cwd: root, ref, writePaths, protectedRef: record.base, records: store.load(root).lanes }); }
  catch (error) { throw rebindBlock('path-overlap', error.message); }
  const remote = record.base.match(/^refs\/remotes\/([^/]+)\//u)?.[1],
    transport = publishedRestore && remote ? remoteTransport(remote, root) : null,
    remoteHead = !remote ? null : publishedRestore ? remoteRefSha(remote, ref, root, transport.fetchUrl)
      : headSha(`refs/remotes/${remote}/${ref}`, root);
  if (publishedRestore && remoteHead !== head) throw rebindBlock('published-head', 'live remote lane ref must exactly match the recorded published head');
  const body = { schema: REBIND_SCHEMA, mode, ref, root, targetPath,
    previousRecordSha256: rebindDigest(record), previousHead: record.head, head,
    protectedRef: record.base, protectedHead, baseSha: record.baseSha, remoteHead,
    refsSha256: refInventoryDigest(root), writePathsBefore: [...(record.writePaths ?? [])],
    writePathsAfter: writePaths, addedPaths: writePaths.filter(path => !(record.writePaths ?? []).includes(path)),
    dirty, restoredDirtyState: mode === 'restore' ? 'unobservable-at-missing-path' : 'exact-local-inventory',
    updatedRecord: { ...record, head, worktree: targetPath, writePaths, ...(mode === 'restore' ? { recovery: { schema: 'agentic-os/lane-recovery/v1', dirtyState: 'unobservable-at-missing-path' } } : {}) } };
  return { ...body, digest: rebindDigest(body) };
}
export const planLaneRebind = planLaneRebindCore;
function readLaneRebindPlan(path) {
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { throw rebindBlock('plan', 'plan file is unreadable JSON'); }
  if (!value || value.schema !== REBIND_SCHEMA || typeof value.digest !== 'string') throw rebindBlock('plan', 'plan schema is invalid');
  const { digest: expected, authorization: embeddedAuthorization, ...body } = value;
  if (embeddedAuthorization !== undefined && embeddedAuthorization !== `agentic-os:lane-rebind:${expected}`) throw rebindBlock('plan', 'plan authorization does not match its digest');
  if (rebindDigest(body) !== expected) throw rebindBlock('plan', 'plan digest does not match its contents');
  return value;
}
function laneRebindPostcondition(plan, root) {
  const entry = worktrees(root).find(row => row.branch === plan.ref);
  return entry?.path === plan.targetPath && currentBranch(plan.targetPath) === plan.ref
    && headSha('HEAD', plan.targetPath) === plan.head && headSha(`refs/heads/${plan.ref}`, root) === plan.head;
}
function laneRebindReceipt(plan, resumed) {
  return { schema: 'agentic-os/lane-rebind-receipt/v1', ref: plan.ref, mode: plan.mode,
    worktree: plan.targetPath, previousHead: plan.previousHead, head: plan.head,
    addedPaths: plan.addedPaths, restoredDirtyState: plan.restoredDirtyState,
    refsPreserved: true, committedBytesPreserved: true, authoredBytesPreserved: plan.mode === 'mounted',
    providerAuthority: false, integrationProof: false, cleanupAuthority: false, resumed };
}
export function applyLaneRebind({ cwd = process.cwd(), planPath, authorization, stopped }) {
  if (!stopped) throw rebindBlock('stopped', 'apply requires --stopped after writers have stopped');
  const root = repoRoot(cwd), plan = readLaneRebindPlan(resolve(planPath));
  if (root !== plan.root) throw rebindBlock('root', 'plan belongs to a different repository');
  if (authorization !== `agentic-os:lane-rebind:${plan.digest}`) throw rebindBlock('authorization', 'exact plan authorization is required');
  const lock = acquireOperationLock('agentic-os-lane-rebind', root);
  if (!lock) throw rebindBlock('busy', 'another lane identity recovery is active');
  let result, error = null;
  try {
    const current = store.get(plan.ref, root);
    if (rebindDigest(current) === rebindDigest(plan.updatedRecord) && laneRebindPostcondition(plan, root)) result = laneRebindReceipt(plan, true);
    else {
      if (rebindDigest(current) !== plan.previousRecordSha256) throw rebindBlock('record-drift', 'lane record changed after planning');
      const fresh = planLaneRebindCore({ cwd: root, ref: plan.ref, mode: plan.mode, ...plan.request });
      if (fresh.digest !== plan.digest) throw rebindBlock('stale-plan', 'live lane identity or byte inventory changed after planning');
      const beforeRefs = refInventoryDigest(root);
      if (plan.mode === 'restore' || plan.mode === 'recertify') git(['worktree', 'add', '--', plan.targetPath, plan.ref], { cwd: root });
      if (!laneRebindPostcondition(plan, root)) throw rebindBlock('postcondition', 'rebound checkout differs from the planned branch and head');
      if (plan.mode === 'recertify' && observeGit(['status', '--porcelain', '--untracked-files=all', '--ignored=traditional'], { cwd: plan.targetPath }) !== '')
        throw rebindBlock('postcondition', 'recertified checkout is not clean after materialization');
      if (refInventoryDigest(root) !== beforeRefs || beforeRefs !== plan.refsSha256) throw rebindBlock('refs-changed', 'branch or remote refs changed during recovery');
      if (plan.mode === 'mounted' && rebindDigest(laneDirtyEvidence(plan.targetPath)) !== rebindDigest(plan.dirty))
        throw rebindBlock('dirty-drift', 'authored worktree bytes changed during recovery');
      store.putExact(plan.updatedRecord, current, root); result = laneRebindReceipt(plan, false);
    }
  } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label: 'lane-rebind', result, error,
    artifacts: error?.reason?.startsWith('blocked-lane-rebind-') ? { planDigest: plan.digest,
      ref: plan.ref, mode: plan.mode, worktree: plan.targetPath, head: plan.head } : null });
}
export function runLaneRebind(root, argv, out) {
  try {
    if (positional(argv)[0] === 'plan') {
      const mode = option(argv, 'mode');
      const request = mode === 'recertify' ? { base: option(argv, 'base'), baseSha: option(argv, 'base-sha'),
        targetPath: option(argv, 'worktree'), expectedHead: option(argv, 'expected-head'),
        pr: option(argv, 'pr') === null ? null : Number(option(argv, 'pr')) } : {};
      const plan = planLaneRebindCore({ cwd: root, ref: option(argv, 'ref'), mode, ...request });
      out(JSON.stringify({ ...plan, authorization: `agentic-os:lane-rebind:${plan.digest}` }));
      return 0;
    }
    out(JSON.stringify(applyLaneRebind({ cwd: root, planPath: option(argv, 'plan'),
      authorization: option(argv, 'authorize'), stopped: flag(argv, 'stopped') })));
    return 0;
  } catch (error) {
    out(JSON.stringify({ error: error.reason ?? 'blocked-lane-rebind', message: error.message }));
    return 1;
  }
}
