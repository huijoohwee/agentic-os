/** Consumer-owned check contracts; shared selection and dependency ordering, no execution. */
export const VALIDATION_POLICY = '.agentic-os-validation.json';
export const VALIDATION_VERSION = 'agentic-os/repository-validation/v1';
const fail = detail => { throw new Error(`blocked-validation-policy:${detail}`); };
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== [...keys].sort().join()) fail('fields');
};
const names = (value, maximum = 128) => {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length
    || value.some(item => typeof item !== 'string' || !item || item.length > 512 || /[\x00-\x1f]/u.test(item))) fail('list');
  return value;
};
export function inputPath(value) {
  if (value === '*') return value;
  const normalized = value.endsWith('/') ? value.slice(0, -1) : value;
  if (!normalized || normalized.startsWith('/') || normalized.includes('\\')
    || normalized.split('/').some(part => ['', '.', '..', '.git'].includes(part))) fail('input-path');
  return value;
}
export const matchesInput = (file, input) => input === '*' || file === input
  || input.endsWith('/') && file.startsWith(input);
export function validateValidationPolicy(value) {
  exact(value, ['schema', 'repository', 'broadInputs', 'always', 'fallback', 'checks',
    ...(Object.hasOwn(value ?? {}, 'reviewBodyCheck') ? ['reviewBodyCheck'] : [])]);
  if (value.reviewBodyCheck !== undefined) {
    if (typeof value.reviewBodyCheck !== 'string' || value.reviewBodyCheck.length > 512
      || !/^[a-zA-Z0-9._/-]+\.mjs$/u.test(value.reviewBodyCheck)) fail('review-body-check');
    inputPath(value.reviewBodyCheck);
  }
  if (value.schema !== 'agentic-os/repository-validation-policy/v1'
    || !/^github\.com\/[a-z0-9._-]+\/[a-z0-9._-]+$/iu.test(value.repository)) fail('identity');
  names(value.broadInputs).forEach(inputPath);
  names(value.always); names(value.fallback);
  if (!value.fallback.length || !Array.isArray(value.checks) || !value.checks.length || value.checks.length > 128) fail('checks');
  const ids = new Set(), commands = new Set();
  for (const check of value.checks) {
    exact(check, ['id', 'command', 'inputs', 'requires', 'reuse', 'timeoutMs']);
    if (!/^[a-z][a-z0-9.-]{0,95}$/u.test(check.id) || ids.has(check.id)) fail('check-id');
    ids.add(check.id);
    if (!Array.isArray(check.command) || !check.command.length || check.command.length > 32
      || check.command.some(arg => typeof arg !== 'string' || !arg || arg.length > 2048 || /[\x00-\x1f]/u.test(arg))
      || !['node', 'npm', 'python3'].includes(check.command[0])) fail('command');
    const key = JSON.stringify(check.command);
    if (commands.has(key)) fail('duplicate-command');
    commands.add(key);
    names(check.inputs, 256).forEach(inputPath); names(check.requires);
    if (!['local', 'never'].includes(check.reuse) || !Number.isInteger(check.timeoutMs)
      || check.timeoutMs < 100 || check.timeoutMs > 900_000) fail('execution-bounds');
    if (check.reuse === 'local' && !check.inputs.length) fail('unbounded-local-reuse');
  }
  for (const id of [...value.always, ...value.fallback, ...value.checks.flatMap(check => check.requires)])
    if (!ids.has(id)) fail('unknown-check');
  orderChecks(value.checks, ids);
  return value;
}
function orderChecks(checks, selected) {
  const byId = new Map(checks.map(check => [check.id, check])), visiting = new Set(), done = new Set(), ordered = [];
  const visit = id => {
    if (visiting.has(id)) fail('dependency-cycle');
    if (done.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).requires) visit(dependency);
    visiting.delete(id); done.add(id); ordered.push(byId.get(id));
  };
  for (const check of checks) if (selected.has(check.id)) visit(check.id);
  return ordered;
}
const sharedChange = path => path === VALIDATION_POLICY || path === '.agentic-os.json'
  || path.startsWith('.github/') || path.startsWith('.githooks/')
  || /(^|\/)(?:package(?:-lock)?\.json|(?:pnpm-lock|yarn)\.(?:yaml|lock)|\.npmrc)$/u.test(path);
export function selectValidationChecks(policy, changed, { all = false, only = [] } = {}) {
  validateValidationPolicy(policy);
  names(only);
  if (only.some(id => !policy.checks.some(check => check.id === id))) fail('unknown-partition-check');
  const selected = new Map(), affected = new Set(), broadReasons = [], unmatchedPaths = [];
  const add = (id, reason) => {
    if (!selected.has(id)) selected.set(id, new Set());
    selected.get(id).add(reason);
  };
  policy.always.forEach(id => add(id, 'mandatory'));
  if (all) broadReasons.push('explicit-all');
  for (const path of [...new Set(changed)].sort()) {
    if (sharedChange(path) || policy.broadInputs.some(input => matchesInput(path, input))) broadReasons.push(`shared-input:${path}`);
    const matches = policy.checks.filter(check => check.inputs.some(input => matchesInput(path, input)));
    for (const check of matches) { add(check.id, `input:${path}`); affected.add(check.id); }
    if (!matches.length) unmatchedPaths.push(path);
  }
  const pending = [...affected];
  for (let index = 0; index < pending.length; index++) {
    for (const check of policy.checks) if (check.requires.includes(pending[index]) && !affected.has(check.id)) {
      affected.add(check.id); pending.push(check.id); add(check.id, `dependency-input:${pending[index]}`);
    }
  }
  if (broadReasons.length || unmatchedPaths.length) {
    // Fallback is the owner's complete broad plan. Do not also replay overlapping narrow checks.
    selected.clear(); policy.always.forEach(id => add(id, 'mandatory'));
    policy.fallback.forEach(id => add(id, broadReasons.length ? 'broad-impact' : 'unknown-impact'));
  }
  const requested = [...selected.keys()].filter(id => !only.length || only.includes(id));
  const checks = orderChecks(policy.checks, new Set(requested)).map(check => ({ ...check,
    reasons: [...(selected.get(check.id) ?? new Set(['required-dependency']))].sort() }));
  return { schema: VALIDATION_VERSION, mode: broadReasons.length || unmatchedPaths.length ? 'broad' : 'affected',
    changed: [...new Set(changed)].sort(), broadReasons, unmatchedPaths, partition: only.length ? [...only] : null,
    available: policy.checks.length, checks };
}
export function checkInputPatterns(policy, id) {
  const checks = orderChecks(policy.checks, new Set([id]));
  return [...new Set(checks.flatMap(check => check.inputs))];
}
