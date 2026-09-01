# Agent Instructions

Always-load layer for the Agent Development Lifecycle (ADLC). Everything else loads on demand.
ADLC supersedes Agentic SDLC: lanes and computed proofs replace phases and approval documents.

## Non-negotiable rules

1. Never author on the profile's canonical branch. Its worktree is the read-only runtime and sync
   owner. Author only in a lane worktree.
2. One lane = one worktree = one branch. If the profile selects pull requests, it also has one PR.
   Create it with `npm run lane -- <scope>`.
3. Never rebase or restack a published lane. Only an observed merge-queue entry proves tested
   protected ordering; auto-merge alone leaves the lane `published`.
4. Never ask "is this already merged?" from memory or a ledger. Run `npm run reap` — exact
   ancestry or touched-path content identity answers it.
5. Treat registered worktrees and retained refs as observations, never capacity limits or claims.
6. Fix defects at the owning source. No downstream masks, aliases, shims, or per-scenario modules.
7. Budgets are contracts: docs are byte-capped, `src/` is module-capped. `npm run check` enforces both.

## Commands

| Intent | Command |
|---|---|
| Configure a fresh clone from its primary canonical worktree | `npm run setup` |
| Verify the harness invariants | `npm run doctor` |
| Open a lane | `npm run lane -- <scope>` |
| Publish and project a selected review | `npm run land` |
| See registered lane projections and provider state | `npm run status` |
| Classify exact integration | `npm run reap` |
| Prove the repository | `npm run check` |

## Owner routing

| Concern | Owner |
|---|---|
| Lane states and legal transitions | `docs/LANE.md`, `src/lane-state.mjs` |
| Provider handoff and tested ordering | `docs/MERGE-QUEUE.md`, `src/queue.mjs` |
| Already-integrated proof | `src/patch-identity.mjs` |
| Budgets and token economics | `docs/BUDGETS.md` |

## Why this shape

Three settings compose into a rebase livelock: require-branches-up-to-date, squash-only merges,
and no merge queue. Each merge invalidates other open PRs, squash destroys the ancestry that would
prove a lane already landed, and separate clones may repeatedly resolve the same conflicts.

This harness removes the livelock by configuration, not by recovery code:

- An externally authorized, observed queue entry serializes and tests protected-branch landing order.
- Exact mode/type/blob identity on every lane-touched path answers "already integrated" after a
  squash; whitespace-insensitive patch IDs and `Source-Head` are never retirement proof.
- A consumer may opt into native `rerere`; the harness does not mutate unrelated Git policy.

Branch names, pull requests, and local lane records are projections, never governance authority.
Cross-device scope exclusion is unsupported until an authoritative adapter supplies an authenticated,
fenced compare-and-swap claim. Never infer ownership from a device segment.

`reap` is read-only classification. It never ends authority, unregisters a worktree, deletes a ref,
or removes bytes. Authenticated `retire(claim)` and target-specific cleanup receipts are separate.

Recovery scenarios are states in one machine, not subsystems. If you are tempted to add a module
for a new scenario, add a row to the state table instead.

## Completion

Run `npm run check`. Record real evidence only; a command exiting zero is not proof that a claim holds.
