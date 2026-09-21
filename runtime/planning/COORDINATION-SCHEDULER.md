---
title: "Coordination Scheduler"
graphId: "md:coordination-scheduler"
doc_type: "Runtime Contract"
date: "2026-08-16"
lang: "en-US"
schema: "agentic-coordination-scheduler-report/v1"
frontmatter_contract: "required"
status: "source-migrated"
runtime_owner: "./coordination-scheduler.mjs"
runtime_proof: "../../__tests__/coordination-scheduler.test.mjs"
---

# Coordination Scheduler

`/coordination.schedule #workspace-parallelism @coordination-plan` partitions
independent work into bounded deterministic waves. It is a read-only planner:
it never creates a claim, grants authority, runs a command, edits a lease,
touches a worktree, closes a pull request, merges, publishes, or deploys.

Each task supplies its exact declared write set, dependency ids, priority,
cloud authority state, and typed findings. Only `current` authority can be
scheduled. Waiting successors stay non-writing; reviewed, dormant, integrated,
and retired states do not become authoring authority.

A task may also retain an `externalWait`: `dependencyId`, `condition`,
`observationDigest` (64 lowercase hexadecimal characters), and `recheckTrigger`.
Text fields are nonempty and bounded to 1,024 characters; unknown fields fail
closed. A valid wait never overrides an admission finding or unavailable
authority. Its exact evidence remains in the digest-bound disposition.

Waiting successors and explicit external waits retain their declared write
reservations even when another finding or gate blocks their owner. Overlaps receive `write-set-reserved`; their dependents
wait too. Disjoint eligible tasks continue. A later scheduling wave cannot
release another writer's reservation. Only refreshed input from the owning
workflow can establish that the dependency or reservation has changed.

Global `attention-required` is non-blocking only when the finding includes a
content-bound affected write set that is provably disjoint from the candidate.
Missing or overlapping scope evidence still blocks. Candidate and
semantic-scope findings always block. This preserves fail-closed admission
while preventing unrelated, fully attributed residue from serializing the
whole workspace.

Within each wave, tasks are ordered by descending priority and then stable id.
The configured capacity and declared write-set overlap bound every wave.
Dependencies create later waves; a blocked or waiting dependency propagates a
typed disposition instead of stalling unrelated roots.

Run:

```sh
node ./runtime/planning/coordination-scheduler.mjs plan --input=/absolute/external/input.json --json
```

The report contains `ready`, `waiting`, `blocked`, `nonBlockingAttention`, and
`waves`, plus canonical input and report digests. Consumers may invoke only the
ready tasks through their existing admitted owners; the report itself grants
no mutation, review, integration, release, Production, or Cloudflare authority.

Execute only an eligible first wave, then replan from its actual outcomes.
Later waves project dependency order; they do not certify that earlier work
succeeded. Wait records use meaningful events or independent milestones as
recheck triggers; the planner has no clock, observer, polling loop or dispatcher.

Migrated native source owner: agentic-os. Historical `/coordination.schedule` and
`/goal.advance` spellings above describe the original command vocabulary; the
explicit package CLI exports are the supported invocation paths until catalog
registration. Caller-supplied authority labels grant no effect authority.
