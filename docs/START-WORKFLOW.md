# Start workflow

1. `agentic-os start <scope> --write=<paths> --plan=<committed-plan>`
2. Disjoint lanes run; overlaps wait.
3. `agentic-os land --message=<message>` publishes scope; never copy into canonical.
4. Then [`RELEASE-WORKFLOW.md`](./RELEASE-WORKFLOW.md).

- Obey `guides/SYSTEM-PROMPT-RUNTIME.md`.
- At start/resume, estimate active work; distinguish external waits.
- Cross-repo writes/publication: enforce `../FLEET.md`.
- Retain the user's outcome/grant and workflow root through RELEASE; for Dev → Prod, merge/cleanup is not done.
