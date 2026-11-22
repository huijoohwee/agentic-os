import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveCloseoutVerdict } from '../bin/agentic-os-completion-status.mjs';

const base = {
  sourceIntegrated: true,
  canonicalCurrent: true,
  laneMounted: true,
  laneClean: true,
  laneHead: true,
  deployBound: false,
  localPolicyCandidate: false,
  findingCodes: [],
};

test('completion status distinguishes stale mounted residue from deliberate retention', () => {
  const stale = deriveCloseoutVerdict({
    ...base,
    quarantineProfile: true,
    quarantineObserved: false,
    ref: 'agent/device/stale-residue',
  });
  assert.equal(stale.laneDisposition, 'awaiting-cleanup');
  assert.equal(stale.residueDisposition, 'stale-mounted');
  assert.equal(stale.nextAction.id, 'release-common-complete');
  assert.equal(stale.nextAction.command, 'npm run release:common -- complete --ref=<lane>');

  const retained = deriveCloseoutVerdict({
    ...base,
    quarantineProfile: false,
    quarantineObserved: false,
    ref: 'agent/device/deliberate-retain',
  });
  assert.equal(retained.laneDisposition, 'retained');
  assert.equal(retained.residueDisposition, 'deliberate-retained');
  assert.equal(retained.nextAction.id, 'workspace-cleanup');
  assert.match(retained.nextAction.command, /Stop writers/u);
});

test('completion status marks unmounted cleanup debt as stale residue when cleanup is required', () => {
  const verdict = deriveCloseoutVerdict({
    ...base,
    laneMounted: false,
    laneClean: null,
    quarantineProfile: true,
    quarantineObserved: false,
  });
  assert.equal(verdict.laneDisposition, 'unmounted');
  assert.equal(verdict.residueDisposition, 'stale-unmounted');
});
