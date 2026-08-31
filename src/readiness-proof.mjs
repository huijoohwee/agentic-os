#!/usr/bin/env node
/** Fail closed when a Markdown readiness claim has no existing proof artifact. */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..');
export const PROOF_KINDS = Object.freeze(['live-provider', 'contract', 'doc-parse', 'none']);
export const LIVE_PROOF_SCHEMA = 'agentic-os-live-provider-proof/v1';

const MARKER = /<!--\s*readiness-proof\s+kind=([^\s]+)\s+evidence=([^\s]+)\s*-->/g;
const CLAIM_RULES = [
  { pattern: /\b(?:runtime|production|deployment)[ -]ready\b/i, proof: 'live-provider' },
  { pattern: /\bready for (?:runtime|production|deployment)\b/i, proof: 'live-provider' },
  { pattern: /^\s*status:\s*(?:runtime-ready|production-ready|deployed)\s*$/i, proof: 'live-provider' },
  { pattern: /\bcontract[ -]ready\b/i, proof: 'contract' },
  { pattern: /\bdoc[ -]parse[ -]ready\b/i, proof: 'doc-parse' },
];
const PROOF_STRENGTH = Object.freeze({ none: 0, 'doc-parse': 1, contract: 2, 'live-provider': 3 });

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

export function markdownFiles(root = ROOT) {
  return walk(root).sort();
}

export function readinessClaims(text) {
  const claims = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced || line.includes('<!-- readiness-proof')) return;
    for (const rule of CLAIM_RULES) {
      if (rule.pattern.test(line)) claims.push({ line: index + 1, proof: rule.proof });
    }
  });
  return claims;
}

export function claimLines(text) {
  return [...new Set(readinessClaims(text).map((claim) => claim.line))];
}

export function proofMarkers(text) {
  const markers = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(MARKER)) {
      markers.push({ kind: match[1], evidence: match[2] });
    }
  }
  return markers;
}

function proofFile(root, evidence) {
  const path = resolve(root, evidence);
  if (!(path === root || path.startsWith(`${root}${sep}`)) || !existsSync(path)) return null;
  const canonicalRoot = realpathSync(root);
  const canonical = realpathSync(path);
  const contained = canonical === canonicalRoot || canonical.startsWith(`${canonicalRoot}${sep}`);
  return contained && statSync(canonical).isFile() ? path : null;
}

function validProofArtifact(kind, path, root) {
  const at = relative(root, path);
  if (kind === 'contract' || kind === 'doc-parse') {
    return at.startsWith(`__tests__${sep}`) && at.endsWith('.test.mjs');
  }
  if (kind !== 'live-provider') return false;
  try {
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    return receipt.schema === LIVE_PROOF_SCHEMA
      && receipt.status === 'passed'
      && typeof receipt.provider === 'string' && receipt.provider.length > 0
      && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(receipt.sourceRevision)
      && Number.isFinite(Date.parse(receipt.observedAt))
      && typeof receipt.check?.name === 'string' && receipt.check.name.length > 0
      && receipt.check.exitCode === 0;
  } catch {
    return false;
  }
}

export function inspectDocument(path, root = ROOT) {
  const text = readFileSync(path, 'utf8');
  const readiness = readinessClaims(text);
  const claims = [...new Set(readiness.map((claim) => claim.line))];
  if (readiness.length === 0) return [];

  const markers = proofMarkers(text);
  const at = relative(root, path);
  if (markers.length !== 1) {
    return [{ path: at, kind: 'proof-marker-count', claims, measured: markers.length }];
  }

  const [marker] = markers;
  if (!PROOF_KINDS.includes(marker.kind)) {
    return [{ path: at, kind: 'unknown-proof-kind', claims, measured: marker.kind }];
  }
  if (marker.kind === 'none') {
    return [{ path: at, kind: 'unsupported-readiness-claim', claims, measured: marker.kind }];
  }

  const required = readiness.reduce((strongest, claim) => (
    PROOF_STRENGTH[claim.proof] > PROOF_STRENGTH[strongest] ? claim.proof : strongest
  ), 'none');
  if (PROOF_STRENGTH[marker.kind] < PROOF_STRENGTH[required]) {
    return [{ path: at, kind: 'insufficient-proof-kind', claims, measured: `${marker.kind}<${required}` }];
  }

  const evidencePath = proofFile(root, marker.evidence);
  if (!evidencePath) {
    return [{ path: at, kind: 'missing-proof', claims, measured: marker.evidence }];
  }
  if (!validProofArtifact(marker.kind, evidencePath, root)) {
    return [{ path: at, kind: 'invalid-proof-artifact', claims, measured: marker.evidence }];
  }
  return [];
}

export function violations(root = ROOT) {
  return markdownFiles(root).flatMap((path) => inspectDocument(path, root));
}

function report(root = ROOT) {
  const found = violations(root);
  if (found.length === 0) {
    process.stdout.write(`ok   readiness proof ${markdownFiles(root).length} Markdown file(s)\n`);
    return 0;
  }
  process.stdout.write('readiness proof violations:\n');
  for (const item of found) {
    process.stdout.write(`  ${item.kind}: ${item.path}:${item.claims.join(',')} (${item.measured})\n`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(report());
