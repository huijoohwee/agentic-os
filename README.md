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
npm run setup      # packaged safety hooks, local only; existing hook paths fail closed
npm run doctor     # reports harness and remote drift, changes nothing
npm run observe    # profile-bound, shallow, machine-readable local evidence
```

Consumer repositories should pin a full Git source revision, for example
`github:huijoohwee/agentic-os#<40-hex-commit>`. Registry-name resolution is not part of this
contract; a floating package name cannot identify the audited governance bytes. Run setup only
from the primary canonical worktree; it refuses existing hook managers instead of composing them
implicitly and installs a versioned runtime in clone-common Git storage. Commit the repository's
canonical `.agentic-os.json` first: every repository-bound command requires it and invents no
default branch, remote, provider, checks, or ordering policy.

The first successful `setup` is an explicit trust-on-first-use ceremony. After you verify the
committed profile's repository identity and canonical refs, setup records only those stable fields
at `<git-common-dir>/agentic-os/repository-trust.json`. Git's common directory is shared by every
worktree in the clone, so lanes cannot select a different identity. Capabilities, checks, and
adapters may evolve through the anchored canonical ref without replacing the anchor; changing the
repository identity or either canonical ref is a distinct rotation. Missing, malformed, or
conflicting trust fails closed: commands never infer recovery from a lane, sibling checkout,
remote, or environment, and setup never overwrites an existing anchor. This local identity pin is
not an authenticated claim, lease, integration approval, retirement receipt, or cleanup authority.

Open a lane, work, land it:

```sh
npm run lane -- pricing-table   # worktree + branch at the profile's fetched canonical ref
# ... author, commit ...
npm run land                     # publish exact head; project the capability-selected review
npm run status                   # registered lane projections and provider state
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

Apply rechecks the plan and first captures its exact state in the printed recovery ref. A nonempty
dirty inventory is then copied, never linked or retired, into distinct Git-private files under
per-file, aggregate, and manifest bounds. After the copy and manifest are reverified, apply returns a
typed stop with `copyOnly: true` and `sourceRetired: false`. The authored source paths remain in place;
the target worktree, canonical index, canonical branch, and configured target ref are not changed.
The recovery ref and copy receipt are retained for owner-led continuation.

Only an empty inventory can continue to the profile-selected fetched protected tree. Before
supplying the exact `--exclusive` token, stop every IDE agent, hook, watcher, and process that can
write the checkout. That token attests external namespace quiescence; the Git-private lock only
serializes cooperating canonical-sync processes and is not an operating-system proof. Under that
contract, the exact clean projection is retired into Git-private recovery storage, target objects
are converted with the target tree's checkout attributes under per-file, aggregate, output, and
time bounds, and no-clobber installation precedes the canonical branch compare-and-swap. Receipts
distinguish copy-only preservation from externally-attested clean source retirement. Ignored paths
stay in place, while directory-to-file and Git submodule/gitlink topology are refused before
recovery. The final configured target and recovery-ref verifications plus canonical branch advance
share one reference transaction; no claim is made that a mutable recovery ref stays durable later.

Node does not expose portable anchored `openat`/`renameat` operations. The exact `--exclusive`
assertion is therefore the safety boundary for directory-parent races: pre-existing symlink or
non-directory ancestors are refused, but an uncooperative writer can invalidate that assertion.

The operation is recovery-backed, not atomic. If interrupted after recovery-ref creation, do not
repeat it blindly: preserve the checkout, recovery ref, lock, and named copy, retirement, or staging
paths. Every caught post-recovery failure names the exact recovery ref and commit; a preservation
failure also names its retained private directory.

## Public governance API

The package root exposes only the four provider-neutral request operations: `claim`, `continue`,
`integrate`, and `retire`, alongside their canonical JSON record helpers. These operations construct
unsigned requests; they do not acquire authority or perform Git, provider, release, runtime, or
cleanup effects. Receipt-envelope digest checks are structural integrity checks, never
authentication. See [docs/GOVERNANCE.md](docs/GOVERNANCE.md) for the exact records, external
authenticated/fenced verifier boundary, `.agentic-os.json` profile, and optional Git/GitHub adapters.
`agentic-os request <claim|continue|integrate|retire> --input=<json>` emits the same unsigned,
canonical Coordination Request for shell consumers; it runs outside a Git repository, does not
access Git or adapter state, and does not execute the requested transition.

Embeddings that need owner recovery may use the separate authority-evidence, recovery-candidate,
read-only recovery-inventory, and GitHub-authority subpaths. The `agentic-os-authority` binary consumes
bounded event/input files;
it never turns a local digest into authentication or grants merge, deployment, retirement, or cleanup.

## Compatibility import contract

Consumers moving from pre-v1 private imports may use only the explicit `agentic-os/compat/*`
subpaths: `git`, `lane-id`, `lane-records`, and `worktree`. These observation-only contracts expose
no lifecycle mutation, cleanup, publication, or authority transition. Their purpose is to replace
unpublished `agentic-os/src/*` reads with declared, test-covered v1 migration contracts. New
integrations should prefer the root records API and `agentic-os/adapters/*`.

## What problem this solves

Three settings compose into a livelock that no amount of recovery code fixes:

1. require branches up to date before merging,
2. squash-only merges,
3. no merge queue.

Every merge can invalidate checks on other open PRs. Squash destroys ancestry that would prove a
lane's content already landed, so lanes accumulate as "unmerged" while being mostly done. Without
tested protected ordering, draining `N` open PRs can cost up to `N x (N-1)` CI cycles.

The fix is capability-selected provider configuration plus two small primitives, not a recovery subsystem:

| Problem | Fix here |
|---|---|
| Ordering and stale-base churn | Only an observed native merge-queue entry becomes `queued` |
| "Is this already merged?" | Ancestry or exact mode/type/blob identity for every touched path |
| Re-resolving one conflict forever | Consumer may opt into native `rerere`; the harness does not impose it |
| Cross-device overlap | External authenticated claims; local refs never invent authority |
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
src/                 small responsibility-owned modules, 35 module cap
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
GitHub capability projection, separating selected invariants from consumer-owned required
parameters. Candidate code refuses to apply repository-owned provider policy.

## Bootstrapping

The guard refuses commits on the profile's canonical branch, including a repository's first
profile-governed commit. That is intended: a fresh clone should hit the rule immediately. For a genuine
repository-owned bootstrap, set `AGENTIC_OS_ALLOW_CANONICAL_WRITE=1` for that one command. Every change
after bootstrap goes through a lane and the consumer-owned protected integration path.
