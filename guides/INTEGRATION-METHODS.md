# Integration methods

The reference profile selects `integration-method:squash-preferred`: squash is the default,
merge commits are a backup, and provider rebase requires an explicit revision-bound choice.
Both squash and merge must be effectively available; rebase may be enabled. The reference provider
projection enables all three. A selected queue still uses `SQUASH`. Method availability grants no
authority and never changes required checks, reviews, claim ownership or tested ordering.

| Choice | Use | Required control |
|---|---|---|
| Squash (default) | One completed scope per PR | Exact reviewed head, current base and required checks |
| Merge commit (backup) | Preserve branch ancestry or avoid unnecessary replay | Explicit reason and exact head/base; same authority and checks |
| Provider rebase (controlled fallback) | Preserve reviewed linear commits individually | Explicit reason and repository/profile/head/base choice in immutable pre-integration authority |

`agentic-os/integration-policy` exports `selectIntegrationMethod(profile, observation, choice)`.
Pass `expectedHead`, `observedHead`, `expectedBase`, and `observedBase` as exact Git object IDs.
The selector defaults to squash. Merge and rebase require an explicit bounded reason. A selected
queue refuses non-squash choices. The provider observation must be current and profile-bound.
The result binds repository, profile digest and both revisions with `authority: false`.

Before issuing the predecessor authority, add `integrationMethodChoiceReference(selection)` to
its `CoordinationRequest.dependentWork`. This canonical reference is included in the existing
request/authority digests and immutable publication. Do this for squash too when provider rebase
is available: one parent alone cannot distinguish the two. The consumer rechecks the claim,
fence, checks, selected method, head/base and provider state before invoking the provider effect.
A changed revision invalidates the choice across every device; obtain a fresh choice and authority.
Never select a different method automatically after a timeout. Re-observe the exact PR first.

The GitHub transition adapter reads the choice only from the live, authenticated predecessor
issuance, never from a post-merge request. It verifies the committed profile at the protected base,
rejects strict profiles, and joins method evidence to the existing effect plan and integration
receipt. Unknown, duplicate, retrospective, foreign or stale choices fail loudly. A merge commit
can still be proved by its exact candidate parent under legacy profiles; missing or incompatible
protection fails safely. Existing strict squash-only profiles keep their meaning.

Provider rebase proof is deliberately bounded: 1–32 linear source commits must already start at
the chosen protected base. The result must end at that same base and preserve every ordered tree,
author and message while rewriting commit IDs. Observation allows at most 64 commit reads and
30 seconds, within the adapter's request timeout. Base advancement, dropped/reordered commits,
conflicts or ambiguous results require a fresh unpublished repair successor and fresh validation.
The proof records its basis as **preauthorized choice plus exact commit sequence**; it does not
claim an independent GitHub method flag. GitHub rebase creates new commit IDs and committer data;
see [GitHub merge methods](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github).

Provider rebase leaves the published source ref intact. Never locally rebase or force-push a
published/shared lane, automatically restack dependents, or replace an uncertain result with a
second merge attempt. Repairs retain the original refs/review and use the existing successor owner.

Across repositories, integrate in dependency order and update consumers to the exact upstream
merge revision. Disjoint scopes can proceed concurrently; overlapping writers still require the
existing fenced handoff. After squash, ancestry alone does not prove completion: use the existing
exact-content integration proof. After merge, preserve the same source/merge/check receipts.
Offline work may continue within its grant; publication and integration require fresh authority.

## Adoption and rollback

This additive v1 capability preserves the meaning of existing `integration-method:squash` profiles.
Unselected/provider-free profiles remain neutral. Consumers first adopt a package revision that
understands the new capability, then replace squash-only (and any `history:linear` selection) in a
reviewed canonical profile and recompute `profileDigest` with `createRepositoryProfile`. Identity
and canonical refs stay pinned. Old packages reject the new capability rather than ignoring it.

Use `queue show` to review the projection. Repository authority must enable squash and merge,
and may enable rebase only with the choice-aware integration adapter. Check every applicable ruleset
and classic branch rule. GitHub availability alone cannot enforce the ADLC choice; consumers must
use the authenticated transition path before accepting integration evidence. Required
linear history conflicts with merge commits and needs an explicit history-policy migration;
never silently drop stronger review/check protections. `doctor` fails until effective policy
matches. Align any authority policy that binds allowed merge methods exactly before migration.
Previously issued evidence must be re-observed against the current policy; it is not a reusable grant
for a changed protection contract. Profile publication and provider configuration are separate effects; re-observe after
both. Existing consumer pins and profiles do not change just because upstream has changed.

Rollback through a protected PR to the prior profile/package and its matching reviewed provider
policy, preserving all source and merge refs. Re-observe exact checks and provider policy before
resuming integration. No rewrite, cleanup or deployment is part of this rollback.

Validation: [method policy tests](../__tests__/integration-method-policy.test.mjs),
[method proof tests](../__tests__/integration-method-proof.test.mjs), and the existing
[provider profile tests](../__tests__/provider-policy-profile.test.mjs). These prove selection and
observation controls, not cross-device claim authority or a production deployment.

## Release handover

This implementation slice consumes `PRD-TAD-ADR-ADLC-PIPELINE-001@1.3.1`, P05/P06, T05/T06
and ADR-P04 in the [shared plan](PRD-TAD-ADR-MVP-GTM.md). The shared plan's active authoring lane
retains ownership; this companion records the merge-policy delta without rewriting that source.

- PRD: the operator needs squash by default, an available merge backup, and an explicit provider
  rebase choice. User authorization is the 2026-09-14 revision-bound provider-rebase decision.
  Buyer demand, willingness to pay and realized savings remain unmeasured.
- TAD: reuse the profile, provider observation, predecessor request and protected transition proof;
  add a lazy method verifier. Source baseline: `d364634b11bbd2defcc405f3e7307719d10bd9f2`.
- ADR: additive preference preserves strict profiles. Bind choices to existing immutable authority;
  reject ambiguous rebase instead of inferring it from a single parent. No automatic method fallback.
- MVP: selection, migration, bounded provider proof, replay and historical hook migration checks
  cover this slice. The exact PR owns final check results, source revision and integration evidence.
  Budgets: no new core module/dependency; 32 rebase commits; 64 commit reads; 30-second chain budget.
- GTM: pilot this upstream contract through one explicitly migrated consumer and measure active
  minutes, command time and retries. Consumer adoption, cross-device contention outcomes and runtime
  deployment remain separate evidence; this source change establishes none of those results.

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

