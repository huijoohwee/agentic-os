# Clonability audit implementation

Input: `agentic-os-clonability-audit.canvas.tsx`, audited main `7f7928d788a21249c8dca7d3139b3b3f57e46087`.
Scope: the harness clone/fork surface. Product deployment, settlement and demand interviews require
product-owner work and external evidence; the canvas labels its inspiration patterns as concepts.

| Finding | Implementation or current boundary |
| --- | --- |
| C1 | Ignore the root npm lockfile in this dependency-free harness. CI's full test job includes a real clone, npm install and setup smoke test. |
| F1 | Reuse GitHub remote identity binding before trust creation, before configuration, and at final verification. Fork mismatch retains no newly created trust/config; later races fail with retained-effect evidence. |
| F2 | `profile init --repository=host/owner/name` emits a digest-valid profile without writing files or rotating trust. The six-step [fork guide](FORK.md) covers bootstrap and protection. |
| F3 | The composition source lock owns all four repository identities. CLI owner literals are removed. Existing artifact and source-byte checks remain required. |
| S1 | Live classification differs from the audit: among 80 pre-existing local lane refs, 11 are proven integrated, 50 are patch-only matches, and 19 have pending commits. PRs #62, #65 and #66 each have one pending commit. No closures or deletions follow from this observation. |
| S2 | New lanes use a stable hostname hash; `AGENTIC_OS_DEVICE` and `--device` select explicit aliases. Existing refs remain valid. The shipped hook runtime remains an accepted migration source. |
| D1 | `pin --consumer=<root> [--revision=<sha>]` reports repository/revision/form/lock drift. New pins use GitHub full-SHA form; composition accepts either exact historical form during owner-controlled migration. No sibling pin has been changed by this harness candidate. |
| P1 | A 28-test pure-unit loop runs before the source package's `npm run land`; `test:git` covers its complement. Full `npm run check` and CI remain required. No fixture reuse weakens isolation. |
| D2 | README declares Git, Node/npm and optional authenticated gh. Doctor warns for absent gh only when no provider-dependent policy is selected; selected provider requirements still fail. |
| D3 | Guides point current composition configuration to the source lock. Existing revision-qualified links remain historical evidence. Removing their snapshots would erase evidence rather than fix pin drift, so that proposed deletion is not applied. |

Fresh-clone tests cover clean install/setup, remote/profile mismatch before trust effects, generated
fork policy preservation, repeat setup, immutable existing anchors, a remote-change race, fork
composition identities and wrong-origin rejection. Pin tests cover the exact manifest/lock binding.
Hook migration tests retain the previous runtime's original bytes and digest.

Retirement and each cleanup effect require authenticated exact receipts under the current profile.
The new lane's base can appear as an ancestor while it still contains uncommitted work; the classifier
is not permission to remove its worktree. Historical counts and the three PR observations above are
recheckable evidence at the audited revision, not future cleanup targets.

Source integration, sibling pin adoption, owner suites, deployed runtime, a paid settlement receipt,
and customer demand evidence remain separate completion conditions. No production-readiness claim
follows from this harness implementation.
