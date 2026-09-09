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

CI runs `npm run evals` from this root source on every protected candidate. A pinned consumer may invoke
the same packaged evaluator with `npm --prefix node_modules/agentic-os run evals`; consumer-specific
compatibility checks remain local. Load [the autonomous-goal guide](guides/AUTONOMOUS-GOAL-PURSUIT.md)
only for delivery planning or when execution stalls/repeats a mechanical failure; it remains outside the
always-load set.

For direct, small source changes, see the lazy-loaded [user cookbook](guides/USER-COOKBOOK.md): autonomous
path-scoped admission and stage-to-push delivery are the default; manual Git is the fallback.
Managed lanes share `<registry>/<repository>/<device>--<lane>`; `AGENTIC_OS_WORKTREE_ROOT` configures only
the registry parent, so repository and lane isolation remain intact.

The lazy-loaded [pipeline PRD/TAD/ADR](guides/PRD-TAD-ADR.md) joins implemented lifecycle controls to
product release and verification handoffs. The [feature list](guides/FEATURES.md) and
[tech stack](guides/TECH-STACK.md) record the grounded
ownership and provider boundaries among `agentic-os`, `agentic-canvas-os`, `agentic-graph`, and
`agentic-commerce-os`. They link executable source-acceptance checks, but grant no cross-repository
promotion or deployed-runtime authority.

Open a lane, work, land it:

```sh
npm run lane -- pricing-table --write=src/pricing-table.ts
# ... edit the owning file directly in the printed worktree ...
npm run land -- --message="feat: update pricing table"  # stage, commit, push, protected handoff
npm run status                   # registered lane projections and provider state
npm run reap                     # classify all lanes within the strict inventory bound
npm run reap -- --ref=agent/device/scope  # classify one exact lane; never clean or retire
```

`land --message` preserves staged deletions and stages only observed unstaged or untracked
paths inside the reservation. Unused reserved paths need not exist. Changes outside the
reservation still block publication; staged removals do not require recreating obsolete files.

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
docs/adlc-guidelines.md universal lifecycle principles for every consumer
src/                 small responsibility-owned modules under the configured cap
catalog/             invocation and feature data with count and digest fences
templates/           universal runtime prompt assets
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

## Shared check discovery

`test/README.md` owns the shared testing layout: coordination, evidence and contract fixtures live
in Agentic OS; executable product suites remain beside their source.

Keep cross-repository planning in the Canvas `docs/TODO.md` and `todo/YYYY-MM/` context records.
Executable suites remain with their repository owners. `test/repositories.json` references
package scripts and workflows for OS, Canvas, Graph, Commerce, the site, the mirror and GameXR; it stores
neither command bodies nor copied check verdicts. Discovery reads each supplied owner's committed
`.agentic-os.json`, package scripts and workflow files, including their exact source digests.

Run from a profile-trusted repository, using the packaged CLI:

```sh
node bin/agentic-os.mjs observe --checks --input=./checks-input.json
node bin/agentic-os.mjs /checks '#read-only' '@input:./checks-input.json'
```

The bounded input maps catalog IDs to clone or worktree roots. Relative paths resolve from the
input file's directory. The index and input each accept at most 32 repositories. Supply any subset; all catalog owners appear, with absent roots marked unavailable.

```json
{
  "schema": "agentic-os/check-discovery-input/v1",
  "repositories": [
    { "id": "agentic-os", "root": "../agentic-os" },
    { "id": "agentic-canvas-os", "root": "../agentic-canvas-os" },
    { "id": "agentic-graph", "root": "../agentic-graph" },
    { "id": "agentic-commerce-os", "root": "../agentic-commerce-os" },
    { "id": "huijoohwee.github.io", "root": "../huijoohwee.github.io" },
    { "id": "huijoohwee", "root": "../huijoohwee" }
  ],
  "results": []
}
```

Optional `results` reference owner-supplied JSON files with this shape. Use the actual revision,
package SHA-256 and argv from the execution, and name its exact coverage; a filtered case run is
never a full repository or ecosystem suite. This example describes a format, not an executed result.

```json
{
  "schema": "agentic-os/check-result-observation/v1",
  "repository": "github.com/huijoohwee/agentic-os",
  "revision": "<40-hex owner revision>",
  "command": {
    "package": "package.json", "script": "test", "sourceSha256": "<64-hex package SHA-256>",
    "argv": ["npm", "run", "test"]
  },
  "coverage": {
    "scope": "Owner test suite", "complete": true,
    "counts": { "total": 3, "passed": 3, "failed": 0, "skipped": 0 }
  },
  "outcome": "passed"
}
```

Counts are optional; outcomes are `passed`, `failed`, `interrupted`, or `unknown`. Missing, dirty,
changed or revision-mismatched sources invalidate a current match. A `matched` binding only means
the supplied observation matches the declared profile, configured origin and raw committed source at
read time; it authenticates neither the result, dependencies, environment nor execution.
Reported coverage and outcome remain attributed, unsigned observations, separate from provider
required-check names. No results produces an empty result list, not a passing verdict.
Without owner results, cleanliness is `null` and source status is `not-evaluated`; only committed
descriptor bytes are checked. Deep raw-byte checks run only for owners with supplied results.

Each owner's `validationPlan.execute` retains whole umbrella commands and their authored order,
omitting separately requested scripts that exact npm chains already invoke. `coversOnSuccess` is
conditional: failed, interrupted or filtered runs grant no inferred coverage. Use unchanged source,
execution context and exact argv; this advisory plan never caches passes or grants readiness.
Resolution uses only bounded committed manifests: 32 levels, 64 calls per chain, 128 covered scripts,
4,096 visits per owner. Cycles, flags, shell expressions and unresolved workspace links keep separate
commands. Lifecycle hooks stay in the intact npm invocation; their bodies confer no inferred coverage.
Explicit workspace paths and normalized relative `npm --prefix <path> run <script>` calls must resolve
to an already cataloged package; no scanning. Prefix calls may use `--prefix=<path>` or `test` shorthand.
Absolute, escaping, unlisted, or combined prefix/workspace targets remain unresolved.

Discovery rechecks observed bytes, executes no candidate code and makes no network requests. It
does not infer ecosystem E2E coverage, integration authority or deployed readiness. Inputs and
individual results are capped at 64 KiB, owner source files at 128 KiB, and output below 500 kB.
The CLI runs discovery in its own process with a 30-second deadline and uses the existing bounded
raw worktree observer; larger or unsupported inventories remain unavailable, with owner references retained.
The trusted local Git reader must be available; unsupported hosts report unavailable source bindings.

## Remote configuration

`npm run doctor` reports required remote settings and any drift. `npm run queue:show` prints the
GitHub capability projection, separating selected invariants from consumer-owned required
parameters. Candidate code refuses to apply repository-owned provider policy.

## Bootstrapping

The guard refuses commits on the profile's canonical branch, including a repository's first
profile-governed commit. That is intended: a fresh clone should hit the rule immediately. For a genuine
repository-owned bootstrap, set `AGENTIC_OS_ALLOW_CANONICAL_WRITE=1` for that one command. Every change
after bootstrap goes through a lane and the consumer-owned protected integration path.
