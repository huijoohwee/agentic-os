# Private archive policy

## Scope

The public repositories `agentic-base`, `agentic-commerce-os`, `agentic-graph`, and
`agentic-design-system` remain their canonical sources. Their matching
`*-private-archive` repositories are private, frozen preservation copies; they are not
build inputs, product sources, or release targets. Keep GitHub Actions disabled in each
archive and do not store Actions artifacts, Git LFS objects, runtime data, or credentials
there. A snapshot preserves Git refs and history only.

| Public source | Private archive |
| --- | --- |
| `agentic-base` | `agentic-base-private-archive` |
| `agentic-commerce-os` | `agentic-commerce-os-private-archive` |
| `agentic-graph` | `agentic-graph-private-archive` |
| `agentic-design-system` | `agentic-design-system-private-archive` |

## Publishing boundary

Never change a private archive's visibility to public. A copy of a public repository's
history does not make that history confidential or undo prior exposure. If a separate
public mirror is proposed, first review every commit and ref in its full history, all
associated Actions logs/artifacts, license and third-party rights, and owner clearance.
Remove internal ledgers, uncleared inventories, secrets, and other non-public material;
rotate any exposed credential. Record an exact allowlist and publish only through a
separately reviewed change with explicit owner authorization. A clean current tree alone
is not sufficient evidence.

## Archive maintenance

Keep each archive private and read-only after the initial exact-ref mirror. Do not enable
Actions, add paid features, or copy production/runtime state. Refresh only through an
explicitly authorized, reviewed snapshot procedure that preserves the canonical source
and verifies the exact refs copied.
