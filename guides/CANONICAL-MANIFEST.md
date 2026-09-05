# Canonical quarantine manifests

Canonical synchronization preserves every selected source entry before conditional retirement.
A manifest that fits 500,000 bytes retains the existing `agentic-os-canonical-sync-quarantine/v1`
format and bytes. Larger projections use `agentic-os-canonical-sync-quarantine/v2` in
`manifest.json`, plus ordered `manifest-chunk-<index>.json` files. This changes representation,
not source ownership, ignored-path policy, retirement authority, or content verification.

Every index and chunk stays within 500,000 bytes. At most 31 chunks plus one index are permitted;
their combined size, including the index, must not exceed 16,000,000 bytes. These independent
ceilings are checked during projection planning before recovery, quarantine allocation, or source
effects. No compression or decompression is used. A single unfit entry, oversized index, excess
chunk count, or aggregate overflow refuses the operation without weakening another budget.

Each chunk retains original entry fields and global slot numbers. The index binds the plan and
inventory digests, total entry count, and ordered chunk name, first slot, entry count, byte length,
and SHA-256. Ranges are contiguous. Names are generated flat basenames disjoint from numeric
source slots; neither caller paths nor archive extraction select metadata destinations.

The quarantine writer takes private copies of bounded input buffers, writes chunks exclusively
before publishing the index, and checks all metadata files in its exact directory inventory.
Every manifest file is rechecked against its private expected bytes and filesystem identity before
and after conditional source retirement. Self-consistent changes to on-disk metadata are insufficient.
Failures retain copied sources and published metadata, and report known paths and uncertain writes.
The receipt's existing manifest digest hashes the index, which transitively binds every chunk.

This is local preservation evidence. It does not prove operating-system exclusivity, protected
integration, production readiness, or deployment authority.
