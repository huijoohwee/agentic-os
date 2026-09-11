import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { prepareFixture, enrollPeer, readEnvelope, run } from '../test/collaboration-cloud-fixture.mjs';
import { hostIdentity, verifyPeers, verifyRemoteProof } from '../test/collaboration-cloud-proof.mjs';

test('cloud identity requires a boot UUID instead of reusable image hostnames', () => {
  const first = hostIdentity(true, '11111111-1111-4111-8111-111111111111');
  const second = hostIdentity(true, '22222222-2222-4222-8222-222222222222');
  assert.equal(first.hostIdentitySource, 'linux-boot-id'); assert.notEqual(first.hostDigest, second.hostDigest);
  assert.throws(() => hostIdentity(true, 'runnervm'), /Linux boot UUID required/u);
  assert.throws(() => hostIdentity(true, ''), /Linux boot UUID required/u);
  assert.equal(hostIdentity(false, 'runnervm').hostIdentitySource, 'hostname');
});

test('independent enrolled processes verify race, disjoint work, stopped handoff and remote history', { timeout: 60000 }, async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentic-os-cloud-proof-')));
  const children = [];
  t.after(async () => {
    await Promise.all(children.filter(child => child.exitCode === null && child.signalCode === null).map(child => {
      const closed = once(child, 'close'); child.kill('SIGKILL'); return closed;
    }));
    rmSync(root, { recursive: true });
  });
  const remote = join(root, 'remote.git'); run(root, ['init', '--bare', '--quiet', remote]);
  const input = join(root, 'enrollment');
  const envelope = prepareFixture(input, { remote, runId: '100-1', runtimeSha: 'a'.repeat(40), startDelayMs: 3000 });
  const fixtureModule = new URL('../test/collaboration-cloud-fixture.mjs', import.meta.url).href;
  const proofModule = new URL('../test/collaboration-cloud-proof.mjs', import.meta.url).href;
  const launch = role => {
    const output = join(root, `${role}.json`), destination = join(root, role);
    const program = `import {enrollPeer,writeProof} from ${JSON.stringify(fixtureModule)};
      import {exercisePeer} from ${JSON.stringify(proofModule)};
      try { const peer=enrollPeer(${JSON.stringify(input)},${JSON.stringify(destination)});
      const proof=await exercisePeer(peer,${JSON.stringify(role)},{pollMs:10,phaseMs:15000});
      writeProof(${JSON.stringify(output)},proof);
      } catch(error) { console.error(error.stack);process.exitCode=1; }`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program]); let stderr = '';
    child.stdout.resume(); child.stderr.on('data', data => { stderr += data; });
    children.push(child);
    return once(child, 'close').then(([code]) => { assert.equal(code, 0, stderr); return JSON.parse(readFileSync(output)); });
  };
  const peers = await Promise.all(['a', 'b'].map(launch));
  const verifier = enrollPeer(input, join(root, 'verify'));
  const result = verifyRemoteProof(verifier, peers);
  assert.equal(result.remainingTasks, 0); assert.equal(result.remoteHistoryVerified, true);
  assert.equal(result.concurrentClaims, 2); assert.equal(result.exactRaceWinners, 1);
  assert.throws(() => verifyPeers(envelope, peers, { requireCloud: true }));
  const sameBoot = structuredClone(peers);
  for (const p of sameBoot) Object.assign(p, { cloud: true, ...hostIdentity(true, '11111111-1111-4111-8111-111111111111') });
  assert.throws(() => verifyPeers(envelope, sameBoot, { requireCloud: true }), /distinct hosted machines/u);
  for (const mutate of [p => { p[1].runtimeSha = 'b'.repeat(40); },
    p => { p[1].race.won = p[0].race.won; }, p => { p[0].dirtyDraftsPreserved = false; },
    p => { p[1].finalRevision = 'b'.repeat(40); }]) {
    const changed = structuredClone(peers); mutate(changed);
    assert.throws(() => verifyPeers(envelope, changed));
  }
  const forged = structuredClone(peers); forged.find(p => p.race.won).race.revision = 'b'.repeat(40);
  assert.throws(() => verifyRemoteProof(verifier, forged), /published history/u);
  const repeated = prepareFixture(join(root, 'second'), { remote, runId: '101-1', runtimeSha: 'a'.repeat(40) });
  assert.equal(repeated.contextSha, envelope.contextSha, 'fixed synthetic workspace commit reused');
  assert.throws(() => prepareFixture(join(root, 'blocked'), { remote, runId: '102-1', runtimeSha: 'a'.repeat(40) }), /retained tasks/u);
  const altered = JSON.parse(readFileSync(join(input, 'enrollment.json'))); altered.bundleSha256 = '0'.repeat(64);
  writeFileSync(join(input, 'enrollment.json'), JSON.stringify(altered));
  assert.throws(() => enrollPeer(input, join(root, 'corrupt')));
  altered.boardRef = 'refs/heads/main'; writeFileSync(join(input, 'enrollment.json'), JSON.stringify(altered));
  assert.throws(() => readEnvelope(join(input, 'enrollment.json')));
});
