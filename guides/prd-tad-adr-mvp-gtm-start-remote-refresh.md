---
title: "START refreshes the protected base before admission"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.0"
date: "2026-10-13"
lang: "en-US"
owner: "Agentic OS runtime maintainers"
continuity_id: "AGENTIC-OS-START-REMOTE-REFRESH-001"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
mvp_revision: "1.0.0"
gtm_revision: "1.0.0"
frontmatter_contract: "required"
local_rung: "dev-proven"
delivered_rung: "undocumented"
lane: "runtime"
universal_scope: true
load_policy: "on-demand"
guideline_revision: "3.4.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/82835ac37d524643faa6b9703cb077ea9474ab15/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "4ba0046cb4f34a85c4e630711ec60037910e6c27"
worktree_id: "device-0232231d4a19--start-refresh-protected-base"
agent_id: "codex-start-refresh-protected-base"
verification_scope: "Fetch the configured protected tracking ref before canonical validation and mission resolution on every valid START; do not advance local main or grant release authority."
budget: "Six reserved paths; one existing runtime module; three existing test modules; one workflow page; one planning record; zero dependencies, new runtime modules, paid services, or spend."
---

# START refreshes the protected base before admission

## PRD

### Problem and minimum outcome

START can resolve a plan, mission and cached protected revision before the later fetch. A stale remote-tracking ref can therefore make admission inspect old context, and a reused lane currently skips the later fetch entirely. A contributor needs each START attempt to observe the configured protected branch before it checks the canonical checkout or decides whether to reuse or create a lane.

**Minimum outcome:** acquire the existing admission lock, fetch the repository profile's protected remote, record its fetch receipt, and only then run the canonical guard and resolve admission inputs. This applies to new and reused lanes, including requests later refused for local capacity or reservation reasons. A failed fetch stops before lane mutation. Fetching updates the remote-tracking ref; it does not advance local main, publish a branch, merge, deploy, or grant authority.

### Requirement and verification

| ID | Requirement | VCC |
|---|---|---|
| SR-01 | Every valid START refreshes the configured protected tracking ref before canonical validation, mission resolution, planning revision selection, or lane reuse/provisioning. | With a fixture remote advanced after its cached ref, START fetches the new commit before invoking the canonical guard and binds the new SHA as the mission base. |
| SR-02 | Refresh failure or canonical-guard failure retains the fetch observation and creates no lane. | A failed fetch or guard leaves worktree count and authored files unchanged; the result reports failure. |
| SR-03 | The behavior remains provider neutral and bounded. | Use the existing protected-ref profile and Git transport; add no service, dependency, route, runtime module, or always-loaded prompt bytes. |

The validation is source behavior, not a claim of protected integration or deployment. User demand, time saved, and willingness to pay are unmeasured.

## TAD

The cmdStart function in bin/agentic-os-admission.mjs owns the ordering. It already owns the clone-wide start lock, protected fetch, fetch receipt, profile check, and worktree admission. Move that single fetch to immediately inside the lock and before the canonical guard; retain the receipt and remove the second fetch from the create-only branch. Existing mission and lane logic remains the owner for reuse and provisioning.

The existing admission-economy.test.mjs test advances a local bare remote after the fixture caches its initial protected SHA. Existing doctor-start-regressions.test.mjs covers duplicate-lane refusal after refresh, and runtime-budgets.test.mjs updates the workflow text contract. The existing docs/START-WORKFLOW.md records ordering and failure behavior. No browser or provider API is needed.

## ADR

**Decision:** START always refreshes the profile-selected protected remote while holding its existing admission lock, before validating the canonical branch and reading mission state.

**Rejected:** relying on a caller-run fetch leaves reuse and direct CLI/MCP paths inconsistent; fetching after planning allows stale-base resolution; auto-fast-forwarding local main combines observation with a separate canonical-sync effect and would silently change the developer checkout.

The configured ref keeps the behavior neutral across remotes; the default product profile uses origin/main. A fetch result proves only that the local remote-tracking view was refreshed.

## MVP

Change the existing admission owner and its existing tests, clarify the existing START guide, and retain this plan. Budget: six paths, one existing runtime module, three existing test modules, one guide, one planning record, zero new modules/dependencies and zero always-load bytes. Run the repository's required npm run check and report its exact outcome. Rollback is a protected source revert; local remote-tracking refs may remain at the fetched commit, while local main, lane refs and authored files are preserved.

## GTM

This is an internal reliability improvement for contributors using the free local lane workflow. The value hypothesis is fewer admissions against stale planning context; no measured time saving, buyer, price, or revenue is claimed. Keep the flow on the existing Git transport and local tooling, with no paid service or provider quota increase.

## Release boundary

The change does not authorize publication, merge, canonical fast-forward, cleanup, deployment, or production mutation. Protected integration still requires the existing lane publication, green checks, and exact integration receipt. Runtime/deployment evidence is not produced by this local acceptance check.
