# Fork bootstrap

Requires Node.js 20.11+, npm and Git. GitHub provider observation and protected publication also
require the optional GitHub CLI (`gh`) with authentication for the fork. Local setup and profile
creation do not contact GitHub. Use a fresh clone if a previous setup already anchored a different
repository: profile generation does not rotate or delete trust.

1. Fork the repository and clone the fork. Verify `git remote -v` names its exact repository for
   both fetch and push. Start from its clean canonical branch.
2. Generate a profile into a temporary file, inspect it, then install it:
   ```sh
   node bin/agentic-os.mjs profile init --repository=github.com/YOUR-OWNER/YOUR-REPO > /tmp/fork-profile.json
   # Inspect /tmp/fork-profile.json before replacing the profile.
   cp /tmp/fork-profile.json .agentic-os.json
   ```
   Never redirect directly into `.agentic-os.json`: the generator reads the existing profile.
   It preserves checks, capabilities, canonical refs, cleanup and provider policy, recomputes the
   digest and checks GitHub remote identity. It writes only JSON to stdout; it changes no trust.
3. Commit and push the bootstrap profile on the fork:
   ```sh
   git add .agentic-os.json
   AGENTIC_OS_ALLOW_CANONICAL_WRITE=1 git commit -m "chore: initialize fork identity"
   AGENTIC_OS_ALLOW_CANONICAL_WRITE=1 git push origin main
   git fetch origin
   ```
   This explicit one-time bootstrap is for a fork you own, before normal lane admission. A protected
   fork may require its own bootstrap PR. The environment flag cannot bypass hosted protection.
4. Run `npm install` and `npm run setup`. Setup refuses a remote/profile mismatch before creating
   trust or configuring hooks. Existing trust is never overwritten. A fork with an old upstream
   trust anchor needs a fresh clone or its separately authorized trust-rotation process.
5. Run `gh auth status` and `npm run doctor`. Configure the fork's required GitHub protections to
   match its selected profile; setup does not create provider policy. An unavailable required
   provider remains a failure. A profile without provider-dependent policy can warn when gh is absent.
6. Open a normal lane: `npm run lane -- first-change --write=README.md`. Author and check in the
   printed worktree, then `npm run land -- --message="docs: introduce this fork"` for protected handoff.

For an ecosystem fork, update `catalog/composition-source-lock.json`: `repository` names the harness,
`owners` names each product repository and its exact revision/tree. The executing harness catalog
supplies composition identities; candidate files cannot select a different trusted owner. Existing
contract, artifact-blob, lockfile and source-byte checks still apply. Product profile and package
pins must match those owners. `test/repositories.json` and hosted authority policies describe this
upstream deployment; configure equivalent owner policy in your fork before using those surfaces.

Use `github:OWNER/REPO#FULL_40_HEX_REVISION` for new consumer pins. Check a consumer against the fetched
harness revision with `node bin/agentic-os.mjs pin --consumer=/absolute/consumer/root`; select another
locally resolvable revision with `--revision=<40-hex>`. The check reports revision, format and lockfile
drift without editing a consumer. Older tarball consumers remain inspectable by composition checks;
migrate each through its owner checks and protected workflow before claiming one shared revision.

Set `AGENTIC_OS_DEVICE=office` for a stable public device alias, or pass `--device=office` to lane/status.
The default is a short hostname hash, which hides the literal hostname but is not an anonymity guarantee.
Existing hostname-based refs remain valid; use `status --device=<old-device>` to inspect them.

`npm run test:fast` runs 28 pure unit checks. `npm run test:git` runs the complementary integration
suite, including other non-fast tests. `npm run check` remains the required complete test and budget
check. The source repository's `npm run land` runs fast checks before invoking the publication CLI.
