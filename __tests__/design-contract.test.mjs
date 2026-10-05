import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkDesignContract, designDigest, designPolicyBytes, designGenerationBytes, DESIGN_INPUT_SCHEMA } from '../src/design.mjs';
import { loadCatalog, validateCatalog, resolveInvocation, dispatchInvocation } from '../bin/agentic-os-invocation.mjs';
import { TOOLS, toolArguments, handleRequest } from '../src/mcp-server.mjs';
import { validateCommandArguments } from '../bin/agentic-os-argv.mjs';

const sha = 'a'.repeat(40);
async function fixture() {
  const policy = { schema: 'native-design-policy/v1', id: 'design', revision: '1.0.0',
    requiredConcerns: ['theme', 'typography', 'ideograms', 'illustration', 'settings'] };
  const text = 'theme typography ideograms illustration settings';
  return { schema: 'native-design-check/v1', policy, expectedPolicyDigest: await designDigest(designPolicyBytes(policy)),
    record: { continuityId: 'design-pilot', revision: '1.0.0', sourceRevision: sha,
      roles: Object.fromEntries(['prd', 'tad', 'adr', 'mvp', 'gtm'].map(role => [role, '1.0.0'])),
      concerns: policy.requiredConcerns.map(id => ({ id, owner: 'native-ui', source: 'ui.js', symbol: id, check: `test ${id}` })) },
    sources: [{ id: 'ui.js', revision: sha, text, sha256: await designDigest(text) }] };
}

async function reuseFixture() {
  const input = await fixture();
  for (const [id, text] of [['adapter.js', 'export const adapter = nativeUI;'], ['producer.js', 'export const generate = adapter;'],
    ['content.json', '{"label":"A neutral outcome"}'], ['recipe.json', '{"tools":{"builder":"1.0"},"options":{"mode":"offline"}}'],
    ['generated.css', ':root { --text: #111; }']]) input.sources.push({ id, revision: sha, text, sha256: await designDigest(text) });
  input.reuse = { schema: 'native-design-reuse/v1', modules: [
    { id: 'native-ui', source: 'ui.js', symbol: 'theme', owns: [...input.policy.requiredConcerns], uses: [] },
    { id: 'adapter', source: 'adapter.js', symbol: 'adapter', owns: [], uses: ['native-ui'] },
    { id: 'producer', source: 'producer.js', symbol: 'generate', owns: [], uses: ['adapter'] },
  ], generated: [{ output: 'generated.css', producer: 'producer', inputs: ['content.json'], recipe: 'recipe.json',
    inputDigest: '0'.repeat(64), outputDigest: input.sources.at(-1).sha256 }] };
  input.reuse.generated[0].inputDigest = await designDigest(designGenerationBytes(input, 'generated.css'));
  return input;
}

test('portable check binds actual source bytes and preserves the evidence boundary', async () => {
  const input = await fixture(); const before = JSON.stringify(input);
  const report = await checkDesignContract(input);
  assert.equal(report.ok, true); assert.equal(report.authority, false); assert.equal(report.runtimeVerified, false);
  assert.equal(report.scope, 'supplied-source-contract'); assert.equal(JSON.stringify(input), before);
  assert.deepEqual(await checkDesignContract(input), report);
});

test('optional reuse evidence binds one native owner and generation without adding authority', async () => {
  const input = await reuseFixture(), before = JSON.stringify(input), report = await checkDesignContract(input);
  assert.equal(report.ok, true); assert.equal(report.authority, false); assert.equal(report.runtimeVerified, false);
  assert.equal(report.scope, 'supplied-source-contract'); assert.deepEqual(report.findings, []);
  assert.equal(JSON.stringify(input), before);
  assert(!DESIGN_INPUT_SCHEMA.required.includes('reuse'));
  assert(DESIGN_INPUT_SCHEMA.properties.reuse);
  // Canonical generation bytes ignore declaration order, while binding the complete producer closure.
  const key = designGenerationBytes(input, 'generated.css');
  input.reuse.modules.reverse(); input.sources.reverse();
  assert.equal(designGenerationBytes(input, 'generated.css'), key);
  assert.equal((await checkDesignContract(input)).ok, true);
  input.reuse.generated = [];
  assert.equal((await checkDesignContract(input)).ok, true, 'Direct native reuse needs no invented generation receipt');
  delete input.reuse;
  assert.equal((await checkDesignContract(input)).ok, true, 'Existing v1 input remains valid without optional evidence');
});

for (const [name, mutate, type] of [
  ['duplicate concern owner', x => x.reuse.modules.push({ id: 'variant', source: 'adapter.js', symbol: 'nativeUI', owns: ['theme'], uses: [] }), 'duplicate-owner'],
  ['alias of the same source symbol', x => x.reuse.modules.push({ ...x.reuse.modules[1], id: 'alias' }), 'duplicate-owner'],
  ['owner source mismatch', x => x.reuse.modules[0].source = 'adapter.js', 'unresolvable-reference'],
  ['missing ownership declaration', x => x.reuse.modules[0].owns.pop(), 'unimplemented-guideline'],
  ['undeclared concern', x => x.reuse.modules[0].owns.push('unknown'), 'unguided-artifact'],
  ['absent dependency', x => x.reuse.modules[1].uses.push('missing'), 'unresolvable-reference'],
  ['self dependency', x => x.reuse.modules[1].uses.push('adapter'), 'malformed-document'],
  ['indirect dependency cycle', x => x.reuse.modules[0].uses.push('producer'), 'malformed-document'],
  ['missing adapter symbol', x => x.reuse.modules[1].symbol = 'missing', 'unresolvable-reference'],
  ['generation source missing', x => x.reuse.generated[0].inputs = ['missing'], 'unresolvable-reference'],
  ['producer missing', x => x.reuse.generated[0].producer = 'missing', 'unresolvable-reference'],
  ['duplicate producer receipt', x => x.reuse.generated.push({ ...x.reuse.generated[0] }), 'duplicate-owner'],
  ['generation self input', x => x.reuse.generated[0].inputs.push('generated.css'), 'malformed-document'],
  ['missing generation digest', x => delete x.reuse.generated[0].inputDigest, 'malformed-document'],
  ['unknown approval claim', x => x.reuse.approved = true, 'malformed-document'],
  ['malformed module', x => x.reuse.modules[0].uses = null, 'malformed-document'],
  ['malformed generated record', x => x.reuse.generated[0] = null, 'malformed-document'],
  ['too many modules', x => x.reuse.modules = Array.from({ length: 65 }, () => x.reuse.modules[0]), 'malformed-document'],
]) test('reuse rejects ' + name, async () => {
  const input = await reuseFixture(); mutate(input);
  const report = await checkDesignContract(input);
  assert.equal(report.ok, false); assert(report.findings.some(finding => finding.type === type), JSON.stringify(report));
});

for (const id of ['ui.js', 'adapter.js', 'producer.js', 'content.json', 'recipe.json'])
  test('generation invalidates changed bytes in ' + id, async () => {
    const input = await reuseFixture(), source = input.sources.find(source => source.id === id);
    source.text += '\nchanged'; source.sha256 = await designDigest(source.text);
    const report = await checkDesignContract(input);
    assert.equal(report.ok, false);
    assert(report.findings.some(finding => finding.reference === 'generated.css' && finding.type === 'stale-evidence'));
  });

test('generation invalidates revision, options, dependency graph and output changes', async () => {
  for (const mutate of [
    x => { x.sources.find(source => source.id === 'adapter.js').revision = 'b'.repeat(40); },
    x => { x.reuse.modules[2].uses = ['native-ui']; },
    x => { x.reuse.generated[0].recipe = 'content.json'; },
    x => { x.reuse.generated[0].outputDigest = 'f'.repeat(64); },
    x => { x.sources.find(source => source.id === 'generated.css').id = 'other.css'; x.reuse.generated[0].output = 'other.css'; },
  ]) {
    const input = await reuseFixture(); mutate(input);
    assert((await checkDesignContract(input)).findings.some(finding => finding.type === 'stale-evidence'));
  }
  const input = await reuseFixture(), output = input.sources.find(source => source.id === 'generated.css');
  output.text += ' body {}'; output.sha256 = await designDigest(output.text);
  assert((await checkDesignContract(input)).findings.some(finding => finding.type === 'stale-evidence'));
});

test('generation cycles include recipes and the producer dependency closure', async () => {
  for (const producerSource of [false, true]) {
    const input = await reuseFixture();
    if (producerSource) input.reuse.modules[1].source = 'generated.css', input.reuse.modules[1].symbol = ':root';
    else input.reuse.generated.push({ ...input.reuse.generated[0], output: 'recipe.json', recipe: 'content.json',
      inputs: ['generated.css'], outputDigest: input.sources.find(source => source.id === 'recipe.json').sha256 });
    const report = await checkDesignContract(input);
    assert(report.findings.some(finding => finding.type === 'malformed-document' && finding.reference === 'reuse.generated'));
  }
});

test('async hashing checks one snapshot even if the caller later changes reuse declarations', async () => {
  const input = await reuseFixture(), result = checkDesignContract(input);
  input.reuse.modules[0].uses.push('producer'); input.sources[0].text = 'changed after call';
  assert.equal((await result).ok, true);
  assert.equal((await checkDesignContract(input)).ok, false);
});

for (const [name, mutate, type] of [
  ['policy drift', x => x.policy.requiredConcerns.push('motion'), 'stale-evidence'],
  ['role drift', x => x.record.roles.gtm = '2.0.0', 'status-conflict'],
  ['source drift', x => x.sources[0].text += ' changed', 'stale-evidence'],
  ['stale source', x => x.sources[0].revision = 'b'.repeat(40), 'stale-evidence'],
  ['missing concern', x => x.record.concerns.pop(), 'unimplemented-guideline'],
  ['missing symbol', x => x.record.concerns[0].symbol = 'absent()', 'unresolvable-reference'],
  ['duplicate owner', x => x.record.concerns.push({ ...x.record.concerns[0] }), 'duplicate-owner'],
  ['duplicate source', x => x.sources.push({ ...x.sources[0] }), 'duplicate-owner'],
  ['unproven claim', x => x.record.runtimeReady = true, 'malformed-document'],
]) test(name, async () => {
  const input = await fixture(); mutate(input); const report = await checkDesignContract(input);
  assert.equal(report.ok, false); assert.ok(report.findings.some(f => f.type === type));
});

test('untrusted input is bounded before traversal or serialization effects', async () => {
  let invoked = false; const getter = Object.defineProperty({}, 'schema', { get() { invoked = true; throw Error(); } });
  const cycle = {}; cycle.self = cycle;
  for (const input of [getter, cycle, new Proxy({}, { ownKeys() { throw Error('hostile'); } }), new Array(100000000), { text: 'x'.repeat(262145) }, null, undefined]) {
    assert.equal((await checkDesignContract(input)).ok, false);
  }
  assert.equal(invoked, false);
});

test('CLI, slash tuple and MCP arguments use one read-only check', async () => {
  assert.equal(validateCatalog(loadCatalog()).ok, true);
  const tuple = resolveInvocation(['/design.check', '#read-only', '@input:record.json']);
  assert.equal(tuple.ok, true);
  const dispatch = dispatchInvocation(tuple);
  assert.equal(dispatch.ok, true);
  assert.deepEqual(toolArguments('design.check', { input: 'record.json' }), ['design-check', '--input=record.json']);
  assert.equal(TOOLS.find(t => t.name === 'design.check').annotations.readOnlyHint, true);
  assert.equal(validateCommandArguments('design-check', ['--input=record.json']), null);
  assert.ok(validateCommandArguments('design-check', ['--input=x', '--input=y']));
  const dir = mkdtempSync(join(tmpdir(), 'native-design-'));
  try {
    const path = join(dir, 'record.json');
    const call = args => spawnSync(process.execPath, ['bin/agentic-os.mjs', ...args], { encoding: 'utf8', timeout: 10000 });
    const invalid = await reuseFixture(); invalid.reuse.modules[0].uses.push('producer');
    for (const input of [await fixture(), await reuseFixture(), invalid]) {
      writeFileSync(path, JSON.stringify(input));
      const cli = call(['design-check', `--input=${path}`]);
      const slash = call(['/design.check', '#read-only', `@input:${path}`]);
      const domain = await checkDesignContract(input);
      assert.equal(cli.status, domain.ok ? 0 : 1, cli.stderr); assert.equal(slash.status, cli.status, slash.stderr);
      assert.deepEqual(JSON.parse(cli.stdout), domain); assert.deepEqual(JSON.parse(slash.stdout), domain);
      const rpc = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'design.check', arguments: { input: path } } }, {
        era: 'legacy', legacyReady: true, runCli: async args => {
          const result = call(args); return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
        },
      });
      assert.equal(rpc.result.isError, !domain.ok);
      assert.deepEqual(JSON.parse(rpc.result.structuredContent.stdout), domain);
    }
    writeFileSync(path, '{'); assert.equal(call(['design-check', `--input=${path}`]).status, 1);
  } finally { rmSync(dir, { recursive: true }); }
});
