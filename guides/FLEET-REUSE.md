# Consumer reuse checks

Consumer integration jobs call the pinned OS owner-reuse action with the exact audited consumer commit. The action checks committed Git objects. A standalone run works offline with Node and Git:

```sh
node scripts/check-owner-reuse.mjs --root="$consumer" --repo="$repository_name" --base="$audited_commit" --revision="$candidate_commit"
```

Use the Gateway reference ID and its pinned index for indexed guidelines, dictionaries, schemas, catalogs and skills. Keep schema identifiers and historical evidence that require the original owner URI. New direct source routes and increases in a path's audited citation count fail. Source owners keep their own definitions.

Import shared code from its owner package. Pin installed Gateway, Design System, Sheets, Base and Geo dependencies to the owning GitHub repository and a full commit. The lock must agree on the package, source, revision and SHA-512 integrity. Peer compatibility declarations remain with libraries.

For offline products, keep the native projection verifier. The gate detects exact owner bytes at any filename and refuses a new copy or a divergent edit to an audited projection. To enroll a new offline projection, add an entry keyed by the consumer file path to `.agentic-os/owner-projections.json` with `owner`, `source` and `pin`. The file must match the named source at the catalog revision. Removing a projection and importing the package also passes.

The OS catalog records Git blob identities from protected owner histories and Gateway-verified reference bodies. To update it, edit the owner commit pins and run `node scripts/check-owner-reuse.mjs --build "$workspace"` with the owner repositories available locally. Review the regenerated catalog and update consumer action pins after OS integration. The trusted catalog binds each baseline with SHA-256 of the repository name, an at sign, and the full commit. Changing a baseline requires a new central audit of its citations and local copies.

The check identifies the indexed paths and byte-identical sources, including previously published versions of recorded source files. Independently rewritten implementations, compressed bundles and runtime-composed URLs need the product's native checks. A green run reports the exact checked commit and the counts of recognized projections and direct references.
