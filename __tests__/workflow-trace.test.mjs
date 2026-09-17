import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { traceWorkflow } from '../bin/agentic-os-workflow-trace.mjs';
import { resolveInvocation, dispatchInvocation } from '../bin/agentic-os-invocation.mjs';
import { toolArguments } from '../src/mcp-server.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'workflow-trace-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init','-q','--initial-branch=main'); git('config','user.name','Fixture'); git('config','user.email','fixture@example.invalid');
  writeFileSync(join(root,'package.json'), JSON.stringify({ scripts: { gate: 'npm run browser && node smoke.mjs', browser: 'node smoke.mjs', cycle: 'npm run cycle' } }, null, 2));
  writeFileSync(join(root,'smoke.mjs'), "import { value } from './owner.mjs';\n");
  writeFileSync(join(root,'owner.mjs'), "export const value = 'private body';\n");
  writeFileSync(join(root,'.gitignore'), '*.input.json\n');
  git('add','.'); git('commit','-qm','fixture');
  const run = value => { const path=join(root,'trace.input.json');writeFileSync(path,JSON.stringify(value));return traceWorkflow(root,path); };
  return { root, run };
}

test('traverses scripts to owning imports, identifies repeated invocations, never executes or exposes bodies', t => {
  const f=fixture(t), result=f.run({path:'package.json',script:'gate'});
  assert.equal(result.authority,false); assert.equal(result.executable,false);
  assert.equal(result.nodes.length,4);assert.equal(result.duplicates[0].target,'smoke.mjs');
  assert.equal(result.duplicates[0].evidence.length,2);assert.equal(result.measured,null);
  assert.ok(result.edges.some(edge=>edge.to==='owner.mjs'&&edge.kind==='literal-import'));
  assert.doesNotMatch(JSON.stringify(result), /private body/);
  assert.equal(f.run({path:'package.json',script:'cycle'}).nodes.length,1);
});

test('rejects secret, traversal and symlink sources; reports opaque commands and missing references', t => {
  const f=fixture(t);
  for(const path of ['../outside.mjs','.env','node_modules/lib.mjs']) assert.throws(()=>f.run({path}),/unsafe-path/);
  symlinkSync(join(f.root,'owner.mjs'),join(f.root,'alias.mjs'));
  assert.throws(()=>f.run({path:'alias.mjs'}),/regular-source-required/);
  writeFileSync(join(f.root,'package.json'),JSON.stringify({scripts:{gate:'node -e "throw 1"'}}));
  assert.equal(f.run({path:'package.json',script:'gate'}).unresolved[0].reason,'opaque-command');
  assert.equal(f.run({path:'missing.mjs'}).coverage.complete,false);
});

test('CLI sigils and MCP share the existing read-only workflow trace route', () => {
  assert.deepEqual(dispatchInvocation(resolveInvocation(['/workflow.trace','#read-only','@input:trace.json'])),
    {ok:true,command:'workflow',argv:['trace','--input=trace.json'],semantic:'read-only'});
  assert.deepEqual(toolArguments('workflow.trace',{input:'trace.json'}),['workflow','trace','--input=trace.json']);
  assert.throws(()=>toolArguments('workflow.trace',{input:'trace.json',execute:true}));
});
