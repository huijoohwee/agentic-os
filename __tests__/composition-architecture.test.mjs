import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync,
  symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withContainedModules } from '../bin/composition-module-loader.mjs';
import { COMPOSITION_MARKETPLACE_FAILURE_CODES, COMPOSITION_MARKETPLACE_PROBE_SCHEMA, isValidCompositionMarketplaceProbeReport, marketplaceProbeFindingTarget, marketplaceRuntimeReadOnlyTraceValid } from '../bin/composition-marketplace-probe.mjs';
import { inspectGitWorktree, observeCompositionRuntime } from '../bin/composition-runtime-check.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const README_PATH = new URL('../README.md', import.meta.url);
const GUIDE_PATH = new URL('../guides/COMPOSITION-ARCHITECTURE.md', import.meta.url);
const GUIDE_LINK = 'guides/COMPOSITION-ARCHITECTURE.md';

function read(path) {
  return readFileSync(path, 'utf8');
}

function exactTableRow(text, first, second = null) {
  const prefix = second === null ? `| \`${first}\` |` : `| \`${first}\` | \`${second}\` |`;
  const rows = text.split('\n').filter((line) => line.startsWith(prefix));
  assert.equal(rows.length, 1, `expected one table row for ${first}${second ? ` -> ${second}` : ''}`);
  return rows[0];
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('module containment loads index-bound bytes despite a pre-existing loader hook', {
  skip: !['strip', 'transform'].includes(process.features?.typescript),
}, async () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-module-hook-'));
  const root = join(base, 'owner');
  mkdirSync(root);
  const entryPath = join(root, 'entry.mjs');
  writeFileSync(entryPath, 'export const value = 1;\n');
  const alternatePath = join(root, 'alternate.mjs');
  writeFileSync(alternatePath, 'export const value = 998;\n');
  spawnSync('git', ['init', '-q', root]);
  spawnSync('git', ['-C', root, 'add', 'entry.mjs', 'alternate.mjs']);
  const entryUrl = pathToFileURL(entryPath).href, alternateUrl = pathToFileURL(alternatePath).href;
  const hostile = nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === entryUrl
        ? { url: alternateUrl, shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === entryUrl
        ? { format: 'module', source: 'export const value = 999;\n', shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  try {
    const value = await withContainedModules(
      [{ root, relative: 'entry.mjs' }],
      'composition_marketplace_probe',
      ([entry]) => entry.value,
    );
    assert.equal(value, 1);
  } finally {
    hostile.deregister();
    rmSync(base, { recursive: true, force: true });
  }
});

test('module containment does not reuse a prior ESM cache entry', {
  skip: !['strip', 'transform'].includes(process.features?.typescript),
}, async () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-module-cache-'));
  const root = join(base, 'owner'), entryPath = join(root, 'entry.mjs');
  try {
    mkdirSync(root);
    writeFileSync(entryPath, 'export const value = 1;\n');
    spawnSync('git', ['init', '-q', root]);
    spawnSync('git', ['-C', root, 'add', 'entry.mjs']);
    assert.equal((await import(pathToFileURL(entryPath).href)).value, 1);
    writeFileSync(entryPath, 'export const value = 2;\n');
    spawnSync('git', ['-C', root, 'add', 'entry.mjs']);
    const value = await withContainedModules([{ root, relative: 'entry.mjs' }],
      'composition_marketplace_probe', ([entry]) => entry.value);
    assert.equal(value, 2);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('module containment remains active through function-time dynamic imports', {
  skip: !['strip', 'transform'].includes(process.features?.typescript),
}, async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'composition-module-loader-'));
  const root = join(base, 'owner');
  const outside = join(base, 'outside.mjs');
  try {
    mkdirSync(root);
    writeFileSync(outside, 'export const escaped = true;\n');
    writeFileSync(join(root, 'entry.mjs'), "export const run = () => import('./escape.mjs');\n");
    symlinkSync(outside, join(root, 'escape.mjs'));
    spawnSync('git', ['init', '-q', root]);
    spawnSync('git', ['-C', root, 'add', 'entry.mjs']);
    const priorIndex = process.env.GIT_INDEX_FILE;
    process.env.GIT_INDEX_FILE = join(base, 'foreign-index');
    t.after(() => {
      if (priorIndex === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = priorIndex;
    });
    await assert.rejects(
      withContainedModules(
        [{ root, relative: 'entry.mjs' }],
        'composition_marketplace_probe',
        ([entry]) => entry.run(),
      ),
      /marketplace_module_not_regular/u,
    );
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('module containment rejects ignored transitive source', {
  skip: !['strip', 'transform'].includes(process.features?.typescript),
}, async () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-module-loader-'));
  const root = join(base, 'owner');
  try {
    mkdirSync(root);
    writeFileSync(join(root, '.gitignore'), 'ignored.mjs\n');
    writeFileSync(join(root, 'ignored-entry.mjs'), "export const run = () => import('./ignored.mjs');\n");
    writeFileSync(join(root, 'ignored.mjs'), 'export const ignored = true;\n');
    spawnSync('git', ['init', '-q', root]);
    spawnSync('git', ['-C', root, 'add', '.gitignore', 'ignored-entry.mjs']);
    await assert.rejects(
      withContainedModules([{ root, relative: 'ignored-entry.mjs' }], 'composition_marketplace_probe',
        ([entry]) => entry.run()),
      /marketplace_module_untracked/u,
    );
    const magic = ':(glob)*.mjs';
    writeFileSync(join(root, magic), 'export const untracked = true;\n');
    writeFileSync(join(root, 'magic-entry.mjs'), `export const run = () => import('./${magic}');\n`);
    spawnSync('git', ['-C', root, 'add', 'magic-entry.mjs']);
    await assert.rejects(
      withContainedModules([{ root, relative: 'magic-entry.mjs' }], 'composition_marketplace_probe',
        ([entry]) => entry.run()), /marketplace_module_untracked/u);
    writeFileSync(join(root, 'evil.mjs'), 'export const evil = true;\n');
    writeFileSync(join(root, 'symlink-entry.mjs'), "export const run = () => import('./alias.mjs');\n");
    symlinkSync(join(root, 'evil.mjs'), join(root, 'alias.mjs'));
    spawnSync('git', ['-C', root, 'add', 'evil.mjs', 'symlink-entry.mjs']);
    await assert.rejects(
      withContainedModules([{ root, relative: 'symlink-entry.mjs' }], 'composition_marketplace_probe',
        ([entry]) => entry.run()), /marketplace_module_not_regular/u);
    mkdirSync(join(root, 'real'));
    writeFileSync(join(root, 'real/target.mjs'), 'export const aliased = true;\n');
    writeFileSync(join(root, 'ancestor-entry.mjs'), "export const run = () => import('./alias-dir/target.mjs');\n");
    symlinkSync(join(root, 'real'), join(root, 'alias-dir'));
    spawnSync('git', ['-C', root, 'add', 'real/target.mjs', 'ancestor-entry.mjs']);
    await assert.rejects(
      withContainedModules([{ root, relative: 'ancestor-entry.mjs' }], 'composition_marketplace_probe',
        ([entry]) => entry.run()), /marketplace_module_path_aliased/u);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('module containment binds every initial entry to its declared owner root', {
  skip: !['strip', 'transform'].includes(process.features?.typescript),
}, async () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-module-owner-'));
  const first = join(base, 'first'), second = join(base, 'second');
  try {
    mkdirSync(first); mkdirSync(second);
    writeFileSync(join(second, 'real.mjs'), 'export const owner = "second";\n');
    symlinkSync(join(second, 'real.mjs'), join(first, 'entry.mjs'));
    for (const root of [first, second]) spawnSync('git', ['init', '-q', root]);
    spawnSync('git', ['-C', second, 'add', 'real.mjs']);
    await assert.rejects(withContainedModules([
      { root: first, relative: 'entry.mjs' }, { root: second, relative: 'real.mjs' },
    ], 'composition_marketplace_probe', modules => modules),
    /marketplace_module_not_regular/u);
    writeFileSync(join(first, 'cross.mjs'),
      "export const run = () => import('../second/real.mjs');\n");
    spawnSync('git', ['-C', first, 'add', 'cross.mjs']);
    await assert.rejects(withContainedModules([
      { root: first, relative: 'cross.mjs' }, { root: second, relative: 'real.mjs' },
    ], 'composition_marketplace_probe', ([entry]) => entry.run()),
    /marketplace_module_owner_boundary_crossed/u);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('module containment rejects one canonical target claimed by overlapping owners', {
  skip: !['strip', 'transform'].includes(process.features?.typescript),
}, async () => {
  const outer = mkdtempSync(join(tmpdir(), 'composition-module-overlap-'));
  const inner = join(outer, 'inner');
  try {
    mkdirSync(inner);
    writeFileSync(join(inner, 'entry.mjs'), "export const run = () => import('../escape.mjs');\n");
    writeFileSync(join(outer, 'escape.mjs'), 'export const escaped = true;\n');
    spawnSync('git', ['init', '-q', outer]);
    spawnSync('git', ['-C', outer, 'add', 'inner/entry.mjs', 'escape.mjs']);
    spawnSync('git', ['init', '-q', inner]);
    spawnSync('git', ['-C', inner, 'add', 'entry.mjs']);
    await assert.rejects(withContainedModules([
      { root: outer, relative: 'inner/entry.mjs' }, { root: inner, relative: 'entry.mjs' },
    ], 'composition_marketplace_probe', modules => modules),
    /marketplace_module_owner_boundary_crossed/u);
  } finally { rmSync(outer, { recursive: true, force: true }); }
});

test('module containment keeps concurrent invocation tokens isolated', {
  skip: !['strip', 'transform'].includes(process.features?.typescript),
}, async () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-module-concurrent-'));
  const roots = [join(base, 'one'), join(base, 'two')];
  try {
    for (const [index, root] of roots.entries()) {
      mkdirSync(root);
      writeFileSync(join(root, 'entry.mjs'), "export const run = () => import('./value.mjs');\n");
      writeFileSync(join(root, 'value.mjs'), `export const value = ${index + 1};\n`);
      spawnSync('git', ['init', '-q', root]);
      spawnSync('git', ['-C', root, 'add', 'entry.mjs', 'value.mjs']);
    }
    const values = await Promise.all(roots.map(root => withContainedModules(
      [{ root, relative: 'entry.mjs' }], 'composition_marketplace_probe',
      async ([entry]) => (await entry.run()).value,
    )));
    assert.deepEqual(values, [1, 2]);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('module containment rejects cross-imports between concurrent tokens', {
  skip: !['strip', 'transform'].includes(process.features?.typescript),
}, async () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-module-cross-token-'));
  const first = join(base, 'first'), second = join(base, 'second');
  let releaseSecond;
  try {
    mkdirSync(first); mkdirSync(second);
    writeFileSync(join(first, 'entry.mjs'), 'export const run = url => import(url);\n');
    writeFileSync(join(second, 'entry.mjs'),
      'export const url = import.meta.url; export const secret = 42;\n');
    for (const root of [first, second]) {
      spawnSync('git', ['init', '-q', root]);
      spawnSync('git', ['-C', root, 'add', 'entry.mjs']);
    }
    let publishUrl;
    const urlReady = new Promise(resolve => { publishUrl = resolve; });
    const holdSecond = new Promise(resolve => { releaseSecond = resolve; });
    const secondRun = withContainedModules([{ root: second, relative: 'entry.mjs' }],
      'composition_marketplace_probe', async ([entry]) => {
        publishUrl(entry.url);
        await holdSecond;
        return entry.secret;
      });
    const secondUrl = await urlReady;
    try {
      await assert.rejects(withContainedModules([{ root: first, relative: 'entry.mjs' }],
        'composition_marketplace_probe', ([entry]) => entry.run(secondUrl)),
      /marketplace_module_owner_boundary_crossed/u);
    } finally { releaseSecond(); }
    assert.equal(await secondRun, 42);
  } finally {
    releaseSecond?.();
    rmSync(base, { recursive: true, force: true });
  }
});

test('marketplace probe failures retain their source owner', () => {
  const commerceClaim = ['agentic-commerce-os', 'src/domain/authoring-claim-policy.ts'];
  const graphPermit = ['agentic-graph', 'cloudflare/workers/commerce-provider-contract.ts'];
  assert.deepEqual(marketplaceProbeFindingTarget('marketplace_control_route_signing_failed'),
    ['agentic-commerce-os', 'src/shared/commerce-provider-auth.ts']);
  assert.deepEqual(marketplaceProbeFindingTarget('marketplace_payload_mismatch_rebind_failed'),
    ['agentic-commerce-os', 'src/core/provider-operation-gate.ts']);
  for (const code of ['marketplace_authoring_digest_mismatch',
    'marketplace_authoring_operation_id_invalid', 'marketplace_authoring_permit_construction_invalid']) {
    assert.deepEqual(marketplaceProbeFindingTarget(code), commerceClaim, code);
  }
  for (const code of ['marketplace_authoring_permit_invalid', 'marketplace_authoring_permit_expired',
    'marketplace_authoring_permit_projection_mismatch', 'marketplace_authoring_payload_invalid',
    'marketplace_malformed_permit_accepted', 'marketplace_post_signature_tamper_accepted']) {
    assert.deepEqual(marketplaceProbeFindingTarget(code), graphPermit, code);
  }
  const emitted = COMPOSITION_MARKETPLACE_FAILURE_CODES.filter(
    code => code !== 'composition_marketplace_probe_node_runtime_unsupported');
  for (const code of emitted) {
    assert.equal(isValidCompositionMarketplaceProbeReport({
      schema: COMPOSITION_MARKETPLACE_PROBE_SCHEMA, ok: false, code,
    }), true, code);
    assert.equal(marketplaceProbeFindingTarget(code).length, 2, code);
  }
  assert.equal(isValidCompositionMarketplaceProbeReport({
    schema: COMPOSITION_MARKETPLACE_PROBE_SCHEMA, ok: false,
    code: 'marketplace_invented_failure',
  }), false);
  const responseCodes = emitted.filter(code => code.startsWith('marketplace_response_'));
  assert.equal(responseCodes.length, 10);
  assert(responseCodes.every(code => code === code.toLowerCase()));
  assert.deepEqual(marketplaceProbeFindingTarget('marketplace_vendor_list_response_headers_invalid'),
    ['agentic-graph', 'cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts']);
  for (const code of ['marketplace_vendor_list_consumer_contract_mismatch',
    'marketplace_vendor_identifier_grammar_mismatch', 'marketplace_settlement_consumer_contract_mismatch']) {
    assert.deepEqual(marketplaceProbeFindingTarget(code),
      ['agentic-graph', 'cloudflare/workers/agentic-graph-marketplace/src/commerce-provider.ts']);
  }
  assert.deepEqual(marketplaceProbeFindingTarget('marketplace_authoring_header_generation_invalid'),
    ['agentic-commerce-os', 'src/core/authoring-mutation-headers.ts']);
  assert.deepEqual(marketplaceProbeFindingTarget('marketplace_authoring_header_value_mismatch'),
    ['agentic-commerce-os', 'src/core/marketplace-transition-request.ts']);
  assert.equal(marketplaceRuntimeReadOnlyTraceValid(0, 0), true);
  assert.equal(marketplaceRuntimeReadOnlyTraceValid(4, 0), true);
  assert.equal(marketplaceRuntimeReadOnlyTraceValid(5, 0), false);
  assert.equal(marketplaceRuntimeReadOnlyTraceValid(0, 1), false);
});

test('Git inspection binds the exact root and dirty bytes', () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-git-inspection-'));
  const root = join(base, 'owner');
  try {
    mkdirSync(root);
    writeFileSync(join(root, 'tracked.mjs'), 'export const value = 1;\n');
    git(root, ['init', '-q']);
    git(root, ['add', 'tracked.mjs']);
    git(root, ['-c', 'user.name=Composition Test', '-c', 'user.email=test@example.invalid',
      'commit', '-qm', 'baseline']);
    git(root, ['remote', 'add', 'origin', 'https://github.com/huijoohwee/agentic-os.git']);
    writeFileSync(join(root, 'tracked.mjs'), 'export const value = 2;\n');
    const before = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
    writeFileSync(join(root, 'tracked.mjs'), 'export const value = 3;\n');
    const after = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
    assert.equal(before.clean, false);
    assert.notEqual(before.worktreeStateDigest, after.worktreeStateDigest);
    const beforeIndex = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
    git(root, ['add', 'tracked.mjs']);
    const afterIndex = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
    assert.notEqual(beforeIndex.worktreeStateDigest, afterIndex.worktreeStateDigest);
    writeFileSync(join(root, 'untracked.mjs'), 'export const value = 1;\n');
    const beforeUntracked = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
    writeFileSync(join(root, 'untracked.mjs'), 'export const value = 2;\n');
    const afterUntracked = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
    assert.notEqual(beforeUntracked.worktreeStateDigest, afterUntracked.worktreeStateDigest);
    rmSync(join(root, 'untracked.mjs'));
    const fifo = join(root, 'tracked.mjs'); rmSync(fifo);
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    assert.equal(inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os').code,
      'git_worktree_snapshot_unavailable');
    rmSync(fifo); writeFileSync(fifo, 'export const value = 3;\n');
    truncateSync(fifo, 1_048_577);
    assert.equal(inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os').code,
      'git_worktree_snapshot_unavailable'); writeFileSync(fifo, 'export const value = 3;\n');
    const oversized = join(root, 'oversized.bin');
    writeFileSync(oversized, ''); truncateSync(oversized, 500_001);
    assert.equal(inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os').code,
      'git_worktree_snapshot_unavailable');
    rmSync(oversized);
    git(root, ['update-index', '--assume-unchanged', 'tracked.mjs']);
    writeFileSync(join(root, 'tracked.mjs'), 'export const hidden = true;\n');
    assert.equal(inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os').code,
      'git_worktree_snapshot_unavailable');
    const nested = join(root, 'nested');
    mkdirSync(nested);
    assert.equal(inspectGitWorktree(nested, 'agentic-os', 'huijoohwee/agentic-os').code,
      'git_toplevel_unexpected');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('Git inspection never executes configured clean filters', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'composition-git-filter-')), root = join(base, 'owner');
  const marker = join(base, 'filter-ran'), filter = join(base, 'hostile-filter');
  try {
    mkdirSync(root);
    writeFileSync(join(root, '.gitattributes'), 'tracked.mjs filter=hostile\n');
    writeFileSync(join(root, 'tracked.mjs'), 'export const value = 1;\n');
    git(root, ['init', '-q']); git(root, ['add', '.gitattributes', 'tracked.mjs']);
    git(root, ['-c', 'user.name=Composition Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline']);
    git(root, ['remote', 'add', 'origin', 'https://github.com/huijoohwee/agentic-os.git']);
    writeFileSync(filter, '#!/bin/sh\ntouch "$FILTER_MARKER"\ncat\n'); chmodSync(filter, 0o755);
    git(root, ['config', 'filter.hostile.clean', filter]);
    const prior = process.env.FILTER_MARKER; process.env.FILTER_MARKER = marker;
    t.after(() => { if (prior === undefined) delete process.env.FILTER_MARKER; else process.env.FILTER_MARKER = prior; });
    writeFileSync(join(root, 'tracked.mjs'), 'export const value = 2;\n');
    assert.equal(inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os').code, 'worktree_dirty');
    assert.equal(existsSync(marker), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('Git inspection detects same-size restored-mtime edits under relaxed stat settings', () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-git-stat-')), root = join(base, 'owner');
  const tracked = join(root, 'tracked.txt'), fixed = new Date('2020-01-01T00:00:00.000Z');
  try {
    mkdirSync(root); git(root, ['init', '-q']);
    writeFileSync(tracked, 'aaaaaaaa\n'); utimesSync(tracked, fixed, fixed); git(root, ['add', 'tracked.txt']);
    git(root, ['-c', 'user.name=Composition Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'baseline']);
    git(root, ['remote', 'add', 'origin', 'https://github.com/huijoohwee/agentic-os.git']);
    const before = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
    git(root, ['config', 'core.trustctime', 'false']); git(root, ['config', 'core.checkStat', 'minimal']);
    writeFileSync(tracked, 'bbbbbbbb\n'); utimesSync(tracked, fixed, fixed);
    const blind = spawnSync('git', ['-C', root, 'status', '--porcelain=v2'], { encoding: 'utf8' });
    assert.equal(blind.status, 0); assert.equal(blind.stdout, '');
    const after = inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os');
    assert.equal(after.code, 'worktree_dirty'); assert.notEqual(after.worktreeStateDigest, before.worktreeStateDigest);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('Git inspection rejects a tracked-file mutation during its final inventory', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'composition-git-race-'));
  const root = join(base, 'owner'), wrappers = join(base, 'bin');
  const tracked = join(root, 'tracked.txt'), countFile = join(base, 'count');
  try {
    mkdirSync(root); mkdirSync(wrappers);
    writeFileSync(tracked, 'aaaaaaaa\n');
    git(root, ['init', '-q']); git(root, ['add', 'tracked.txt']);
    git(root, ['-c', 'user.name=Composition Test', '-c', 'user.email=test@example.invalid',
      'commit', '-qm', 'baseline']);
    git(root, ['remote', 'add', 'origin', 'https://github.com/huijoohwee/agentic-os.git']);
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    const wrapper = join(wrappers, 'git');
    writeFileSync(countFile, '0\n');
    writeFileSync(wrapper, `#!/bin/sh
count_file=${JSON.stringify(countFile)}
next=$(( $(/bin/cat "$count_file") + 1 ))
printf '%s\\n' "$next" > "$count_file"
if [ "$next" -eq 8 ]; then printf 'bbbbbbbb\\n' > ${JSON.stringify(tracked)}; fi
exec ${JSON.stringify(realGit)} "$@"
`);
    chmodSync(wrapper, 0o755);
    const priorPath = process.env.PATH;
    process.env.PATH = `${wrappers}:${priorPath ?? ''}`;
    t.after(() => {
      if (priorPath === undefined) delete process.env.PATH;
      else process.env.PATH = priorPath;
    });
    assert.equal(inspectGitWorktree(root, 'agentic-os', 'huijoohwee/agentic-os').code,
      'git_worktree_snapshot_unavailable');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('native observer rejects a different agentic-os checkout root', () => {
  const base = mkdtempSync(join(tmpdir(), 'composition-runtime-root-'));
  const roots = {};
  try {
    for (const component of ['agentic-os', 'agentic-canvas-os', 'agentic-graph', 'agentic-commerce-os']) {
      roots[component] = join(base, component);
      mkdirSync(roots[component]);
    }
    const report = observeCompositionRuntime({ roots });
    assert(report.findings.some(item => item.component === 'agentic-os'
      && item.code === 'agentic_os_runtime_root_mismatch'));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('composition architecture is discoverable and bounded', () => {
  const readme = read(README_PATH);
  const guide = read(GUIDE_PATH);
  const writeScope = [GUIDE_LINK, '__tests__/composition-architecture.test.mjs',
    '__tests__/composition-runtime-check.test.mjs', 'bin/composition-runtime-check.mjs',
    'bin/composition-admission-probe.mjs', 'bin/composition-marketplace-probe.mjs',
    'bin/composition-module-loader.mjs'];

  assert.match(readme, new RegExp(`\\[composition architecture\\]\\(${GUIDE_LINK}\\)`));
  assert.ok(statSync(GUIDE_PATH).isFile());
  for (const file of writeScope) {
    const source = read(join(ROOT, file));
    assert.ok(Buffer.byteLength(source) < 500_000, file);
    assert.ok(source.split('\n').length - 1 < 600, file);
  }
  assert.equal(readFileSync(join(ROOT, GUIDE_LINK), 'utf8'), guide);
  assert.match(read(join(ROOT, 'bin/composition-runtime-check.mjs')), /killSignal: 'SIGKILL'/);
});

test('composition architecture binds its source and repository evidence', () => {
  const guide = read(GUIDE_PATH);
  const repositorySlug = ['agentic', 'graph'].join('-');
  const requiredEvidence = [
    'sha256:5e646e3afce86c05415c3f2545282603f3e58d77440382c6ab3fb5dc78e39418',
    'sha256:4abee8d5d6aafcc71919d95e222b2d3dea6ebd4fe3cd6d115a361d32009b7a7e',
    '99dd3d18d573c2ccf7616e29dad15aad94359b84',
    '3c597227dbb1101a2d5d75cb83a8496e22357a0e',
    '9ba90b95bcde38db9f25f6b945ba66cfd264e735',
    'd5323bc35a62cf2dace300990d5ee0db228897d8',
    '499296c7830ca62f30a6b6ac4181474e2511bae9',
    `https://github.com/huijoohwee/${repositorySlug}/tree/9ba90b95bcde38db9f25f6b945ba66cfd264e735`,
  ];

  for (const evidence of requiredEvidence) assert.ok(guide.includes(evidence), evidence);
  assert.match(guide, /version: "1\.4\.1"/);
  assert.match(guide, /adr_revision: "1\.4\.1"/);
  assert.match(guide, /execution_gate: "runtime-source-authorized"/);
  assert.match(guide, /local_rung: "dev-proven"/);
  assert.match(guide, /delivered_rung: "undocumented"/);
});

test('composition architecture keeps product terminology canonical', () => {
  const readme = read(README_PATH);
  const guide = read(GUIDE_PATH);
  const legacySlug = ['know', 'grph'].join('');
  const compactGraphSlug = ['agentic', 'graph'].join('');
  const legacyGraphDisplayName = ['Agentic', 'Graph'].join('');
  const withheldMarketplaceName = ['Mer', 'cur'].join('');
  const legacySlugs = guide.match(new RegExp(legacySlug, 'gi')) ?? [];

  assert.match(readme, /`agentic-graph`/);
  assert.doesNotMatch(`${readme}\n${guide}`, new RegExp(legacyGraphDisplayName));
  assert.doesNotMatch(`${readme}\n${guide}`, new RegExp(compactGraphSlug, 'i'));
  assert.match(guide, /primary B2C Marketplace Storefront and\s+Orchestration Hub/);
  assert.doesNotMatch(`${readme}\n${guide}`, /\bKG(?:_|\b)/);
  assert.doesNotMatch(guide, new RegExp(withheldMarketplaceName, 'i'));
  assert.equal(legacySlugs.length, 0, 'canonical architecture must not retain the legacy repository slug');
});

test('composition architecture carries the publication and runtime acceptance contracts', () => {
  const guide = read(GUIDE_PATH);
  const requiredSections = [
    '## Division of Work',
    'Diagram COMP-1',
    'Diagram TOP-1',
    '### DR-1',
    '### DR-2',
    '### DR-3',
    '### DR-4',
    '### DR-5',
    '### DR-6',
    '### DR-7',
    '### DR-8',
    '### DR-9',
    '## Cross-repository acceptance contract',
    '### Runtime RAO',
    'VCC-DOC-PUBLISH-01',
    'RAO-DOC-01',
    'RAO-DOC-02',
    'RAO-DOC-03',
    'RAO-DOC-04',
    'OP-20260903-FIX-RELEASE',
    '## Known gaps',
  ];

  for (const section of requiredSections) assert.ok(guide.includes(section), section);
  for (let index = 1; index <= 10; index += 1) {
    assert.ok(guide.includes(`RAO-RUNTIME-${String(index).padStart(2, '0')}`));
  }
  assert.match(guide, /directive_id: "DIR-DOC-PUBLISH-01"/);
  for (const rao of ['RAO-DOC-01', 'RAO-DOC-02', 'RAO-DOC-03', 'RAO-DOC-04']) {
    const row = exactTableRow(guide, rao);
    assert.match(row, /DIR-DOC-PUBLISH-01/);
    assert.match(row, /AC-DOC-PUBLISH-01/);
    assert.match(row, /DE-DOC-PUBLISH-01/);
  }
  for (const vcc of [
    'VCC-RUNTIME-OWNERSHIP-01',
    'VCC-RUNTIME-AUTHORITY-02',
    'VCC-RUNTIME-X402-03',
  ]) assert.match(exactTableRow(guide, vcc), /\| Unsatisfied;/);

  for (const [source, target, expected] of [
    ['CANVAS', 'AG', 'unverified'],
    ['COMMERCE', 'CANVAS', 'generations differ'],
    ['AG', 'DISCOVERY', 'unverified'],
    ['AG', 'CHECKOUT', 'unverified'],
    ['AG', 'MARKET', 'unverified'],
    ['COMMERCE', 'DISCOVERY', 'unverified'],
    ['COMMERCE', 'CHECKOUT', 'unverified'],
    ['COMMERCE', 'MARKET', 'unverified'],
    ['COMMERCE_CORE', 'ACOS_ADM', 'unverified'],
    ['COMMERCE_CORE', 'DISCOVERY_RT', 'unverified'],
    ['COMMERCE_CORE', 'CHECKOUT_RT', 'unverified'],
    ['COMMERCE_CORE', 'MARKET_RT', 'unverified'],
    ['CHECKOUT_RT', 'MARKET_RT', 'unverified'],
    ['AG_PAY', 'X402_FAC', 'unverified'],
  ]) assert.match(exactTableRow(guide, source, target), new RegExp(expected));

  for (const edge of [
    'CANVAS -.->|"batch · shared invocation/safety contract"| AG',
    'COMMERCE -.->|"sync request · admission"| CANVAS',
    'COMMERCE_CORE -.->|"sync request · admission"| ACOS_ADM',
    'CHECKOUT_RT -.->|"sync request · MARKETPLACE_SERVICE"| MARKET_RT',
  ]) assert.ok(guide.includes(edge), edge);
  assert.match(guide, /runtime-source directive/i);
  assert.match(guide, /`agentic-os` is the lifecycle\/orchestration harness SSOT/);
  assert.match(guide, /exact pinned package, not\s+copied workflows/);
  assert.match(guide, /native Cloudflare Worker and per-agent Durable Object live memory/);
  assert.match(guide, /This transfer is `spec-complete`: no code\s+or resource moved/);
  assert.match(guide, /no endpoint is admissible before real micro-SME interviews and willingness-to-pay evidence/);
  assert.match(guide, /No composed repository may add an external agent-orchestration SDK as a build dependency/);
  assert.match(guide, /without depending on or copying Cloudflare's `agents` package/);
  assert.match(guide, /Bounded exports flow Cloudflare → GitHub only/);
  assert.match(guide, /Markdown archive is authoritative after export/);
  assert.match(guide, /cold start reads bounded `MEMORY\.md` plus the latest shard only/);
  assert.match(guide, /No external-reference\s+code, prompt, schema, skill, or test may be copied/);
  assert.match(guide, /marketplace join returns `marketplace_vendor_list_response_headers_invalid`/);
  assert.match(guide, /identifier-grammar, settlement-shape, and exact-route drift/);
  assert.match(guide, /`process\.features\.typescript=strip\|transform`/);
  assert.match(guide, /unsupported runtimes or configurations return a typed unavailable result/);
  assert.match(guide, /Exact seven-file committed write-scope check/);
  assert.match(guide, /8e4d934123c01380059e1b1894c520c472fd4e23/);
  assert.match(guide, /2857054241ba5bb5f35ffeba4e668590bbd8fb86/);
  assert.equal((guide.match(/commerce\.acos-admission-provider\/v3/g) ?? []).length, 1);
  assert.doesNotMatch(guide, /\| `VCC-RUNTIME-[^`]+` \|[^\n]+\| Satisfied/);
});
