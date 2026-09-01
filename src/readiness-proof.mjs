#!/usr/bin/env node
/** Fail closed when a Markdown readiness claim has no existing proof artifact. */

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { observeGit, trackedChanges, worktreeCleanupRisks } from './git.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..');
const TEST_REPORTER_PATH = fileURLToPath(import.meta.url);
export const PROOF_KINDS = Object.freeze(['live-provider', 'contract', 'doc-parse', 'none']);
export const LIVE_PROOF_SCHEMA = 'agentic-os-live-provider-proof/v1';
export const CONTRACT_PROOF_SCHEMA = 'agentic-os-contract-proof/v1';
export const LIVE_PROOF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const MARKER = /<!--\s*readiness-proof\s+kind=([^\s]+)\s+evidence=([^\s]+)\s*-->/g;
const CLAIM_RULES = [
  { pattern: /\b(?:runtime|production|deployment)[ -]ready\b/i, proof: 'live-provider' },
  { pattern: /\bready for (?:runtime|production|deployment)\b/i, proof: 'live-provider' },
  { pattern: /^\s*status:\s*(?:runtime-ready|production-ready|deployed)\s*$/i, proof: 'live-provider' },
  { pattern: /\bcontract[ -]ready\b/i, proof: 'contract' },
  { pattern: /\bdoc[ -]parse[ -]ready\b/i, proof: 'doc-parse' },
];
const PROOF_STRENGTH = Object.freeze({ none: 0, 'doc-parse': 1, contract: 2, 'live-provider': 3 });

/** Machine-owned summary reporter used when this module is loaded by `node --test`. */
export default async function* readinessTestReporter(events) {
  const proofPath = process.env.AGENTIC_OS_PROOF_PATH;
  const sentinel = process.env.AGENTIC_OS_PROOF_SENTINEL;
  const result = { pass: 0, fail: 0, skipped: 0, todo: 0 };
  for await (const event of events) {
    const name = event.data?.name;
    const wrapper = typeof name === 'string' && (name === proofPath || resolve(name) === proofPath);
    if (event.type === 'test:fail') result.fail += 1;
    if (event.type === 'test:pass' && !wrapper && event.data?.skip) result.skipped += 1;
    if (event.type === 'test:pass' && !wrapper && event.data?.todo) result.todo += 1;
    if (event.type === 'test:pass' && !wrapper && !event.data?.skip && !event.data?.todo) result.pass += 1;
  }
  yield `${sentinel}${Buffer.from(JSON.stringify(result)).toString('base64')}\n`;
}

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

function unfencedLines(text) {
  const lines = [];
  let fence = null;
  text.split('\n').forEach((line, index) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const validOpening = marker && !(marker[1][0] === '`' && marker[2].includes('`'));
    if (!fence && validOpening) {
      fence = { character: marker[1][0], length: marker[1].length };
      return;
    }
    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
      return;
    }
    lines.push({ line, number: index + 1 });
  });
  return lines;
}

function negated(line, claimIndex) {
  const prefix = line.slice(0, claimIndex);
  const clause = prefix.split(/[,!?;:]|\b(?:although|but|however|nevertheless|though|yet)\b/i).at(-1);
  if (/\bnot\s+(?:just|merely|only)\s*$/i.test(clause)) return false;
  return /\b(?:not|never|no longer|cannot|can't|isn't|aren't|wasn't|weren't|must not|should not|do not|don't)\b(?:\s+[\w'-]+){0,4}\s*$/i
    .test(clause);
}

export function readinessClaims(text) {
  const claims = [];
  for (const { line: source, number } of unfencedLines(text)) {
    const line = source.replace(MARKER, '');
    for (const rule of CLAIM_RULES) {
      const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
      for (const match of line.matchAll(pattern)) {
        if (!negated(line, match.index)) claims.push({ line: number, proof: rule.proof });
      }
    }
  }
  return claims;
}

export function claimLines(text) {
  return [...new Set(readinessClaims(text).map((claim) => claim.line))];
}

export function proofMarkers(text) {
  const markers = [];
  for (const { line } of unfencedLines(text)) {
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

function sha256(text) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function gitOutput(root, args) {
  return observeGit(args, { cwd: root });
}

function sourceClean(root, evidenceAt, options) {
  if (options.isSourceClean) return options.isSourceClean(evidenceAt);
  try {
    const changes = trackedChanges(root);
    const risks = worktreeCleanupRisks(root);
    const outsideEvidence = (paths) => paths.some((path) => path !== evidenceAt);
    return !outsideEvidence(changes.headToIndex.map(({ path }) => path))
      && !outsideEvidence(changes.indexToWorkingTree.map(({ path }) => path))
      && !outsideEvidence(risks.hidden)
      && !outsideEvidence(risks.tracked)
      && !outsideEvidence(risks.owned);
  } catch {
    return false;
  }
}

function sourceCompatible(root, sourceRevision, evidenceAt, options) {
  const head = options.headRevision ?? gitOutput(root, ['rev-parse', 'HEAD']);
  return sourceRevision === head && sourceClean(root, evidenceAt, options);
}

export function executableTest(path, claimDigest) {
  try {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const sentinel = `__AGENTIC_OS_CONTRACT_PROOF_${randomBytes(16).toString('hex')}__`;
    const bindingScript = [
      `const proof = (await import(${JSON.stringify(pathToFileURL(path).href)})).READINESS_PROOF;`,
      `process.stdout.write(${JSON.stringify(sentinel)} + Buffer.from(JSON.stringify(proof)).toString('base64') + '\\n');`,
    ].join('\n');
    const bindingOutput = execFileSync(process.execPath, ['--input-type=module', '--eval', bindingScript], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: environment,
    });
    const testOutput = execFileSync(process.execPath, [
      '--test',
      `--test-reporter=${TEST_REPORTER_PATH}`,
      path,
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...environment,
        AGENTIC_OS_PROOF_PATH: path,
        AGENTIC_OS_PROOF_SENTINEL: sentinel,
      },
    });
    const encoded = (output) => [...output.matchAll(new RegExp(`${sentinel}([A-Za-z0-9+/=]+)`, 'g'))]
      .at(-1)?.[1];
    const proof = JSON.parse(Buffer.from(encoded(bindingOutput) ?? '', 'base64').toString('utf8'));
    const result = JSON.parse(Buffer.from(encoded(testOutput) ?? '', 'base64').toString('utf8'));
    return result.pass > 0
      && result.fail === 0
      && result.skipped === 0
      && result.todo === 0
      && proof?.schema === CONTRACT_PROOF_SCHEMA
      && Array.isArray(proof.claims)
      && proof.claims.includes(claimDigest);
  } catch {
    return false;
  }
}

function validProofArtifact(kind, path, root, document, options) {
  const at = relative(root, path);
  if (kind === 'contract' || kind === 'doc-parse') {
    return /^__tests__[\\/][^.\\/][^\\/]*\.test\.mjs$/.test(at)
      && executableTest(path, sha256(document.text));
  }
  if (kind !== 'live-provider') return false;
  try {
    const receipt = JSON.parse(readFileSync(path, 'utf8'));
    const observedAt = Date.parse(receipt.observedAt);
    const age = (options.now?.() ?? Date.now()) - observedAt;
    const producerVerified = options.verifyLiveProvider?.(receipt, {
      root,
      evidencePath: path,
      claimPath: document.path,
    }) === true;
    return receipt.schema === LIVE_PROOF_SCHEMA
      && receipt.status === 'passed'
      && typeof receipt.provider === 'string' && receipt.provider.length > 0
      && typeof receipt.target === 'string' && receipt.target.length > 0
      && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(receipt.sourceRevision)
      && sourceCompatible(root, receipt.sourceRevision, relative(root, path), options)
      && Number.isFinite(observedAt) && age >= 0 && age <= LIVE_PROOF_MAX_AGE_MS
      && receipt.claim?.path === relative(root, document.path)
      && receipt.claim?.digest === sha256(document.text)
      && typeof receipt.check?.name === 'string' && receipt.check.name.length > 0
      && typeof receipt.check?.receipt === 'string' && receipt.check.receipt.length > 0
      && receipt.check.exitCode === 0
      && producerVerified;
  } catch {
    return false;
  }
}

export function inspectDocument(path, root = ROOT, options = {}) {
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
  if (!validProofArtifact(marker.kind, evidencePath, root, { path, text }, options)) {
    return [{ path: at, kind: 'invalid-proof-artifact', claims, measured: marker.evidence }];
  }
  return [];
}

export function violations(root = ROOT, options = {}) {
  return markdownFiles(root).flatMap((path) => inspectDocument(path, root, options));
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

if (process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href)
  process.exit(report());
