<!-- readiness-proof kind=contract evidence=__tests__/invocation.test.mjs -->

# Invocation

The invocation grammar is contract-ready. `catalog/invocation.json` contains only commands this harness
implements. It is packaged as data instead of always-load prose, and its declared entry count and SHA-256 digest
are checked before every resolution.

An invocation contains at most one exact token per prefix:

- `/` selects one command;
- `#` optionally states its mutation semantic;
- `@name:<argument>` optionally binds one opaque argument.

Token names use lowercase letters, digits, dots, and hyphens and are at most 128 characters. Only `@` accepts an
argument, capped at 1,024 characters. Resolution never aliases, guesses, or calls a model; every token receives a
zero-token, zero-cost record.

```sh
node bin/agentic-os.mjs /doctor '#read-only'
node bin/agentic-os.mjs /lane '#mutating' '@scope:pricing-table'
node bin/agentic-os.mjs /status '@device:box-1.local'
```

`/lane` deliberately dispatches to the internal `start` command so the existing worktree, WIP, and scope guards
remain the only mutation owner. `/reap` is the fetch-and-survey form; authenticated retirement remains a separate
public governance operation, not an ordinary CLI action. A semantic token describes the selected command and
cannot grant it additional authority.
