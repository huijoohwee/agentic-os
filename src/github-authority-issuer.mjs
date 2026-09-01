import { canonicalJson, createAuthorityTransitionReceiptEnvelope, findExactReplay,
  governanceDigest } from './governance.mjs';
import { GITHUB_ACTIONS_INTEGRATION_ID, GITHUB_AUTHORITY_ADAPTER,
  parseGitHubRepositoryIdentity, validateFencedClaimBundle } from './github-authority.mjs';
export const GITHUB_PROTECTION_PROJECTION_SCHEMA = 'agentic-os/github-protection-projection/v1';
export const GITHUB_CANONICAL_REF_PROJECTION_SCHEMA = 'agentic-os/github-canonical-ref-projection/v1';
export const GITHUB_PROTECTION_SNAPSHOT_SCHEMA = 'agentic-os/github-protection-snapshot/v1';
export const GITHUB_TARGET_REPOSITORY_SCHEMA = 'agentic-os/github-target-repository-projection/v1';
export const GITHUB_STORED_AUTHORITY_BUNDLE_SCHEMA = 'agentic-os/github-stored-authority-bundle/v1';
export const GITHUB_PUBLICATION_RECEIPT_SCHEMA = 'agentic-os/github-authority-publication-receipt/v1';
export const GITHUB_AUTHORITY_ISSUANCE_SCHEMA = 'agentic-os/github-authority-issuance/v1';
const DIGEST = /^[0-9a-f]{64}$/u;
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const IDENTIFIER = /^[1-9][0-9]{0,18}$/u;
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,38})?$/u;
const RULE_TYPE = /^[a-z][a-z0-9_]{0,63}$/u;
const REF_PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PROJECTION_KEYS = ['schema', 'repository', 'ref', 'rulesets', 'projectionDigest'];
const TARGET_KEYS = [
  'schema', 'repository', 'repositoryId', 'owner', 'canonicalBranch', 'canonicalRevision',
  'candidateBranch', 'candidateHeadRevision', 'review', 'projectionDigest',
];
const STORED_KEYS = ['schema', 'authorityBundle', 'targetRepository', 'preProtection', 'storedDigest'];
const RECEIPT_INPUT_KEYS = ['storedBundle', 'publication', 'postProtection', 'receiptDigest'];
const ISSUANCE_KEYS = ['schema', 'storedBundle', 'publicationReceipt', 'transitionReceipt', 'issuanceDigest'];
function fail(message) { throw new TypeError(message); }
function snap(value) { return JSON.parse(canonicalJson(value)); }
function exact(value, keys, label, required = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !keys.includes(key))
    || (required && keys.some((key) => !Object.hasOwn(value, key)))) fail(`${label} fields are invalid`);
}
function requireKeys(value, keys, label) {
  if (keys.some((key) => !Object.hasOwn(value, key))) fail(`${label} fields are invalid`);
}
function text(value, label) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be a bounded non-empty string`);
  return value;
}
function digest(value, label) {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} must be a sha256 digest`);
  return value;
}
function revision(value, label) {
  if (typeof value !== 'string' || !REVISION.test(value)) fail(`${label} must be a full lowercase Git object identifier`);
  return value;
}
function identifier(value, label) {
  const result = typeof value === 'number' ? String(value) : text(value, label);
  if (!IDENTIFIER.test(result)) fail(`${label} must be a canonical positive identifier`);
  return result;
}
function instant(value, label) {
  const result = text(value, label), parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) fail(`${label} must be an exact UTC instant`);
  return result;
}
function ref(value, label) {
  const result = text(value, label), prefix = 'refs/heads/';
  const parts = result.startsWith(prefix) ? result.slice(prefix.length).split('/') : [];
  if (!parts.length || parts.some((part) => !REF_PART.test(part)
    || part.endsWith('.') || part.endsWith('.lock'))) fail(`${label} must be a portable refs/heads ref`);
  return result;
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}
function stringSet(value, label, pattern) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((entry) => text(entry, label)).sort();
  if (new Set(result).size !== result.length || result.some((entry) => !pattern.test(entry))) fail(`${label} must be canonical and duplicate-free`);
  return result;
}
function ruleDescriptor(value) {
  const source = snap(value);
  exact(source, ['type', 'parameters'], 'GitHub rule descriptor');
  const type = text(source.type, 'GitHub rule type');
  if (!RULE_TYPE.test(type)) fail('GitHub rule type is invalid');
  if (source.parameters !== null
    && (!source.parameters || typeof source.parameters !== 'object'
      || Array.isArray(source.parameters))) fail('GitHub rule parameters must be an object or null');
  return { type, parameters: source.parameters };
}
function ruleset(value) {
  const source = snap(value);
  exact(source, ['id', 'enforcement', 'rules', 'bypassActors'], 'GitHub ruleset projection');
  if (source.enforcement !== 'active') fail('GitHub ruleset projection must be active');
  const rules = source.rules.map(ruleDescriptor).sort((left, right) =>
    left.type.localeCompare(right.type));
  if (new Set(rules.map((entry) => entry.type)).size !== rules.length) fail('GitHub rule descriptors must have distinct types per ruleset');
  return { id: identifier(source.id, 'GitHub ruleset id'), enforcement: 'active', rules,
    bypassActors: stringSet(source.bypassActors, 'GitHub bypass actor', /^\S{1,256}$/u) };
}
export function createGitHubProtectionProjection(value) {
  const source = snap(value);
  exact(source, PROJECTION_KEYS, 'GitHub protection projection input', false);
  requireKeys(source, ['repository', 'ref', 'rulesets'], 'GitHub protection projection input');
  const rulesets = source.rulesets.map(ruleset).sort((left, right) => left.id.localeCompare(right.id));
  if (rulesets.length === 0 || new Set(rulesets.map((entry) => entry.id)).size !== rulesets.length) fail('GitHub protection projection needs distinct active rulesets');
  const payload = { schema: GITHUB_PROTECTION_PROJECTION_SCHEMA,
    repository: parseGitHubRepositoryIdentity(source.repository).repository,
    ref: ref(source.ref, 'GitHub protection ref'), rulesets };
  const projectionDigest = governanceDigest(payload);
  if (source.schema !== undefined && source.schema !== payload.schema) fail('GitHub protection projection schema is invalid');
  if (source.projectionDigest !== undefined
    && digest(source.projectionDigest, 'projectionDigest') !== projectionDigest) fail('GitHub protection projection digest is invalid');
  return freeze({ ...payload, projectionDigest });
}
function descriptors(projection, type) {
  return projection.rulesets.flatMap((entry) => entry.rules).filter((entry) => entry.type === type);
}
function projectionIdentity(projection, repository, branch) {
  if (projection.repository !== repository || projection.ref !== branch) fail('GitHub protection projection has the wrong repository or ref');
}
function canonicalProtection(value, bundle) {
  const projection = createGitHubProtectionProjection(value), policy = bundle.policy;
  projectionIdentity(projection, policy.evidenceRepository, policy.canonicalRef);
  if (projection.rulesets.some((entry) => entry.bypassActors.length !== 0)) fail('canonical protection must have zero bypass actors');
  const required = ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks'];
  if (required.some((type) => descriptors(projection, type).length !== 1) || ['deletion', 'non_fast_forward'].some((type) => descriptors(projection, type)[0].parameters !== null)) fail('canonical protection lacks one exact required rule');
  const checks = descriptors(projection, 'required_status_checks')[0].parameters;
  const entries = checks?.required_status_checks;
  if (!Array.isArray(entries) || entries.length === 0
    || checks.strict_required_status_checks_policy !== false
    || entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.context !== 'string' || !entry.context || entry.context.trim() !== entry.context
      || entry.integration_id !== GITHUB_ACTIONS_INTEGRATION_ID)) fail('canonical required status checks are invalid');
  const contexts = entries.map((entry) => entry.context).sort();
  if (new Set(contexts).size !== contexts.length
    || canonicalJson(contexts) !== canonicalJson(policy.requiredStatusChecks)) fail('canonical required status contexts do not match policy');
  const methods = descriptors(projection, 'pull_request')[0].parameters?.allowed_merge_methods;
  if (!Array.isArray(methods) || new Set(methods).size !== methods.length
    || canonicalJson([...methods].sort()) !== canonicalJson(policy.allowedMergeMethods)) fail('canonical allowed merge methods do not match policy');
  return projection;
}
function evidenceProtection(value, bundle) {
  const projection = createGitHubProtectionProjection(value);
  projectionIdentity(projection, bundle.policy.evidenceRepository, bundle.evidenceRef);
  const immutable = projection.rulesets[0];
  const update = immutable?.rules.find((rule) => rule.type === 'update');
  if (projection.rulesets.length !== 1
    || canonicalJson(immutable.rules.map((rule) => rule.type))
      !== canonicalJson(['deletion', 'non_fast_forward', 'update'])
    || immutable.bypassActors.length !== 0
    || immutable.rules.some((rule) => rule.type !== 'update' && rule.parameters !== null)
    || canonicalJson(update?.parameters)
      !== canonicalJson({ update_allows_fetch_and_merge: false })) {
    fail('evidence protection must be one exact zero-bypass immutable ruleset');
  }
  return projection;
}
function canonicalRefProjection(value, bundle) {
  const source = snap(value);
  const keys = ['schema', 'repository', 'ref', 'revision', 'projectionDigest'];
  exact(source, keys, 'GitHub canonical ref projection', false);
  requireKeys(source, ['repository', 'ref', 'revision'], 'GitHub canonical ref projection');
  const payload = { schema: GITHUB_CANONICAL_REF_PROJECTION_SCHEMA,
    repository: parseGitHubRepositoryIdentity(source.repository).repository,
    ref: ref(source.ref, 'GitHub canonical ref'),
    revision: revision(source.revision, 'GitHub canonical revision') };
  if (payload.repository !== bundle.policy.evidenceRepository
    || payload.ref !== bundle.policy.canonicalRef
    || payload.revision !== bundle.policy.canonicalRevision) fail('GitHub canonical ref moved from the committed policy revision');
  const projectionDigest = governanceDigest(payload);
  if (source.schema !== undefined && source.schema !== payload.schema
    || source.projectionDigest !== undefined
      && digest(source.projectionDigest, 'canonical ref projectionDigest') !== projectionDigest) fail('GitHub canonical ref projection is invalid');
  return freeze({ ...payload, projectionDigest });
}
export function createGitHubProtectionSnapshot(canonical, evidence, canonicalHead, bundle) {
  const payload = { schema: GITHUB_PROTECTION_SNAPSHOT_SCHEMA,
    canonical: canonicalProtection(canonical, bundle),
    evidence: evidenceProtection(evidence, bundle),
    canonicalHead: canonicalRefProjection(canonicalHead, bundle) };
  return freeze({ ...payload, snapshotDigest: governanceDigest(payload) });
}
function validateProtectionSnapshot(value, bundle) {
  const source = snap(value);
  exact(source, ['schema', 'canonical', 'evidence', 'canonicalHead', 'snapshotDigest'],
    'GitHub protection snapshot');
  const normalized = createGitHubProtectionSnapshot(
    source.canonical, source.evidence, source.canonicalHead, bundle);
  if (source.schema !== GITHUB_PROTECTION_SNAPSHOT_SCHEMA
    || digest(source.snapshotDigest, 'snapshotDigest') !== normalized.snapshotDigest
    || canonicalJson(source) !== canonicalJson(normalized)) fail('GitHub protection snapshot is not canonical or eligible');
  return normalized;
}
function authorityId(subject) {
  const match = text(subject, 'authoritySubject').match(/^github-user:([1-9][0-9]{0,18})$/u);
  if (!match) fail('authoritySubject must be github-user:<id>');
  return match[1];
}
function reviewProjection(value, candidate, repository) {
  if (candidate.reviewLocator === null) {
    if (value !== null) fail('target review must be null when candidate reviewLocator is null');
    return null; }
  const source = snap(value);
  exact(source, ['locator', 'state', 'draft', 'headRepository', 'headBranch', 'headRevision',
    'baseRepository', 'baseBranch', 'baseRevision'], 'GitHub target review projection');
  if (!['open', 'closed', 'merged'].includes(source.state) || typeof source.draft !== 'boolean') fail('GitHub target review state is invalid');
  const result = { locator: text(source.locator, 'target review locator'), state: source.state,
    draft: source.draft,
    headRepository: parseGitHubRepositoryIdentity(source.headRepository).repository,
    headBranch: text(source.headBranch, 'target review head branch'),
    headRevision: revision(source.headRevision, 'target review head revision'),
    baseRepository: parseGitHubRepositoryIdentity(source.baseRepository).repository,
    baseBranch: text(source.baseBranch, 'target review base branch'),
    baseRevision: revision(source.baseRevision, 'target review base revision') };
  if (result.locator !== candidate.reviewLocator || result.headRepository !== repository
    || result.headBranch !== candidate.branch || result.headRevision !== candidate.headRevision
    || result.baseRepository !== repository || result.baseBranch !== candidate.canonicalBranch
    || result.baseRevision !== candidate.canonicalRevision) fail('target review must bind the exact candidate head and canonical base');
  return result;
}
export function createGitHubTargetRepositoryProjection(value, bundle) {
  const source = snap(value);
  exact(source, TARGET_KEYS, 'GitHub target repository projection input', false);
  requireKeys(source, ['repository', 'repositoryId', 'owner', 'canonicalBranch', 'canonicalRevision',
    'candidateBranch', 'candidateHeadRevision', 'review'],
    'GitHub target repository projection input');
  exact(source.owner, ['id', 'login'], 'GitHub target repository owner');
  const parsed = parseGitHubRepositoryIdentity(source.repository, 'target repository');
  const owner = { id: identifier(source.owner.id, 'target owner id'),
    login: text(source.owner.login, 'target owner login').toLowerCase() };
  const { request, candidate } = bundle;
  const canonicalBranch = text(source.canonicalBranch, 'target canonical branch');
  const canonicalRevision = revision(source.canonicalRevision, 'target canonical revision');
  const candidateBranch = text(source.candidateBranch, 'target candidate branch');
  const candidateHeadRevision = revision(source.candidateHeadRevision, 'target candidate head');
  if (!LOGIN.test(owner.login) || owner.login !== parsed.owner || owner.login !== bundle.workflowRun.actor.login
    || parsed.repository !== request.repository || owner.id !== authorityId(request.authoritySubject)
    || canonicalBranch !== candidate.canonicalBranch
    || canonicalRevision !== candidate.canonicalRevision || candidateBranch !== candidate.branch
    || candidateHeadRevision !== candidate.headRevision) fail('target repository must be the exact same-owner authority target');
  const payload = { schema: GITHUB_TARGET_REPOSITORY_SCHEMA, repository: parsed.repository,
    repositoryId: identifier(source.repositoryId, 'target repository id'),
    owner, canonicalBranch, canonicalRevision, candidateBranch, candidateHeadRevision,
    review: reviewProjection(source.review, candidate, parsed.repository) };
  const projectionDigest = governanceDigest(payload);
  if (source.schema !== undefined && source.schema !== payload.schema) fail('GitHub target repository projection schema is invalid');
  if (source.projectionDigest !== undefined
    && digest(source.projectionDigest, 'target projection digest') !== projectionDigest) fail('GitHub target repository projection digest is invalid');
  return freeze({ ...payload, projectionDigest });
}
function validateTargetRepositoryProjection(value, bundle) {
  const source = snap(value), normalized = createGitHubTargetRepositoryProjection(source, bundle);
  exact(source, TARGET_KEYS, 'GitHub target repository projection');
  if (canonicalJson(source) !== canonicalJson(normalized)) fail('GitHub target repository projection is not canonical');
  return normalized;
}
export function createGitHubStoredAuthorityBundle(input) {
  const source = snap(input);
  exact(source, STORED_KEYS, 'GitHub stored authority bundle input', false);
  requireKeys(source, ['authorityBundle', 'targetRepository', 'preProtection'],
    'GitHub stored authority bundle input');
  const authorityBundle = validateFencedClaimBundle(source.authorityBundle);
  const targetRepository = validateTargetRepositoryProjection(
    source.targetRepository, authorityBundle);
  const preProtection = validateProtectionSnapshot(source.preProtection, authorityBundle);
  const payload = { schema: GITHUB_STORED_AUTHORITY_BUNDLE_SCHEMA,
    authorityBundle, targetRepository, preProtection };
  const storedDigest = governanceDigest(payload);
  if (source.schema !== undefined && source.schema !== payload.schema) fail('GitHub stored authority bundle schema is invalid');
  if (source.storedDigest !== undefined
    && digest(source.storedDigest, 'storedDigest') !== storedDigest) fail('GitHub stored authority bundle digest is invalid');
  return freeze({ ...payload, storedDigest });
}
export function validateGitHubStoredAuthorityBundle(value) {
  const source = snap(value), normalized = createGitHubStoredAuthorityBundle(source);
  exact(source, STORED_KEYS, 'GitHub stored authority bundle');
  if (canonicalJson(source) !== canonicalJson(normalized)) fail('GitHub stored authority bundle is not canonical');
  return normalized;
}
export function validateGitHubEvidencePublication(value, stored) {
  const source = snap(value);
  exact(source, ['repository', 'ref', 'path', 'revision', 'parentRevision',
    'committedAt', 'storedDigest'], 'GitHub evidence publication');
  const bundle = stored.authorityBundle;
  const result = {
    repository: parseGitHubRepositoryIdentity(source.repository).repository,
    ref: ref(source.ref, 'publication.ref'),
    path: text(source.path, 'publication.path'),
    revision: revision(source.revision, 'publication.revision'),
    parentRevision: revision(source.parentRevision, 'publication.parentRevision'),
    committedAt: instant(source.committedAt, 'publication.committedAt'),
    storedDigest: digest(source.storedDigest, 'publication.storedDigest'),
  };
  if (result.repository !== bundle.policy.evidenceRepository
    || result.ref !== bundle.evidenceRef || result.path !== bundle.evidencePath
    || result.parentRevision !== bundle.policy.canonicalRevision
    || result.revision === result.parentRevision || result.storedDigest !== stored.storedDigest
    || Date.parse(result.committedAt) < Date.parse(bundle.challenge.issuedAt)
    || Date.parse(result.committedAt) >= Date.parse(bundle.challenge.expiresAt)) fail('GitHub evidence publication is not exact, descendant, and in-window');
  return freeze(result);
}
export function createGitHubPublicationReceipt(input) {
  const source = snap(input);
  exact(source, RECEIPT_INPUT_KEYS, 'GitHub publication receipt input', false);
  requireKeys(source, ['storedBundle', 'publication', 'postProtection'],
    'GitHub publication receipt input');
  const stored = validateGitHubStoredAuthorityBundle(source.storedBundle);
  const observed = validateGitHubEvidencePublication(source.publication, stored);
  const postProtection = validateProtectionSnapshot(
    source.postProtection, stored.authorityBundle);
  if (canonicalJson(stored.preProtection) !== canonicalJson(postProtection)) {
    fail('GitHub protection changed across evidence publication');
  }
  const payload = {
    schema: GITHUB_PUBLICATION_RECEIPT_SCHEMA,
    adapter: { ...GITHUB_AUTHORITY_ADAPTER },
    storedDigest: stored.storedDigest,
    evidenceRepository: observed.repository,
    evidenceRef: observed.ref,
    evidencePath: observed.path,
    publicationRevision: observed.revision,
    parentRevision: observed.parentRevision,
    committedAt: observed.committedAt,
    targetRepository: stored.targetRepository,
    preProtection: stored.preProtection,
    postProtection,
  };
  const receiptDigest = governanceDigest(payload);
  if (source.receiptDigest !== undefined
    && digest(source.receiptDigest, 'publication receiptDigest') !== receiptDigest) {
    fail('GitHub publication receipt digest is invalid');
  }
  return freeze({ ...payload, receiptDigest });
}
export function createGitHubAuthorityIssuance(input) {
  const source = snap(input);
  exact(source, ISSUANCE_KEYS, 'GitHub authority issuance input', false);
  requireKeys(source, ['storedBundle', 'publicationReceipt'], 'GitHub authority issuance input');
  const storedBundle = validateGitHubStoredAuthorityBundle(source.storedBundle);
  const publicationReceipt = createGitHubPublicationReceipt({
    storedBundle,
    publication: {
      repository: source.publicationReceipt.evidenceRepository,
      ref: source.publicationReceipt.evidenceRef,
      path: source.publicationReceipt.evidencePath,
      revision: source.publicationReceipt.publicationRevision,
      parentRevision: source.publicationReceipt.parentRevision,
      committedAt: source.publicationReceipt.committedAt,
      storedDigest: source.publicationReceipt.storedDigest,
    },
    postProtection: source.publicationReceipt.postProtection,
    receiptDigest: source.publicationReceipt.receiptDigest,
  });
  if (canonicalJson(source.publicationReceipt) !== canonicalJson(publicationReceipt)) {
    fail('GitHub publication receipt is not canonical');
  }
  const request = storedBundle.authorityBundle.request;
  const transitionReceipt = createAuthorityTransitionReceiptEnvelope(request, {
    resultClaimId: request.claimId,
    resultLeaseEpoch: request.leaseEpoch,
    resultFenceRevision: governanceDigest({
      schema: 'agentic-os/github-publication-fence/v1',
      publicationReceiptDigest: publicationReceipt.receiptDigest,
      publicationRevision: publicationReceipt.publicationRevision,
    }),
    resultState: 'current',
    operationReceiptDigest: publicationReceipt.receiptDigest,
    transitionedAt: publicationReceipt.committedAt,
  });
  if (findExactReplay(request, [transitionReceipt])?.receiptDigest
    !== transitionReceipt.receiptDigest) {
    fail('GitHub authority transition is not an exact replay');
  }
  if (source.transitionReceipt !== undefined
    && canonicalJson(source.transitionReceipt) !== canonicalJson(transitionReceipt)) {
    fail('GitHub authority transition receipt is not exact');
  }
  const payload = {
    schema: GITHUB_AUTHORITY_ISSUANCE_SCHEMA,
    storedBundle,
    publicationReceipt,
    transitionReceipt,
  };
  const issuanceDigest = governanceDigest(payload);
  if (source.issuanceDigest !== undefined
    && digest(source.issuanceDigest, 'issuanceDigest') !== issuanceDigest) {
    fail('GitHub authority issuance digest is invalid');
  }
  return freeze({ ...payload, issuanceDigest });
}
/** Structural validation only; authenticate current provider state with the live verifier. */
export function validateGitHubAuthorityIssuance(value) {
  const source = snap(value), normalized = createGitHubAuthorityIssuance(source);
  exact(source, ISSUANCE_KEYS, 'GitHub authority issuance');
  if (canonicalJson(source) !== canonicalJson(normalized)) {
    fail('GitHub authority issuance is not canonical');
  }
  return normalized;
}
