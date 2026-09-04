# Start workflow

At start/resume, apply the global prompt's completion-estimate and external-wait rule.

Continuously obey `templates/SYSTEM-PROMPT-RUNTIME.md` as the global SSOT. Consumers reference its exact
installed asset (for example `node_modules/agentic-os/templates/SYSTEM-PROMPT-RUNTIME.md`); do not copy it.

From canonical run doctor/status, then `agentic-os start <scope> --write=<paths>`; edit only reserved owning
files in its worktree. Disjoint lanes run; overlaps wait. After checks, `agentic-os land --message=<message>`
stages, commits, pushes, and requests integration. Never copy lane files into canonical.
