#!/usr/bin/env node
/** Manual public-repository canary. No private context, durable credentials or product execution. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, appendFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { prepareFixture, enrollPeer, readEnvelope, writeProof, removeFixture, run } from './collaboration-cloud-fixture.mjs';
import { exercisePeer, verifyRemoteProof } from './collaboration-cloud-proof.mjs';

function environment() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
  const repository = process.env.GITHUB_REPOSITORY, runId = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u); assert.match(runId, /^[0-9]+-[0-9]+$/u);
  const runtimeSha = run(process.cwd(), ['rev-parse', 'HEAD']); assert.equal(runtimeSha, process.env.GITHUB_SHA);
  assert.match(runtimeSha, /^[a-f0-9]{40}$/u);
  const temporary = realpathSync(process.env.RUNNER_TEMP);
  return { repository, runId, runtimeSha, temporary, remote: `https://github.com/${repository}.git` };
}
function inside(root, value) {
  const path = resolve(value ?? ''), rel = relative(root, path);
  assert.ok(rel && !rel.startsWith('..') && !rel.startsWith('/'), 'proof path must be under RUNNER_TEMP');
  return path;
}
async function main() {
  const [operation, inputArgument, outputArgument, role] = process.argv.slice(2), env = environment();
  assert.ok(['prepare', 'peer', 'verify'].includes(operation));
  assert.equal(process.argv.length - 2, operation === 'prepare' ? 2 : operation === 'peer' ? 4 : 3);
  if (operation === 'peer') assert.ok(['a', 'b'].includes(role));
  if (operation === 'prepare') {
    assert.equal(outputArgument, undefined);
    const info = JSON.parse(execFileSync('gh', ['api', `repos/${env.repository}`], { encoding: 'utf8',
      timeout: 15000, maxBuffer: 65536 }));
    assert.equal(info.private, false, 'standard public runners only');
    const output = inside(env.temporary, inputArgument);
    const result = prepareFixture(output, env);
    console.log(JSON.stringify({ schema: result.schema, runId: result.runId, runtimeSha: result.runtimeSha })); return;
  }
  const input = inside(env.temporary, inputArgument), output = inside(env.temporary, outputArgument);
  const envelope = readEnvelope(join(input, 'enrollment.json'));
  assert.equal(envelope.runId, env.runId); assert.equal(envelope.runtimeSha, env.runtimeSha);
  assert.equal(envelope.remote, env.remote, 'public proof remote only');
  const work = join(env.temporary, `collaboration-${operation}-${role ?? 'verifier'}`);
  const peer = enrollPeer(input, work); let success = false;
  try {
    if (operation === 'peer') {
      const proof = await exercisePeer(peer, role, { cloud: true }); writeProof(output, proof);
      console.log(JSON.stringify({ role, status: proof.status, raceWinner: proof.race.won }));
    } else {
      assert.equal(role, undefined);
      const peers = ['a', 'b'].map(name => JSON.parse(readBoundedFile(join(input, `peer-${name}.json`), 65536, 'peer proof')));
      const proof = verifyRemoteProof(peer, peers, { requireCloud: true }); writeProof(output, proof);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `Two cloud runners passed Git coordination for \`${env.runtimeSha}\`.\n\n` +
        `One race winner; two disjoint claims; overlap/stale-writer refusal; explicit stopped handoff; zero remaining tasks.\n\n` +
        `Synthetic workspace only. No private workspace access, model calls or release authority.\n`);
      console.log(JSON.stringify(proof));
    }
    success = true;
  } catch (error) {
    if (error.proof) writeProof(output, error.proof);
    throw error;
  } finally {
    // A failure retains its clone and candidate objects for diagnostics until the ephemeral job ends.
    if (success) removeFixture(work);
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
