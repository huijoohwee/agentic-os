/** Clone-owned Git configuration and managed-hook selection. */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  acquireOperationLock, commonDir, finishOperationLock, git, repoRoot, worktrees,
} from '../src/git.mjs';
import {
  assertHookRuntime,
  assertLegacyHookDirectory,
  assertPriorManagedRuntime,
  describeHookRuntime,
  isRelocatedManagedRuntime,
  installHookRuntime,
} from './agentic-os-hook-runtime.mjs';

export const REQUIRED_CONFIG = Object.freeze([{
  key: 'core.hooksPath', value: 'managed hook runtime',
  why: 'the profile-derived canonical-branch guard must be active in every worktree',
}]);

function localValues(key, cwd) {
  const output = git(['config', '--local', '--null', '--get-all', key], {
    cwd, allowFail: true, raw: true,
  });
  if (output === null) return [];
  if (!output.endsWith('\0')) throw new Error('Git config returned a non-delimited value');
  return output.slice(0, -1).split('\0');
}
function effectiveSetting(key, cwd) {
  const output = git(
    ['config', '--null', '--show-origin', '--show-scope', '--get', key],
    { cwd, allowFail: true, raw: true, preserveGlobalConfig: true },
  );
  if (output === null) return null;
  if (!output.endsWith('\0')) throw new Error('Git config returned a non-delimited value');
  const [scope, origin, ...value] = output.slice(0, -1).split('\0');
  if (!scope || !origin || value.length !== 1)
    throw new Error('Git config returned an ambiguous scoped value');
  return { scope, origin, value: value[0] };
}
function worktreeSettings(key, root) {
  return worktrees(root).map(({ path }) => {
    try {
      const setting = effectiveSetting(key, path);
      return { path, scope: setting?.scope ?? null, origin: setting?.origin ?? null,
        value: setting?.value ?? null };
    } catch (error) {
      return { path, error: error.message };
    }
  });
}

/** Exact local and effective values across every registered worktree. */
export function inspect(cwd = process.cwd(), { hooksPath = 'managed hook runtime' } = {}) {
  const root = repoRoot(cwd);
  return REQUIRED_CONFIG.map((entry) => {
    const expected = entry.key === 'core.hooksPath' ? { ...entry, value: hooksPath } : entry;
    const found = localValues(entry.key, root);
    const settings = worktreeSettings(entry.key, root);
    const mismatches = settings.filter((setting) => setting.error || setting.value !== expected.value);
    const actual = found.length > 1 ? JSON.stringify(found)
      : mismatches.length > 0 ? `${found[0] ?? 'unset'}; ${mismatches.length} worktree mismatch(es)`
        : found[0] ?? null;
    return {
      ...expected, actual, localValues: found, worktreeSettings: settings,
      ok: found.length === 1 && found[0] === expected.value && mismatches.length === 0,
    };
  });
}

function defaultHooksDirectory(cwd) {
  return join(commonDir(cwd), 'hooks');
}
function activeHooksAt(hooks) {
  try { return readdirSync(hooks).filter((name) => !name.endsWith('.sample')).sort(); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
function race(message) {
  return Object.assign(new Error(message), { reason: 'blocked-config-race' });
}
function restorePrior(key, installed, prior, cwd) {
  const found = localValues(key, cwd);
  if (prior === null ? found.length === 0 : found.length === 1 && found[0] === prior) return true;
  if (found.length !== 1 || found[0] !== installed) return false;
  if (prior === null)
    git(['config', '--local', '--fixed-value', '--unset-all', key, installed], { cwd });
  else git(['config', '--local', '--fixed-value', '--replace-all', key, prior, installed], { cwd });
  const restored = localValues(key, cwd);
  return prior === null ? restored.length === 0 : restored.length === 1 && restored[0] === prior;
}
function observeConfig(key, installed, prior, cwd) {
  try {
    const values = localValues(key, cwd);
    const state = prior === null ? values.length === 0 ? 'prior' : values.length === 1
      && values[0] === installed ? 'installed' : 'other'
      : values.length === 1 && values[0] === prior ? 'prior' : values.length === 1
        && values[0] === installed ? 'installed' : 'other';
    return { state, count: values.length,
      digest: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
  } catch { return { state: 'unavailable', count: null, digest: null }; }
}

function assertMigratablePrior(prior, root, runtime, legacyHooksPaths, selfLegacyRoot) {
  if (prior === runtime.hooksPath) return;
  if (isAbsolute(prior) && assertPriorManagedRuntime(prior, runtime)) return;
  if (isAbsolute(prior) && isRelocatedManagedRuntime(prior, runtime)) return;
  const legacyMatch = legacyHooksPaths.some((candidate) => {
    if (candidate === prior) return true;
    if (!isAbsolute(candidate) || !isAbsolute(prior)) return false;
    try { return realpathSync(candidate) === realpathSync(prior); } catch { return false; }
  });
  if (legacyMatch) {
    const paths = isAbsolute(prior) ? [prior]
      : worktrees(root).map(({ path }) => resolve(path, prior));
    try {
      paths.forEach((path) => assertLegacyHookDirectory(path, runtime, {
        allowPinnedHistory: Boolean(selfLegacyRoot && !isAbsolute(prior)),
      }));
    } catch (error) {
      error.reason = 'blocked-existing-hooks-path';
      throw error;
    }
    return;
  }
  throw Object.assign(new Error(`existing core.hooksPath ${JSON.stringify(prior)} must be integrated explicitly; expected ${JSON.stringify(runtime.hooksPath)}`),
    { reason: 'blocked-existing-hooks-path' });
}

/** Install and select one immutable hook runtime without clobbering consumer hooks. */
export function ensure(cwd = process.cwd(), {
  sourceRoot, legacyHooksPaths = [], selfLegacyRoot = null,
  beforeConfigure = null, afterConfigure = null, finalize = null,
  runtimeInstallOptions = null,
}) {
  const root = repoRoot(cwd);
  const lock = acquireOperationLock('agentic-os-configure', root);
  if (!lock)
    throw Object.assign(new Error('another setup owns the clone-wide configuration lock'),
      { reason: 'blocked-concurrent-configure' });
  let result;
  let operationError = null;
  const artifacts = { effectsRetained: false, runtimeId: null, runtimePath: null,
    hooksPath: null, runtimeInstalled: false, runtimeResidue: false,
    runtimeAncestorResidue: false, runtimeAncestorPaths: [], configRetained: false,
    configWriteAttempted: false, configWriteResultUnknown: false,
    configObservedState: null, configObservedCount: null, configObservedDigest: null,
    trustPath: null, trustCreated: false, statePath: null,
    trustWriteAttempted: false, trustWriteResultUnknown: false,
    trustWriteObservedPathExists: false, trustWriteObservedKind: null,
    trustWriteObservedSize: null,
    stateDirectoryCreated: false, stateDirectoryTightenAttempted: false,
    stateDirectoryTightenResultUnknown: false, stateDirectoryTightened: false };
  try {
    const runtime = describeHookRuntime(root, { sourceRoot });
    Object.assign(artifacts, {
      runtimeId: runtime.runtimeId, runtimePath: runtime.path, hooksPath: runtime.hooksPath,
    });
    const completed = ensureLocked(root, runtime, legacyHooksPaths, selfLegacyRoot, {
      beforeConfigure, afterConfigure, artifacts, runtimeInstallOptions,
    });
    if (typeof finalize === 'function') finalize(completed, artifacts);
    result = completed;
  } catch (error) {
    operationError = error;
  }
  try {
    return finishOperationLock(lock, {
      label: 'config', result, error: operationError, artifacts,
    });
  } catch (error) {
    if (artifacts.effectsRetained && !error.operationArtifacts) Object.assign(error, {
      retainedOperation: true, operationResult: result,
      operationError: Object.freeze({ reason: error.reason ?? null, message: error.message }),
      operationArtifacts: Object.freeze({ ...artifacts,
        runtimeAncestorPaths: Object.freeze([...artifacts.runtimeAncestorPaths]) }),
    });
    throw error;
  }
}
function ensureLocked(root, runtime, legacyHooksPaths, selfLegacyRoot, {
  beforeConfigure, afterConfigure, artifacts, runtimeInstallOptions,
}) {
  const before = inspect(root, { hooksPath: runtime.hooksPath })[0];
  if (before.localValues.length > 1)
    throw Object.assign(new Error('multiple local core.hooksPath values require explicit integration'),
      { reason: 'blocked-existing-hooks-path' });
  const prior = before.localValues[0] ?? null;
  if (prior !== null)
    assertMigratablePrior(prior, root, runtime, legacyHooksPaths, selfLegacyRoot);
  const effectiveMismatch = before.worktreeSettings.filter(
    (setting) => setting.error || setting.value !== prior,
  );
  if (effectiveMismatch.length > 0)
    throw Object.assign(new Error(`effective core.hooksPath differs in ${effectiveMismatch.length} registered worktree(s)`),
      { reason: 'blocked-existing-hooks-path' });
  const defaultDirectory = defaultHooksDirectory(root);
  if (prior === null) {
    const active = activeHooksAt(defaultDirectory);
    if (active.length > 0)
      throw Object.assign(new Error(`active default hooks must be integrated explicitly: ${active.join(', ')}`),
        { reason: 'blocked-existing-default-hooks' });
  }
  const prepared = typeof beforeConfigure === 'function' ? beforeConfigure(artifacts) : null;
  const runtimeBefore = lstatSync(runtime.path, { throwIfNoEntry: false });
  let installed;
  const recordRuntimeEffect = (effect) => {
    if (effect.kind !== 'directory-created') return;
    if (effect.path === runtime.path) artifacts.runtimeResidue = true;
    else {
      artifacts.runtimeAncestorResidue = true;
      artifacts.runtimeAncestorPaths.push(effect.path);
    }
    artifacts.effectsRetained = true;
  };
  try {
    installed = installHookRuntime(runtime, {
      ...(runtimeInstallOptions ?? {}), onEffect: recordRuntimeEffect,
    });
  } catch (error) {
    artifacts.runtimeResidue = !runtimeBefore
      && Boolean(lstatSync(runtime.path, { throwIfNoEntry: false })) || artifacts.runtimeResidue;
    artifacts.effectsRetained ||= artifacts.runtimeResidue || artifacts.runtimeAncestorResidue;
    throw error;
  }
  artifacts.runtimeInstalled = installed;
  if (installed) artifacts.runtimeResidue = false;
  artifacts.effectsRetained ||= installed;
  const configWriteRequired = prior !== runtime.hooksPath;
  try {
    artifacts.configWriteAttempted = configWriteRequired;
    artifacts.configWriteResultUnknown = configWriteRequired;
    if (prior === null)
      git(['config', '--local', '--add', 'core.hooksPath', runtime.hooksPath], { cwd: root });
    else if (prior !== runtime.hooksPath)
      git(['config', '--local', '--fixed-value', '--replace-all',
        'core.hooksPath', runtime.hooksPath, prior], { cwd: root });
    artifacts.configWriteResultUnknown = false;
    artifacts.configRetained = configWriteRequired;
    artifacts.effectsRetained ||= artifacts.configRetained;
    if (!inspect(root, { hooksPath: runtime.hooksPath })[0].ok)
      throw race('core.hooksPath changed during guarded configuration');
    if (prior === null && activeHooksAt(defaultDirectory).length > 0)
      throw race('a default hook appeared during guarded configuration');
    if (prior !== null && prior !== runtime.hooksPath)
      assertMigratablePrior(prior, root, runtime, legacyHooksPaths, selfLegacyRoot);
    assertHookRuntime(runtime);
    if (typeof afterConfigure === 'function') afterConfigure();
  } catch (error) {
    let restoreError = null;
    try { restorePrior('core.hooksPath', runtime.hooksPath, prior, root); }
    catch (caught) { restoreError = caught; }
    const observed = observeConfig('core.hooksPath', runtime.hooksPath, prior, root);
    artifacts.configObservedState = observed.state;
    artifacts.configObservedCount = observed.count;
    artifacts.configObservedDigest = observed.digest;
    const restored = observed.state === 'prior';
    artifacts.configRetained = configWriteRequired && !restored;
    artifacts.configWriteResultUnknown = configWriteRequired
      && observed.state !== 'prior' && observed.state !== 'installed';
    artifacts.effectsRetained ||= installed || artifacts.configRetained
      || artifacts.configWriteResultUnknown;
    if (!restored)
      throw race(`${error.message}; captured prior value could not be restored${restoreError
        ? ` (${restoreError.message})` : ''}; `
        + `safe runtime residue retained at ${runtime.path}`);
    if (installed) {
      const retained = new Error(
        `${error.message}; exact runtime residue retained at ${runtime.path}`,
        { cause: error },
      );
      retained.reason = error.reason ?? 'blocked-config-race';
      throw retained;
    }
    throw error;
  }
  const changes = [];
  if (installed) changes.push({ key: 'hook.runtime', from: null, to: runtime.path });
  if (prior !== runtime.hooksPath)
    changes.push({ key: 'core.hooksPath', from: prior, to: runtime.hooksPath });
  return { changes, runtime, prepared };
}
