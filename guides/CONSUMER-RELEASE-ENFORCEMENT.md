# Consumer release enforcement

`agentic-os` owns the consumer release contract. Its pinned `owner-reuse` GitHub Action runs the shared check in the consumer's required CI job; products do not copy the checker.

For each candidate, the action reads `.agentic-os.json` from the protected base commit, validates that the candidate preserves that profile, and binds it to the GitHub repository identity. It then checks the consumer's required workflow job names, lifecycle script aliases, SHA-pinned AOS action, and AOS package/lockfile pin. Any missing or conflicting binding fails the check with a direct repair message.

The protected base profile prevents a pull request from weakening its own policy in the same change. A profile migration must land separately under the repository's normal protected review. The shared action is source enforcement; Production publication remains a separately authorized effect.

Pin the action and `agentic-os` package to the same full AOS commit. The current source contract targets Commerce, Design System, Graph, Sheets, Base, and Geo. Extend enrollment through a reviewed AOS source change before treating another consumer as covered.
