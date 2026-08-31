# Agent Instructions

Always-load layer for the Agent Development Lifecycle (ADLC). Everything else loads on demand.
ADLC supersedes Agentic SDLC: lanes and computed proofs replace phases and approval documents.

## Non-negotiable rules

1. Never author on `main`. `main` is the read-only runtime and sync owner. Author only in a lane worktree.
2. One lane = one worktree = one branch = one PR. Create it with `npm run lane -- <scope>`.
3. Never rebase or restack a lane that has an open PR. The merge queue owns base updates.
   The only legal restack is after the queue ejects the lane.
4. Never ask "is this already merged?" from memory or a ledger. Run `npm run reap` — patch identity answers it.
5. Respect the caps: 3 open lanes per device, stack depth 3. If you are at the cap, land something first.
6. Fix defects at the owning source. No downstream masks, aliases, shims, or per-scenario modules.
7. Budgets are contracts: docs are byte-capped, `src/` is module-capped. `npm run check` enforces both.

## Commands

| Intent | Command |
|---|---|
| Configure a fresh clone | `npm run setup` |
| Verify the harness invariants | `npm run doctor` |
| Open a lane | `npm run lane -- <scope>` |
| Publish and enqueue a lane | `npm run land` |
| See lanes, WIP, queue | `npm run status` |
| Retire integrated lanes | `npm run reap -- --apply` |
| Prove the repository | `npm run check` |

## Owner routing

| Concern | Owner |
|---|---|
| Lane states and legal transitions | `docs/LANE.md`, `src/lane-state.mjs` |
| Ordering, batching, ejection | `docs/MERGE-QUEUE.md`, `src/queue.mjs` |
| Already-integrated proof | `src/patch-identity.mjs` |
| Budgets and token economics | `docs/BUDGETS.md` |

## Why this shape

Three settings compose into a rebase livelock: require-branches-up-to-date, squash-only merges,
and no merge queue. Each merge invalidates every other open PR, squash destroys the ancestry that
would prove a lane already landed, and the same conflicts get re-resolved on every device.

This harness removes the livelock by configuration, not by recovery code:

- The queue serializes and batches, so nobody restacks for ordering.
- Patch identity and a `Source-Head` trailer answer "already integrated" as a computed fact.
- `rerere` resolves a conflict once per clone and replays it across every worktree.
- `rebase.updateRefs` restacks a whole stack in one operation.

Recovery scenarios are states in one machine, not subsystems. If you are tempted to add a module
for a new scenario, add a row to the state table instead.

## Completion

Run `npm run check`. Record real evidence only; a command exiting zero is not proof that a claim holds.
