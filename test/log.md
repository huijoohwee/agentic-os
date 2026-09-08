# Central test log

Podman migration — v131 (2026-09-08): [Canvas #904](https://github.com/huijoohwee/agentic-canvas-os/pull/904) replaced the optional Docker CLI provider with Podman and removed the replaced source files. Full source check **1,032/1,032**, build/docs and **11/11** line-budget tests passed; protected CI passed before exact tested head `419a64861e0368013a07dc6492af18058fabebbc` merged as `892b394fd472409baf95884be9d354ef539a8889`. Podman 6.1.1 live proof passed **21 containment checks**, offline packages, loopback preview, snapshot seeding, cross-controller resume and zero remaining Canvas resources. The default Worker remains unconfigured. One brief docs index description is reserved by the separate planning-index lane; authoritative Sandbox docs are updated.

Commerce's source-native Podman migration is **unreleased**: types, **66 domain / 235 unit / 57 Workers**, named non-browser checks and deployment dry runs pass. The earlier real browser run passed **11/11**, but the paid-loop E2E failed: workerd emits memory swappiness and Podman/crun refuses it under cgroup v2 before the proxy starts. This is not a green Integration Gate; subsequent bounded image-observation changes have only source validation. One never-started proxy and the failed run's ownership lock/artifacts are preserved. No Docker engine was used; Docker Desktop data was not removed. Independent Commerce evidence still reports `evidence_runtime_context_incomplete`. All **505** reserved Graph paths remain unchanged and its last full registry remains **4,634 passed / 223 failed**, unreleased. No Prod mirror or Cloudflare deployment occurred. Handoff: `commerce-efficiency-resolution-v131.md`; receipts: `v131-validation-manifest.json`.

Shared validation ownership — v130 (2026-09-08): [OS #72](https://github.com/huijoohwee/agentic-os/pull/72), [Canvas #903](https://github.com/huijoohwee/agentic-canvas-os/pull/903), and [Commerce #13](https://github.com/huijoohwee/agentic-commerce-os/pull/13) merged their exact tested candidates after required CI passed. OS now owns this preserved history, the seven-repository check index (up to 32 reviewed entries), and one unchanged admission fixture/checksum; product suites remain in their source owners. Both consumers pin protected OS `22a1a3eff6fc5e6cb3494f0f35cf1b410c92a9bc`; replaced shared files were removed after exact upstream byte comparisons. The v2 static admission probe reads one fixture and separately binds both product contracts; historical composition revision locks remain explicit. No dependency or core module was added, and no full-suite speedup is claimed.

Full checks: OS **710/710** plus budgets; Canvas **1,031/1,031**, build/docs, and **11/11** line-budget tests; Commerce integration **62 domain / 235 unit / 57 Workers / 11 browser / 1 Dev paid-loop E2E**, types/contracts and deployment dry runs passed. Initial stale pin expectations were corrected before the complete passing consumer runs. Native finish retired the exact three clean PR worktrees and retained their branches. OS and Canvas canonical sync completed. Commerce canonical sync remains pending because pre-existing `.DS_Store` and `test/.DS_Store` were preserved; its protected merge is `591b6296ce7372b968bd61093d30ff3ae10dad37`.

Canvas's post-sync local runtime proof binds Canvas `c317a1e522a742c10d863648bd97a68bd873b06d` and Graph `10145f00a1cbe9bfb69baf699c1d3a1f2a164b32`, with three HTTP 200 probes. All 505 admitted Graph paths remain unchanged; Graph's last full registry is still **4,634 passed / 223 failed**, and its successor is unreleased. Fresh Commerce runtime evidence remains `evidence_runtime_context_incomplete` with four missing evaluator inputs and zero enrolled issuers. The Dev E2E proof does not establish live payment/provider or Production readiness. No Prod mirror or Cloudflare deployment occurred. Handoff: `commerce-efficiency-resolution-v130.md`; source/check/release receipts: `v130-validation-manifest.json`.

Latest recorded result: **Graph — 4,634 passed, 223 failed, 4,857 total.** v127 (2026-09-08): source-root `npm test`, 220.573 seconds, exit 1; 1 recovered existing case, 2 added cases, 0 regressions and 0 omissions versus v126. The source-owned React test harness now waits on an explicit condition using a captured monotonic clock, at most a five-second readiness budget, and act-wrapped timer yields. The presentation fixture waits for its existing inner renderer root before separately checking the image URL and table. Diagnostic evidence showed outer API/surface readiness while the inner lazy renderer remained absent; the prior act-only 40-retry loop did not establish readiness. Focused tests passed 3/3, including delayed lazy commit, deadline diagnostics, predicate failure and invalid-budget rejection. Source check and independent standalone export passed; four unchanged artifacts below 500 kB. Four changed files remain below 600 lines. Source, canonical, pinned docs and native lane observations stayed stable with no owned validation process survivors. No production preload or timeout policy changed; this single full-run recovery does not establish a statistical flake rate. The central unresolved count remains 223; Graph is uncommitted/unreleased. The #778 publishing handoff and latest v126 Commerce evidence gap remain unresolved. OS full checks and approved releases remain v124 evidence; no new source release, cleanup or deployment occurred.

Upstream validation economy — v128 (2026-09-08): agentic-os PR #71 merged the exact tested head `fb3064680948e7368bd02a334488b17a7d2ea3f3` as `f79cfb95ae9ae1e87144d81e3ecbac98d3393a56`. Full `npm run check`: **707/707 passed**, readiness/docs/module budgets passed, 176.817 seconds, unchanged tested bytes; GitHub `test` and `budgets` passed. The existing discovery path now groups bounded reported failures by test source, preserves case occurrences and missing detail, and keeps all observations unsigned. Native planning of the existing v127 report took 2.077 seconds: all 223 failures retained, 221 mapped into 136 source groups, 2 unmapped, 0 omitted. This is planning time, not suite speedup or root-cause proof. No new dependency/core module/always-load bytes; Graph's 503 reserved paths still match v127, so no redundant Graph full run was performed. Only the completed clean OS PR worktree was removed; its branch remains. Graph remains unreleased, and the v126 independent Commerce runtime evidence gap remains unresolved. No Production deployment occurred. Receipts: `os-v128-full-check.json`, `os-v128-final-failure-plan-run.json`, `os-v128-protected-merge-receipt.json`, `os-v128-finish.log`.

This file centralizes validation results; executable suites remain in their source repositories. A failed full suite remains failed even when focused checks pass. Prior receipt manifest: `graph-v104-validation-manifest.json`, SHA-256 `3c51de6558c112a471d7fa367fc49933cacded60441f9f43d2ebe28a3ac60f1c`; it binds exact tested source bytes and individual receipts. Prior: `graph-v105-validation-manifest.json`, SHA-256 `0a4a070dc6e18191689dbfb7378e5bb2aa71ffe24a08a5980994dca325acfac2`. Prior: `graph-v107-validation-manifest.json`, SHA-256 `53167c01c6dfb78046f413c32b93eb5bbaf240d2725d75ace61dbc5e3f98a59b`. v108 advisory upstream discovery covers all six committed canonical owners: 19 requested commands reduce to 10 only on complete success (9 duplicates); no owner suite was run or cached result accepted. Audit: `v108-validation-plan-audit.json`, SHA-256 `5b2b3844929c3f6f0682f08030f0b035727cd2ba67c54be078b7ef5811e3e626`. Prior: `graph-v109-validation-manifest.json`, SHA-256 `ee9bed6acd3fa28bdaeb5c5eca6dcd072fe55010106bae8eb3d92366903ab7c8`. v111 authorized source release: OS #67/#69/#70 and Commerce #12 merged at their approved heads. OS main is clean at `18b5798efaaebd333efaf0d02ffd6336adc5dd60`; eligible #67/#70 worktrees removed and branches retained; #69 successor preserved. Commerce source tree is exact, but its worktree and dirty canonical main are preserved under the approval exclusions. Runtime still reports four missing external inputs and zero enrolled issuers. Receipts: `v111-release-final-local-observation.json`, `v111-commerce-source-runtime-receipt.json`. Combined merged OS root `npm run check` passed 701/701 tests, evaluations and budgets in 170.568 seconds; canonical remained clean. Check receipt: `v111-os-integrated-check.json`. Prior: `graph-v112-validation-manifest.json`, SHA-256 `49d3b4edc434e9556bd6305c9a670118c45f8a06d11b2936f206531322876bff`. Prior: `graph-v113-validation-manifest.json`, SHA-256 `ea64ee012dd1e35cbb2630c66d7c3bd0f5b9ada5f14690eca3964d39790c2e92`. Prior: `graph-v114-validation-manifest.json`, SHA-256 `62bd13db89e1af0df3cd57d3fea2fde5e2e961ac414bd0667cd3ca4aaaf2e3cd`. Prior: `graph-v115-validation-manifest.json`, SHA-256 `3cf1b745b8d31c33241f710e96ed2df70ae33ac350dd81b6f043aec0f39f425b`. Prior: `graph-v116-validation-manifest.json`, SHA-256 `6efccf8aa8cd1c3be056da881b6b10768fbc05caa27e82b096988912b205664c`. Prior: `graph-v117-validation-manifest.json`, SHA-256 `aa3a7e985f8fa3d75d965edae212bc1c5d5e925e35bd8d8f5a4341c045ae86f8`. Prior: `graph-v118-validation-manifest.json`, SHA-256 `2d1c8267370b09ac2d9687afa287dc2fc62ec2f26af46fa4b9fa777eddad4dc9`. Prior: `graph-v121-validation-manifest.json`, SHA-256 `81188b5a926f4182f0828b34b5a38fd0ab21e8240496029ef2355e7ee6c894c6`. Prior: `graph-v122-validation-manifest.json`, SHA-256 `9d142796898c697911201dc38bf15f98658246f0fac4c6bee60226b01ae10617`. Prior: `graph-v123-validation-manifest.json`, SHA-256 `7c791fbca935e2b6b081fb4d826e0a493a1235ee8c19feaad3c8fa92d6e2af3e`. Prior: `graph-v124-validation-manifest.json`, SHA-256 `3a95123892a53f0ecac2bd91b4d5bf3f5bae8ecdd9f54ae48af75b4ae702ca55`. Prior: `graph-v125-validation-manifest.json`, SHA-256 `9eab49f229a926d28275e4506ec08460cb1f9696168eafca115dc4ebdbf22038`. Prior: `graph-v126-validation-manifest.json`, SHA-256 `b0a36be39811a0d22e0c97ebe739bd3d9e92e24021e9ee6b43d7cf4345f14e00`. Latest: `graph-v127-validation-manifest.json`, SHA-256 `b5d3bf3e055be0f5b94d508cdbf20da53477445a74b2280245f482e180c0f631`.

## Graph bounded dataflow reuse and validation — 2026-09-08 (v102)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,592 passed / 242 failed / 4,834 total; exit `1` |
| Duration | 210.282 seconds; not a comparative speed benchmark |
| Source | Admitted, uncommitted successor at HEAD `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469`; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `7818fc6eb5b81dca3048241c5f9b1b8d0bc69c658305c67e2ebadd629829d659` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned validation process |
| Exact comparison with v101 | 1 fixed; 0 regressed; 2 added passing cases; 0 omitted |
| Declared source check | Passed in 14.667 seconds |
| Independent standalone export | Passed in 9.690 seconds; four unchanged artifacts below 500 kB |

The v101 shared runner captures a monotonic clock for case, heartbeat and aggregate duration; wall-clock timestamps remain distinct. Its new regression reproduces a one-year elapsed jump under the old owner and passes after the fix without sleeps or nested runs. All 4,589 passing-case durations are nonnegative. Timeout scheduling is unchanged.

Cumulative v96–v100 changes coalesce storage writes against the current backend, retain real nested/large-graph history edits through bounded exact comparison, fence selection frames to their owning editor, and apply preset modes against current state. Recorded full results: v96 4,585/245; v98 4,585/245; v99 4,587/244; v100 4,588/243 (passed/failed). Focused results are never added to full totals.

The full suite remains failed. Source release and independent Commerce evidence remain unresolved. The v102 canonical runtime receipt (7.030 seconds) passes all three HTTP probes for the released Graph/Canvas pair, not this successor or Production. Missing published-document migration spans the native mirror generator, artifact manifest, upload and reconciliation; no test-only alias or live mirror edit was used.

The dataflow owner now keys complete bounded inputs, preserves observable ordering and rejects mutated results. A global 64-entry LRU uses weak output references and a 1,048,576 UTF-16-unit serialized payload budget; this is not an exact heap bound. Unsupported or oversized inputs bypass caching. Native checks pass 23/23, including retention, stale-input, output-mutation and ordering cases; forced-GC reuse release also passes. Swarm output propagation now tests its declared SVG image port.

Historical v101: 4,589/243/4,832 in 208.974 seconds; declared check 52.531 seconds; standalone 10.169 seconds. The final v102 comparison has no regressions or omissions. An earlier v102 full run had one obsolete fixture regression; an intermediate run was stopped after an ordering defect was reproduced. Both receipts remain archived.

### v102 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v102-final-full.json` | `65d394f57f728f19ac0a04a46501649bd028baa34a898f1b778b3a2abc8d7681` |
| `graph-v102-final-case-comparison.json` | `7603c7cc6892fcf65fa6292b56485712b55a2c9a7914a55019381d331cb013e2` |
| `graph-v102-final-declared-check.json` | `4abec1a9aa2a592eaa30b25032ad2d545f9d97ce079394b5edc91653fc3a2fce` |
| `graph-v102-final-standalone.json` | `46e9b5537baf54726bcb12c57e7cb5a03a56ec9be10b6e0955576050eacc33cd` |

### v101 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v101-full.json` | `29ed7e43021cc7dc1eb52029d1c36f56b4d9854b1d14f249cc508b6ddc05546a` |
| `graph-v101-case-comparison.json` | `a61b64138007a0b2a0386483c538bede8c2aa7cb40d66728666c778f3cfdd5e5` |
| `graph-v101-declared-check.json` | `1d925bc253574865571d078ecd0fe6a9947890b0e9360fd25c9d1532bfa46503` |
| `graph-v101-standalone.json` | `2d31929c959ec57e2ef2625bb2ab445f97a22525d3b339e093b6abf14950a53e` |
| `graph-v101-duration-audit.json` | `defa8138fd1dfb8ee0d98613be1bc3c1f015f33c70391f590fdb93f2ff507fcf` |

## Graph storage capture and constrained materialization — 2026-09-07 (v95)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,585 passed / 245 failed / 4,830 total |
| Aggregate exit | `1` — failed |
| Duration | 220.160 seconds; no repeatable whole-suite speedup established |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `0de0938cd4d608aac26bf31d994ad62b0ed72f2b102f7475b742a38797e96afa` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned validation process |
| Exact comparison with v92 | 3 fixed; 0 regressed; 0 added; 0 omitted |
| Declared source check | Passed in 14.174 seconds |
| Independent standalone export | Passed in 10.135 seconds; four unchanged artifacts below 500 kB |

Local and session storage accessors now observe the browser getter once per call. Shared startup readers retain their captured backend, while writes and later session access acquire the current backend. The behavior fixture verifies repeated reads, fresh writes, denied-access fallbacks and native numeric clamping; it first reproduced two getter observations. This introduces no global backend cache.

The materialization owner replaces quadratic pairwise candidate scoring with explicit width feasibility and avoids allocating the compact plan when wide stages fit. It shrinks from 560 to 520 lines. Tests cover undersized overflow without source/camera movement, feasible captured placement, wide topology and zoom projection. The capture fixture declares actual dimensions; its complete-visibility assertion uses a physically feasible viewport.

The toolbar reveals existing accepted branches and never changes graph content. Its unreachable write/history branch and both callers' unused callbacks were removed. Behavior checks preserve graph identity and bytes; source synchronization precedes graph projection, and completed workflow persistence retains its existing single-write owner. All 30 associated checks pass.

The full registry remains failed. The existing Canvas log worktree was reused through native successor admission; no extra checkout was created. Graph source release, exact log-candidate merge/cleanup authority and Commerce independent evaluator evidence remain separate. The v94 canonical local runtime pair passed three HTTP probes; that is not successor or Production readiness.

### v95 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v95-full.json` | `9f8dc317691e028e8928a3e606729aae8ea0a6942a307e497156dd895c22e00a` |
| `graph-v95-case-comparison.json` | `8cf5f18066601ae52849f75ac48f6b2c1067fda0a98bdccd5b886cc72c16c54c` |
| `graph-v95-declared-check.json` | `d4443f0042830cb773aa06ceeedc37032ca4565c98794921889a06ea3f93eb00` |
| `graph-v95-standalone.json` | `8e5d465783d3672c7bf72ac3e9782fa80ec114e1292c0d5cb71efc7b868c9daf` |

## Graph camera framing isolation and native XR prerequisites — 2026-09-07 (v92)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,582 passed / 248 failed / 4,830 total |
| Aggregate exit | `1` — failed |
| Duration | 235.933 seconds; no repeatable speedup established |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `1ea65926fd1a2d82f22272b5e0ee9e4aa4ca309f8e2b282ca1c2e5d8ee9b920b` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned validation process |
| Exact comparison with v87 | 2 fixed; 0 regressed; 0 added; 0 omitted |
| Declared source check | Passed in 55.516 seconds |
| Independent standalone export | Passed in 11.118 seconds; four unchanged artifacts below 500 kB |

Native camera-framing cleanup now releases the preceding fixture's claim and document identity, preserves live subscribers, and avoids revision/notification churn on repeated resets. The document reset still retains an operator claim for the same document. A producer/consumer pair changes from one pass/one failure to two passes; the affected camera/Physics/XR group passes all 18 cases.

The XR surface selection fixture now loads its existing FPS, Flight and City runtime declarations before exercising their activation. All original registration, activation and rollback assertions remain. The previous Flight fixture prerequisite also passes focused validation. The full-run fixes are XR surface selection and Physics document activation; focused results are not added to full totals.

The full suite remains failed. Canvas #900 completed its authorized source lifecycle. Its v90 local canonical runtime receipt passed all three HTTP probes; a later v91 refresh failed on GitHub transport, so no newer readiness is inferred. Graph successor release, Commerce independent evaluator evidence and Production deployment remain unresolved.

### v92 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v92-full.json` | `56486b27520462a9fae584557e4a60a646803ccbaf6d16c793a5585db1673bba` |
| `graph-v92-case-comparison.json` | `9612244b9d60c9e5f31e0316711fa7e5e4f06281324cb63108a471631e849af3` |
| `graph-v92-declared-check.json` | `6c086ce9172501a153485f46ddf85497804cc6201a83187c6c5043d5cce44050` |
| `graph-v92-standalone.json` | `89ea3c1a5e6ad167f0ec87631e192afc948e4c167166f26cfde57242d2ffa7ac` |

## Graph shared active-document test cleanup — 2026-09-07 (v87)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,580 passed / 250 failed / 4,830 total |
| Aggregate exit | `1` — failed |
| Duration | 218.623 seconds; no repeatable speedup established |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `9a83ddbab79280737d95ff6587d0fadc3a0065504914c8253bfe122e98705b4e` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v81 | 9 fixed; 0 regressed; 0 added; 0 omitted |
| Declared source checks | Passed in 57.990 seconds |
| Independent standalone export | Passed in 10.622 seconds; four unchanged artifacts below 500 kB |

The shared test cleanup now restores active markdown name, text, source URL and apply-view-preset state from initial store values. A failed document activation previously left stale source state that redirected later graph rendering. A six-case producer/consumer sequence confirms five layout failures disappear while the original producer failure remains visible. The broader 416-case group improves from 388/28 to 393/23 without changing layout implementation or assertions.

The full run also confirms two workspace fixture repairs: shared scheduler delegation keeps hydration-only behavior, and the local-mirror fixture verifies native discovery, cache-expiry refresh and Source Files propagation. All 84 workspace filesystem cases pass independently. Fit-request and workspace-auto-open cases also pass after cleanup repair.

The full registry remains failed. Graph release and Commerce independent runtime evidence remain unresolved. Canvas #899 was merged with authorized exact cleanup and clean-main fast-forward; that documentation release is not runtime deployment evidence.

### v87 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v87-full.json` | `0bcca197721aa6967618c032cc236f2d55bb92f8b5a05332c85a8882dd6bb408` |
| `graph-v87-case-comparison.json` | `649faf28793b1c418413b858c5a5444ed5928307c28e84e863709d4e1da3f2a7` |
| `graph-v87-declared-check.json` | `fbb1440268c518d3dc7cdf72e6478968f46cb8701a66dda0d9072f43a97850bd` |
| `graph-v87-standalone.json` | `1b8263bae162018521bedf2690c750323dbaea0839031af6b10742bf1df8143d` |

## Graph workspace initialization and validation isolation — 2026-09-07 (v81)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,571 passed / 259 failed / 4,830 total |
| Aggregate exit | `1` — failed |
| Duration | 222.927 seconds; a repeatable speedup is not established |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `125ffb7e8b9134734a0a024ba892c651c089b36b1bbf2a8a14b4f81c39a369b9` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v74 | 3 fixed; 0 regressed; 2 added and passing; 0 omitted |
| Declared source checks | Passed in 15.168 seconds |
| Independent standalone export | Passed in 10.115 seconds; four unchanged artifacts below 500 kB |

Workspace initialization now shares concurrent initialization and fences stale completion after reset. The fallback memory filesystem is created only after persisted initialization fails. Two new behavior cases cover concurrent reuse and reset races.

Fixed fixtures preserve import-artifact isolation, user deletion with the established protected XR exception, and separate local, published and seed-only document configurations. Published D1 fixtures declare row ownership and exercise the 501-file bound through six valid pages. The local XR bootstrap fixture explicitly models Vite development in Node and clears published caches; all seven XR cases pass independently in 5.594 seconds. This resolves the focused/full discrepancy without changing production fallback policy.

The full suite remains failed. Runtime deployment, Commerce independent evaluator trust and source-release approval remain separate requirements.

### v81 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v81-full.json` | `f81ef494ae77e60d8896c0925ef6ad1881705621063b82227f11aa17106d6724` |
| `graph-v81-case-comparison.json` | `fcef0cf3b3135b50f131eb4753d66f892a2fcb6262faff12d13776e6f4f6d6b3` |
| `graph-v81-declared-check.json` | `1fcfc806786728faa6940377263673fcb0ebae887bbd9923dcf9a3edeea44446` |
| `graph-v81-standalone.json` | `a25361a818f5f3140c28c4ce8eb95cd20be7d2a28fb2c17a5616ed8bfadd67ec` |

## Graph bounded fallback cache and incremental layout — 2026-09-07 (v74)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,566 passed / 262 failed / 4,828 total |
| Aggregate exit | `1` — failed |
| Duration | 241.351 seconds; no whole-registry speedup established |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `13bc8220f62ec5399cfab07e4546f51d0b5d8557fcf920542f4a4ba98e3c4206` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v70 | 6 fixed; 0 regressed; 2 added and passing; 0 omitted |
| Declared source checks | Passed in 16.689 seconds after final source correction |
| Independent standalone export | Passed in 11.136 seconds; four unchanged artifacts below 500 kB |

The Storyboard fallback now reuses the existing TTL/LRU owner with 32 entries and 60-second validity. Expiry is lazy on access or insertion; this is an entry-count bound, not an absolute byte bound for graph references. Source invalidation remains explicit. The generic cache also evicts an oldest `undefined` key correctly. Two new behavior cases cover capacity, recency, expiry, deletion and graph-reference reuse.

Graph initialization preserves stable partial cached or authored positions, seeds only missing nodes, and retains repair of extreme coordinates. The unchanged seeding algorithm moved into a 159-line helper; its initializer shrank from 634 to 484 lines. Four layout cases pass with coverage across sparse cache ratios and both force modes.

Tests now use explicit owning-package exports, including the shared chain-evidence contract and separate geospatial test entrypoints. Native tests passed 131/131, affected registry cases 22/22 and boundary checks 8/8. Nine chat-flow fixtures now use the migrated document tag while preserving their assertions and case identities; four prior failures are fixed. The other two fixed cases are partial-layout reuse and the repository import boundary.

The full suite remains failed. These checks do not establish Commerce evaluator, deployed payment or Production readiness. Pending exact source-release candidates retain their separate approval boundaries.

### v74 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v74-full.json` | `b8c041003317b8b71f3997ef462e95a17deec43c78e6e19fd35287f595151fcd` |
| `graph-v74-case-comparison.json` | `44300ad3f2cbab5cd8c5d33397a0081d78d57b20b2bc611029de5baf10f68f9b` |
| `graph-v74-declared-check.json` | `c09f8ac05d4998b1b4152e1e5d97537a4daca8da85a827b5268a779e281dc671` |
| `graph-v74-standalone.json` | `41a373a046164ea827490fecec2c01877aa5073da6137c97030c60b3c12a58ac` |

## Graph native compiler cache and fixture validation — 2026-09-07 (v70)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,558 passed / 268 failed / 4,826 total |
| Aggregate exit | `1` — failed |
| Duration | 241.309 seconds; no whole-suite speedup established |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `7c6584ba09948c067f3d9fdc3a6ed2f74c35bebef2f5afab374aa33c74bc1482` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v63 | 5 fixed; 0 regressed; 0 added; 0 omitted |
| Latest declared source check | Passed in 62.131 seconds after the final fixture edit |
| Independent standalone export | Passed in 13.160 seconds; four unchanged artifacts below 500 kB |

Canvas now enables its pinned TypeScript compiler's native incremental cache. On this machine, the complete declared check took 57.501 seconds without incremental compilation, 71.144 seconds on the first incremental run, and 6.093 seconds on an unchanged warm run. Later source edits took 17–62 seconds. The ignored per-worktree compiler metadata is approximately 1.65 MB; no test verdicts are cached. This does not establish a CI or whole-registry speedup.

The five repaired cases retain their registry identities and cover protected initialization deletion, stale initialization refresh, authoritative empty-document hydration, table overlays across 3D/XR/voxel modes, and seed alias synchronization. Alias coverage now occupies a focused module; its original module is below 600 lines. No remaining failure was waived.

Commerce's fresh diagnostic still rejects runtime setup: no enrolled issuer, missing external trust anchor, trusted Git binding and isolated executor, plus the retired lifecycle verifier. These are source migration and independent provisioning requirements. The diagnostic imported no executor and issued no attestation.

## Graph bounded import materialization — 2026-09-07 (v63)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,553 passed / 273 failed / 4,826 total |
| Aggregate exit | `1` — failed |
| Duration | 239.732 seconds; observation, not a controlled benchmark |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `6d8ea8e67eb6e33a8d592e719e402453ef149ecc0c88ba6cc99a3a07ad1f79f1` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v59 | 6 fixed; 0 regressed; 0 added; 0 omitted |
| Declared source checks | Passed in 61.172 seconds |
| Independent standalone export | Passed in 10.620 seconds; four unchanged artifacts, each below 500 kB |

Import materialization now admits requested paths, existing Source Files, and companion files registered with the imported URL. It avoids reading unrelated document text and preserves empty disabled documents. Explicit removals are published even when the surviving records are unchanged. The URL import primary-landing contract remains intact. Regression coverage retains its case ID in a focused source-owned module.

The six fixes also include the composed-document transition fixtures and export/overlay source checks from v60–v62. An intermediate v63 run had 4,551 passes and 275 failures, including two new contract regressions; that candidate was superseded. The final complete run above has no regressions against v59. This is source validation, not Production or independent Commerce evaluator evidence.

## Graph commerce efficiency — 2026-09-07 (v59)

| Field | Recorded evidence |
| --- | --- |
| Owner | `agentic-graph` |
| Full command | `npm test` from the source repository root |
| Completed registry | 4,547 passed / 279 failed / 4,826 total |
| Aggregate exit | `1` — failed |
| Duration | 233.392 seconds; observation, not a controlled benchmark |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source branch | `agent/huis-macbook-pro-3.local/commerce-request-efficiency-validation` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `f3c1409a8d9071a9220e2824c10f8d659f20c7d0f540cd1e67169d146290e15e` |
| Pinned Canvas docs | `b62ba844b8c68e3b542099ee90acdcf8a5ba9e64` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v58 | 8 fixed; 0 regressed; 0 added (0 failed); 0 omitted |
| Original regression cohort | 47 passed / 0 failed / 0 omitted |

The native test runner now composes up to 32 filters within 32 KiB, deduplicates them and rejects oversized input; previously only the first filter ran. Four composed-source cases isolate a suite stall caused by closing their browser before native surface transitions settled. The corrected group passes in under one second of case execution, without a full-registry retry. Test cleanup releases prior renderer, explorer, credential and toast state; workspace fixtures drain their native coordinator and use local snapshot inputs.

Mermaid error reporting now reuses the bounded visible-toast store (three entries) instead of retaining a second module-level error cache. A repeated error after dismissal must become visible again. Eight focused Mermaid cases pass. Source checking passes; these results do not establish production readiness or an ecosystem-wide speedup.

Fixed existing cases:

- `flow.widget.richMediaPanel.textMode.reusesMarkdownPreviewSsot` (occurrence 1)
- `sourceFiles.composed.boot.prefersEnabledReadmeFrontmatterPreset` (occurrence 1)
- `sourceFiles.composed.deleteLastEnabled.clearsGraphAndWidgets` (occurrence 1)
- `sourceFiles.composed.orderOnly.noPresetReplay` (occurrence 1)
- `storage.enhancement.conflict.sharedToastLog` (occurrence 1)
- `workspace.initializationSeed.materialization.preservesCanonicalGraphLanding` (occurrence 1)
- `workspaceFs.bootstrap.materialize.sharedSnapshotHelpersCentralizeReuseRules` (occurrence 1)
- `workspaceFs.bootstrap.materializesActiveWorkspaceEntryIntoParsedSourceFile` (occurrence 1)

### Result history

| Run | Passed | Failed | Total |
| --- | ---: | ---: | ---: |
| v49, preserved in Canvas PR #892 at `f664e09843afd1edbd665b199f5743f5c7a1fefc` | 4,511 | 303 | 4,814 |
| v55 | 4,532 | 293 | 4,825 |
| v56 | 4,533 | 292 | 4,825 |
| v57, preserved in Canvas PR #893 | 4,537 | 289 | 4,826 |
| v58, released through Canvas PR #894 | 4,539 | 287 | 4,826 |

### Applicable checks

| Check | Result | Command / scope |
| --- | --- | --- |
| Declared Canvas checks | Passed, 67.763 s | `npm --prefix canvas run check`; TypeScript and local browser-harness checks |
| Historical v58 FlowCanvas before | 48 passed / 4 failed, 24.798 s | `test:ci:unit -- flowCanvas.` |
| Historical v58 FlowCanvas after | 50 passed / 2 failed, 5.072 s | Same command, about 80% faster on this machine; two existing timeouts corrected |
| Payment ledger | 163 passed | First stage of the full `npm test` |
| v59 standalone export and browser | Passed, 10.111 s | `npm --prefix canvas run test:ci:standalone-export`; four artifacts valid and below 500 kB; source, docs and lane unchanged |
| Historical v54 browser / standalone | 4 passed / 4 passed | Original source identities retained; historical evidence only |

Whole-run success and production readiness remain unproven. Remaining registry failures, independent Commerce evaluator inputs and deployed payment evidence are unresolved. No failure was waived.

## Upstream validation time — agentic-os PR #66

The eleven-case malformed-body matrix measured **28.116 s before / 6.082 s after** (78% reduction on this machine). Nine cases reuse the production validator directly; two retain distinct CLI rejection boundaries. Valid publication, exact size/BOM and body-mutation CLI checks remain. This is not a full-suite or production speedup claim.

Full `npm run check`: **670 passed / 0 failed / 0 skipped**, plus evaluations, in **169.430 s**. Required CI `test` and `budgets` passed for `71abdccb3a2886a4dbc0943ad49b5d47efbad53b`. The source candidate remains separately unmerged; no new deployment or cleanup authority is inferred.

## Upstream reusable validation plan — agentic-os PR #67

The existing CLI, `/checks` and MCP discovery owner now plans 10 commands from 19 six-repository catalog entries. Exact npm chains retain authored order and hooks; covered commands can be omitted only after successful complete execution. Failed or filtered runs grant no inferred coverage. This is command-count reuse, not a measured ecosystem elapsed-time speedup.

Full upstream checks: 671/671 tests and evaluations passed in 181.608 seconds. Required CI passed at `07bf15291c46999f73a39e5e92b449058a74c844`; native handoff recovered. Exact source-release approval remains pending.

## Upstream bounded remote reads — agentic-os PR #69

Candidate `23edf927e837c415f8db5a2bf48cf927897013db` passed all 677 upstream tests plus evaluations and required CI. Full local checks took 176.035 seconds. Shared remote ref reads have a 15-second POSIX deadline, bounded output, and process-tree cleanup; partial output cannot establish success. Writes retain their existing behavior. The Windows path was not runtime tested on this Mac. This bounds an observed transport stall; it is not a measured whole-suite throughput improvement. Exact source release authority remains pending.

## Commerce independent evidence — provisioning readback

The committed baseline still has zero trusted dispatch issuers. Read-only GitHub metadata found zero repository environments, Actions variables and Actions secrets. No secret values were requested. The gate requires an evaluator-owned trust anchor, signer, default-deny isolated executor and exclusive artifact sink. Candidate-generated keys or signatures cannot establish that independent authority. Provisioning and a fresh signed evaluator run remain required; deployment and live payment proof remain unestablished.

### v70 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v70-full.json` | `167aadda9312d18a6bea8e95d02ec572a6e2316f3379d20864455ea7dc20552a` |
| `graph-v70-case-comparison.json` | `9659394b0a2f3dc461220ccfd21c244b3536fee6011a997251a10b909b115856` |
| `graph-v70-standalone.json` | `5725d28b84772e1e65c1d5df5dbb414a8f001c9c71bd27e9feb2f1c02da1dbbd` |
| `commerce-v70-readiness.json` | `4fb820b8f71658b23d794ce790eaebff22f2ad151c154a067f395d42e7b3d362` |

### Receipt fingerprints

Local receipt directory: `$CODEX_HOME/visualizations/2026/09/07/01a0794e-fdda-7310-9060-816b4837e059/`. Counts and case identities are self-contained here; exact machine observations and raw logs remain in the named receipts.

| Receipt | SHA-256 |
| --- | --- |
| `graph-v59-standalone.json` | `ef4cb59b4696fe02b89ede21bf763df8e05463aa79708ac4546d04990bea55cc` |
| `commerce-evaluator-provisioning-readback-v59.json` | `a9be191261d12bb5cf8d4fe8b37a3ea23f9b9e71a301895286b2e4e0442a7ddd` |
| `graph-v59-full.json` | `742a57b5fde9c4e6aeec2b00c0427a6797e54736f79908b690ac8d0b6e7e8d0e` |
| `graph-v59-source-freeze.json` | `6d8856299761c8cab4818d9bb0b8420cd7a123d233f1b0f4136ddffbee8a456c` |
| `graph-v59-case-comparison.json` | `edaf150d79a3e153016fca9c5567850a5bb2f9df56b2b01b0a0a49bc9122beb3` |
| `graph-v58-case-comparison.json` | `ea82e097bd9ee841e44f34da9f99dca7d945a759823ecab93ac6318ac10c0956` |
| `graph-v58-source-freeze.json` | `193eb20ffc7c820114d6fd3f0a0681497bd6592521c7d12d5aac7c15aaf44978` |
| `graph-v58-validation-manifest.json` | `042c9f834658540efbe119a1a0424dff1fccf4032d4dd3b4e9203eb991c441d3` |
| `validation-economy-release.json` | `c64b669c9dde88e218388d048eec72c7061f3be7c4f9894123e205b047c4a311` |
| `upstream-validation-plan-release.json` | `3dc29f4e853bdf1a7b0c30a301ff124ad31ed14fc7e8f41e39cf73e84bb8ab49` |

### Unresolved registry cases (223; complete v127)

| Case | Occurrences |
| --- | --- |
| `canvas.xrMode.sharedSurfaceOwnershipBoundaries` | 1 |
| `canvas.xrMode.motionReferencePackage` | 1 |
| `canvas.xrMode.animationRuntime` | 1 |
| `canvas.xrMode.sharedAssetControlRuntime` | 1 |
| `canvas.viewSelection.shared3dSurfaceModeOwner` | 1 |
| `canvas.viewport.mobileHeavyRuntimeIntent.sourceGate` | 1 |
| `richMedia.panel.storyboardCardSharedMediaSurface` | 1 |
| `markdown.frontmatterFlowGraph.fidelity.tokenEconomicsSemanticPortHandles` | 1 |
| `markdown.frontmatterFlowGraph.fidelity.tokenEconomicsRenderableWidgetHandles` | 1 |
| `markdown.frontmatterFlowGraph.fidelity.agenticGraphVideoDemo.directorBriefShots` | 1 |
| `markdown.frontmatterFlowGraph.fidelity.agenticGraphVideoDemo.16x9CompositionContract` | 1 |
| `importRenderPipeline.frontmatterFlow.agenticGraphVideoDemo.autoModes` | 1 |
| `importRenderPipeline.markdownGraphApply.rejectsStaleStrybldrSourceGraph` | 1 |
| `importRenderPipeline.markdownGraphApply.rejectsEmptyCachedStrybldrSourceGraph` | 1 |
| `ui.floatingPanel.geo.clickableWhenDisabledByState` | 1 |
| `modeLock.viewLock.rendererGuardsStayConsistent` | 1 |
| `viewport.d3.groups.zIndexOverrideKey` | 1 |
| `viewport.storyboardWidget.overlay.collision.convergesWithoutRetryChurn` | 1 |
| `viewport.d3.groups.altDrag.reusesSharedLookup` | 1 |
| `viewport.storyboardWidget.overlay.indexing.rebalancesOnGraphContentRevision` | 1 |
| `ui.flowCanvas.richMediaOverlay.resizePersistsVisualSize` | 1 |
| `ui.flowCanvas.richMediaOverlay.selectionChromeParity` | 1 |
| `ui.flowWidget.portHandles.outputDomOrderPrefersCenterLane` | 1 |
| `agentReady.localMainPanelChatCanvasPipeline.renderedMcpResearchAgentDemoSuperAgentStoryboardWidget` | 1 |
| `agentReady.localMainPanelChatCanvasPipeline.researchAgentDemoSuperAgentStoryboardWidget` | 1 |
| `vdeoxpln.contract.registryProjection` | 1 |
| `ui.mainPanel.integrationsHub.surfacesBytePlusModelArkMcpConfig` | 1 |
| `mcp.server.localToolContract.sharedAndStable` | 1 |
| `htmlVideoRenderer.sourceContracts.sharedOwners` | 1 |
| `videoAgent.demo.executableReplayContract` | 1 |
| `videoAgent.timeline.bottomPanelDenseFbfNoOverlap` | 1 |
| `richMedia.panel.iframeScrollResizeSourceContract` | 1 |
| `docs.agenticCanvasOsDemo.marketToArtifactPipeline` | 1 |
| `chat.providers.openaiServerManagedEnvFiles` | 1 |
| `ui.multiDimTable.structuredSource.presentationDefaults` | 1 |
| `ui.multiDimTable.structuredSource.visibleTable` | 1 |
| `ui.multiDimTable.structuredSource.strybldrValidationYamlFrontmatter` | 1 |
| `ui.multiDimTable.pivot.rowsColumns` | 1 |
| `ui.canvas.liveHero.physicsPlaygroundSourceFidelity` | 1 |
| `ui.canvas.liveHero.interactiveWorkspaceCanvas` | 1 |
| `ui.canvas.liveHero.canvasEmbedVisibleAction` | 1 |
| `canvas.xrV2.permissionsPolicy.staticAndIframe` | 1 |
| `ui.floatingPanelChat.apiKeyPrompt.selectedProviderRendered` | 1 |
| `ui.floatingPanelChat.videoPreset.loadsSourceBackedInvocation` | 1 |
| `ui.floatingPanelChat.videoPreset.failsClosedWithoutSource` | 1 |
| `ui.floatingPanelChat.videoPreset.defersHostArtifactUntilFinalization` | 1 |
| `ui.floatingPanelChat.contextRail.quickActions` | 1 |
| `ui.floatingPanelChat.composer.agenticGraphProbeTreeInvocationGrammar` | 1 |
| `ui.floatingPanelChat.storyboardTemplate.responseContract` | 1 |
| `ui.storyboard.fixedCardOverlay.flexInteractions` | 1 |
| `strybldr.markdown.storyboard2dTemplateRuntimeReadyNeutral` | 1 |
| `ui.flowWidget.storyboardCardTextLayout.readableChrome` | 1 |
| `strybldr.markdown.addedCardSyncPersistsAndRehydrates` | 1 |
| `strybldr.markdown.unownedCardEditDoesNotBackfillSource` | 1 |
| `strybldr.markdown.summaryEditSyncPersistsCardOverride` | 1 |
| `strybldr.markdown.fullGraphRichMediaTopology` | 1 |
| `city.sim.mcp.inspectPurity` | 1 |
| `policy.pagesHeaders.agenticGraphReportOnlyCsp.omitsIgnoredUpgradeDirective` | 1 |
| `policy.pagesHeaders.agenticGraphAppShellHtml.addsNoTransformForCloudflareJsd` | 1 |
| `policy.storage.deployScripts.seedDocsMirrorIntoD1` | 1 |
| `policy.storage.mainPanel.cloudflareMediaAssetSyncContract` | 1 |
| `policy.canvasDev5173.buildsLinkedPackagesBeforeVite` | 1 |
| `policy.docsSsotFixture.forbidHardcodedDeerFlowEndpointLiterals` | 1 |
| `policy.docsSsotFixture.hackamap.forbidHardcodedVolatileLiterals` | 1 |
| `policy.docsSsotFixture.hackamap.painpointDemoProduct.semanticMapping` | 1 |
| `ui.toolbar.touchScroll.staysSourceDriven` | 1 |
| `ui.groupGesture.dragSlop.centralized` | 1 |
| `ui.collapsedGroup.chevron.hitTargetAndDetailFallback` | 1 |
| `ui.groupResizeHandle.activeFeedbackAndInsetAnchor` | 1 |
| `ui.groupResizeHandle.visualPolish.activeOutlineAndLabelFeedback` | 1 |
| `ui.groupResizeHandle.nestedConflict.exclusiveActiveOwnership` | 1 |
| `ui.groupResizeHandle.transitions.sharedShapeAndLabel` | 1 |
| `ui.groupResizeHandle.transitions.chevronAndDot` | 1 |
| `baseline.storyboardWidget.frontmatterFlow.widgetAndTypedHandles` | 1 |
| `baseline.storyboardWidget.frontmatterFlow.upstreamVisualIsolationGuard` | 1 |
| `baseline.storyboardWidget.frontmatterFlow.overlayEdges.anchorThroughSharedOverlayRoots` | 1 |
| `baseline.storyboardWidget.frontmatterFlow.overlayEdges.persistAcrossWorkspaceToggleChurn` | 1 |
| `baseline.storyboardWidget.widget.byteplusLink.localFieldEdits` | 1 |
| `baseline.storyboardWidget.widget.output.textRunUsesSharedRichMediaPatch` | 1 |
| `baseline.storyboardWidget.widget.output.flowComputeRunsBeforeProvider` | 1 |
| `baseline.storyboardWidget.widget.output.workspaceArtifactPath` | 1 |
| `baseline.storyboardWidget.widget.output.durableArtifactDocumentContract` | 1 |
| `baseline.storyboardWidget.widget.output.runRefreshesOverlayEdges` | 1 |
| `maps.grabmaps.presetUsesPreferredStyleSetting` | 1 |
| `maps.grabmaps.workspaceSeeds.renderThroughYamlFrontmatterPipeline` | 1 |
| `baseline.storyboardWidget.widget.kvTable.portKeyValuePort` | 1 |
| `baseline.mainPanel.graphFields.widgetGallery.smartMediaPreset` | 1 |
| `runtimePersistence.syncKey.ssot.sharedAcrossSubscriptions` | 1 |
| `sourceFiles.parsedState.ownership.centralized` | 1 |
| `workspace.import.focus.avoidsDuplicateGraphApply` | 1 |
| `workspace.writeThroughAndActiveDocSync.ownership.centralized` | 1 |
| `sourceFiles.githubWrite.pagesRouteDryRunDoesNotCallGitHub` | 1 |
| `sourceFiles.bootstrap.storageInboundApply.skipsQueueEcho` | 1 |
| `workspace.markdownDocumentSetter.decouplesWorkspaceViewMode` | 1 |
| `ui.storyboardWidgetOverlayLayering.overlayMode.noBlankWithoutOverlays` | 1 |
| `ui.storyboardWidgetOverlayLayering.workspacePanesElevated` | 1 |
| `ui.workspaceView.update.storyboardWidgetCollectiveLayoutRefresh` | 1 |
| `layout.datasetKey.reusesSharedReaders` | 1 |
| `pipeline.2dRenderer.sharedSurfaceHelpers` | 1 |
| `chat.floatingPanel.sharedLookup.rootFix` | 1 |
| `selection.normalization.sharedHook.rootFix` | 1 |
| `frontmatterMode.effective.whenSeedsExist` | 1 |
| `chat.responseContract.storage.agenticOsDeterministicFallbackStructuredAndValid` | 1 |
| `chat.responseContract.storage.agenticOsHeadlessStrybldrResponseFirst` | 1 |
| `chat.responseContract.storage.agenticOsIdentityNormalizationScalars` | 1 |
| `chat.responseContract.storage.agenticOsRejectsLegacyDocsWorkspacePath` | 1 |
| `chat.responseContract.structuredContent.tablesPersistAsMarkdownBlockScalars` | 1 |
| `storyboardWidget.widget.toolbarVisibleWhenViewLockOn` | 1 |
| `parser.mermaid.typedDiagrams.neutralFlowTimelinePayload` | 1 |
| `ui.mermaidPanels.gitGraphGantt.sharedRouting` | 1 |
| `chat.responseContract.storage.agenticOsUniversalFlowDiagramsDynamicPanels` | 1 |
| `chat.responseContract.storage.agenticOsShapesCreativeScriptWithoutTrademarkCarryover` | 1 |
| `chat.responseContract.storage.agenticOsFallbackNeutralForGenericRequest` | 1 |
| `flow.widget.bundle.reusesSharedPlainObjectGuard` | 1 |
| `flow.widget.eligibility.reusesSharedReaders` | 1 |
| `ui.videoSequence.timelineBar.clickRequiresDragIntent` | 1 |
| `ui.videoSequence.timelineSurfaces.runtimeReady` | 1 |
| `workspace.import.localFiles.videoStackedSequenceDocument` | 1 |
| `ui.videoSequence.export.stability` | 1 |
| `floatingPanel.storyboardWidget.reusesSharedChrome` | 1 |
| `floatingPanel.formControls.sharedDensity` | 1 |
| `floatingPanel.formControls.chatModelCredentials.sharedStoryboardFlow` | 1 |
| `richMediaPanel.markdownPreview.disablesGlobalTokenStoreSync` | 1 |
| `searchPanel.selection.requestsSharedSelectionZoom` | 1 |
| `floatingPanel.media.storyboardCanvasNestedDropTargets` | 1 |
| `flow.widget.richMediaPanel.proxyAttrsAlignWithFlowWidget` | 1 |
| `flow.widget.richMediaPanel.dragHandlers.rendererScoped` | 1 |
| `storyboardWidget.integration.wheelPanInfiniteCanvasNoLayoutWrites` | 1 |
| `storyboardWidget.integration.dragZoomWorkspaceToggleCollectiveLayoutStable` | 1 |
| `markdownWorkspace.explorer.crudActions.createDelete` | 1 |
| `markdown.sourceFiles.panel.dnd` | 1 |
| `geospatial.host.overlayNotGatedBySidebar` | 1 |
| `geospatial.canvas.forbidGraphWhenGeoEnabled` | 1 |
| `geospatial.widgetPanels.defaultFloatingAndHideDots` | 1 |
| `geospatial.widgetPanels.pendingOpenResolvesRenderedGraph` | 1 |
| `geospatial.widgetPanels.discoveryNotCoordinateBound` | 1 |
| `geospatial.widgetPanels.overrideStalePinnedReuse` | 1 |
| `geospatial.floatingPanel.requestedGeoView.enablesGeospatial` | 1 |
| `geospatial.host.supportsMapLibreGlobeRenderer` | 1 |
| `geospatial.gympgrphMapLibre.fallbackOnUnsafeRuntimeError` | 1 |
| `geospatial.host.maplibreHealthy.noSvgOverlayInterference` | 1 |
| `geospatial.host.maplibreBlank.svgFallbackVisible` | 1 |
| `canvas.viewport.geospatial.poiPreview.noAutoPanelWriteback` | 1 |
| `toolbar.launchDropdownFallback.activatesFirstImportedWorkspaceFile` | 1 |
| `markdown.workspace.folderModeContract.opensDocs` | 1 |
| `markdown.workspace.switch.immediatelySyncsPlainDocument` | 1 |
| `docs.careAgentDemo.runtimeReady` | 1 |
| `docs.careAgentDemo.runReadyMode` | 1 |
| `docs.riskCopilotDemo.runtimeReady` | 1 |
| `docs.riskCopilotDemo.runReadyMode` | 1 |
| `markdown.htmlBlocks.rendersGridAndPreCode` | 1 |
| `markdown.preview.viewerMedia.defaultInlineChip` | 1 |
| `webpageSandbox.promotesLazyImageDataSrc` | 1 |
| `export.svg.3d.edgeRgba.alphaIsOpacity` | 1 |
| `export.svg.3d.shaderLine.opaqueEdges` | 1 |
| `export.svg.3d.nodeVisualOpacity` | 1 |
| `markdownPanelOverlay.worldScale.cardLayout` | 1 |
| `markdownPanelOverlay.viewportOrigin.clamp` | 1 |
| `markdownPanelOverlay.viewportOrigin.collectiveFit` | 1 |
| `markdownPanelOverlay.cardMarkdown.tableWidth` | 1 |
| `export.htmlWorkspace.viewerFallbackNoWarning` | 1 |
| `ui.tokens.ssot.indexCssDefinesAll` | 1 |
| `researchAgent.demo.ingestParseRender` | 1 |
| `ui.agenticOs.dictionary.consumerMetadata` | 1 |
| `ui.floatingPanelScrollBodies.sharedResponsiveOwner` | 1 |
| `ui.mainPanel.ktvRows.sharedEditableValueCell` | 1 |
| `semanticHtml.repo.forbidsGenericDivisionMarkup` | 1 |
| `ui.mainPanel.helpIconLibrary.sharedSsot` | 1 |
| `design.editor.importUrl.activatesSurface` | 1 |
| `routing.pagesShareRouteFallback.publishedDocRoutesFunctionOwned` | 1 |
| `ui.inlineCardEditor.attachedMedia.staysOutOfTextareaEditValue` | 1 |
| `docs.guidelines.forbidAbsoluteRepoPathHardcodes` | 1 |
| `docs.e2eVideoFixtures.useTypedFrontmatterWrappers` | 1 |
| `docs.storyboardDemo.usesTypedFrontmatterWrappers` | 1 |
| `docs.canonicalAnimaticAndStoryboard.usePlainYamlFrontmatter` | 1 |
| `docs.guidelines.describeCanonicalAndNormalizedFrontmatterContracts` | 1 |
| `docs.storyboardWidget.publishedDocsMachineSsot` | 1 |
| `canvas.storyboard.nativeSourceContract` | 1 |
| `canvas.storyboard.toolbarProps.buildSharedToolbarConfig` | 1 |
| `canvas.storyboard.mediaDrop.actualReleasePoint` | 1 |
| `canvas.mediaInventory.audioSharedRenderOwners` | 1 |
| `overlay.widget.storyboardWidgetFrontmatterManualPlacementAuthority` | 1 |
| `layout.graphElementCentroid.2dRendererOwnersReuseSharedUtils` | 1 |
| `workspace.import.localFiles.svgFidelity` | 1 |
| `workspace.import.localFiles.activateImportedDocFrontmatterLanding` | 1 |
| `workspace.import.localFiles.videoDemo.runtimeRendererIsolation` | 1 |
| `workspace.import.localFiles.videoDemo.runtimeRendererIsolation.flowchart` | 1 |
| `workspace.import.localFiles.videoDemo.runtimeRendererIsolation.flow` | 1 |
| `workspace.import.localFiles.videoDemo.runtimeWidgetVisibility` | 1 |
| `workspace.sourceFiles.videoDemo.runtimeCollectiveBalancedFit.1920x1080` | 1 |
| `workspace.sourceFiles.videoDemo.screenAuthorityProjectsZoomLayout` | 1 |
| `workspace.sourceFiles.videoDemo.screenAuthorityDragPinUnpinStable` | 1 |
| `workspace.sourceFiles.videoDemo.runtimeOpenCloseReopen.inView.1920x1080` | 1 |
| `workspace.sourceFiles.videoDemo.runtimeInitialWorkspaceOpen.inView.1920x1080` | 1 |
| `graph.data.frontmatterFlow.openWidgetIdsStayRegistryScoped` | 1 |
| `ui.collapsibleDefaultsCompactAndAnchoredToLsKeys` | 1 |
| `ui.graphCanvasRoot.overlays.hideSet.prefersPlanned` | 1 |
| `ui.toolbar.launch.newMarkdown.sharedDocsCreator` | 1 |
| `store.composedPositionWriteback.manualOnly` | 1 |
| `ui.overlay.drag.cursorTracking.noSnapDuringMove.flow` | 1 |
| `ui.overlay.drag.cursorTracking.noSnapDuringMove.design` | 1 |
| `ui.overlay.pan.cursorTracking.ignoresSpeedMultipliers` | 1 |
| `ui.toolMenu.drag.usesSharedPointerDrag` | 1 |
| `ui.floatingPanel.defaultGeometry.commandPanelAligned` | 1 |
| `ui.mainPanel.drag.noChurn` | 1 |
| `ui.lazyLoading.gates.heavyFeatureSurfaces` | 1 |
| `d3.labels.strictCollisionWiring` | 1 |
| `flowAndDesign.budgetedCollisionRelaxWiring` | 1 |
| `chat.responseContract.docs.agenticOsPromptContractCanonical` | 1 |
| `queryableCorpus.mediaImport.metadataSourceUnit` | 1 |
| `strybldr.markdown.consolidatedDemoRoutesPanelsAndStoryboardRenderers` | 1 |
| `strybldr.markdown.starterTemplateRunnableNeutral` | 1 |
| `strybldr.markdown.workflowGanttSyncsWithStoryboardCards` | 1 |
| `strybldr.card.fieldCommitPersistsWithoutFloatingPanel` | 1 |
| `xr.spatialCaptureFallback.readiness` | 1 |
| `xr.spatialCaptureFallback.runtimeReady` | 1 |
| `strybldr.markdown.workspaceStructuredGraphFeedsStoryboardRenderers` | 1 |
| `strybldr.markdown.appendElementPersistsToStructuredPayload` | 1 |
| `strybldr.markdown.removeElementPersistsToStructuredPayload` | 1 |
| `strybldr.markdown.workflowEdgeSyncPersistsStructuredPayload` | 1 |
| `strybldr.videoHandoff.byteplusFallbackArtifact` | 1 |
| `strybldr.videoHandoff.generatedUpdatesStoryboardOutputMedia` | 1 |
| `strybldr.videoHandoff.consolidatedDemoLocalAnimatic` | 1 |
