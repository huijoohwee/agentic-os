import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { readBoundedFile } from '../src/catalog-input.mjs';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const CONSUMER_RELEASE_SCRIPTS = Object.freeze({
  doctor: 'agentic-os doctor',
  lane: 'agentic-os start',
  land: 'agentic-os land',
  successor: 'agentic-os successor',
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

function workflowJobNames(source) {
  const names = new Set();
  let inJobs = false, job = null;
  const finishJob = () => {
    if (job) names.add(job.name ?? job.id);
    job = null;
  };
  for (const line of source.split(/\r?\n/u)) {
    if (!inJobs) {
      if (/^jobs:\s*(?:#.*)?$/u.test(line)) inJobs = true;
      continue;
    }
    if (/^\S/u.test(line)) {
      finishJob();
      inJobs = false;
      continue;
    }
    const id = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/u.exec(line)?.[1];
    if (id) {
      finishJob();
      job = { id, name: null };
      continue;
    }
    const name = /^    name:\s*(.+?)\s*$/u.exec(line)?.[1];
    if (job && name) job.name = yamlScalar(name);
  }
  finishJob();
  return names;
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
  return { state: 'present', scripts: manifest.scripts, manifest };
}

function workflowCheckBindings(root) {
  const directory = resolve(root, '.github', 'workflows');
  const metadata = lstatSync(directory, { throwIfNoEntry: false });
  if (!metadata) return { state: 'missing-directory', jobNames: [], actionRevisions: [] };
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(directory) !== directory)
    return { state: 'invalid-directory', jobNames: [], actionRevisions: [] };
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length === 0) return { state: 'missing-workflows', jobNames: [], actionRevisions: [] };
  const jobNames = new Set(), actionRevisions = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    const file = lstatSync(path, { throwIfNoEntry: false });
    if (!file || !file.isFile() || file.isSymbolicLink() || realpathSync(path) !== path)
      return { state: 'invalid-workflow', jobNames: [...jobNames].sort(), actionRevisions };
    let source;
    try {
      source = UTF8.decode(readBoundedFile(path, 256 * 1024, 'workflow file', {
        expectedIdentity: { dev: file.dev, ino: file.ino }, expectedPath: path,
      }));
    } catch {
      return { state: 'invalid-workflow', jobNames: [...jobNames].sort(), actionRevisions };
    }
    for (const name of workflowJobNames(source)) jobNames.add(name);
    for (const match of source.matchAll(/^\s+-\s+uses:\s*huijoohwee\/agentic-os\/\.github\/actions\/owner-reuse@([a-f\d]{40})\s*(?:#.*)?$/gmu)) {
      actionRevisions.push(match[1]);
    }
  }
  return { state: 'present', jobNames: [...jobNames].sort(), actionRevisions };
}

export function consumerReleaseEnforcementFindings(root, profile, policy, { expectedAosRevision } = {}) {
  if (!profile?.repository?.startsWith('github.com/')
    || profile.repository === 'github.com/huijoohwee/agentic-os') return [];
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
  if (expectedAosRevision !== undefined) {
    const workflows = workflowCheckBindings(root);
    const actionPinned = /^[a-f\d]{40}$/u.test(expectedAosRevision)
      && workflows.state === 'present'
      && workflows.actionRevisions.length > 0
      && workflows.actionRevisions.every((revision) => revision === expectedAosRevision);
    findings.push({
      id: 'consumer-release-enforcement-action',
      ok: actionPinned,
      detail: actionPinned
        ? `shared release enforcement action is pinned to ${expectedAosRevision}`
        : workflows.actionRevisions.length === 0
          ? 'no SHA-pinned shared release enforcement action is bound in consumer workflows'
          : `shared release enforcement actions use ${[...new Set(workflows.actionRevisions)].join(', ')}`,
      remedy: actionPinned ? null
        : `pin every owner-reuse action to ${expectedAosRevision} in a required workflow`,
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
      remedy: 'add package.json scripts for doctor, lane, land, successor, release:common, and sync:canonical',
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
  if (expectedAosRevision !== undefined) {
    const spec = scripts.manifest?.devDependencies?.['agentic-os'] ?? null;
    const pin = typeof spec === 'string'
      ? spec.match(/^(?:https:\/\/codeload\.github\.com\/huijoohwee\/agentic-os\/tar\.gz\/|github:huijoohwee\/agentic-os#)([a-f\d]{40})$/u)?.[1]
      : null;
    const archive = pin ? `https://codeload.github.com/huijoohwee/agentic-os/tar.gz/${pin}` : null;
    let lock = null;
    const lockPath = resolve(root, 'package-lock.json'), lockFile = lstatSync(lockPath, { throwIfNoEntry: false });
    if (lockFile?.isFile() && !lockFile.isSymbolicLink() && realpathSync(lockPath) === lockPath) {
      try {
        lock = JSON.parse(UTF8.decode(readBoundedFile(lockPath, 2 * 1024 * 1024, 'package lock', {
          expectedIdentity: { dev: lockFile.dev, ino: lockFile.ino }, expectedPath: lockPath,
        })));
      } catch { lock = null; }
    }
    const lockedSpec = lock?.packages?.['']?.devDependencies?.['agentic-os'] ?? null;
    const resolved = lock?.packages?.['node_modules/agentic-os']?.resolved ?? null;
    const integrity = lock?.packages?.['node_modules/agentic-os']?.integrity ?? null;
    const resolvedPins = pin ? [archive,
      `git+ssh://git@github.com/huijoohwee/agentic-os.git#${pin}`,
      `git+https://github.com/huijoohwee/agentic-os.git#${pin}`] : [];
    const packagePinned = Boolean(pin && lockedSpec === spec && resolvedPins.includes(resolved)
      && /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity ?? ''));
    findings.push({
      id: 'consumer-os-package-pin',
      ok: packagePinned,
      detail: packagePinned
        ? `agentic-os package and lockfile are pinned to ${pin}`
        : 'agentic-os devDependency or package-lock.json lacks a matching full commit pin and integrity',
      remedy: packagePinned ? null
        : 'pin devDependency agentic-os and its package-lock entry to the same full Git commit with SHA-512 integrity',
    });
  }
  return findings;
}
