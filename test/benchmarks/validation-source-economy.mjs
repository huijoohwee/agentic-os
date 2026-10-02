/** Opt-in local source-scan measurement; no check, CI, release or spending authority. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { consumerSnapshotReader } from '../../bin/agentic-os-validation-inputs.mjs';

const options = { samples: 5, base: 'HEAD' };
const seen = new Set();
for (const arg of process.argv.slice(2)) {
  const match = /^--(root|base|samples)=(.+)$/u.exec(arg);
  if (!match || seen.has(match[1])) throw Error('expected unique root, base or samples option');
  seen.add(match[1]); options[match[1]] = match[2];
}
const samples = Number(options.samples);
if (!Number.isInteger(samples) || samples < 1 || samples > 7) throw Error('samples must be 1..7');
const readerPath = fileURLToPath(new URL('../../bin/agentic-os-validation-inputs.mjs', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const chunkBytes = 256 * 1024;
let ownedRoot;
try {
  let root;
  if (options.root) root = realpathSync(resolve(options.root));
  else {
    root = ownedRoot = realpathSync(mkdtempSync(join(tmpdir(), 'validation-source-benchmark-')));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '-q', '-b', 'main'); git('config', 'maintenance.auto', 'false'); git('config', 'gc.auto', '0');
    mkdirSync(join(root, 'source'));
    for (let i = 0; i < 2048; i++) writeFileSync(join(root, 'source', `file-${i}.txt`), `source ${i}\n`.padEnd(128, '.'));
    for (let i = 0; i < 8; i++) writeFileSync(join(root, 'source', `binary-${i}.bin`), Buffer.alloc(chunkBytes * 2 + 13, i));
    git('add', '.'); git('-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '-qm', 'fixture');
  }
  function measure(observe) {
    const original = Buffer.alloc, cpuBefore = process.cpuUsage(), rssBeforeBytes = process.memoryUsage().rss;
    let streamAllocations = 0;
    Buffer.alloc = function (size, ...args) {
      if (size === chunkBytes) streamAllocations++;
      return original.call(this, size, ...args);
    };
    const started = performance.now(); let snapshot;
    try { snapshot = observe(); } finally { Buffer.alloc = original; }
    const elapsedMs = performance.now() - started, cpu = process.cpuUsage(cpuBefore);
    return { elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000, streamAllocations,
      allocatedStreamBytes: streamAllocations * chunkBytes, files: snapshot.after.size,
      observedSourceBytes: snapshot.observedBytes, sourceDigest: snapshot.identity.sourceDigest,
      rssBeforeBytes, rssAfterBytes: process.memoryUsage().rss };
  }
  const records = [];
  for (let sample = 0; sample < samples; sample++) {
    const observe = consumerSnapshotReader({ root, base: options.base });
    records.push({ sample, cold: measure(observe), warm: measure(observe) });
  }
  const observations = records.flatMap(record => [record.cold, record.warm]);
  if (new Set(observations.map(value => value.sourceDigest)).size !== 1) throw Error('benchmark source drift');
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = phase => Object.fromEntries(['elapsedMs', 'cpuMs', 'streamAllocations', 'allocatedStreamBytes']
    .map(key => [key, median(records.map(record => record[phase][key]))]));
  console.log(JSON.stringify({ schema: 'agentic-os/validation-source-benchmark/v1', authority: false,
    readerDigest: digest(readFileSync(readerPath)), node: process.version, platform: process.platform,
    arch: process.arch, source: { files: observations[0].files, bytes: observations[0].observedSourceBytes,
      digest: observations[0].sourceDigest, fixture: Boolean(ownedRoot) }, samples,
    measurement: 'Reader wall time, Node process CPU and 256 KiB Buffer.alloc calls; RSS snapshots include fixture and preceding samples. No full-suite or cash savings inferred.',
    medians: { cold: summary('cold'), warm: summary('warm') }, records }, null, 2));
} finally { if (ownedRoot) rmSync(ownedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
