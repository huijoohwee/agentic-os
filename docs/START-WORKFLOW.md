# Start workflow

At start/resume, apply the global prompt's completion-estimate and external-wait rule.

Continuously obey `templates/SYSTEM-PROMPT-RUNTIME.md` as the global SSOT. Consumers reference its exact
installed asset (for example `node_modules/agentic-os/templates/SYSTEM-PROMPT-RUNTIME.md`); do not copy it.

From consumer canonical run `agentic-os doctor` and `agentic-os status`. Preserve bytes; resolve owner
findings. Use `agentic-os start <scope>` for one admitted lane; commit only its smallest scoped diff and run
bounded product checks. Never copy lane files into canonical. See `LANE.md`.
