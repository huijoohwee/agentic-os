---
title: "Explicit local-consent worktree cleanup"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.1"
date: "2026-09-12"
owner: "agentic-os"
continuity_id: "USER-CLEANUP-001"
prd_revision: "1.0.1"
tad_revision: "1.0.1"
adr_revision: "1.0.1"
load_policy: "on-demand"
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
mvp_revision: "1.0.1"
gtm_revision: "1.0.1"
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

The local path refuses any committed/local `.agentic-os.json` or repository trust anchor. Enrolled
profile-governed repositories must use their existing protected cleanup path, even if it fails.
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

## Bounds, recovery and trust

Plans are at most 64,000 bytes and valid for at most 15 minutes. Provider reads have individual 15-second
deadlines and a 120-second observation deadline, no retries or pagination beyond 100 check runs; at most
eight selected checks. Incomplete/ambiguous result sets fail closed. No full test rerun, Git fetch, model
call or provider mutation is performed by cleanup. Existing checks must be independently acceptable.

Reuse the clone-common cleanup lock and stable streaming manifests: 16 MiB/10,000 entries each for
projection and registration, 256 MiB/100,000 entries combined for retained shared state, 64 KiB read chunks.
This hashes retained Git objects for preservation proof; it is not a full behavioral test. Oversized stores
fail closed, not truncate or automatically raise limits. No dependencies or src modules are added.
Always-load routing remains 40,901 bytes; the runtime prompt remains 999 bytes.

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

Choose explicit local consent for profileless repositories rather than weaken protected cleanup, require
a paid feature, publish the source or silently prune by merge status. Keep enrollment local so essential
shared source remains minimal. Protected release of this implementation remains a separate workflow.

`__tests__/user-cleanup.test.mjs` uses real local Git worktrees and mocked bounded provider observations;
it does not claim live GitHub authority. Run it with the existing cleanup tests, then affected validation.
Retain separate live merged/check, plan, consent, quarantine and final synchronization receipts.

## MVP — reference implementation

`USER-CLEANUP-001@1.0.1` selects one profileless, stopped worktree quarantined through explicit local consent. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
Verify that acceptance with `node --test __tests__/user-cleanup.test.mjs` and the affected repository checks, preserving their exact source, result and authoring surface. The named command is a check plan; existing observations above retain their original scope and revision.

## GTM — reference implementation

The initial user is a solo developer or operator completing the selected engineering outcome. WTP, priced-offer acceptance, collected payment and repeat use remain unvalidated. Reuse this free local slice for a timed pilot before considering a hosted service; reject paid infrastructure until buyer evidence justifies it.

Experience assessment for `USER-CLEANUP-001@1.0.1` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.
