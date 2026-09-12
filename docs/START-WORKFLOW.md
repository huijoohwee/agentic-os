# Start workflow

At start/resume, apply the global prompt's completion-estimate and external-wait rule.
Continuously obey `templates/SYSTEM-PROMPT-RUNTIME.md` as the global SSOT.
Installed (`node_modules/agentic-os/templates/SYSTEM-PROMPT-RUNTIME.md`); do not copy it.
Run doctor/status, then `agentic-os start <scope> --write=<paths>`. Disjoint lanes run; overlaps wait.
After checks, `agentic-os land --message=<message>` stages, commits, pushes the reserved diff.
Never copy lane files into canonical.
Memory: `../guides/MEMORY.md`.
Cross-repo writes/publication: enforce `../FLEET.md`.
