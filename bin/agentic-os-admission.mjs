/** Same-mission START admission. Local economy evidence never grants provider authority. */
import { basename, dirname, resolve } from 'node:path';
import { acquireOperationLock, finishOperationLock, currentBranch, git, gitLines, headSha,
  fetch as gitFetch, observeGit, remoteRefSha, remoteTransport, worktrees } from '../src/git.mjs';
import { assertDevice, deviceSegment, laneRef } from '../src/lane-id.mjs';
import * as store from '../src/lane-records.mjs';
import { successorLineage } from '../src/lane-state.mjs';
import { isBoundLane } from '../src/guard-main.mjs';
import { provision, assertProvisionable, assertDisjointReservation, committedLanePaths, lanePath, parseWritePaths } from '../src/worktree.mjs';
import { assertProfileCurrent } from './agentic-os-auxiliary.mjs';
import { option, positional, flag } from './agentic-os-argv.mjs';
import { hash } from './agentic-os-test-inputs.mjs';
import { startWorkflow, readSelectedWorkflow, collectWorkflowValue, assertWorkflowEffect, workflowPaths, validateWorkflowPlanning, WORKFLOW_PHASES } from './agentic-os-workflow.mjs';

const fail = (reason, message, facts = {}) => { throw Object.assign(new Error(message), { reason: `blocked-admission-${reason}`, ...facts }); };
const scopeDigest = paths => hash(JSON.stringify([...paths].sort()));
const covered = (path, paths) => paths.some(parent => path === parent || path.startsWith(`${parent}/`));
const limitValue = text => {
  if (text === null) return null;
  if (!/^(0|[1-9][0-9]?)$/u.test(text) || Number(text) > 32) fail('allowance', 'checkout-limit must be an explicit integer from 0 to 32');
  return Number(text);
};
const selectedAgain = (root, repository, prior) => {
  const fresh = readSelectedWorkflow(root, repository, { input: prior.path, required: true });
  if (fresh.digest !== prior.digest) fail('workflow-drift', 'Selected immutable workflow changed; retain the allocation and re-read its successor');
  return fresh;
};
function successor(root, repository, selected, changes) {
  selectedAgain(root, repository, selected);
  const workspace = workflowPaths(root, repository).workspace;
  // Stored member paths are workspace-relative; resolved child paths are already digest verified.
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
  const consumed = new Set((selected.manifest.allocations ?? []).filter(row => own.has(row.worktreeId)).map(row => row.worktreeId));
  for (const row of inventory) if (own.has(basename(row.path))) consumed.add(basename(row.path));
  return { limit: selected.manifest.execution?.checkoutLimit ?? explicitLimit, consumed: consumed.size, worktreeIds: [...consumed].sort() };
}
function observeExisting(root, ref, path, record, expectedHead, requested, policy) {
  const registered = worktrees(root).find(row => row.branch === ref && row.path === path);
  if (!registered || !record || record.state !== 'active' || record.worktree !== path || !isBoundLane(ref, path)
    || currentBranch(path) !== ref || record.pr !== null) fail('existing-identity', 'Reuse requires one live bound active unpublished lane');
  const head = headSha('HEAD', path);
  if (expectedHead && head !== expectedHead) fail('head-drift', 'The active lane no longer has the expected head');
  if (registered.head && registered.head !== head) fail('head-drift', 'Registered head changed');
  if (!record.baseSha || observeGit(['merge-base', '--is-ancestor', record.baseSha, head], { cwd: root, allowFail: true }) === null)
    fail('base-binding', 'The existing lane must retain its admitted source ancestry');
  const reserved = parseWritePaths((record.writePaths ?? []).join(','));
  const authored = [...committedLanePaths(head, headSha(policy.protectedRef, root), root),
    ...gitLines(['diff', '--name-only', 'HEAD'], { cwd: path }),
    ...gitLines(['ls-files', '--others', '--exclude-standard'], { cwd: path })];
  if (authored.some(file => !covered(file, reserved))) fail('unreserved-bytes', 'Preserve authored bytes outside the current reservation; do not adopt them');
  const remote = policy.protectedRef.match(/^refs\/remotes\/([^/]+)\//u)?.[1];
  if (!remote) fail('remote', 'Protected remote binding is missing');
  const transport = remoteTransport(remote, root);
  if (remoteRefSha(remote, ref, root, transport.fetchUrl) !== null) fail('published', 'Published candidates are immutable; use the native successor operation');
  assertDisjointReservation({ cwd: root, ref, writePaths: requested, protectedRef: policy.protectedRef, records: store.load(root).lanes });
  const lineage = successorLineage(record);
  if (lineage === false) fail('successor-lineage', 'Invalid retained successor identity');
  if (lineage && (remoteRefSha(remote, lineage.predecessorRef, root, transport.fetchUrl) !== lineage.predecessorHead
    || observeGit(['merge-base', '--is-ancestor', lineage.predecessorHead, head], { cwd: root, allowFail: true }) === null))
    fail('successor-lineage', 'Retained successor needs exact published predecessor and preserved ancestry');
  return { head, reserved, lineage };
}

export async function cmdStart(root, argv, policy, profile, services) {
  const { out, err, projectCache, effectReceipt, remoteName, requireCanonical } = services;
  requireCanonical(root, policy);
  const [scope] = positional(argv), device = assertDevice(option(argv, 'device') ?? deviceSegment());
  if (!scope) { err('usage: start <scope> --write=<paths>'); return 1; }
  const ref = laneRef(scope, device);
  let path = lanePath(scope, device, root), worktreeId = basename(path);
  const requested = option(argv, 'write') === null ? [] : parseWritePaths(option(argv, 'write'));
  const planningPath = option(argv, 'plan'), input = option(argv, 'mission'), explicitLimit = limitValue(option(argv, 'checkout-limit'));
  const readmit = flag(argv, 'readmit'), expectedHead = option(argv, 'expected-head');
  if (expectedHead !== null && !/^[a-f0-9]{40}$/u.test(expectedHead)) fail('head', 'expected-head must be an exact commit SHA');
  if (readmit && (!input || !expectedHead)) fail('readmit-binding', 'readmit requires an exact mission and expected-head');
  const lock = acquireOperationLock('agentic-os-start', root);
  if (!lock) { err('blocked-concurrent-start: another lane admission owns the clone-wide start lock'); return 1; }
  let result, error, selected, allocation;
  const artifacts = { effectsRetained: false, ref, worktree: null, baseSha: null,
    protectedRef: policy.protectedRef, fetchedProtectedSha: null, fetchCompleted: false,
    provisioned: false, branchSha: null, registeredWorktree: null, pathExists: false,
    fetchReceipt: null, provisionReceipt: null, allocation: null, workflow: null };
  try {
    const records = store.load(root).lanes;
    const bound = worktrees(root).find(row => row.branch === ref);
    if (bound) { path = bound.path; worktreeId = basename(path); }
    selected = readSelectedWorkflow(root, profile.repository, { input, required: input !== null, worktreeId, ref });
    const enrolled = Boolean(selected?.manifest.execution || input || planningPath || explicitLimit !== null || readmit);
    // A mission pointer is evidence, not a selector override. Refuse before any effect.
    if (input && selected) selectedAgain(root, profile.repository, selected);
    if (enrolled) {
      if (!selected?.manifest.execution && explicitLimit === null) fail('allowance-required', 'Declare the mission checkout limit before creation or explicit legacy adoption');
      if (selected?.manifest.execution && explicitLimit !== null && selected.manifest.execution.checkoutLimit !== explicitLimit)
        fail('allowance-drift', 'A retry cannot reset or enlarge the existing mission allowance');
      if (selected && planningPath && selected.manifest.planning.path !== planningPath) fail('planning-drift', 'The selected mission binds a different plan');
      if (!selected && !planningPath) fail('plan-required', 'A new declared mission requires a committed planning document');
      if (!selected) validateWorkflowPlanning(root, profile.repository,
        { revision: headSha(policy.protectedRef, root), planningPath });
      const row = selected?.manifest.allocations?.find(item => item.worktreeId === worktreeId);
      const registered = worktrees(root).find(item => item.branch === ref || item.path === path);
      if (registered) {
        const record = records[ref], identity = observeExisting(root, ref, path, record, expectedHead, requested, policy);
        if (!selected) fail('mission-required', 'Existing lanes need their exact workflow identity; no new root is created for reuse');
        if (!selected.members.some(item => item.child.context.worktreeId === worktreeId && item.child.source.repository === profile.repository))
          fail('member-binding', 'The existing lane is not a member of the selected mission');
        const liveDigest = scopeDigest(identity.reserved);
        const recoveringReadmit = row?.state === 'pending' && row.operation === 'readmit';
        const successorReadmit = row && row.ref !== ref && identity.lineage?.predecessorRef === row.ref;
        if (successorReadmit && !readmit) fail('successor-readmit', 'Explicit readmit must bind the retained successor to its existing mission slot');
        if (row && (row.path !== path || (row.ref !== ref && !successorReadmit) ||
          (row.writeDigest !== liveDigest && !successorReadmit && !(recoveringReadmit && row.previousWriteDigest === liveDigest))))
          fail('reservation-drift', 'Native scope evidence no longer matches the live lane projection');
        if (!readmit && requested.some(file => !covered(file, identity.reserved))) fail('scope-expansion', 'Use explicit active readmit for additional paths');
        if (row?.state === 'pending' && (!expectedHead || row.headRevision !== identity.head || (recoveringReadmit && !readmit)))
          fail('recovery-required', 'Pending allocation requires exact retained-head reconciliation; do not reprovision');
        const writePaths = readmit ? [...new Set([...identity.reserved, ...requested])].sort() : identity.reserved;
        const nextDigest = scopeDigest(writePaths);
        if (recoveringReadmit && nextDigest !== row.writeDigest)
          fail('recovery-scope', 'Retry must retain the exact pending reservation expansion');
        if (!selected.manifest.execution) selected = successor(root, profile.repository, selected,
          { execution: { version: 1, checkoutLimit: explicitLimit, dependencies: { version: 1, edges: [] } } });
        // Capture explicitly bound private candidate changes in a new immutable member.
        if (expectedHead) selected = withMember(root, profile.repository, selected, worktreeId, identity.head);
        assertWorkflowEffect({ root, repository: profile.repository, phase: 'preparation', worktreeId, revision: identity.head, ref });
        allocation = { worktreeId, ref, path, baseRevision: record.baseSha, headRevision: identity.head,
          writeDigest: nextDigest, state: readmit ? 'pending' : 'active', operation: readmit ? 'readmit' : row?.operation ?? 'create',
          ...(readmit ? { previousWriteDigest: recoveringReadmit ? row.previousWriteDigest : successorReadmit ? row.writeDigest : liveDigest } : {}),
          ...(successorReadmit ? { predecessorRef: row.ref } : row?.predecessorRef ? { predecessorRef: row.predecessorRef } : {}) };
        if (JSON.stringify(row) !== JSON.stringify(allocation)) selected = recordAllocation(root, profile.repository, selected, allocation);
        if (readmit) {
          selectedAgain(root, profile.repository, selected);
          observeExisting(root, ref, path, store.get(ref, root), identity.head, writePaths, policy);
          if (liveDigest !== nextDigest) store.putExact({ ...record, writePaths }, record, root);
          const { previousWriteDigest, ...completed } = allocation;
          allocation = { ...completed, state: 'active' };
          selected = recordAllocation(root, profile.repository, selected, allocation);
        }
        out(JSON.stringify({ schema: 'agentic-os/start-admission/v1', authority: false, status: readmit ? 'readmitted' : 'reused',
          ref, worktree: path, head: identity.head, writeDigest: allocation.writeDigest, workflow: selected.path, digest: selected.digest, created: false }));
        result = 0;
      } else {
        if (readmit) fail('readmit-missing', 'No registered existing lane matches the readmission request');
        if (row) fail('recovery-required', 'A retained allocation still consumes capacity; reconcile it without another checkout');
        const limit = selected?.manifest.execution?.checkoutLimit ?? explicitLimit;
        const capacity = selected ? checkoutCapacity(selected, profile.repository, worktrees(root), explicitLimit) : { consumed: 0 };
        if (limit === 0 || capacity.consumed >= limit) fail('capacity', 'Mission checkout allowance is exhausted; complete an existing eligible lane', { capacity: { ...capacity, limit } });
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
      const fetched = effectReceipt('fetch', gitFetch(remoteName(policy, root), root));
      Object.assign(artifacts, { fetchReceipt: fetched, fetchCompleted: true, fetchedProtectedSha: headSha(policy.protectedRef, root) });
      artifacts.effectsRetained ||= fetched.effectsRetained;
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
      artifacts[retained.operation === 'fetch' ? 'fetchReceipt' : 'provisionReceipt'] = retained;
      artifacts.branchSha = retained.branchSha ?? null;
      artifacts.registeredWorktree = retained.registeredWorktree ?? null;
      artifacts.pathExists = retained.pathExists === true;
      artifacts.worktree = retained.path ?? retained.registeredWorktree?.path ?? artifacts.worktree;
      artifacts.effectsRetained ||= retained.effectsRetained === true;
    }
  }
  return finishOperationLock(lock, { label: 'start', result, error, artifacts });
}
