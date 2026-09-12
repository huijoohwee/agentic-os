---
title: "Native Context: Codebase, Prefix and Continuity"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.1"
date: "2026-09-12"
lang: "en-US"
owner: "agentic-os"
frontmatter_contract: "required"
continuity_id: "NATIVE-CONTEXT-001"
prd_revision: "1.0.1"
tad_revision: "1.0.1"
adr_revision: "1.0.1"
load_policy: "on-demand"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-cba000d3779d--planning-v27"
agent_id: "codex-01a0940a"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "817c1da8dac21d688d7c531b234482c64ee4340b"
mvp_revision: "1.0.1"
gtm_revision: "1.0.1"
---

# Native context

OS owns reusable context mechanisms. Canvas owns application wiring, Graph owns its control plane
and production deployment, Commerce owns transactions. [Shared memory](MEMORY.md) remains the owner
of curated cross-task records; codebase discovery neither imports nor rewrites those records.

## PRD: NATIVE-CONTEXT-001@1.0.1

Context: a solo builder repeatedly discovers the same source and sends the same prompt prefix during
an MVP-to-GTM sprint. Intent: shorten source discovery and reduce repeat input while preserving exact
source references and product ownership. Directive: migrate the existing portable context mechanisms
from Canvas to OS and expose bounded, offline source discovery. Role/Subject: solo builder's coding
agent. Action/Verb: retrieve. Object: the selected owner's current source context. Outcome: source-bound
changes with explicit tests and no inferred buyer demand, provider cache hit, or deployment evidence.
These fields consume the existing [CID/RAO/SVO authoring seam](PRD-TAD-ADR-MVP-GTM.md); no new grammar.

| Acceptance / stage | Role and action (SVO) | Design and validation owner |
|---|---|---|
| C01 / design | Builder selects a bounded owner scope | `context map`; codebase-context tests |
| C02 / build | Agent retrieves and rereads a source hash | `context search/read`; stale-byte and path tests |
| C03 / MVP | Runtime reuses stable context across requests | Prefix and continuity APIs; migrated owner suites |
| C04 / launch | Canvas consumes the pinned OS implementation | Canvas app/Worker tests and bundle |
| C05 / GTM | Builder compares discovery cost and buyer outcomes | Experiment below; no fabricated WTP or savings |

## TAD: NATIVE-CONTEXT-001@1.0.1

The three browser/edge-safe modules in `runtime/` are independent of the Node governance harness.
They use JavaScript and Web Crypto, have no network calls, model adapters, storage, or host imports,
and load only through explicit package subpaths. The package root and always-load documents gain
zero context imports/bytes. The migrated runtime is capped by tests at three modules, 32 KiB total,
and fewer than 400 lines per file; the existing 46-module harness cap stays unchanged.
Two lazy CLI modules add source discovery without a daemon, cache directory, or new dependency.

### Source discovery

```sh
agentic-os context map --path=src --limit=5
agentic-os context search --path=src --query=payment --limit=5
agentic-os context read --path=src/payment.mjs --sha256=<returned-sha256> --line=1 --lines=40
```

`--path` is an explicit repository-relative file or directory. No sibling repository is scanned.
Commands work inside an ordinary Git repository without profile enrollment. Run separately from
each owner root. Search is literal, case-insensitive and path-ordered, with one excerpt per matching
file. `totalMatches` counts files; `matchingLines` counts line hits. Follow `nextAfter` using `--after`
for another file page and `nextLine` using `--line` to continue a read. A zero match is not an
exhaustive answer outside the selected scope or supported text formats.

Each result carries a repository-relative path, SHA-256 of current file bytes, and line location.
The envelope carries Git HEAD separately: dirty bytes are never presented as a committed blob.
Map entries expose Markdown headings, lexical JS/TS exports and single-line import hints. Only an
exact relative filename within the selected corpus resolves an edge. Multiline imports, compiler
resolution, dynamic imports, aliases and call graphs remain outside this lexical contract.
Content is untrusted reference data; quoted instructions never acquire execution authority.

The reader reuses existing sanitized Git and bounded regular-file readers. Visibility is tracked
plus nonignored untracked files; a tracked deletion is reported explicitly. Sensitive path names
(`.env`, credentials, secrets, private workspace and Git directories), generated directories and
unsupported formats are excluded. Symlinks, traversal, unsafe ancestors and invalid UTF-8 fail.
This path policy is not a secret detector: the caller must choose source safe to disclose.

Freshness comes from content hashes, not mtime, HEAD alone or a saved summary. Inventory, HEAD and
source bytes are rechecked before returning. The receipt explicitly reports `atomicSnapshot: false`:
an unrelated writer can still change a file after observation. `read` requires the returned SHA-256
and rejects drift. Recheck owner evidence before executing effects. No cache is shared across roots.

Bounds: 512 inventory paths, 128 KiB per file, 4 MiB selected source, 128 facts per file,
256 query bytes, 20 result files, 80 read lines and 16 KiB serialized output. Limits fail visibly;
narrow the scope or page the response. The scan checks a 10-second cooperative processing budget;
it is not a hard deadline for filesystem or Git I/O. No source is silently truncated.

For repeated calls in a task host:

```js
const { createCodebaseContext } = await import('agentic-os/context/codebase');
const context = createCodebaseContext({ root: '/explicit/repository/root' });
const result = context.search({ path: 'src', query: 'receipt' });
```

One instance retains only its last scope's hashed navigation metadata, never file bodies. Every call
rereads current bytes; unchanged files skip structural extraction, reported by `reusedFiles`.
Separate CLI processes retain nothing. There are no watchers, background indexing, persistent
summaries or automatic prompt injection. This trades repeated bounded reads for less state and
reliable handling of same-size, restored-timestamp edits.

### Stable prefix

```js
const { createCacheContextRegistry, normalizeCacheUsage } = await import('agentic-os/context/prefix');
const registry = createCacheContextRegistry();
const entry = await registry.register({ namespace: 'tenant/session', revision: 'source-sha',
  stablePrefix: [{ role: 'system', content: 'Reviewed operating instructions' }] });
const packet = registry.assemble({ handle: entry.handle,
  dynamicTail: [{ role: 'user', content: 'Current request' }] });
```

`register` returns an opaque handle, revision, namespace-bound routing key, stable-prefix digest,
token estimate, eligibility estimate and `registered|already_registered` status. JSON key order is
canonical; array order is preserved; snapshots are deeply frozen. `assemble` returns the unchanged
prefix first, then the dynamic tail. `invalidate({handle})` removes a retained entry; `stats()` exposes
counts and policy only. Input aliases are copied; cycles, accessors, sparse arrays and invalid JSON fail.

Retention defaults to 32 entries, hard maximum 128. Stable prefixes have a configurable character
ceiling up to 200,000 and a 200,000 UTF-8 byte ceiling; dynamic tails have the same byte ceiling.
Identifiers are bounded to 512 characters and reject controls. The shared JSON snapshot has limits
of depth 32, 50,000 nodes and one million aggregate characters. These limits apply before hashing.
Concurrent identical registrations share digest work; distinct pending work is bounded by capacity.
The latest admitted revision wins per namespace. An older slow hash cannot overwrite a newer entry;
a later explicit registration may reuse an old revision name. Eviction is least-recently-used.

Local assembly reports `localPrefixStatus: reused` and `providerCacheStatus: unverified`.
The default 1,024-token threshold is a configurable heuristic, not a provider guarantee.
`normalizeCacheUsage` exposes model, prompt/completion/cache-read/cache-write tokens, cache hits,
provider status and an attributed estimated cost. Missing telemetry stays `unreported`; a miss
requires an explicit zero cached-token report. Counts exceeding reported input remain attributed
as returned but cannot establish a hit. Local reuse never establishes a provider cache hit.
Routing isolation does not replace authorization: scope registry ownership to a trusted caller boundary.

### Reasoning continuity

`agentic-os/context/continuity` exports `createReasoningContinuityRegistry`. The migrated API is
`begin`, `complete`, `abort`, `invalidate`, `stats`. `begin` binds a thread ID, ordered goals,
assumptions and priorities plus adapter-declared `previousResponseId` and `reasoningContexts`.
It returns a turn token, status, requested context and request patch. It stores opaque response IDs
and invariant fingerprints, never hidden reasoning text or transcripts.

| Condition | Planned behavior |
|---|---|
| First turn | Omit previous response ID; request current-turn context only if supported |
| Completed response and unchanged invariants | Request all-turns context only if both capabilities exist |
| Changed invariants | Preserve supported conversation chaining; request current-turn context |
| Missing capabilities | Omit unsupported fields and report unsupported continuation |
| Complete with exact active token | Retain response ID and adapter-returned effective context |
| Abort | Release active turn without advancing response ID or invariant fingerprint |

One active turn per thread; active turns are never evicted. Defaults: 32 threads, 64 completed turns
per thread. Hard ceilings: 128 threads, 4,096 turns, 32 invariant items/field, 2,000 characters/item,
512-character identifiers. Invalidate or explicitly abort when required; no implicit retry loop.
Provider confirmation requires matching effective response metadata. Adapters must verify actual
capabilities; these field names are not a claim that any particular current model supports them.

## ADR: NATIVE-CONTEXT-001@1.0.1

Move the existing portable Canvas mechanisms into OS; retain a contract-only JSON re-export in
Canvas for its existing callers. Remove the duplicate prefix/continuity implementations and move
their behavior suites upstream. Canvas keeps integration tests at the application boundary.
Reject always-loaded code maps, copied Graft code, external parser dependencies, embeddings, model
summaries and new persistent state for this slice. Deterministic lexical hints suffice for the first
source-navigation use case; they do not pretend to understand arbitrary language semantics.

Migration baseline: Canvas revision `e0644ea032f37f7660d53232442bf1f10a9afc97`:

| Canvas source | New owner | Consumer |
|---|---|---|
| `agent-api/src/cache-context.js` | `runtime/cache-context.mjs` | `agentic-os/context/prefix` |
| `agent-api/src/reasoning-continuity.js` | `runtime/reasoning-continuity.mjs` | `agentic-os/context/continuity` |
| `agent-api/src/json-contract.js` | `runtime/json-contract.mjs` | `agentic-os/context/json` compatibility re-export |
| Cache/continuity API documentation | This guide | Canvas retains product wiring and live-proof boundaries |

The reference [Graft README](https://github.com/trailhq/Graft) informed source-linked discovery,
freshness and progressive disclosure only. No external implementation, dependency, prompt, fixture,
benchmark result or prose was imported. Performance claims must come from this implementation.

## GTM: buyer and verification plan

First segment: solo developers shipping agent services, marketplaces or payment workflows with
frequent cross-owner edits. The pain hypothesis is repeated source discovery and stale-context
rework. WTP is unvalidated. Use the free local tool to complete one real buyer-critical path; do not
build another marketplace, payment service or paid infrastructure to validate a context feature.

Measure task completion time, input/output bytes, missed-owner edits and regressions on the same
acceptance task with and without bounded context. Report raw observations, scope and denominators;
prompt token estimates do not establish billed savings. Ask pilot buyers whether reduced rework
changes their delivery outcome before proposing a paid hosted/team offering. No conversion target,
revenue, provider cache saving or production-readiness claim is inferred from unit tests.

Run `npm run context:check`, then `npm run check` and the requested full `npm run check:all`.
Tests cover migration behavior, races, failure release, source drift, exclusions, bounds, independent
worktrees, offline CLI and package/platform boundaries. Canvas owns its full suite and Worker bundle.
Keep the existing Dev Graph -> production mirror -> `airvio.co` topology and deployment owner;
this library migration grants no production deployment or live payment authority.

## MVP — reference implementation

`NATIVE-CONTEXT-001@1.0.1` selects one owner-grounded source lookup and bounded context handoff. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
Verify that acceptance with `npm run context:check` and the affected repository checks, preserving their exact source, result and authoring surface. The named command is a check plan; existing observations above retain their original scope and revision.

Experience assessment for `NATIVE-CONTEXT-001@1.0.1` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.
