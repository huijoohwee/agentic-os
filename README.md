# agentic-os

The **Agent Development Lifecycle (ADLC)** harness. A clonable, runnable workspace for
multi-worktree, multi-agent development that lands work on a canonical branch without rebase livelock.
Zero runtime dependencies.

ADLC supersedes the earlier Agentic SDLC framing. The difference is not cosmetic: an SDLC describes
humans shepherding changes through phases, so its artifacts are documents and approvals. ADLC
describes agents opening, proving, and closing work at machine pace. Its Git lane state is a local
projection; provider observations and computed integration proofs bind exact revisions. A branch,
pull request, or cached lane record never grants governance authority.

## Quick start

```sh
git clone https://github.com/huijoohwee/agentic-os.git
cd agentic-os
npm install
npm run setup      # git config + hooks, local only
npm run doctor     # reports harness and remote drift, changes nothing
npm run observe    # profile-bound, shallow, machine-readable local evidence
```

Open a lane, work, land it:

```sh
npm run lane -- pricing-table   # worktree + branch at the profile's fetched canonical ref
# ... author, commit ...
npm run land                     # publish exact head; project the capability-selected review
npm run status                   # lanes, WIP, queue
npm run reap                     # classify exact integration; never cleans or retires authority
```

If the profile's canonical branch is behind with unstaged or untracked bytes, create a read-only
synchronization plan instead of stashing or resetting it:

```sh
npm run --silent sync:canonical > /tmp/canonical-sync.json
# Review the exact SHAs, inventory digest, recovery ref, and both authorizations in the plan.
node bin/agentic-os.mjs canonical-sync apply \
  --plan=/tmp/canonical-sync.json \
  --authorize=agentic-os:canonical-sync:<plan-digest> \
  --exclusive=agentic-os:canonical-sync:exclusive:<plan-digest>
```

Apply rechecks the plan, captures nonignored dirty state in the printed recovery ref, restores the
profile-selected fetched protected tree, compare-and-swaps its local branch, preserves ignored
files, and prints a receipt. Before supplying the exact `--exclusive` token, stop every IDE agent,
hook, watcher, and process that can write the checkout. The Git-private lock serializes cooperating
canonical-sync processes but cannot stop an uncooperative filesystem writer. Every tracked and
nonignored path is moved atomically into Git-private quarantine and verified. Exact target blobs
are staged privately and installed with no-clobber links, so a path recreated after quarantine is
retained and forces a typed failure instead of being overwritten. On success, target staging is
removed but verified quarantine is retained as an independent recovery anchor; its path is in the
receipt, a digest-bound manifest maps every retained slot to its source path, and cleanup requires a
later bounded authorization. Directory-to-file topology and Git submodule/gitlink topology are
refused before recovery. The final configured target and recovery-ref verifications plus canonical
branch advance share one reference transaction; no claim is made that a mutable recovery ref stays durable
later.

Node does not expose portable anchored `openat`/`renameat` operations. The exact `--exclusive`
assertion is therefore the safety boundary for directory-parent races: pre-existing symlink or
non-directory ancestors are refused, but an uncooperative writer can invalidate that assertion.

The operation is recovery-backed, not atomic. If interrupted after recovery-ref creation, do not
repeat it blindly: preserve the checkout, recovery ref, lock, and named quarantine/staging paths.
Every caught post-recovery failure names the exact recovery ref and commit; a quarantine failure
also names the retained quarantine directory.

## Public governance API

The package root exposes only the four provider-neutral request operations: `claim`, `continue`,
`integrate`, and `retire`, alongside their canonical JSON record helpers. These operations construct
unsigned requests; they do not acquire authority or perform Git, provider, release, runtime, or
cleanup effects. Receipt-envelope digest checks are structural integrity checks, never
authentication. See [docs/GOVERNANCE.md](docs/GOVERNANCE.md) for the exact records, external
authenticated/fenced verifier boundary, `.agentic-os.json` profile, and optional Git/GitHub adapters.
`agentic-os request <claim|continue|integrate|retire> --input=<json>` emits the same unsigned,
canonical Coordination Request for shell consumers; it never executes the requested transition.

## What problem this solves

Three settings compose into a livelock that no amount of recovery code fixes:

1. require branches up to date before merging,
2. squash-only merges,
3. no merge queue.

Every merge can invalidate checks on other open PRs. Squash destroys ancestry that would prove a
lane's content already landed, so lanes accumulate as "unmerged" while being mostly done. Without
tested protected ordering, draining `N` open PRs can cost up to `N x (N-1)` CI cycles.

The fix is configuration plus two small primitives, not a recovery subsystem:

| Problem | Fix here |
|---|---|
| Ordering and stale-base churn | Only an observed native merge-queue entry becomes `queued` |
| "Is this already merged?" | Ancestry or exact mode/type/blob identity for every touched path |
| Re-resolving one conflict forever | `rerere` on, shared across worktrees in one clone |
| Unbounded local WIP | 3 open lanes per device namespace |
| Canonical branch as a work surface | Its worktree is read-only; hooks refuse commits/direct pushes |
| Instruction bloat | Byte budgets, not line budgets |

## Layout

```
AGENTS.md            always-load instruction layer, 4 KB cap
docs/LANE.md         lane state machine, the scenario SSOT
docs/MERGE-QUEUE.md  provider handoff and tested protected ordering
docs/BUDGETS.md      byte and module budgets
docs/INVOCATION.md   exact slash, semantic, and binding grammar
docs/MCP.md          backend MCP tool and transport contract
docs/GOVERNANCE.md   provider-neutral records, trust boundary, and reference adapters
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

`npm run doctor` reports required remote settings and any drift. `npm run queue:show` prints the
GitHub reference plan. Candidate code refuses to apply repository-owned provider policy.

## Bootstrapping

The guard refuses commits on the profile's canonical branch, including a repository's first
profile-governed commit. That is intended: a fresh clone should hit the rule immediately. For a genuine
repository-owned bootstrap, set `AGENTIC_OS_ALLOW_MAIN_WRITE=1` for that one command. Every change
after bootstrap goes through a lane and the consumer-owned protected integration path.
