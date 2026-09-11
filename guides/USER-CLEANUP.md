---
title: "Explicit local-consent worktree cleanup"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.0"
date: "2026-09-11"
owner: "agentic-os"
continuity_id: "USER-CLEANUP-001"
prd_revision: "1.0.0"
tad_revision: "1.0.0"
adr_revision: "1.0.0"
load_policy: "on-demand"
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
