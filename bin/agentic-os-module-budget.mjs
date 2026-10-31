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
  // 2026-10-10: bounded GitHub REST fallback preserves source-bound review observation during GraphQL quota exhaustion.
  // The source-evidence CLI and contract add one CLI and one runtime module; both remain lazy and provider-neutral.
  // 2026-10-12: T06 receipts (+29 src/+37 bin) and bounded ancestry (+40 src, zero modules; 25/page ×16; ≤256 KiB/page).
  // 2026-10-13: exact PR/ref/merge-tree refresh adds 236 lines to the existing owner; no module, dependency or always-load delta.
  // 2026-10-17 ADLC-START-LOCK-001: one lazy recovery owner; keep filesystem recovery off every CLI invocation.
  // 2026-10-17 STORAGE-001: +52 existing-owner lines revalidate lock inputs and a staged dependency copy after HEAD-only movement; 2026-10-18 selected-source proof adds 23 src/43 bin lines to bind non-ancestral recovery to exact journals and refs, with no new module, dependency or runtime delta.
  // 2026-10-18: +34 existing-owner lines bind a replaced successor handoff to its exact retained predecessor, remote ref, transplant journal and source ancestry; 2026-10-19 cross-base readmission adds +9 src/+9 bin lines for exact old-base/head ancestry and immutable allocation pins; no new module or dependency.
  // 2026-10-19: one effect-cost owner validates scoped provider evidence before authority (+174 src lines).
  // 2026-10-21 ADLC-CLOSEOUT-001: +42 existing bin lines for lane-safe read-only closeout; reduce command switching without changing effect authority.
  // 2026-10-26 END-ADLC-SIMPLIFY-001: +68 src/+39 bin lines add exact selection, bounded cleanup and read-only closeout projection in existing owners.
  // 2026-10-27 FLEET-01.10: +52 src/+31 bin lines enforce canonical checkout naming in existing owners; no module or dependency growth; refresh release pins. 2026-10-31: +137 existing-owner CLI lines admit exact detached-main snapshot quarantine; no module, dependency, provider or deployment authority.
  modules: 51,
  totalLines: 16161,
  perModuleLines: 450,
  // 2026-09-22 user-authorized ADLC-EXEC-001: two lazy native owners; no runtime dependencies.
  // 2026-09-22 user-authorized ADLC-EXEC-002: raise bin cap to 23100 for the
  // change-class fast path, stale-ref sweep, and unified cleanup CLI; the new
  // logic lives in existing bin owners (agentic-os-cleanup-user.mjs,
  // agentic-os-completion-scaffold.mjs, agentic-os-completion-status.mjs) and
  // does not add a new agentic-os-*.mjs entry point.
  // 2026-09-23: 33 existing-owner lines batch final trace verification; a
  // matched 20-file run cut median wall 49% and current-process CPU 45%.
  // 2026-10-07 E18: +72 native auto-merge lines in existing completion owner; no module added.
  // 2026-10-07 reservation release: +131 source and +14 CLI lines in existing owners; no module/dependency.
  // 2026-10-07 cleanup batching (+33) and lane recovery (+183 existing-owner lines): exact local refs/dirty bytes, no provider authority, module or dependency increase.
  binModules: 113,
  binLines: 24856,
  runtimeModules: 97,
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
