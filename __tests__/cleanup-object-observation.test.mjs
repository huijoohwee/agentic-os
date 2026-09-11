import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, linkSync, lstatSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observeQuarantineManifest } from '../src/cleanup-manifest.mjs';
import { observeWorktreeCleanupTarget } from '../src/cleanup-quarantine.mjs';
import { createRepositoryProfile, RETAIN_ALL_CLEANUP, governanceDigest } from '../src/governance.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { collectRecoveryInventory } from '../src/recovery-inventory.mjs';

const limits = { byteCeiling: 1000000, entryCeiling: 1000 };
const git = (cwd, ...args) => execFileSync('git', args, {cwd,encoding:'utf8'}).trim();
function temporary(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cleanup-object-observation-')));
  t.after(()=>rmSync(root,{recursive:true,force:true})); return root;
}
test('retained hardlink reads bind bytes and link counts without relaxing default manifests', t => {
  const root = temporary(t), objects = join(root,'objects'); mkdirSync(objects);
  const object = join(objects,'object'), alias = join(root,'alias');
  writeFileSync(object,'retained'); linkSync(object,alias);
  assert.throws(()=>observeQuarantineManifest(objects,limits), /unsupported bytes/);
  const observe = () => observeQuarantineManifest(objects,{...limits,retainedHardlinks:true});
  const initial = observe(); assert.equal(initial.bytes,8);
  writeFileSync(alias,'modified'); assert.notEqual(observe().digest,initial.digest);
  const changed = observe(); linkSync(object,join(root,'another'));
  assert.notEqual(observe().digest,changed.digest);
  assert.throws(()=>observeQuarantineManifest(objects,{...limits,byteCeiling:1,retainedHardlinks:true}), /ceiling/);
  assert.equal(readFileSync(alias,'utf8'),'modified'); assert.equal(lstatSync(object).nlink,3);
});
test('cleanup observes actual local-clone shared objects but refuses a hardlinked projection', t => {
  const parent = temporary(t), root = join(parent,'repo'), target = join(parent,'lane'); mkdirSync(root);
  git(root,'init','--quiet','--initial-branch=main');
  git(root,'config','user.name','Fixture'); git(root,'config','user.email','fixture@example.invalid');
  const profile = createRepositoryProfile({repository:'github.com/example/repository',
    canonical:{localRef:'refs/heads/main',remoteRef:'refs/remotes/origin/main'},
    adapters:{repository:{id:'git',version:'1'},provider:null},
    cleanup:{...RETAIN_ALL_CLEANUP,worktreeProjection:'quarantine',worktreeRegistration:'quarantine'}});
  writeFileSync(join(root,'.agentic-os.json'),JSON.stringify(profile)); writeFileSync(join(root,'file'),'source');
  git(root,'add','.'); git(root,'commit','--quiet','-m','fixture');
  const head = git(root,'rev-parse','HEAD'); git(root,'update-ref','refs/remotes/origin/main',head);
  ensureRepositoryTrust(root,profile,{allowCreate:true});
  git(root,'clone','--quiet','--local',root,join(parent,'clone'));
  const object = join(root,'.git','objects',head.slice(0,2),head.slice(2));
  assert.ok(lstatSync(object).nlink > 1);
  git(root,'worktree','add','--quiet','-b','agent/device/test',target,'main');
  const inventory = collectRecoveryInventory({cwd:target,canonicalRef:'refs/heads/main'});
  const plan = {repository:profile.repository,targetPath:target,expectedBranch:'agent/device/test',
    expectedHeadRevision:head,expectedCanonicalRef:'refs/heads/main',expectedCanonicalRevision:head,
    profileDigest:profile.profileDigest,recoveryInventoryDigest:governanceDigest(inventory),
    recoveryInventoryContentEntries:inventory.inventoryEntries.content,
    projectionByteCeiling:1000000,projectionEntryCeiling:1000,registrationByteCeiling:1000000,
    registrationEntryCeiling:1000,sharedStateByteCeiling:1000000,sharedStateEntryCeiling:1000};
  const observed = observeWorktreeCleanupTarget(plan,{cwd:root});
  assert.ok(observed.sharedStateBytes > 0); assert.equal(lstatSync(object).nlink,2);
  linkSync(join(target,'file'),join(parent,'projection-alias'));
  assert.throws(()=>observeWorktreeCleanupTarget(plan,{cwd:root}), /unsupported bytes|inventory|unsafe|hardlink/);
});
