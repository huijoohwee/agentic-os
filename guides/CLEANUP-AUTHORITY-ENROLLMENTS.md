---
schema: agentic-os/cleanup-authority-enrollments/v1
title: Exact current-recovery enrollments
doc_type: PRD-TAD-ADR-MVP-GTM
continuity_id: CLEANUP-AUTHORITY-001
version: 1.2.3
prd_revision: 1.2.3
tad_revision: 1.2.3
adr_revision: 1.2.3
mvp_revision: 1.2.3
gtm_revision: 1.2.3
load_policy: on-demand
lifecycle_status: active
---
# Exact current-recovery enrollments

These records bind exact current observations in `.agentic-os/github-transition-policy.json`. They do not establish historical authority or grant effects beyond each separately authorized plan and receipt.

## Current-quarantine discard acknowledgement adoption — agentic-os PR #475 — 2026-10-17

The operator authorized discarding the exact quarantined projection for `agent/device-0232231d4a19/current-retention-pr474`. The current record binds target head `b8fb84454cc560012bf88d9fa678c97c4a43217d`, merged review [PR #475](https://github.com/huijoohwee/agentic-os/pull/475) at `27dedbdd6dec8bd4be8fa2eda530d8a6b697a4c6`, quarantine coordinate `2fec5fe9ee4e5c046357e2033c5414077fe5f27db452c1c755b04878f5fe4de0`, and original discard receipt digest `9a9a6da8be402615a8599b63280f3937a410b031e80e7a83ff0b16385a4d8af6`.

The receipt records 8,237,897 logical bytes unlinked across 744 entries; the retained registration is 74,327 bytes / 19 entries. The branch and Git object database remain, and physical free-space gain is unproven. `historicalQuarantineAuthorityProven`, `providerAuthority`, and `claimRetired` remain false. This adoption records the already authorized local disposition; it does not repeat deletion or grant another cleanup effect.

## Current recovery enrollment — agentic-os PR #477 — 2026-10-17

Repository `github.com/huijoohwee/agentic-os`; review [PR #477](https://github.com/huijoohwee/agentic-os/pull/477). Base `cb4149dc7581e48923de851b424e39bc339afb5a`; reviewed head `fe7f493fc51702438fe6b14d07a001260ba25f7f`; merge `e5c14e5c0236cba859ee8996f8b7b3660a256e20`; equal tree `6c5e0fb2aab95cd3ee3ef70f7a570b84d985458e`; `budgets` and `test` passed.

This records current merge facts only. Historical protection, required-check policy, Ruleset Suite, and merge-method authority remain unproven. The enrollment grants no merge, retirement, cleanup, deployment, or canonical-sync effect; each later effect requires its own exact plan, authorization, and receipt.

## Current recovery enrollment — agentic-os PR #478 — 2026-10-17

Repository `github.com/huijoohwee/agentic-os`; review [PR #478](https://github.com/huijoohwee/agentic-os/pull/478). Base `e5c14e5c0236cba859ee8996f8b7b3660a256e20`; reviewed head `aadcd19641d9ef2273b4bb7ea89227f501375dce`; merge `91e39eac8758573ce8e1103d8617ecfd53ce3259`; equal tree `43f023e4f84411f58d904836071c2710169125f3`; `budgets` and `test` passed.

This records current merge facts only. Historical protection, required-check policy, Ruleset Suite, and merge-method authority remain unproven. The enrollment grants no merge, retirement, cleanup, deployment, or canonical-sync effect; each later effect requires its own exact plan, authorization, and receipt.

Budget: one current-quarantine adoption and two current-recovery enrollments, one existing transition-workflow test owner, one guidance companion, zero runtime modules, dependencies, or always-load bytes. Revert the policy entries and companion through a protected commit; preserve receipts and Git history.
