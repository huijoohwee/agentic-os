#!/usr/bin/env node
/** Explicit, profileless no-CI local consent. Never protected-path authority. */
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { canonicalJson } from '../src/governance.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { planUserCleanup, applyUserCleanup } from './agentic-os-cleanup-user.mjs';

function argumentError(message) { throw Object.assign(new Error(message), { reason: 'blocked-no-ci-arguments' }); }
export function parseNoCiArguments(argv) {
  const [operation, ...tokens] = argv;
  const required = operation === 'plan' ? ['target', 'pr']
    : operation === 'apply' ? ['plan', 'authorize', 'stopped'] : null;
  if (!required || tokens.length !== required.length)
    argumentError('usage: cleanup-no-ci plan --target=<absolute-worktree> --pr=<number> | apply --plan=<json> --authorize=agentic-os:user-cleanup:<digest> --stopped');
  const found = new Map();
  for (const token of tokens) {
    const match = token.match(/^--([a-z]+)(?:=(.+))?$/u);
    if (!match || !required.includes(match[1]) || found.has(match[1])
      || (match[1] === 'stopped' ? match[2] !== undefined : match[2] === undefined))
      argumentError(`invalid or duplicate argument ${token}`);
    found.set(match[1], match[2] ?? true);
  }
  if (required.some((key) => !found.has(key))) argumentError('required argument missing');
  if (operation === 'plan' && !/^[1-9][0-9]{0,9}$/u.test(found.get('pr')))
    argumentError('PR must be a positive canonical number');
  return { operation, target: found.get('target'), pr: Number(found.get('pr')),
    plan: found.get('plan'), authorization: found.get('authorize'), stopped: found.get('stopped') === true };
}
export function runNoCiCleanup(argv, { cwd = process.cwd(), out = console.log } = {}) {
  const input = parseNoCiArguments(argv);
  if (input.operation === 'plan') {
    out(canonicalJson(planUserCleanup({ cwd, target: input.target, pr: input.pr,
      requiredChecks: [], workflow: null, noCI: true })));
    return 0;
  }
  const plan = JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(readBoundedStableFile(input.plan, 64000, 'no-ci-cleanup-plan')));
  out(canonicalJson(applyUserCleanup(plan, { cwd, authorization: input.authorization,
    stopped: input.stopped })));
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  try { runNoCiCleanup(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`cleanup-no-ci: ${error.reason ?? 'error'}: ${error.message}\n`);
    process.exitCode = 1; }
