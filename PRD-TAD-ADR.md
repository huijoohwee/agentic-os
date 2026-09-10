---
schema: agentic-os/production-preflight-prd-tad-adr/v1
continuity_id: ADLC-PREFLIGHT-001
revision: 1
title: Browser preflight and finite release attempts
owner: agentic-os
load_policy: on-demand
runtime_contract: bin/agentic-os-flight-checks.mjs
verification: node --test __tests__/flight-checks.test.mjs
---
# Browser preflight and finite release attempts

Production browser defects must be found before activation. A failed check must retain its identity
across invocations so starting another command or workflow does not erase the failure.

The existing flight CLI gains an explicit `gate` command. The owner enrolls bounded Node check scripts
in the existing canonical `.agentic-os-flight.json` using schema v3. Gate requires a browser check for
the selected operation and executes the enrolled checks only from clean source matching local and
fetched canonical revisions. Existing observation phases retain their read-only behavior.

The gate binds actual source tree, command, forwarded environment, Node/platform/architecture and
owner-supplied artifact/configuration digests. The consumer validator must verify those digests against
the actual artifact and runtime configuration; a digest supplied in context is not a provider receipt.
Changing run labels, operation aliases, context-file locations or an empty commit cannot erase a failure.

Before starting checks, inspect every selected check's retained history. A failed, interrupted or
incomplete prior attempt refuses the entire gate before any child starts. Write a start record before
execution. Retain the outcome and private, bounded stdout/stderr after completion. Recheck source and
context before and after execution; drift refuses continuation even when the process exits zero.

Use the existing clone-wide operation lock and Git common-directory storage. Cooperating worktrees
share history; new clones and other devices do not automatically share it. A consumer running on
ephemeral CI must preserve and restore the ledger through its existing protected storage before this
can enforce attempt continuity there. Do not claim distributed serialization from a local lock.

Acceptance checks exercise real child processes: passing checks, failed checks preventing subsequent
execution, operation aliases and empty commits, source/configuration drift, timeout, bounded diagnostic
capture, missing browser enrollment and concurrent invocation. Success grants no release authority,
no runtime-readiness claim and no cached coverage. The caller must invoke gate before dispatch or
activation and stop on nonzero status. Consumer integration remains a separate source change.

Resource bounds: one lazy CLI module, no runtime dependencies, no always-loaded prompt changes;
at most eight checks, ten minutes per child, fifteen minutes of declared child time per gate,
64 KiB per stdout/stderr stream, three executions per unchanged successful check identity.
A failed or interrupted identity gets no automatic retry. Retained records are never auto-pruned.

Decision: extend the existing flight enrollment and reuse consumer validators. Avoid a new release
controller, copied browser assertions, generic check-result cache or automatic deployment command.
Native protected checks, merge, exact cleanup and canonical synchronization remain separate steps.
