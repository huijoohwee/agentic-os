import test from 'node:test';
import assert from 'node:assert/strict';
import { laneRef } from '../src/lane-id.mjs';
import { observeUserCleanupSweep, projectUserCleanupSweep } from '../bin/agentic-os-cleanup-user.mjs';

const NOW = Date.parse('2026-10-07T00:00:00Z');
const row = (branch, index, seconds) => `${branch}\t${String(index + 1).padStart(40, '0')}\tcommit\t${seconds}`;

test('stale-ref sweep uses fixed Git reads for a full bounded lane inventory', () => {
  const refs = Array.from({ length: 256 }, (_, index) => row(laneRef(`lane-${index}`, 'device-test'), index, 1700000000));
  const mergedBranches = refs.filter((_, index) => index % 2 === 0)
    .map(value => value.split('\t')[0]);
  const gitReads = [];
  let worktreeReads = 0;
  const result = observeUserCleanupSweep('/fixture', {
    staleDays: 30,
    now: () => NOW,
    observePolicy: () => ({ canonical: 'a'.repeat(40), repository: 'example/repo' }),
    observeLines: (args) => {
      gitReads.push(args);
      return args.some(value => value.startsWith('--merged=')) ? mergedBranches : refs;
    },
    listWorktrees: () => { worktreeReads += 1; return [{ branch: 'agent/device-test/lane-0' }]; },
  });
  assert.equal(result.candidates.length, 256);
  assert.equal(result.candidates[0].mounted, true);
  assert.equal(result.candidates[0].merged, true);
  assert.equal(result.candidates[1].merged, false);
  assert.equal(gitReads.length, 2, 'Git subprocess count remains constant at the 256-lane bound');
  assert.equal(worktreeReads, 1);
  assert.ok(gitReads[0].includes('--count=257'));
  assert.ok(gitReads[1].includes('--merged=' + 'a'.repeat(40)));
});

test('stale-ref sweep reports merged and mounted state from the observed snapshot', () => {
  const refs = [
    row('agent/device-test/merged', 0, 1700000000),
    row('agent/device-test/unmerged', 1, 1700000000),
  ];
  const candidates = projectUserCleanupSweep({ refs,
    mergedBranches: ['agent/device-test/merged'],
    activeBranches: ['agent/device-test/merged'], staleDays: 0, now: NOW,
  });
  assert.deepEqual(candidates.map(candidate => [candidate.branch, candidate.merged, candidate.mounted]), [
    ['agent/device-test/merged', true, true],
    ['agent/device-test/unmerged', false, false],
  ]);
  const overBudget = Array.from({ length: 257 }, (_, index) =>
    row(laneRef(`lane-${index}`, 'device-test'), index, 1700000000));
  assert.throws(() => projectUserCleanupSweep({ refs: overBudget, mergedBranches: [],
    activeBranches: [], staleDays: 0, now: NOW }), /lane-inventory-over-budget/u);
  assert.throws(() => projectUserCleanupSweep({ refs, mergedBranches: ['agent/device-test/missing'],
    activeBranches: [], staleDays: 0, now: NOW }), /sweep-ref-drift/u);
});

test('stale-ref sweep refuses malformed or non-commit ref metadata', () => {
  for (const invalid of [
    'agent/device-test/bad\tshort\tcommit\t1700000000',
    'agent/device-test/bad\t' + 'a'.repeat(40) + '\ttag\t1700000000',
    'agent/device-test/bad\t' + 'a'.repeat(40) + '\tcommit\tinvalid',
  ]) assert.throws(() => projectUserCleanupSweep({ refs: [invalid], mergedBranches: [],
    activeBranches: [], staleDays: 0, now: NOW }), /sweep-ref/u);
});
