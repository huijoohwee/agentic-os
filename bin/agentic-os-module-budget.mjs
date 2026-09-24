#!/usr/bin/env node
/**
 * Source-module budget.
 *
 * The cap is the design constraint that keeps new scenarios in the lane state
 * table. A per-scenario quadruple of contract, controller, adapter and evidence
 * module multiplies: 76 scenarios becomes 304 modules and roughly 195k lines,
 * at which point the harness is the product.
 */

import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..');

export const BUDGET = Object.freeze({
  // NATIVE-DESIGN-ENFORCEMENT: one portable policy verifier and one lazy CLI file.
  // Two transport consumers; no lifecycle scenario family or runtime dependency.
  modules: 47,
  totalLines: 15050,
  perModuleLines: 400,
  // 2026-09-22 user-authorized ADLC-EXEC-001: two lazy native owners; no runtime dependencies.
  // 2026-09-22 user-authorized ADLC-EXEC-002: raise bin cap to 23100 for the
  // change-class fast path, stale-ref sweep, and unified cleanup CLI; the new
  // logic lives in existing bin owners (agentic-os-cleanup-user.mjs,
  // agentic-os-completion-scaffold.mjs, agentic-os-completion-status.mjs) and
  // does not add a new agentic-os-*.mjs entry point.
  // 2026-09-23: 33 existing-owner lines batch final trace verification; a
  // matched 20-file run cut median wall 49% and current-process CPU 45%.
  binModules: 111,
  binLines: 23175,
  runtimeModules: 96,
  runtimeLines: 23023,
});

/** Suffix families whose presence means the state table is being bypassed. */
export const FORBIDDEN_SUFFIXES = Object.freeze([
  '-contract.mjs',
  '-controller.mjs',
  '-repository-adapter.mjs',
  '-evidence.mjs',
  '-store.mjs',
]);

function authoredModules(root, directory, suffixes) {
  const dir = join(root, directory), found = [];
  const walk = (current) => {
    for (const name of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, name.name);
      if (name.isDirectory() && name.name !== 'node_modules') walk(path);
      else if (name.isFile() && suffixes.some((suffix) => name.name.endsWith(suffix))) {
        found.push({ name: name.name, path: relative(root, path),
          lines: readFileSync(path, 'utf8').split('\n').length });
      }
    }
  };
  walk(dir);
  return found;
}

export function modules(root = ROOT) {
  const dir = join(root, 'src');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return {
        name,
        path: relative(root, path),
        lines: readFileSync(path, 'utf8').split('\n').length,
      };
    });
}

export function violations(root = ROOT) {
  const entries = modules(root);
  const total = entries.reduce((sum, entry) => sum + entry.lines, 0);
  const found = [];

  if (entries.length > BUDGET.modules) {
    found.push({
      kind: 'module-count',
      path: 'src/',
      measured: entries.length,
      cap: BUDGET.modules,
      hint: 'collapse the new scenario into a row in src/lane-state.mjs',
    });
  }

  if (total > BUDGET.totalLines) {
    found.push({
      kind: 'total-lines',
      path: 'src/',
      measured: total,
      cap: BUDGET.totalLines,
      hint: 'the harness is growing faster than the product it serves',
    });
  }

  for (const entry of entries) {
    if (entry.lines > BUDGET.perModuleLines) {
      found.push({
        kind: 'module-lines',
        path: entry.path,
        measured: entry.lines,
        cap: BUDGET.perModuleLines,
        hint: 'split by responsibility, not by line count',
      });
    }
    const forbidden = FORBIDDEN_SUFFIXES.find((suffix) => entry.name.endsWith(suffix));
    if (forbidden) {
      found.push({
        kind: 'scenario-module',
        path: entry.path,
        measured: forbidden,
        cap: 'none permitted',
        hint: 'a per-scenario module family is what the state table replaced',
      });
    }
  }

  const surfaces = harnessSurfaces(root);
  found.push(...surfaces.bin.found, ...surfaces.runtime.found);
  return { found, entries, total, surfaces };
}

function surfaceViolations(kind, path, entries, moduleCap, lineCap, hint) {
  const total = entries.reduce((sum, entry) => sum + entry.lines, 0), found = [];
  if (entries.length > moduleCap) found.push({ kind: `${kind}-count`, path, measured: entries.length, cap: moduleCap, hint });
  if (total > lineCap) found.push({ kind: `${kind}-lines`, path, measured: total, cap: lineCap, hint });
  return { found, entries, total };
}

export function harnessSurfaces(root = ROOT) {
  const bin = authoredModules(root, 'bin', ['.mjs', '.cjs', '.js']);
  const runtime = authoredModules(root, 'runtime', ['.mjs', '.js']);
  return {
    bin: surfaceViolations('bin', 'bin/', bin, BUDGET.binModules, BUDGET.binLines,
      'CLI growth belongs in an existing owner, not another agentic-os-*.mjs'),
    runtime: surfaceViolations('runtime', 'runtime/', runtime, BUDGET.runtimeModules, BUDGET.runtimeLines,
      'runtime/agents is out of ADLC; freeze modules and fix the owning file'),
  };
}

function report() {
  const { found, entries, total, surfaces } = violations();
  for (const entry of entries) {
    const mark = entry.lines > BUDGET.perModuleLines ? 'FAIL' : 'ok  ';
    process.stdout.write(`${mark} ${entry.path.padEnd(28)} ${String(entry.lines).padStart(4)} lines\n`);
  }
  process.stdout.write(
    `\nmodules ${entries.length}/${BUDGET.modules}   ` +
      `lines ${total}/${BUDGET.totalLines}\n` +
      `bin ${surfaces.bin.entries.length}/${BUDGET.binModules}   ` +
      `lines ${surfaces.bin.total}/${BUDGET.binLines}\n` +
      `runtime ${surfaces.runtime.entries.length}/${BUDGET.runtimeModules}   ` +
      `lines ${surfaces.runtime.total}/${BUDGET.runtimeLines}\n`,
  );

  if (found.length === 0) return 0;
  process.stdout.write('\nmodule budget violations:\n');
  for (const item of found) {
    process.stdout.write(`  ${item.kind}: ${item.path} = ${item.measured} > ${item.cap}\n`);
    process.stdout.write(`    ${item.hint}\n`);
  }
  return 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  process.exit(report());
}
