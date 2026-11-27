import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRepositoryProfile } from '../src/governance.mjs';
import {
  validateMatrix, checkOwnerAuthenticity, checkValueEquivalence,
  checkPaletteDerivation, checkIndirectConsumption, checkNoCentralOverrides,
} from '../scripts/check-design-conformance.mjs';
import {
  observe,
  PROTECTED_WORKFLOW_LIMITS,
  protectedWorkflowSupportsMergeGroup,
  PROVIDER_CAPABILITIES,
} from '../src/queue.mjs';

const runGit = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repository(t, name) {
  const cwd = mkdtempSync(join(tmpdir(), `agentic-os-${name}-`));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  runGit(cwd, 'init', '--quiet', '--initial-branch=trunk');
  runGit(cwd, 'config', 'user.name', 'Fixture');
  runGit(cwd, 'config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(cwd, '.github', 'workflows'), { recursive: true });
  return cwd;
}
function commit(cwd) {
  runGit(cwd, 'add', '.github/workflows');
  runGit(cwd, 'commit', '--quiet', '--message', 'workflows');
}
const policy = { protectedRef: 'HEAD', requiredChecks: ['test'] };

test('protected workflow discovery enforces count, per-file, and aggregate byte budgets', async (t) => {
  await t.test('count', (child) => {
    const cwd = repository(child, 'workflow-count');
    for (let index = 0; index <= PROTECTED_WORKFLOW_LIMITS.count; index += 1) {
      writeFileSync(join(cwd, '.github', 'workflows', `${index}.yml`), 'on: push\n');
    }
    commit(cwd);
    assert.throws(() => protectedWorkflowSupportsMergeGroup(cwd, policy), /count budget/u);
  });
  await t.test('per-file bytes', (child) => {
    const cwd = repository(child, 'workflow-file-bytes');
    writeFileSync(join(cwd, '.github', 'workflows', 'large.yml'),
      Buffer.alloc(PROTECTED_WORKFLOW_LIMITS.perFileBytes + 1, 0x61));
    commit(cwd);
    assert.throws(() => protectedWorkflowSupportsMergeGroup(cwd, policy), /file byte budget/u);
  });
  await t.test('aggregate bytes', (child) => {
    const cwd = repository(child, 'workflow-total-bytes');
    const bytes = Buffer.alloc(Math.floor(PROTECTED_WORKFLOW_LIMITS.aggregateBytes / 5) + 1, 0x61);
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(cwd, '.github', 'workflows', `${index}.yml`), bytes);
    }
    commit(cwd);
    assert.throws(() => protectedWorkflowSupportsMergeGroup(cwd, policy), /aggregate byte budget/u);
  });
});

test('only direct YAML workflow files can prove merge-group check support', (t) => {
  const cwd = repository(t, 'workflow-file-selection');
  const decoy = ['on: merge_group', 'jobs:', '  test:', '    runs-on: ubuntu-latest', ''].join('\n');
  writeFileSync(join(cwd, '.github', 'workflows', 'decoy.txt'), decoy);
  mkdirSync(join(cwd, '.github', 'workflows', 'nested'));
  writeFileSync(join(cwd, '.github', 'workflows', 'nested', 'decoy.yml'), decoy);
  commit(cwd);
  assert.equal(protectedWorkflowSupportsMergeGroup(cwd, policy), false);
});

test('a symlink-mode workflow blob cannot prove merge-group support', (t) => {
  const cwd = repository(t, 'workflow-symlink');
  symlinkSync('on: merge_group\njobs:\n  test:\n    runs-on: ubuntu-latest\n',
    join(cwd, '.github', 'workflows', 'decoy.yml'));
  commit(cwd);
  assert.throws(() => protectedWorkflowSupportsMergeGroup(cwd, policy), /not a regular blob/u);
});

test('a protected workflow read failure becomes incomplete provider observation', (t) => {
  const cwd = repository(t, 'workflow-read-failure');
  writeFileSync(join(cwd, '.github', 'workflows', 'integration.yml'), [
    'on: merge_group', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '',
  ].join('\n'));
  commit(cwd);
  runGit(cwd, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');
  const profile = createRepositoryProfile({
    repository: 'github.com/owner/repo',
    canonical: {
      localRef: 'refs/heads/trunk',
      remoteRef: 'refs/remotes/origin/trunk',
    },
    adapters: {
      repository: { id: 'git', version: '1' },
      provider: { id: 'github', version: '1' },
    },
    capabilities: [
      PROVIDER_CAPABILITIES.PULL_REQUEST,
      PROVIDER_CAPABILITIES.MERGE_QUEUE,
    ],
    requiredChecks: ['test'],
  });
  const provider = (args) => {
    if (args[0] === 'repo') return {
      nameWithOwner: 'owner/repo',
      defaultBranchRef: { name: 'trunk' },
      url: 'https://github.com/owner/repo',
    };
    if (args[0] === 'pr') return [];
    if (args[1] === 'repos/owner/repo') return { delete_branch_on_merge: false };
    if (args[1] === 'repos/owner/repo/rulesets') return [{ id: 1 }];
    if (args[1] === 'repos/owner/repo/rulesets/1') return {
      target: 'branch', enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/trunk'], exclude: [] } },
      rules: [
        { type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } },
        { type: 'merge_queue', parameters: { merge_method: 'SQUASH' } },
        { type: 'required_status_checks', parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: 'test' }],
        } },
      ],
    };
    if (args[1] === 'repos/owner/repo/branches/trunk/protection') return {};
    return assert.fail(`unexpected provider call: ${args.join(' ')}`);
  };
  const state = observe({ cwd, profile, provider, providerAvailable: () => true });
  assert.equal(state.mergeGroupSupported, null);
  assert.ok(state.observationErrors.includes('protected-workflows'));
});

// Fleet design-token conformance gate (scripts/check-design-conformance.mjs).
const dcSha = bytes => createHash('sha256').update(bytes).digest('hex');
const dcOid = 'a'.repeat(40);
const dcTarget = 'b'.repeat(40);
const dcOwnerId = 'github.com/huijoohwee/agentic-design-system';
const dcProjectionBytes = Buffer.from(':root{--agentic-row-height:38px}\n');
const dcProjectionSha = `sha256:${dcSha(dcProjectionBytes)}`;
const dcSourceBytes = Buffer.from('{"tokens":[]}\n');
const dcSourceSha = `sha256:${dcSha(dcSourceBytes)}`;

function dcRepo(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'design-conformance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  const head = git('rev-parse', 'HEAD').trim();
  const blob = (file, revision = head) => execFileSync('git', ['-C', root, 'show', `${revision}:${file}`], { maxBuffer: 500000 });
  return { head, path: root, blob, text: file => blob(file).toString(), json: file => JSON.parse(blob(file).toString()) };
}

function dcMatrix() {
  return {
    schema: 'agentic-os/design-consumer-matrix/v1',
    owner: 'github.com/huijoohwee/agentic-os',
    designSystemOwner: dcOwnerId,
    alignment: {
      policy: 'unified-release-with-bounded-value-equivalent-skew',
      targetRevision: dcTarget, sharedUiSourceSha256: dcSourceSha, sharedUiProjectionSha256: dcProjectionSha,
      convergence: 'next-design-system-release', note: 'fixture',
    },
    consumers: [{
      repository: 'github.com/huijoohwee/agentic-sheets', kind: 'vendored-pin',
      pinPath: 'design/shared-ui-profile.pin.json', registryRevision: dcOid, alignment: 'value-equivalent-skew',
      sharedUiProjectionPath: 'site/vendor/shared-ui-profile.css', ownedStylesheets: ['sheets/styles.css'],
    }],
  };
}

test('design consumer matrix self-check accepts a well-formed inventory and rejects drift', () => {
  validateMatrix(dcMatrix());
  const bad = dcMatrix();
  bad.alignment.targetRevision = 'short';
  assert.throws(() => validateMatrix(bad), /target revision/u);
  const dup = dcMatrix();
  dup.consumers.push({ ...dup.consumers[0] });
  assert.throws(() => validateMatrix(dup), /duplicate consumer/u);
  const policy = dcMatrix();
  policy.alignment.policy = 'free-version-choice';
  assert.throws(() => validateMatrix(policy), /alignment policy/u);
  const legacy = dcMatrix();
  legacy.consumers = [{ repository: 'github.com/huijoohwee/agentic-canvas-os', kind: 'indirect', via: 'github.com/huijoohwee/agentic-graph', consumptionPath: 'web/build.mjs', consumptionMarker: 'agentic-graph/observability-build/v1', legacyStylesheet: { path: 'web/styles.css', active: true, reachabilityEvidence: 'x' }, ownedStylesheets: [] }];
  assert.throws(() => validateMatrix(legacy), /inactive with reachability evidence/u);
});

test('design owner authenticity rejects forked source or projection bytes', t => {
  const owner = dcRepo(t, { 'site/tokens/shared-ui-profile.json': dcSourceBytes, 'site/vendor/shared-ui-profile.css': dcProjectionBytes });
  const pin = { sourceRevision: owner.head, sourceSha256: dcSourceSha, sourcePath: 'site/tokens/shared-ui-profile.json', registryRevision: owner.head, projectionSha256: dcProjectionSha, projectionPath: 'site/vendor/shared-ui-profile.css' };
  checkOwnerAuthenticity(owner, pin, 'sheets');
  assert.throws(() => checkOwnerAuthenticity(owner, { ...pin, projectionSha256: `sha256:${dcSha(Buffer.from('fork'))}` }, 'sheets'), /projection differs/u);
  assert.throws(() => checkOwnerAuthenticity(owner, { ...pin, sourceSha256: `sha256:${dcSha(Buffer.from('fork'))}` }, 'sheets'), /source differs/u);
});

test('design value equivalence rejects delivered-value drift', () => {
  checkValueEquivalence(dcProjectionSha, dcProjectionSha, 'sheets');
  assert.throws(() => checkValueEquivalence(`sha256:${dcSha(Buffer.from('other'))}`, dcProjectionSha, 'sheets'), /drift from the alignment target/u);
});

test('design palette derivation rejects local re-authoring and forked projection', t => {
  const paletteBytes = Buffer.from('{"intents":{"primary":{"text":"text-blue-600 dark:text-blue-400"}}}\n');
  const owner = dcRepo(t, { 'site/ui-intent-palette.json': paletteBytes });
  const palette = { ownerPath: 'site/ui-intent-palette.json', projectionPath: 'grph-shared/src/ui/ui-intent-palette.json', pinPath: 'grph-shared/src/ui/ui-intent-palette.pin.json', derivationPath: 'grph-shared/src/ui/intentTokens.ts', forbiddenLiteral: 'text-blue-600' };
  const pin = JSON.stringify({ owner: dcOwnerId, sourceRevision: owner.head, sourceSha256: `sha256:${dcSha(paletteBytes)}` });
  const good = dcRepo(t, {
    'grph-shared/src/ui/ui-intent-palette.json': paletteBytes,
    'grph-shared/src/ui/ui-intent-palette.pin.json': pin,
    'grph-shared/src/ui/intentTokens.ts': "import palette from './ui-intent-palette.json';\nexport const UI_INTENT_TOKENS = palette.intents;\n",
  });
  checkPaletteDerivation(owner, good, palette, owner.head, 'graph');
  const reauthored = dcRepo(t, {
    'grph-shared/src/ui/ui-intent-palette.json': paletteBytes,
    'grph-shared/src/ui/ui-intent-palette.pin.json': pin,
    'grph-shared/src/ui/intentTokens.ts': "export const UI_INTENT_TOKENS = { primary: { text: 'text-blue-600 dark:text-blue-400' } };\n",
  });
  assert.throws(() => checkPaletteDerivation(owner, reauthored, palette, owner.head, 'graph'), /re-authors central intent values/u);
  const forked = dcRepo(t, {
    'grph-shared/src/ui/ui-intent-palette.json': Buffer.from('{"intents":{}}\n'),
    'grph-shared/src/ui/ui-intent-palette.pin.json': pin,
    'grph-shared/src/ui/intentTokens.ts': "import palette from './ui-intent-palette.json';\nexport const UI_INTENT_TOKENS = palette.intents;\n",
  });
  assert.throws(() => checkPaletteDerivation(owner, forked, palette, owner.head, 'graph'), /vendored palette differs/u);
});

test('design indirect consumption rejects a reachable legacy stylesheet', t => {
  const entry = { consumptionPath: 'web/build.mjs', consumptionMarker: 'agentic-graph/observability-build/v1', legacyStylesheet: { path: 'web/styles.css', active: false, reachabilityEvidence: 'unreferenced' } };
  const good = dcRepo(t, { 'web/build.mjs': "const schema='agentic-graph/observability-build/v1';\n", 'web/index.html': '<link href="./app.css">', 'web/styles.css': ':root{--bg:#000}' });
  checkIndirectConsumption(good, entry, 'canvas');
  const reachable = dcRepo(t, { 'web/build.mjs': "const schema='agentic-graph/observability-build/v1';\n", 'web/index.html': '<link href="./styles.css">', 'web/styles.css': ':root{--bg:#000}' });
  assert.throws(() => checkIndirectConsumption(reachable, entry, 'canvas'), /reachable/u);
  const noMarker = dcRepo(t, { 'web/build.mjs': "const schema='other';\n", 'web/styles.css': ':root{--bg:#000}' });
  assert.throws(() => checkIndirectConsumption(noMarker, entry, 'canvas'), /verified Graph output/u);
});

test('design central-variable override scan rejects redeclaration in authored stylesheets', t => {
  const centralVars = new Set(['--agentic-row-height', '--agentic-font-size-body']);
  const clean = dcRepo(t, { 'sheets/styles.css': ':root{--local-gap:12px}' });
  checkNoCentralOverrides(clean, ['sheets/styles.css'], centralVars, 'sheets');
  const override = dcRepo(t, { 'sheets/styles.css': ':root{--agentic-row-height:40px}' });
  assert.throws(() => checkNoCentralOverrides(override, ['sheets/styles.css'], centralVars, 'sheets'), /redeclares centrally owned/u);
});
