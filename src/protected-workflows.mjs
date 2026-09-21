/** Bounded workflow and review metadata observation; never source-check or merge authority. */
import { TextDecoder } from 'node:util';
import { decodeNulFields, observeGit, gitLines } from './git.mjs';
import { readBoundedFile } from './catalog-input.mjs';
import { sourceHeadTrailer } from './patch-identity.mjs';
import { parseLaneRef } from './lane-id.mjs';
import { remoteRepositoryIdentity } from './github-provider.mjs';
import { resolveValidationCi } from '../bin/agentic-os-validation.mjs';

export const PROTECTED_WORKFLOW_LIMITS = Object.freeze({
  count: 64,
  perFileBytes: 256 * 1024,
  aggregateBytes: 1024 * 1024,
  listingBytes: 64 * 1024,
});
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const uniqueKeys = (entries) => new Set(entries.map((entry) => entry.key)).size === entries.length;
function mappingEntry(line, index, indentation) {
  const match = line.trim().match(
    /^(?:([A-Za-z0-9_.-]+)|(["'])([A-Za-z0-9_.-]+)\2)\s*:\s*(.*)$/u,
  );
  return match ? { line, index, indentation, key: match[1] ?? match[3], value: match[4] } : null;
}
function rootEntries(lines) {
  const entries = lines.map((line, index) => line.trim() && !/^\s/u.test(line)
    ? mappingEntry(line, index, 0) : false).filter((entry) => entry !== false);
  return entries.some((entry) => entry === null) ? null : entries;
}

function directBlockEntries(lines, start) {
  const parentIndent = lines[start].match(/^\s*/u)[0].length, block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index], indentation = line.match(/^\s*/u)[0].length;
    if (line.trim() !== '' && indentation <= parentIndent) break;
    if (line.trim() !== '') block.push({ line, index, indentation });
  }
  if (block.length === 0) return [];
  const indent = Math.min(...block.map((entry) => entry.indentation));
  const entries = block.filter((entry) => entry.indentation === indent)
    .map((entry) => mappingEntry(entry.line, entry.index, entry.indentation));
  return entries.some((entry) => entry === null) ? null : entries;
}

export function workflowHasMergeGroup(text) {
  const lines = text.split('\n').filter((line) => !/^\s*#/u.test(line));
  const roots = rootEntries(lines);
  if (!roots || !uniqueKeys(roots)) return false;
  const starts = roots.filter((entry) => entry.key === 'on');
  if (starts.length !== 1) return false;
  const [{ index: start, value }] = starts;
  const inline = value.replace(/\s+#.*$/u, '').trim();
  if (inline === 'merge_group') return true;
  if (inline.startsWith('[') && inline.endsWith(']')) {
    const triggers = inline.slice(1, -1).split(',')
      .map((value) => value.trim().replace(/^["']|["']$/gu, ''));
    return triggers.includes('merge_group');
  }
  if (inline !== '') return false;
  const entries = directBlockEntries(lines, start);
  return entries !== null && uniqueKeys(entries)
    && entries.some((entry) => entry.key === 'merge_group');
}

export function workflowMergeGroupChecks(text) {
  if (!workflowHasMergeGroup(text)) return [];
  const lines = text.split('\n').filter((line) => !/^\s*#/u.test(line));
  const roots = rootEntries(lines);
  if (!roots || !uniqueKeys(roots)) return [];
  const starts = roots.filter((entry) => entry.key === 'jobs').map((entry) => entry.index);
  if (starts.length !== 1) return [];
  const jobs = directBlockEntries(lines, starts[0]);
  if (jobs === null || !uniqueKeys(jobs)) return [];
  const fieldsByJob = jobs.map((job) => directBlockEntries(lines, job.index));
  if (fieldsByJob.some((fields) => fields === null || !uniqueKeys(fields))) return [];
  return jobs.flatMap((job, index) => {
    if (job.value !== '') return [];
    const fields = fieldsByJob[index];
    if (fields.some((entry) => ['if', 'strategy', 'uses'].includes(entry.key))) return [];
    const name = fields.find((entry) => entry.key === 'name')?.value?.replace(/\s+#.*$/u, '')
      .replace(/^(["'])(.*)\1$/u, '$2').trim();
    return [name ?? job.key];
  });
}

export function protectedWorkflowSupportsMergeGroup(cwd, policy) {
  const contexts = new Set();
  const listing = observeGit(
    ['ls-tree', '-r', '-z', policy.protectedRef, '--', '.github/workflows'],
    { cwd, binary: true, maxBuffer: PROTECTED_WORKFLOW_LIMITS.listingBytes + 1 },
  );
  if (listing.length > PROTECTED_WORKFLOW_LIMITS.listingBytes)
    throw new Error('protected workflow listing byte budget exceeded');
  const records = decodeNulFields(listing);
  if (!records) throw new Error('protected workflow listing is not strict NUL-delimited UTF-8');
  const workflows = records.map((record) => {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = tab > 0 ? record.slice(0, tab).split(' ') : [];
    return { mode, type, oid, path: tab > 0 ? record.slice(tab + 1) : '' };
  }).filter(({ path }) => /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path));
  if (workflows.length > PROTECTED_WORKFLOW_LIMITS.count)
    throw new Error('protected workflow count budget exceeded');
  let aggregateBytes = 0;
  for (const { mode, type, oid, path } of workflows) {
    if (!['100644', '100755'].includes(mode) || type !== 'blob'
      || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid))
      throw new Error(`protected workflow is not a regular blob: ${path}`);
    const sizeText = observeGit(['cat-file', '-s', oid], { cwd, maxBuffer: 64 });
    if (!/^(?:0|[1-9][0-9]*)$/u.test(sizeText))
      throw new Error('protected workflow has an invalid object size');
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size > PROTECTED_WORKFLOW_LIMITS.perFileBytes)
      throw new Error('protected workflow file byte budget exceeded');
    aggregateBytes += size;
    if (aggregateBytes > PROTECTED_WORKFLOW_LIMITS.aggregateBytes)
      throw new Error('protected workflow aggregate byte budget exceeded');
    const bytes = observeGit(['cat-file', 'blob', oid], {
      cwd, binary: true, maxBuffer: size + 1,
    });
    if (bytes.length !== size) throw new Error('protected workflow changed during inspection');
    let text;
    try { text = UTF8.decode(bytes); } catch {
      throw new Error('protected workflow must be UTF-8');
    }
    workflowMergeGroupChecks(text).forEach((context) => contexts.add(context));
  }
  return policy.requiredChecks.every((context) => contexts.has(context));
}

/** Metadata is its own observation, never a replacement for required source checks. */
export function reviewMetadataInput(root, environment = process.env) {
  const fail = reason => { throw new Error(`blocked-review-metadata:${reason}`); };
  if (environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_EVENT_NAME !== 'pull_request'
    || !environment.GITHUB_EVENT_PATH) fail('provider-context');
  const bytes = readBoundedFile(environment.GITHUB_EVENT_PATH, 499000, 'review event');
  const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const changes = event.changes, pr = event.pull_request;
  if (event.action !== 'edited' || !changes || Array.isArray(changes)
    || !Object.keys(changes).length || Object.keys(changes).some(key => !['body', 'title'].includes(key)))
    fail('source-validation-required');
  for (const change of Object.values(changes)) {
    if (!change || typeof change !== 'object' || Array.isArray(change)
      || Object.keys(change).join() !== 'from' || change.from !== null && typeof change.from !== 'string')
      fail('ambiguous-changes');
  }
  const context = resolveValidationCi(root, environment);
  if (!bytes.equals(readBoundedFile(environment.GITHUB_EVENT_PATH, 499000, 'review event'))) fail('event-drift');
  const repository = remoteRepositoryIdentity(gitLines(['remote', 'get-url', 'origin'], { cwd: root })[0]);
  if (repository?.repository.toLowerCase() !== `github.com/${event.repository?.full_name}`.toLowerCase()
    || !Number.isSafeInteger(pr?.number) || pr.number < 1 || !parseLaneRef(pr.head?.ref)) fail('identity');
  validateReviewTitle(pr.title);
  if (pr.title === null || typeof pr.body !== 'string' || !pr.body.trim() || pr.body.includes('\0')
    || Buffer.byteLength(pr.body) > 65536) fail('text');
  for (const [key, expected] of [['Lane', pr.head.ref], ['Source-Head', pr.head.sha]]) {
    const values = [...pr.body.matchAll(new RegExp(`^${key}: (.+)$`, 'gm'))].map(match => match[1].trim());
    if (values.length !== 1 || values[0] !== expected) fail('review-identity');
  }
  return { ref: pr.head.ref, body: pr.body, receipt: { schema: 'agentic-os/review-metadata/v1', authority: false, repository: repository.repository,
    pullRequest: pr.number, head: pr.head.sha, base: context.base, checkout: context.checkout,
    outcome: 'passed', sourceValidation: 'not-executed', changed: Object.keys(changes).sort() } };
}

export function readReviewBody(path, suffix) {
  try {
    const bytes = readBoundedFile(path,
      65536 - Buffer.byteLength(suffix, 'utf8'), 'pull request body');
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

export const reviewIdentity = (ref, head, base) => [
  `Lane: ${ref}`, `Base-Revision: ${base}`, sourceHeadTrailer(head),
].join('\n');
export function validateReviewTitle(title) {
  if (title === null) return;
  if (typeof title !== 'string' || !title.trim() || title !== title.trim()
      || [...title].length > 256 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(title))
    throw Object.assign(new TypeError('pull request title must be 1-256 characters without surrounding whitespace or control characters'),
      { reason: 'blocked-review-title-invalid' });
}
