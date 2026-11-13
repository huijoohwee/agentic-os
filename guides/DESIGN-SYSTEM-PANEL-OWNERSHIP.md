---
schema: agentic-os/shared-ui-ownership/v1
doc_type: PRD-TAD-ADR-MVP-GTM
title: Shared panel and control ownership
version: 1.0.0
owner: agentic-os
design_system_owner: agentic-design-system
load_policy: on-demand
lifecycle_status: active
---

# Shared panel and control ownership

This contract applies to `agentic-design-system`, `agentic-base`, `agentic-graph`,
`agentic-commerce-os`, `agentic-canvas-os`, and related consumers. Its purpose is one
maintained source for panel visuals and semantics across products.

## Ownership

| Owner | Owns | Consumer boundary |
|---|---|---|
| `agentic-design-system` | Canonical design tokens, theme values, icon glyphs, semantic panel-control map, accessibility labels, panel surface visuals, hover/focus/disabled states, and placement defaults. `site/icons.json`, `site/toolbar.css`, and `site/floating-panel.css` are the source artifacts. | Versioned source for projections; changes update the Design System release and its consumer pins. |
| `agentic-base` | React and native adapters, panel lifecycle mechanics, and projection/build validation. | Adapts the canonical profile without redefining role-to-icon/label mappings or styling values. |
| Product consumers | Panel content, view state, feature availability, and action callbacks. | Use the pinned Base/Design System adapter. They do not add local panel shells, control glyphs, labels, tokens, or visual overrides. |

A product-specific interaction must first be added to the Design System contract and
projected through Base. A local fallback, copied map, or CSS override is not a valid
compatibility path.

## Semantic panel controls

`site/icons.json` is the sole role map for `search`, `pin`, `apply`, `reset`, `minimize`,
`restore`, and `close`. Its canonical glyphs and neutral accessible labels are Search,
Pin, Check/Apply, RotateCcw/Reset, Minimize2/Minimize, History/Restore, and X/Close.
Consumers bind actions and pressed/disabled state to these roles through the shared
adapter. A role may be omitted when it is inapplicable to a panel; the role definition
and its visual treatment are still singular.

MainPanel, FloatingPanel, and BottomPanel share one visual profile and responsive
placement rules. Their content and supported lifecycle actions may differ. Minimized
panels retain a readable active-view title and the shared pin, restore, and close actions;
expanded panels restore the normal view tabs and applicable actions. The application
theme must reach every panel through the same tokens, including nested and bottom panels.

## Required conformance

Each owner change that affects this contract must:

1. Pin the exact Design System revision and verify the generated icon, token, toolbar,
   and panel projections against their source digests.
2. Use the shared semantic control adapter for Search, Pin, Apply, Reset, Minimize,
   Restore, and Close. Product source must not map these roles to local icons, SVGs, or
   labels, or override their shared hover, focus, disabled, size, color, surface, or
   placement rules.
3. Keep panel-specific availability and callbacks in the consumer while the shared
   adapter owns rendering, accessible names, and state visuals. Reject a second panel
   shell or conflicting token/profile definition in the consumer's conformance checks.
4. Verify MainPanel, FloatingPanel, and BottomPanel at mobile and desktop widths in
   light and dark themes. Check hover, keyboard focus, disabled state, minimize/restore
   cycles, and that the active title and actions remain visible without overlapping or
   changing glyphs.

A passing source test establishes only the checked source contract. Live browser results
must name the repository revision, app route, viewport, theme, and panel states observed;
they do not imply release or deployment. Free and offline use remains the default; do not
add paid icon, theme, or component services.
