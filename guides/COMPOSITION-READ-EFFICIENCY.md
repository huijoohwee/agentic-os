---
title: Composition source-read efficiency
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "1.0.1"
date: "2026-09-12"
owner: "agentic-os"
continuity_id: "CID-COMPOSITION-READ-EFFICIENCY-01"
load_policy: lazy
lang: "en-US"
frontmatter_contract: "required"
local_rung: "undocumented"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "device-cba000d3779d--planning-v27"
agent_id: "codex-01a0940a"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/e8d2a10a8d3e5735c43edf350a22523df05fdf91/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
reviewed_source_revision: "817c1da8dac21d688d7c531b234482c64ee4340b"
prd_revision: "1.0.1"
tad_revision: "1.0.1"
adr_revision: "1.0.1"
mvp_revision: "1.0.1"
gtm_revision: "1.0.1"
---

# Composition source-read efficiency

CID-COMPOSITION-READ-EFFICIENCY-01 applies to the requirement, design, and decision below.
RAO: the harness observes source contracts to reduce repeated process work while retaining exact evidence.
SVO: the observer batches immutable Git descriptors and freshly verifies current files.

## PRD

Requirement: repeated composition checks consume local time and process memory before commerce candidates
can be reviewed. Reduce that overhead without treating cached source information as current readiness,
executing candidate code, or adding runtime dependencies. Buyer demand and collected revenue need separate evidence.

## TAD

Design: `createCompositionHeadReader` captures one exact revision and canonical root directory identity.
One trusted, configuration-scrubbed Git query resolves at most 64 literal paths, each at most 4 KiB,
with 32 KiB aggregate path text and 64 KiB metadata output. Private metadata lasts only for the caller's
inspection. Every read validates root/path identity, reads bounded raw bytes, and checks the captured blob.
Mutable returned buffers cannot affect later reads. Missing files retain individual diagnostics.

Runtime contract inspection uses one reader per component per inspection, including its package lock.
The source-lock observer uses one reader per artifact owner and retains only the topology bytes after
each blob comparison. Existing later revision and worktree reobservations remain fresh.

## ADR

Decision: batch immutable descriptors within the existing owning modules. Preserve the single-file API
as a contract shim. Do not persist descriptors, file bytes, cleanliness, test results, or authority verdicts.
Always-loaded guidance, runtime dependencies, and source-module count each grow by zero.

Cost evidence: the behavior test reads 32 files twice. The single-file API needs 64 metadata subprocesses;
the bounded reader needs one, with the same 64 raw file reads. Timing diagnostics describe only that fixture,
not total release latency, peak RSS, tokens, money, or live commerce performance. Current runtime requirements
and package locks need 56 metadata queries per inspection before batching, four afterward. Source-lock reads
need 11 before and four afterward. Forbidden-path checks and independent evidence observations remain separate.

Verification: `node --test __tests__/composition-read-efficiency.test.mjs __tests__/composition-runtime-check.test.mjs`,
then the full applicable `npm run check`. Behavior covers edits with unchanged size/mtime, revision drift,
root and symlink replacement, literal paths, containment, malformed metadata, and input bounds. Protected
integration, runtime readiness, deployment, retirement, and cleanup each retain their own evidence requirements.

## MVP — reference implementation

`CID-COMPOSITION-READ-EFFICIENCY-01@1.0.1` selects one bounded immutable-descriptor batch with fresh source-byte verification. Reuse the PRD acceptance and TAD owners above; deferred features stay outside this slice.
Verify that acceptance with `node --test __tests__/composition-read-efficiency.test.mjs __tests__/composition-runtime-check.test.mjs` and the affected repository checks, preserving their exact source, result and authoring surface. The named command is a check plan; existing observations above retain their original scope and revision.

## GTM — reference implementation

The initial user is a solo developer or operator completing the selected engineering outcome. WTP, priced-offer acceptance, collected payment and repeat use remain unvalidated. Reuse this free local slice for a timed pilot before considering a hosted service; reject paid infrastructure until buyer evidence justifies it.

Experience assessment for `CID-COMPOSITION-READ-EFFICIENCY-01@1.0.1` in the authoring environment: Core Requirements & Functionality, Innovation & Theme Alignment, Technical Execution & Integration, and Usefulness & Agentic Experience are all **unassessed**. No user-study evidence is attached; the document owner must record one timed pilot and criterion-specific observations before rating them. Keep token usage, active minutes, provider waits and actual cost separate; no savings or revenue follows from structural checks.
