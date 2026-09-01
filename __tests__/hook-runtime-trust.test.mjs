import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  assertPriorManagedRuntime, describeHookRuntime, inspectHookRuntime, installHookRuntime,
} from '../bin/agentic-os-hook-runtime.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('a self-consistent but release-unpinned prior runtime cannot authorize migration', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-runtime-trust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const selected = describeHookRuntime(root, { sourceRoot: ROOT });
  const altered = selected.files.map((file, index) => {
    const bytes = index === 0 ? Buffer.concat([file.bytes, Buffer.from('\n')]) : file.bytes;
    return { path: file.path, mode: file.mode, sha256: digest(bytes), bytes };
  });
  const identity = { schema: 'agentic-os/hook-runtime/v1',
    files: altered.map(({ path, mode, sha256 }) => ({ path, mode, sha256 })) };
  const runtimeId = `v1-${digest(Buffer.from(JSON.stringify(identity)))}`;
  const manifest = { schema: identity.schema, runtimeId, files: identity.files };
  const path = join(selected.managedRoot, runtimeId);
  mkdirSync(join(path, '.githooks'), { recursive: true });
  chmodSync(path, 0o700);
  mkdirSync(join(path, 'bin'));
  mkdirSync(join(path, 'src'));
  for (const file of altered) {
    const target = join(path, file.path);
    writeFileSync(target, file.bytes, { mode: file.mode });
    chmodSync(target, file.mode);
  }
  const manifestPath = join(path, 'runtime-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);

  assert.throws(
    () => assertPriorManagedRuntime(join(path, '.githooks'), selected),
    (error) => error.reason === 'blocked-hook-runtime-integrity'
      && /not release-pinned/u.test(error.message),
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
