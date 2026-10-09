/** Portable, immutable source-evidence artifact identifiers. */
export const SOURCE_EVIDENCE_CATALOG_SCHEMA = 'agentic-os/source-evidence-catalog/v1';
export const SOURCE_EVIDENCE_MANIFEST_SCHEMA = 'agentic-os/source-evidence-manifest/v1';
export const SOURCE_EVIDENCE_LIMITS = Object.freeze({
  catalogBytes: 256 * 1024, manifestBytes: 1024 * 1024, files: 512, fileBytes: 128 * 1024,
  factsPerFile: 16, importsPerFile: 16,
});

export const isSourceEvidenceId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value);
export const isSourceEvidenceSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export const isSourceEvidencePath = value => typeof value === 'string' && value.length <= 512 && !value.includes('\\')
  && !value.split('/').some(part => !part || part === '.' || part === '..') && !/[\x00-\x1f\x7f]/u.test(value);
export const isSourceEvidenceObjectKey = value => isSourceEvidencePath(value) && !value.startsWith('/');
