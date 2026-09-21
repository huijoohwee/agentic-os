import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindPublishedUpstream, git, headSha, publishExactNewRef } from '../src/git.mjs';

function fixture(t) {
  const parent=mkdtempSync(join(tmpdir(),'publication-tracking-')), root=join(parent,'repo'), bare=join(parent,'origin.git');
  t.after(()=>rmSync(parent,{recursive:true,force:true})); mkdirSync(root);
  const run=(...args)=>git(args,{cwd:root});
  run('init','--bare',bare); run('init','-b','main');
  run('config','user.name','Fixture'); run('config','user.email','fixture@example.invalid');
  writeFileSync(join(root,'source.txt'),'base');run('add','.');run('commit','-m','base');
  const base=run('rev-parse','HEAD'),ref='agent/device/tracking';
  run('remote','add','origin',bare);run('switch','-c',ref);
  writeFileSync(join(root,'source.txt'),'candidate');run('add','.');run('commit','-m','candidate');
  const head=run('rev-parse','HEAD'),tracking=`refs/remotes/origin/${ref}`;
  publishExactNewRef('origin',ref,head,root,bare);
  return {root,bare,run,ref,head,base,tracking,bind:()=>bindPublishedUpstream('origin',ref,head,root,bare)};
}
test('exact new publication makes upstream usable immediately and is idempotent',t=>{
  const f=fixture(t);assert.equal(headSha(f.tracking,f.root),null);
  const result=f.bind();assert.equal(result.upstream,'bound');assert.equal(result.trackingCreated,true);
  assert.equal(f.run('rev-parse','@{upstream}'),f.head);
  assert.equal(f.run('rev-list','--left-right','--count','HEAD...@{upstream}'),'0\t0');
  assert.equal(f.bind().effectsRetained,false);
});
test('custom and partial author upstream configuration is retained verbatim',t=>{
  const f=fixture(t);f.run('config',`branch.${f.ref}.remote`,'custom');
  assert.equal(f.bind().upstream,'preserved-custom');
  assert.equal(f.run('config','--get',`branch.${f.ref}.remote`),'custom');
  assert.equal(headSha(f.tracking,f.root),null);
  f.run('config',`branch.${f.ref}.remote`,'');
  assert.equal(f.bind().upstream,'preserved-custom');
  assert.equal(headSha(f.tracking,f.root),null,'explicit empty values are still author configuration');
});
test('conflicting or symbolic tracking refs cannot be overwritten',t=>{
  const f=fixture(t);f.run('update-ref',f.tracking,f.base);
  assert.throws(f.bind,/tracking-conflict/);assert.equal(headSha(f.tracking,f.root),f.base);
  f.run('update-ref','-d',f.tracking);f.run('symbolic-ref',f.tracking,'refs/heads/main');
  assert.throws(f.bind,/tracking-symbolic/);assert.equal(f.run('rev-parse','main'),f.base);
});
test('remote candidate drift refuses local metadata repair',t=>{
  const f=fixture(t);f.run('--git-dir',f.bare,'update-ref',`refs/heads/${f.ref}`,f.base);
  assert.throws(f.bind,/tracking-drift/);assert.equal(headSha(f.tracking,f.root),null);
});
