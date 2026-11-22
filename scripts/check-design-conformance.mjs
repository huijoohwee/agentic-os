// Read-only fleet design-token conformance gate. Reads committed Git blobs; never executes consumer code.
// Proves single-owner reuse, upstream owner-byte authenticity, unified-release alignment (or registered
// value-equivalent skew), central intent-palette derivation, and indirect-consumer boundaries.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ownerId = 'github.com/huijoohwee/agentic-design-system';
const oid = /^[0-9a-f]{40}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (condition, label) => { if (!condition) throw new Error(label); };
const repoName = repository => repository.split('/').pop();

function exactKeys(value, keys, label) {
  need(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(','), `${label} fields`);
}

// CI-safe self-check: runs without sibling checkouts.
export function validateMatrix(matrix) {
  exactKeys(matrix, ['schema', 'owner', 'designSystemOwner', 'alignment', 'consumers'], 'matrix root');
  need(matrix.schema === 'agentic-os/design-consumer-matrix/v1', 'matrix schema');
  need(matrix.owner === 'github.com/huijoohwee/agentic-os', 'matrix owner');
  need(matrix.designSystemOwner === ownerId, 'matrix design-system owner');
  const alignment = matrix.alignment;
  exactKeys(alignment, ['policy', 'targetRevision', 'sharedUiSourceSha256', 'sharedUiProjectionSha256', 'convergence', 'note'], 'alignment');
  need(alignment.policy === 'unified-release-with-bounded-value-equivalent-skew', 'alignment policy');
  need(oid.test(alignment.targetRevision), 'alignment target revision');
  for (const key of ['sharedUiSourceSha256', 'sharedUiProjectionSha256'])
    need(/^sha256:[0-9a-f]{64}$/u.test(alignment[key]), `alignment ${key}`);
  need(alignment.convergence === 'next-design-system-release', 'alignment convergence bound');
  need(Array.isArray(matrix.consumers) && matrix.consumers.length > 0, 'matrix consumers');
  const seen = new Set();
  for (const consumer of matrix.consumers) {
    need(!seen.has(consumer.repository), `duplicate consumer ${consumer.repository}`);
    seen.add(consumer.repository);
    need(consumer.repository.startsWith('github.com/huijoohwee/'), `consumer owner ${consumer.repository}`);
    if (consumer.kind === 'indirect') {
      exactKeys(consumer, ['repository', 'kind', 'via', 'consumptionPath', 'consumptionMarker', 'legacyStylesheet', 'ownedStylesheets'], `indirect ${consumer.repository}`);
      need(consumer.via.startsWith('github.com/huijoohwee/'), 'indirect via owner');
      const legacy = consumer.legacyStylesheet;
      exactKeys(legacy, ['path', 'active', 'reachabilityEvidence'], 'legacy stylesheet');
      need(legacy.active === false && typeof legacy.reachabilityEvidence === 'string' && legacy.reachabilityEvidence.trim(), 'legacy stylesheet must be inactive with reachability evidence');
    } else {
      exactKeys(consumer, ['repository', 'kind', 'pinPath', 'registryRevision', 'alignment', 'sharedUiProjectionPath', 'ownedStylesheets', ...(consumer.intentPalette ? ['intentPalette'] : [])], `consumer ${consumer.repository}`);
      need(['installed-package', 'vendored-pin', 'exact-snapshot'].includes(consumer.kind), `consumer kind ${consumer.kind}`);
      need(oid.test(consumer.registryRevision), `consumer registry revision ${consumer.repository}`);
      need(consumer.alignment === 'value-equivalent-skew' || consumer.alignment === 'aligned', `consumer alignment ${consumer.repository}`);
      need(consumer.sharedUiProjectionPath === 'site/vendor/shared-ui-profile.css', `consumer projection path ${consumer.repository}`);
      need(Array.isArray(consumer.ownedStylesheets), `consumer owned stylesheets ${consumer.repository}`);
      if (consumer.intentPalette) {
        exactKeys(consumer.intentPalette, ['ownerPath', 'projectionPath', 'pinPath', 'derivationPath', 'forbiddenLiteral'], 'intent palette');
        need(consumer.intentPalette.ownerPath === 'site/ui-intent-palette.json', 'intent palette owner path');
      }
    }
  }
  return matrix;
}

function snapshot(path) {
  const git = (...args) => execFileSync('git', ['-C', path, ...args], { maxBuffer: 500000 });
  const head = git('rev-parse', '--verify', 'HEAD^{commit}').toString().trim();
  const blob = (file, revision = head) => {
    need(oid.test(revision), `Invalid revision for ${file}`);
    return git('show', `${revision}:${file}`);
  };
  return { head, blob, text: file => blob(file).toString(), json: file => JSON.parse(blob(file)) };
}

// Verify a pin's declared digests against authentic owner bytes at the pinned revisions.
export function checkOwnerAuthenticity(owner, { sourceRevision, sourceSha256, sourcePath, registryRevision, projectionSha256, projectionPath }, label) {
  need(/^sha256:[0-9a-f]{64}$/u.test(sourceSha256) && /^sha256:[0-9a-f]{64}$/u.test(projectionSha256), `${label} digest format`);
  const source = owner.blob(sourcePath, sourceRevision);
  need(`sha256:${digest(source)}` === sourceSha256, `${label} source differs from pinned owner bytes`);
  const projection = owner.blob(projectionPath, registryRevision);
  need(`sha256:${digest(projection)}` === projectionSha256, `${label} projection differs from pinned owner bytes`);
  return projection;
}

export function checkValueEquivalence(projectionDigest, targetProjectionSha256, label) {
  need(projectionDigest === targetProjectionSha256, `${label} delivered shared-ui values drift from the alignment target`);
}

// Central intent palette must be derived from pinned owner bytes, never re-authored locally.
export function checkPaletteDerivation(owner, consumer, palette, targetRevision, label) {
  const pin = consumer.json(palette.pinPath);
  need(pin.owner === ownerId, `${label} palette owner`);
  need(pin.sourceRevision === targetRevision, `${label} palette must pin the alignment target revision`);
  const ownerBytes = owner.blob(palette.ownerPath, pin.sourceRevision);
  need(`sha256:${digest(ownerBytes)}` === pin.sourceSha256, `${label} palette pin drift`);
  const projection = consumer.blob(palette.projectionPath);
  need(projection.equals(ownerBytes), `${label} vendored palette differs from owner bytes`);
  const derivation = consumer.text(palette.derivationPath);
  need(!derivation.includes(palette.forbiddenLiteral), `${label} re-authors central intent values locally`);
  need(/ui-intent-palette/u.test(derivation), `${label} must derive from the central palette projection`);
}

export function checkIndirectConsumption(consumer, entry, label) {
  need(consumer.text(entry.consumptionPath).includes(entry.consumptionMarker), `${label} must consume verified Graph output`);
  const legacy = entry.legacyStylesheet;
  const files = execFileSync('git', ['-C', consumer.path, 'ls-tree', '-r', '--name-only', consumer.head, 'web/'], { maxBuffer: 500000 })
    .toString().split('\n').filter(file => /\.(html|mjs|js)$/u.test(file));
  for (const file of files) {
    need(!consumer.text(file).includes(legacy.path.split('/').pop()), `${label} legacy stylesheet ${legacy.path} is reachable from ${file}`);
  }
}

export function checkNoCentralOverrides(consumer, files, centralVars, label) {
  const pattern = /(--[a-z][a-z0-9-]*)\s*:/gu;
  for (const file of files) {
    const text = consumer.text(file);
    for (const match of text.matchAll(pattern)) {
      need(!centralVars.has(match[1]), `${label} redeclares centrally owned ${match[1]} in ${file}`);
    }
  }
}

export function checkDesignConformance(workspace, overrides = {}) {
  const os = snapshot(overrides['agentic-os'] ?? join(workspace, 'agentic-os'));
  const matrix = validateMatrix(os.json('catalog/design-consumer-matrix.json'));
  const owner = snapshot(overrides['agentic-design-system'] ?? join(workspace, 'agentic-design-system'));
  const target = matrix.alignment;
  // The target release must itself carry the declared shared-ui source and projection bytes.
  need(`sha256:${digest(owner.blob('site/tokens/shared-ui-profile.json', target.targetRevision))}` === target.sharedUiSourceSha256, 'target shared-ui source drift');
  const targetProjection = owner.blob('site/vendor/shared-ui-profile.css', target.targetRevision);
  need(`sha256:${digest(targetProjection)}` === target.sharedUiProjectionSha256, 'target shared-ui projection drift');
  const centralVars = new Set(JSON.parse(owner.blob('site/tokens/shared-ui-profile.json', target.targetRevision).toString()).tokens.map(token => token.cssVar));
  const repos = {};
  const revisions = { 'agentic-os': os.head, 'agentic-design-system': owner.head };
  const checked = [];
  for (const entry of matrix.consumers) {
    const name = repoName(entry.repository);
    const consumer = repos[name] ??= snapshot(overrides[name] ?? join(workspace, name));
    consumer.path = overrides[name] ?? join(workspace, name);
    revisions[name] = consumer.head;
    const label = name;
    if (entry.kind === 'indirect') {
      checkIndirectConsumption(consumer, entry, label);
      checked.push({ consumer: name, kind: entry.kind });
      continue;
    }
    let projectionDigest;
    if (entry.kind === 'installed-package') {
      const spec = consumer.json(entry.pinPath).devDependencies['agentic-design-system'];
      const revision = spec.split('#')[1];
      need(spec === `github:huijoohwee/agentic-design-system#${entry.registryRevision}` && oid.test(revision), `${label} installed package pin drift`);
      projectionDigest = `sha256:${digest(owner.blob(entry.sharedUiProjectionPath, revision))}`;
    } else if (entry.kind === 'exact-snapshot') {
      const source = consumer.text(entry.pinPath);
      const match = /repo: 'agentic-design-system', prefix: 'design', revision: '([0-9a-f]{40})'/u.exec(source);
      need(match && match[1] === entry.registryRevision, `${label} exact-snapshot Design System pin drift`);
      projectionDigest = `sha256:${digest(owner.blob(entry.sharedUiProjectionPath, match[1]))}`;
    } else {
      const pin = consumer.json(entry.pinPath);
      need(pin.profile.owner === ownerId, `${label} pin owner`);
      need(pin.profile.registryRevision === entry.registryRevision, `${label} registry revision drift`);
      const projection = checkOwnerAuthenticity(owner, {
        sourceRevision: pin.profile.sourceRevision, sourceSha256: pin.profile.sourceSha256, sourcePath: pin.profile.sourcePath,
        registryRevision: pin.profile.registryRevision, projectionSha256: pin.profile.projectionSha256, projectionPath: pin.profile.projectionPath,
      }, label);
      projectionDigest = `sha256:${digest(projection)}`;
    }
    if (entry.alignment === 'aligned') {
      // A consumer may pin the exact target revision or the catalog-release sub-revision within it
      // (Commerce derives registryRevision from the last catalog.json change); both reference the
      // same registry release when their catalog.json bytes equal the target's.
      const sameRelease = entry.registryRevision === target.targetRevision
        || owner.blob('site/catalog.json', entry.registryRevision).equals(owner.blob('site/catalog.json', target.targetRevision));
      need(sameRelease, `${label} declared aligned but not on the target registry release`);
    }
    checkValueEquivalence(projectionDigest, target.sharedUiProjectionSha256, label);
    if (entry.intentPalette) checkPaletteDerivation(owner, consumer, entry.intentPalette, target.targetRevision, label);
    checkNoCentralOverrides(consumer, entry.ownedStylesheets, centralVars, label);
    checked.push({ consumer: name, kind: entry.kind, alignment: entry.alignment });
  }
  return { scope: 'committed design-token conformance', revisions, consumers: checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [workspace, ...args] = process.argv.slice(2);
  if (!workspace) { need(false, 'Usage: node scripts/check-design-conformance.mjs WORKSPACE [repo=checkout ...]'); }
  if (workspace === '--self-check') {
    const os = snapshot(resolve('.'));
    validateMatrix(os.json('catalog/design-consumer-matrix.json'));
    console.log('PASS design-consumer-matrix-self-check · matrix schema, alignment policy and consumer inventory are well-formed.');
  } else {
    const overrides = {};
    for (const arg of args) {
      const key = arg.slice(0, arg.indexOf('=')), path = arg.slice(arg.indexOf('=') + 1);
      need(path && !Object.hasOwn(overrides, key), `Invalid checkout binding: ${key}`);
      overrides[key] = resolve(path);
    }
    console.log(JSON.stringify(checkDesignConformance(resolve(workspace), overrides), null, 2));
  }
}