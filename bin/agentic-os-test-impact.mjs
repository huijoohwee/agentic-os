/** Conservative source impact: literal references plus reviewed non-import contracts. No execution. */
import { posix } from 'node:path';

export const IMPACT_VERSION = 'agentic-os/test-impact/v1';
export const CONTRACT_PATH = 'test/impact-contracts.json';
const testPath = name => `__tests__/${name}`;
const isTest = path => /^__tests__\/[^/]+\.test\.mjs$/u.test(path);
const matches = (path, input) => input.endsWith('/') ? path.startsWith(input)
  : input === 'bin/agentic-os-test' ? path.startsWith(input) : path === input;
const unique = values => [...new Set(values)].sort();

export function validateContracts(value, files) {
  const fail = () => { throw new Error('blocked-test-impact-contracts'); };
  if (!value || value.schema !== 'agentic-os/test-impact-contracts/v1'
    || Object.keys(value).sort().join() !== 'broad,dependencies,packaging,rules,schema,sentinels') fail();
  const paths = list => Array.isArray(list) && list.length <= 256 && list.every(path =>
    typeof path === 'string' && path.length > 0 && path.length <= 256 && !/[\\\x00-\x1f]/u.test(path)
    && !path.startsWith('/') && !path.split('/').includes('..')) && new Set(list).size === list.length;
  const tests = list => paths(list) && list.every(name => isTest(testPath(name)) && files.has(testPath(name)));
  if (!tests(value.sentinels) || !value.sentinels.length || !tests(value.packaging)
    || !paths(value.broad) || !Array.isArray(value.rules) || value.rules.length > 64
    || new Set(value.rules.map(rule => rule.id)).size !== value.rules.length) fail();
  for (const rule of value.rules) {
    if (Object.keys(rule).sort().join() !== 'id,inputs,tests' || !/^[a-z][a-z-]+$/u.test(rule.id)
      || !paths(rule.inputs) || !tests(rule.tests)) fail();
  }
  if (!value.dependencies || Array.isArray(value.dependencies)
    || Object.keys(value.dependencies).length > 256) fail();
  for (const [path, inputs] of Object.entries(value.dependencies))
    if (!files.has(path) || !paths(inputs) || !inputs.length || inputs.some(input =>
      ![...files.keys()].some(candidate => matches(candidate, input)))) fail();
  return value;
}

// A superset of imports: also includes literal file reads, subprocess entrypoints and re-exports.
// Undeclared computed imports are opaque; no changed input is assumed independent of them.
export function references(path, text, files, exports = {}) {
  const dependencies = new Set(), unresolved = [];
  const addReference = original => {
    const specifier = original.split(/[?#]/u)[0];
    if (specifier.includes('${') || specifier.includes('\\')) return;
    const exported = specifier === 'agentic-os' ? exports['.']
      : specifier.startsWith('agentic-os/') ? exports[`./${specifier.slice(11)}`] : null;
    const candidates = [specifier, posix.normalize(posix.join(posix.dirname(path), specifier))];
    if (typeof exported === 'string') candidates.push(exported.replace(/^\.\//u, ''));
    // Also recognize split join(root, 'bin', 'entry.mjs') arguments by unique basename.
    if (!specifier.includes('/') && /\.(?:mjs|json|md|txt)$/u.test(specifier))
      candidates.push(...[...files.keys()].filter(file => posix.basename(file) === specifier));
    for (const candidate of candidates) if (candidate !== path && files.has(candidate)) dependencies.add(candidate);
  };
  for (const match of text.matchAll(/(["'`])((?:\\[\s\S]|(?!\1)[^\\\r\n])*)\1/gu)) addReference(match[2]);
  const modulePatterns = [
    /\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?['"]([^'"\n]+)['"]/gu,
    /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]/gu,
  ];
  for (const pattern of modulePatterns) for (const match of text.matchAll(pattern)) {
    const specifier = match[1].split(/[?#]/u)[0];
    if (specifier.startsWith('node:')) continue;
    addReference(specifier);
    const target = posix.normalize(posix.join(posix.dirname(path), specifier));
    const self = specifier === 'agentic-os' ? exports['.']
      : specifier.startsWith('agentic-os/') ? exports[`./${specifier.slice(11)}`] : null;
    if (specifier.startsWith('.') ? !files.has(target) : typeof self !== 'string' || !files.has(self.replace(/^\.\//u, '')))
      unresolved.push(specifier);
  }
  if (/\b(?:import|require)\s*\(\s*[^'"\s]/u.test(text)) unresolved.push('computed-module-load');
  if (/\bimport\.meta\.resolve\s*\(\s*[^'"\s]/u.test(text)) unresolved.push('computed-module-resolution');
  if (/\b(?:import|export|require)\s*\/[/*]/u.test(text)) unresolved.push('comment-separated-module-load');
  return { dependencies, unresolved };
}

function reverseGraph(files, contracts) {
  const graph = new Map(), opaque = new Set();
  let exports = {};
  try { exports = JSON.parse(files.get('package.json')?.text ?? '{}').exports ?? {}; } catch { opaque.add('package.json'); }
  const link = (dependency, consumer) => {
    if (!graph.has(dependency)) graph.set(dependency, new Set());
    graph.get(dependency).add(consumer);
  };
  for (const [path, file] of files) {
    if (!path.endsWith('.mjs')) continue;
    const found = references(path, file.text, files, exports);
    found.dependencies.forEach(dependency => link(dependency, path));
    if (found.unresolved.length && !Object.hasOwn(contracts.dependencies, path)) opaque.add(path);
  }
  for (const [consumer, inputs] of Object.entries(contracts.dependencies))
    for (const path of files.keys()) if (inputs.some(input => matches(path, input)) && path !== consumer) link(path, consumer);
  return { graph, opaque };
}

export function selectTests({ before, after, changed, forceAll = false }) {
  const contracts = validateContracts(JSON.parse(after.get(CONTRACT_PATH)?.text ?? 'null'), after);
  const tests = [...after.keys()].filter(isTest).sort();
  if (!tests.length || tests.length > 256) throw new Error('blocked-test-suite-inventory');
  const selected = new Map(), broadReasons = [];
  const add = (path, reason) => { if (isTest(path) && after.has(path)) {
    if (!selected.has(path)) selected.set(path, new Set()); selected.get(path).add(reason);
  } };
  contracts.sentinels.forEach(name => add(testPath(name), 'safety-sentinel'));
  if (forceAll) broadReasons.push('explicit-all');
  if (changed.length > 128) broadReasons.push('change-count');
  for (const path of changed) {
    if (path === CONTRACT_PATH || path === 'package.json' || path.startsWith('bin/agentic-os-test'))
      broadReasons.push(`selector-or-command:${path}`);
    if (contracts.broad.some(input => matches(path, input))) broadReasons.push(`shared-contract:${path}`);
    add(path, `changed:${path}`);
    for (const rule of contracts.rules) if (rule.inputs.some(input => matches(path, input)))
      rule.tests.forEach(name => add(testPath(name), `contract:${rule.id}`));
  }
  // Union old and new edges so removed imports and deleted/renamed modules retain their consumers.
  const graphs = [reverseGraph(before, contracts), reverseGraph(after, contracts)];
  // An unresolved loader can read any changed input. Never assume it is unrelated.
  if (changed.length) for (const { opaque } of graphs) for (const path of opaque) {
    if (isTest(path)) add(path, 'opaque-test-inputs');
    else broadReasons.push(`opaque-dependency:${path}`);
  }
  for (const origin of changed) {
    const visited = new Set([origin]), pending = [origin];
    for (let index = 0; index < pending.length; index++) {
      const path = pending[index];
      add(path, `dependency:${origin}`);
      for (const { graph, opaque } of graphs) {
        if (opaque.has(path) && !isTest(path)) broadReasons.push(`opaque-dependency:${path}`);
        for (const consumer of graph.get(path) ?? []) if (!visited.has(consumer)) {
          visited.add(consumer); pending.push(consumer);
        }
      }
    }
    const mapped = isTest(origin) || contracts.rules.some(rule => rule.inputs.some(input => matches(origin, input)))
      || [...visited].some(isTest) || contracts.broad.some(input => matches(origin, input));
    if (!mapped) broadReasons.push(`unmapped:${origin}`);
  }
  if (selected.size > Math.ceil(tests.length * 0.8)) broadReasons.push('affected-suite-threshold');
  if (broadReasons.length) tests.forEach(path => add(path, 'broad-impact'));
  const packaging = new Set(contracts.packaging.map(testPath));
  const suites = [...selected].sort(([a], [b]) => a.localeCompare(b)).map(([path, reasons]) =>
    ({ path, reasons: [...reasons].sort(), stage: packaging.has(path) ? 'packaging' : 'behavior' }));
  return { schema: IMPACT_VERSION, mode: broadReasons.length ? 'broad' : 'affected',
    reasons: unique(broadReasons), changed: unique(changed), available: tests.length, suites,
    stages: ['behavior', 'packaging'].map(name => ({ name, tests: suites.filter(suite => suite.stage === name).map(suite => suite.path) })) };
}
