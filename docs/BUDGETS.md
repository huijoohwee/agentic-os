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
| `AGENTS.md` | 4 KB | `src/doc-budget.mjs` |
| Any single file in `docs/` | 12 KB | `src/doc-budget.mjs` |
| Always-load set (`AGENTS.md` + `docs/`) | 40 KB | `src/doc-budget.mjs` |
| Any authored line | 120 characters | `src/doc-budget.mjs` |

40 KB is roughly 10k tokens of fixed session cost. The comparison worth keeping in mind: an
instruction surface of 629 KB is about 157k tokens, which is most of a context window spent before
any work begins, and it grows every time a scenario gets its own document.

## Module budget

| Scope | Cap | Enforced by |
|---|---|---|
| Modules in `src/` | 25 | `src/module-budget.mjs` |
| Authored lines in `src/` | 15,000 | `src/module-budget.mjs` |
| Lines in one module | 400 | `src/module-budget.mjs` |

The cap is the design constraint that keeps scenarios in the state table. A per-scenario quadruple of
contract, controller, adapter, and evidence module multiplies: 76 scenarios becomes 304 modules and
roughly 195k lines, and at that size the harness is the product.

## Reading the failure

Both checkers print the offending path, the measured value, and the cap. The fix is never to raise
the cap. It is one of:

- move detail out of the always-load set into a document that loads on demand;
- collapse a scenario module into a row in the lane state table;
- delete guidance that has no repeated-error evidence behind it.

Raise a cap only with a written reason and the same commit that shows why the alternatives fail.
