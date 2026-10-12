import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GITHUB_ANCESTRY_MAX_PAGES, GITHUB_ANCESTRY_PAGE_SIZE,
  isGitHubCommitAncestor } from '../src/github-transition-policy.mjs';

const oid = (number) => number.toString(16).padStart(40, '0');

test('GitHub ancestry follows commit parents across small pages and stops on proof', async () => {
  const chain = Array.from({ length: 27 }, (_, index) => oid(index + 1)), calls = [];
  const rows = chain.map((sha, index) => ({ sha, parents: [chain[index + 1] ?? oid(90)] }));
  assert.equal(await isGitHubCommitAncestor({ headRevision: chain[0], ancestorRevision: chain.at(-1),
    readPage: async ({ headRevision, page, perPage }) => {
      calls.push({ headRevision, page, perPage });
      return rows.slice((page - 1) * perPage, page * perPage);
    } }), true);
  assert.deepEqual(calls.map(({ page, perPage }) => [page, perPage]), [[1, 25], [2, 25]]);
  assert.equal(GITHUB_ANCESTRY_PAGE_SIZE, 25);
});

test('GitHub ancestry distinguishes complete negative results from budget exhaustion', async () => {
  const rows = Array.from({ length: GITHUB_ANCESTRY_PAGE_SIZE * GITHUB_ANCESTRY_MAX_PAGES },
    (_, index) => ({ sha: oid(index + 1), parents: [] }));
  let calls = 0;
  await assert.rejects(isGitHubCommitAncestor({ headRevision: rows[0].sha, ancestorRevision: oid(900),
    readPage: async ({ page, perPage }) => { calls++; return rows.slice((page - 1) * perPage, page * perPage); } }),
  /page budget/u);
  assert.equal(calls, GITHUB_ANCESTRY_MAX_PAGES);
  assert.equal(await isGitHubCommitAncestor({ headRevision: oid(1), ancestorRevision: oid(900),
    readPage: async () => [{ sha: oid(1), parents: [] }] }), false);
});
