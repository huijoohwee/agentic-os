# Autonomous goal pursuit

This is an on-demand ADLC guide, not an always-load instruction. Load it when a goal stalls, repeats a
mechanical failure, or asks the operator for facts the harness can derive. It grants no scope, ownership,
authority, approval, destructive effect, deployment, or product decision.

## Interaction economy

- Select the smallest valuable vertical slice that can reach production within the sprint cap. State its
  time-to-production ETA, wall-time cap, byte/module delta, checks, and release receipt before expanding it.
- Express work as minimal scoped hunks in the admitted lane. Whole-file replacement is valid only when the
  whole file is the scoped change; copying lane files into canonical is never integration.
- At the time cap, finish a safe atomic slice or replan from evidence. Do not widen the goal, raise a budget,
  or hide unfinished work to manufacture sprint completion.
- Report all presently knowable missing or invalid inputs in one verdict. Revealing one operand per retry is
  an incomplete-input defect.
- Derive machine facts from their authoritative source. Never ask for a revision, digest, identity, or path
  that the bounded adapter can read exactly.
- Validate a constraint at the earliest layer that knows it. Shape, byte budgets, templates, and scope fail
  before publication or provider effects.
- Bind volatile facts immediately before the transition that consumes them. If a compare-and-swap loses a
  real contention race, reread and retry only within the declared bound.
- Attempt one declared, bounded environment-only bootstrap before diagnosing a product failure. Environment
  repair never authorizes product, provider, or shared-state mutation.
- Record a typed outcome for each blocked attempt so selection can change instead of repeating it.
- Escalate only an unresolved semantic decision: scope, irreversibility, credentials, authority,
  contradiction, or budget reauthorization. Transport and mechanical derivation are not decisions.
- After the same approach fails twice, diagnose the owner and change approach. A renamed third attempt is
  still a loop.

## Authorization continuity

Carry the operator's actual decisions and owner-issued receipts across turns, compaction, retries and
handoffs. Retain their provenance, scope, targets, effects, constraints, candidate bindings, validity and
prior outcomes in the existing task evidence. A summary transports that evidence; it never expands it.

Before each effect, use its owner to check whether existing authority still covers it. Continue covered
implementation, verification, observation and authorized idempotent recovery without asking again. A new
turn, command, run identifier or mechanical retry is not itself a reason for another operator decision.
Unknown effect outcomes require provider reconciliation before retry; never assume that no mutation occurred.

Separate ongoing task permission from candidate-bound promotion. A repair may invalidate a release receipt
without withdrawing permission to diagnose, fix, test and prepare its successor. Perform that work first.
An approval bound to old source or artifact bytes cannot authorize changed bytes. A broader standing grant
may cover successors only when the operator explicitly granted that scope and the effect owner validates it;
the autonomy class alone is not an authority issuer. Expired, revoked, mismatched or uncovered grants stop
only dependent effects. Continue independent authorized work.

Make an unavoidable approval the final operator step for a concrete, reviewable candidate. Before asking:

- Run all currently available, authorized non-mutating preflights. Recreate the effect job's dependency
  environment and observe existing public routes, versions and migration inputs where relevant.
- Collect all knowable deficiencies in one report and repair those within scope. Credentials or environment
  access available only after approval must be identified as remaining dependencies, not claimed verified.
- Revalidate volatile state when it is consumed. Earlier preflight success is preparation evidence, not a
  deployment, settlement, rollback or cleanup receipt.
- Ask only for the missing semantic decision, naming the exact rule and owner. Do not ask the operator to
  repeat covered consent or transport machine-derived identifiers between tools that can read them.

Product promotion and provider trust stay consumer-owned. Updating this guide or the shared prompt does not
change a protected environment or enroll delegated authority. Consumers adopt the reviewed upstream package
pin; never patch an installed package or reinterpret a candidate receipt as a standing grant.

This change adds no module, dependency, provider operation or controller. Always-load guidance grows by
71 UTF-8 bytes: 68 in the existing ADLC/release documents and three in the prompt (996 to 999), within
the unchanged documentation and 1,000-byte prompt caps. The detailed policy stays on demand.

## Deadlock avoidance

Classify a rejection before retrying:

- **Contended** means an authoritative value moved between read and write. Reread, rederive, and retry within
  the goal-wide bound.
- **Deterministic** means the request violated a contract. Read the validator once for the complete
  requirement; never retry the same request unchanged.

Repair the authored owner, not a cache, marker, report, or other projection. When three or more sequential
gates are broken by the preceding surface fix, stop patching: locate the earliest wrong value and rederive
the chain. Attempt budgets apply to the whole goal across commands and variants; a new command name does not
reset them.

A shared-state repair gets one attempt and states its reversal before it starts. If that result itself needs
repair, preserve the exact residue and escalate. Termination reports the earliest wrong value, its owner,
the retained residue, and the one decision required; a status dump is not a decision request.

## Never permitted

- infer an operator decision from silence, time, or convenience;
- fabricate a value that cannot be derived;
- copy another lane's projection as ownership or authority;
- widen scope or capability to continue;
- treat a passing local check as protected, runtime, deployed, or cleanup proof;
- raise a bound under pressure or retry a deterministic rejection unchanged;
- patch a projection merely to satisfy its own gate; or
- chain repairs after a failed shared-state mutation.

The applicable start and release workflows remain authoritative. This guide only reduces avoidable operator
round trips while keeping every ADLC receipt and product-policy boundary intact.
