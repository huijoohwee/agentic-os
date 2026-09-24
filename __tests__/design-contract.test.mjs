import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkDesignContract, designDigest, designPolicyBytes } from '../src/design.mjs';
import { loadCatalog, validateCatalog, resolveInvocation, dispatchInvocation } from '../bin/agentic-os-invocation.mjs';
import { TOOLS, toolArguments } from '../src/mcp-server.mjs';
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

test('portable check binds actual source bytes and preserves the evidence boundary', async () => {
  const input = await fixture(); const before = JSON.stringify(input);
  const report = await checkDesignContract(input);
  assert.equal(report.ok, true); assert.equal(report.authority, false); assert.equal(report.runtimeVerified, false);
  assert.equal(report.scope, 'supplied-source-contract'); assert.equal(JSON.stringify(input), before);
  assert.deepEqual(await checkDesignContract(input), report);
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
    const path = join(dir, 'record.json'); writeFileSync(path, JSON.stringify(await fixture()));
    const call = args => spawnSync(process.execPath, ['bin/agentic-os.mjs', ...args], { encoding: 'utf8', timeout: 10000 });
    const cli = call(['design-check', `--input=${path}`]);
    const slash = call(['/design.check', '#read-only', `@input:${path}`]);
    assert.equal(cli.status, 0, cli.stderr); assert.equal(slash.status, 0, slash.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), JSON.parse(slash.stdout));
    writeFileSync(path, '{'); assert.equal(call(['design-check', `--input=${path}`]).status, 1);
  } finally { rmSync(dir, { recursive: true }); }
});
