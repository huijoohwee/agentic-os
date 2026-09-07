---
title: Composition source-read efficiency
doc_type: PRD-TAD-ADR
version: 1.0.0
date: 2026-09-07
owner: agentic-os
continuity_id: CID-COMPOSITION-READ-EFFICIENCY-01
load_policy: lazy
---

# Composition source-read efficiency

CID-COMPOSITION-READ-EFFICIENCY-01 applies to the requirement, design, and decision below.
RAO: the harness observes source contracts to reduce repeated process work while retaining exact evidence.
SVO: the observer batches immutable Git descriptors and freshly verifies current files.

Requirement: repeated composition checks consume local time and process memory before commerce candidates
can be reviewed. Reduce that overhead without treating cached source information as current readiness,
executing candidate code, or adding runtime dependencies. Buyer demand and collected revenue need separate evidence.

Design: `createCompositionHeadReader` captures one exact revision and canonical root directory identity.
One trusted, configuration-scrubbed Git query resolves at most 64 literal paths, each at most 4 KiB,
with 32 KiB aggregate path text and 64 KiB metadata output. Private metadata lasts only for the caller's
inspection. Every read validates root/path identity, reads bounded raw bytes, and checks the captured blob.
Mutable returned buffers cannot affect later reads. Missing files retain individual diagnostics.

Runtime contract inspection uses one reader per component per inspection, including its package lock.
The source-lock observer uses one reader per artifact owner and retains only the topology bytes after
each blob comparison. Existing later revision and worktree reobservations remain fresh.

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
