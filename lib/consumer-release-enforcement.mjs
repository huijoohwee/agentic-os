import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { readBoundedFile } from '../src/catalog-input.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const CONSUMER_RELEASE_SCRIPTS = Object.freeze({
  doctor: 'agentic-os doctor',
  lane: 'agentic-os start',
  land: 'agentic-os land',
  'release:common': 'agentic-os release-common',
  'sync:canonical': 'agentic-os canonical-sync',
});

export function providerKind(profile) {
  const selected = profile?.adapters.provider;
  if (selected === null || selected === undefined) return 'none';
  return selected.id === 'github' && selected.version === '1' ? 'github' : 'unsupported';
}

function yamlScalar(raw) {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed.replace(/\s+#.*$/u, '').trim();
}

function packageScriptMap(root) {
  const path = resolve(root, 'package.json');
  const metadata = lstatSync(path, { throwIfNoEntry: false });
  if (!metadata) return { state: 'missing', scripts: null };
  if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(path) !== path)
    return { state: 'invalid-file', scripts: null };
  let manifest;
  try {
    manifest = JSON.parse(UTF8.decode(readBoundedFile(path, 256 * 1024, 'package manifest', {
      expectedIdentity: { dev: metadata.dev, ino: metadata.ino }, expectedPath: path,
    })));
  } catch {
    return { state: 'invalid-json', scripts: null };
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    return { state: 'invalid-json', scripts: null };
  if (!manifest.scripts || typeof manifest.scripts !== 'object' || Array.isArray(manifest.scripts))
    return { state: 'missing-scripts', scripts: null };
  return { state: 'present', scripts: manifest.scripts };
}

function workflowCheckBindings(root) {
  const directory = resolve(root, '.github', 'workflows');
  const metadata = lstatSync(directory, { throwIfNoEntry: false });
  if (!metadata) return { state: 'missing-directory', jobNames: [] };
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(directory) !== directory)
    return { state: 'invalid-directory', jobNames: [] };
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) return { state: 'missing-workflows', jobNames: [] };
  const jobNames = new Set();
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const file = lstatSync(path, { throwIfNoEntry: false });
    if (!file || !file.isFile() || file.isSymbolicLink() || realpathSync(path) !== path)
      return { state: 'invalid-workflow', jobNames: [...jobNames].sort() };
    let source;
    try {
      source = UTF8.decode(readBoundedFile(path, 256 * 1024, 'workflow file', {
        expectedIdentity: { dev: file.dev, ino: file.ino }, expectedPath: path,
      }));
    } catch {
      return { state: 'invalid-workflow', jobNames: [...jobNames].sort() };
    }
    for (const match of source.matchAll(/^ {4}name:\s*(.+?)\s*$/gmu)) {
      jobNames.add(yamlScalar(match[1]));
    }
  }
  return { state: 'present', jobNames: [...jobNames].sort() };
}

export function consumerReleaseEnforcementFindings(root, profile, policy) {
  if (!profile?.repository?.startsWith('github.com/')) return [];
  const findings = [];
  const kind = providerKind(profile);
  findings.push({
    id: 'consumer-provider-adapter',
    ok: kind === 'github',
    detail: kind === 'github'
      ? 'GitHub consumer profile binds a supported provider adapter'
      : kind === 'none'
        ? 'GitHub consumer profile omits its provider adapter'
        : 'GitHub consumer profile selects an unsupported provider adapter',
    remedy: kind === 'github' ? null : 'set adapters.provider to github/1 in the committed repository profile',
  });
  findings.push({
    id: 'consumer-protected-integration',
    ok: policy.pullRequestRequired === true,
    detail: policy.pullRequestRequired === true
      ? 'protected pull-request integration is selected'
      : 'protected pull-request integration is not selected',
    remedy: policy.pullRequestRequired === true ? null
      : 'add protected-integration:pull-request to the committed profile capabilities',
  });
  findings.push({
    id: 'consumer-required-checks',
    ok: profile.requiredChecks.length > 0,
    detail: profile.requiredChecks.length > 0
      ? `required checks declared: ${profile.requiredChecks.join(', ')}`
      : 'no required checks are declared for this GitHub consumer profile',
    remedy: profile.requiredChecks.length > 0 ? null
      : 'declare at least one required check and bind it to a repository workflow job',
  });
  if (profile.requiredChecks.length > 0) {
    const workflows = workflowCheckBindings(root);
    const missingChecks = profile.requiredChecks.filter((check) => !workflows.jobNames.includes(check));
    findings.push({
      id: 'consumer-required-check-bindings',
      ok: workflows.state === 'present' && missingChecks.length === 0,
      detail: workflows.state !== 'present'
        ? workflows.state === 'missing-directory'
          ? '.github/workflows is missing'
          : workflows.state === 'missing-workflows'
            ? 'no workflow files declare required check jobs'
            : 'workflow files are unavailable or invalid'
        : missingChecks.length === 0
          ? `workflow jobs cover required checks: ${profile.requiredChecks.join(', ')}`
          : `workflow jobs do not declare: ${missingChecks.join(', ')}`,
      remedy: workflows.state === 'present' && missingChecks.length === 0 ? null
        : 'create repository workflow jobs whose exact job names match every declared required check',
    });
  }
  const removeClean = profile.cleanup?.worktreeProjection === 'remove-clean'
    && profile.cleanup?.worktreeRegistration === 'remove-clean';
  findings.push({
    id: 'consumer-cleanup-policy',
    ok: removeClean,
    detail: removeClean
      ? 'clean worktrees are removed on closeout'
      : 'clean worktrees are retained instead of being removed on closeout',
    remedy: removeClean ? null
      : 'set cleanup.worktreeProjection and cleanup.worktreeRegistration to remove-clean',
  });
  const scripts = packageScriptMap(root);
  if (scripts.state !== 'present') {
    findings.push({
      id: 'consumer-release-scripts',
      ok: false,
      detail: scripts.state === 'missing'
        ? 'package.json is missing'
        : scripts.state === 'missing-scripts'
          ? 'package.json has no scripts section'
          : 'package.json is unavailable or invalid',
      remedy: 'add package.json scripts for doctor, lane, land, release:common, and sync:canonical',
    });
    return findings;
  }
  for (const [name, expected] of Object.entries(CONSUMER_RELEASE_SCRIPTS)) {
    const actual = scripts.scripts[name] ?? null;
    findings.push({
      id: `consumer-script-${name}`,
      ok: actual === expected,
      detail: actual === expected
        ? `${name} maps to ${expected}`
        : actual === null
          ? `${name} is missing`
          : `${name} maps to ${actual}`,
      remedy: actual === expected ? null : `set ${name} to ${expected} in package.json`,
    });
  }
  return findings;
}
