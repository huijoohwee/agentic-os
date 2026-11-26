---
schema: agentic-os/design-system-ownership/v1
doc_type: contract
title: Shared ownership of reusable components
version: 1.0.0
owner: agentic-os
design_system_owner: agentic-design-system
load_policy: on-demand
lifecycle_status: active
---

# Shared ownership of reusable components

This contract applies to `agentic-design-system`, `agentic-base`, `agentic-graph`,
`agentic-commerce-os`, `agentic-canvas-os`, `agentic-sheets`, `agentic-geo`, and related
consumers. It defines one source of truth for centrally reusable UI components and
controls, including shared tokens, themes, icons, interaction meaning, implementation,
and presentation. The
panel-specific contract below extends this ownership model with MainPanel, FloatingPanel,
BottomPanel, and their controls.

## Ownership

| Owner | Owns | Consumer boundary |
|---|---|---|
| `agentic-design-system` | Canonical design tokens and theme values; the semantic control map and accessible labels; icon glyphs; shared surface visuals, state visuals, and placement defaults; native and React adapter implementations and canonical package exports; shared control and panel lifecycle mechanics; and projection, pin, and build validation. | Publishes versioned source and projections. A behavior or appearance change is made here first and released at an exact revision. |
| Product/UI consumers, including `agentic-base`, `agentic-graph`, `agentic-commerce-os`, `agentic-canvas-os`, and `agentic-sheets` | Product content, feature availability, product-owned view state, and action callbacks. | Pass approved semantic roles and callbacks to the pinned Design System adapter. They do not copy shared implementations or introduce visual overrides. |
| Headless libraries, including `agentic-geo` | Domain algorithms and data contracts without a page or renderer. | Keep the core free of DOM globals and Design System runtime dependencies. Any UI consumer owns visible page targets and the shared rendered-page assertion. |

`agentic-base` is a product consumer, like Graph, Commerce, and Canvas. The supported
native and React integration APIs, including their canonical public entry points, belong
to `agentic-design-system`; consumers import these APIs directly from the exact pinned
package. A clean cutover removes Base-owned adapter entry points instead of preserving a
forwarding or re-export layer. Base does not own framework integration rules, lifecycle
mechanics, semantic mappings, or visual rules.

The shared UI dependency graph has `agentic-design-system` as the direct upstream for
`agentic-base`, `agentic-graph`, `agentic-commerce-os`, `agentic-canvas-os`, and
`agentic-sheets` when it consumes shared UI exports. These
product repositories consume the same exact Design System release as peers; shared panel
or control ownership does not pass through another product repository.

This ownership is exclusive even when migration work has left an implementation in a
consumer repository. Such code is migration residue: it is not a second source of truth,
must not gain new shared behavior, and must converge on the released Design System API.
The Design System depends only on its own contracts and platform primitives; consumers
depend on its versioned exports, so ownership does not create a reverse dependency or
cross-repository implementation fork.

## Semantic control map

The shared semantic control map is broader than panel actions. It covers reusable
controls across panels, toolbars, navigation, view selection, and mode selection. Each
shared role defines its stable semantic identifier, icon glyph, accessible name, visible
label where applicable, supported state, and interaction contract. Panel actions such as
Search, Pin, Apply, Reset, Minimize, Restore, and Close are one namespace within that map.

Consumers provide feature-specific content and callbacks. They may omit an inapplicable
role or select among approved roles; they do not substitute a local glyph, accessible
name, state rule, or interaction for the same semantic action. Product-specific wording
and controls belong to the product when they do not claim a shared role.

## Annotation targets

`agentic-design-system` owns the `data-selection-target` marker format, its selector,
and the shared `assertAnnotationTargets(document)` audit. Each product owns the semantic
elements and unique, stable marker values on its page. The existing
`data-agentic-annotation-target="true"` state controls a shared visual outline; it does
not register a selectable target. Mark only a visible native control or semantic landmark
that a person or browser selection tool can identify. Targets need a non-empty accessible
name, visible bounds, and at least one unobstructed `elementFromPoint` hit. Hidden, inert,
`aria-hidden`, `pointer-events:none`, generic `div`/`span`, and presentation-role targets
fail the contract. Use semantic links or buttons for actions and semantic landmarks for
content regions.

Consumers must not add an alternate marker attribute, selector, audit, release assertion,
or visual override. Each product that ships a browser page calls the shared assertion from
its rendered-page release check and requires at least one target on surfaces expected to
support annotation. Import it from the exact pinned Design System release; do not copy the
implementation into consumer repositories. The assertion is self-contained so browser
automation can run the same function in page context. It verifies DOM exposure and
hit-testing; it does not promise behavior of a particular browser's annotation overlay.
Until a consumer's exact Design System pin contains this export, source markers alone do
not satisfy the rendered-page release check. Headless libraries such as `agentic-geo` add
no DOM, renderer, or Design System runtime dependency; their UI consumers own page targets
and the shared assertion.

## Shared implementations

`agentic-design-system` owns the source implementations and supported integration APIs
for native and React adapters, including shared markup, keyboard behavior, control
lifecycle, panel minimize/restore, pinning, closing, and state synchronization. Framework
adapters remain thin bindings to consumer callbacks and product state. Consumers import
the pinned Design System implementation directly; Base does not maintain a parallel or
forwarding adapter entry point.

At this contract's current revision, the Design System owns the canonical token profiles,
icon registry, toolbar CSS, and panel CSS. Product consumers may still contain adapter
implementations awaiting migration; these are migration gaps, not alternate owners. New
shared behavior belongs in Design System source. Each consumer migrates its imports and
product bindings to the released adapter, then removes its duplicate implementation and
entry points. Consumers must not add another adapter while that migration is pending.

The Design System also owns the shared panel shell and toolbar visuals: token values,
theme propagation, dimensions, borders, shadows, icon and text alignment, state styling,
responsive placement, and minimized presentation. MainPanel, FloatingPanel, BottomPanel,
and toolbar controls use that one contract in light and dark themes.

## Pins and projections

The Design System source repository owns canonical tokens, themes, semantic maps, icon
glyphs, adapter implementations, and generators. Consumer artifacts are projections of
an exact released source revision. Projection and build checks compare bytes, semantic
identifiers, and declared revisions with that source. A consumer does not patch a
generated projection to change shared behavior; it updates its pin after the Design
System release contains the change.

## Navigation shared by multiple routes

A product owns one toolbar template or component for its shared destinations and one application
base stylesheet. Each participating route imports those owners. Bind the active destination
with `aria-current="page"`. Page styles may describe product content. Design System owns toolbar
presentation, the FloatingPanel shell and the Skills & Commands controls. Import its pinned
toolbar or panel stylesheet directly or seal a byte-identical offline projection.

Run `node scripts/check-shared-toolbar.mjs WORKSPACE` against the seven sibling checkouts before
integrating shared navigation changes. A `repo=checkout` argument selects a candidate worktree.
The command reads committed Git objects and reports their revisions. It checks the Design System
exports, Base, Sheets and Commerce projections, Graph entry points, the Trading desk and the
shared page template for the journal and OpenAPI coverage. A missing
checkout, duplicate route shell, conflicting import or changed projection fails the check.
Use the product's browser tests to verify navigation, active state, focus, narrow views and offline use.

Run `node scripts/check-design-conformance.mjs WORKSPACE` for the fleet token gate. It reads
`catalog/design-consumer-matrix.json`, verifies each active consumer's shared-ui pin against
authentic owner bytes, and enforces one alignment policy: a unified Design System release, or a
registered value-equivalent skew whose delivered projection bytes equal the target and which converges
at the next Design System release. It also proves Graph derives the central intent palette (no local
re-authoring), Canvas consumes verified Graph output with its legacy stylesheet inactive, and no
consumer redeclares centrally owned shared-ui variables. `--self-check` validates the matrix without
sibling checkouts. Different registry revisions alone are not a conflict; delivered value drift is.

## Conformance

Every affected repository must reject duplicate or conflicting semantic maps, adapter
implementations, panel shells, icon glyphs, local token definitions, and shared-state
overrides. Conformance covers shared controls and all three panel placements, including
light and dark themes, selected and hovered tabs, keyboard focus, disabled state,
minimize/restore, and stable size and placement when other panels open.

Live verification records the repository revision, route, viewport, theme, and panel
states observed. Source checks and browser observations prove only their respective
source or local UI state; neither implies release, merge, or production activation.
Free and offline use remains the default, with no paid design or component service.
