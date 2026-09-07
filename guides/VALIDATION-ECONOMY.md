# Validation economy

Use the source owner's existing runner and validators. Profile a completed run before rerunning it.
Batch related repairs, run the affected checks, then run the full applicable suite once on the final bytes.
Repeat a passing check only when changed inputs, a failure, or an unresolved concern requires it.

## Place assertions at the boundary they protect

Input matrices call the production validator with real bounded inputs. Keep integration cases for the
distinct command, process, filesystem, provider, and publication boundaries. Avoid replaying an entire
lifecycle for every encoding or syntax variant when the same validator rejects them.

For example, `__tests__/land-receipt-integrity.test.mjs` keeps all eleven malformed-file cases. Two run
through the CLI: unreadable input and the budget after native identity trailers. The other nine call
`pullRequestText` on real files in the same isolated fixture. Valid publication, exact size/BOM handling,
and body mutation during push still exercise the CLI. No validator, policy, or production observation
is mocked, cached, or relaxed by this optimization.

## Reuse evidence precisely

Record the command, source identity, environment, scope, outcome, and elapsed time. A focused run remains
focused. Keep prior full-suite failures visible; a faster run does not make them pass. Reuse historical
evidence only with its original identity and an explicit account of which relevant inputs stayed equal.
Unknown dependencies, changed runner/configuration, or runtime inputs require fresh applicable checks.
Never treat a result cache or a matching commit alone as proof of dirty worktree bytes or live readiness.

Keep reusable policy here, executable checks in their owning repositories, and ecosystem result history
in Canvas `test/log.md`. This guide is lazy-loaded and adds no always-load bytes or runtime dependency.
