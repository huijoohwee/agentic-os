/** Committed policy for one GitHub transition evidence workflow and target set. */
import { freezeCleanupRecord as freeze } from './cleanup-records.mjs';
import { canonicalJson, governanceDigest } from './governance.mjs';
import { parseGitHubRepositoryIdentity } from './github-authority.mjs';

export const GITHUB_TRANSITION_POLICY_SCHEMA = 'agentic-os/github-transition-policy/v1';
export const GITHUB_TRANSITION_RECOVERY_POLICY_SCHEMA = 'agentic-os/github-transition-policy/v2';
export const GITHUB_TRANSITION_RETENTION_POLICY_SCHEMA = 'agentic-os/github-transition-policy/v3';
export const GITHUB_HISTORICAL_CONTENT_MODE = 'historical-content-facts/v1';
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
function instant(value, label) {
  const parsed = Date.parse(text(value, label));
  if (!Number.isFinite(parsed)) fail(`${label} must be a UTC instant`);
  return new Date(parsed).toISOString();
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
export function validateGitHubTransitionPolicy(value) {
  const source = snap(value), retention = source?.schema === GITHUB_TRANSITION_RETENTION_POLICY_SCHEMA;
  const recovery = retention || source?.schema === GITHUB_TRANSITION_RECOVERY_POLICY_SCHEMA;
  const keys = recovery ? [...KEYS, 'historicalIntegrations', 'preservationAdoptions', ...(retention ? ['retentionAdoptions'] : [])] : KEYS;
  fields(source, keys, 'GitHub transition policy');
  if (!recovery && source.schema !== GITHUB_TRANSITION_POLICY_SCHEMA)
    fail('GitHub transition policy schema is invalid');
  const policy = { schema: source.schema,
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
  if (recovery) {
    policy.historicalIntegrations = enrollments(source.historicalIntegrations, historicalEnrollment);
    policy.preservationAdoptions = enrollments(source.preservationAdoptions, preservationAdoption);
    if (retention) policy.retentionAdoptions = enrollments(source.retentionAdoptions, preservationAdoption);
    if ([...policy.historicalIntegrations, ...policy.preservationAdoptions, ...(policy.retentionAdoptions ?? [])].some((entry) =>
      !policy.targetRepositories.includes(entry.repository))) fail('recovery enrollment target is not authorized');
  }
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
  fields(source, keys, 'GitHub transition policy execution');
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
function fields(source, keys, label) {
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).sort().join(',') !== keys.sort().join(',')) fail(`${label} fields are invalid`);
}
function oid(value, label) {
  if (typeof value !== 'string' || !REVISION.test(value)) fail(`${label} must be a full Git revision`);
  return value;
}
function review(value, target) {
  const result = text(value, 'recovery review'), prefix = `https://${target}/pull/`;
  if (!result.startsWith(prefix) || !/^[1-9][0-9]{0,18}$/u.test(result.slice(prefix.length)))
    fail('recovery review must name the exact target pull request');
  return result;
}
function enrollments(value, mapper) {
  if (!Array.isArray(value) || value.length > 32) fail('recovery enrollments must be bounded');
  const entries = value.map(mapper).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  if (new Set(entries.map((entry) => entry.reviewLocator)).size !== entries.length)
    fail('recovery enrollments must be unique');
  return entries;
}
function historicalEnrollment(source) {
  fields(source, ['schema', 'repository', 'reviewLocator', 'baseRevision', 'headRevision',
    'mergeRevision', 'treeRevision', 'checkContexts', 'adoptionScope', 'rationale'], 'historical enrollment');
  const target = repository(source.repository, 'historical enrollment repository');
  if (source.schema !== 'agentic-os/historical-content-enrollment/v1') fail('historical enrollment schema is invalid');
  const result = { ...source, repository: target, reviewLocator: review(source.reviewLocator, target),
    checkContexts: list(source.checkContexts, text, 'historical check selection'),
    adoptionScope: list(source.adoptionScope, path, 'historical adoption scope'),
    rationale: text(source.rationale, 'historical adoption rationale') };
  for (const key of ['baseRevision', 'headRevision', 'mergeRevision', 'treeRevision']) oid(result[key], key);
  if (!result.checkContexts.length || !result.adoptionScope.length
    || result.adoptionScope.some((entry) => !entry.startsWith('recovery/current-historical-content/')))
    fail('historical enrollment lacks reviewed checks or a distinct current-adoption scope');
  return result;
}
function preservationAdoption(source) {
  const retained = source?.schema === 'agentic-os/current-quarantine-adoption/v1';
  fields(source, retained ? ['schema', 'repository', 'targetRef', 'targetHead', 'merge', 'reviewLocator',
    'quarantineCoordinate', 'originalReceiptDigest', 'historicalQuarantineAuthorityProven'] : ['schema', 'repository', 'predecessorRef', 'predecessorHead', 'successorRef',
    'successorHead', 'merge', 'reviewLocator', 'replacedPaths', 'quarantineCoordinate',
    'historicalSuccessionAuthorityProven'], 'preservation adoption');
  const target = repository(source.repository, 'preservation adoption repository');
  if (retained) {
    if (source.historicalQuarantineAuthorityProven !== false || !/^[0-9a-f]{64}$/u.test(source.originalReceiptDigest)
      || !/^[0-9a-f]{64}$/u.test(source.quarantineCoordinate)) fail('retained adoption schema or basis is invalid');
    oid(source.targetHead, 'targetHead'); oid(source.merge, 'merge'); ref(`refs/heads/${source.targetRef}`, 'targetRef');
    return { ...source, repository: target, reviewLocator: review(source.reviewLocator, target) };
  }
  if (source.schema !== 'agentic-os/successor-preservation-adoption/v1'
    || source.historicalSuccessionAuthorityProven !== false
    || !/^[0-9a-f]{64}$/u.test(source.quarantineCoordinate)) fail('preservation adoption schema or basis is invalid');
  for (const key of ['predecessorHead', 'successorHead', 'merge']) oid(source[key], key);
  for (const key of ['predecessorRef', 'successorRef']) ref(`refs/heads/${source[key]}`, key);
  const replacedPaths = list(source.replacedPaths, path, 'preservation replaced paths');
  if (!replacedPaths.length || source.predecessorRef === source.successorRef) fail('preservation adoption has no distinct retained successor');
  return { ...source, repository: target, reviewLocator: review(source.reviewLocator, target), replacedPaths };
}
export function selectPreservationAdoption(policyValue, receiptOrEntry) {
  const policy = validateGitHubTransitionPolicy(policyValue), entry = receiptOrEntry.adoption ?? receiptOrEntry;
  const entries = entry.schema === 'agentic-os/current-quarantine-adoption/v1' ? policy.retentionAdoptions : policy.preservationAdoptions;
  const selected = entries?.find((value) => canonicalJson(value) === canonicalJson(entry));
  if (!selected) fail('preservation adoption is not exactly enrolled in committed policy');
  return selected;
}
export function assertGitHubTransitionPolicyOperation(policyValue, input) {
  const policy = assertGitHubTransitionPolicyTarget(policyValue, input.request.repository);
  if (input.preservationDisposition) return selectPreservationAdoption(policy, input.preservationDisposition);
  if (input.integrationMode !== GITHUB_HISTORICAL_CONTENT_MODE) return null;
  const candidate = input.predecessorIssuance?.storedBundle.authorityBundle.candidate;
  const entry = policy.historicalIntegrations?.find((value) => value.repository === input.request.repository
    && value.reviewLocator === input.request.reviewLocator && value.baseRevision === candidate?.canonicalRevision
    && value.headRevision === candidate?.headRevision && value.mergeRevision === input.plan.target.immutableRevision
    && canonicalJson(value.adoptionScope) === canonicalJson(input.request.scope));
  if (!entry) fail('historical content facts lack exact committed current-adoption enrollment');
  return entry;
}
export function historicalContentProjection(projection, enrollment) {
  const { targetProtectionDigest, targetBypassActorsObserved, targetRequiredContexts, targetAllowedMergeMethods,
    targetActiveRuleTypes, targetRulesetVersions, requiredChecks, requiredChecksDigest, ...facts } = projection;
  return { ...facts, schema: 'agentic-os/github-integrate-provider-proof/v2', proofBasis: GITHUB_HISTORICAL_CONTENT_MODE,
    enrollmentDigest: governanceDigest(enrollment), historicalProtectionProven: false,
    historicalRequiredCheckPolicyProven: false, historicalRuleSuiteProven: false, methodProven: false,
    successfulChecks: requiredChecks, successfulChecksDigest: requiredChecksDigest,
    currentTargetProtection: { targetProtectionDigest, targetBypassActorsObserved, targetRequiredContexts,
      targetAllowedMergeMethods, targetActiveRuleTypes, targetRulesetVersions } };
}
export function validateTransitionProviderProof(value, input) {
  const source = snap(value), historical = input.integrationMode === GITHUB_HISTORICAL_CONTENT_MODE;
  if (!source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some((key) => key !== 'proofDigest' && key !== 'schema' && !/^[a-z][A-Za-z0-9]{0,63}$/u.test(key)))
    fail('GitHub transition provider proof fields are invalid');
  if (source.schema !== `agentic-os/github-${input.request.requestedTransition}-provider-proof/v${historical ? 2 : 1}`)
    fail('GitHub transition provider proof schema is invalid');
  if (historical && (source.proofBasis !== GITHUB_HISTORICAL_CONTENT_MODE || source.integrationMode !== GITHUB_HISTORICAL_CONTENT_MODE
    || source.mergeMethod !== 'unproven'
    || ['historicalProtectionProven', 'historicalRequiredCheckPolicyProven', 'historicalRuleSuiteProven', 'methodProven'].some((key) => source[key] !== false)
    || Object.keys(source).some((key) => key.startsWith('ruleSuite')))) fail('historical content proof upgrades unproven history');
  const disposition = input.preservationDisposition;
  if (disposition && (source.effectClass !== 'claim-retirement-record-only'
    || source.preservationReceiptDigest !== disposition.receiptDigest
    || source.adoptionDigest !== disposition.adoptionDigest || source.physicalCleanupPerformed !== false
    || source[disposition.adoption.targetHead ? 'historicalQuarantineAuthorityProven' : 'historicalSuccessionAuthorityProven'] !== false)) fail('retirement proof changed preservation basis');
  const { proofDigest, ...payload } = source;
  if (canonicalJson(source).length > 100_000 || !/^[0-9a-f]{64}$/u.test(proofDigest)
    || proofDigest !== governanceDigest(payload)) fail('GitHub transition provider proof digest is invalid');
  return freeze(source);
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
function numericId(value, label) {
  if (!/^[1-9][0-9]{0,18}$/u.test(String(value))) fail(`${label} must be an identifier`);
  return String(value);
}
export function targetRepositoryIdentity(value, target, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('target repository identity must be an object');
  const source = value;
  const sourceOwner = source?.owner;
  const live = { repository: `github.com/${text(source.full_name, 'target repository full name')}`, repositoryId: numericId(source.id, 'target repository id'),
    owner: { id: numericId(sourceOwner?.id, 'target repository owner id'), login: text(sourceOwner?.login, 'target repository owner login').toLowerCase() } };
  if (live.repository !== target.repository)
    fail('target repository numeric identity or owner changed');
  if (expected === null) return live;
  const bound = { repository: expected.repository, repositoryId: expected.repositoryId,
    owner: expected.owner };
  if (canonicalJson(live) !== canonicalJson(bound))
    fail('target repository numeric identity or owner changed');
  return live;
}

export { oid as validateTransitionRevision, numericId as validateTransitionIdentifier, text as validateTransitionText, instant as validateTransitionInstant, snap as snapshotTransitionValue };
