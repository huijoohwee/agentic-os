import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, consolidate } from './helpers/workspace.mjs';
import { checkWorkspace } from '../bin/agentic-os-workspace-check.mjs';
import { validateWorkspaceConfiguration } from '../bin/agentic-os-workspace.mjs';
import { workspaceIgnore, checkPublication, sharedWorkspacePath } from '../bin/agentic-os-workspace-publication.mjs';

function setup(t) {
  const s = consolidate(fixture(t));
  s.config.publication = { mode: 'essential', files: ['.gitignore', '.artifacts/README.md'] };
  const write = (path, bytes) => {
    const file = join(s.container, path); mkdirSync(join(file, '..'), {recursive:true}); writeFileSync(file, bytes);
  };
  const enable = () => { write('.gitignore', workspaceIgnore(s.config)); s.commit(s.container); };
  const head = () => s.run(s.container, ['rev-parse','HEAD']);
  return {...s, write, enable, head, check: base => checkWorkspace({root:s.container,base,head:head(),config:s.config})};
}
test('essential publication untracks hundreds of historical artifacts while preserving local bytes', t => {
  const s = setup(t);
  for (let i=0;i<600;i++) s.write(`.artifacts/legacy-${i}.log`, 'retained historical artifact\n');
  s.commit(s.container); const base = s.head();
  s.write('.gitignore', workspaceIgnore(s.config));
  s.run(s.container,['rm','--quiet','--cached','-r','--','.artifacts']);
  s.commit(s.container);
  const result = s.check(base);
  assert.equal(result.publication.mode,'essential'); assert.equal(result.publication.artifactBodies,'local-only');
  assert.equal(result.publication.historicalObjects,'retained');
  assert.ok(result.publication.files < 10); assert.equal(result.grantsAuthority,false);
  assert.equal(readFileSync(join(s.container,'.artifacts/legacy-0.log'),'utf8'),'retained historical artifact\n');
  assert.equal(s.run(s.container,['show',`${base}:.artifacts/legacy-599.log`]),'retained historical artifact');
  s.write('.artifacts/active.log','unfinished');
  assert.equal(s.run(s.container,['status','--porcelain']), '');
  assert.equal(s.run(s.container,['check-ignore','.artifacts/active.log']),'.artifacts/active.log');
});
test('whole-tree validation rejects forced local-only files even without a changed-path diff', t => {
  for (const path of ['outside.txt','.artifacts/result.json','.memory/.cache/index.json','.todo/.env.local']) {
    const s = setup(t); s.enable(); s.write(path,'not shared');
    s.run(s.container,['add','--force','--',path]); s.run(s.container,['commit','--quiet','-m','forced']);
    assert.throws(()=>s.check(s.head()), /publication-local-only/);
  }
});
test('generated ignores exclude unknown roots and permit shared records and explicit nested metadata', t => {
  const s = setup(t); s.config.publication.files.push('.github/workflows/check.yml');
  s.write('.github/workflows/check.yml','name: check\n'); s.enable();
  for (const path of ['.memory/records/new.md','.todo/__tests__/check.mjs','.todo/todo/new.md',
    '.artifacts/README.md','.github/workflows/check.yml']) {
    s.write(path,'shared');
    assert.equal(sharedWorkspacePath(s.config,path),true);
    assert.equal(spawnSync('git',['check-ignore','--no-index',path],{cwd:s.container}).status,1);
  }
  for (const path of ['.github/unexpected.yml','.artifacts/new.log','other/file','.memory/node_modules/a.js']) {
    s.write(path,'local'); assert.equal(s.run(s.container,['check-ignore',path]),path);
  }
});
test('symlinks, oversized shared files and ignore drift fail independently of gitignore staging', t => {
  const s = setup(t); s.enable(); const base=s.head();
  s.write('.memory/large.md',Buffer.alloc(500000)); s.commit(s.container);
  assert.throws(()=>s.check(base), /publication-file-bytes/);
  s.write('.memory/large.md','small'); symlinkSync('/outside',join(s.container,'.memory/link'));
  s.commit(s.container); assert.throws(()=>s.check(base), /publication-regular-file/);
  s.run(s.container,['rm','--quiet','--','.memory/link']); s.write('.gitignore','*.log\n'); s.commit(s.container);
  assert.throws(()=>s.check(base), /publication-ignore-drift/);
});
test('publication caps total shared bytes and count instead of accepting unlimited small files', t => {
  const s=setup(t); s.enable(); const base=s.head();
  for(let i=0;i<11;i++) s.write(`.memory/size-${i}.md`,Buffer.alloc(470000));
  s.commit(s.container); assert.throws(()=>s.check(base), /publication-total-bytes/);
  for(let i=0;i<11;i++) s.write(`.memory/size-${i}.md`,'small');
  for(let i=0;i<512;i++) s.write(`.memory/count-${i}.md`,'small');
  s.commit(s.container); assert.throws(()=>s.check(base), /publication-file-count/);
});
test('essential mode preserves immutable planning and rejects malformed policy; legacy is opt-in', t => {
  const s=setup(t); s.write('.todo/todo/accepted.md','immutable'); s.enable(); const base=s.head();
  s.write('.todo/todo/accepted.md','rewritten'); s.commit(s.container);
  assert.throws(()=>s.check(base), /immutable-planning-record/);
  const legacy=structuredClone(s.config); delete legacy.publication;
  assert.equal(checkPublication(s.container,s.head(),legacy),null);
  for(const files of [[],['.gitignore','../secret'],['.gitignore','.artifacts/body.log'],
    ['.gitignore','.artifacts/README.md','.memory/.env']]) {
    const bad=structuredClone(s.config); bad.publication.files=files;
    assert.throws(()=>validateWorkspaceConfiguration(bad,s.root), /publication/);
  }
  assert.equal(existsSync(join(s.container,'.todo/todo/accepted.md')),true);
});
