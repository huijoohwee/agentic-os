/** Canonical package discovery plus clone-common hook setup/doctor plumbing. */
import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as config from './agentic-os-config.mjs';
import {
  commonDir, currentBranch, headSha, worktreeCleanupRisks, worktrees,
} from '../src/git.mjs';
import {
  assertPrivateDirectoryIdentity, privateDirectoryIdentity,
} from '../src/file-integrity.mjs';
import {
  describeHookRuntime, hasHookRuntimeState, inspectHookRuntime,
} from './agentic-os-hook-runtime.mjs';
import { ensureRepositoryTrust, loadRepositoryTrust } from '../src/git-repository.mjs';
import * as report from './agentic-os-report.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));

function packageInstallation(root) {
  const packageRoot = realpathSync(PACKAGE_ROOT);
  const invocationRoot = realpathSync(root);
  const primary = worktrees(root)[0]?.path;
  if (!primary) throw new TypeError('primary canonical worktree identity is unavailable');
  const primaryRoot = realpathSync(primary);
  if (packageRoot === invocationRoot) {
    return {
      sourceRoot: primaryRoot,
      legacyHooksPaths: ['.githooks', join(primaryRoot, '.githooks')],
      selfLegacyRoot: primaryRoot, selfSource: true, invocationRoot, primaryRoot,
    };
  }
  const packageRelative = relative(invocationRoot, packageRoot);
  const nested = packageRelative !== '..' && !packageRelative.startsWith(`..${sep}`)
    && !isAbsolute(packageRelative);
  if (!nested) {
    const error = new Error('setup requires a repository-local pinned package installation');
    error.reason = 'blocked-repository-local-package-required';
    throw error;
  }
  let sourceRoot;
  try { sourceRoot = realpathSync(join(primaryRoot, packageRelative)); } catch {
    const error = new Error('the canonical worktree does not contain the invoked package installation');
    error.reason = 'blocked-canonical-package-missing';
    throw error;
  }
  return {
    sourceRoot, legacyHooksPaths: [join(sourceRoot, '.githooks'), '.githooks',
      join(primaryRoot, '.githooks')],
    selfLegacyRoot: primaryRoot, selfSource: false, invocationRoot, primaryRoot,
  };
}

function assertCanonicalSetup(installation, policy) {
  if (installation.invocationRoot !== installation.primaryRoot) {
    const error = new Error('setup must execute from the primary canonical worktree');
    error.reason = 'blocked-canonical-setup-required';
    throw error;
  }
  const branch = currentBranch(installation.primaryRoot);
  if (branch !== policy.protectedBranch) {
    const error = new Error(`primary worktree is on ${branch ?? 'detached HEAD'}; `
      + `expected canonical branch ${policy.protectedBranch}`);
    error.reason = 'blocked-canonical-branch-required';
    throw error;
  }
  if (installation.selfSource) {
    const primaryHead = headSha('HEAD', installation.primaryRoot);
    const protectedHead = headSha(policy.protectedRef, installation.primaryRoot);
    if (protectedHead === null || primaryHead !== protectedHead) {
      const error = new Error(`primary HEAD ${primaryHead ?? 'unavailable'} must equal cached `
        + `${policy.protectedRef} ${protectedHead ?? 'unavailable'}`);
      error.reason = 'blocked-canonical-source-untrusted';
      throw error;
    }
    const risks = worktreeCleanupRisks(installation.primaryRoot, { includeIgnored: false });
    if (risks.dirtyTracked || risks.hidden.length > 0
      || risks.tracked.length > 0 || risks.owned.length > 0) {
      const error = new Error('canonical self source contains tracked, hidden, or visible-owned drift');
      error.reason = 'blocked-canonical-source-dirty';
      throw error;
    }
  }
}

function verifyFinalSetup(root, profile, runtime, out, {
  beforeFinalInspection, beforeFinalTrustValidation,
}) {
  const statePath = join(commonDir(root), 'agentic-os');
  let stateIdentity;
  try {
    stateIdentity = privateDirectoryIdentity(statePath, 'setup state directory');
    if (!stateIdentity) throw new Error('final setup state directory is missing');
  } catch (cause) {
    const error = new Error(`final setup state is unsafe: ${cause.message}`, { cause });
    error.reason = 'blocked-setup-integrity';
    throw error;
  }
  if (typeof beforeFinalInspection === 'function') beforeFinalInspection({ runtime });
  const entries = [
    ...config.inspect(root, { hooksPath: runtime.hooksPath }),
    ...inspectHookRuntime(runtime),
  ];
  if (typeof beforeFinalTrustValidation === 'function')
    beforeFinalTrustValidation({ runtime, statePath });
  let trustError = null;
  try { ensureRepositoryTrust(root, profile); } catch (error) {
    trustError = error;
    entries.push({
      key: 'repository.trust', value: 'exact setup profile identity',
      actual: error.reason ?? error.message, ok: false,
      why: 'setup success requires the repository trust anchor to remain exact',
    });
  }
  let stateError = null;
  try { assertPrivateDirectoryIdentity(stateIdentity, 'setup state directory'); } catch (error) {
    stateError = error;
    entries.push({
      key: 'setup.state', value: 'one exact private state directory',
      actual: error.message, ok: false,
      why: 'runtime, configuration, and trust must share one stable parent identity',
    });
  }
  out(report.formatConfig(entries));
  const failed = entries.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    const configRace = failed.some((entry) => entry.key === 'core.hooksPath');
    const error = new Error(`final setup integrity failed: ${failed.map(({ key }) => key).join(', ')}`,
      trustError || stateError ? { cause: trustError ?? stateError } : undefined);
    error.reason = configRace ? 'blocked-config-race' : 'blocked-setup-integrity';
    error.findings = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
    error.runtime = Object.freeze({ id: runtime.runtimeId, path: runtime.path,
      hooksPath: runtime.hooksPath });
    throw error;
  }
}

export function runHookSetup(root, policy, profile, out, {
  allowTrustCreation = false, beforeFinalInspection = null, beforeFinalTrustValidation = null,
} = {}) {
  const installation = packageInstallation(root);
  assertCanonicalSetup(installation, policy);
  // The CLI's first observation only grants a one-shot creation allowance. Re-observe here so
  // a trust anchor that disappeared after profile loading is never silently reconstructed.
  const trust = loadRepositoryTrust(root, {
    required: false, allowLegacyUnanchored: allowTrustCreation,
  });
  if (trust === null && (!allowTrustCreation || hasHookRuntimeState(root))) {
    const error = new Error('managed setup state exists but repository trust is missing');
    error.reason = 'blocked-repository-trust-recovery-required';
    throw error;
  }
  const { changes, prepared: anchored } = config.ensure(root, {
    ...installation,
    beforeConfigure: (artifacts) => ensureRepositoryTrust(root, profile, {
      allowCreate: trust === null && allowTrustCreation,
      onEffect: (effect) => {
        Object.assign(artifacts, effect);
        artifacts.effectsRetained = artifacts.stateDirectoryCreated
          || artifacts.stateDirectoryTightened || artifacts.stateDirectoryTightenResultUnknown
          || artifacts.trustCreated || artifacts.trustWriteResultUnknown;
      },
    }),
    afterConfigure: () => ensureRepositoryTrust(root, profile),
    finalize: ({ runtime }) => verifyFinalSetup(root, profile, runtime, out, {
      beforeFinalInspection, beforeFinalTrustValidation,
    }),
  });
  out('');
  const total = changes.length + Number(anchored.created);
  out(total === 0 ? 'configuration already correct.' : `${total} change(s) applied.`);
  out('clone-common managed hooks verified, core.hooksPath set. Next: npm run doctor');
  return 0;
}

export function hookDoctorEntries(root) {
  try {
    const installation = packageInstallation(root);
    const runtime = describeHookRuntime(root, installation);
    return [
      ...config.inspect(root, { hooksPath: runtime.hooksPath }),
      ...inspectHookRuntime(runtime),
    ];
  } catch (error) {
    return [{
      key: 'hook.installation', value: 'exact clone-common managed runtime',
      actual: error.reason ?? 'unavailable', ok: false,
      why: 'hook integrity requires a canonical repository-local package closure',
    }];
  }
}
