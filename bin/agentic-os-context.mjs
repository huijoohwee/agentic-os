/** Lazy CLI adapter for the same source-context API used by task hosts. */
import { option } from './agentic-os-argv.mjs';
import { createCodebaseContext } from './agentic-os-context-index.mjs';

export function runContext(root, argv, out) {
  const runtime = createCodebaseContext({ root }), operation = argv[0];
  const options = {};
  for (const name of ['path', 'query', 'sha256', 'limit', 'after', 'line', 'lines']) {
    const value = option(argv, name);
    if (value !== null) options[name] = value;
  }
  out(JSON.stringify(runtime[operation](options)));
  return 0;
}
