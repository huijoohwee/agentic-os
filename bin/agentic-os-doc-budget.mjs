#!/usr/bin/env node
/**
 * Always-loaded documentation budget in bytes.
 *
 * A line cap gets gamed: 600 lines of 3,000-character paragraphs reports
 * compliance while costing 97 KB of context. Tokens track bytes, so the budget
 * tracks bytes, plus a line length cap to keep diffs reviewable.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(HERE, '..');

export const BUDGET = Object.freeze({
  agentsFileBytes: 4 * 1024,
  perDocBytes: 12 * 1024,
  alwaysLoadBytes: 40 * 1024,
  maxLineChars: 120,
});

export function alwaysLoadFiles(root = ROOT) {
  const files = [join(root, 'AGENTS.md')];
  const docs = join(root, 'docs');
  for (const name of readdirSync(docs).sort()) {
    if (name.endsWith('.md')) files.push(join(docs, name));
  }
  return files;
}

export function measure(root = ROOT) {
  const files = alwaysLoadFiles(root);
  const entries = files.map((file) => {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    let longest = 0;
    let longestLine = 0;
    lines.forEach((line, index) => {
      if (line.length > longest) {
        longest = line.length;
        longestLine = index + 1;
      }
    });
    return {
      path: relative(root, file),
      bytes: statSync(file).size,
      lines: lines.length,
      longest,
      longestLine,
    };
  });
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return { entries, total };
}

export function violations(root = ROOT) {
  const { entries, total } = measure(root);
  const found = [];

  for (const entry of entries) {
    const cap = entry.path === 'AGENTS.md' ? BUDGET.agentsFileBytes : BUDGET.perDocBytes;
    if (entry.bytes > cap) {
      found.push({
        kind: 'file-bytes',
        path: entry.path,
        measured: entry.bytes,
        cap,
        hint: 'move on-demand detail into a document that loads only when needed',
      });
    }
    if (entry.longest > BUDGET.maxLineChars) {
      found.push({
        kind: 'line-length',
        path: `${entry.path}:${entry.longestLine}`,
        measured: entry.longest,
        cap: BUDGET.maxLineChars,
        hint: 'wrap the line; long lines are how a line budget gets gamed',
      });
    }
  }

  if (total > BUDGET.alwaysLoadBytes) {
    found.push({
      kind: 'always-load-total',
      path: 'AGENTS.md + docs/',
      measured: total,
      cap: BUDGET.alwaysLoadBytes,
      hint: 'delete guidance with no repeated-error evidence behind it',
    });
  }

  return { found, total, entries };
}

function report() {
  const { found, total, entries } = violations();
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

  for (const entry of entries) {
    const cap = entry.path === 'AGENTS.md' ? BUDGET.agentsFileBytes : BUDGET.perDocBytes;
    const mark = entry.bytes > cap || entry.longest > BUDGET.maxLineChars ? 'FAIL' : 'ok  ';
    process.stdout.write(
      `${mark} ${entry.path.padEnd(24)} ${kb(entry.bytes).padStart(9)} / ${kb(cap)}` +
        `  longest line ${String(entry.longest).padStart(3)}\n`,
    );
  }
  const totalMark = total > BUDGET.alwaysLoadBytes ? 'FAIL' : 'ok  ';
  process.stdout.write(
    `${totalMark} ${'always-load total'.padEnd(24)} ${kb(total).padStart(9)} / ` +
      `${kb(BUDGET.alwaysLoadBytes)}  (~${Math.round(total / 4)} tokens)\n`,
  );

  if (found.length === 0) return 0;
  process.stdout.write('\ndoc budget violations:\n');
  for (const item of found) {
    process.stdout.write(`  ${item.kind}: ${item.path} = ${item.measured} > ${item.cap}\n`);
    process.stdout.write(`    ${item.hint}\n`);
  }
  process.stdout.write('\nRaising a cap requires a written reason in the same commit.\n');
  return 1;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  process.exit(report());
}
