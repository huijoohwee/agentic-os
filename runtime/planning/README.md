# Optional planning contracts

Owner: agentic-os. Loaded only through the explicit `agentic-os/planning/*` exports.

The scheduler partitions caller-supplied tasks by dependencies, write-set overlap and
capacity. The goal planner feeds recorded outcome weights into that scheduler.
Reports are advisory: labels such as `current` and authorization IDs come from the
caller and grant no claim, dispatch, integration, deployment or cleanup authority.
Execution must use the existing runtime and independently verified authority.

Use the `scheduler-cli` or `goal-cli` export with `plan --input=<file> --json`.
Both read at most 128000 bytes from a regular file; neither writes state nor starts
a service. Existing schema IDs remain compatible. Canonical JSON reuses the shared
bounded contract: plain data, dense arrays, finite numbers, no cycles or accessors.

`MIGRATION.json` binds transferred sources and the original 21 test cases. The
Canvas source remains until consumer cutover and retirement receive separate proof.
