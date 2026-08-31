/** Bounded evidence snapshots and externally verified buyer-demand receipts. */

import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedFile } from './bounded-read.mjs';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEMAND_EVIDENCE_SCHEMA = 'agentic-os-demand-evidence/v1';
export const DEMAND_EVIDENCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_EVIDENCE_REFS = 500;
export const MAX_EVIDENCE_FILE_BYTES = 500_000;
export const MAX_EVIDENCE_TOTAL_BYTES = 4_000_000;

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const boundedText = (value, max = 512) => typeof value === 'string'
  && value.trim().length > 0
  && value.length <= max
  && Buffer.byteLength(value, 'utf8') <= max;

function externalVerificationRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || keys.some((key) => {
    return typeof key !== 'string' || !['verified', 'verifier', 'receipt'].includes(key);
  })) return null;
  const descriptors = Object.fromEntries(keys.map((key) => {
    return [key, Object.getOwnPropertyDescriptor(value, key)];
  }));
  if (Object.values(descriptors).some((descriptor) => {
    return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
  })) return null;
  const record = Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
  return typeof record.verified === 'boolean'
    && boundedText(record.verifier)
    && boundedText(record.receipt)
    ? record
    : null;
}

function deepFreezeJson(value) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) stack.push(child);
    Object.freeze(current);
  }
  return value;
}

function failedVerification(ref, outcome, verifier) {
  return {
    ok: false,
    attempt: { ref, outcome, ...(verifier ? { verifier } : {}) },
    verification: null,
  };
}

function resolveEvidenceFile(root, ref) {
  if (typeof ref !== 'string' || ref.length === 0 || isAbsolute(ref)) return null;
  const absolute = resolve(root, ref);
  if (!(absolute === root || absolute.startsWith(`${root}${sep}`))) return null;
  try {
    const canonicalRoot = realpathSync(root);
    const canonical = realpathSync(absolute);
    const metadata = statSync(canonical);
    const confirmed = realpathSync(canonical);
    return confirmed === canonical
      && canonical.startsWith(`${canonicalRoot}${sep}`) && metadata.isFile()
      ? { path: canonical, identity: { dev: metadata.dev, ino: metadata.ino } }
      : null;
  } catch {
    return null;
  }
}

export function containedEvidencePath(root, ref) {
  return resolveEvidenceFile(root, ref)?.path ?? null;
}

export const evidenceRef = (root, ref) => resolveEvidenceFile(root, ref) !== null;

function evidenceRefs(catalog) {
  const refs = new Set();
  for (const candidate of catalog.candidates) {
    for (const ref of candidate.pain.evidenceRefs) refs.add(ref);
    for (const ref of candidate.pain.demandEvidenceRefs) refs.add(ref);
    for (const ref of candidate.solution.evidenceRefs) refs.add(ref);
  }
  for (const argument of catalog.arguments) {
    for (const ref of argument.evidenceRefs) refs.add(ref);
  }
  return [...refs].sort(compareText);
}

export function snapshotFeatureEvidence(catalog, { root = ROOT } = {}) {
  const contents = new Map();
  const refs = evidenceRefs(catalog);
  if (refs.length > MAX_EVIDENCE_REFS) {
    throw new Error(`evidence reference budget exceeded: ${refs.length}>${MAX_EVIDENCE_REFS}`);
  }
  let totalBytes = 0;
  const manifest = refs.map((ref) => {
    const resolved = resolveEvidenceFile(root, ref);
    if (!resolved) throw new Error(`evidence unavailable: ${ref}`);
    const bytes = readBoundedFile(resolved.path, MAX_EVIDENCE_FILE_BYTES, `evidence file ${ref}`, {
      expectedIdentity: resolved.identity,
      expectedPath: resolved.path,
    });
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_EVIDENCE_TOTAL_BYTES) {
      throw new Error('evidence total byte budget exceeded');
    }
    contents.set(ref, Object.freeze({ bytes, path: resolved.path }));
    return { ref, bytes: bytes.byteLength, digest: sha256(bytes) };
  });
  return { contents, manifest };
}

export function demandClaimDigest(candidate) {
  return sha256(JSON.stringify({
    id: candidate.id,
    offer: candidate.offer,
    pain: {
      statement: candidate.pain.statement,
      namedProspectivePayer: candidate.pain.namedProspectivePayer,
    },
    solution: { statement: candidate.solution.statement },
  }));
}

export function demandEvidenceVerification(root, ref, candidate, options = {}) {
  const {
    contents = null,
    evaluatedAt,
    evaluatedAtMs,
    verifyDemandEvidence,
  } = options;
  if (typeof candidate?.pain?.namedProspectivePayer !== 'string') {
    return failedVerification(ref, 'demand-receipt-invalid');
  }
  let resolved;
  let bytes;
  try {
    if (contents === null) {
      resolved = resolveEvidenceFile(root, ref);
      if (!resolved) return failedVerification(ref, 'demand-evidence-unavailable');
      bytes = readBoundedFile(resolved.path, MAX_EVIDENCE_FILE_BYTES, `evidence file ${ref}`, {
        expectedIdentity: resolved.identity,
        expectedPath: resolved.path,
      });
    } else {
      const snapshot = contents.get(ref);
      if (!snapshot) return failedVerification(ref, 'demand-evidence-unavailable');
      resolved = { path: snapshot.path };
      bytes = snapshot.bytes;
    }
    if (!bytes) return failedVerification(ref, 'demand-evidence-unavailable');
  } catch {
    return failedVerification(ref, 'demand-evidence-unavailable');
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch {
    return failedVerification(ref, 'demand-receipt-invalid');
  }
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)
    || !Number.isFinite(evaluatedAtMs) || typeof evaluatedAt !== 'string') {
    return failedVerification(ref, 'demand-receipt-invalid');
  }
  const observedAt = Date.parse(receipt.observedAt);
  if (!Number.isFinite(observedAt)) return failedVerification(ref, 'demand-receipt-invalid');
  const age = evaluatedAtMs - observedAt;
  if (age < 0 || age > DEMAND_EVIDENCE_MAX_AGE_MS) {
    return failedVerification(ref, 'demand-receipt-stale');
  }
  const claimDigest = demandClaimDigest(candidate);
  const evidenceDigest = sha256(bytes);
  const provider = receipt.provider;
  const providerReceipt = receipt.providerReceipt;
  const structurallyValid = receipt.schema === DEMAND_EVIDENCE_SCHEMA
    && receipt.status === 'verified'
    && boundedText(provider)
    && boundedText(providerReceipt)
    && receipt.candidate?.id === candidate.id
    && receipt.candidate?.claimDigest === claimDigest
    && receipt.payer === candidate.pain.namedProspectivePayer
    && boundedText(receipt.paidArtifact)
    && receipt.currentCost !== null && typeof receipt.currentCost === 'object'
    && !Array.isArray(receipt.currentCost)
    && Number.isFinite(receipt.currentCost.amount) && receipt.currentCost.amount > 0
    && (receipt.currentCost.unit === 'hours' || receipt.currentCost.unit === 'usd')
    && boundedText(receipt.acceptanceCriterion);
  if (!structurallyValid) return failedVerification(ref, 'demand-receipt-invalid');
  if (typeof verifyDemandEvidence !== 'function') {
    return failedVerification(ref, 'demand-verifier-unavailable');
  }
  let external;
  try {
    external = externalVerificationRecord(verifyDemandEvidence(deepFreezeJson(receipt), Object.freeze({
      root,
      evidenceRef: ref,
      evidencePath: resolved.path,
      evidenceDigest,
      candidateId: candidate.id,
      claimDigest,
      evaluatedAt,
    })));
  } catch {
    return failedVerification(ref, 'demand-verifier-error');
  }
  if (!external) return failedVerification(ref, 'demand-verifier-result-invalid');
  const verifier = { id: external.verifier, receipt: external.receipt };
  if (!external.verified) return failedVerification(ref, 'demand-verifier-rejected', verifier);
  const verification = {
    ref,
    provider,
    providerReceipt,
    candidateId: candidate.id,
    claimDigest,
    evidenceDigest,
    observedAt: new Date(observedAt).toISOString(),
    evaluatedAt,
    verifier,
  };
  return { ok: true, attempt: { ref, outcome: 'accepted' }, verification };
}
