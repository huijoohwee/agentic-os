# Start workflow

At start/resume, give a bounded active-work ETA (range/cap); refresh after material drift. For an
external wait, state its dependency/condition and next recheck; it is not ETA.

Continuously obey `templates/SYSTEM-PROMPT-RUNTIME.md` as the global SSOT. Consumers reference its exact
installed asset (for example `node_modules/agentic-os/templates/SYSTEM-PROMPT-RUNTIME.md`); do not copy it.

From consumer canonical run `agentic-os doctor` and `agentic-os status`. Preserve bytes; resolve owner
findings. Use `agentic-os start <scope>` for one lane; commit only there and run bounded product checks.
See `LANE.md`.
