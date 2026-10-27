# Repository checkout naming

Use the committed repository profile as the identity source. For GitHub profiles, the repository's final path component is its checkout slug.

| Checkout role | Directory name | Lane admission |
|---|---|---|
| Primary source clone | Exact repository slug, such as agentic-graph | Allowed |
| Private archive clone | Exact archive repository slug, ending -private-archive | Blocked |
| Auxiliary clone | <repository-slug>--<purpose> in lower kebab case | Blocked; diagnostics only |
| Registered Git worktree | Existing task/device lane name | Exempt from slug naming; lane identity comes from Git |

Do not suffix a canonical public checkout with -public: public status is not a separate repository identity. An archive is a separate GitHub repository and uses its full archive slug as its directory name.

agentic-os doctor reports the observed checkout role and fails on an unrecognized name. agentic-os start admits lanes only from the exact primary source clone and refuses private archives. The existing fleet ownership audit also rejects explicit canonical roots whose directory differs from the ownership policy and allows registered Git worktrees. These checks use existing repository identity and ownership metadata; there is no additional path registry and no automatic rename.

When correcting a local name, first stop writers and close tools using that path, move the whole checkout without altering Git data, update any path-bound local configuration, then rerun agentic-os doctor. Repository visibility and remote authorization remain provider-owned facts; a directory name proves neither.
