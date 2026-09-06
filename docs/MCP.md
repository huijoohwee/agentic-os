<!-- readiness-proof kind=contract evidence=__tests__/mcp-server.test.mjs -->

# MCP server

The packaged `agentic-os-mcp` binary is contract-ready: newline-delimited stdio, zero dependencies,
modern `2026-07-28` requests and legacy `2025-11-25` initialization.

Modern requests carry version and capabilities in `params._meta`. `server/discover` exposes server
identity and deterministic tools; results include identity metadata. `initialize` selects legacy
semantics for the process.

Five tools invoke the existing CLI with argument arrays, without a shell:

- `doctor` and `status` inspect the harness;
- `checks` accepts `{ "input": "./checks-input.json" }` and reads owner references and unsigned results;
- `reap` is survey-only and cannot add `--apply`;
- `lane` accepts one scope validated by the same grammar as `npm run lane`.

Tools return `{ exitCode, stdout, stderr }` as structured content and serialized text. Nonzero exits
are tool errors; malformed input produces JSON-RPC errors. Input, output and time are bounded.
Cancellation suppresses responses and terminates the CLI process group on POSIX, or child on Windows.
End-of-file terminates remaining work.

`checks` maps to `observe --checks --input=<path>` without fetching or executing owner suites.
Its [source bindings and coverage](../README.md#shared-check-discovery) grant no integration authority.
