/** Two independent workers exercise the real collaboration owner over a shared Git transport. */
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { openSync, readSync, closeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { observeBoard, updateBoard } from '../bin/agentic-os-collaboration-store.mjs';
import { validateBoard } from '../bin/agentic-os-collaboration.mjs';
import { hash, run, checkoutState } from './collaboration-cloud-fixture.mjs';

function bootIdentity() {
  // procfs reports size zero; read a fixed buffer instead of using a regular-file size check.
  const descriptor = openSync('/proc/sys/kernel/random/boot_id', 'r'), bytes = Buffer.alloc(64);
  try { return bytes.subarray(0, readSync(descriptor, bytes, 0, bytes.length, 0)).toString('utf8').trim(); }
  finally { closeSync(descriptor); }
}
export function hostIdentity(cloud, identity = cloud ? bootIdentity() : hostname()) {
  if (cloud) assert.match(identity, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u, 'Linux boot UUID required');
  return { hostDigest: hash(identity), hostIdentitySource: cloud ? 'linux-boot-id' : 'hostname' };
}

export async function exercisePeer(peer, role, { cloud = false, pollMs = 1000, phaseMs = 60000 } = {}) {
  assert.ok(['a', 'b'].includes(role));
  const { context, envelope } = peer, startedAt = Date.now(), events = [];
  const actor = { device: `${cloud ? 'github' : 'local'}-${envelope.runId}-${role}`,
    agent: `probe-${role}`, provider: 'native-test', model: 'none' };
  const id = suffix => `probe-${envelope.runId}-${suffix}`;
  const stopAt = envelope.startAt + 240000;
  const proof = { schema: 'agentic-os/cloud-collaboration-peer/v1', role, cloud, actor,
    ...hostIdentity(cloud), runId: envelope.runId, runtimeSha: envelope.runtimeSha,
    sourceSha: envelope.sourceSha, contextSha: envelope.contextSha,
    startedAt, raceRevision: envelope.revision, events, modelsInvoked: 0, tokens: 0,
    grantsAuthority: false, productEffects: false, status: 'running' };
  const full = snapshot => validateBoard(JSON.parse(run(context.source, ['show', `${snapshot.revision}:board.json`])));
  const inspect = () => {
    assert.ok(Date.now() < stopAt, 'proof deadline');
    const snapshot = observeBoard(context); return { ...snapshot, board: full(snapshot) };
  };
  const task = (snapshot, suffix) => snapshot.board.tasks.find(t => t.id === id(suffix));
  async function waitFor(predicate, label) {
    const end = Math.min(stopAt, Date.now() + phaseMs);
    for (let attempt = 0; attempt < 48 && Date.now() < end; attempt++) {
      const snapshot = inspect(); if (predicate(snapshot)) return snapshot;
      await delay(pollMs);
    }
    throw Error(`cloud-proof-phase-timeout:${label}`);
  }
  const mutate = (operation, suffix, fields = {}) => {
    const snapshot = inspect();
    const receipt = updateBoard(context, operation, { expectedRevision: snapshot.revision, id: id(suffix), actor, ...fields });
    events.push({ operation, suffix, revision: receipt.revision, epoch: receipt.task?.epoch ?? fields.epoch,
      at: Date.now() }); return receipt;
  };
  const claim = suffix => mutate('claim', suffix);
  const reject = (operation, suffix, fields, pattern, label) => {
    assert.throws(() => mutate(operation, suffix, fields), pattern);
    events.push({ operation: 'refused', check: label, at: Date.now() });
  };
  const report = (suffix, epoch) => mutate('report', suffix, { epoch, result: {
    outcome: 'success', summary: 'Synthetic coordination checks complete; worker effects stopped.',
    sourceRevision: envelope.sourceSha, refs: [], tokens: 0, stopped: true } });
  const archive = (suffix, epoch) => mutate('archive', suffix, { epoch });
  try {
    assert.ok(Date.now() <= envelope.startAt + 5000, 'late worker; do not claim an old race');
    await delay(Math.max(0, envelope.startAt - Date.now()));
    let owned;
    try {
      owned = updateBoard(context, 'claim', { expectedRevision: envelope.revision, id: id('race'), actor });
      proof.race = { won: true, revision: owned.revision, epoch: owned.task.epoch };
    } catch (error) {
      assert.match(error.message, /stale-revision-refresh|publication-not-current-reconcile/u);
      proof.race = { won: false, error: error.message, candidate: error.operationArtifacts?.candidateOid ?? null };
    }
    if (owned) {
      reject('release', 'race', { epoch: owned.task.epoch, stopped: false }, /stop-ack-required/u, 'stop-required');
      const released = mutate('release', 'race', { epoch: owned.task.epoch, stopped: true });
      proof.released = { revision: released.revision, epoch: owned.task.epoch };
      const handed = await waitFor(s => task(s, 'race')?.state === 'active'
        && task(s, 'race')?.actor.device !== actor.device, 'new holder');
      assert.ok(task(handed, 'race').epoch > owned.task.epoch);
      reject('renew', 'race', { epoch: owned.task.epoch }, /fence/u, 'stale-writer');
      const left = claim('left');
      const simultaneous = await waitFor(s => task(s, 'right')?.state === 'active', 'disjoint peer');
      assert.equal(simultaneous.board.tasks.filter(t => t.state === 'active').length, 2);
      assert.equal(task(simultaneous, 'left').actor.device, actor.device);
      proof.disjointRevision = simultaneous.revision;
      report('left', left.task.epoch);
      await waitFor(s => !task(s, 'right'), 'peer archive'); archive('left', left.task.epoch);
      // Finish the rejected fixture task only after its conflicting writer has stopped.
      const overlap = claim('overlap'); report('overlap', overlap.task.epoch); archive('overlap', overlap.task.epoch);
    } else {
      const released = await waitFor(s => task(s, 'race')?.state === 'released', 'stopped holder');
      const previousEpoch = task(released, 'race').epoch;
      const next = claim('race'); assert.ok(next.task.epoch > previousEpoch);
      proof.takeover = { revision: next.revision, epoch: next.task.epoch, previousEpoch };
      // The primary claims left only after the old-epoch mutation was refused.
      await waitFor(s => task(s, 'left')?.state === 'active', 'stale fence checked');
      report('race', next.task.epoch); archive('race', next.task.epoch);
      reject('claim', 'overlap', {}, /write-overlap/u, 'overlapping-writer');
      const right = claim('right'), board = full(right);
      assert.equal(board.tasks.filter(t => t.state === 'active').length, 2);
      proof.disjointRevision = right.revision;
      await waitFor(s => task(s, 'left')?.state === 'reported', 'primary stopped');
      report('right', right.task.epoch); archive('right', right.task.epoch);
    }
    const final = await waitFor(s => s.board.tasks.length === 0, 'empty retained board');
    proof.finalRevision = final.revision;
    assert.equal(observeBoard(context, { offline: true }).status, 'offline-context-only');
    assert.deepEqual(checkoutState(peer.root), peer.before.consumer);
    assert.deepEqual(checkoutState(peer.workspace), peer.before.workspace);
    Object.assign(proof, { status: 'passed', checkoutPreserved: true, indexPreserved: true,
      dirtyDraftsPreserved: true, finalActive: 0, completedAt: Date.now() });
    return proof;
  } catch (error) {
    // Do not adopt or release the other worker's claims. Preserve partial board history for inspection.
    Object.assign(proof, { status: 'failed', error: error.message, completedAt: Date.now() });
    throw Object.assign(error, { proof });
  }
}

export function verifyPeers(envelope, peers, { requireCloud = false } = {}) {
  assert.equal(peers.length, 2); assert.deepEqual(peers.map(p => p.role).sort(), ['a', 'b']);
  for (const p of peers) {
    assert.equal(p.schema, 'agentic-os/cloud-collaboration-peer/v1'); assert.equal(p.status, 'passed');
    for (const key of ['runId', 'runtimeSha', 'sourceSha', 'contextSha']) assert.equal(p[key], envelope[key]);
    assert.equal(p.raceRevision, envelope.revision); assert.equal(p.finalActive, 0);
    for (const key of ['checkoutPreserved', 'indexPreserved', 'dirtyDraftsPreserved']) assert.equal(p[key], true);
    assert.equal(p.modelsInvoked, 0); assert.equal(p.tokens, 0); assert.equal(p.grantsAuthority, false);
    assert.equal(p.productEffects, false); assert.ok(p.startedAt <= envelope.startAt + 5000);
    if (requireCloud) { assert.equal(p.cloud, true); assert.equal(p.hostIdentitySource, 'linux-boot-id'); }
  }
  assert.notEqual(peers[0].actor.device, peers[1].actor.device);
  if (requireCloud) assert.notEqual(peers[0].hostDigest, peers[1].hostDigest, 'distinct hosted machines');
  assert.ok(Math.max(...peers.map(p => p.startedAt)) < Math.min(...peers.map(p => p.completedAt)), 'overlapping workers');
  assert.equal(peers.filter(p => p.race.won).length, 1, 'one exact-revision winner');
  const winner = peers.find(p => p.race.won), successor = peers.find(p => !p.race.won);
  assert.equal(winner.released.epoch, successor.takeover.previousEpoch);
  assert.ok(successor.takeover.epoch > winner.released.epoch);
  for (const name of ['stop-required', 'stale-writer', 'overlapping-writer'])
    assert.ok(peers.some(p => p.events.some(e => e.operation === 'refused' && e.check === name)), name);
  assert.equal(peers[0].disjointRevision, peers[1].disjointRevision);
  assert.equal(peers[0].finalRevision, peers[1].finalRevision);
  return { schema: 'agentic-os/cloud-collaboration-proof/v1', status: 'passed',
    runtimeSha: envelope.runtimeSha, sourceSha: envelope.sourceSha, contextSha: envelope.contextSha,
    runId: envelope.runId, boardRef: envelope.boardRef, finalRevision: winner.finalRevision,
    cloudMachines: requireCloud ? 2 : 0, independentClones: 2, concurrentClaims: 2,
    exactRaceWinners: 1, stopAcknowledgementRequired: true, staleWriterRefused: true,
    overlappingWriterRefused: true, explicitHandoffVerified: true, dirtyDraftsPreserved: true,
    remainingTasks: 0, modelsInvoked: 0, privateWorkspaceAccessed: false, grantsAuthority: false };
}

/** Independently re-read the remote commit evidence instead of accepting worker flags alone. */
export function verifyRemoteProof(peer, peers, options = {}) {
  const proof = verifyPeers(peer.envelope, peers, options), { context, envelope } = peer;
  const current = observeBoard(context);
  assert.equal(current.revision, proof.finalRevision); assert.equal(current.tasks.length, 0);
  const history = run(context.source, ['rev-list', '--max-count=41', `${envelope.revision}..${current.revision}`])
    .split('\n').filter(Boolean);
  assert.ok(history.length > 0 && history.length <= 40, 'bounded proof history');
  run(context.source, ['merge-base', '--is-ancestor', envelope.revision, current.revision]);
  const boards = new Map(history.map(sha => [sha,
    validateBoard(JSON.parse(run(context.source, ['show', `${sha}:board.json`])))]));
  for (const board of boards.values()) for (const task of board.tasks) {
    assert.ok(task.id.startsWith(`probe-${envelope.runId}-`), 'foreign task');
    assert.equal(task.sourceRevision, envelope.sourceSha); assert.equal(task.contextRevision, envelope.contextSha);
  }
  const get = (revision, suffix) => {
    assert.ok(boards.has(revision), 'evidence must belong to the published history');
    return boards.get(revision).tasks.find(t => t.id === `probe-${envelope.runId}-${suffix}`);
  };
  const winner = peers.find(p => p.race.won), successor = peers.find(p => !p.race.won);
  const won = get(winner.race.revision, 'race'), released = get(winner.released.revision, 'race');
  const takeover = get(successor.takeover.revision, 'race');
  assert.equal(won.state, 'active'); assert.deepEqual(won.actor, winner.actor); assert.equal(won.epoch, winner.race.epoch);
  assert.equal(released.state, 'released'); assert.deepEqual(released.actor, winner.actor); assert.equal(released.epoch, won.epoch);
  assert.equal(takeover.state, 'active'); assert.deepEqual(takeover.actor, successor.actor);
  assert.equal(takeover.epoch, successor.takeover.epoch); assert.ok(takeover.epoch > won.epoch);
  const left = get(winner.disjointRevision, 'left'), right = get(winner.disjointRevision, 'right');
  assert.equal(left.state, 'active'); assert.equal(right.state, 'active');
  assert.deepEqual(left.actor, winner.actor); assert.deepEqual(right.actor, successor.actor);
  assert.deepEqual(left.writePaths, ['proof/left']); assert.deepEqual(right.writePaths, ['proof/right']);
  for (const p of peers) for (const event of p.events.filter(e => e.operation === 'report')) {
    const result = get(event.revision, event.suffix);
    assert.equal(result.state, 'reported'); assert.deepEqual(result.actor, p.actor);
    assert.equal(result.result.stopped, true); assert.equal(result.result.tokens, 0);
  }
  return { ...proof, publishedTransitionsVerified: history.length, remoteHistoryVerified: true };
}
