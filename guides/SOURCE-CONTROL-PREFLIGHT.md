# Source-control preflight

Load this guide only when a product builds its Dev-to-Prod candidate from an upstream repository pin.

Run the preflight against the exact upstream revision and consumer checkout:

```sh
node bin/agentic-os-pin.mjs --consumer=/absolute/consumer/root --revision=<full-40-hex-upstream-revision> --source-control
```

The preflight reads the upstream commit identity, consumer canonical ref, compact tracked-worktree state, and
existing manifest or lock pin. It emits `agentic-os/source-control-preflight/v1`, binding the source revisions
and trees used to build the candidate. It does not fetch, write a ref, create a checkout, authorize integration,
or authorize Dev, Production, rollback, storage, or data effects.

A nonzero result blocks readiness. Repair named source drift and rerun; if no complete report is emitted, keep
the cause unknown until the required local or provider observation is available. Retain the exact successful
JSON bytes in the release's existing access-controlled candidate-evidence bundle and bind their SHA-256 beside
the upstream and consumer revisions, trees, and exact package pin. Do not create a second source ledger or copy
the raw report into a public product artifact. Public provenance views redact local checkout paths while
preserving repository, revision, tree, and pin identity.

Reuse provider metadata already observed for the same candidate. Do not fetch full history or repeat source
scans only to restate an unchanged head, PR, check, tree, or pin. If required bytes are absent locally, hydrate
only the exact shallow source needed for that check. Offline local evidence remains useful for local decisions;
provider freshness and remote effects remain unknown until their owner observes them.

Dev deployment/readback and Prod promotion/readback receipts bind the same immutable candidate digest and
source-control report digest. Build once and promote the verified artifact. A rebuild, pin or tree change, or
missing or mismatched provenance report creates a new candidate: rerun required source/build checks and obtain
any new effect-specific authorization. Deployment authority never carries across candidates.
