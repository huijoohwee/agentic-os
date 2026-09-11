/** Bind CI selection to GitHub's actual checkout and event baseline. Missing context fails closed. */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runTests } from './agentic-os-tests.mjs';
import { readGit } from './agentic-os-test-inputs.mjs';

export function ciArguments(event, name, checkout, parents = []) {
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value) && !/^0+$/u.test(value);
  let base, expected;
  if (name === 'pull_request') {
    base = event.pull_request?.base?.sha; expected = checkout;
    if (parents.length !== 2 || parents[0] !== base || parents[1] !== event.pull_request?.head?.sha)
      throw new Error('blocked-test-ci-merge-parents');
  } else if (name === 'merge_group') {
    base = event.merge_group?.base_sha; expected = event.merge_group?.head_sha;
  } else if (name === 'push') {
    base = event.before; expected = event.after;
  } else throw new Error('blocked-test-ci-event');
  if (![base, expected, checkout].every(sha) || expected !== checkout) throw new Error('blocked-test-ci-revision');
  return ['affected', `--base=${base}`, `--head=${checkout}`, '--committed', '--fresh'];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_EVENT_PATH) throw new Error('blocked-test-ci-context');
    const bytes = readFileSync(process.env.GITHUB_EVENT_PATH);
    if (bytes.length > 499_000) throw new Error('blocked-test-ci-event-budget');
    const root = fileURLToPath(new URL('..', import.meta.url));
    const head = readGit(root, ['rev-parse', 'HEAD']).trim();
    const parents = readGit(root, ['show', '-s', '--format=%P', head]).trim().split(' ');
    if (process.env.GITHUB_SHA !== head) throw new Error('blocked-test-ci-checkout');
    process.exitCode = await runTests(ciArguments(JSON.parse(bytes), process.env.GITHUB_EVENT_NAME, head, parents));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
