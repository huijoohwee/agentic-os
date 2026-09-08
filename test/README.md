# Shared testing

Agentic OS owns cross-repository test coordination, evidence and shared contract vectors. Product
implementations and executable product suites stay in their source repositories. This folder is not a
second runner, a dependency mirror or a production-readiness authority.

| Concern | Single source |
| --- | --- |
| Owner scripts and workflow references | `repositories.json` |
| Ecosystem test results and unresolved failures | `log.md` |
| Admission acceptance vector and checksum | `contracts/admission-v2.fixture.json`, `contracts/admission-v2.fixture.sha256` |
| Validation policy and repair batching | `../guides/VALIDATION-ECONOMY.md` |
| Harness executable tests | `../__tests__/` |

The index covers agentic-os, agentic-canvas-os, agentic-graph, agentic-commerce-os,
huijoohwee.github.io, huijoohwee and GameXR. Add future repositories as bounded index rows with their
own package scripts and workflow paths; do not copy command bodies or executable tests here.
Discovery accepts up to 32 owners and 32 selected roots, within the existing input/output and deadline
bounds. A missing profile, root or source stays unavailable. Listing GameXR does not enroll an ADLC
profile or establish validation or release readiness.

Consumers read contract assets from their pinned `agentic-os` package:

```js
const fixtureUrl = new URL(import.meta.resolve('agentic-os/test/contracts/admission-v2.fixture.json'));
```

Verify the checksum before interpreting a shared vector. The vector is test input, not signed runtime
evidence or an authority grant. Its byte identity remains separate from consumer implementation,
package pin, test execution and provider results. Do not edit or duplicate an installed package asset.

Record results against the exact source, command, environment, scope and outcome. Keep focused and
full runs distinct, preserve unresolved failures and link release/cleanup/runtime receipts separately.
The central log's imported history retains its original claims and provenance. Its current owner is
this folder even where historical records mention Canvas. Keep files below 600 lines and 500 kB;
archive bounded historical sections by reference when needed instead of silently dropping evidence.

During migration, publish these upstream assets first, adopt the exact package pin in consumers, then
remove their replaced shared fixture/log files. Product `test/domain`, `test/workers`, `test/shared`,
`test/browser`, `test/e2e`, `tests/` and `__tests__/` suites remain with their owning source and tools.

The static admission probe takes Canvas, Commerce, and upstream Agentic OS roots, in that order.
Its v2 report binds one upstream fixture blob plus each product's own contract blob, without
executing product code. The v2 composition source lock keeps product revisions explicit and binds
the shared fixture through the inspected Agentic OS revision; it never invents a self-referential pin.
Historical product revision locks remain historical until separately reviewed and updated.
