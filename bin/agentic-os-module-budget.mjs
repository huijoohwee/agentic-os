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
  modules: 46,
  totalLines: 15000,
  perModuleLines: 400,
});

/** Suffix families whose presence means the state table is being bypassed. */
export const FORBIDDEN_SUFFIXES = Object.freeze([
  '-contract.mjs',
  '-controller.mjs',
  '-repository-adapter.mjs',
  '-evidence.mjs',
  '-store.mjs',
]);

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

  return { found, entries, total };
}

function report() {
  const { found, entries, total } = violations();
  for (const entry of entries) {
    const mark = entry.lines > BUDGET.perModuleLines ? 'FAIL' : 'ok  ';
    process.stdout.write(`${mark} ${entry.path.padEnd(28)} ${String(entry.lines).padStart(4)} lines\n`);
  }
  process.stdout.write(
    `\nmodules ${entries.length}/${BUDGET.modules}   ` +
      `lines ${total}/${BUDGET.totalLines}\n`,
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
