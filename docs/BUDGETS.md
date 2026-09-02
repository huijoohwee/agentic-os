# Budgets

Budgets exist because an agent pays for the always-load surface on every single session, before it
writes a line of product code. `npm run check` enforces them.

## Why bytes, not lines

A line cap is gameable and gets gamed. A 600-line cap satisfied by 3,000-character lines measures
nothing while reporting compliance. Tokens track bytes, so the budget tracks bytes and adds a line
length cap to keep diffs and reviews readable.

## Documentation budget

| Scope | Cap | Enforced by |
|---|---|---|
| `AGENTS.md` | 4 KB | `bin/agentic-os-doc-budget.mjs` |
| Any single file in `docs/` | 12 KB | `bin/agentic-os-doc-budget.mjs` |
| Always-load set (`AGENTS.md` + `docs/`) | 40 KB | `bin/agentic-os-doc-budget.mjs` |
| Any authored line | 120 characters | `bin/agentic-os-doc-budget.mjs` |
| Universal runtime prompt | 1,000 characters | `__tests__/guards-and-budgets.test.mjs` |

40 KB is roughly 10k tokens of fixed session cost. The comparison worth keeping in mind: an
instruction surface of 629 KB is about 157k tokens, which is most of a context window spent before
any work begins, and it grows every time a scenario gets its own document.

## Module budget

| Scope | Cap | Enforced by |
|---|---|---|
| Modules in `src/` | 46 | `bin/agentic-os-module-budget.mjs` |
| Authored lines in `src/` | 15,000 | `bin/agentic-os-module-budget.mjs` |
| Lines in one module | 400 | `bin/agentic-os-module-budget.mjs` |

The cap is the design constraint that keeps scenarios in the state table. A per-scenario quadruple of
contract, controller, adapter, and evidence module multiplies: 76 scenarios becomes 304 modules and
roughly 195k lines, and at that size the harness is the product.

The increase from 25 to 29 isolates canonical projection, staging, recovery/effect journaling, MCP
process termination, and quarantine preservation/conditional clean retirement as clone-wide safety
boundaries. They replace mixed responsibilities rather than adding scenario modules.

The increase from 29 to 35 isolates six reusable authority boundaries: external evidence, recovery
candidates, recovery inventory, GitHub challenge records, provider receipts, and I/O issuance. The
inventory boundary owns one generic read-only Git byte observer; the others keep pure records independent
of provider effects. None owns a scenario, target repository, release, or cleanup effect.

The increase from 35 to 46 isolates eleven reusable lifecycle-completion boundaries: canonical effect and
transition records, ambient-independent authority reads, transition inputs, committed transition policy,
provider proof observation, provider REST I/O, create-only transition authority, cleanup records, cleanup
joins, bounded manifests, and exact quarantine mechanics. The split keeps provider I/O out of pure records,
policy out of provider proof, and bounded byte observation out of the mutation adapter. Defaults retain every
target; no module owns a repository or release scenario.

## Reading the failure

Both checkers print the offending path, the measured value, and the cap. The fix is never to raise
the cap. It is one of:

- move detail out of the always-load set into a document that loads on demand;
- collapse a scenario module into a row in the lane state table;
- delete guidance that has no repeated-error evidence behind it.

Raise a cap only with a written reason and the same commit that shows why the alternatives fail.
