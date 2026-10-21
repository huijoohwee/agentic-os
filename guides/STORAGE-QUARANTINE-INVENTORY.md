---
title: Exact quarantine inventory
doc_type: "PRD-TAD-ADR-MVP-GTM"
owner: "agentic-os"
continuity_id: "STORAGE-001"
prd_revision: "1.6.0"
tad_revision: "1.6.0"
adr_revision: "1.6.0"
load_policy: on-demand
version: "1.6.0"
date: "2026-10-14"
lang: "en-US"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-0232231d4a19--quarantine-inventory"
agent_id: "codex-quarantine-inventory"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/\
  guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "0a62aae2c1d6dd60a1ac75164fad415dde4f809f"
mvp_revision: "1.6.0"
gtm_revision: "1.6.0"
---

# Exact quarantine inventory

[Storage](STORAGE.md) owns the common report and all effects. This on-demand recipe helps
prioritize exact quarantine records without walking or opening their projection data.

## PRD — STORAGE-001@1.6.0

An exact deep storage scan can spend its entry budget inside the first large quarantine projection,
leaving later coordinates unmeasured and hash-named directories classified as `other`. Operators need a
cheap way to prioritize exact records before running the existing owner plan. Recorded manifest size is
historical logical size; current allocation, duplicate content and freed volume space remain unknown.

## TAD

Run this bounded read-only recipe with Node.js and Git from the `agentic-os` checkout. Pass the target
repository path; it resolves linked worktrees to their shared Git common directory.

```sh
inventory_file=$(mktemp "${TMPDIR:-/tmp}/quarantine-inventory.XXXXXX")
node --input-type=module - /absolute/repository > "$inventory_file" <<'NODE'
import { execFileSync } from 'node:child_process';
import { constants, fstatSync, lstatSync, openSync, opendirSync, readFileSync, closeSync,
  realpathSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const started = performance.now(), deadline = started + 2000, maxRows = 256, maxBytes = 4 * 1024 * 1024;
const root = realpathSync(process.argv[2]);
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_INDEX_FILE', 'GIT_SHALLOW_FILE'])
  if (process.env[key]) throw Error('git-environment-override');
const common = realpathSync(execFileSync('git', ['--no-optional-locks', 'rev-parse',
  '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 2000,
  maxBuffer: 16384 }).trim());
const store = join(common, 'agentic-os-cleanup-quarantine'), rows = [], reasons = new Set();
const same = (a, b) => ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
  .every(key => a[key] === b[key]);
let metadataBytesRead = 0, discoveryComplete = true, directoryReads = 0;
const marker = path => {
  const value = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (!value) return false;
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n || value.size > 65536n)
    throw Error('unsafe-marker');
  return true;
};
const readOperation = path => {
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 65536n)
    throw Error('unsafe-operation');
  if (metadataBytesRead + Number(before.size) > maxBytes) throw Error('metadata-budget');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!same(before, opened)) throw Error('operation-changed');
    const bytes = readFileSync(fd);
    metadataBytesRead += bytes.length;
    const after = fstatSync(fd, { bigint: true });
    if (!same(opened, after) || !same(after, lstatSync(path, { bigint: true })))
      throw Error('operation-changed');
    return JSON.parse(bytes.toString('utf8'));
  } finally { closeSync(fd); }
};

const container = lstatSync(store, { bigint: true, throwIfNoEntry: false });
if (container) {
  if (!container.isDirectory() || container.isSymbolicLink() || realpathSync(store) !== store)
    throw Error('unsafe-container');
  const names = [], stream = opendirSync(store);
  try {
    for (;;) {
      if (performance.now() >= deadline) { reasons.add('time-budget'); discoveryComplete = false; break; }
      directoryReads++;
      const entry = stream.readSync();
      if (!entry) break;
      if (names.length === maxRows) { reasons.add('coordinate-budget'); discoveryComplete = false; break; }
      names.push(entry.name);
    }
  } finally { stream.closeSync(); }
  names.sort();
  for (const coordinate of names) {
    if (performance.now() >= deadline) { reasons.add('time-budget'); discoveryComplete = false; break; }
    if (!/^[a-f0-9]{64}$/.test(coordinate)) {
      rows.push({ coordinate, status: 'unrecognized-entry' }); reasons.add('unrecognized-entry'); continue;
    }
    try {
      const folder = join(store, coordinate), before = lstatSync(folder, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink() || realpathSync(folder) !== folder)
        throw Error('unsafe-coordinate');
      const operation = readOperation(join(folder, 'operation.json')), e = operation.eligibility;
      const digestKey = ({ 'agentic-os/worktree-cleanup-eligibility/v1': 'cleanupPlanDigest',
        'agentic-os/user-cleanup-eligibility/v1': 'planDigest',
        'agentic-os/empty-active-lane-retirement-eligibility/v1': 'planDigest',
        'local-owner-authorized-quarantine-eligibility/v1': 'planDigest' })[e?.schema]
        ?? (e?.schema === undefined ? 'cleanupPlanDigest' : null);
      const manifest = e.projectionManifest ?? e, bytes = manifest.bytes ?? manifest.projectionBytes;
      const entries = manifest.entries ?? manifest.projectionEntries;
      const manifestDigest = manifest.digest ?? manifest.projectionManifestDigest ?? '';
      if (operation.schema !== 'agentic-os/worktree-quarantine-operation/v1' || !digestKey
        || e[digestKey] !== coordinate || !/^[a-f0-9]{64}$/.test(manifestDigest)
        || !Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(entries) || entries < 0)
        throw Error('invalid-operation');
      const receipt = marker(join(folder, 'retirement.json'));
      const intent = marker(join(folder, 'retirement.intent.json'));
      const projection = join(folder, 'projection'), p = lstatSync(projection, { bigint: true, throwIfNoEntry: false });
      if (p && (!p.isDirectory() || p.isSymbolicLink() || realpathSync(projection) !== projection))
        throw Error('unsafe-projection');
      const projectionPresent = Boolean(p);
      const status = receipt ? (projectionPresent ? 'receipt-with-projection' : 'receipt-present')
        : intent ? (projectionPresent ? 'intent-and-projection-present' : 'intent-without-projection')
          : (projectionPresent ? 'projection-present' : 'projection-missing');
      if (['receipt-with-projection', 'intent-and-projection-present', 'intent-without-projection',
        'projection-missing'].includes(status)) reasons.add(status);
      if (!same(before, lstatSync(folder, { bigint: true }))) throw Error('coordinate-changed');
      rows.push({ coordinate, status, eligibilitySchema: e.schema ?? 'legacy',
        manifestDigest,
        recordedProjectionBytes: bytes, recordedProjectionEntries: entries,
        retirementReceiptPresent: receipt, retirementIntentPresent: intent, projectionPresent });
    } catch (error) {
      rows.push({ coordinate, status: 'incomplete-metadata' });
      const budget = error.message === 'metadata-budget';
      reasons.add(budget ? 'metadata-budget' : 'invalid-metadata');
      if (budget) { discoveryComplete = false; break; }
    }
  }
}
if (container) {
  const after = lstatSync(store, { bigint: true, throwIfNoEntry: false });
  if (!after || !same(container, after)) { reasons.add('container-changed'); discoveryComplete = false; }
}
if (performance.now() >= deadline) { reasons.add('time-budget'); discoveryComplete = false; }
rows.sort((a, b) => (b.recordedProjectionBytes ?? -1) - (a.recordedProjectionBytes ?? -1)
  || a.coordinate.localeCompare(b.coordinate));
console.log(JSON.stringify({ schema: 'agentic-os/quarantine-storage-report/v1', repository: root, common,
  coverage: 'cleanup-quarantine-direct-children',
  status: discoveryComplete && reasons.size === 0 ? 'complete' : 'partial', discoveryComplete,
  measurement: 'recorded-quarantine-projection-manifest', snapshotConsistent: false,
  grantsAuthority: false, reclaimableBytes: null, rows, reasons: [...reasons].sort(),
  cost: { elapsedMs: Math.ceil(performance.now() - started), coordinatesObserved: rows.length,
    directoryReads, metadataBytesRead, contentBytesRead: 0, maxRows, maxMetadataBytes: maxBytes,
    maxMs: 2000, deadlineKind: 'cooperative-between-filesystem-calls' } }, null, 2));
NODE
```

The recipe reads bounded operation metadata and marker inodes, never projection payloads or Git objects.
It inspects at most 256 direct coordinates, reads at most 4 MiB of operation metadata, and uses a
two-second cooperative limit. It writes no repository state. Marker presence does not verify a receipt;
the report grants no authority and sets `reclaimableBytes` to `null`. A chosen coordinate still requires a
fresh exact `cleanup-user retire plan` that revalidates current recovery loss. Existing storage CLI
behavior remains unchanged.

For a smaller cross-repository review, filter the saved JSON to projections that are still present:

```sh
node -e 'const x=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")); const rows=x.rows.filter(r=>r.projectionPresent); console.log(JSON.stringify({status:x.status,discoveryComplete:x.discoveryComplete,projectionPresent:rows.length,rows:rows.map(({coordinate,eligibilitySchema,recordedProjectionBytes,recordedProjectionEntries,status,retirementIntentPresent})=>({coordinate,eligibilitySchema,recordedProjectionBytes,recordedProjectionEntries,status,retirementIntentPresent}))},null,2))' "$inventory_file"
```

The filtered rows are candidates for a fresh owner plan, not deletion recommendations. An incomplete
inventory, an intent marker, an unknown schema or a missing receipt requires preservation and owner
review. The filter reads only the saved metadata report and avoids rescanning the large projections.

## ADR

Use only Node.js/Git built-ins and exact operation records. Receipt/intent markers are hints only; this
recipe makes no eligibility or receipt-validity claim. Unknown, invalid, interrupted, missing and drifted
records stay visible as incomplete rows. No new module, dependency, cache, recursive walk, age policy,
deletion command or lifecycle transition is added. Remove the recipe if it cannot rank coordinates
without implying current physical savings.

## MVP

**AC-S14:** live read-only verification confirms exact-coordinate ranking, marker reporting, incomplete
intent/unrecognized records, zero payload reads and zero mutation. Run the recipe once against a test
repository and one consumer checkout; compare its time/metadata cost with the bounded deep report. Sprint
cap: five changed paths, under 24 KiB of diff, zero new modules/dependencies, zero always-load bytes and
at most 60 active minutes before replan. On measurement or input drift, mark partial; do not raise bounds.

## GTM and handoff

Record elapsed time and metadata bytes per repository before claiming time or storage savings. Recorded
logical sizes only order exact owner decisions. No deployment, cleanup, branch retirement, Git-object
mutation or physical-space claim follows from this recipe. Rollback removes this guide; all quarantine
content and receipts remain intact.
