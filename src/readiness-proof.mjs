#!/usr/bin/env node
/** Fail closed when a Markdown readiness claim has no existing proof artifact. */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..');
export const PROOF_KINDS = Object.freeze(['live-provider', 'contract', 'doc-parse', 'none']);

const MARKER = /<!--\s*readiness-proof\s+kind=([^\s]+)\s+evidence=([^\s]+)\s*-->/g;
const CLAIMS = [
  /\b(?:runtime|production|deployment)[ -]ready\b/i,
  /\bready for (?:runtime|production|deployment)\b/i,
  /^\s*status:\s*(?:runtime-ready|production-ready|deployed)\s*$/i,
];

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

export function claimLines(text) {
  const lines = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced || line.includes('<!-- readiness-proof')) return;
    if (CLAIMS.some((pattern) => pattern.test(line))) lines.push(index + 1);
  });
  return lines;
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
  return contained && statSync(canonical).isFile() ? canonical : null;
}

export function inspectDocument(path, root = ROOT) {
  const text = readFileSync(path, 'utf8');
  const claims = claimLines(text);
  if (claims.length === 0) return [];

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

  if (!proofFile(root, marker.evidence)) {
    return [{ path: at, kind: 'missing-proof', claims, measured: marker.evidence }];
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
