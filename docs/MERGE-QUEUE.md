# Merge Queue

The queue is the only thing that decides what lands next. Authors never restack for ordering.

## Required configuration

`npm run doctor` verifies all of it and names the drift. `npm run queue:apply` writes it.

| Setting | Required | Why |
|---|---|---|
| Merge queue on the protected branch | enabled | Serializes and batches; removes manual restacks |
| Require branches up to date (`strict`) | **off** | With a queue this forces the restack treadmill it replaces |
| Merge method | squash | One commit per lane on the protected branch |
| Linear history | on | Compatible with squash-only |
| Direct push to protected branch | blocked | Every change goes through the queue |
| Delete branch on merge | on | Remote side of lane retirement |
| CI `merge_group` trigger | present | Without it queued batches never report and the queue stalls |

Turning the queue on while leaving `strict` on is the common mistake: the two mechanisms solve the
same problem and stack badly. Enable the queue, then turn `strict` off in the same change.

## Batching, or the merge train

The queue builds a speculative branch per candidate, each stacked on the ones ahead of it, and tests
batches instead of single PRs.

- `min` 1 — a lone lane lands immediately, no waiting for company.
- `max` 5 — five lanes cost one CI run instead of five.
- `wait` 5 minutes — enough for a batch to form under agent-paced authoring.

A failing candidate is ejected. Candidates ahead of it still land, candidates behind it are rebuilt
without it. Ejection is a normal outcome, not an incident.

## Cost arithmetic

Draining `N` open PRs with require-up-to-date and no queue costs up to `N x (N-1)` revalidation
cycles, because every merge invalidates every other PR. At `N = 45` that is about 1,980 CI runs, and
every restack in that set re-presents the same hunks for resolution.

With a queue at batch 5 the same 45 lanes cost roughly `N / 5` batch runs plus ejection retries, and
zero author-driven restacks. This is the single largest lever in the harness.

## What the author does

```sh
npm run lane -- my-scope   # worktree + branch at fetched origin/main
# ... author, commit ...
npm run land                # push, open PR, enqueue
```

Then stop touching the lane. Do not fetch and rebase it. Do not merge `main` into it. Do not push an
empty commit to re-trigger checks. If the queue ejects it, `npm run land` again performs the one
permitted restack and requeues.

## Stacked lanes toward main

A stack is a chain of lanes where each is based on the one below. Cap depth at 3.

- Restack the whole chain in one operation with `rebase.updateRefs`, which moves every intermediate
  branch pointer at once. Never rebase the members one at a time.
- Enqueue only the bottom of the stack. Enqueuing a middle lane asks the queue to test a base that
  is not on the protected branch yet.
- When the bottom lands, the queue's base advance plus `rerere` handles the remainder. `npm run reap`
  then retires the bottom because patch identity proves it landed.

## Cross-tool concurrency

Several coding agents and IDEs on several devices are safe under this model because the coordination
surface is only the branch name and the PR:

- The device segment keeps two machines from claiming one scope.
- `scopeFree` keeps two sessions on one machine from claiming one scope.
- The queue keeps two lanes that touch the same path from landing on an untested combination.

No lease, heartbeat, fence, or ledger is required, and none may be added. If two lanes conflict, the
queue's batch test finds it and ejects one. That is the whole protocol.
