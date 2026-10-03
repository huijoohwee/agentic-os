---
title: Cleanup authority enrollment and reviewed retained recovery
doc_type: PRD-TAD-ADR-MVP-GTM
continuity_id: CLEANUP-AUTHORITY-001
version: 1.1.0
prd_revision: 1.1.0
tad_revision: 1.1.0
adr_revision: 1.1.0
mvp_revision: 1.1.0
gtm_revision: 1.1.0
load_policy: on-demand
lifecycle_status: review-candidate
---
# Cleanup authority enrollment and reviewed retained recovery

Continuity `CLEANUP-AUTHORITY-001@1.1.0`. This proposes two explicit recovery contracts for protected
owner review. Runtime implementation and exact policy enrollment are not accepted yet. Existing
proof, retirement and physical cleanup contracts remain in force. Publishing this specification
creates no receipt, activates no mode and authorizes no effect.

## Existing owners and retained delivery

Initial GitHub issuance, transition publication and quarantine execution have separate owners.
Committed initial policies bind exact target/workflow/ref/checks, one-hour validity and create-only
`adlc/authority/` evidence. OS and Graph initial enrollments cannot issue for each other's target;
forks must reenroll. A bootstrap is record-only and never supplies retirement or cleanup authority.

The retained-reader repair is protected-integrated through OS PR322. `collectRecoveryInventory`
accepts explicit real repository context and retained index. The Git owner disables ambient
redirection, optional writes, lazy fetch, replacement objects and executable hooks. Observation
neither restores a checkout nor rewrites pointers. Reader validation is not provider retirement.

The [lifecycle owner](../docs/LIFECYCLE-COMPLETION.md) owns command and closed-bundle schemas;
[integration methods](INTEGRATION-METHODS.md) own source/method proof; [user cleanup](USER-CLEANUP.md)
owns local consent/preservation. Keep every branch, recovery ref, reflog, peer registration and object.
The existing sequence remains exact observation, enrolled initial dispatch/issuance, integration
winner, independently bound retirement, live replay, exact eligible cleanup and separate canonical
sync. Credentials stay local. Missing proof, drift, expiry or another winner stops the affected effect.

## PRD: current recovery without invented history

The operator has retained integrated work whose historical rule suite or separate predecessor
quarantine may not have existed. The outcome is current authorized recovery closeout while keeping
all present authored bytes and Git history. Do not assert unproved historical protection, required
policy, merge method, succession authority or physical effects.

Full END ADLC retains separate source, provider integration/retirement, disposition, delivery and
handover requirements. The policy owner must accept whether these explicit facts satisfy the current
recovery transition. A narrower proof never silently inherits stronger historical claims.

- H01: Given exact committed enrollment and fresh initial retrospective issuance, authenticate the
  real merge event, reviewed head/base, equal merge tree, successful pre-merge checks and current
  protected ancestry. Emit a distinct historical-content proof or fail.
- H02: Reject missing/foreign enrollment, changed identities, failed/late checks, stale policy,
  expiry, altered event/tree/ancestry and fabricated historical assertions before publication.
- P01: Verify a distinct successor preservation disposition with exact source and retained bytes.
  Authenticate historical succession if claimed; otherwise require a separately reviewed current
  adoption decision and explicitly retain historical succession authority as unproven.
- P02: Ancestor/path equality, cached handoff, source inclusion or an unrelated green PR alone is
  insufficient. Missing, mounted, changed or foreign retention coordinates fail.
- A01: Each integration, record-only retirement, physical cleanup and sync effect retains its own
  plan, grant and real receipt. No adoption backdates a claim or creates historical evidence.
- A02: Full completion requires every applicable owner receipt and handover. Passing tests, local
  observations or this specification alone do not establish END ADLC.

## TAD: explicit versioned bases

Historical recovery adds opt-in `historical-content-facts/v1`, with a distinct operation mode and
provider-proof schema. A versioned committed policy enrolls exact target/review/base/head/merge/tree
and approved check selection. Preparation, dispatch, publication and replay bind the provider-read
policy at the exact workflow revision. There is no automatic fallback or authority from a mode string.
Only fresh, in-window initial retrospective issuance may use this basis.

The provider authenticates the unique merge event, exact tree/source and successful historical
check identities. Reviewed check selection does not establish which checks were mandatory then;
current protection remains current evidence. The proof sets `historicalProtectionProven`,
`historicalRequiredCheckPolicyProven`, `historicalRuleSuiteProven` and `methodProven` to false.
Never fabricate suite ID/time or claim a bounded empty query proves global absence. Chronology uses
actual merge time, never a missing suite timestamp or NaN comparison. Existing retrospective modes
keep genuine-suite requirements and replay meaning.

Predecessor preservation adds `disposition: successor-preserved`. A bounded current record binds
exact predecessor/successor refs/heads, accepted successor review/merge/check identities, exact
replaced/preserved paths, authentic successor quarantine coordinate/registration/manifests and Git
objects. Both checkouts must be unmounted; recheck canonical and peer identities for drift.

Publication can overwrite the cached succession handoff; cache/path equality is not historical
authority. If durable historical proof is unavailable, the owner must explicitly enroll a CURRENT
preservation-adoption decision for those facts with `historicalSuccessionAuthorityProven: false`.
Do not reconstruct an old receipt. The distinct record uses its actual issuance time and digest,
`physicalCleanupPerformed: false`, `providerAuthority: false`, `claimRetired: false`, and keeps
predecessor `cleanupVerified: false`. Expose `preservationDispositionVerified` and
`preservationSatisfied` separately. This may satisfy selected source closeout; full ADLC still needs
independent live provider retirement and delivery/handover receipts.

Preservation retirement needs a distinct reviewed record-only effect class and closed effect set.
Do not reuse `claim-retirement-with-cleanup`: it binds an actual registered target, two quarantine
effects and registered-before/after postconditions. With no historical claim, fresh adoption creates
only a current record-only claim; it cannot retire nonexistent past authority. Exact immutable replay
revalidates original semantics and retained facts without new effects. First publication always needs
current authority and the current evidence window.

## ADR: reviewed meaning and separate effects

Acceptance approves explicit current recovery facts with historical unknowns retained. It neither
certifies historic governance nor authorizes merge/deploy/delete. Preserve genuine-suite modes,
physical receipt meanings, create-only CAS, expiry, target isolation and separate effect authority.
Retain expired evidence without extending or relabeling it.

Reuse existing owners: zero runtime modules/dependencies, global prompt or consumer-pin changes.
No direct registration repair, unsafe reconstruction, blanket grant or second task registry. Keep
current seed bytes and recovery copies; their owner resolves them in its own lane. Consumer identities
belong to policy/evidence, not hardcoded runtime logic.

Implementation owners: `src/github-transition-{policy,client,proof,provider,authority}.mjs`, committed
transition policy, `src/cleanup{,-quarantine}.mjs`, `bin/agentic-os-{cleanup-user,completion-status,argv}.mjs`,
lifecycle/integration/user-cleanup guides and bounded adversarial suites. Admit actual paths natively
before code writes. Recover headroom by owner simplification without removing or compressing checks:
source47 modules/15050 lines, bin111/23175 and per-file caps remain unchanged.
This review candidate is documentation-only. Runtime scope, exact enrollment and provider effects
are separately reviewed candidates. Protected acceptance precedes activating either new basis.

## MVP: meaningful tests and full completion audit

H01/H02 tests cover mode/schema substitution, missing/v1/foreign enrollment, identity drift,
wrong/failed/late checks, stale workflow/policy, expiry, fabricated history, event/tree/ancestry drift,
create-only conflict and exact replay. Legacy modes must still reject missing suites. Preserve unknowns
through preparation, publication and retirement replay.

P01/P02 tests cover wrong refs/heads/path/registration, missing succession/current adoption,
ancestry/cache alone, omitted/extra replacements, unrelated/failed review, changed manifests/metadata,
mounted lanes, ref/cache/canonical races, expiry before recording and exact replay after expiry.
Replay makes no physical effect and never upgrades local evidence into provider authority.

A01/A02 join distinct authority, integration/retirement/disposition and delivery/handover receipts to
exact source/policy/scope. Run native affected planner/required check and protected CI at the frozen
candidate; reuse valid receipts. Bounded checks do not prove runtime or device parity. Keep the consumer
runtime pin and existing verified Production carrier. Resolve current seed-owner disposition and
shared Context/ledger handover before Full END ADLC; report any remaining exact unproved requirement.

## GTM and bounded delivery

Observed pain is stalled closeout and risk to retained work; demand, willingness to pay and savings
remain unmeasured. Use FOSS and existing free resources. First pass:15 minutes design/admission,
document under12KiB, zero new runtime modules. Refresh implementation time/byte budget and measure
source/bin headroom before publication. External review waits bind exact candidate/owner/recheck,
never a promised completion time.
