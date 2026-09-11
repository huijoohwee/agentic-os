/** Local recovery catalog and verified relocation. No background work or retention deletion. */
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { acquireOperationLock, finishOperationLock } from '../src/git.mjs';
import { acquireDirectoryLock } from '../src/file-integrity.mjs';
import { boundedDirectoryEntries, readBoundedStableFile } from '../src/cleanup-manifest.mjs';
import { MAX_OUTPUT, hash, digest, fail, same, direct, command, git, location, allocated,
  storageManifest, privateDirectory, flushDirectory, durableJson, flushTree } from './agentic-os-storage-files.mjs';

const HEX = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9-]{36}$/u, RECORD_LIMIT = 512000;
const PLAN_SCHEMA = 'agentic-os/recovery-plan/v1';
const STORE_SCHEMA = 'agentic-os/recovery-store/v1';
const CONFIG_SCHEMA = 'agentic-os/recovery-location/v1';
const RECORD_SCHEMA = 'agentic-os/recovery-record/v1';
export const RECOVERY_KINDS = ['recovery-relocation', 'recovery-restore'];
const present = path => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
const jsonBytes = path => readBoundedStableFile(path, RECORD_LIMIT, 'recovery-record').toString('utf8');
const readJson = path => JSON.parse(jsonBytes(path));
const within = (path, root) => path === root || path.startsWith(`${root}/`);
const nodeIdentity = path => { const s = lstatSync(path); return { dev: s.dev, ino: s.ino }; };
const id = value => { if (!HEX.test(value ?? '')) fail('recovery-operation-id'); return value; };

function absolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0'))
    fail('recovery-absolute-path');
  direct(dirname(path)); return path;
}
// A store inside a checkout must be excluded already, including every future payload path.
function excluded(path) {
  absolute(path);
  if (path.split('/').includes('.git')) fail('recovery-store-location');
  let root;
  try { root = git(dirname(path), ['rev-parse', '--show-toplevel']).trim(); }
  catch (error) {
    if (error.status === 128 && /not a git repository/u.test(String(error.stderr))) return;
    throw error;
  }
  if (!within(path, root) || path === root || relative(root, path).split('/').includes('.git'))
    fail('recovery-store-location');
  const rel = relative(root, path);
  if (git(root, ['--literal-pathspecs', 'ls-files', '-z', '--', rel])) fail('recovery-store-tracked');
  try { git(root, ['check-ignore', '--no-index', '--quiet', '--', `${rel}/`]); }
  catch { fail('recovery-store-not-ignored'); }
}
function withLock(lock, label, run) {
  if (!lock) fail('busy');
  let result, error;
  try { result = run(); } catch (caught) { error = caught; }
  return finishOperationLock(lock, { label, result, error });
}
function privateExisting(path) {
  direct(path);
  if (lstatSync(path).mode & 0o077) fail('private-directory');
  return path;
}
function storeRoot(path) {
  excluded(path); privateExisting(path);
  const descriptor = readJson(join(path, 'store.json'));
  if (descriptor.schema !== STORE_SCHEMA || !UUID.test(descriptor.storeId ?? '')
    || descriptor.retention !== 'hold' || descriptor.automaticDeletion !== false) fail('recovery-store-descriptor');
  for (const name of ['payloads', 'records', 'staging']) privateExisting(join(path, name));
  return { path, ...nodeIdentity(path), storeId: descriptor.storeId };
}
function initializeStore(path) {
  excluded(path);
  if (!present(path)) { mkdirSync(path, { mode: 0o700 }); flushDirectory(dirname(path)); }
  privateDirectory(path);
  if (!present(join(path, 'store.json'))) {
    if (readdirSync(path).length) fail('recovery-store-unrecognized');
    durableJson(join(path, 'store.json'), { schema: STORE_SCHEMA, storeId: randomUUID(),
      retention: 'hold', automaticDeletion: false, createdAt: new Date().toISOString() });
    for (const name of ['payloads', 'records', 'staging']) privateDirectory(join(path, name));
  }
  return storeRoot(path);
}
function configuration(common) {
  const value = readJson(join(direct(join(common, 'agentic-os-storage')), 'store.json'));
  if (value.schema !== CONFIG_SCHEMA || !UUID.test(value.cloneId ?? '') || !UUID.test(value.storeId ?? '')
    || typeof value.store !== 'string') fail('recovery-configuration');
  return value;
}
export function configureRecovery({ cwd, store }) {
  const where = location(cwd);
  return withLock(acquireOperationLock('agentic-os-worktree-cleanup', where.root), 'recovery-configure', () => {
    const parent = privateDirectory(join(where.common, 'agentic-os-storage')), configPath = join(parent, 'store.json');
    if (present(configPath)) {
      const config = configuration(where.common), root = storeRoot(config.store);
      if (store !== config.store || config.storeId !== root.storeId) fail('recovery-configuration-conflict');
      return { ...config, configPath, replayed: true };
    }
    const root = initializeStore(store);
    const config = { schema: CONFIG_SCHEMA, store: root.path, storeId: root.storeId, cloneId: randomUUID() };
    durableJson(configPath, config); return { ...config, configPath };
  });
}
function selectedStore(common, requested) {
  const config = configuration(common);
  if (requested !== undefined && requested !== config.store) fail('recovery-configuration-conflict');
  const store = storeRoot(config.store);
  if (store.storeId !== config.storeId) fail('recovery-store-replaced');
  return { ...store, cloneId: config.cloneId };
}
function completed(common, operation) {
  const directory = direct(join(direct(join(common, 'agentic-os-storage')), id(operation)));
  const evidence = { plan: jsonBytes(join(directory, 'plan.json')), receipt: jsonBytes(join(directory, 'receipt.json')) };
  const plan = JSON.parse(evidence.plan), receipt = JSON.parse(evidence.receipt), { planDigest, ...draft } = plan;
  if (plan.schema !== 'agentic-os/storage-plan/v1' || planDigest !== operation || digest(draft) !== operation
    || plan.common !== common || receipt.schema !== 'agentic-os/storage-receipt/v1'
    || receipt.planDigest !== operation || receipt.kind !== plan.kind || receipt.target !== plan.target
    || typeof receipt.completedAt !== 'string' || !Number.isFinite(Date.parse(receipt.completedAt)))
    fail('recovery-completion-binding');
  let source;
  if (plan.kind === 'git' && receipt.backupDirectory === join(directory, 'recovery')
    && receipt.objectIdsPreserved === true && receipt.refsPreserved === true && receipt.reflogsPreserved === true) {
    source = join(directory, 'recovery'); evidence.proof = jsonBytes(join(directory, 'backup.json'));
    const proof = JSON.parse(evidence.proof);
    if (!/^objects-[a-f0-9]{40}(?:[a-f0-9]{24})?\.pack$/u.test(basename(proof.pack ?? ''))
      || proof.pack !== join(source, basename(proof.pack)) || proof.index !== proof.pack.replace(/\.pack$/u, '.idx')
      || proof.objectDigest !== plan.before.objectDigest || proof.objectCount !== plan.before.objectCount)
      fail('recovery-pack-binding');
  } else if (plan.kind === 'artifact-archive' && receipt.archived === true && receipt.contentPreserved === true
    && receipt.backupDirectory === directory) {
    source = join(directory, 'artifact.tar.gz'); evidence.proof = jsonBytes(join(directory, 'verified.json'));
    const proof = JSON.parse(evidence.proof);
    if (proof.archive !== source || !same(proof.manifest, plan.before.artifactManifest)) fail('recovery-archive-binding');
  } else fail('recovery-no-completed-payload');
  return { directory, source, kind: plan.kind, operation, evidence, evidenceDigest: digest(evidence) };
}
function recordId(store, operation) { return digest([store.storeId, store.cloneId, operation]); }
function readRecord(store, operation) {
  const key = recordId(store, operation), record = readJson(join(store.path, 'records', `${key}.json`));
  if (record.schema !== RECORD_SCHEMA || record.recordId !== key || record.storeId !== store.storeId
    || record.cloneId !== store.cloneId || record.operation !== operation || !HEX.test(record.manifest?.digest ?? '')
    || record.payload !== `payloads/${digest(record.manifest)}` || record.retention !== 'hold'
    || record.automaticDeletion !== false || digest(record.evidence) !== record.evidenceDigest) fail('recovery-record-binding');
  return record;
}
function assertRecord(record, origin) {
  if (record.source !== origin.source || record.kind !== origin.kind || !same(record.evidence, origin.evidence))
    fail('recovery-record-drift');
}
function payloadPath(store, record) { return join(direct(join(store.path, 'payloads')), basename(record.payload)); }
function verifyPayload(path, manifest) {
  if (!same(storageManifest(path), manifest)) fail('recovery-payload-drift');
}
function copyPayload(source, target, cwd) {
  if (present(target)) fail('recovery-copy-target-exists');
  if (process.platform === 'darwin')
    command('/usr/bin/ditto', ['--hfsCompression', '--noclone', '--rsrc', '--extattr', '--acl', source, target], cwd);
  else command('cp', ['-a', '--', source, target], cwd);
  flushTree(target); flushDirectory(dirname(target));
}
// Restore the original payload, including all Git metadata, and verify its native format too.
function verifyNative(path, origin, temporary) {
  const plan = JSON.parse(origin.evidence.plan), proof = JSON.parse(origin.evidence.proof);
  if (origin.kind === 'git') {
    direct(path);
    const index = join(path, basename(proof.index));
    git(origin.directory, ['verify-pack', index]);
    const objects = git(origin.directory, ['show-index'], {
      input: readBoundedStableFile(index, MAX_OUTPUT, 'recovery-pack-index'),
    }).trim().split('\n').filter(Boolean).map(line => line.split(' ')[1]).sort();
    if (objects.length > 500000 || objects.length !== proof.objectCount || digest(objects) !== proof.objectDigest)
      fail('recovery-object-coverage');
    return { format: 'git-pack', objectCount: objects.length, objectDigest: proof.objectDigest };
  }
  const top = basename(plan.target);
  const listing = command('tar', ['-tzf', path], origin.directory).trimEnd().split('\n');
  if (!listing.length || listing.length > 100000 || listing.some(name => name !== top && !name.startsWith(`${top}/`)
    || name.split('/').includes('..') || name.includes('\r') || name.includes('\\')))
    fail('recovery-archive-paths');
  privateDirectory(temporary);
  command('tar', ['-xzpf', path, '-C', temporary], origin.directory);
  if (readdirSync(temporary).some(name => name !== top)
    || !same(storageManifest(join(temporary, top)), proof.manifest)) fail('recovery-extraction-mismatch');
  rmSync(temporary, { recursive: true }); flushDirectory(dirname(temporary));
  return { format: 'tar-gzip', restoredManifest: proof.manifest };
}
function room(path, bytes) {
  const space = statfsSync(path);
  if (space.bavail * space.bsize < bytes + 16 * 1024 * 1024) fail('recovery-insufficient-space');
}
function basePlan({ cwd, kind, operation, store, destination }, now) {
  if (!RECOVERY_KINDS.includes(kind)) fail('recovery-kind');
  const where = location(cwd), origin = completed(where.common, operation), selected = selectedStore(where.common, store);
  if (within(selected.path, where.common) || within(where.common, selected.path)) fail('recovery-store-overlap');
  let manifest, recordDigest = null;
  if (kind === 'recovery-relocation') {
    if (destination !== undefined) fail('arguments');
    if (present(join(origin.directory, 'relocation.json'))) fail('recovery-already-relocated');
    const stat = lstatSync(origin.source);
    if (stat.isSymbolicLink() || !(origin.kind === 'git' ? stat.isDirectory() : stat.isFile()))
      fail('recovery-source-type');
    manifest = storageManifest(origin.source);
  } else {
    absolute(destination); excluded(destination);
    if (present(destination) || within(destination, selected.path) || within(destination, where.common))
      fail('recovery-restore-destination');
    const record = readRecord(selected, operation); assertRecord(record, origin);
    manifest = record.manifest; recordDigest = digest(record); verifyPayload(payloadPath(selected, record), manifest);
  }
  return { schema: PLAN_SCHEMA, ...where, kind, operation, store: selected,
    source: origin.source, evidenceDigest: origin.evidenceDigest, manifest, recordDigest,
    destination: destination ?? null, issuedAt: now, expiresAt: now + 3600000 };
}
export function planRecovery(options, now = Date.now()) {
  const draft = basePlan(options, now); return { ...draft, planDigest: digest(draft) };
}
function validate(plan, options) {
  const { planDigest, ...draft } = plan;
  if (plan.schema !== PLAN_SCHEMA || !HEX.test(planDigest ?? '') || digest(draft) !== planDigest
    || Object.keys(plan).sort().join(',') !== 'common,destination,evidenceDigest,expiresAt,issuedAt,kind,manifest,operation,planDigest,recordDigest,root,schema,source,store'
    || !RECOVERY_KINDS.includes(plan.kind) || !Number.isSafeInteger(plan.issuedAt)
    || plan.expiresAt !== plan.issuedAt + 3600000) fail('recovery-plan-binding');
  if (options.authorization !== `agentic-os:storage:${planDigest}` || options.stopped !== true
    || typeof options.resume !== 'boolean') fail('authorization');
  const where = location(plan.root), store = selectedStore(where.common, plan.store.path);
  if (where.common !== plan.common || where.root !== plan.root || !same(store, plan.store)) fail('recovery-location-drift');
  const origin = completed(plan.common, plan.operation);
  if (origin.source !== plan.source || origin.evidenceDigest !== plan.evidenceDigest) fail('recovery-source-drift');
  return { store, origin };
}
function relocationPointer(plan, record) {
  return { schema: 'agentic-os/recovery-relocation/v1', planDigest: plan.planDigest, store: plan.store.path,
    storeId: plan.store.storeId, recordId: record.recordId, payload: record.payload,
    manifest: record.manifest, source: plan.source, retention: 'hold' };
}
function relocate(plan, store, origin, { resume, progress }) {
  const journal = join(origin.directory, 'relocation-plan.json'), pointerPath = join(origin.directory, 'relocation.json');
  const recordPath = join(store.path, 'records', `${recordId(store, plan.operation)}.json`);
  const payload = join(store.path, 'payloads', digest(plan.manifest)), stage = join(store.path, 'staging', plan.planDigest);
  if (present(journal)) {
    if (!same(readJson(journal), plan)) fail('recovery-journal-drift');
    if (!resume && !present(pointerPath)) fail('partial-operation-retained');
  } else {
    if (resume || present(pointerPath) || present(recordPath) || present(stage)) fail('recovery-resume-phase');
    verifyPayload(origin.source, plan.manifest); durableJson(journal, plan);
  }
  let record;
  if (present(recordPath)) {
    record = readRecord(store, plan.operation); assertRecord(record, origin);
    if (record.planDigest !== plan.planDigest || !same(record.manifest, plan.manifest)) fail('recovery-record-drift');
    verifyPayload(payload, plan.manifest);
  } else {
    if (present(stage)) fail('partial-operation-retained');
    const originalPlan = JSON.parse(origin.evidence.plan);
    room(store.path, plan.manifest.bytes + (originalPlan.before.artifactManifest?.bytes ?? 0));
    privateDirectory(stage);
    const candidate = join(stage, 'payload');
    progress('Copying completed recovery payload to the configured private store.');
    verifyPayload(origin.source, plan.manifest);
    copyPayload(origin.source, candidate, origin.directory); verifyPayload(candidate, plan.manifest);
    const verification = verifyNative(candidate, origin, join(stage, 'extraction'));
    progress('Recovery copy and native restoration verified; publishing its catalog record.');
    verifyPayload(origin.source, plan.manifest);
    if (present(payload)) { verifyPayload(payload, plan.manifest); rmSync(candidate, { recursive: true }); }
    else { renameSync(candidate, payload); flushDirectory(dirname(payload)); }
    record = { schema: RECORD_SCHEMA, recordId: recordId(store, plan.operation), storeId: store.storeId,
      cloneId: store.cloneId, operation: plan.operation, kind: origin.kind, source: origin.source,
      repository: plan.root, payload: relative(store.path, payload), manifest: plan.manifest,
      evidence: origin.evidence, evidenceDigest: origin.evidenceDigest, planDigest: plan.planDigest,
      sourceAllocatedBytes: allocated(origin.source), payloadAllocatedBytes: allocated(payload),
      verification, verifiedAt: new Date().toISOString(), retention: 'hold', automaticDeletion: false };
    durableJson(recordPath, record);
  }
  const pointer = relocationPointer(plan, record);
  if (present(pointerPath)) {
    if (!same(readJson(pointerPath), pointer) || present(origin.source)) fail('recovery-replay-drift');
    return { ...pointer, replayed: true, recordPath };
  }
  progress('Catalog is durable; rechecking both copies before removing the original payload.');
  if (present(origin.source)) {
    if (completed(plan.common, plan.operation).evidenceDigest !== plan.evidenceDigest) fail('recovery-source-drift');
    verifyPayload(payload, plan.manifest); verifyPayload(origin.source, plan.manifest);
    rmSync(origin.source, { recursive: true }); flushDirectory(origin.directory);
  } else if (!resume) fail('recovery-original-missing');
  durableJson(pointerPath, pointer);
  if (present(stage) && readdirSync(direct(stage)).length === 0) {
    rmSync(stage, { recursive: true }); flushDirectory(dirname(stage));
  }
  return { ...pointer, recordPath, sourceRemoved: true,
    sourceAllocatedBytes: record.sourceAllocatedBytes, retainedAllocatedBytes: record.payloadAllocatedBytes,
    netBytesReclaimed: record.sourceAllocatedBytes - record.payloadAllocatedBytes };
}
function restore(plan, store, origin, { resume, progress }) {
  if (resume) fail('recovery-restore-resume-unsupported');
  const record = readRecord(store, plan.operation); assertRecord(record, origin);
  if (digest(record) !== plan.recordDigest || !same(record.manifest, plan.manifest)) fail('recovery-record-drift');
  absolute(plan.destination); excluded(plan.destination);
  if (present(plan.destination) || within(plan.destination, store.path) || within(plan.destination, plan.common))
    fail('recovery-restore-destination');
  const source = payloadPath(store, record); verifyPayload(source, plan.manifest);
  room(dirname(plan.destination), plan.manifest.bytes + (JSON.parse(origin.evidence.plan).before.artifactManifest?.bytes ?? 0));
  mkdirSync(plan.destination, { mode: 0o700 }); flushDirectory(dirname(plan.destination));
  durableJson(join(plan.destination, 'plan.json'), plan);
  const payload = join(plan.destination, origin.kind === 'git' ? 'recovery' : 'artifact.tar.gz');
  progress('Restoring a separate recovery copy; existing repository files stay in place.');
  copyPayload(source, payload, origin.directory); verifyPayload(payload, plan.manifest);
  const verification = verifyNative(payload, origin, join(plan.destination, 'extraction'));
  verifyPayload(source, plan.manifest);
  const receipt = { schema: 'agentic-os/recovery-restore-receipt/v1', planDigest: plan.planDigest,
    recordId: record.recordId, payload, manifest: plan.manifest, verification, completedAt: new Date().toISOString() };
  durableJson(join(plan.destination, 'record.json'), record);
  durableJson(join(plan.destination, 'receipt.json'), receipt); return receipt;
}
export function applyRecovery(plan, { authorization, stopped = false, resume = false, now = Date.now(),
  progress = () => {} } = {}) {
  const options = { authorization, stopped, resume, progress }, { store, origin } = validate(plan, options);
  return withLock(acquireOperationLock('agentic-os-worktree-cleanup', plan.root), 'recovery', () =>
    withLock(acquireDirectoryLock(join(store.path, 'operation.lock')), 'recovery-store', () => {
      validate(plan, options);
      const replay = plan.kind === 'recovery-relocation' && present(join(origin.directory, 'relocation.json'));
      if (!replay && (now < plan.issuedAt || now >= plan.expiresAt)) fail('expired');
      return plan.kind === 'recovery-relocation' ? relocate(plan, store, origin, options) : restore(plan, store, origin, options);
    }));
}
export function recoveryLocation(common, operation) {
  const pointerPath = join(common, 'agentic-os-storage', id(operation), 'relocation.json');
  if (!present(pointerPath)) return null;
  const store = selectedStore(common), origin = completed(common, operation), record = readRecord(store, operation);
  assertRecord(record, origin);
  const plan = readJson(join(origin.directory, 'relocation-plan.json')), pointer = readJson(pointerPath);
  if (!same(pointer, relocationPointer(plan, record)) || plan.store.path !== store.path || present(origin.source))
    fail('recovery-pointer-drift');
  verifyPayload(payloadPath(store, record), record.manifest);
  return { store: store.path, recordId: record.recordId, payload: payloadPath(store, record), manifest: record.manifest };
}
export function inventoryRecovery({ cwd, store: requested }) {
  const where = location(cwd), parent = join(where.common, 'agentic-os-storage');
  if (!present(parent)) return { schema: 'agentic-os/storage-inventory/v1', repository: where.root, operations: [] };
  direct(parent);
  const config = present(join(parent, 'store.json')) ? configuration(where.common) : null;
  const store = config ? selectedStore(where.common, requested) : null;
  if (requested !== undefined && !store) fail('recovery-not-configured');
  const entries = boundedDirectoryEntries(parent, 2000, 'storage inventory').filter(entry => HEX.test(entry.name));
  const operations = entries.map(entry => {
    const operation = entry.name, directory = join(parent, operation);
    try {
      const origin = completed(where.common, operation), pointerPath = join(directory, 'relocation.json');
      if (present(pointerPath)) {
        if (!store) fail('recovery-not-configured');
        const record = readRecord(store, operation); assertRecord(record, origin);
        const pointer = readJson(pointerPath), plan = readJson(join(directory, 'relocation-plan.json'));
        if (!same(pointer, relocationPointer(plan, record)) || present(origin.source)) fail('recovery-pointer-drift');
        return { operation, kind: origin.kind, state: 'retained-central', retention: 'hold',
          payload: payloadPath(store, record), allocatedBytes: allocated(payloadPath(store, record)), verifiedAt: record.verifiedAt };
      }
      return { operation, kind: origin.kind, state: present(join(directory, 'relocation-plan.json'))
        ? 'relocation-incomplete' : 'retained-local', retention: 'hold', payload: origin.source, allocatedBytes: allocated(origin.source) };
    } catch (error) {
      return { operation, state: error.message === 'blocked-storage-recovery-no-completed-payload'
        ? 'completed-no-payload' : 'retained-unclassified', reason: error.message };
    }
  });
  return { schema: 'agentic-os/storage-inventory/v1', repository: where.root,
    store: store?.path ?? null, automaticDeletion: false, verification: 'metadata-only; apply rehashes payloads', operations,
    retainedAllocatedBytes: operations.reduce((sum, entry) => sum + (entry.allocatedBytes ?? 0), 0) };
}
