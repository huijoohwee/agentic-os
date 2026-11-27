---
title: "START refreshes the protected base and recovers exact lineage"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.5.0"
date: "2026-11-03"
lang: "en-US"
owner: "Agentic OS runtime maintainers"
continuity_id: "AGENTIC-OS-START-REMOTE-REFRESH-001"
prd_revision: "1.5.0"
tad_revision: "1.5.0"
adr_revision: "1.5.0"
mvp_revision: "1.5.0"
gtm_revision: "1.5.0"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "runtime"
universal_scope: true
load_policy: "on-demand"
guideline_revision: "3.4.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/4e5227ad892f8b0125a31c83cf87e14dc3c2621c/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "6e8e7960f9075b36f2cc8328e908287fa2ba3581"
worktree_id: "device-0232231d4a19--simplified-predecessor-lineage"
agent_id: "codex-simplified-predecessor-lineage"
verification_scope: "Allow an empty provider-lane projection only when the exact verified merge tree equals protected base; map the lazily loaded alignment route to its owner tests to reduce future affected-suite fanout; retain nonempty reservation, ref/parent/merge checks, collision checks, and separate integration/cleanup authority."
budget: "Five existing paths: runtime module, two owner tests, the impact contract, and this plan; target at most 20 active minutes, four validation workers, a 1,200-second gate, and zero new modules, dependencies, provider calls, receipts, paid services, or always-load bytes."
---

# START refreshes the protected base and recovers exact readmission

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

### Retained predecessor cache drift

A successor may pin a published predecessor at `P` while its local lane-cache projection still records an earlier head `C`. Rejecting `C != P` strands an otherwise exact successor even when the retained predecessor ref still points to `P`. The current readmission path already rechecks that remote ref at `P` and verifies `P` is an ancestor of the successor head.

**Minimum outcome:** permit the cache projection to be older than its pinned predecessor only when Git proves `C` is an ancestor of `P`, the predecessor ref/worktree/protected base bindings remain exact, and the caller's existing live remote-ref observation equals `P`. Keep the projection immutable; do not advance refs, rewrite cache records, infer a squash/merge from tree similarity, or add a provider call. A missing, changed, unrelated, or unverifiable predecessor remains refused.

| ID | Requirement | VCC |
|---|---|---|
| PR-04 | Accept a stale cached predecessor head only when it is a proven ancestor of the handoff's exact predecessor head and all existing identity/base checks pass. | Fixture with cache head `C`, pinned/live remote head `P`, and `C` ancestor of `P` admits; the returned lineage retains `P`. |
| PR-05 | Preserve exact remote and successor-ancestry gates; do not mutate the predecessor record or add remote observations. | Wrong/absent remote `P`, unrelated cache head, changed worktree/base, or non-ancestor `P` refuses before allocation, cache, ref, or file writes; query count remains unchanged. |

### Successor alignment after predecessor-ref retirement

An overlapping squash-equivalent START refresh may run after the predecessor's local or remote
branch ref has been removed. Use the predecessor record and immutable head already bound by the
successor handoff. Admit only when that head is still an ancestor of the successor candidate and
its complete tree, including modes, exactly equals the fetched protected target. This updates local
successor ancestry only; it does not authenticate integration or authorize retirement or cleanup.
Missing lane identity or Git objects, changed trees, or broken ancestry continue to refuse.

| ID | Requirement | VCC |
|---|---|---|
| PR-06 | Permit exact squash-equivalent alignment with either predecessor branch ref absent when the immutable predecessor head, lane record, ancestry, and protected tree still bind. | Existing lane-alignment fixture removes the local ref and remote ref in separate prepare/apply/replay cases; the same alignment completes without changing dirty bytes. |
| PR-07 | Keep provider integration, retirement, and cleanup authority separate from local alignment. | A missing record/object, altered lineage, unrelated predecessor, or nonmatching tree refuses before changing the lane; the alignment receipt grants no external effect authority. |

### Exact-tree provider refresh

A provider update can be an empty source projection when its exact two-parent merge commit has the
same tree as the protected base: the PR's content is already present upstream. Refresh that lane
only when the existing provider, ref, merge-parent, merge-tree, reservation, and local-byte checks
pass and the candidate tree equals the protected-base tree. The lane still needs a nonempty declared
reservation; the empty path list is accepted only for this exact tree equality. This advances the
local lane head and base binding without claiming new source integration.

| PR-08 | Permit an empty source projection only when the verified provider merge commit and exact protected base have identical Git trees; retain all existing provider/ref/parent/merge-tree, reservation, and collision gates. | `provider-lane-rebind.test.mjs` proves a branch already integrated into protected base can refresh with `sourcePaths=[]`; a merge with a different tree still refuses. |
| PR-09 | Treat the lazily loaded lane-alignment CLI route as deferred and select its explicit route owners without pulling every general CLI consumer. | `test-impact.test.mjs` proves alignment selects lane alignment, provider rebind, and conservative release-completion coverage while excluding admission-economy coverage. |

## TAD

The cmdStart function in bin/agentic-os-admission.mjs owns the ordering. It already owns the clone-wide start lock, protected fetch, fetch receipt, profile check, and worktree admission. Move that single fetch to immediately inside the lock and before the canonical guard; retain the receipt and remove the second fetch from the create-only branch. Its existing `--readmit` path also owns exact pending expansion retry. bin/agentic-os-workflow.mjs validates the new recovery lineage against the prior immutable allocation and current member commit.

For retained predecessor cache drift, change only `readmissionPredecessors` in `src/lane-state.mjs`: when the cached head differs from the handoff pin, require Git ancestry from cached head to pinned head. Keep `observeExisting` in `bin/agentic-os-admission.mjs` as the final gate: it must still observe the exact live predecessor ref at the pinned SHA and prove the pinned SHA is an ancestor of the candidate. Extend the existing `admission-economy.test.mjs` coverage for this positive path and its negative cases. Do not modify the predecessor projection or introduce another fetch/provider query.

For retired predecessor refs during squash-equivalent alignment, change only the existing
`squashBinding` owner in `bin/agentic-os-lane-alignment.mjs`. Reuse the exact lane-cache handoff,
commit object, ancestry check, and protected-tree comparison; stop fencing the unrelated mutable
predecessor refs. Keep the local alignment journal and target/candidate ref CAS. Update the existing
`lane-alignment.test.mjs` ref-drift contract to remove either predecessor ref and retain lineage,
tree, and dirty-byte refusal coverage. Do not add a provider call or claim integration authority.

For provider-lane refresh, keep the existing `planProviderLaneRefresh` owner and exact merge-tree
verification. Permit `sourcePaths=[]` only when the candidate tree equals the protected-base tree;
keep the reservation nonempty and continue checking all changed paths for untracked collisions. Add
the integrated-candidate case to the existing `provider-lane-rebind.test.mjs`. Do not add a new
command, provider call, checkout, or effect receipt.

For affected-suite selection, declare the existing lazy CLI-to-alignment route in
`test/impact-contracts.json` and bind it to `lane-alignment.test.mjs` plus conservative
`release-common-complete.test.mjs` subprocess coverage. Keep direct provider-rebind imports covered
by dependency discovery. Add assertions in the existing `test-impact.test.mjs`; do not weaken the
other CLI consumer contracts.

The existing admission-economy.test.mjs covers protected-ref ordering, lane reuse and pending allocation recovery; workflow-collection.test.mjs verifies descendant ancestry and rejects unrelated commits. Existing tests remain the contract owners. docs/START-WORKFLOW.md records the retry conditions. No browser or provider API is needed.

## ADR

**Decision:** START always refreshes the profile-selected protected remote while holding its existing admission lock, before validating the canonical branch and reading mission state. A stale cached predecessor projection may be tolerated only as an ancestor of its exact handoff pin, with the existing exact remote-ref and successor-ancestry observations still required. For overlapping squash-equivalent alignment, use the immutable predecessor commit already reachable from the successor and require exact tree equality with the fetched protected target; predecessor branch refs may be absent because their names are mutable. This is local ancestry repair only, with no provider integration claim or new effect authority. Provider-lane refresh may accept an empty source-path projection only when its verified merge candidate's Git tree is identical to the protected base; the nonempty lane reservation and collision checks remain in force.

For pending readmit recovery, reuse the current `--readmit`, mission and expected-head inputs. The command validates the descendant, exact reservation and local unpublished identity, then emits one immutable workflow successor that moves pending to active and updates the child revision. Keep the recovery parent SHA as explicit lineage. For predecessor cache drift, retain the old cache bytes and handoff pin; accept only if ancestry reaches the pin and the existing live-ref observation still equals it.

**Rejected:** relying on a caller-run fetch leaves reuse and direct CLI/MCP paths inconsistent; fetching after planning allows stale-base resolution; auto-fast-forwarding local main combines observation with a separate canonical-sync effect and would silently change the developer checkout. Resetting the lane or rewriting an immutable workflow root would lose recoverable evidence. Rewriting a predecessor's cache head or accepting tree similarity without exact live-ref equality would weaken immutable lineage and could admit a replaced branch.

The configured ref keeps the behavior neutral across remotes; the default product profile uses origin/main. A fetch result proves only that the local remote-tracking view was refreshed.

## MVP

The original START/readmit slice and cache-drift/alignment refinements retain their existing owners. The combined admission plan remains capped at seven paths total. This follow-on touches five existing paths: one runtime module, two existing owner tests, the impact contract, and this planning record. It adds no modules, dependencies, provider calls, effect receipts, paid services, or always-load bytes. Validate the focused provider-rebind and impact-selector tests, then run the complete 258-suite affected gate with concurrency four and the existing 1,200-second cap; this broad one-time gate is required because the selector contract changed. Rollback is a protected source revert; immutable workflow roots, refs and authored files remain preserved.

## GTM

This is an internal reliability improvement for contributors using the free local lane workflow. The value hypothesis is fewer admissions against stale planning context; no measured time saving, buyer, price, or revenue is claimed. Keep the flow on the existing Git transport and local tooling, with no paid service or provider quota increase.

The recovery value hypothesis is fewer stranded checkouts after an interrupted readmit. Saved time and cash remain unmeasured; the feature adds no paid service, storage provider, or new transport.

The predecessor-ref refinement may reduce blocked START recovery after routine topic-branch removal. This is an unmeasured reliability hypothesis; no time saving, revenue, or integration authority is claimed.

## Source-control economy

Grounded on [Redesigning source control](https://www.anthropic.com/research/redesigning-source-control) at this repo's scale; lazy-loaded, no always-load bytes.

- Reuse current provider observations for metadata and review questions; query refs without a checkout when possible. Hydrate only exact shallow/path content needed for local byte or tree evidence.
- Refs, open PRs, checkouts and caches are global cost. When a global `reap` survey exceeds its 256-ref bound, split it into `reap --refs=<comma-separated exact lane refs>` batches of at most 256. This is read-only classification; it grants no authority to retire lanes, close PRs, delete branches or clean worktrees.
- Keep inventory, retirement, PR closure, branch deletion and worktree cleanup as separate effects. Follow [user cleanup](./USER-CLEANUP.md) and require each effect's exact authority and receipt; preserve deferred targets.
- Default TAD: Git, protected PR and affected pre-merge checks. Consider a custom VCS, cache tier, sparse/virtual checkout or post-merge test regime only after repeatable measurements exceed the declared budget and an ADR approves it. Post-merge checks supplement required pre-merge checks.
- If fetch fails with "remote-https is not a git command" (bundled git without its exec path), put a full Git first on `PATH`.

## Release boundary

The change does not authorize publication, merge, canonical fast-forward, cleanup, deployment, or production mutation. Protected integration still requires the existing lane publication, green checks, and exact integration receipt. Runtime/deployment evidence is not produced by this local acceptance check. The cache-drift path remains unavailable when its predecessor's live remote ref is absent or no longer equals its pinned head; the separate squash-equivalent alignment path can proceed only from an exact retained commit object, handoff identity, ancestry, and protected-tree match.
