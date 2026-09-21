/** Bounded review text and optional repository-owned metadata preflight. */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { gitLines, headSha } from '../src/git.mjs';
import { parseLaneRef } from '../src/lane-id.mjs';
import { VALIDATION_POLICY, validateValidationPolicy } from './agentic-os-validation-policy.mjs';
import { readRegular } from './agentic-os-test-inputs.mjs';
import { readReviewBody, reviewIdentity, validateReviewTitle, reviewMetadataInput } from '../src/protected-workflows.mjs';

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

/** Reserve exact trailer space before commit/fetch; actual identity is appended after commit. */
export function validateReviewBody(root, ref, file, title = null) {
  validateReviewTitle(title);
  const body = file === null ? null : readReviewBody(resolve(root, file), `\n\n${reviewIdentity(ref, headSha('HEAD', root), headSha('HEAD', root))}`);
  validateOwnerBody(root, ref, body);
}
/** Capture review text before publication; identity trailers are not integration proof. */
export function pullRequestText(root, ref, laneHeadSha, baseSha, bodyFile = null, authoredTitle = null) {
  validateReviewTitle(authoredTitle);
  const subjects = gitLines(['log', '--format=%s', `${baseSha}..${laneHeadSha}`, '--reverse'], {
    cwd: root,
  });
  const scope = parseLaneRef(ref)?.scope ?? ref;
  const title = authoredTitle ?? (subjects.length === 1 ? subjects[0] : `${scope}: ${subjects.length} commits`);
  const identity = reviewIdentity(ref, laneHeadSha, baseSha);
  const body = bodyFile === null ? [
    ...(subjects.length > 1 ? [...subjects.map((subject) => `- ${subject}`), ''] : []),
    identity,
  ].join('\n') : readReviewBody(resolve(root, bodyFile), `\n\n${identity}`);
  validateOwnerBody(root, ref, bodyFile === null ? null : body);
  return { title, body };
}

export function validateReviewMetadata(root, environment = process.env) {
  const { ref, body, receipt } = reviewMetadataInput(root, environment);
  validateOwnerBody(root, ref, body);
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'metadata') throw new Error('expected review-body metadata');
    console.log(JSON.stringify(validateReviewMetadata(process.cwd())));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
