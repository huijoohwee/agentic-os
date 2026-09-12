---
schema: agentic-os/production-preflight-prd-tad-adr/v1
continuity_id: "ADLC-PREFLIGHT-001"
revision: 1
title: Browser preflight and finite release attempts
owner: "agentic-os"
load_policy: on-demand
runtime_contract: bin/agentic-os-flight-checks.mjs
verification: node --test __tests__/flight-checks.test.mjs
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.1"
date: "2026-09-12"
lang: "en-US"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-cba000d3779d--planning-v27"
agent_id: "codex-01a0940a"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "817c1da8dac21d688d7c531b234482c64ee4340b"
prd_revision: "1.0.1"
tad_revision: "1.0.1"
adr_revision: "1.0.1"
mvp_revision: "1.0.1"
gtm_revision: "1.0.1"
---
# Browser preflight and finite release attempts

## PRD

Production browser defects must be found before activation. A failed check must retain its identity
across invocations so starting another command or workflow does not erase the failure.

## TAD

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

## ADR

Decision: extend the existing flight enrollment and reuse consumer validators. Avoid a new release
controller, copied browser assertions, generic check-result cache or automatic deployment command.
Native protected checks, merge, exact cleanup and canonical synchronization remain separate steps.

## MVP — reference implementation

`ADLC-PREFLIGHT-001@1.0.1` selects one source-bound browser gate with retained failed-attempt history. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
Verify that acceptance with `node --test __tests__/flight-checks.test.mjs` and the affected repository checks, preserving their exact source, result and authoring surface. The named command is a check plan; existing observations above retain their original scope and revision.

## GTM — reference implementation

The initial user is a solo developer or operator completing the selected engineering outcome. WTP, priced-offer acceptance, collected payment and repeat use remain unvalidated. Reuse this free local slice for a timed pilot before considering a hosted service; reject paid infrastructure until buyer evidence justifies it.

Experience assessment for `ADLC-PREFLIGHT-001@1.0.1` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.
