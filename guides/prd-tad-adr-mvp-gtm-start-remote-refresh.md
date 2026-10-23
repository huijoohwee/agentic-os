---
title: "START refreshes the protected base and recovers pending readmission"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.1.0"
date: "2026-10-18"
lang: "en-US"
owner: "Agentic OS runtime maintainers"
continuity_id: "AGENTIC-OS-START-REMOTE-REFRESH-001"
prd_revision: "1.1.0"
tad_revision: "1.1.0"
adr_revision: "1.1.0"
mvp_revision: "1.1.0"
gtm_revision: "1.1.0"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "runtime"
universal_scope: true
load_policy: "on-demand"
guideline_revision: "3.4.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/4e5227ad892f8b0125a31c83cf87e14dc3c2621c/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "4aa68116c276d479e3064553460c6aa4f202d1e6"
worktree_id: "device-0232231d4a19--pending-readmit-recovery"
agent_id: "codex-pending-readmit-recovery"
verification_scope: "Fetch the configured protected tracking ref before admission; safely reconcile a pending readmit when its exact unpublished lane advances by descendant commits inside the same declared reservation."
budget: "Six reserved paths; two existing runtime modules; two existing test modules; one START guide; this planning record; under 12 KiB authored delta; 20 active minutes; zero dependencies, new runtime modules, paid services, or spend."
---

# START refreshes the protected base and recovers pending readmission

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

### Pending readmission recovery

An interrupted scope expansion can leave an immutable workflow allocation pending while the unpublished lane later gains a committed candidate. Requiring the old head forever strands the exact reservation even when all authored paths remain inside it.

**Minimum outcome:** retry the same `--readmit` mission and exact expansion with the exact current `--expected-head`. Admit the retry only when the pending row belongs to the same ref/worktree/path, its recorded head is an ancestor of the current head, its prior scope digest matches the live lane record, the expanded digest exactly matches the pending digest, and all committed, dirty, and untracked bytes fit that expansion. Record `recoveredFromHead` in the immutable active allocation and bind it to the updated member revision and ancestry. This repairs local admission state only.

| ID | Requirement | VCC |
|---|---|---|
| PR-01 | Recover only the exact unpublished lane and pending expansion on an explicitly supplied descendant head. | An interrupted pending readmit with a scoped descendant commit becomes active and records the old head; its reservation and worktree bytes remain exact. |
| PR-02 | Refuse wrong mission, scope, head, non-descendant, published branch, or bytes outside the expansion before local record mutation. | Negative fixtures retain the prior pending root, lane record, refs, and files. |
| PR-03 | Workflow lineage binds recovery to the previous pending readmit, unchanged scope digest, exact child revision, and Git ancestry. | A forged marker, wrong predecessor, mismatched child head, or unrelated commit fails collection and selection. |

## TAD

The cmdStart function in bin/agentic-os-admission.mjs owns the ordering. It already owns the clone-wide start lock, protected fetch, fetch receipt, profile check, and worktree admission. Move that single fetch to immediately inside the lock and before the canonical guard; retain the receipt and remove the second fetch from the create-only branch. Its existing `--readmit` path also owns exact pending expansion retry. bin/agentic-os-workflow.mjs validates the new recovery lineage against the prior immutable allocation and current member commit.

The existing admission-economy.test.mjs covers protected-ref ordering, lane reuse and pending allocation recovery; workflow-collection.test.mjs verifies descendant ancestry and rejects unrelated commits. Existing tests remain the contract owners. docs/START-WORKFLOW.md records the retry conditions. No browser or provider API is needed.

## ADR

**Decision:** START always refreshes the profile-selected protected remote while holding its existing admission lock, before validating the canonical branch and reading mission state.

For pending readmit recovery, reuse the current `--readmit`, mission and expected-head inputs. The command validates the descendant, exact reservation and local unpublished identity, then emits one immutable workflow successor that moves pending to active and updates the child revision. Keep the recovery parent SHA as explicit lineage.

**Rejected:** relying on a caller-run fetch leaves reuse and direct CLI/MCP paths inconsistent; fetching after planning allows stale-base resolution; auto-fast-forwarding local main combines observation with a separate canonical-sync effect and would silently change the developer checkout. Resetting the lane or rewriting an immutable workflow root would lose recoverable evidence.

The configured ref keeps the behavior neutral across remotes; the default product profile uses origin/main. A fetch result proves only that the local remote-tracking view was refreshed.

## MVP

Change the existing admission and workflow owners, their two existing test modules, START guide, and this plan. Budget: six paths, two existing runtime modules, two existing test modules, under 12 KiB and 20 active minutes; zero new modules/dependencies and zero always-load bytes. Run focused regressions and required npm run check. Rollback is a protected source revert; immutable workflow roots, local remote-tracking refs, lane refs and authored files remain preserved.

## GTM

This is an internal reliability improvement for contributors using the free local lane workflow. The value hypothesis is fewer admissions against stale planning context; no measured time saving, buyer, price, or revenue is claimed. Keep the flow on the existing Git transport and local tooling, with no paid service or provider quota increase.

The recovery value hypothesis is fewer stranded checkouts after an interrupted readmit. Saved time and cash remain unmeasured; the feature adds no paid service, storage provider, or new transport.

## Source-control economy

Grounded on [Redesigning source control](https://www.anthropic.com/research/redesigning-source-control) at this repo's scale; lazy-loaded, no always-load bytes.

- Reuse current provider observations for metadata and review questions; query refs without a checkout when possible. Hydrate only exact shallow/path content needed for local byte or tree evidence.
- Refs, open PRs, checkouts and caches are global cost. When a global `reap` survey exceeds its 256-ref bound, split it into `reap --refs=<comma-separated exact lane refs>` batches of at most 256. This is read-only classification; it grants no authority to retire lanes, close PRs, delete branches or clean worktrees.
- Keep inventory, retirement, PR closure, branch deletion and worktree cleanup as separate effects. Follow [user cleanup](./USER-CLEANUP.md) and require each effect's exact authority and receipt; preserve deferred targets.
- Default TAD: Git, protected PR and affected pre-merge checks. Consider a custom VCS, cache tier, sparse/virtual checkout or post-merge test regime only after repeatable measurements exceed the declared budget and an ADR approves it. Post-merge checks supplement required pre-merge checks.
- If fetch fails with "remote-https is not a git command" (bundled git without its exec path), put a full Git first on `PATH`.

## Release boundary

The change does not authorize publication, merge, canonical fast-forward, cleanup, deployment, or production mutation. Protected integration still requires the existing lane publication, green checks, and exact integration receipt. Runtime/deployment evidence is not produced by this local acceptance check.
