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
| Universal runtime prompt | 1,000 UTF-8 bytes | `__tests__/guards-and-budgets.test.mjs` |

40 KB is roughly 10k tokens of fixed session cost. The comparison worth keeping in mind: an
instruction surface of 629 KB is about 157k tokens, which is most of a context window spent before
any work begins, and it grows every time a scenario gets its own document.

Any directive adding always-load guidance states its projected byte delta and fits the configured
budget; otherwise it is incomplete and must replace lower-value text or become lazy-load. Code-point
count is secondary, and token estimates are advisory because tokenizers vary by model and provider.

## Module budget

| Scope | Cap | Enforced by |
|---|---|---|
| Modules in `src/` | 46 | `bin/agentic-os-module-budget.mjs` |
| Authored lines in `src/` | 15,000 | `bin/agentic-os-module-budget.mjs` |
| Lines in one module | 400 | `bin/agentic-os-module-budget.mjs` |

The cap is the design constraint that keeps scenarios in the state table. A per-scenario quadruple of
contract, controller, adapter, and evidence module multiplies: 76 scenarios becomes 304 modules and
roughly 195k lines, and at that size the harness is the product.

A directive proposing a module pattern states its per-scenario multiplier and projected module delta;
otherwise it is incomplete. New behavior belongs in the state table or an existing responsibility owner.

## Reading the failure

Both checkers print the offending path, measured value, and cap. Caps do not rise under pressure. Fix
overruns by:

- move detail out of the always-load set into a document that loads on demand;
- collapse a scenario module into a row in the lane state table;
- delete guidance that has no repeated-error evidence behind it.
