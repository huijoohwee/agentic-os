/** Bounded review text and optional repository-owned metadata preflight. */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { readBoundedFile } from '../src/catalog-input.mjs';
import { gitLines, headSha } from '../src/git.mjs';
import { parseLaneRef } from '../src/lane-id.mjs';
import { sourceHeadTrailer } from '../src/patch-identity.mjs';
import { VALIDATION_POLICY, validateValidationPolicy } from './agentic-os-validation-policy.mjs';
import { readRegular } from './agentic-os-test-inputs.mjs';
const MAX_REVIEW_BODY_BYTES = 65_536;

function validateOwnerBody(root, ref, body) {
  const policyPath = resolve(root, VALIDATION_POLICY);
  if (!existsSync(policyPath)) return;
  const policy = validateValidationPolicy(JSON.parse(readRegular(root, VALIDATION_POLICY, 128000).text));
  if (!policy.reviewBodyCheck) return;
  if (body === null) throw Object.assign(new Error('repository review-body check requires --body-file'), { reason: 'blocked-review-body-invalid' });
  readRegular(root, policy.reviewBodyCheck, 499000);
  const result = spawnSync(process.execPath, [resolve(root, policy.reviewBodyCheck)], {
    cwd: root, input: JSON.stringify({ schema: 'agentic-os/review-body-input/v1', ref, body }),
    encoding: 'utf8', timeout: 10000, maxBuffer: 16000, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw Object.assign(new Error(
    `repository review-body check failed: ${result.error?.code ?? result.status}; ${String(result.stderr ?? '').slice(-2000)}`),
    { reason: 'blocked-review-body-invalid' });
}

function readReviewBody(path, suffix) {
  try {
    const bytes = readBoundedFile(path,
      MAX_REVIEW_BODY_BYTES - Buffer.byteLength(suffix, 'utf8'), 'pull request body');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!text.trim() || text.includes('\0'))
      throw new TypeError('pull request body must be nonempty text without NUL');
    if (/^[\t \uFEFF]*(?:Lane|Base-Revision|Source-Head):/imu.test(text))
      throw new TypeError('pull request body must not contain native identity trailer lines');
    return text + suffix;
  } catch (error) {
    throw Object.assign(new Error(`invalid pull request body: ${error.message}`), {
      reason: 'blocked-review-body-invalid',
    });
  }
}

const reviewIdentity = (ref, head, base) => [
  `Lane: ${ref}`, `Base-Revision: ${base}`, sourceHeadTrailer(head),
].join('\n');
/** Reserve exact trailer space before commit/fetch; actual identity is appended after commit. */
export function validateReviewBody(root, ref, file) {
  const body = file === null ? null : readReviewBody(resolve(root, file), `\n\n${reviewIdentity(ref, headSha('HEAD', root), headSha('HEAD', root))}`);
  validateOwnerBody(root, ref, body);
}
/** Capture review text before publication; identity trailers are not integration proof. */
export function pullRequestText(root, ref, laneHeadSha, baseSha, bodyFile = null) {
  const subjects = gitLines(['log', '--format=%s', `${baseSha}..${laneHeadSha}`, '--reverse'], {
    cwd: root,
  });
  const scope = parseLaneRef(ref)?.scope ?? ref;
  const title = subjects.length === 1 ? subjects[0] : `${scope}: ${subjects.length} commits`;
  const identity = reviewIdentity(ref, laneHeadSha, baseSha);
  const body = bodyFile === null ? [
    ...(subjects.length > 1 ? [...subjects.map((subject) => `- ${subject}`), ''] : []),
    identity,
  ].join('\n') : readReviewBody(resolve(root, bodyFile), `\n\n${identity}`);
  validateOwnerBody(root, ref, bodyFile === null ? null : body);
  return { title, body };
}

