---
title: "Agent Sandbox Runtime Contract"
graphId: "md:agent-sandbox-runtime"
doc_type: "Runtime Contract"
date: "2026-07-10"
lang: "en-US"
schema: "agent-sandbox-runtime-contract/v1"
frontmatter_contract: "required"
status: "source-migrated-consumer-cutover-pending"
authority: "source contract for native agent sandbox policy validation and authorization"
runtime_policy_source: "https://github.com/huijoohwee/agentic-graph/blob/3b424d9e80f113dbab93b195798bd9521241aafe/config/agent-sandbox-policy.yaml"
runtime_owner: "https://github.com/huijoohwee/agentic-graph/blob/3b424d9e80f113dbab93b195798bd9521241aafe/mcp/agent-sandbox-policy-runtime.js"
external_pattern_source: "https://github.com/NVIDIA/openshell"
external_source_policy: "architecture reference only; forbid copied code, schemas, skills, fixtures, prose, runtime dependency, or compatibility aliases"
publish_policy: "Dev-only until explicit operator approval"
runtime_proof: "https://github.com/huijoohwee/agentic-graph/blob/3b424d9e80f113dbab93b195798bd9521241aafe/mcp/__tests__/agent-sandbox-policy-runtime.test.mjs"
invocations:
  commands: ["/sandbox.policy.validate", "/sandbox.policy.authorize"]
  semantics: ["#agent-sandbox-policy", "#sandboxed-workspace"]
  bindings: ["@sandbox-policy", "@sandbox-workspace", "@runtime-proof"]
owner: "agentic-os"
load_policy: "on-demand"
migration_source_revision: "8460fc01c7dbd8af6880d346a71829e20887c44e"
---

# Agent Sandbox Runtime

This on-demand contract is owned by `agentic-os` under
[DURABLE-AGENT-WORKFLOWS-001@0.1.0](../../../guides/DURABLE-WORKFLOWS.md).
The [migration record](../MIGRATION-DOCS.json) binds its native source. Runtime and
live-provider observations below retain their original scope; historical proof
links remain pinned to that source. Current package checks run with `npm run check:all`.

The native runtime compiles one source-backed policy and returns deterministic, fail-closed authorization decisions. It introduces no external runtime package, second gateway, copied schema, or compatibility remap.

`SANDBOX-AGENTS.md` owns the separate provider-neutral container workspace controller. That controller may forward an already-authorized operation to an injected container provider, but it does not upgrade this policy preflight into OS or kernel enforcement. Keep policy authorization, container execution, and independent containment proof as three distinct claims.

## Security Boundary

| Layer | Current state | Claim |
|---|---|---|
| Policy parsing and schema validation | Local check implemented | Dependency-free YAML 1.2 JSON-compatible subset; unknown fields and permissive network defaults fail closed. |
| Filesystem, process, network, and credential preflight | Local check implemented | Every decision carries policy identity, digest, reason code, redacted audit metadata, and enforcement status. |
| Local MCP gateway projection | Local check implemented | Read-only validate and authorize tools use the existing local MCP owner. |
| OS/kernel or container isolation | Required, not provided | Application preflight cannot contain adversarial child processes, prevent symlink races, intercept arbitrary egress, or enforce syscall policy. |
| Prod and Cloudflare | Forbidden | No publish or deployment action is authorized by this contract. |

## Policy Domains

| Domain | Mutability | Rule |
|---|---|---|
| Filesystem | Static | Allow only explicit workspace-relative roots; traversal outside the workspace is denied. |
| Process | Static | Allow only explicit absolute executables within runtime and output bounds. |
| Credentials | Static | Allow only named host-managed environment bindings; values never enter policies, results, docs, tests, or browser state. |
| Network | Dynamic decision input | Default deny; an allow requires matching host, port, protocol, HTTP method, path prefix, and executable. |
| Audit | Immutable requirement | Decision logging and value redaction are mandatory. |

## Agent Skills

| Skill | Purpose | Boundary |
|---|---|---|
| `sandbox.policy.author` | Produce a least-privilege candidate policy from explicit requirements and source evidence. | Proposal only; validation must pass and widening requires operator review. |
| `sandbox.gateway.troubleshoot` | Inspect policy load, digest, denied decision, and gateway routing evidence. | Read-only; cannot widen policy, expose secrets, execute operations, or deploy. |

## VCCs

- Valid source compiles to a stable digest and reports `kernel_or_container_isolation: required-not-provided`.
- Unknown fields, network allow-by-default, paths outside the runtime root, and unmatched operations return typed failures or deny decisions.
- The local MCP catalog exposes validation and authorization as read-only tools.
- Focused tests exit zero with no Prod mirror or Cloudflare action.
