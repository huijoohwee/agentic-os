#!/usr/bin/env node
/** Read-only GitHub Actions transition input validation. Publication remains a local operation. */
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { validateGitHubTransitionDispatchEvent } from '../src/github-transition-client.mjs';
import { GITHUB_TRANSITION_POLICY_PATH, encodeGitHubTransitionPolicy,
  validateGitHubTransitionPolicy }
  from '../src/github-transition-policy.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';

function fail(message) { throw new TypeError(message); }
function jsonFile(path, label) {
  const bytes = readBoundedStableFile(path, 4_194_304, label);
  try { return { bytes, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }; }
  catch { fail(`${label} is not UTF-8 JSON`); }
}
function execution() {
  const workflowRef = process.env.GITHUB_WORKFLOW_REF;
  const repository = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF;
  const revision = process.env.GITHUB_WORKFLOW_SHA;
  if (!workflowRef || !repository || !ref || !revision
    || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || process.env.GITHUB_RUN_ATTEMPT !== '1' || process.env.GITHUB_SHA !== revision)
    fail('GitHub workflow identity is incomplete or noncanonical');
  const prefix = `${repository}/`, marker = workflowRef.lastIndexOf('@');
  if (!workflowRef.startsWith(prefix) || marker <= prefix.length
    || workflowRef.slice(marker + 1) !== ref)
    fail('GITHUB_WORKFLOW_REF is invalid');
  return { authorityRepository: `github.com/${repository}`, authorityRef: ref,
    workflowPath: workflowRef.slice(prefix.length, marker), workflowRevision: revision };
}
function main() {
  if (process.argv.length !== 3 || process.argv[2] !== 'validate-event')
    fail('usage: agentic-os-transition validate-event');
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) fail('GITHUB_EVENT_PATH is required');
  const policyFile = jsonFile(resolve(process.cwd(), GITHUB_TRANSITION_POLICY_PATH),
    'transition policy');
  const policy = validateGitHubTransitionPolicy(policyFile.value);
  if (!policyFile.bytes.equals(encodeGitHubTransitionPolicy(policy)))
    fail('transition policy is not canonical committed bytes');
  validateGitHubTransitionDispatchEvent(jsonFile(resolve(eventPath), 'GitHub event').value, {
    policy, execution: execution() });
}

try { main(); }
catch (error) {
  process.stderr.write(`agentic-os-transition: ${error.message}\n`);
  process.exitCode = 1;
}
