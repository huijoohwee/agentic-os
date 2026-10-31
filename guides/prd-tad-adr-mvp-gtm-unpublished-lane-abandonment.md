---
schema: agentic-os/prd-tad-adr-mvp-gtm/v1
title: Unpublished lane abandonment with recoverable quarantine
doc_type: PRD-TAD-ADR-MVP-GTM
version: 1.0.0
owner: agentic-os
---
# Unpublished lane abandonment

## Problem and outcome

`complete-adlc` deliberately refuses to clean an unpublished dirty lane, even when its useful source has been
merged through another lane. Operators need an explicit local disposition for obsolete scratch work that does not
pretend integration or discard authored bytes. Add one exact plan/apply path to archive the complete checkout and
registration privately, retain every local and remote ref and Git object, record `sourceDisposition: abandoned`, and
let closeout release the workflow allocation only after it verifies the archive and clean unmounted state.

## Decision and scope

- Support one exact lane at a time. Require current clean canonical `main`, an active lane record with no PR, no live
  remote branch, an exact registered worktree, and a bounded reason supplied by the owner.
- Bind lane ref, base/head, worktree path, canonical/profile identity, dirty recovery inventory, projection and
  registration manifests, all refs, and object inventory into a short-lived plan. Apply requires the matching digest,
  a stopped-writer scan, and a receipt.
- Move projection and registration into the clone-private quarantine. Preserve dirty, untracked, ignored, and indexed
  bytes; change no Git refs, object database, provider state, or deployment state.
- Raise only the existing lane-cache aggregate-string ceiling to 415,000 bytes so the current 399,770-byte cache
  can admit its exact lane record. Keep string interning and all entry/file limits unchanged; add no cache eviction.
- Verify the retained quarantine and exact branch ref before closeout reports abandonment complete. Keep
  `sourceIntegrated` and `sourceSuperseded` false. Reuse the current cleanup and allocation-release owners.
- Do not add global cleanup sweeps, branch deletion, data discard, same-repository integration claims, or production
  effects.

## Acceptance and sprint limits

- The active dirty fixture closes only after an exact authorized plan; drift, open writers, missing archive bytes,
  changed refs/objects, and replay fail closed.
- Completion distinguishes abandoned from integrated and superseded; branch and object identities remain unchanged.
- Add durable tests to the existing cleanup-retirement suite and run `npm run check` plus the standard release gates.
- Ten reserved paths: `__tests__/cleanup-retirement.test.mjs`, `bin/agentic-os-completion-status.mjs`,
  `bin/agentic-os-lane-abandon.mjs`, `docs/RELEASE-WORKFLOW.md`, `guides/PRD-TAD-ADR-MVP-GTM.md`,
  `guides/USER-CLEANUP.md`, this planning file, `package.json`, `src/cleanup-records.mjs`, and
  `src/lane-records.mjs`.
- Zero new `src/` modules; one new command module under 450 lines; resulting diff <=250 kB; local implementation/check
  ETA 2 hours. External CI wait is reported as a blocker with recheck, not an ETA.

## Repository contracts

Follow [START](../docs/START-WORKFLOW.md), [ADLC](../docs/adlc-guidelines.md),
[RELEASE](../docs/RELEASE-WORKFLOW.md), [DEPLOY](./DEPLOY-WORKFLOW.md), and
[cleanup ownership](./USER-CLEANUP.md). This source-only disposition does not authorize a deployment or rollback.
