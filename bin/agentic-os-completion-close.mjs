#!/usr/bin/env node
/** Exact, provider-authenticated completion of one quarantinable worktree. */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { canonicalJson, governanceDigest } from '../src/governance.mjs';
import { repoRoot } from '../src/git.mjs';
import { readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { validateWorktreeCleanupPlan, assessWorktreeCleanupEligibility,
  executeWorktreeCleanup } from '../src/cleanup.mjs';
import { createGitHubTransitionAuthorityVerifier } from '../src/github-transition-authority.mjs';
import { trustedRepositoryProfile } from './agentic-os-auxiliary.mjs';
import { inspectCompletionStatus } from './agentic-os-completion-status.mjs';
import { providerPolicy } from '../src/queue.mjs';

const PLAN_SCHEMA = 'agentic-os/completion-close-plan/v1';
const BUNDLE_KEYS = ['cleanup', 'integrationVerifier', 'retirementVerifier'];
const CLEANUP_KEYS = ['plan', 'integrationReceipt', 'integrationPlanBytes', 'retirementReceipt',
  'retirementPlanBytes', 'integrationRequest', 'retirementRequest', 'preservationReceipt',
  'noRemainingValueReceipt'];
const CONFIG_KEYS = ['repository', 'targetRepository', 'operationInput', 'workflowRun', 'policy'];
function fail(reason, message) { throw Object.assign(new Error(message), { reason }); }
function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    fail('blocked-completion-input', `${label} must have exactly ${keys.join(', ')}`);
}
function jsonFile(path, ceiling, label) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true })
    .decode(readBoundedStableFile(path, ceiling, label))); }
  catch (error) { fail('blocked-completion-input', `${label}: ${error.message}`); }
}
export function validateCompletionCloseArguments(argv) {
  const [mode, ...args] = argv;
  const names = mode === 'plan' ? ['ref', 'bundle']
    : mode === 'apply' ? ['ref', 'bundle', 'plan', 'authorize', 'stopped'] : null;
  if (!names || args.length !== names.length) fail('blocked-completion-arguments',
    'usage: completion-close plan --ref=<lane> --bundle=<json> | apply --ref=<lane> --bundle=<json> --plan=<json> --authorize=<digest> --stopped');
  const found = new Map();
  for (const arg of args) {
    const match = arg.match(/^--([a-z]+)(?:=(.+))?$/u);
    if (!match || !names.includes(match[1]) || found.has(match[1])
      || (match[1] === 'stopped' ? match[2] !== undefined : match[2] === undefined))
      fail('blocked-completion-arguments', `invalid or duplicate argument ${arg}`);
    found.set(match[1], match[2] ?? true);
  }
  if (names.some((name) => !found.has(name))) fail('blocked-completion-arguments', 'required argument missing');
  return { mode, ref: found.get('ref'), bundle: found.get('bundle'), plan: found.get('plan'),
    authorize: found.get('authorize'), stopped: found.get('stopped') === true };
}
export function validateCompletionCloseBundle(value, status) {
  exact(value, BUNDLE_KEYS, 'completion bundle');
  exact(value.cleanup, CLEANUP_KEYS, 'cleanup evidence');
  exact(value.integrationVerifier, CONFIG_KEYS, 'integration verifier');
  exact(value.retirementVerifier, CONFIG_KEYS, 'retirement verifier');
  const plan = validateWorktreeCleanupPlan(value.cleanup.plan);
  if (plan.repository !== status.repository || plan.targetPath !== status.lane.path
    || plan.expectedBranch !== status.ref || plan.expectedHeadRevision !== status.lane.head
    || plan.expectedCanonicalRevision !== status.canonicalRevision
    || value.integrationVerifier.targetRepository !== status.repository
    || value.retirementVerifier.targetRepository !== status.repository
    || value.integrationVerifier.operationInput?.request?.requestedTransition !== 'integrate'
    || value.retirementVerifier.operationInput?.request?.requestedTransition !== 'retire')
    fail('blocked-completion-target-mismatch', 'bundle is not bound to the exact clean registered lane');
  return value;
}
function context(root, ref) {
  const canonical = realpathSync(repoRoot(root));
  if (realpathSync(root) !== canonical) fail('blocked-canonical-required', 'run from the canonical checkout');
  const trusted = trustedRepositoryProfile(canonical), profile = trusted.profile;
  if (!profile) fail('blocked-repository-profile-missing', 'committed trusted profile required');
  const status = inspectCompletionStatus(canonical, ref, providerPolicy(profile), profile);
  const blocker = status.findings.find((item) => ['canonical-not-current-clean',
    'lane-unbound-or-ref-missing', 'lane-dirty', 'integration-not-classified'].includes(item.code));
  if (blocker) fail(`blocked-${blocker.code}`, blocker.action);
  return { canonical, status };
}
function verifier(config, token) {
  if (!token) fail('blocked-provider-credentials', 'GITHUB_TOKEN is required for live winner verification');
  return createGitHubTransitionAuthorityVerifier({ ...config, token });
}
function options(root, bundle, token) {
  return { cwd: root, now: Date.now,
    verifyIntegrationAuthority: verifier(bundle.integrationVerifier, token),
    verifyRetirementAuthority: verifier(bundle.retirementVerifier, token) };
}
export async function planCompletionClose(root, ref, bundle, { token = process.env.GITHUB_TOKEN } = {}) {
  const { canonical, status } = context(root, ref);
  validateCompletionCloseBundle(bundle, status);
  const eligibility = await assessWorktreeCleanupEligibility(bundle.cleanup,
    options(canonical, bundle, token));
  return { schema: PLAN_SCHEMA, ref, repository: status.repository, targetPath: status.lane.path,
    canonicalRevision: status.canonicalRevision, laneHead: status.lane.head,
    bundleDigest: governanceDigest(bundle), eligibility,
    authorizationDigest: eligibility.eligibilityDigest, effectsAuthorized: false };
}
export async function applyCompletionClose(root, ref, bundle, planned, authorization,
  { token = process.env.GITHUB_TOKEN, stopped = false } = {}) {
  if (!stopped) fail('blocked-completion-stop-acknowledgement', 'stop writers before applying cleanup');
  const { canonical, status } = context(root, ref);
  validateCompletionCloseBundle(bundle, status);
  exact(planned, ['schema', 'ref', 'repository', 'targetPath', 'canonicalRevision', 'laneHead',
    'bundleDigest', 'eligibility', 'authorizationDigest', 'effectsAuthorized'], 'completion plan');
  if (planned.schema !== PLAN_SCHEMA || planned.ref !== ref || planned.repository !== status.repository
    || planned.targetPath !== status.lane.path || planned.canonicalRevision !== status.canonicalRevision
    || planned.laneHead !== status.lane.head || planned.bundleDigest !== governanceDigest(bundle)
    || planned.authorizationDigest !== planned.eligibility?.eligibilityDigest
    || authorization !== planned.authorizationDigest || planned.effectsAuthorized !== false)
    fail('blocked-completion-plan-drift', 'exact plan, bundle and authorization must agree');
  return executeWorktreeCleanup({ ...bundle.cleanup, eligibility: planned.eligibility,
    authorizationDigest: authorization }, options(canonical, bundle, token));
}
async function main() {
  const args = validateCompletionCloseArguments(process.argv.slice(2));
  const root = process.cwd(), bundle = jsonFile(args.bundle, 4_194_304, 'completion-bundle');
  const result = args.mode === 'plan' ? await planCompletionClose(root, args.ref, bundle)
    : await applyCompletionClose(root, args.ref, bundle, jsonFile(args.plan, 65_536,
      'completion-plan'), args.authorize, { stopped: args.stopped });
  process.stdout.write(`${canonicalJson(result)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { process.stderr.write(`completion-close: ${error.reason ?? 'error'}: ${error.message}\n`);
    process.exitCode = 1; });
