# Cursor adapter

Use only when the active host supports Cursor Canvas. Read the host-managed
`~/.cursor/skills-cursor/canvas/SKILL.md` and its installed SDK declarations for the current
file location, exports, props, theme tokens and diagnostics. Resolve the real workspace from
host context; do not assume a particular username or clone layout.

The observed host contract uses `.canvas.tsx` and `cursor/canvas`. Those names belong to Cursor;
they are not portable browser APIs and are not implemented by `agentic-os`. Follow the installed
host's storage and compilation rules and verify the resulting native canvas there.

Keep the shared decision/evidence guidance in the parent skill. Do not vendor the host skill,
SDK declarations, components or generated output into this package, or overwrite the user's
managed skill directory. If the host capability or SDK is unavailable, report that boundary and
use the [browser adapter](browser.md) when a portable alternative satisfies the request.
