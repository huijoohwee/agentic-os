<!-- readiness-proof kind=contract evidence=__tests__/mcp-server.test.mjs -->

# MCP server

The packaged `agentic-os-mcp` binary is contract-ready as a newline-delimited stdio MCP server. It
supports modern `2026-07-28` requests and a legacy `2025-11-25` initialization opening without a
runtime dependency.

Modern requests carry their protocol version and client capabilities in `params._meta`. The server
implements `server/discover`, returns deterministic tool lists, and includes its identity in result
metadata. An `initialize` request instead selects legacy semantics for that stdio process.

Four tools cross the MCP boundary by spawning the existing CLI with an argument array, never a shell:

- `doctor` and `status` inspect the harness;
- `reap` is survey-only and cannot add `--apply`;
- `lane` accepts one scope validated by the same grammar as `npm run lane`.

Every tool returns `{ exitCode, stdout, stderr }` as both structured content and serialized text. A
nonzero CLI exit is a tool error, while malformed protocol input remains a JSON-RPC error. Input,
output, and execution time are bounded. Cancellation terminates the isolated CLI process group on
POSIX, or the child process on Windows, and suppresses its response. End-of-file terminates all
remaining work.
