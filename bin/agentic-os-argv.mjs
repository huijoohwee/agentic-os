/** Exact, fail-loud CLI argument grammar. */

function exact(argv, {
  min = 0, max = min, options = [], flags = [], requiredOptions = [], requiredFlags = [],
}) {
  const positionals = [];
  const seen = new Set();
  for (const token of argv) {
    if (typeof token !== 'string' || token.length === 0) return 'arguments must be nonempty strings';
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    const name = token.slice(2, equals < 0 ? undefined : equals);
    const kind = equals < 0 ? 'flag' : 'option';
    if (kind === 'flag' ? !flags.includes(name) : !options.includes(name))
      return `unknown or malformed ${token}`;
    if (seen.has(name)) return `duplicate --${name}`;
    if (kind === 'option' && token.slice(equals + 1).length === 0) return `empty --${name}`;
    seen.add(name);
  }
  if (positionals.length < min || positionals.length > max)
    return `expected ${min === max ? min : `${min}-${max}`} positional argument(s)`;
  const missingOption = requiredOptions.find((name) => !seen.has(name));
  if (missingOption) return `missing --${missingOption}=<value>`;
  const missingFlag = requiredFlags.find((name) => !seen.has(name));
  if (missingFlag) return `missing --${missingFlag}`;
  return null;
}

export function validateCommandArguments(command, argv) {
  switch (command) {
    case 'help': case '--help': return exact(argv, {});
    case 'setup': case 'git-configure': case 'guard-install': case 'doctor':
      return exact(argv, {});
    case 'start': return exact(argv, { min: 1, max: 1, options: ['device', 'write'] });
    case 'land': return exact(argv, { options: ['message'] });
    case 'status': return exact(argv, { options: ['device'] });
    case 'reap': return exact(argv, { options: ['ref'], flags: ['apply'] });
    case 'finish': return exact(argv, { options: ['ref'], requiredOptions: ['ref'] });
    case 'autonomy-class':
      return exact(argv, { options: ['base', 'head'], flags: ['json'] });
    case 'observe': return exact(argv, { flags: ['provider', 'deep'] });
    case 'flight': {
      const error = exact(argv, { min: 1, options: ['requirements', 'checkpoint', 'ref'] });
      if (error) return error;
      const phase = argv.find((token) => !token.startsWith('--'));
      if (!['pre', 'in', 'post'].includes(phase)) return 'flight requires pre, in, or post';
      const checkpoint = argv.some((token) => token.startsWith('--checkpoint='));
      return checkpoint === (phase !== 'pre') ? null : 'in/post require a checkpoint; pre forbids one';
    }
    case 'request': {
      const error = exact(argv, { min: 1, max: 1, options: ['input'],
        requiredOptions: ['input'] });
      if (error) return error;
      return ['claim', 'continue', 'integrate', 'retire'].includes(argv[0])
        ? null : `unknown request operation ${JSON.stringify(argv[0])}`;
    }
    case 'canonical-sync': {
      const action = argv.find((token) => !token.startsWith('--')) ?? 'plan';
      return action === 'plan' ? exact(argv, { min: argv.length === 0 ? 0 : 1, max: 1,
        options: ['integration-receipt'] })
        : action === 'apply' ? exact(argv, { min: 1, max: 1,
          options: ['plan', 'authorize', 'exclusive'],
          requiredOptions: ['plan', 'authorize', 'exclusive'] }) : `unknown action ${action}`;
    }
    case 'reconcile': {
      const action = argv.find((token) => !token.startsWith('--')) ?? 'plan';
      return action === 'plan' ? exact(argv, { min: argv.length === 0 ? 0 : 1, max: 1,
        options: ['scope', 'integration-receipt'] })
        : action === 'apply' ? exact(argv, { min: 1, max: 1,
          options: ['plan', 'authorize', 'exclusive'],
          requiredOptions: ['plan', 'authorize', 'exclusive'] }) : `unknown action ${action}`;
    }
    case 'queue': {
      const action = argv.find((token) => !token.startsWith('--')) ?? 'show';
      return action === 'show' ? exact(argv, { min: argv.length === 0 ? 0 : 1, max: 1 })
        : action === 'apply' ? exact(argv, { min: 1, max: 1, flags: ['yes'],
          requiredFlags: ['yes'] })
          : `unknown action ${action}`;
    }
    default: return `unknown command ${JSON.stringify(command)}`;
  }
}

export function cmdHelp() {
  process.stdout.write(
    [
      'agentic-os — ADLC harness',
      '',
      '  npm run setup             write config and select packaged hooks without clobbering',
      '  npm run doctor            report harness and remote drift, change nothing',
      '  npm run lane -- <scope> --write=<path[,path...]>   open a path-scoped lane',
      '  npm run land              publish the exact lane head and request provider handoff',
      '  npm run finish -- --ref=<lane>  remove one clean, exactly integrated worktree',
      '  npm run status            registered lane projections and provider state',
      '  npm run reap [-- --ref=<lane>]  classify exact integration; never clean or retire authority',
      '  npm run sync:canonical    plan a recovery-backed canonical checkout synchronization',
      '  npm run reconcile         fetch, classify, and plan protected-main reconciliation',
      '  npm run autonomy:class    compute the committed candidate promotion ceiling',
      '  agentic-os flight pre|in|post  inspect prerequisites, drift, and completion',
      '  agentic-os observe        emit a shallow profile-bound repository observation',
      '  agentic-os request ...    construct an unsigned Coordination Request from JSON',
      '  npm run queue:show        inspect the required remote configuration',
      '  npm run queue:apply -- --yes  fail closed; provider policy is repository-owned',
      '',
    ].join('\n'),
  );
  return 0;
}

export function flag(argv, name) {
  return argv.includes(`--${name}`);
}
export function option(argv, name, fallback = null) {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
export function positional(argv) {
  return argv.filter((arg) => !arg.startsWith('--'));
}
