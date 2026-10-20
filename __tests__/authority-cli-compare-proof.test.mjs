import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fixture, HEAD, PUBLICATION, BASE_TREE, EVIDENCE_TREE } from './fixtures/authority-cli-fixture.mjs';

test('owner-local issuance replays oversized evidence trees with bounded compare proof', async (t) => {
  const options = {};
  const api = fixture(t, options);
  const first = await api.run();
  assert.equal(first.code, 0, first.stderr.values.join(''));

  const readsBefore = api.calls.length;
  options.oversizedEvidenceTree = true;

  const replay = await api.run();
  assert.equal(replay.code, 0, replay.stderr.values.join(''));

  const laterCalls = api.calls.slice(readsBefore);
  assert.ok(laterCalls.some((call) => call.route === `GET /repos/example/evidence/compare/${HEAD}...${PUBLICATION}`));
  assert.ok(!laterCalls.some((call) => call.route === `GET /repos/example/evidence/git/trees/${BASE_TREE}`));
  assert.ok(!laterCalls.some((call) => call.route === `GET /repos/example/evidence/git/trees/${EVIDENCE_TREE}`));
});
