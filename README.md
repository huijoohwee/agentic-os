# agentic-os

The **Agent Development Lifecycle (ADLC)** harness. A clonable, runnable workspace for
multi-worktree, multi-agent development that lands work on `main` without a rebase livelock.
Zero runtime dependencies.

ADLC supersedes the earlier Agentic SDLC framing. The difference is not cosmetic: an SDLC describes
humans shepherding changes through phases, so its artifacts are documents and approvals. ADLC
describes agents opening, proving, and closing lanes at machine pace, so its artifacts are a state
table, a queue position, and a computed integration proof. Phase documents are replaced by lane
states; approvals are replaced by required checks on a queued batch.

## Quick start

```sh
git clone https://github.com/huijoohwee/agentic-os.git
cd agentic-os
npm install
npm run setup      # git config + hooks, local only
npm run doctor     # reports harness and remote drift, changes nothing
```

Open a lane, work, land it:

```sh
npm run lane -- pricing-table   # worktree + branch agent/<device>/pricing-table at fetched origin/main
# ... author, commit ...
npm run land                     # push, open PR, enqueue
npm run status                   # lanes, WIP, queue
npm run reap                     # survey lanes proven integrated; add -- --apply to retire
```

If canonical `main` is behind with unstaged or untracked bytes, create a read-only synchronization
plan instead of stashing or resetting it:

```sh
npm run --silent sync:canonical > /tmp/canonical-sync.json
# Review the exact SHAs, inventory digest, recovery ref, and authorization in the plan.
node bin/agentic-os.mjs canonical-sync apply \
  --plan=/tmp/canonical-sync.json --authorize=agentic-os:canonical-sync:<plan-digest>
```

Apply rechecks the plan, captures nonignored dirty state in the printed recovery ref, restores the
already-fetched protected `origin/main` tree, compare-and-swaps local `main`, preserves ignored
files, and prints a receipt. The operation is recovery-backed, not atomic: if it is interrupted
after recovery-ref creation, do not repeat it blindly; preserve the checkout and recover from the
exact printed ref. A post-recovery failure names that ref and commit explicitly.

## What problem this solves

Three settings compose into a livelock that no amount of recovery code fixes:

1. require branches up to date before merging,
2. squash-only merges,
3. no merge queue.

Every merge invalidates every other open PR, so each one must be restacked and revalidated. Squash
destroys the ancestry that would prove a lane's content already landed, so lanes accumulate as
"unmerged" while being mostly done. Without `rerere`, every device re-resolves the same conflicts on
every restack. Draining `N` open PRs costs up to `N x (N-1)` CI cycles.

The fix is configuration plus two small primitives, not a recovery subsystem:

| Problem | Fix here |
|---|---|
| Ordering and restack churn | Native merge queue owns base updates; `queued` lanes cannot restack |
| "Is this already merged?" | `Source-Head` trailer, then patch identity — a computed fact |
| Re-resolving one conflict forever | `rerere` on, shared across every worktree in the clone |
| Restacking a stack member by member | `rebase.updateRefs`, one operation for the whole chain |
| Unbounded WIP | 3 open lanes per device, stack depth 3 |
| `main` as a work surface | `main` is read-only; hooks refuse commits and direct pushes |
| Instruction bloat | Byte budgets, not line budgets |

## Layout

```
AGENTS.md            always-load instruction layer, 4 KB cap
docs/LANE.md         lane state machine, the scenario SSOT
docs/MERGE-QUEUE.md  ordering, batching, ejection, stacked lanes
docs/BUDGETS.md      byte and module budgets
docs/INVOCATION.md   exact slash, semantic, and binding grammar
docs/MCP.md          backend MCP tool and transport contract
src/                 small responsibility-owned modules, 25 module cap
catalog/             invocation and feature data with count and digest fences
bin/                 CLI and stdio MCP entrypoints
```

## Verify

```sh
npm run check   # tests + doc budget + module budget
```

Rank the digest-fenced feature catalog with hard constraints, Pareto dominance, and argumentation:

```sh
npm run feature:rank   # 0 selected, 2 no grounded selection, 1 rejected input/evidence
```

The command supplies no buyer-evidence verifier, so the seed remains fail-closed. An embedding may
pass `rankFeatures` a code-owned `verifyDemandEvidence` adapter returning its verifier identity and
receipt; self-attested, stale, or candidate-mismatched receipts never satisfy the demand gate.

## Remote configuration

`npm run doctor` reports required remote settings and any drift. `npm run queue:apply` writes them
and is deliberately a separate, explicit command because it mutates shared branch protection. Review
`npm run queue:show` first.

## Bootstrapping

The guard refuses commits on `main`, including the harness's own first commit. That is intended: a
fresh clone should hit the rule immediately rather than discover it later. For a genuine
repository-owned bootstrap, set `AGENTIC_OS_ALLOW_MAIN_WRITE=1` for that one command. Every change
after bootstrap goes through a lane and the queue.
