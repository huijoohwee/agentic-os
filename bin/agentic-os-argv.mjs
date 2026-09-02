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
    case 'setup': case 'git-configure': case 'guard-install': case 'doctor': case 'land':
      return exact(argv, {});
    case 'start': return exact(argv, { min: 1, max: 1, options: ['device'] });
    case 'status': return exact(argv, { options: ['device'] });
    case 'reap': return exact(argv, { options: ['ref'], flags: ['apply'] });
    case 'autonomy-class':
      return exact(argv, { options: ['base', 'head'], flags: ['json'] });
    case 'observe': return exact(argv, { flags: ['provider', 'deep'] });
    case 'request': {
      const error = exact(argv, { min: 1, max: 1, options: ['input'],
        requiredOptions: ['input'] });
      if (error) return error;
      return ['claim', 'continue', 'integrate', 'retire'].includes(argv[0])
        ? null : `unknown request operation ${JSON.stringify(argv[0])}`;
    }
    case 'canonical-sync': {
      const action = argv.find((token) => !token.startsWith('--')) ?? 'plan';
      return action === 'plan' ? exact(argv, { min: argv.length === 0 ? 0 : 1, max: 1 })
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
