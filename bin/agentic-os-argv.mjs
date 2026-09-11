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
    case 'pipeline': return exact(argv, { options: ['repo', 'run', 'head', 'attempt', 'timeout-ms'],
      requiredOptions: ['repo', 'run', 'head', 'attempt'] });
    case 'help': case '--help': return exact(argv, {});
    case 'setup': case 'git-configure': case 'guard-install': case 'doctor':
      return exact(argv, {});
    case 'profile': return argv[0] === 'init'
      ? exact(argv, { min: 1, options: ['repository'], requiredOptions: ['repository'] })
      : 'profile requires init --repository=<host/owner/name>';
    case 'pin': return exact(argv, { options: ['consumer', 'revision'], requiredOptions: ['consumer'] });
    case 'workspace': {
      if (argv[0] === 'check') return exact(argv, { min: 1,
        options: ['repository', 'config', 'base', 'head'], requiredOptions: ['repository', 'config', 'base', 'head'] });
      if (argv[0] === 'sync') return exact(argv, { min: 1, flags: ['offline'] });
      if (argv[0] === 'watch') return exact(argv, { min: 1, options: ['interval-ms', 'duration-ms'] });
      const error = exact(argv, { flags: ['offline'], options: ['source'] });
      const source = option(argv, 'source');
      return error ?? (source === null || ['memory', 'todo', 'artifacts'].includes(source)
        ? null : 'workspace source must be memory, todo, or artifacts');
    }
    case 'memory': {
      const operation = argv[0];
      const required = operation === 'search' ? ['revision', 'query']
        : operation === 'read' ? ['revision', 'path'] : operation === 'capture' ? ['revision', 'handoff'] : null;
      if (!required) return exact(argv, { flags: ['offline'] });
      const optional = operation === 'search' ? ['path', 'limit', 'after-line']
        : operation === 'read' ? ['line', 'lines'] : [];
      return exact(argv, { min: 1, options: [...required, ...optional], requiredOptions: required });
    }
    case 'start': return exact(argv, { min: 1, max: 1, options: ['device', 'write'] });
    case 'land': return exact(argv, { options: ['message', 'body-file'] });
    case 'successor': return exact(argv, { min: 1, max: 1, options: ['expected-head'] });
    case 'status': return exact(argv, { options: ['device'] });
    case 'reap': return exact(argv, { options: ['ref'], flags: ['apply'] });
    case 'finish': return exact(argv, { options: ['ref'], requiredOptions: ['ref'] });
    case 'autonomy-class':
      return exact(argv, { options: ['base', 'head'], flags: ['json'] });
    case 'observe': return argv.includes('--checks')
      ? exact(argv, { flags: ['checks'], options: ['input'], requiredOptions: ['input'] })
      : exact(argv, { flags: ['provider', 'deep'] });
    case 'flight': {
      if (argv[0] === 'gate') return exact(argv, { min: 1, options: ['context', 'operation'],
        requiredOptions: ['context', 'operation'] });
      const error = exact(argv, { min: 1, options: ['requirements', 'checkpoint', 'ref', 'operation'] });
      if (error) return error;
      const phase = argv.find((token) => !token.startsWith('--'));
      if (!['plan', 'pre', 'in', 'post'].includes(phase)) return 'flight requires plan, pre, in, or post';
      const checkpoint = argv.some((token) => token.startsWith('--checkpoint='));
      return checkpoint === (phase === 'in' || phase === 'post') ? null : 'in/post require a checkpoint; plan/pre forbid one';
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
      '  agentic-os profile init --repository=<host/owner/name>  print a fork profile; write no state',
      '  agentic-os pin --consumer=<root> [--revision=<sha>]  check exact consumer pin drift',
      '  npm run setup             write config and select packaged hooks without clobbering',
      '  agentic-os workspace [--offline] [--source=memory|todo|artifacts]  observe enrolled shared sources',
      '  agentic-os workspace sync [--offline]  refresh one committed workspace snapshot',
      '  agentic-os workspace watch [--interval-ms=30000] [--duration-ms=28800000]  refresh during this session',
      '  agentic-os workspace check --repository=<root> --config=<json> --base=<sha> --head=<sha>  check committed content',
      '  agentic-os memory [--offline]  refresh or reuse the enrolled shared-memory index',
      '  agentic-os memory search --revision=<sha> --query=<text> [--path=<memory-file>]  bounded local-only lookup',
      '  agentic-os memory read --revision=<sha> --path=<memory-file> [--line=1] [--lines=40]  pinned excerpt',
      '  agentic-os memory capture --revision=<sha> --handoff=<file>  validate one memory-log/v1 proposal; no writes',
      '  npm run doctor            report harness and remote drift, change nothing',
      '  npm run lane -- <scope> --write=<path[,path...]>   open a path-scoped lane',
      '  npm run land -- [--body-file=<file>]  publish the exact lane head and request provider handoff',
      '  npm run successor -- <scope>  preserve a published lane and continue in-place',
      '  npm run finish -- --ref=<lane>  observe exact integration; retain worktree for governed cleanup',
      '  npm run status            registered lane projections and provider state',
      '  npm run reap [-- --ref=<lane>]  classify exact integration; never clean or retire authority',
      '  npm run sync:canonical    plan a recovery-backed canonical checkout synchronization',
      '  npm run reconcile         fetch, classify, and plan protected-main reconciliation',
      '  npm run autonomy:class    compute the committed candidate promotion ceiling',
      '  agentic-os pipeline --repo=<owner/repo> --run=<id> --head=<sha> --attempt=<n>  watch exact CI progress',
      '  agentic-os flight plan|pre|in|post  preview all phase prerequisites, inspect drift and completion',
      '  agentic-os flight gate --operation=<id> --context=<json>  run enrolled checks before an effect',
      '  agentic-os observe        emit a shallow profile-bound repository observation',
      '  agentic-os observe --checks --input=<json>  discover owner checks and result bindings',
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
