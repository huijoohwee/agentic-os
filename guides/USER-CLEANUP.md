---
title: "Explicit local-consent worktree cleanup"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.2.0"
date: "2026-09-15"
owner: "agentic-os"
continuity_id: "USER-CLEANUP-001"
prd_revision: "1.2.0"
tad_revision: "1.2.0"
adr_revision: "1.2.0"
load_policy: "on-demand"
lang: "en-US"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-0232231d4a19--detached-cleanup"
agent_id: "codex-01a09db4"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "a0a8818bfdf4581f5382e85345b176227f41040a"
mvp_revision: "1.2.0"
gtm_revision: "1.2.0"
---

# Explicit local-consent worktree cleanup

## PRD: preserve work without inventing protected authority

A private/free repository may have merged, checked work but no server-enforced protection or ADLC profile.
An explicitly authorized operator must be able to close an exact stopped worktree without paying for a
plan, publishing private content or fabricating provider-issued integration/retirement records.

Acceptance: local opt-in plus one exact plan authorization and stop acknowledgement; freshly observed
same-repository merged PR and selected successful GitHub Actions checks; equal candidate/merge trees;
merge ancestry in clean, current main; exact target, inventory, peers, refs and object preservation;
recoverable projection/registration quarantine; distinct local-consent receipt and bounded replay.

## TAD: separate admission, shared preservation machinery

`bin/agentic-os-cleanup-user.mjs` owns local admission, plans, authorization and receipts.
`bin/agentic-os-cleanup-review.mjs` owns bounded read-only GitHub evidence. The existing quarantine
mechanics take an internal policy observer; protected cleanup never forwards caller-supplied policy
overrides and still requires its authenticated integration/retirement joins. This is not a fallback.

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

`USER-CLEANUP-001@1.2.0` also covers an operator-authorized, stopped, clean historical lane whose PR is
merged but whose historical authority records are unavailable. User authorization must cover the exact
targets and recoverable cleanup; it may persist across turns. The caller selects this mode explicitly:

```sh
git config --local agentic-os.userCleanup quarantine-recovery
agentic-os cleanup-user plan --recovery --target=<absolute-worktree-path> --pr=<number> \
  --checks=<sorted-profile-checks> --workflow=.github/workflows/<review-workflow>.yml
```

Review and apply one exact plan with the same `apply --plan --authorize --stopped` interface above. Run
from the surviving canonical checkout with the reviewed upstream CLI. Remove the clone-local opt-in after
the selected batch. Never invoke code from a directory after it has been quarantined.

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

For a stopped detached worktree retained at an ancestor of the checked PR head, explicitly add
`--detached` to the recovery plan. The plan keeps the reviewed PR head and actual detached HEAD separate.
Both must have exact source-content inclusion at the actual merge, and the detached commit must be an
ancestor of that same reviewed head. Ancestry alone cannot cover overwritten files; matching content
alone cannot cover unrelated history. Attached targets, unbound commits and any head/branch/content drift
fail. Apply rechecks both proofs and preserves all refs, objects, ignored files and the detached registration.
This option changes no default or protected cleanup admission and creates no historical authority.
Recovery also preserves regular-file hardlinks in dependency trees: manifests bind link counts and bytes,
and alias writes invalidate the plan. Symlink hardlinks and special files remain rejected.

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
shared source remains minimal. Protected release of this implementation remains a separate workflow.

`__tests__/user-cleanup.test.mjs` uses real local Git worktrees and mocked bounded provider observations;
it does not claim live GitHub authority. Run it and `__tests__/user-cleanup-recovery.test.mjs` with the existing cleanup tests, then affected validation.
Retain separate live merged/check, plan, consent, quarantine and final synchronization receipts.

## MVP — reference implementation

`USER-CLEANUP-001@1.2.0` selects one stopped, clean merged worktree quarantined through its explicitly selected local-consent mode. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
Verify that acceptance with `node --test __tests__/user-cleanup.test.mjs` and the affected repository checks, preserving their exact source, result and authoring surface. The named command is a check plan; existing observations above retain their original scope and revision.

## GTM — reference implementation

The initial user is a solo developer or operator completing the selected engineering outcome. WTP, priced-offer acceptance, collected payment and repeat use remain unvalidated. Reuse this free local slice for a timed pilot before considering a hosted service; reject paid infrastructure until buyer evidence justifies it.

Experience assessment for `USER-CLEANUP-001@1.2.0` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.
