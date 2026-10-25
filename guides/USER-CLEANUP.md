---
title: "Explicit local-consent worktree cleanup"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.4.6"
date: "2026-10-22"
owner: "agentic-os"
continuity_id: "USER-CLEANUP-001"
prd_revision: "1.4.6"
tad_revision: "1.4.6"
adr_revision: "1.4.6"
load_policy: "on-demand"
lang: "en-US"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-0232231d4a19--cleanup-cwd-guard"
agent_id: "codex-01a09db4"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "397ce86dbcf9606cace473f0e1f1e8beabb20197"
mvp_revision: "1.4.6"
gtm_revision: "1.4.6"
---

# Explicit local-consent worktree cleanup

## PRD: preserve work without inventing protected authority

A private/free repository may have merged, checked work but no server-enforced protection or ADLC profile.
An explicitly authorized operator must be able to close an exact stopped worktree without paying for a
plan, publishing private content or fabricating provider-issued integration/retirement records.

Acceptance: local opt-in plus one exact plan authorization and stop acknowledgement; freshly observed
same-repository merged PR and selected successful GitHub Actions checks; equal candidate/merge trees;
merge ancestry in clean, current main; exact target, inventory, peers, refs and object preservation;
recoverable projection/registration quarantine; distinct local-consent receipt and bounded replay. Before
projection retirement, detect open descriptors and process current working directories under both retained
trees; fail closed if the reader scan is incomplete.

## TAD: separate admission, shared preservation machinery

`bin/agentic-os-cleanup-user.mjs` owns local admission, plans, authorization and receipts.
`bin/agentic-os-cleanup-review.mjs` owns bounded read-only GitHub evidence. The existing quarantine
mechanics take an internal policy observer; protected cleanup never forwards caller-supplied policy
overrides and still requires its authenticated integration/retirement joins. This is not a fallback.
The cleanup command's reader guard uses recursive descriptor scans for files and one process-CWD snapshot
for directories, including a working directory whose tree has already been unlinked. Missing caller
evidence or scan errors block removal; canonical path resolution prevents symlink aliases from evading
containment checks. The existing cleanup owner remains the only CLI/runtime module.

The progressive closeout pass uses cached lane state to try integrated, queued, then published lanes,
with path order as the stable tie-breaker. It shares the pass deadline across eligible candidates;
unpublished, dirty-binding, detached, or otherwise ineligible rows are reported without taking a
provider wait slot. This is a completion-proximity heuristic, not a claim of measured dollar ROI.

`release-common allocation-release` accepts an optional `--cleanup-receipt=<json>` for local-consent
quarantines. It reads the bounded receipt through the existing cleanup owner and passes it through the
same completion observer used by `completion status`; exact ref, head, path, retained quarantine, and
unmounted-lane checks remain mandatory. The option does not grant cleanup, provider, claim-retirement,
sync, or deployment authority.

The default local path refuses any committed/local `.agentic-os.json` or repository trust anchor.
Profile-governed recovery requires the separate explicit selection below; protected cleanup retains its
authenticated integration/retirement requirements. No failed command automatically selects recovery.
No shared allowlist change, fake profile, authority workflow or remote write is needed. The explicit
clone-local enrollment is not shared or silently enabled by the package. Version 1 supports GitHub.com,
credential-free HTTPS/SSH origin, canonical `main`, same-repository PRs and GitHub Actions checks.

## Operator workflow

Use the reviewed package/CLI from the surviving canonical repository root. Before enabling or applying,
the caller must have actual user authorization for this mode and exact targets; hashes do not supply it.

```sh
git config --local agentic-os.userCleanup quarantine
agentic-os cleanup-user plan --target=<absolute-worktree-path> --pr=<number> \
  --checks=planning --workflow=.github/workflows/planning.yml
```

The plan command prints bounded JSON and grants no effects. Save it outside the target worktree and review
the exact repository, path, branch, head, main SHA, merge/check evidence, preserved inventory and expiry.
`--checks` is a sorted, unique, comma-separated operator-selected list, not a claim about server-required
checks. The workflow path is explicitly selected by the operator. This does not evaluate CI sufficiency.
Stop all workers using the target, then supply explicit confirmation of the plan's full `planDigest`:

```sh
agentic-os cleanup-user apply --plan=<saved-json> \
  --authorize=agentic-os:user-cleanup:<planDigest> --stopped
```

Applying reobserves local policy and remote merge/check/main identities. Changed checks, policy, source,
peers, ignored bytes, refs or objects invalidate the plan. Tracked/visible-untracked dirty targets and
hidden index flags are rejected; ignored local files and symlink bytes are preserved without following
links. Canonical targets, aliases, foreign clones and locked registrations are refused.

Generate and apply one plan at a time: quarantining one peer changes the next target's inventory.
Do not reuse a stale batch of plans. Remove opt-in with `git config --local --unset-all agentic-os.userCleanup`.

## Explicit recovery for profile-governed repositories

`USER-CLEANUP-001@1.2.1` also covers an operator-authorized, stopped, clean historical lane whose PR is
merged but whose historical authority records are unavailable. User authorization must cover the exact
targets and recoverable cleanup; it may persist across turns. The caller selects this mode explicitly:

```sh
git config --local agentic-os.userCleanup quarantine-recovery
agentic-os cleanup-user plan --recovery --ref=<lane>
# Explicit form, when the lane record cannot supply one of these exact bindings:
agentic-os cleanup-user plan --recovery --target=<absolute-worktree-path> --pr=<number> \
  --checks=<sorted-profile-checks> --workflow=.github/workflows/<review-workflow>.yml
```

The lane-ref form derives the mounted target, PR, profile-required checks and historical workflow from the
current canonical lane record. It independently rechecks the exact branch/head, merged review, successful
checks, content inclusion, inventory and remote main before emitting the same 15-minute plan. Local recovery
enrollment and the separate `apply --plan --authorize --stopped` confirmation remain required. Run from the
surviving canonical checkout with the reviewed upstream CLI. Remove the clone-local opt-in after the selected
batch. Never invoke code from a directory after it has been quarantined.

Admission requires the existing valid clone trust anchor and committed Git/GitHub profile, equal clean
local/tracking/live main, and every profile-required check. Each selected check must belong to the exact
PR head and named PR workflow and have completed successfully before merge. Multiple check records are
resolved within the selected workflow by completion time; its newest historical check must pass. A newer
historical failure blocks recovery. Provider reads stay bounded and Actions run reads are deduplicated.

Content proof reuses the existing exact mode/type/blob projection against the actual merged commit when
complete candidate and merge trees differ due to concurrent base work. Missing source changes fail. The
merge must remain an ancestor of current main. This is content inclusion, not proof of a historical merge
method or historical branch enforcement. Squash defaults, strict squash-only profiles and revision-bound
rebase choices continue to govern integration. Recovery neither merges nor rewrites a branch.

If the lane record already marks missing checkout bytes `unrecoverable-accepted`, recovery mode may
quarantine the exact retained checkout only when its ref, head and path still match the record and the
checkout is clean. The fresh plan binds the merged PR, successful checks and complete inventory; apply
retains the projection, registration, refs and objects. Missing historical bytes remain unrecovered,
and this operation does not authorize their discard, retire a claim or grant provider authority. Closeout
accepts the disposition only while it independently verifies that retained quarantine.

For a stopped detached worktree retained at an ancestor of the checked PR head, explicitly add
`--detached` to the recovery plan. The plan keeps the reviewed PR head and actual detached HEAD separate.
Both must have exact source-content inclusion at the actual merge, and the detached commit must be an
ancestor of that same reviewed head. Ancestry alone cannot cover overwritten files; matching content
alone cannot cover unrelated history. Attached targets, unbound commits and any head/branch/content drift
fail. Apply rechecks both proofs and preserves all refs, objects, ignored files and the detached registration.
This option changes no default or protected cleanup admission and creates no historical authority.
Recovery also preserves regular-file hardlinks in dependency trees: manifests bind link counts and bytes,
and alias writes invalidate the plan. Symlink hardlinks and special files remain rejected.

For a clean, stopped detached historical draft that is not an ancestor of the reviewed PR head,
select `--reviewed-equivalent-commit=<sha>` together with `--recovery --detached`. The selected
commit must be an ancestor of that exact green merged PR head. Both the draft and selected reviewed
commit must have one parent and the same nonempty changed-path list; every path must have identical
mode/type/blob before and after the two commits. The accepted PR head must still have exact
source-content inclusion at its merge. This proves only an exact historical transition in the
reviewed series. It does not prove that the detached commit was merged or that its content survived
later revisions. Apply rechecks the transition and all preservation conditions. The receipt states
`sourceIntegrated:false`, `historicalDraft:superseded`, `providerAuthority:false` and
`claimRetired:false`. The original detached-ancestor mode remains strict.

## Reviewed successor closeout

When a historical lane's own PR was closed or failed but a later checked PR incorporated its work,
use the existing `release-common complete` command with an explicit successor PR and every path whose
accepted content replaced the lane's content:

```sh
npm run release:common -- complete --ref=<old-lane> --via-pr=<merged-successor-pr> \
  --replaced=<exact-repository-relative-path[,path...]> --stopped
```

The command runs from clean canonical `main`, which must equal fetched and live `origin/main` and
contain the accepted merge. If it does not, use the separately governed canonical sync workflow first.
The old lane must be a mounted, clean, stopped published worktree with its cached head unchanged.
It verifies the successor's exact reviewed head, successful selected checks and actual merge. The old
head must be an ancestor of the reviewed head. Every path changed by the old lane must match the
accepted merge tree exactly, except the explicitly listed replacements; each replacement must match
the reviewed successor and differ from the old lane. Missing or extra replacement paths fail.

The predecessor PR remains historical and is never reported as merged. The result is a local-consent
recovery receipt with `reviewed-successor` content evidence, not provider-issued integration or
retirement authority. The existing cleanup planner inventories the target, peers, refs, objects and
ignored bytes, then moves its projection and registration into recoverable quarantine. It retains
the old branch and Git objects. Re-run only after checking the retained effect and current GitHub
and canonical state; later edits to `main` do not change the accepted merge-tree comparison.

The exact plan binds the existing profile digest, retention policy, required checks, recovery mode and
resource ceilings. The operator's local consent selects recoverable projection/registration quarantine
even when the protected profile retains them; it does not edit that shared policy or create a provider
grant. Every branch, ref, object and other worktree is preserved by the existing lock, manifests and journal.
The receipt remains `providerAuthority:false`, `protectionProven:false`, `claimRetired:false`, and adds
`historicalIntegrationMethodProven:false`. No outstanding governance claim is silently retired.

Recovery ceilings are fixed at 4 GiB/250,000 projection entries, 16 MiB/20,000 registration entries, and
20 GiB/500,000 shared-state entries. Plans bind these ceilings and observation totals; crossing them fails
before quarantine. These are maximum observation budgets, not allocated buffers; reads stream in 64 KiB
chunks. Original profileless modes retain their smaller budgets and admissions. This revision adds one
lazy CLI helper, no source-core module, dependency, authority issuer or background process.

Acceptance: a profile with retained targets and a historical concurrent-base merge can be cleaned only
with exact local opt-in, successful checks, complete content/preservation proof and stopped acknowledgement;
wrong identity, missing checks, failed source inclusion, hidden/dirty bytes, drift and stale consent fail.
`__tests__/user-cleanup-recovery.test.mjs` covers those boundaries with real temporary Git repositories and
mocked provider reads. Live execution receipts remain separate from these tests.

## Current successor preservation adoption

When native succession used one shared checkout and the successor is already quarantined, there may
be no separate predecessor projection or cleanup receipt. Explicitly select a reviewed current
`agentic-os/successor-preservation-adoption/v1` entry from the committed v2 transition policy. It binds
the exact predecessor/successor refs and heads, successor review/merge, every accepted replacement path
and the authentic successor quarantine coordinate. Cache lineage or ancestor equality alone is insufficient.

Run from the clean/current canonical target clone, using the trusted authority policy's clean canonical
checkout; both selected lanes must already be unmounted:

```sh
agentic-os cleanup-user preservation-plan --adoption=<exact-enrolled-json> --policy-root=<trusted-authority-canonical-root> --workflow=<review-workflow>
agentic-os cleanup-user preservation-apply --plan=<saved-plan-json> --authorize=agentic-os:successor-preservation:<planDigest> --stopped
agentic-os completion status --ref=<predecessor> --preservation=<actual-receipt-json>
```

Planning grants no effect. The independently authorized apply rechecks policy, source inclusion,
selected successful review checks, refs, peer/cache identities and real retained bytes, then writes one
create-only local preservation carrier under the existing clone-private cleanup root. It never moves
the successor carrier or reconstructs predecessor registration. First issuance must remain in-window;
immutable replay verifies the retained facts after expiry and has no new physical effect.

The distinct receipt states `disposition:successor-preserved`,
`historicalSuccessionAuthorityProven:false`, `physicalCleanupPerformed:false`,
`providerAuthority:false` and `claimRetired:false`. Completion exposes
`preservationDispositionVerified` and `preservationSatisfied` while predecessor `cleanupVerified`
remains false. Selected source closeout can accept preservation; full ADLC still requires independent
live provider retirement and applicable delivery/handover. See [lifecycle completion](../docs/LIFECYCLE-COMPLETION.md)
for the distinct record-only retirement operation, which cannot authorize physical quarantine.

## Current already-quarantined retention

Accepted `CLEANUP-AUTHORITY-001@1.2.0` adds `agentic-os/current-quarantine-adoption/v1`
enrollment under the distinct committed v3 policy. It selects one original target/ref/head/review/merge,
quarantine coordinate and exact original receipt digest; historical quarantine authority stays false.
Use the same preservation-plan entrypoint with a bounded `{adoption, originalReceipt}` JSON wrapper.
The existing plan/apply/status owners select the distinct typed current-retention schemas and verify the
original operation, receipt, registration/manifests, retained index/content, source, policy and current
absent mounts/ref/peer/canonical state. The current carrier is create-only and performs no physical effect.
It neither changes the original receipt nor recreates a registered-before target. Fresh independent
provider integration and record-only retirement remain required; unknown historical actors stay unknown.
Keep current seed recovery copies and accepted clean-state reconciliation; no deletion follows.

For a detached original receipt, the retained observer also binds the quarantined registration's
raw `HEAD` to `receipt.detachedHead` and rechecks that commit's Git tree against the enrolled reviewed
head. It then inventories the retained index at that exact revision. Missing or mismatched receipt,
tree, ref, or registration evidence fails closed. This local retention disposition preserves
`providerAuthority:false` and `claimRetired:false`; it does not replace the independent provider
retirement receipt.

When an exact retained `quarantine-retirement-receipt/v2` already records `bytesDeleted:true` and
`recoveryBytesDiscarded:true`, the current adoption may issue a distinct
`current-quarantine-discard-acknowledged` record. It binds that unmodified receipt, the operation's
original projection manifest, the surviving registration manifest and index bytes, the retained
branch/head, and the freshly observed review/source/policy. It reports the earlier local loss without
claiming preservation or historical authority. The target projection must remain absent and the
branch, registration, and Git objects must remain intact. This path issues no cleanup effect and never
reconstructs a receipt or checkout; record-only provider retirement still requires its own live
integration and retirement receipts.

An authenticated retirement receipt can also serve as `originalReceipt` when its digest and plan byte
digest match the quarantined `worktree-cleanup-eligibility/v1`, whose cleanup plan digest is the exact
quarantine coordinate. The observer validates the retirement receipt, joins its review URL and merge to
the enrolled source, and derives the absent checkout path from the preserved registration backlink.
This records retained state only; it does not repeat cleanup, discard bytes, or assert historical
quarantine authority.

## Bounds, recovery and trust

Plans are at most 64,000 bytes and valid for at most 15 minutes. Provider reads have individual 15-second
deadlines and a 120-second observation deadline, no retries or pagination beyond 100 check runs; at most
eight selected checks. Incomplete/ambiguous result sets fail closed. No full test rerun, Git fetch, model
call or provider mutation is performed by cleanup. Existing checks must be independently acceptable.

Profileless modes reuse the clone-common cleanup lock and stable streaming manifests: 16 MiB/10,000 entries each for
projection and registration, 256 MiB/100,000 entries combined for retained shared state, 64 KiB read chunks.
This hashes retained Git objects for preservation proof; it is not a full behavioral test. Oversized stores
fail closed, not truncate or automatically raise limits. No dependencies or src modules are added.
Always-load routing remains 40,632 bytes; the runtime prompt remains 999 bytes.

The existing journal is written before the two recoverable renames: exact worktree projection, then its
exact prunable admin registration. No `git worktree remove/prune`, branch/ref deletion, GC or byte deletion.
Canonical files and ignored artifacts are untouched. Keep the returned projection and registration paths;
these preserve original bytes, not a runnable relocated checkout. Restoration requires deliberate native
recovery with backlinks and registrations reconciled, not blindly executing the quarantined directory.

On response loss, the identical plan/authorization can reobserve a fully completed coordinate while all
bound state remains unchanged, even after expiry; this performs no new rename. Partial journals or drift
remain preserved and blocked. Never delete an unknown coordinate or retry it with fabricated new evidence.

Receipts explicitly say `authority: explicit-local-user-consent`, `providerAuthority:false`,
`protectionProven:false`, `claimRetired:false` and `operatingSystemExclusivityProven:false`. GitHub evidence
is a fresh observation of a merged PR and successful selected checks, not enforced branch protection.
User consent and stopped-worker assertions are trusted caller inputs, not independently authenticated
credentials. An uncooperative same-user process can race or bypass filesystem tools; the local lock cannot
provide distributed/OS exclusion. No active governance claim is retired by this mode.

## ADR and validation

Choose explicit local consent with separate profileless and enrolled recovery admission rather than weaken protected cleanup, require
a paid feature, publish the source or silently prune by merge status. Keep enrollment local so essential
shared source remains minimal. Protected release of this implementation remains a separate workflow. The
reader guard combines recursive open-descriptor checks with a bounded process-CWD scan and fails closed on
an incomplete scan; source rollback uses the protected reviewed revert path and preserves remaining recovery data.

ADR 1.4.6: allocation release may consume the same exact local cleanup receipt used by completion status.
The receipt is an input to existing closeout verification, not a new authority source; receipt mismatch,
unreadable input, incomplete source closeout, or a mounted lane blocks release. Validate CLI option scope
and exact receipt binding with `__tests__/user-cleanup-recovery.test.mjs` and affected repository checks.

`__tests__/user-cleanup.test.mjs` uses real local Git worktrees and mocked bounded provider observations;
it does not claim live GitHub authority. Run it and `__tests__/user-cleanup-recovery.test.mjs` with the existing cleanup tests, then affected validation.
Retain separate live merged/check, plan, consent, quarantine and final synchronization receipts.

## MVP — reference implementation

`USER-CLEANUP-001@1.2.1` selects one stopped, clean reviewed or historically equivalent worktree quarantined through its explicitly selected local-consent mode. Historical equivalence is a local retirement decision, not source integration. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
The 1.4.5 correction blocks projection removal when a process keeps the target as its working directory,
even if no file descriptor below that directory is open. Verify it with `node --test __tests__/cleanup-retirement.test.mjs`
and affected repository checks, preserving their exact source, result and authoring surface. The named command
is a check plan; existing observations above retain their original scope and revision.

## GTM — reference implementation

The initial user is a solo developer or operator completing the selected engineering outcome. WTP, priced-offer acceptance, collected payment and repeat use remain unvalidated. Reuse this free local slice for a timed pilot before considering a hosted service; reject paid infrastructure until buyer evidence justifies it.

The 1.4.5 reader-guard correction is a safety fix, not evidence of lower cleanup cost or willingness to pay. Measure active time and actual reclaimed space in a timed pilot; this change alone claims neither.

Experience assessment for `USER-CLEANUP-001@1.2.0` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.

## Simplification: change-class fast path, stale-ref sweep, and unified CLI

The cleanup harness applies the same machinery to a docs typo as to a multi-repo production release. The following simplifications reduce operator burden for low-risk change classes without weakening any guarantee for the cases that need the full chain.

### Measured worktree-cleanup economics (2026-10-07)

Recent exact-target cleanup receipts show why pruning felt like a multi-hour operation:

- Three sequential Graph lane cleanups each observed roughly 85,000 recovery entries and a 1.66–1.87 GB recoverable projection. Their plan-to-receipt windows were 120–123 seconds each. These windows include authorization and operator handling, so they are not CPU timings.
- Those receipts report `bytesDeleted:false`, `branchesMutated:false`, and `claimRetired:false`. Cleanup quarantines the worktree projection and registration for recovery; it removes the mounted checkout path but does not reclaim its bytes or retire its branch claim. Storage reclamation and claim retirement are separate exact effects.
- The post-cleanup Graph CI observation took 20.2 minutes, mostly execution, and the Agentic OS observation took 4.9 minutes. CI therefore dominated elapsed time after the local quarantine steps.
- The Agentic OS lane cache also contained 14 active records for only two mounted worktrees; 13 records had no mounted checkout, and stale scopes overlapped the current CLI reservation. These records do not justify deleting refs or retiring claims automatically. They do explain admission and cleanup follow-up friction.

The stale-ref sweep now reads the bounded 256-branch inventory with two batched `for-each-ref` calls and one worktree-registry read. Git subprocess count is constant with inventory size, rather than growing by up to three calls per branch. The sweep remains observation-only; each selected target still needs a fresh exact plan and stopped apply because quarantining one peer changes later recovery evidence.

### Owner-controlled quarantine retirement

Quarantine creation remains recoverable. Reclaiming a local-consent quarantine projection is a separate destructive operation; it never runs from age, sweep, cache pressure, or a general cleanup command. It accepts one exact SHA-256 coordinate at a time and supports retained user-cleanup, worktree-cleanup, empty-active-lane-retirement, and local-owner-authorized-quarantine eligibility records. Unknown and protected cleanup schemas fail closed. A detached registration is eligible only when its HEAD log identifies an exact lane ref and that retained commit remains an ancestor of the local ref.

Run from a clean canonical `main` worktree after reviewing the exact coordinate and recovery loss:

```sh
agentic-os cleanup-user retire plan --coordinate=<64-hex-quarantine-coordinate>
agentic-os cleanup-user retire apply --plan=<saved-plan.json> \
  --authorize=agentic-os:quarantine-retirement:<plan-digest> --stopped --discard-recovery
```

The 15-minute plan binds the original operation record, projection and registration manifests, retained branch/head, current branch tip, registration HEAD mode, registration directory identity and mode, and any existing preservation receipt. Apply takes the clone cleanup lock, rechecks those facts, and uses `lsof` to find open descriptors plus process current working directories under either the projection or registration. It caches one CWD snapshot per apply and requires the caller's CWD record; incomplete or failed inspection blocks removal. Tree checks identity-bind a current-user-owned Unix-domain socket only inside the retained registration; sockets and other unsupported special entries in the projection still fail closed. It tightens any legacy `0755` projection or registration root to `0700`, rechecks both exact trees and the registration directory identity, then removes only that projection tree. The registration and its branch evidence remain in place. An interrupted operation requires a new exact resume plan bound to its original intent and remaining trees; it never replays automatically. The operation preserves metadata, branch refs, the Git object database, and any existing preservation receipt. Its v2 receipt is stored as `retirement.json` beside the retained operation record. There is no age-based expiry policy; the operator decides each coordinate.

The durable receipt reports logical bytes unlinked and explicitly leaves `physicalFreeSpaceIncreaseProven:false`. Filesystem snapshots, APFS local snapshots, concurrent system activity, and storage-provider behavior can keep blocks allocated after unlinking; the receipt does not claim a volume-level free-space delta. If open-descriptor or CWD inspection is unavailable or uncertain, apply refuses. If interrupted after its durable intent is written, recovery requires a fresh exact resume plan and preserves the original intent until successful closeout.

These receipts are tested against temporary repository fixtures, including retention of a stale Unix-domain socket in the registration. A real coordinate still requires its own plan, loss acknowledgment, apply result, and receipt. This operation does not retire lane claims or prove provider authority.

For validation, bind every check to the exact candidate and its inputs. Reuse a passing receipt only when those inputs are unchanged; **do not rerun the full smoke suite on unchanged source**. Run focused checks for documentation or isolated behavior changes, then one affected validation for the final changed candidate. Quarantine itself does not justify repeating source validation. A changed source revision or check input requires fresh evidence.

For a progressive closeout with several eligible lanes, use existing state to prioritize the shortest
credible path to completion: already-integrated first, queued next, published last. Divide the remaining
wait budget among eligible lanes so one pending external review cannot consume the whole pass. Preserve
stable path ordering for ties, report noneligible blockers cheaply, and use a fresh bounded pass for later
rechecks. This does not waive source checks, integration gates, user authority, or effect-specific receipts.

Do not weaken recovery inventory checks to improve the timings above. Before retiring a quarantine projection, use the exact owner-controlled retirement plan and receipt above. Before retiring stale lane claims, use the owning claim-retirement operation and preserve the branch/worktree identity evidence.

### Change-class fast path (`--change-class=docs-only`)

When `--change-class=docs-only` is declared AND the lane diff confirms only docs/markdown paths are touched, the local-consent cleanup path is the accepted terminal state (`providerAuthority:false` is sufficient; no protected-authority chain required for this change class).

```sh
agentic-os cleanup-user plan --target=<worktree> --pr=<n> --checks=<list> --workflow=<id> --change-class=docs-only
agentic-os cleanup-user plan --target=<worktree> --pr=<n> --checks=<list> --workflow=<id> --no-ci --change-class=docs-only
```

The receipt includes `changeClass: { declared: 'docs-only', observed: 'docs-only', fastPath: true }` and `authorityTerminalState: 'local-consent'`. If the declared class does not match the observed diff, `change-class-mismatch` is refused.

### Stale-ref sweep (`cleanup-user sweep`)

Produces a bounded retirement plan for lane refs that are (a) merged into canonical, (b) past a staleness window, and (c) not mounted in any active worktree. This is operator consent (`providerAuthority:false`); it does not delete refs — it projects them to recoverable quarantine.

```sh
agentic-os cleanup-user sweep --stale-older-than=<days> [--merged] [--no-active-worktree]
```

Each candidate still requires explicit `--authorize=<plan-digest>` and `--stopped` to apply, same as individual `cleanup-user plan/apply`.

### Verified workflow allocation release

After `completion status` reports `missionState: source_complete`, `cleanupSatisfied: true`, and an unmounted
lane, release its consumed checkout allocation from canonical `main`:

```sh
agentic-os release-common allocation-release --ref=<lane> [--cleanup-receipt=<json>]
```

For a local-consent quarantine, pass the exact cleanup receipt retained beside its operation record. The
command rechecks that closeout before creating an immutable workflow successor whose allocation state is
`released`. It retains the lane ref, worktree identity, head, prior workflow manifests and quarantine evidence.
Only `pending` and `active` allocations consume checkout capacity, so the released history no longer blocks a
subsequent disjoint lane. If no workflow selection was ever retained for that repository and ref, the command
returns a standalone no-op result and writes no workflow successor. A mounted, dirty, unintegrated, or
unquarantined lane still fails closed, and any declared workflow selection continues to fail on drift.

### Unified cleanup CLI (`agentic-os cleanup`)

A thin wrapper that consolidates the three cleanup entry points into one command with mode flags:

```sh
agentic-os cleanup plan --target=<path> --pr=<n> --checks=<list> --workflow=<id> [--mode=local-consent|recovery|no-ci] [--change-class=docs-only] [--detached]
agentic-os cleanup plan --mode=recovery --ref=<lane>
agentic-os cleanup apply --plan=<json> --authorize=<digest> --stopped
agentic-os cleanup sweep --stale-older-than=<days> [--merged] [--no-active-worktree]
```

`--mode` defaults to `local-consent`. `--mode=protected` is reserved for profile-governed repos (those still use `release-common complete` → `completion:scaffold` → `completion:plan/apply`).

### Auto-derive placeholders (`completion:scaffold --derive`)

Pre-fills the lane inventory and a 15-minute expiry. Fill the listed evidence fields: integration and retirement operation inputs, workflow run records, transition receipts, and preservation/no-value receipts. If the authority repository or transition policy is not already known locally, the scaffold also lists those verifier fields.

```sh
npm run completion:scaffold -- --ref=<lane> --derive > /tmp/completion-scaffold.json
```

Fill the fields listed in `hydrationInputs` under `bundleTemplate` in that file. Keep scaffold and plan files outside the canonical checkout so they do not make it dirty. Pass the same scaffold file to planning:

```sh
npm run completion:plan -- --ref=<lane> --bundle=/tmp/completion-scaffold.json > /tmp/completion-plan.json
```

`completion:plan` derives the repeated requests, plan bytes, and digests before live provider checks. It verifies the scaffold still matches the exact lane, integration, profile, and locally observed inventory. An expired scaffold must be regenerated and its provider transitions replayed. Planning does not authorize cleanup; inspect the exact target and `authorizationDigest`. After stopping writers, the short apply form rechecks eligibility and accepts that digest directly, so there is no second plan file to manage:

```sh
npm run completion:apply -- --ref=<lane> --bundle=/tmp/completion-scaffold.json \
  --confirm=<authorizationDigest> --stopped
```

The longer `--plan=<json> --authorize=<digest>` form remains available when a saved plan artifact is required. A changed target, bundle, provider winner, or eligibility observation blocks apply.

### Applicable-to-change-class findings (`completion status`)

The `completion status` output now includes a `changeClass` field (`docs-only`, `mixed`, `empty`, or `unknown`) and an `applicableToChangeClass` field per finding. Findings marked `applicable: false` are not blockers for low-risk change classes — they indicate that local consent is sufficient and the protected authority chain is not required for this change class.

```sh
npm run completion:status -- --ref=<lane>
```

### What is NOT changed

These remain load-bearing and must stay complicated:
- Separate receipts per effect (source/integration/deployment/rollback/cleanup/sync)
- Recoverable quarantine over deletion (the recoverability invariant)
- Fail-closed on incomplete evidence (prefer retained refs over wrong prunes)
- Interactive-provider confirmation for production deploy/rollback

Run `node --test __tests__/simplification.test.mjs` to verify these simplifications.
