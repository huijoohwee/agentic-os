# Diff-based validation

Run `npm run check:plan` before validation to inspect the base/candidate revisions, changed paths,
selected checks and reasons, skipped suite count, reusable checks, and estimated command-seconds.
Estimates use recent measured durations when available and labeled defaults otherwise; parallel command
seconds are not a wall-clock completion promise. `npm run check` executes the plan with four concurrent
checks, a nine-minute run ceiling and bounded per-command output. Evaluators precede behavior checks;
packaging follows successful behavior checks. Interrupts terminate child process groups on POSIX.

The impact selector unions old and new dependency edges, so removed imports, deletions and renames
retain their former consumers. `test/impact-contracts.json` declares non-import dependencies and shared
contracts. Safety sentinels always remain selected. Large document migrations do not select all tests
solely because of their path count or affected percentage. Selector/command edits, shared contracts,
unmapped paths, explicit `all`, and unresolved loaders still broaden coverage with recorded reasons.
Unknown dependencies require a reviewed contract or broader coverage; they never silently pass.

Each executable suite has a bounded private record and output log in its worktree's Git directory under
`agentic-os-tests/check-*.json` and `.log`. Successful results remain reusable for at most one hour.
The key binds the command, selector implementation, relevant configuration and dependency pins,
toolchain/environment, and the transitive/declared inputs. Packaging, opaque input discovery and
repository evaluators retain whole-repository identity. The optional `isolated` contract names reviewed
pure or fixture-isolated checks whose executed flow consumes only their transitive and declared inputs, even when an
imported library also exports unused filesystem helpers. Package commands and unresolved loaders
still require repository scope. Such declarations must be reviewed when a check starts doing I/O. A failed batch can retain passing sibling checks
only after the complete input-drift check passes. Reuse never extends a check's original validation time.
The current candidate gets a new aggregate `last.json` receipt with timings and reuse decisions.

Use `npm run check -- --fresh` to bypass reuse. CI, `--committed`, and explicit `all` always execute fresh.
Local receipts are development optimizations, not provider merge authority. CI still validates its exact
checkout against the event-bound baseline, and protected integration still requires successful checks.

Within one run, immutable Git trees and unchanged file bytes are reused. Every command batch still
checks the file inventory, nanosecond file identity, index, refs, configuration and environment. Changed
bytes, new/deleted paths, hidden index flags, and restored modification times remain observable. The
cache is discarded when the runner exits; no persistent filesystem metadata cache is trusted.

Canonical sync already stages and installs changed paths while retaining untouched files in place.
Attribute changes intentionally rematerialize affected content. Quarantine now uses no-clobber copies
and per-entry identities, with complete namespace and content verification at phase boundaries. This
removes repeated scans of the growing directory while preserving recovery bytes and race refusals.

Finish focused corrections and upstream pin updates before publishing an immutable candidate. After
publication, follow the existing successor workflow for new changes; do not rebase published lanes.
Consumer repositories must adopt the affected planner/contracts to replace their own broad runners;
this source change alone does not alter another repository's validation commands.
