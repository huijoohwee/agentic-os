import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CACHE_REF, SCHEMA, load, save, storePath } from '../src/lane-records.mjs';

const REAL_GIT = '/usr/bin/git';
const runGit = (cwd, ...args) => execFileSync(REAL_GIT, args, {
  cwd, encoding: 'utf8',
}).trim();
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentic-os-lane-cache-cas-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(root, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  runGit(root, 'add', 'README.md');
  runGit(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '--message=fixture');
  return root;
}
function store(ref) {
  return { schema: SCHEMA, lanes: { [ref]: { ref, state: 'active' } } };
}
function bytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}
function wrapper(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agentic-os-git-wrapper-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'git');
  writeFileSync(path, `#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2), real=process.env.REAL_GIT, marker=process.env.INJECT_MARKER;
if(process.env.INJECT_LOCK_RESIDUE_EARLY&&existsSync(process.env.INJECT_LOCK_DIRECTORY)
  &&!existsSync(process.env.INJECT_LOCK_RESIDUE))
  writeFileSync(process.env.INJECT_LOCK_RESIDUE,'foreign lock residue\\n',{flag:'wx'});
if(args[0]==='update-ref'&&args.includes('--no-deref')&&args.includes(process.env.CACHE_REF)
  &&!existsSync(marker)){
  writeFileSync(marker,'injected\\n',{flag:'wx'});
  if(process.env.INJECT_LEGACY_PATH)
    writeFileSync(process.env.INJECT_LEGACY_PATH,Buffer.from(process.env.INJECT_BYTES,'base64'));
  if(process.env.INJECT_REF==='1'){
    const blob=spawnSync(real,['hash-object','-w','--stdin'],{input:Buffer.from(process.env.INJECT_BYTES,'base64'),encoding:'utf8'});
    if(blob.status!==0)process.exit(blob.status??91);
    const current=spawnSync(real,['rev-parse','--verify',process.env.CACHE_REF],{encoding:'utf8'});
    if(current.status!==0)process.exit(current.status??92);
    const advanced=spawnSync(real,['update-ref','--no-deref',process.env.CACHE_REF,
      blob.stdout.trim(),current.stdout.trim()],{encoding:'utf8'});
    if(advanced.status!==0)process.exit(advanced.status??93);
  }
}
const result=spawnSync(real,args,{stdio:['inherit','inherit','inherit']});
if(result.status===0&&args[0]==='update-ref'&&args.includes(process.env.CACHE_REF)
  &&process.env.INJECT_LOCK_RESIDUE)
  writeFileSync(process.env.INJECT_LOCK_RESIDUE,'foreign lock residue\\n',{flag:'wx'});
process.exit(result.status??94);
`);
  chmodSync(path, 0o755);
  return { directory, marker: join(directory, 'marker') };
}
function childPut(root, ref, injection) {
  const source = `
    import {put} from ${JSON.stringify(new URL('../src/lane-records.mjs', import.meta.url).href)};
    try { put({ref:process.env.LANE_REF,state:'active'},process.env.REPOSITORY); process.exitCode=8; }
    catch(error) { console.log(JSON.stringify({reason:error.reason,
      operationArtifacts:error.operationArtifacts??null,lockPath:error.lockPath??null})); }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root, encoding: 'utf8', env: {
      ...process.env, PATH: `${injection.directory}:${process.env.PATH}`,
      REAL_GIT, CACHE_REF, INJECT_MARKER: injection.marker,
      REPOSITORY: root, LANE_REF: ref, ...injection.env,
    },
  });
}
function childSave(root, candidate, injection) {
  const source = `
    import {save} from ${JSON.stringify(new URL('../src/lane-records.mjs', import.meta.url).href)};
    const value=JSON.parse(Buffer.from(process.env.CANDIDATE,'base64').toString('utf8'));
    try { save(value, process.env.REPOSITORY); process.exitCode=8; }
    catch(error) { console.log(JSON.stringify({reason:error.reason, expectedOid:error.expectedOid,
      candidateOid:error.candidateOid,currentOid:error.currentOid,published:error.published??false,
      retainedLegacyPath:error.retainedLegacyPath})); }
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root, encoding: 'utf8', env: {
      ...process.env, PATH: `${injection.directory}:${process.env.PATH}`,
      REAL_GIT, CACHE_REF, INJECT_MARKER: injection.marker,
      REPOSITORY: root, CANDIDATE: bytes(candidate).toString('base64'),
      ...injection.env,
    },
  });
}

test('cache ref must be direct and cannot redirect publication into a protected branch', (t) => {
  const root = repository(t);
  const main = runGit(root, 'rev-parse', 'refs/heads/main');
  runGit(root, 'symbolic-ref', CACHE_REF, 'refs/heads/main');
  assert.throws(() => load(root), /ref must be direct/u);
  assert.throws(() => save(store('agent/device/candidate'), root), /ref must be direct/u);
  assert.equal(runGit(root, 'rev-parse', 'refs/heads/main'), main);
});

test('direct-ref CAS retains both a concurrent cache update and the rejected candidate blob', (t) => {
  const root = repository(t);
  save(store('agent/device/base'), root);
  const foreign = store('agent/device/foreign');
  const injection = wrapper(t);
  injection.env = {
    INJECT_REF: '1', INJECT_BYTES: bytes(foreign).toString('base64'),
  };
  const result = childSave(root, store('agent/device/candidate'), injection);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, 'blocked-lane-cache-publication');
  assert.notEqual(receipt.expectedOid, receipt.currentOid);
  assert.notEqual(receipt.candidateOid, receipt.currentOid);
  assert.deepEqual(JSON.parse(JSON.stringify(load(root))), foreign);
  assert.equal(runGit(root, 'cat-file', '-t', receipt.candidateOid), 'blob');
});

test('legacy drift after migration is retained and returns a published degraded receipt', (t) => {
  const root = repository(t);
  const legacy = storePath(root);
  mkdirSync(dirname(legacy), { recursive: true });
  writeFileSync(legacy, bytes(store('agent/device/legacy')));
  const injection = wrapper(t);
  const foreign = Buffer.from('FOREIGN LEGACY BYTES\n');
  injection.env = {
    INJECT_LEGACY_PATH: legacy, INJECT_BYTES: foreign.toString('base64'),
  };
  const candidate = store('agent/device/candidate');
  const result = childSave(root, candidate, injection);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, 'blocked-lane-cache-publication');
  assert.equal(receipt.published, true);
  assert.equal(receipt.currentOid, receipt.candidateOid);
  assert.equal(receipt.retainedLegacyPath, legacy);
  assert.deepEqual(readFileSync(legacy), foreign);
  assert.deepEqual(JSON.parse(JSON.stringify(load(root))), candidate);
});

test('lock-finalization refusal reports the exact published cache blob and retains residue', (t) => {
  const root = repository(t);
  const injection = wrapper(t);
  const lockPath = join(root, '.git', 'agentic-os-lane-cache.lock');
  injection.env = { INJECT_LOCK_RESIDUE: join(lockPath, 'foreign') };
  const result = childPut(root, 'agent/device/candidate', injection);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, 'blocked-lane-cache-lock-integrity');
  assert.equal(receipt.lockPath, realpathSync(lockPath));
  assert.equal(receipt.operationArtifacts.cacheRef, CACHE_REF);
  assert.equal(receipt.operationArtifacts.effectsRetained, true);
  assert.equal(receipt.operationArtifacts.candidateObjectWritten, true);
  assert.equal(receipt.operationArtifacts.refPublished, true);
  assert.equal(receipt.operationArtifacts.legacyCachePath, storePath(root));
  assert.match(receipt.operationArtifacts.candidateOid, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
  assert.equal(runGit(root, 'rev-parse', '--verify', CACHE_REF),
    receipt.operationArtifacts.candidateOid);
  assert.equal(readFileSync(join(lockPath, 'foreign'), 'utf8'), 'foreign lock residue\n');
});

test('lock-finalization refusal distinguishes a pre-publication cache failure', (t) => {
  const root = repository(t); const injection = wrapper(t);
  const lockPath = join(root, '.git', 'agentic-os-lane-cache.lock');
  mkdirSync(dirname(storePath(root)), { recursive: true, mode: 0o700 });
  writeFileSync(storePath(root), '{ invalid legacy cache');
  injection.env = { INJECT_LOCK_DIRECTORY: lockPath,
    INJECT_LOCK_RESIDUE: join(lockPath, 'foreign'),
    INJECT_LOCK_RESIDUE_EARLY: '1' };
  const result = childPut(root, 'agent/device/candidate', injection);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.reason, 'blocked-lane-cache-lock-integrity');
  assert.equal(receipt.operationArtifacts.effectsRetained, false);
  assert.equal(receipt.operationArtifacts.candidateOid, null);
  assert.equal(receipt.operationArtifacts.candidateObjectWritten, false);
  assert.equal(receipt.operationArtifacts.refPublished, false);
  assert.notEqual(spawnSync(REAL_GIT, ['show-ref', '--verify', CACHE_REF], { cwd: root }).status, 0);
});

test('CAS failure behind lock residue reports its retained candidate without claiming ref publication', (t) => {
  const root = repository(t); save(store('agent/device/base'), root);
  const injection = wrapper(t), foreign = store('agent/device/foreign');
  const lockPath = join(root, '.git', 'agentic-os-lane-cache.lock');
  injection.env = { INJECT_REF: '1', INJECT_BYTES: bytes(foreign).toString('base64'),
    INJECT_LOCK_DIRECTORY: lockPath, INJECT_LOCK_RESIDUE: join(lockPath, 'foreign'),
    INJECT_LOCK_RESIDUE_EARLY: '1' };
  const result = childPut(root, 'agent/device/candidate', injection);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout), artifacts = receipt.operationArtifacts;
  assert.equal(receipt.reason, 'blocked-lane-cache-lock-integrity');
  assert.equal(artifacts.effectsRetained, true);
  assert.equal(artifacts.candidateObjectWritten, true);
  assert.equal(artifacts.refPublished, false);
  assert.match(artifacts.candidateOid, /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
  assert.equal(runGit(root, 'cat-file', '-t', artifacts.candidateOid), 'blob');
  assert.deepEqual(JSON.parse(JSON.stringify(load(root))), foreign);
});
