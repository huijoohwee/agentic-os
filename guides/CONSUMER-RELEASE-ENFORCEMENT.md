# Consumer release enforcement

`agentic-os` owns the consumer release contract. Its pinned `owner-reuse` GitHub Action runs the shared check in the consumer's required CI job; products do not copy the checker.

For each candidate, the action reads `.agentic-os.json` from the protected base commit, validates that the candidate preserves that profile, and binds it to the GitHub repository identity. It then checks the consumer's required workflow job names (using the job ID when a job has no explicit `name:`), lifecycle script aliases, SHA-pinned AOS action, and matching exact AOS package/lockfile pin with integrity. Any missing or conflicting binding fails the check with a direct repair message.

The protected base profile prevents a pull request from weakening its own policy in the same change. A profile migration must land separately under the repository's normal protected review. The shared action is source enforcement; Production publication remains a separately authorized effect.

Pin the shared action to its exact reviewed AOS commit. The lifecycle package may remain on a separate exact AOS commit when its lockfile records matching resolution and integrity. The current source contract targets Commerce, Design System, Graph, Sheets, Base, and Geo. Extend enrollment through a reviewed AOS source change before treating another consumer as covered.

## Default Dev release

1. Check the published PR head against the current protected base. Wait for all required checks and reviews to pass.
   If the base moves and protection requires an update, refresh the same PR and check the new head.
2. Merge the checked head under its existing grant. Record the merge SHA from the provider.
3. Sync the canonical checkout and record its protected SHA. From that checkout, refresh the local Dev port with the
   product's runtime owner. Record the loopback URL and verify the serving revision through its runtime identity,
   or verify the listener's checkout and a revision-specific served asset. A headless owner records the checkout SHA.
4. Verify the required jobs in the protected branch's push run for that exact SHA. For GitHub, look up the run with
   `gh run list --branch "$branch" --event push --commit "$sha" --workflow "$workflow"`.
   Inspect its jobs and retain the successful run URL with the revision. A missing run or pending job keeps Dev
   verification pending. Recheck the same revision. On failure, retain the failed job URL and repair through review.

Graph uses its canonical `npm run turn:end -- --json` receipt for port 5173. Gateway and Design System use
their own `npm run dev` previews on 4178 and 4180 respectively. Use the owner-reported port for a configured override.
If the protected tip advances during verification, keep the merge SHA and its CI result, sync to the new tip,
and verify the serving revision and its push CI before reporting the port current.
