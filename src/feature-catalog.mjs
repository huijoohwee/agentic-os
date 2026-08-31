/** Strict, digest-fenced feature catalog validation and evidence containment. */

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readBoundedFile } from './bounded-read.mjs';
import {
  MAX_ARGUMENTS,
  MAX_CANDIDATES,
  MAX_REFS_PER_FIELD,
  snapshotCatalogInput,
} from './catalog-input.mjs';
import { MAX_EVIDENCE_REFS, ROOT, evidenceRef } from './feature-grounding.mjs';

export { ROOT };
export {
  MAX_ARGUMENTS,
  MAX_CANDIDATES,
  MAX_REFS_PER_FIELD,
} from './catalog-input.mjs';
export const FEATURE_CATALOG_SCHEMA = 'agentic-os-feature-catalog/v1';
export const MAX_CATALOG_BYTES = 500_000;
export const MAX_FINDINGS = 500;
export const CATALOG_PATH = fileURLToPath(new URL('../catalog/features.json', import.meta.url));

const TOP_KEYS = ['schema', 'profile', 'entryCount', 'digest', 'candidates', 'arguments'];
const PROFILE_KEYS = [
  'maxCodeDeltaLines',
  'maxFirstDollarHours',
  'maxIncrementalSpendUsd',
  'maxRuntimeDependencies',
  'deploymentAllowed',
  'browserSurfaceAvailable',
  'fossOnly',
];
const CANDIDATE_KEYS = ['id', 'offer', 'pain', 'solution', 'estimates', 'requirements'];
const PAIN_KEYS = ['statement', 'namedProspectivePayer', 'evidenceRefs', 'demandEvidenceRefs'];
const SOLUTION_KEYS = ['statement', 'evidenceRefs'];
const ESTIMATE_KEYS = [
  'codeDeltaLines',
  'firstDollarHours',
  'incrementalSpendUsd',
  'runtimeDependencies',
];
const REQUIREMENT_KEYS = ['deployment', 'browserSurface', 'dependencies'];
const DEPENDENCY_KEYS = ['name', 'license'];
const ARGUMENT_KEYS = ['id', 'candidateId', 'role', 'statement', 'evidenceRefs', 'attacks'];
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROLES = new Set(['reason', 'counter', 'defense']);
const FORBIDDEN_WEIGHTING = /^(?:weight|weights|score|scores|concordance|discordance)$/i;
const MAX_FINDING_DETAIL_BYTES = 512;
const findingStates = new WeakMap();

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function canonicalValue(value, sortArrays) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite number cannot be canonicalized');
    return value;
  }
  if (Array.isArray(value)) {
    const values = value.map((item) => canonicalValue(item, sortArrays));
    return sortArrays
      ? values.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)))
      : values;
  }
  if (!plainObject(value)) throw new TypeError('unsupported catalog value');
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key], sortArrays)]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value, false));
}

export function featureCatalogDigest(catalog) {
  const payload = {
    schema: catalog.schema,
    profile: catalog.profile,
    candidates: catalog.candidates,
    arguments: catalog.arguments,
  };
  const normalized = JSON.stringify(canonicalValue(payload, true));
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

export function loadFeatureCatalog(path = CATALOG_PATH) {
  const bytes = readBoundedFile(path, MAX_CATALOG_BYTES, 'feature catalog');
  return JSON.parse(bytes.toString('utf8'));
}

function boundedDetail(detail) {
  if (detail === undefined) return undefined;
  if (!['string', 'number', 'boolean'].includes(typeof detail)) return 'detail-type-invalid';
  const text = String(detail);
  return text.length <= MAX_FINDING_DETAIL_BYTES
    && Buffer.byteLength(text, 'utf8') <= MAX_FINDING_DETAIL_BYTES
    ? text
    : 'detail-over-budget';
}

function add(findings, code, path, detail) {
  let state = findingStates.get(findings);
  if (!state) {
    state = { keys: new Set(), omitted: 0 };
    findingStates.set(findings, state);
  }
  const safeDetail = boundedDetail(detail);
  const item = { code, path, ...(safeDetail === undefined ? {} : { detail: safeDetail }) };
  const key = JSON.stringify(item);
  if (state.keys.has(key) || findings.length >= MAX_FINDINGS - 1) {
    state.omitted += 1;
    return;
  }
  state.keys.add(key);
  findings.push(item);
}

function exactObject(value, path, allowed, findings) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    add(findings, 'object-required', path);
    return false;
  }
  if (!plainObject(value)) {
    add(findings, 'object-prototype-invalid', path);
    return false;
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) add(findings, 'field-missing', `${path}.${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      add(findings, FORBIDDEN_WEIGHTING.test(key) ? 'unsupported-weighting' : 'field-unknown',
        `${path}.${key}`);
    }
  }
  return true;
}

function nonemptyString(value, path, findings, nullable = false) {
  if (nullable && value === null) return true;
  const valid = typeof value === 'string' && value.trim().length > 0;
  if (!valid) add(findings, 'string-required', path);
  return valid;
}

function stringArray(value, path, findings, { nonempty = false, max = MAX_REFS_PER_FIELD } = {}) {
  if (!Array.isArray(value)) {
    add(findings, 'array-required', path);
    return false;
  }
  let valid = true;
  if (nonempty && value.length === 0) {
    add(findings, 'array-empty', path);
    valid = false;
  }
  if (value.length > max) {
    add(findings, 'array-budget-exceeded', path, `${value.length}>${max}`);
    valid = false;
  }
  value.slice(0, max).forEach((item, index) => {
    if (!nonemptyString(item, `${path}[${index}]`, findings)) valid = false;
  });
  if (value.length <= max && new Set(value).size !== value.length) {
    add(findings, 'array-duplicate', path);
    valid = false;
  }
  return valid;
}

function finiteNonnegative(value, path, findings, { nullable = false, integer = false } = {}) {
  if (nullable && value === null) return;
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    add(findings, integer ? 'nonnegative-integer-required' : 'nonnegative-number-required', path);
  }
}

function validateRefs(value, path, findings, context, options) {
  if (!stringArray(value, path, findings, options)) return;
  value.slice(0, options?.max ?? MAX_REFS_PER_FIELD).forEach((ref, index) => {
    if (!context.evidenceRefs.has(ref)) {
      if (context.evidenceRefs.size >= MAX_EVIDENCE_REFS) {
        if (!context.evidenceBudgetExceeded) {
          add(findings, 'evidence-reference-budget-exceeded', '$',
            `${context.evidenceRefs.size + 1}>${MAX_EVIDENCE_REFS}`);
          context.evidenceBudgetExceeded = true;
        }
        return;
      }
      context.evidenceRefs.add(ref);
    }
    if (!context.evidenceCache.has(ref)) {
      context.evidenceCache.set(ref, evidenceRef(context.root, ref));
    }
    if (!context.evidenceCache.get(ref)) {
      add(findings, 'evidence-ref-invalid', `${path}[${index}]`, ref);
    }
  });
}

function validateProfile(profile, findings) {
  if (!exactObject(profile, 'profile', PROFILE_KEYS, findings)) return;
  finiteNonnegative(profile.maxCodeDeltaLines, 'profile.maxCodeDeltaLines', findings, { integer: true });
  finiteNonnegative(profile.maxFirstDollarHours, 'profile.maxFirstDollarHours', findings);
  finiteNonnegative(profile.maxIncrementalSpendUsd, 'profile.maxIncrementalSpendUsd', findings);
  finiteNonnegative(profile.maxRuntimeDependencies, 'profile.maxRuntimeDependencies', findings, { integer: true });
  for (const key of ['deploymentAllowed', 'browserSurfaceAvailable', 'fossOnly']) {
    if (typeof profile[key] !== 'boolean') add(findings, 'boolean-required', `profile.${key}`);
  }
}

function validateCandidate(candidate, index, findings, context) {
  const path = `candidates[${index}]`;
  if (!exactObject(candidate, path, CANDIDATE_KEYS, findings)) return;
  if (typeof candidate.id !== 'string' || !IDENTIFIER.test(candidate.id)) {
    add(findings, 'identifier-invalid', `${path}.id`);
  }
  nonemptyString(candidate.offer, `${path}.offer`, findings);

  if (exactObject(candidate.pain, `${path}.pain`, PAIN_KEYS, findings)) {
    nonemptyString(candidate.pain.statement, `${path}.pain.statement`, findings);
    nonemptyString(candidate.pain.namedProspectivePayer, `${path}.pain.namedProspectivePayer`, findings, true);
    validateRefs(candidate.pain.evidenceRefs, `${path}.pain.evidenceRefs`, findings, context);
    validateRefs(candidate.pain.demandEvidenceRefs, `${path}.pain.demandEvidenceRefs`, findings,
      context);
  }
  if (exactObject(candidate.solution, `${path}.solution`, SOLUTION_KEYS, findings)) {
    nonemptyString(candidate.solution.statement, `${path}.solution.statement`, findings);
    validateRefs(candidate.solution.evidenceRefs, `${path}.solution.evidenceRefs`, findings, context);
  }
  if (exactObject(candidate.estimates, `${path}.estimates`, ESTIMATE_KEYS, findings)) {
    finiteNonnegative(candidate.estimates.codeDeltaLines, `${path}.estimates.codeDeltaLines`, findings, {
      nullable: true,
      integer: true,
    });
    finiteNonnegative(candidate.estimates.firstDollarHours, `${path}.estimates.firstDollarHours`, findings, {
      nullable: true,
    });
    finiteNonnegative(candidate.estimates.incrementalSpendUsd, `${path}.estimates.incrementalSpendUsd`, findings, {
      nullable: true,
    });
    finiteNonnegative(candidate.estimates.runtimeDependencies, `${path}.estimates.runtimeDependencies`, findings, {
      nullable: true,
      integer: true,
    });
  }
  if (!exactObject(candidate.requirements, `${path}.requirements`, REQUIREMENT_KEYS, findings)) return;
  for (const key of ['deployment', 'browserSurface']) {
    if (typeof candidate.requirements[key] !== 'boolean') {
      add(findings, 'boolean-required', `${path}.requirements.${key}`);
    }
  }
  if (!Array.isArray(candidate.requirements.dependencies)) {
    add(findings, 'array-required', `${path}.requirements.dependencies`);
    return;
  }
  if (candidate.requirements.dependencies.length > MAX_REFS_PER_FIELD) {
    add(findings, 'array-budget-exceeded', `${path}.requirements.dependencies`,
      `${candidate.requirements.dependencies.length}>${MAX_REFS_PER_FIELD}`);
  }
  candidate.requirements.dependencies.slice(0, MAX_REFS_PER_FIELD)
    .forEach((dependency, dependencyIndex) => {
    const dependencyPath = `${path}.requirements.dependencies[${dependencyIndex}]`;
    if (!exactObject(dependency, dependencyPath, DEPENDENCY_KEYS, findings)) return;
    nonemptyString(dependency.name, `${dependencyPath}.name`, findings);
    nonemptyString(dependency.license, `${dependencyPath}.license`, findings);
    });
}

function validateArguments(arguments_, candidateIds, findings, context) {
  if (!Array.isArray(arguments_)) {
    add(findings, 'array-required', 'arguments');
    return;
  }
  if (arguments_.length > MAX_ARGUMENTS) {
    add(findings, 'argument-budget-exceeded', 'arguments', `${arguments_.length}>${MAX_ARGUMENTS}`);
  }
  const boundedArguments = arguments_.slice(0, MAX_ARGUMENTS);
  const ids = new Set();
  boundedArguments.forEach((argument, index) => {
    const path = `arguments[${index}]`;
    if (!exactObject(argument, path, ARGUMENT_KEYS, findings)) return;
    if (typeof argument.id !== 'string' || !IDENTIFIER.test(argument.id)) {
      add(findings, 'identifier-invalid', `${path}.id`);
    }
    if (ids.has(argument.id)) add(findings, 'argument-id-duplicate', `${path}.id`, argument.id);
    ids.add(argument.id);
    if (!candidateIds.has(argument.candidateId)) {
      add(findings, 'argument-candidate-missing', `${path}.candidateId`, argument.candidateId);
    }
    if (!ROLES.has(argument.role)) add(findings, 'argument-role-invalid', `${path}.role`);
    nonemptyString(argument.statement, `${path}.statement`, findings);
    validateRefs(argument.evidenceRefs, `${path}.evidenceRefs`, findings, context, { nonempty: true });
    stringArray(argument.attacks, `${path}.attacks`, findings);
  });
  const byId = new Map(boundedArguments.filter(plainObject).map((argument) => [argument.id, argument]));
  boundedArguments.forEach((argument, index) => {
    if (!plainObject(argument) || !Array.isArray(argument.attacks)) return;
    argument.attacks.slice(0, MAX_REFS_PER_FIELD).forEach((target, attackIndex) => {
      const targetArgument = byId.get(target);
      const path = `arguments[${index}].attacks[${attackIndex}]`;
      if (!targetArgument) add(findings, 'attack-target-missing', path, target);
      else if (targetArgument.candidateId !== argument.candidateId) {
        add(findings, 'cross-candidate-attack', path, target);
      } else if ((argument.role === 'counter' && targetArgument.role !== 'reason')
        || (argument.role === 'defense' && targetArgument.role !== 'counter')
        || argument.role === 'reason') {
        add(findings, 'argument-attack-role-invalid', path, target);
      }
    });
    if (argument.role !== 'reason' && argument.attacks.length === 0) {
      add(findings, 'argument-attack-missing', `arguments[${index}].attacks`);
    }
  });
}

function sortedFindings(findings) {
  const state = findingStates.get(findings);
  const complete = state?.omitted > 0
    ? [...findings, { code: 'findings-omitted', path: '$', detail: String(state.omitted) }]
    : [...findings];
  return complete.sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
}

export function inspectFeatureCatalog(input, { root = ROOT } = {}) {
  const snapshot = snapshotCatalogInput(input);
  if (!snapshot.ok) {
    return { ok: false, findings: sortedFindings(snapshot.findings), catalog: null };
  }
  const catalog = snapshot.value;
  const findings = [];
  const context = {
    root,
    evidenceCache: new Map(),
    evidenceRefs: new Set(),
    evidenceBudgetExceeded: false,
  };
  if (!exactObject(catalog, '$', TOP_KEYS, findings)) {
    return { ok: false, findings: sortedFindings(findings), catalog };
  }
  if (catalog.schema !== FEATURE_CATALOG_SCHEMA) add(findings, 'schema-invalid', 'schema');
  validateProfile(catalog.profile, findings);
  if (!Array.isArray(catalog.candidates)) add(findings, 'array-required', 'candidates');
  const candidates = Array.isArray(catalog.candidates) ? catalog.candidates : [];
  if (candidates.length > MAX_CANDIDATES) {
    add(findings, 'candidate-budget-exceeded', 'candidates', `${candidates.length}>${MAX_CANDIDATES}`);
  }
  const candidateIds = new Set();
  candidates.slice(0, MAX_CANDIDATES).forEach((candidate, index) => {
    validateCandidate(candidate, index, findings, context);
    if (!plainObject(candidate)) return;
    if (candidateIds.has(candidate.id)) {
      add(findings, 'candidate-id-duplicate', `candidates[${index}].id`, candidate.id);
    }
    candidateIds.add(candidate.id);
  });
  validateArguments(catalog.arguments, candidateIds, findings, context);
  if (!Number.isSafeInteger(catalog.entryCount) || catalog.entryCount !== candidates.length) {
    const detail = Number.isSafeInteger(catalog.entryCount)
      ? `${catalog.entryCount}!=${candidates.length}` : 'entry-count-invalid';
    add(findings, 'entry-count-drift', 'entryCount', detail);
  }
  if (typeof catalog.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(catalog.digest)) {
    add(findings, 'digest-invalid', 'digest');
  }
  if (findings.length === 0) {
    try {
      const measured = featureCatalogDigest(catalog);
      if (catalog.digest !== measured) add(findings, 'digest-drift', 'digest', measured);
    } catch (error) {
      add(findings, 'digest-uncomputable', 'digest', error.message);
    }
  }
  return { ok: findings.length === 0, findings: sortedFindings(findings), catalog };
}

export function validateFeatureCatalog(catalog, options = {}) {
  const inspected = inspectFeatureCatalog(catalog, options);
  return { ok: inspected.ok, findings: inspected.findings };
}
