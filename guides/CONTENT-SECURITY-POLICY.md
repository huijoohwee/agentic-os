# Content Security Policy

`agentic-os` owns the shared delivery rule and header helpers. Product owners keep their own
directive values because each application serves different capabilities.

- Production and pre-production HTML have one enforced CSP delivery. A serving owner that controls
  response headers uses one `Content-Security-Policy` header; static HTML hosting uses one enforced
  CSP `<meta>` element when response headers are unavailable. Never emit both for the same document.
- Development uses `Content-Security-Policy-Report-Only` while a policy is evaluated. Promote the
  reviewed policy to enforcement before Production.
- A development exception must name its product owner, HTML surface, reason, and lifetime. Limit it
  to the local development origin and keep it out of production artifacts.
- Serving code uses `agentic-os/content-security-policy` to set or verify the mode. The helper
  removes the opposite header and rejects duplicate directives; consumers must not copy its logic
  or layer a conflicting policy variant over it.
- Each serving owner wires an exact policy check into a required integration or release gate. The
  check observes the generated or returned HTML policy, not only a documentation claim. Consumer
  entries name those required owner gates in the machine-readable register.

The machine-readable consumer register is [`../catalog/content-security-policy-consumers.json`](../catalog/content-security-policy-consumers.json).
`npm run csp:check` validates the shared contract in the `agentic-os` CI evaluator. Consumer gates
remain product-owned and run in each repository's protected integration workflow.
