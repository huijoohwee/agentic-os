import { execFileSync } from 'node:child_process';

const sha = /^[0-9a-f]{40}$/u;
const git = (checkout, ...args) => execFileSync('git', ['-C', checkout, ...args], {
  encoding: 'utf8', timeout: 30000, maxBuffer: 500000, stdio: ['ignore', 'pipe', 'pipe'],
});

export function ensurePinnedCommit(checkout, revision) {
  if (!sha.test(revision)) throw new TypeError(`invalid pinned commit: ${revision}`);
  try {
    git(checkout, 'cat-file', '-e', `${revision}^{commit}`);
    return;
  } catch {
    // Shallow CI clones may not contain valid historical catalog pins.
  }
  git(checkout, 'fetch', '--no-write-fetch-head', '--no-tags', '--no-recurse-submodules', '--depth=1', 'origin', revision);
  git(checkout, 'cat-file', '-e', `${revision}^{commit}`);
}
