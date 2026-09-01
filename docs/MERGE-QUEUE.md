# Tested Protected Ordering

The neutral capability is `tested-protected-ordering`: the provider evaluates the exact candidate
in protected-branch landing order. The current GitHub adapter maps a native merge queue to that
capability. Pull requests and queues project provider state; they do not grant claim authority.

## Capability-selected configuration

`npm run doctor` validates the repository's `.agentic-os.json`, observes the exact configured
branch/checks, and reports only the provider capabilities that profile selects. `npm run
queue:show` prints that repository's GitHub reference plan; candidate code never applies
repository-owned provider policy.

| Profile capability | Provider requirement | Why |
|---|---|---|
| `tested-protected-ordering:merge-queue` | queue, auto-merge, and `merge_group`; strict off | Tests landing order |
| `required-check-policy:strict` | strict on; no queue | Selects fresh-base checks without a queue |
| `protected-integration:pull-request` | direct protected-branch pushes blocked | Keeps integration provider-reviewed |
| `integration-method:squash` | squash is the only merge method | One protected commit per lane |
| `history:linear` | linear history required | Selects a consumer's history policy |

The two ordering capabilities conflict and validation rejects a profile that selects both. Required
check contexts always come from `requiredChecks`, including contexts with spaces. Capabilities not
selected remain unprescribed, so GitHub, another provider, or a local-only repository can retain its
own integration mechanism. `delete_branch_on_merge` is always **off** because every v1 profile
retains refs until authenticated retirement and a separate cleanup receipt.

Turning the queue on while leaving `strict` on is the common mistake: the two mechanisms solve the
same problem and stack badly. Enable the queue, then turn `strict` off in the same change.

Auto-merge is a merge-queue prerequisite on GitHub, but it is not equivalent to tested ordering.
Checks on an auto-merge request can describe a stale base. Candidate-side `land` never arms it: the
lane stays `published` until a trusted consumer authorizes ordering and an exact queue entry is
re-observed.

## Batching, or the merge train

The queue builds a speculative branch per candidate, each stacked on the ones ahead of it, and tests
batches instead of single PRs.

- `min` 1 — a lone lane lands immediately, no waiting for company.
- `max` 5 — five lanes cost one CI run instead of five.
- `wait` 5 minutes — enough for a batch to form under agent-paced authoring.

A failing candidate may leave the provider ordering projection. The harness does not invent an
ejection or restack transition; it re-observes state and requires a separately authorized repair.

## Cost arithmetic

Draining `N` open PRs with require-up-to-date and no queue costs up to `N x (N-1)` revalidation
cycles, because every merge invalidates every other PR. At `N = 45` that is about 1,980 CI runs, and
every restack in that set re-presents the same hunks for resolution.

With a queue at batch 5 the same 45 lanes cost roughly `N / 5` batch runs plus provider retries and
zero author-driven restacks. This is the single largest lever in the harness.

## What the author does

```sh
npm run lane -- my-scope   # worktree + branch at the fetched profile canonical ref
# ... author, commit ...
npm run land                # publish exact head and project the selected review
```

Then stop touching the published lane. Do not rebase it, merge the canonical branch into it, or push
an empty commit to simulate evidence. A rejected candidate remains preserved until a new authority
decision.

## Cross-tool concurrency

Within one clone, worktrees isolate bytes and the queue tests landing combinations. Across devices:

- The device segment prevents branch-name collision; it is not an ownership claim.
- `scopeFree` only detects local branch scopes.
- The queue prevents an untested landing combination; it cannot authenticate who owns the scope.

Until a governance adapter supplies authenticated claim identity, epoch, fence, and compare-and-swap
state, cross-device exclusion is unsupported and must fail closed rather than be inferred.
