/** Committed policy for one GitHub transition evidence workflow and target set. */
import { canonicalJson } from './governance.mjs';
import { parseGitHubRepositoryIdentity } from './github-authority.mjs';

export const GITHUB_TRANSITION_POLICY_SCHEMA = 'agentic-os/github-transition-policy/v1';
export const GITHUB_TRANSITION_POLICY_PATH = '.agentic-os/github-transition-policy.json';
const KEYS = ['schema', 'authorityRepository', 'authorityRef', 'workflowPath',
  'targetRepositories', 'evidenceRefPrefix'];
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REF_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
function fail(message) { throw new TypeError(message); }
function snap(value) { return JSON.parse(canonicalJson(value)); }
function text(value, label) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be bounded text`);
  return value;
}
function repository(value, label) {
  return parseGitHubRepositoryIdentity(value, label).repository;
}
function ref(value, label) {
  const result = text(value, label), prefix = 'refs/heads/';
  const parts = result.startsWith(prefix) ? result.slice(prefix.length).split('/') : [];
  if (!parts.length || parts.some((part) => !REF_PART.test(part)
    || part.endsWith('.') || part.endsWith('.lock'))) fail(`${label} must be a branch ref`);
  return result;
}
function path(value, label) {
  const result = text(value, label), parts = result.split('/');
  if (result.startsWith('/') || result.includes('\\')
    || parts.some((part) => !part || part === '.' || part === '..')) fail(`${label} is invalid`);
  return result;
}
function list(value, mapper, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((entry) => mapper(entry, label)).sort();
  if (new Set(result).size !== result.length) fail(`${label} must be unique`);
  return Object.freeze(result);
}
function freeze(value) {
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) Object.freeze(entry);
  });
  return Object.freeze(value);
}
export function validateGitHubTransitionPolicy(value) {
  const source = snap(value);
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).sort().join(',') !== [...KEYS].sort().join(','))
    fail('GitHub transition policy fields are invalid');
  if (source.schema !== GITHUB_TRANSITION_POLICY_SCHEMA)
    fail('GitHub transition policy schema is invalid');
  const policy = { schema: GITHUB_TRANSITION_POLICY_SCHEMA,
    authorityRepository: repository(source.authorityRepository, 'policy.authorityRepository'),
    authorityRef: ref(source.authorityRef, 'policy.authorityRef'),
    workflowPath: path(source.workflowPath, 'policy.workflowPath'),
    targetRepositories: list(source.targetRepositories,
      (entry) => repository(entry, 'policy.targetRepositories'), 'policy.targetRepositories'),
    evidenceRefPrefix: ref(`${text(source.evidenceRefPrefix,
      'policy.evidenceRefPrefix')}sentinel`, 'policy.evidenceRefPrefix').slice(0, -8) };
  if (policy.evidenceRefPrefix !== 'refs/heads/adlc/authority/'
    || policy.targetRepositories.length === 0)
    fail('GitHub transition policy lacks one exact protected authority prefix or target set');
  return freeze(policy);
}
export function encodeGitHubTransitionPolicy(value) {
  return Buffer.from(canonicalJson(validateGitHubTransitionPolicy(value)), 'utf8');
}
export function assertGitHubTransitionPolicyTarget(policyValue, targetValue) {
  const policy = validateGitHubTransitionPolicy(policyValue);
  const target = repository(targetValue, 'transition target repository');
  if (!policy.targetRepositories.includes(target))
    fail('GitHub transition target is not authorized by committed policy');
  return policy;
}
export function validateGitHubTransitionPolicyExecution(policyValue, execution) {
  const policy = validateGitHubTransitionPolicy(policyValue), source = snap(execution);
  const keys = ['authorityRepository', 'authorityRef', 'workflowPath', 'workflowRevision'];
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).sort().join(',') !== keys.sort().join(','))
    fail('GitHub transition policy execution fields are invalid');
  if (repository(source.authorityRepository, 'execution.authorityRepository')
      !== policy.authorityRepository
    || ref(source.authorityRef, 'execution.authorityRef') !== policy.authorityRef
    || path(source.workflowPath, 'execution.workflowPath') !== policy.workflowPath
    || typeof source.workflowRevision !== 'string' || !REVISION.test(source.workflowRevision))
    fail('GitHub transition execution is not bound by committed policy');
  return freeze({ policy, execution: { authorityRepository: policy.authorityRepository,
    authorityRef: policy.authorityRef, workflowPath: policy.workflowPath,
    workflowRevision: source.workflowRevision } });
}
export function latestSuccessfulRequiredCheck(entries, mapEntry) {
  const matches = entries.flatMap((entry) => { try { return [mapEntry(entry)]; } catch { return []; } });
  if (matches.length === 0) return null;
  matches.sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt)
    || (BigInt(right.checkRunId) > BigInt(left.checkRunId) ? 1 : BigInt(right.checkRunId) < BigInt(left.checkRunId) ? -1 : 0));
  return matches[0];
}
export function parseClassicBranchProtection(value, integrationId) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('GitHub branch protection must be an object');
  const requiredStatusChecks = value.required_status_checks;
  if (!requiredStatusChecks || typeof requiredStatusChecks !== 'object'
    || Array.isArray(requiredStatusChecks))
    fail('GitHub branch protection required checks are invalid');
  const checks = Array.isArray(requiredStatusChecks.checks) ? requiredStatusChecks.checks : [];
  const contexts = checks.length > 0
    ? checks.map((entry) => {
      if (entry?.app_id !== integrationId || typeof entry.context !== 'string' || !entry.context)
        fail('GitHub branch protection required checks are invalid');
      return entry.context;
    })
    : Array.isArray(requiredStatusChecks.contexts) ? requiredStatusChecks.contexts : [];
  if (contexts.length === 0 || requiredStatusChecks.strict !== false
    || contexts.some((entry) => typeof entry !== 'string' || !entry))
    fail('GitHub branch protection required checks are invalid');
  const requiredContexts = [...new Set(contexts)].sort();
  if (requiredContexts.length !== contexts.length)
    fail('GitHub branch protection required checks are not unique');
  const activeRuleTypes = [
    value.allow_deletions?.enabled === false ? 'deletion' : null,
    value.allow_force_pushes?.enabled === false ? 'non_fast_forward' : null,
    value.required_pull_request_reviews != null ? 'pull_request' : null,
    value.required_linear_history?.enabled === true ? 'required_linear_history' : null,
    value.required_conversation_resolution?.enabled === true
      ? 'required_review_thread_resolution' : null,
    'required_status_checks',
  ].filter(Boolean).sort();
  return { requiredContexts, activeRuleTypes };
}
