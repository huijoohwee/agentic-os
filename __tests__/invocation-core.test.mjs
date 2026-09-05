import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import {
  PREFIX_KINDS,
  parseInvocationToken,
  malformedInvocationRuleFor,
  canonicalInvocationToken,
  kindForInvocationToken,
  canonicalCatalogInput,
  serializeInvocationCatalogForDigest,
  serializeInvocationRoutingForDigest,
} from '../src/invocation.mjs';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('exact grammar returns declarations and opaque arguments without product dispatch policy', () => {
  assert.deepEqual(PREFIX_KINDS, { '/': 'command', '#': 'semantic', '@': 'binding' });
  assert.ok(Object.isFrozen(PREFIX_KINDS));
  assert.deepEqual(parseInvocationToken('/query'), {
    prefix: '/', kind: 'command', canonical: '/query', argument: null,
  });
  assert.deepEqual(parseInvocationToken('#runtime-ready'), {
    prefix: '#', kind: 'semantic', canonical: '#runtime-ready', argument: null,
  });
  assert.deepEqual(parseInvocationToken('@scope:'), {
    prefix: '@', kind: 'binding', canonical: '@scope:', argument: '',
  });
  const argument = 'workspace /odd path:ABC\n$(echo x)\u0000😀';
  assert.deepEqual(parseInvocationToken(`@scope:${argument}`), {
    prefix: '@', kind: 'binding', canonical: '@scope:', argument,
  });
  assert.equal(parseInvocationToken('/unregistered-command').canonical, '/unregistered-command');
  assert.equal(parseInvocationToken('@mcp-gateway').argument, null);
});

test('grammar bounds names and arguments without trimming or interpreting token bodies', () => {
  for (const prefix of ['/', '#', '@']) {
    assert.equal(parseInvocationToken(`${prefix}${'a'.repeat(128)}`).error, undefined);
    assert.deepEqual(parseInvocationToken(`${prefix}${'a'.repeat(129)}`), { error: 'remainder-too-long' });
  }
  assert.equal(parseInvocationToken(`@scope:${'😀'.repeat(512)}`).argument.length, 1024);
  assert.deepEqual(parseInvocationToken(`@scope:${'😀'.repeat(513)}`), { error: 'argument-too-long' });
  for (const token of [null, undefined, 42, {}, '', ' /query', 'query']) {
    assert.deepEqual(parseInvocationToken(token), { error: 'invalid-prefix' });
  }
  for (const token of ['/', '#', '@', '@:argument']) {
    assert.deepEqual(parseInvocationToken(token), { error: 'empty-remainder' });
  }
  for (const token of ['/UPPER', '#a_b', '@a b:', '/query ', '/café']) {
    assert.deepEqual(parseInvocationToken(token), { error: 'invalid-remainder-character' });
  }
  for (const token of ['/query:value', '#ready:value']) {
    assert.deepEqual(parseInvocationToken(token), { error: 'argument-prefix' });
    assert.equal(malformedInvocationRuleFor(token), 'invalid-remainder-character');
  }
  assert.equal(malformedInvocationRuleFor('@scope:'), '');
  assert.equal(malformedInvocationRuleFor('@:value'), 'empty-remainder');
});

test('declaration projection and discovery classification retain distinct caller contracts', () => {
  assert.equal(canonicalInvocationToken('@scope:a:b /query'), '@scope:');
  assert.equal(canonicalInvocationToken('@scope:'), '@scope:');
  assert.equal(canonicalInvocationToken('@mcp-gateway'), '@mcp-gateway');
  assert.equal(canonicalInvocationToken('/query:value'), '/query:value');
  assert.equal(canonicalInvocationToken(' @scope:value'), ' @scope:value');
  assert.equal(kindForInvocationToken(' / '), 'command');
  assert.equal(kindForInvocationToken(' #ready '), 'semantic');
  assert.equal(kindForInvocationToken(' @ '), 'binding');
  assert.equal(kindForInvocationToken('/invalid body'), 'command');
  assert.equal(kindForInvocationToken({ toString: () => ' @scope: ' }), 'binding');
  for (const token of [null, undefined, false, 0, '', 'unknown']) {
    assert.equal(kindForInvocationToken(token), '');
  }
});

test('dictionary digest bytes preserve kind ordering, ordinal tokens, and unchanged fields', () => {
  const entries = freeze([
    { token: '@scope:', kind: 'binding', label: 'scope:', summary: 'Bind', sourcePath: 'bindings.md' },
    { token: '/a.b', kind: 'command', label: 'a.b', summary: ' Second ', sourcePath: 'commands.md' },
    { token: '#ready', kind: 'semantic', label: 'ready', summary: 'Ready', sourcePath: 'tags.md' },
    { token: '/a-b', kind: 'command', label: 'a-b', summary: 'First  entry', sourcePath: 'commands.md', extra: 'ignored' },
  ]);
  const golden = '[{"token":"/a-b","kind":"command","label":"a-b","summary":"First  entry","sourcePath":"commands.md"},{"token":"/a.b","kind":"command","label":"a.b","summary":" Second ","sourcePath":"commands.md"},{"token":"#ready","kind":"semantic","label":"ready","summary":"Ready","sourcePath":"tags.md"},{"token":"@scope:","kind":"binding","label":"scope:","summary":"Bind","sourcePath":"bindings.md"}]';
  assert.equal(canonicalCatalogInput(entries), golden);
  assert.equal(canonicalCatalogInput([...entries].reverse()), golden);
  assert.equal(canonicalCatalogInput([]), '[]');
});

test('discovery catalog digest bytes preserve normalization, locale ordering, and final newline', () => {
  const entries = freeze([
    { token: ' /query ', kind: ' COMMAND ', label: ' Query ', summary: ' Find  things\nnow ', sourcePath: ' docs/commands.md ', extra: 'ignored' },
    { token: ' @scope: ', kind: ' BINDING ', label: ' scope: ', summary: ' Bind a scope ', sourcePath: ' docs/bindings.md ' },
    { token: ' #ready ', kind: ' SEMANTIC ', label: ' Ready ', summary: ' ready ', sourcePath: ' docs/tags.md ' },
    { token: ' /ask ', kind: ' command ', label: 0, summary: false, sourcePath: null },
  ]);
  const golden = '[{"token":"@scope:","kind":"binding","label":"scope:","summary":"Bind a scope","sourcePath":"docs/bindings.md"},{"token":"/ask","kind":"command","label":"","summary":"","sourcePath":""},{"token":"/query","kind":"command","label":"Query","summary":"Find  things\\nnow","sourcePath":"docs/commands.md"},{"token":"#ready","kind":"semantic","label":"Ready","summary":"ready","sourcePath":"docs/tags.md"}]\n';
  assert.equal(serializeInvocationCatalogForDigest(entries), golden);
  assert.equal(serializeInvocationCatalogForDigest([...entries].reverse()), golden);
  assert.equal(serializeInvocationCatalogForDigest(), '[]\n');
});

test('routing digest bytes preserve ordered deduplication, sigil filters, and scalar fallback', () => {
  const routes = freeze([
    { token: ' /query ', kind: ' COMMAND ', sourcePath: ' docs/commands.md ', mcpTools: [' z.tool ', 'a.tool', 'z.tool', '', false], semantics: [' #ready ', '#ready', '/bad', '#review'], bindings: [' @scope: ', '@scope:', '#wrong', '@device:'] },
    { token: ' /ask ', kind: ' command ', sourcePath: ' docs/commands.md ', mcpTool: ' single.tool ', semantics: 'not-an-array', bindings: ['@device:'] },
    { token: ' #ready ', kind: ' SEMANTIC ', sourcePath: ' docs/tags.md ', mcpTools: [], mcpTool: 'must-not-fallback' },
  ]);
  const golden = '{"schema":"agentic-canvas-os-docs-routing/v1","routes":[{"token":"/ask","kind":"command","sourcePath":"docs/commands.md","mcpTools":["single.tool"],"semantics":[],"bindings":["@device:"]},{"token":"/query","kind":"command","sourcePath":"docs/commands.md","mcpTools":["z.tool","a.tool"],"semantics":["#ready","#review"],"bindings":["@scope:","@device:"]},{"token":"#ready","kind":"semantic","sourcePath":"docs/tags.md","mcpTools":[],"semantics":[],"bindings":[]}]}\n';
  assert.equal(serializeInvocationRoutingForDigest(routes, 'agentic-canvas-os-docs-routing/v1'), golden);
  assert.equal(serializeInvocationRoutingForDigest(undefined, 'other-owner/v2'), '{"schema":"other-owner/v2","routes":[]}\n');
  for (const schema of [undefined, null, 0, {}, '', ' \n ']) {
    assert.throws(() => serializeInvocationRoutingForDigest([], schema), /schema must be a nonempty string/);
  }
});

test('public package subpath resolves directly to the shared module', async () => {
  const packaged = await import('agentic-os/invocation');
  assert.equal(import.meta.resolve('agentic-os/invocation'), new URL('../src/invocation.mjs', import.meta.url).href);
  assert.equal(packaged.parseInvocationToken, parseInvocationToken);
  assert.equal(packaged.serializeInvocationRoutingForDigest, serializeInvocationRoutingForDigest);
});

test('shared module executes with no imports or Node globals in an isolated ECMAScript context', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { createContext, SourceTextModule } from 'node:vm';
    const context = createContext({});
    const module = new SourceTextModule(readFileSync(new URL(process.argv[1]), 'utf8'), { context });
    assert.equal(module.dependencySpecifiers.length, 0);
    await module.link(() => { throw new Error('shared module requested a dependency'); });
    await module.evaluate();
    const api = module.namespace;
    assert.equal(api.parseInvocationToken('@scope:offline').argument, 'offline');
    assert.equal(api.malformedInvocationRuleFor('/query:value'), 'invalid-remainder-character');
    assert.equal(api.canonicalInvocationToken('@scope:offline'), '@scope:');
    assert.equal(api.kindForInvocationToken(' / '), 'command');
    assert.equal(api.canonicalCatalogInput([]), '[]');
    assert.equal(api.serializeInvocationCatalogForDigest(), '[]\\n');
    assert.equal(api.serializeInvocationRoutingForDigest([], 'browser/v1'), '{"schema":"browser/v1","routes":[]}\\n');
    assert.equal(context.process, undefined);
    assert.equal(context.Buffer, undefined);
  `;
  execFileSync(process.execPath, [
    '--experimental-vm-modules', '--input-type=module', '--eval', script,
    new URL('../src/invocation.mjs', import.meta.url).href,
  ], { timeout: 10_000, stdio: 'pipe' });
});
