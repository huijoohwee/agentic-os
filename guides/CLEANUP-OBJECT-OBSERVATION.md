# Retained Git object observation

Continuity `CLEANUP-OBJECT-OBSERVATION-001@1.0.0`.

PRD: authorized quarantine must support Git object files hardlinked by local clones without
rewriting the shared object store. TAD: permit hardlinked regular files only in read-only shared
object manifests; bind content, mode and link count and retain stable descriptor/path checks.
ADR: keep default quarantine manifests strict. Projection, registration, refs and reflogs still
reject hardlinked files; special files remain unsupported. No object mutation or new cleanup effect.

Behavior checks cover actual local-clone hardlinks, byte/link-count changes, bounds, and strict
projection observation. See [cleanup authority](CLEANUP-AUTHORITY.md) for provider receipt ordering.
This changes observation compatibility, not integration, retirement or deletion authority.
