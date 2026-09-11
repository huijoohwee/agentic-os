/** Essential Git publication policy; never stages, deletes, pushes or changes local workspace bytes. */
import { observeGit } from '../src/git.mjs';

export const PUBLICATION_LIMITS = Object.freeze({ files: 512, fileBytes: 499999, totalBytes: 5000000 });
const LOCAL = ['.git', '.DS_Store', 'node_modules', '.cache', '.local', '.owner', '.harness'];
const fail = reason => { throw new Error(`blocked-workspace-publication-${reason}`); };
const portable = path => typeof path === 'string' && path.length <= 256
  && path.split('/').every(part => /^[A-Za-z0-9._-]+$/u.test(part)
    && !['.', '..'].includes(part));
const local = path => path.split('/').some(part => LOCAL.includes(part) || /^\.env(?:\.|$)/u.test(part));
export function validatePublication(config) {
  if (config.publication === undefined) return null;
  const policy = config.publication;
  if (config.schema !== 'agentic-os/workspace/v2' || !policy || Array.isArray(policy)
    || Object.keys(policy).sort().join(',') !== 'files,mode' || policy.mode !== 'essential'
    || !Array.isArray(policy.files) || !policy.files.length || policy.files.length > 32
    || new Set(policy.files).size !== policy.files.length
    || policy.files.some(path => !portable(path) || local(path))
    || !policy.files.includes('.gitignore')
    || !policy.files.includes(`${config.sources.artifacts.path}/README.md`)) fail('policy');
  const artifacts = `${config.sources.artifacts.path}/`;
  if (policy.files.some(path => path.startsWith(artifacts) && path !== `${artifacts}README.md`)) fail('artifact-body');
  return policy;
}
export function sharedWorkspacePath(config, path) {
  const policy = validatePublication(config);
  if (!policy || !portable(path) || local(path)) return false;
  return policy.files.includes(path) || ['memory', 'todo'].some(role =>
    path.startsWith(`${config.sources[role].path}/`));
}
export function workspaceIgnore(config) {
  const policy = validatePublication(config); if (!policy) fail('policy-required');
  const lines = ['# Generated from the trusted agentic-os workspace publication policy.',
    '# Default local-only; forced additions are independently rejected by workspace check.', '/*'];
  const parents = new Set();
  for (const path of [...policy.files].sort()) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) {
      const parent = parts.slice(0, index).join('/');
      if (!parents.has(parent)) { lines.push(`!/${parent}/`, `/${parent}/*`); parents.add(parent); }
    }
    lines.push(`!/${path}`);
  }
  for (const role of ['memory', 'todo']) {
    const path = config.sources[role].path; lines.push(`!/${path}/`, `!/${path}/**`);
  }
  lines.push('# Device/runtime files remain local even inside shared trees.',
    ...LOCAL.map(path => `**/${path}${path === '.DS_Store' ? '' : '/'}`), '**/.env', '**/.env.*');
  return `${lines.join('\n')}\n`;
}
export function checkPublication(root, revision, config) {
  const policy = validatePublication(config); if (!policy) return null;
  let listing;
  try { listing = observeGit(['ls-tree', '-r', '-l', '-z', revision], { cwd: root, maxBuffer: 131072 }); }
  catch { fail('tree-budget'); }
  const records = listing.split('\0').filter(Boolean);
  if (records.length > PUBLICATION_LIMITS.files) fail('file-count');
  let bytes = 0;
  const paths = new Set();
  for (const record of records) {
    const match = record.match(/^(100644|100755) blob ([a-f0-9]{40,64}) +([0-9]+)\t(.+)$/u);
    if (!match) fail('regular-file');
    const path = match[4], size = Number(match[3]);
    if (!sharedWorkspacePath(config, path)) fail(`local-only:${path}`);
    if (!Number.isSafeInteger(size) || size > PUBLICATION_LIMITS.fileBytes) fail('file-bytes');
    bytes += size; paths.add(path);
    if (bytes > PUBLICATION_LIMITS.totalBytes) fail('total-bytes');
  }
  if (policy.files.some(path => !paths.has(path))) fail('missing-essential-file');
  const ignored = observeGit(['show', `${revision}:.gitignore`], {cwd: root, maxBuffer: 8192, raw: true});
  if (ignored !== workspaceIgnore(config)) fail('ignore-drift');
  return { mode: 'essential', files: records.length, bytes, limits: PUBLICATION_LIMITS,
    artifactBodies: 'local-only', historicalObjects: 'retained', localPreservation: 'operator-receipt-required' };
}
