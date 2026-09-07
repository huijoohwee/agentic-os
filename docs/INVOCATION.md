<!-- readiness-proof kind=contract evidence=__tests__/invocation.test.mjs -->

# Invocation

The invocation grammar is contract-ready. `catalog/invocation.json` lists implemented commands as
packaged data. Every resolution verifies its entry count and SHA-256 digest.

An invocation contains at most one exact token per prefix:

- `/` selects one command;
- `#` optionally states its mutation semantic;
- `@name:<argument>` optionally binds one opaque argument.

Names allow lowercase letters, digits, dots and hyphens, up to 128 characters. Only `@` accepts an
argument, up to 1,024 characters. Resolution uses no aliases, guesses or model calls; each token
receives a zero-token, zero-cost record.

```sh
node bin/agentic-os.mjs /doctor '#read-only'
node bin/agentic-os.mjs /lane '#mutating' '@scope:pricing-table'
node bin/agentic-os.mjs /status '@device:box-1.local'
node bin/agentic-os.mjs /checks '#read-only' '@input:./checks-input.json'
```

`/lane` dispatches to guarded `start`; cross-device exclusion requires the external authenticated
claim adapter. `/reap` fetches and surveys. Authenticated retirement remains a separate public
governance operation. Semantic tokens describe commands and grant no authority.

`/checks` reads owner references and optional results without executing tests.
[Input and result format](../README.md#shared-check-discovery).
