import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, utimesSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { traceWorkflow } from '../bin/agentic-os-workflow-trace.mjs';
import { createCodebaseContext } from '../bin/agentic-os-context-index.mjs';
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
  assert.equal(result.observation.sourceReadBytes, result.coverage.bytes * 2);
  assert.equal(result.observation.verificationInventoryReads, 1);
  assert.ok(result.observation.parsedFiles > 0);assert.equal(result.observation.tokens,null);
  assert.ok(result.edges.some(edge=>edge.to==='owner.mjs'&&edge.kind==='literal-import'));
  assert.doesNotMatch(JSON.stringify(result), /private body/);
  assert.equal(f.run({path:'package.json',script:'cycle'}).nodes.length,1);
});

test('twenty-source traversal batches final visibility check and preserves byte accounting', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'part0.mjs'),
    Array.from({ length: 19 }, (_, index) => `import './part${index + 1}.mjs';`).join('\n'));
  for (let index = 1; index < 20; index++)
    writeFileSync(join(f.root, `part${index}.mjs`), `export const part${index} = true;\n`);
  const result = f.run({ path: 'part0.mjs' });
  assert.equal(result.nodes.length, 20);
  assert.equal(result.observation.verificationInventoryReads, 1);
  assert.equal(result.observation.sourceReadBytes, result.coverage.bytes * 2);
  assert.equal(result.observation.parsedFiles, 20);
  assert.equal(result.coverage.complete, true);
});

test('batch verification refuses deletion and symlink substitution before result', t => {
  const f = fixture(t), context = createCodebaseContext({ root: f.root });
  const deleted = context.traceSession();
  deleted.traceSource('owner.mjs');
  deleted.traceSource('smoke.mjs');
  rmSync(join(f.root, 'owner.mjs'));
  assert.throws(() => deleted.verify(), /source-changed-retry/);
  writeFileSync(join(f.root, 'owner.mjs'), "export const value = 'private body';\n");
  const swapped = context.traceSession();
  swapped.traceSource('owner.mjs');
  swapped.traceSource('smoke.mjs');
  rmSync(join(f.root, 'owner.mjs'));
  symlinkSync(join(f.root, 'smoke.mjs'), join(f.root, 'owner.mjs'));
  assert.throws(() => swapped.verify(), /regular-source-required/);
});

test('deferred traversal verification rejects same-size edits with restored timestamps', t => {
  const f = fixture(t), context = createCodebaseContext({ root: f.root });
  const inspected = context.traceSource('owner.mjs');
  assert.match(inspected.file.text, /private body/);
  const path = join(f.root, 'owner.mjs'), before = statSync(path);
  writeFileSync(path, readFileSync(path, 'utf8').replace('private body', 'changed body'));
  utimesSync(path, before.atime, before.mtime);
  assert.throws(() => inspected.verify(), /source-changed-retry/);
  assert.equal(f.run({ path: 'owner.mjs' }).observation.sourceReadBytes, inspected.file.bytes * 2);
});

test('exports bounded source observations for Graph Canvas without inventing per-file costs', t => {
  const f=fixture(t), result=f.run({path:'package.json',script:'gate',view:'mission'});
  assert.equal(result.schema,'agent-toolkit-run/v1');assert.equal(result.authority,false);
  assert.equal(result.spans.length,5);assert.equal(result.page.total,5);
  assert.equal(result.coverage.partial,false);assert.equal(result.profile.workflow.observation.costUsd,null);
  assert.ok(result.spans[0].resources.cpuMs >= 0);
  assert.equal(result.spans[1].resources.cpuMs,null);
  assert.ok(result.spans.some(span => span.links?.some(link => link.kind === 'literal-import')));
  assert.doesNotMatch(JSON.stringify(result),/private body/);
  assert.equal(f.run({path:'missing.mjs',view:'mission'}).coverage.partial,true);
  assert.throws(()=>f.run({path:'package.json',view:'other'}),/blocked-workflow-trace:input/);
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
