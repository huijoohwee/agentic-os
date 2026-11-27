---
doc_type: PRD-TAD-ADR-MVP-GTM
title: Shared Design System ownership and lane admission continuity
version: 1.0.0
owner: agentic-os
status: draft
load_policy: on-demand
---

# Shared Design System ownership and lane admission continuity

## Problem

Panel, toolbar, and reusable control behavior can drift when each consumer owns a
parallel adapter or semantic map. In addition, a protected-head refresh can prepare an
exact alignment candidate but fail to bind its pending allocation and workflow member
to that same candidate before applying it. Both gaps make centralized ownership hard to
enforce through the cross-repository release path.

## PRD

Make `agentic-design-system` the canonical owner of shared tokens, themes, semantic
controls, icons, accessibility labels, visuals and states, placement, native and React
adapters, panel lifecycle, and projection validation. Base, Graph, Commerce, Canvas, and
related repositories are direct peer consumers that import exact pinned APIs. Forbid
duplicate maps, adapters, shells, and consumer overrides. Keep product content, feature
availability, view state, and callbacks in consumers. Separately, ensure a stopped
native lane alignment records its prepared candidate as both the pending allocation head
and workflow member source before applying the candidate.

## TAD

Add the shared ownership and panel conformance contracts, link the always-load ADLC
guideline to the broad contract, and adjust the native admission handoff so a verified
lane-alignment candidate and its allocation/member binding are recorded together. Add a
regression to the existing lane-alignment suite for a reconciled successor readmit,
including exact pending and active workflow bindings. Preserve existing ancestry,
reconciliation, journal, dirty-byte, and identity checks. No new runtime module,
dependency, service, paid resource, or deployment change.

## ADR

The Design System is the sole source owner. Product repositories consume it directly;
Base is not an adapter broker. The AOS workflow must bind the exact immutable alignment
candidate before materializing it and must fail closed on any revision, path, ancestry,
or identity drift.

## MVP and verification

Acceptance: shared ownership covers reusable controls beyond panel actions; consumers
are direct peers; the panel extension covers MainPanel, FloatingPanel, BottomPanel and
their shared controls; and a reconciled native readmit records the same exact candidate
in its allocation and member before alignment, then returns both to the applied head.
Verify contract links, `npm run evals`, the focused lane-alignment regression, the
affected AOS gate, and `git diff --check`. Source checks do not imply consumer release,
merge, deployment, or production behavior.

## GTM, budget, and rollback

The value is lower cross-repository drift and fewer stranded lane refreshes; buyer demand,
savings, and revenue remain unmeasured. Budget: nine Markdown/source/test/config
paths total, under 17 KiB added, 60 active minutes, zero new modules, dependencies,
services, paid resources, deployment, or always-load growth. Rollback is a reviewed
source revert; workflow journal and recovery refs remain preserved.
