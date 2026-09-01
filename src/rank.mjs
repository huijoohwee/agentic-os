#!/usr/bin/env node
/** ADLC ranking: hard constraints, Pareto dominance, then grounded argumentation. */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { types } from 'node:util';
import {
  CATALOG_PATH,
  ROOT,
  canonicalJson,
  featureCatalogDigest,
  inspectFeatureCatalog,
  loadFeatureCatalog,
} from './feature-catalog.mjs';
import { demandEvidenceVerification, snapshotFeatureEvidence } from './feature-grounding.mjs';

export const RANKING_RESULT_SCHEMA = 'agentic-os-feature-ranking/v1';
export const CRITERIA = Object.freeze([
  Object.freeze({ key: 'codeDeltaLines', direction: 'min' }),
  Object.freeze({ key: 'firstDollarHours', direction: 'min' }),
  Object.freeze({ key: 'incrementalSpendUsd', direction: 'min' }),
]);
const FOSS_LICENSES = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT']);

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const byCanonical = (left, right) => compareText(canonicalJson(left), canonicalJson(right));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function finalize(value) {
  return deepFreeze({ ...value, digest: sha256(value) });
}

function finding(code, detail) {
  if (detail === undefined) return { code };
  const bounded = typeof detail === 'string'
    && detail.length <= 512 && Buffer.byteLength(detail, 'utf8') <= 512
    ? detail
    : 'detail-over-budget';
  return { code, detail: bounded };
}

function constraintOutcome(candidate, profile, root, evidenceContents, options) {
  const found = [];
  const { pain, solution, estimates, requirements } = candidate;
  let demandVerification = null;
  const demandAttempts = [];
  if (pain.namedProspectivePayer === null) found.push(finding('named-payer-missing'));
  if (pain.evidenceRefs.length === 0) found.push(finding('pain-evidence-missing'));
  if (pain.demandEvidenceRefs.length === 0) found.push(finding('demand-evidence-missing'));
  else {
    for (const ref of [...pain.demandEvidenceRefs].sort(compareText)) {
      const result = demandEvidenceVerification(root, ref, candidate, {
        contents: evidenceContents,
        evaluatedAt: options.evaluatedAt,
        evaluatedAtMs: options.evaluatedAtMs,
        verifyDemandEvidence: options.verifyDemandEvidence,
      });
      demandAttempts.push(result.attempt);
      demandVerification = result.verification;
      if (demandVerification) break;
    }
    if (!demandVerification) found.push(finding('demand-evidence-invalid'));
  }
  if (solution.evidenceRefs.length === 0) found.push(finding('solution-evidence-missing'));

  for (const [key, code] of [
    ['codeDeltaLines', 'code-delta-unestimable'],
    ['firstDollarHours', 'first-dollar-unestimable'],
    ['incrementalSpendUsd', 'spend-unestimable'],
    ['runtimeDependencies', 'runtime-dependencies-unestimable'],
  ]) {
    if (estimates[key] === null) found.push(finding(code));
  }
  if (estimates.codeDeltaLines !== null && estimates.codeDeltaLines > profile.maxCodeDeltaLines) {
    found.push(finding('code-budget-exceeded', `${estimates.codeDeltaLines}>${profile.maxCodeDeltaLines}`));
  }
  if (estimates.firstDollarHours !== null
    && estimates.firstDollarHours > profile.maxFirstDollarHours) {
    found.push(finding(
      'time-budget-exceeded',
      `${estimates.firstDollarHours}>${profile.maxFirstDollarHours}`,
    ));
  }
  if (estimates.incrementalSpendUsd !== null
    && estimates.incrementalSpendUsd > profile.maxIncrementalSpendUsd) {
    found.push(finding(
      'spend-budget-exceeded',
      `${estimates.incrementalSpendUsd}>${profile.maxIncrementalSpendUsd}`,
    ));
  }
  if (estimates.runtimeDependencies !== null
    && estimates.runtimeDependencies > profile.maxRuntimeDependencies) {
    found.push(finding(
      'runtime-dependency-budget-exceeded',
      `${estimates.runtimeDependencies}>${profile.maxRuntimeDependencies}`,
    ));
  }
  if (estimates.runtimeDependencies !== null
    && estimates.runtimeDependencies !== requirements.dependencies.length) {
    found.push(finding(
      'dependency-count-mismatch',
      `${estimates.runtimeDependencies}!=${requirements.dependencies.length}`,
    ));
  }
  if (requirements.deployment && !profile.deploymentAllowed) found.push(finding('deployment-boundary'));
  if (requirements.browserSurface && !profile.browserSurfaceAvailable) {
    found.push(finding('browser-surface-missing'));
  }
  if (profile.fossOnly) {
    for (const dependency of requirements.dependencies) {
      if (!FOSS_LICENSES.has(dependency.license)) {
        found.push(finding('non-foss-dependency', `${dependency.name}:${dependency.license}`));
      }
    }
  }
  return { findings: found.sort(byCanonical), demandAttempts, demandVerification };
}

export function dominates(left, right) {
  const metrics = CRITERIA.flatMap(({ key }) => [left.estimates?.[key], right.estimates?.[key]]);
  if (!metrics.every(Number.isFinite)) return false;
  const relations = CRITERIA.map(({ key }) => left.estimates[key] - right.estimates[key]);
  return relations.every((relation) => relation <= 0) && relations.some((relation) => relation < 0);
}

function comparison(left, right) {
  const criteria = Object.fromEntries(CRITERIA.map(({ key }) => {
    const delta = left.estimates[key] - right.estimates[key];
    return [key, delta < 0 ? 'better' : delta > 0 ? 'worse' : 'equal'];
  }));
  const leftDominates = dominates(left, right);
  const rightDominates = dominates(right, left);
  const outcome = leftDominates
    ? 'left-dominates'
    : rightDominates
      ? 'right-dominates'
      : Object.values(criteria).every((value) => value === 'equal')
        ? 'equal'
        : 'incomparable';
  return { left: left.id, right: right.id, criteria, outcome };
}

export function groundedLabels(arguments_) {
  const ordered = [...arguments_].sort((left, right) => compareText(left.id, right.id));
  const attackers = new Map(ordered.map((argument) => [argument.id, []]));
  for (const argument of ordered) {
    for (const target of argument.attacks) attackers.get(target)?.push(argument.id);
  }
  for (const values of attackers.values()) values.sort();

  const accepted = new Set();
  const rejected = new Set();
  const rounds = [];
  while (true) {
    const undecided = ordered.filter((argument) => !accepted.has(argument.id) && !rejected.has(argument.id));
    const nextAccepted = undecided
      .filter((argument) => attackers.get(argument.id).every((id) => rejected.has(id)))
      .map((argument) => argument.id);
    const nextRejected = undecided
      .filter((argument) => attackers.get(argument.id).some((id) => accepted.has(id)))
      .map((argument) => argument.id);
    if (nextAccepted.length === 0 && nextRejected.length === 0) break;
    nextAccepted.forEach((id) => accepted.add(id));
    nextRejected.forEach((id) => rejected.add(id));
    rounds.push({ accepted: nextAccepted, rejected: nextRejected });
  }
  return {
    rounds,
    accepted: [...accepted].sort(),
    rejected: [...rejected].sort(),
    undecided: ordered
      .map((argument) => argument.id)
      .filter((id) => !accepted.has(id) && !rejected.has(id)),
  };
}

function argumentation(frontier, arguments_) {
  const ids = new Set(frontier);
  const relevant = arguments_.filter((argument) => ids.has(argument.candidateId));
  const labels = groundedLabels(relevant);
  const accepted = new Set(labels.accepted);
  const rejected = new Set(labels.rejected);
  const findings = [];
  const reasons = [];

  for (const candidateId of frontier) {
    const candidateReasons = relevant.filter((argument) => {
      return argument.candidateId === candidateId && argument.role === 'reason';
    });
    if (candidateReasons.length !== 1) {
      findings.push(finding('reason-count', `${candidateId}:${candidateReasons.length}`));
      continue;
    }
    const [reason] = candidateReasons;
    const counters = relevant.filter((argument) => {
      return argument.candidateId === candidateId
        && argument.role === 'counter'
        && argument.attacks.includes(reason.id);
    });
    if (counters.length === 0) findings.push(finding('counter-missing', candidateId));
    const label = accepted.has(reason.id) ? 'accepted' : rejected.has(reason.id) ? 'rejected' : 'undecided';
    reasons.push({ candidateId, argumentId: reason.id, label });
  }

  const acceptedReasons = reasons.filter((reason) => reason.label === 'accepted');
  const resolved = findings.length === 0
    && acceptedReasons.length === 1
    && reasons.every((reason) => reason.label === 'rejected' || reason.label === 'accepted');
  return {
    status: resolved ? 'resolved' : 'unresolved',
    findings: findings.sort(byCanonical),
    ...labels,
    reasons: reasons.sort((left, right) => compareText(left.candidateId, right.candidateId)),
    selected: resolved ? acceptedReasons[0].candidateId : null,
  };
}

function invalidResult(findings, catalogDigest = null) {
  return finalize({
    schema: RANKING_RESULT_SCHEMA,
    ok: false,
    status: 'rejected',
    code: 'catalog-invalid',
    catalogDigest,
    selected: null,
    findings,
  });
}

function optionValue(options, key, fallback) {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (!descriptor) return fallback;
  if (!Object.hasOwn(descriptor, 'value')) throw new TypeError('option accessors are unsupported');
  return descriptor.value;
}

export function rankFeatures(catalog, options = {}) {
  if (options === null || typeof options !== 'object' || types.isProxy(options)
    || Array.isArray(options)) {
    return invalidResult([finding('ranking-options-invalid')]);
  }
  let root;
  let nowOption;
  let verifyDemandEvidence;
  try {
    root = optionValue(options, 'root', ROOT);
    nowOption = optionValue(options, 'now');
    verifyDemandEvidence = optionValue(options, 'verifyDemandEvidence');
  } catch {
    return invalidResult([finding('ranking-options-invalid')]);
  }
  if (typeof root !== 'string' || root.length === 0) {
    return invalidResult([finding('ranking-root-invalid')]);
  }
  const inspection = inspectFeatureCatalog(catalog, { root });
  if (!inspection.ok) {
    const observedDigest = typeof inspection.catalog?.digest === 'string'
      ? inspection.catalog.digest
      : null;
    return invalidResult(inspection.findings, observedDigest);
  }
  const rankedCatalog = deepFreeze(inspection.catalog);
  const now = nowOption ?? Date.now;
  const catalogDigest = featureCatalogDigest(rankedCatalog);
  let evidence;
  try {
    evidence = snapshotFeatureEvidence(rankedCatalog, { root });
  } catch {
    return finalize({
      schema: RANKING_RESULT_SCHEMA,
      ok: false,
      status: 'rejected',
      code: 'evidence-read-failed',
      catalogDigest,
      selected: null,
      findings: [finding('evidence-read-failed')],
    });
  }
  let evaluatedAtMs;
  let evaluatedAt;
  try {
    evaluatedAtMs = now();
    if (!Number.isFinite(evaluatedAtMs)) throw new TypeError('evaluation time must be finite');
    evaluatedAt = new Date(evaluatedAtMs).toISOString();
  } catch {
    return finalize({
      schema: RANKING_RESULT_SCHEMA,
      ok: false,
      status: 'rejected',
      code: 'evaluation-time-invalid',
      catalogDigest,
      selected: null,
      findings: [finding('evaluation-time-invalid')],
    });
  }
  const rankingOptions = { evaluatedAt, evaluatedAtMs, verifyDemandEvidence };
  const candidates = [...rankedCatalog.candidates]
    .sort((left, right) => compareText(left.id, right.id));
  const constraints = candidates.map((candidate) => {
    const outcome = constraintOutcome(
      candidate,
      rankedCatalog.profile,
      root,
      evidence.contents,
      rankingOptions,
    );
    return {
      candidateId: candidate.id,
      admitted: outcome.findings.length === 0,
      findings: outcome.findings,
      demandAttempts: outcome.demandAttempts,
      demandVerification: outcome.demandVerification,
    };
  });
  const admittedIds = constraints.filter((item) => item.admitted).map((item) => item.candidateId);
  const admittedSet = new Set(admittedIds);
  const admitted = candidates.filter((candidate) => admittedSet.has(candidate.id));
  const comparisons = [];
  for (let left = 0; left < admitted.length; left += 1) {
    for (let right = left + 1; right < admitted.length; right += 1) {
      comparisons.push(comparison(admitted[left], admitted[right]));
    }
  }
  const dominated = admitted.map((candidate) => ({
    candidateId: candidate.id,
    by: admitted.filter((other) => dominates(other, candidate)).map((other) => other.id).sort(),
  })).filter((item) => item.by.length > 0);
  const dominatedIds = new Set(dominated.map((item) => item.candidateId));
  const frontier = admittedIds.filter((id) => !dominatedIds.has(id));

  let selected = null;
  let status = 'no-admissible-candidate';
  let argumentTrail = {
    status: 'not-needed',
    findings: [],
    rounds: [],
    accepted: [],
    rejected: [],
    undecided: [],
    reasons: [],
    selected: null,
  };
  if (frontier.length === 1) {
    [selected] = frontier;
    status = 'selected';
  } else if (frontier.length > 1) {
    argumentTrail = argumentation(frontier, rankedCatalog.arguments);
    selected = argumentTrail.selected;
    status = selected ? 'selected' : 'unresolved';
  }

  return finalize({
    schema: RANKING_RESULT_SCHEMA,
    ok: true,
    status,
    catalogDigest,
    evaluatedAt: rankedCatalog.candidates.some((candidate) => {
      return candidate.pain.demandEvidenceRefs.length > 0;
    }) ? evaluatedAt : null,
    evidence: evidence.manifest,
    selected,
    trail: {
      constraints,
      admitted: admittedIds,
      comparisons,
      dominated,
      frontier,
      argumentation: argumentTrail,
    },
  });
}

function main() {
  let result;
  try {
    result = rankFeatures(loadFeatureCatalog(CATALOG_PATH));
  } catch (error) {
    result = invalidResult([finding('catalog-read-failed', error.code ?? 'parse-error')]);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? (result.status === 'selected' ? 0 : 2) : 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  process.exitCode = main();
}
