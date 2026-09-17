# Start workflow

Obey `templates/SYSTEM-PROMPT-RUNTIME.md` (consumers: `node_modules/agentic-os/`); estimates and waits apply.
Run doctor/status; `agentic-os start <scope> --write=<paths>`. Disjoint lanes run; overlaps wait.
After checks, `agentic-os land --message=<message>` publishes scope.
Never copy lane files into canonical. Cross-repo writes/publication enforce `../FLEET.md`.
See [handover](../guides/PRD-TAD-ADR-MVP-GTM.md#planning-release-handover).
For prior evidence: `agentic-os workflow recommend --input=<manifest>`; revalidate source/scope.
Details: `guides/VALIDATION-ECONOMY.md`.
