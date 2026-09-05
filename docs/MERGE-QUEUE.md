# Tested Protected Ordering

The neutral capability is `tested-protected-ordering`: the provider evaluates the exact candidate
in protected-branch landing order. The current GitHub adapter maps a native merge queue to that
capability. Pull requests and queues project provider state; they do not grant claim authority.

## Capability-selected configuration

`npm run doctor` validates the repository's `.agentic-os.json`, observes the exact configured
branch/checks, and reports only the provider capabilities that profile selects. `npm run
queue:show` prints that repository's GitHub capability projection; candidate code never applies
repository-owned provider policy. Pull-request review count, code-owner review, stale-review
dismissal, last-push approval, and thread resolution remain consumer-owned and are never prescribed.
Provider-owned rules are emitted as typed requirements with all provider-required fields named, not
as invalid partial rules or defaults. Repository authority supplies those parameters and preserves
any stronger existing policy.

| Profile capability | Provider requirement | Why |
|---|---|---|
| `tested-protected-ordering:merge-queue` | queue, auto-merge, and `merge_group`; strict off | Tests landing order |
| `required-check-policy:strict` | strict on; no queue | Selects fresh-base checks without a queue |
| `protected-integration:pull-request` | direct protected-branch pushes blocked | Keeps integration provider-reviewed |
| `integration-method:squash` | squash is the only merge method | One protected commit per lane |
| `history:linear` | linear history required | Selects a consumer's history policy |

The two ordering capabilities conflict and validation rejects a profile that selects both. Required
check contexts always come from `requiredChecks`, including contexts with spaces; queue and strict
check policy require at least one context. Capabilities not
selected remain unprescribed, so GitHub, another provider, or a local-only repository can retain its
own integration mechanism. `delete_branch_on_merge` is always **off** because every v1 profile
retains refs until authenticated retirement and a separate cleanup receipt.

Turning the queue on while leaving `strict` on is the common mistake: the two mechanisms solve the
same problem and stack badly. Enable the queue, then turn `strict` off in the same change.

Auto-merge is a merge-queue prerequisite on GitHub, but it is not equivalent to tested ordering.
Checks on an auto-merge request can describe a stale base. Candidate-side `land` never arms it: the
lane stays `published` until a trusted consumer authorizes ordering and an exact queue entry is
re-observed.

## Provider-owned queue tuning

Queue batch size, wait time, grouping strategy, build concurrency, and response timeout are
consumer-owned provider tuning. The universal contract does not prescribe or audit those values.
When `integration-method:squash` is selected, the GitHub adapter verifies only that the queue uses
`SQUASH`. When linear history is selected without squash, `REBASE` or `SQUASH` remains compatible;
otherwise the adapter does not invent a merge method.

## Cost behavior

Draining `N` open PRs with require-up-to-date and no queue costs up to `N x (N-1)` revalidation
cycles, because every merge invalidates every other PR. At `N = 45` that is about 1,980 CI runs, and
every restack in that set re-presents the same hunks for resolution.

A provider may batch candidates; the repository selects tuning. The harness requires tested landing order.

## What the author does

```sh
npm run lane -- my-scope --write=src/owning-file.ts
# ... edit the owning file directly in the printed worktree ...
npm run land -- --message="feat: focused change"  # stage, commit, push, project review
```

After separate repair authorization, run successor (Git v2.46+) before edits. It keeps all prior
refs/review, clean commits and worktree; then land. If effects remain, do not edit: resolve the
collision; rerun the exact emitted `npm run successor -- <same-scope>
--expected-head=<published-oid>`; then `land`.

## Cross-tool concurrency

Within one clone, worktrees isolate bytes and the queue tests landing combinations. Across devices:

- The device segment prevents branch-name collision; it is not an ownership claim.
- Exact-ref creation detects a collision only for that device and scope; it grants no broader exclusion.
- The queue prevents an untested landing combination; it cannot authenticate who owns the scope.

Until a governance adapter supplies authenticated claim identity, epoch, fence, and compare-and-swap
state, cross-device exclusion is unsupported and must fail closed rather than be inferred.
