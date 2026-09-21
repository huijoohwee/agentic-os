import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { fixture, consolidate, policy } from './helpers/workspace.mjs';
import { syncWorkspace } from '../bin/agentic-os-workspace-sync.mjs';
import { memoryArguments } from '../bin/agentic-os-argv.mjs';
import { handleRequest, MODERN_VERSION, TOOLS } from '../src/mcp-server.mjs';
import { runCli } from '../src/mcp-stdio.mjs';
import { ensureRepositoryTrust } from '../src/git-repository.mjs';
import { memoryTaskContext, searchMemory, captureMemory } from '../bin/agentic-os-memory-task.mjs';
import { dispatchInvocation, resolveInvocation, loadCatalog } from '../bin/agentic-os-invocation.mjs';

const meta = { 'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
  'io.modelcontextprotocol/clientInfo': { name: 'memory-test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {} };
const request = args => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory', arguments: args, _meta: meta } });
const block = (id = '20260921T010000Z', summary = 'Keep decisions source-bound.') =>
  `## @mem-${id}\ntype: decision\nscope: memory-mcp\nsummary: ${summary}\nrefs: [../proof.md]\n`;
const header = '---\nschema: memory-log/v1\nagent: test\ndevice: test\nperiod: 2026-09\ntimestamp_format: YYYYMMDDTHHmmssZ\nappend_policy: append-only\nsource_contract: https://example.invalid/memory-log\n---\n';
const handoff = entry => `# Handoff\n\n\x60\x60\x60memory-log/v1\n${entry}\x60\x60\x60\n`;
const parse = output => JSON.parse(output.slice(output.indexOf('{')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function setup(t) {
  const s = consolidate(fixture(t));
  mkdirSync(join(s.sources.memory, 'records'));
  writeFileSync(join(s.sources.memory, 'records/2026-09.md'), header + block());
  writeFileSync(join(s.sources.memory, 'proof.md'), 'cited proof\nsecond line\n');
  s.commit(s.container); s.run(s.container, ['push', '--quiet', 'origin', 'main']);
  const receipt = syncWorkspace(s.root, policy);
  return { ...s, receipt, revision: receipt.sourceRevision };
}
async function rpc(s, args, extra = {}) {
  const result = await handleRequest(request({ revision: s.revision, ...args }), { cwd: s.root, runCli, ...extra });
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result.result;
}
function tuple(input, store = 'workspace') {
  return ['/memory.search', '#memory-search', '#truth', '#vcc', '@agent:test', `@memory-store:${store}`, '@operator:test', `@input:${input}`];
}

test('MCP argument validation fails before runner and advertises proposal-only read semantics', async () => {
  const memory = TOOLS.find(tool => tool.name === 'memory');
  assert.deepEqual(memory.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const base = { operation: 'search', revision: 'a'.repeat(40), query: 'known' };
  for (const args of [undefined, null, [], {}, { ...base, operation: 'write' }, { ...base, revision: 'main' },
    { ...base, source: '/tmp/memory' }, { ...base, offline: true }, { ...base, limit: 21 },
    { ...base, query: '\nsecret' }, { ...base, query: 'é'.repeat(129) }, { ...base, afterLine: -1 },
    { ...base, operation: 'read' }, { ...base, operation: 'capture', handoff: '/tmp/a' },
    { operation: 'read', revision: base.revision, path: '.memory/proof.md', lines: 81 },
    { operation: 'capture', revision: base.revision, handoff: 'x'.repeat(4097) }]) {
    let called = false;
    const result = await handleRequest(request(args), { runCli: async () => { called = true; } });
    assert.equal(result.error.code, -32602); assert.equal(called, false);
  }
  const calls = [];
  const controller = new AbortController();
  const good = await handleRequest(request(base), { signal: controller.signal, runCli: async (argv, options) => {
    calls.push({ argv, options }); return { exitCode: 0, stdout: 'observation', stderr: '' };
  } });
  assert.equal(good.result.isError, false);
  assert.deepEqual(calls[0].argv, memoryArguments(base, memory.inputSchema));
  assert.equal(calls[0].options.effectful, false); assert.equal(calls[0].options.signal, controller.signal);
});

test('real MCP CLI and tuple match pinned offline results while preserving dirty source and cache', async t => {
  const s = setup(t), index = s.receipt.sources.memory.index, before = readFileSync(index), inode = statSync(index).ino;
  const query = { revision: s.revision, query: 'source-bound', limit: 1 };
  const input = join(s.parent, 'query.json'); writeFileSync(input, JSON.stringify(query));
  const direct = s.invoke('memory', 'search', `--revision=${s.revision}`, '--query=source-bound', '--limit=1');
  assert.equal(direct.status, 0, direct.stderr);
  writeFileSync(join(s.sources.memory, 'proof.md'), 'unfinished owner work\n');
  renameSync(s.config.remote, `${s.config.remote}-offline`);
  const refs = s.run(s.container, ['show-ref']);
  const response = await rpc(s, { operation: 'search', ...query });
  assert.equal(response.isError, false, response.structuredContent.stderr);
  assert.deepEqual(parse(response.structuredContent.stdout), parse(direct.stdout));
  const viaTuple = s.invoke(...tuple(input));
  assert.equal(viaTuple.status, 0, viaTuple.stderr);
  assert.deepEqual(parse(viaTuple.stdout), parse(direct.stdout));
  assert.equal((await rpc(s, { operation: 'read', path: '.memory/proof.md', lines: 1 })).isError, false);
  const excerpt = await rpc(s, { operation: 'read', path: '.memory/proof.md', line: 2, lines: 1 });
  assert.deepEqual(parse(excerpt.structuredContent.stdout).lines, ['second line']);
  assert.equal((await rpc(s, { operation: 'read', path: '../outside' })).isError, true);
  assert.equal(readFileSync(join(s.sources.memory, 'proof.md'), 'utf8'), 'unfinished owner work\n');
  assert.deepEqual(readFileSync(index), before); assert.equal(statSync(index).ino, inode);
  assert.equal(s.run(s.container, ['show-ref']), refs);
  assert.equal(parse(response.structuredContent.stdout).remoteFreshness, 'not-checked-refresh-before-effects');
  assert.equal(parse(response.structuredContent.stdout).grantsAuthority, false);
  s.run(s.root, ['config', '--local', 'agentic-os.memoryRoot', '../other']);
  assert.match((await rpc(s, { operation: 'search', query: 'source-bound' })).structuredContent.stderr, /duplicate-enrollment/);
  s.run(s.root, ['config', '--local', '--unset-all', 'agentic-os.memoryRoot']);
  s.run(s.root, ['config', '--local', '--unset-all', 'agentic-os.workspaceRoot']);
  assert.match((await rpc(s, { operation: 'search', query: 'source-bound' })).structuredContent.stderr, /workspace-enrollment-required/);
});

test('tuple rejects wrong stores, incomplete/duplicate bindings and untrusted request or resolution changes', t => {
  const s = setup(t), input = join(s.parent, 'query.json');
  writeFileSync(input, JSON.stringify({ revision: s.revision, query: 'source-bound' }));
  const tokens = tuple(input), resolved = resolveInvocation(tokens);
  assert.equal(resolved.ok, true);
  assert.deepEqual(dispatchInvocation(resolved).argv, ['search', `--revision=${s.revision}`, '--query=source-bound']);
  assert.deepEqual(dispatchInvocation(resolveInvocation([...tokens].reverse())), dispatchInvocation(resolved));
  for (const values of [tuple(input, 'runtime'), tuple(input, '/tmp/store'), tokens.slice(0, -1),
    [...tokens.slice(0, -1), '@unknown:x'], [...tokens.slice(0, -1), '@agent:other'],
    tokens.map(token => token === '@agent:test' ? '@agent:../../other' : token)])
    assert.equal(resolveInvocation(values).ok, false);
  const catalog = structuredClone(loadCatalog()); catalog.digest = 'sha256:' + '0'.repeat(64);
  assert.equal(resolveInvocation(tokens, { catalog }).code, 'catalog-invalid');
  resolved.entries[0].entry.action = 'land'; assert.equal(dispatchInvocation(resolved).ok, false);
  for (const body of ['[]', '{', JSON.stringify({ revision: s.revision, query: 'x', operation: 'capture' }),
    JSON.stringify({ revision: 'main', query: 'x' }), 'x'.repeat(4097)]) {
    writeFileSync(input, body); assert.equal(dispatchInvocation(resolveInvocation(tokens)).code, 'memory-input-invalid');
  }
});

test('capture proposal can publish to a fixture source and converge on a second clone; old snapshots stay pinned', async t => {
  const s = setup(t), start = performance.now(), target = join(s.sources.memory, 'records/2026-09.md');
  const secondRoot = join(s.parent, 'device-two'), secondSource = join(s.parent, 'workspace-two');
  s.run(s.parent, ['clone', '--quiet', s.root, secondRoot]);
  s.run(s.parent, ['clone', '--quiet', s.config.remote, secondSource]);
  s.run(secondRoot, ['config', '--local', 'agentic-os.workspaceRoot', secondSource]);
  ensureRepositoryTrust(secondRoot, JSON.parse(readFileSync(join(secondRoot, '.agentic-os.json'))), { allowCreate: true });
  syncWorkspace(secondRoot, policy);
  const file = join(s.parent, 'handoff.md'), lesson = block('20260921T020000Z', 'Retain reviewed lessons across devices.');
  writeFileSync(file, handoff(lesson)); const before = readFileSync(target);
  const captured = await rpc(s, { operation: 'capture', handoff: file });
  assert.equal(captured.isError, false, captured.structuredContent.stderr);
  const proposal = parse(captured.structuredContent.stdout);
  assert.deepEqual(proposal, captureMemory(memoryTaskContext(s.root, policy, s.revision), handoff(lesson)));
  assert.deepEqual(readFileSync(target), before); assert.equal(proposal.sourceWritten, false);
  assert.equal(proposal.baseSha256, hash(before));
  assert.equal(proposal.baseBlob, s.run(s.container, ['rev-parse', `${s.revision}:${proposal.path}`]));
  // Fixture-owned reviewed publication: production publication remains a separate authorized effect.
  writeFileSync(target, Buffer.concat([before, Buffer.from(proposal.append)]));
  s.commit(s.container); s.run(s.container, ['push', '--quiet', 'origin', 'main']);
  const newer = syncWorkspace(s.root, policy), second = syncWorkspace(secondRoot, policy);
  assert.equal(newer.sourceRevision, second.sourceRevision);
  assert.match((await rpc(s, { operation: 'capture', handoff: file })).structuredContent.stderr, /refresh-before-capture/);
  const old = await rpc(s, { operation: 'search', query: 'reviewed lessons' });
  assert.equal(parse(old.structuredContent.stdout).matches.length, 0);
  const readback = await rpc({ ...s, root: secondRoot, revision: second.sourceRevision }, { operation: 'search', query: 'reviewed lessons' });
  assert.equal(readback.isError, false, readback.structuredContent.stderr);
  assert.equal(parse(readback.structuredContent.stdout).matches.length, 1);
  const replay = await rpc({ ...s, revision: newer.sourceRevision }, { operation: 'capture', handoff: file });
  assert.equal(parse(replay.structuredContent.stdout).status, 'already-present');
  writeFileSync(file, handoff(block('20260921T020000Z', 'Conflicting lesson.')));
  assert.match((await rpc({ ...s, revision: newer.sourceRevision }, { operation: 'capture', handoff: file })).structuredContent.stderr, /record-id-conflict/);
  t.diagnostic(JSON.stringify({ scope: 'two-clone fixture', activeMs: Math.round(performance.now() - start),
    proposalBytes: Buffer.byteLength(proposal.append), recallMatches: 1, modelCalls: 0, modelTokens: 0,
    productionPublished: false, measuredHumanSavings: null }));
});

test('stdio MCP exposes the same task-memory result after a fresh process starts', async t => {
  const s = setup(t);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/agentic-os-mcp.mjs', import.meta.url))],
    { cwd: s.root, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout }); t.after(() => lines.close());
  const reply = once(lines, 'line', { signal: AbortSignal.timeout(10000) });
  child.stdin.write(JSON.stringify(request({ operation: 'search', revision: s.revision, query: 'source-bound' })) + '\n');
  const response = JSON.parse((await reply)[0]);
  assert.equal(response.result.isError, false);
  assert.deepEqual(parse(response.result.structuredContent.stdout), searchMemory(memoryTaskContext(s.root, policy, s.revision), { query: 'source-bound' }));
  child.stdin.end(); await once(child, 'exit');
});
