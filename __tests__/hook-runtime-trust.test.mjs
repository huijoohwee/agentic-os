import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  assertPriorManagedRuntime, describeHookRuntime, inspectHookRuntime, installHookRuntime,
} from '../bin/agentic-os-hook-runtime.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('known canonical predecessors are explicitly release-pinned', () => {
  const source = readFileSync(new URL('../bin/agentic-os-hook-runtime.mjs', import.meta.url), 'utf8');
  assert.match(source, /v1-5c9e1df231a5133bdcba5cf0af0ffaf24aa51e8f0f5705e496a5c0299959271c/u);
  assert.match(source, /v1-7955e465f8ea0a23e179272df4ddadfd70ccb3baf0e2cd0893678e4943d2d171/u);
});

for (const released of [false, 'copy', 'pre-frontmatter', 'pre-diff', 'pre-upstream', 'batch32', 'retained-context', 'pre-alignment', 'pre-core']) test(released
  ? 'the exact previously released ' + released + ' runtime authorizes migration'
  : 'a self-consistent but release-unpinned prior runtime cannot authorize migration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-runtime-trust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const selected = describeHookRuntime(root, { sourceRoot: ROOT });
  const historicalGit = gunzipSync(Buffer.from(readFileSync(new URL('./fixtures/git-create-only.mjs.gz.b64', import.meta.url), 'utf8'), 'base64'));
  assert.equal(digest(historicalGit), 'b4bb69f1953f6237927cba3e4d397613a5c79f269be3b025af4c6dd454efafc9');
  const historicalGovernance = gunzipSync(Buffer.from(readFileSync(new URL('./fixtures/governance-pre-branch-retirement.mjs.gz.b64', import.meta.url), 'utf8'), 'base64'));
  assert.equal(digest(historicalGovernance), 'ea91f7a577936590c13dac1a353ef02dbf445f86ac73b347084c9b74e38c5f10');
  const quarantineBytes = Buffer.from(selected.files.find(file => file.path === 'src/quarantine.mjs').bytes
    .toString('utf8').replace('(?:canonical-sync|lane-alignment)', 'canonical-sync'));
  assert.equal(digest(quarantineBytes), '612d7f5b5bc14788adfa30944bd4b90d7ef8cff3394d34f55a2136f539cedc58');
  // Reconstruct the exact pre-policy adapter so this release fixture stays stable as the source moves.
  const replaceOnce = (source, current, previous) => {
    assert.notEqual(source.indexOf(current), -1);
    assert.equal(source.indexOf(current), source.lastIndexOf(current));
    return source.replace(current, previous);
  };
  let prePolicySource = selected.files.find(file => file.path === 'src/git-repository.mjs')
    .bytes.toString('utf8');
  prePolicySource = replaceOnce(prePolicySource,
    "  const identityPath = typeof identity === 'string' ? identity.trim().replace(/[?#].*$/, '').replace(/\\.git$/, '') : '';\n" +
      "  const slug = /[\\/@]/u.test(identityPath) ? identityPath.split(/[/:]/u).filter(Boolean).at(-1) : null;",
    "  const slug = typeof identity === 'string' && identity.startsWith('github.com/')\n" +
      "    ? identity.slice('github.com/'.length).split('/').at(-1) : null;");
  prePolicySource = replaceOnce(prePolicySource,
    "    return Object.freeze({ mode: 'not-applicable', name, expectedName: null, ok: false,\n" +
      "      startAllowed: false });",
    "    return Object.freeze({ mode: 'not-applicable', name, expectedName: null, ok: true,\n" +
      "      startAllowed: true });");
  prePolicySource = replaceOnce(prePolicySource,
    "ok: true, startAllowed: !scratch && !slug.endsWith('-private-archive') });",
    "ok: true, startAllowed: !slug.endsWith('-private-archive') });");
  const admissionStart = prePolicySource.indexOf('/** Admit new source lanes only from the primary canonical checkout. */');
  const admissionEnd = prePolicySource.indexOf('\nfunction hiddenPaths', admissionStart);
  assert.ok(admissionStart >= 0 && admissionEnd > admissionStart);
  const priorAdmission = [
    '/** Refuse lane admission from auxiliary, worktree, mismatched, or private-archive checkouts. */',
    'export function assertStartCheckout(repository, profile) {',
    '  const location = repositoryCheckoutLocation(repository, profile);',
    "  if (location.mode === 'archive') blocked('private archive checkouts are frozen and cannot start source lanes', 'blocked-private-archive');",
    "  if (!['not-applicable', 'canonical', 'scratch'].includes(location.mode)) blocked(",
    "    " + String.fromCharCode(96) + 'START requires the canonical checkout or an explicit -scratch clone for '
      + '$' + '{location.expectedName}; found ' + '$' + '{location.name} (' + '$' + '{location.mode})'
      + String.fromCharCode(96) + ',',
    "    location.mode === 'mismatch' ? 'blocked-repository-checkout-name' : 'blocked-noncanonical-repository-checkout');",
    '  return location;',
    '}',
  ].join('\n');
  prePolicySource = prePolicySource.slice(0, admissionStart) + priorAdmission + '\n'
    + prePolicySource.slice(admissionEnd);
  const prePolicyRepository = Buffer.from(prePolicySource);
  assert.equal(digest(prePolicyRepository), '0f19dd78cedf92839fe0fdd3df5cb36c65ebe888adfe41df1bb268fe4bbd3206');
  const predecessor = selected.files.map(file => released === 'pre-core' && file.path === 'src/governance.mjs'
    ? { ...file, bytes: readFileSync(new URL('./fixtures/governance-cleanup-predecessor.mjs.txt', import.meta.url)) }
    : released === 'pre-core' && file.path === 'src/git-repository.mjs'
    ? { ...file, bytes: prePolicyRepository } : released === 'pre-core' ? file : released && file.path === 'src/git-repository.mjs'
    ? { ...file, bytes: readFileSync(new URL('./fixtures/git-repository-pre-naming.mjs.txt', import.meta.url)) }
    : released && file.path === 'src/file-integrity.mjs'
    ? { ...file, bytes: readFileSync(new URL('./fixtures/file-integrity-pre-hardlinks.mjs.txt', import.meta.url)) }
    : released && file.path === 'src/quarantine.mjs'
    ? { ...file, bytes: quarantineBytes } : released === 'pre-alignment' ? file : released !== 'retained-context' && file.path === 'bin/agentic-os-filter-compare.mjs'
    ? { ...file, bytes: readFileSync(new URL('./fixtures/filter-compare-batch32.mjs.txt', import.meta.url)) }
    : file.path === 'src/git-tracked.mjs'
      ? { ...file, bytes: readFileSync(new URL('./fixtures/git-tracked-before-retained-context.mjs.txt', import.meta.url)) } : file);
  const altered = predecessor.map((file, index) => {
    const bytes = ['batch32', 'retained-context', 'pre-alignment', 'pre-core'].includes(released) && file.path === 'src/git.mjs'
      ? historicalGit : released === 'pre-core' ? file.bytes : ['pre-upstream', 'batch32', 'retained-context', 'pre-alignment'].includes(released)
      && file.path === 'src/governance.mjs' ? historicalGovernance
      : ['batch32', 'retained-context', 'pre-alignment'].includes(released) ? file.bytes : released ? (file.path === 'src/git.mjs'
      ? readFileSync(new URL('./fixtures/git-pre-upstream.mjs.txt', import.meta.url))
      : released === 'pre-upstream' ? file.bytes : file.path === 'src/governance.mjs'
      ? readFileSync(new URL('./fixtures/governance-squash-only.mjs.txt', import.meta.url))
      : file.path === 'src/quarantine.mjs'
      ? readFileSync(new URL('./fixtures/quarantine-pre-diff.mjs.txt', import.meta.url))
      : file.path === 'src/guard-main.mjs'
      ? readFileSync(new URL('./fixtures/guard-main-pre-f6.mjs.txt', import.meta.url))
      : released !== 'pre-diff' && file.path === 'src/catalog-input.mjs'
      ? readFileSync(new URL('./fixtures/catalog-input-' + released + '.mjs.txt', import.meta.url))
      : released === 'copy' && file.path === 'src/lane-id.mjs'
        ? readFileSync(new URL('./fixtures/lane-id-hostname.mjs.txt', import.meta.url)) : file.bytes)
      : index === 0 ? Buffer.concat([file.bytes, Buffer.from('\n')]) : file.bytes;
    return { path: file.path, mode: file.mode, sha256: digest(bytes), bytes };
  });
  const identity = { schema: 'agentic-os/hook-runtime/v1',
    files: altered.map(({ path, mode, sha256 }) => ({ path, mode, sha256 })) };
  const runtimeId = `v1-${digest(Buffer.from(JSON.stringify(identity)))}`;
  const manifest = { schema: identity.schema, runtimeId, files: identity.files };
  const path = join(selected.managedRoot, runtimeId);
  mkdirSync(join(path, '.githooks'), { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  mkdirSync(join(path, 'bin'), { mode: 0o700 });
  mkdirSync(join(path, 'src'), { mode: 0o700 });
  for (const file of altered) {
    const target = join(path, file.path);
    writeFileSync(target, file.bytes, { mode: file.mode });
    chmodSync(target, file.mode);
  }
  const manifestPath = join(path, 'runtime-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);

  if (released) {
    assert.equal(runtimeId, released === 'pre-core'
      ? 'v1-61b0c08ae5a26367e69ec157e182819fbde328fee570a5cf59f11b1be72fad5f' : released === 'pre-alignment'
      ? 'v1-c394f856ab85653a4a3e249d2950f44b0b412697139fbbfcd38178b439646a20' : released === 'retained-context'
      ? 'v1-02a77b09afda286eb7cbaffeffbd0aa994c7d3cfd5568f62107c489a9c33d171' : released === 'batch32'
      ? 'v1-6e0b4e4edd9aef62f7b39fa33c00ea6982db28a6410dd7b9f04792e406a1ce58' : released === 'pre-upstream'
      ? 'v1-ad7769d4d30007c8655b057a27deb45a435add2b6f7db2a11fe58bc0f1573f67' : released === 'pre-diff'
      ? 'v1-c163b6a6e47c0e1a9622e95b8b8cbdb0bb7d4c97b35f64de638636a2b5fdd625' : released === 'copy'
      ? 'v1-6f4c654528cb71df9f1c5ce26f6aef75aad8c6c1e988f6c86cc6b4d6268c48d9'
      : 'v1-1302dff132ff5ecac9f6ea9362c6d7425f60529086f58814dbd3fd958d37d7eb');
    assert.equal(assertPriorManagedRuntime(join(path, '.githooks'), selected), true);
    const catalog = join(path, 'src/catalog-input.mjs');
    writeFileSync(catalog, Buffer.concat([readFileSync(catalog), Buffer.from('\n')]));
  }
  assert.throws(
    () => assertPriorManagedRuntime(join(path, '.githooks'), selected),
    (error) => error.reason === 'blocked-hook-runtime-integrity'
      && (Boolean(released) || /not release-pinned/u.test(error.message)),
  );
  assert.equal(dirname(path), selected.managedRoot);
});

test('runtime inspection rejects a pathname replacement after opening exact bytes', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-runtime-path-race-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const selected = describeHookRuntime(root, { sourceRoot: ROOT });
  assert.equal(installHookRuntime(selected), true);
  const spec = selected.files.find(({ path }) => path === '.githooks/pre-commit');
  const displaced = join(root, 'displaced-pre-commit');
  let replaced = false;
  const entries = inspectHookRuntime(selected, {
    beforeFileInspection: ({ path }) => {
      if (replaced || path !== join(selected.path, spec.path)) return;
      replaced = true; renameSync(path, displaced);
      writeFileSync(path, spec.bytes, { mode: spec.mode }); chmodSync(path, spec.mode);
    },
  });
  assert.equal(replaced, true);
  assert.equal(entries.find(({ key }) => key === 'hook.pre-commit').ok, false);
});

test('runtime installation refuses a replaced digest root before publishing files', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-runtime-root-race-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const selected = describeHookRuntime(root, { sourceRoot: ROOT });
  const displaced = join(root, 'displaced-runtime');
  assert.throws(() => installHookRuntime(selected, {
    beforeWrite: () => {
      renameSync(selected.path, displaced); mkdirSync(selected.path, { mode: 0o700 });
    },
  }), (error) => error.reason === 'blocked-hook-runtime-integrity');
  assert.deepEqual(readdirSync(selected.path), []);
  assert.deepEqual(readdirSync(displaced), []);
});
