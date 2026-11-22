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

# Panel conformance under shared ownership

This panel-specific contract extends
[`DESIGN-SYSTEM-OWNERSHIP.md`](DESIGN-SYSTEM-OWNERSHIP.md) for `agentic-design-system`,
`agentic-base`, `agentic-graph`, `agentic-commerce-os`, `agentic-canvas-os`, and related
consumers. It defines the shared panel roles and conformance details.

## Ownership

| Owner | Owns | Consumer boundary |
|---|---|---|
| `agentic-design-system` | Canonical panel tokens and themes, semantic roles, icon glyphs, accessible labels, surface visuals, hover/focus/disabled/selected states, placement defaults, native and React adapters, panel lifecycle mechanics, and projection/build validation. | Owns the source and versioned projections. Changes ship from an exact Design System revision. |
| Product consumers, including `agentic-base`, `agentic-graph`, `agentic-commerce-os`, and `agentic-canvas-os` | Panel content, product view state, feature availability, and action callbacks. | Import and use the pinned Design System implementation directly. They do not add forwarding adapter layers, local panel shells, control glyphs, labels, tokens, state rules, adapters, or visual overrides. |

`agentic-base` is a consumer, not a shared adapter owner. A clean cutover removes its
consumer-owned panel adapter imports and implementations; product consumers import the
versioned Design System API directly.

A product-specific interaction that uses a shared role must first be added to the Design
System contract and projected in its adapter. A local fallback, copied map, or CSS
override is not a valid compatibility path.

## Semantic panel controls

`site/icons.json` is the sole role map for panel actions within the broader Design System
semantic control map: `search`, `pin`, `apply`, `reset`, `minimize`, `restore`, and
`close`. Canonical glyphs and neutral accessible labels are defined only in that owner map
and its shared contract; this guide does not restate role-to-glyph or role-to-label pairs.
Panel `restore` uses the maximize icon, while history restoration is a distinct action that
is never mapped to the panel `restore` role.
Consumers bind actions and pressed/disabled state to these roles through the shared
Design System adapter. A role may be omitted when it is inapplicable to a panel; the role
definition and its visual treatment are still singular.

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
3. Keep panel-specific availability and callbacks in the consumer while the Design
   System adapter owns rendering, lifecycle, accessible names, and state visuals. Reject
   a second panel shell or conflicting token/profile definition in conformance checks.
4. Verify MainPanel, FloatingPanel, and BottomPanel at mobile and desktop widths in
   light and dark themes. Check hover, keyboard focus, disabled state, minimize/restore
   cycles, and that the active title and actions remain visible without overlapping or
   changing glyphs.

A passing source test establishes only the checked source contract. Live browser results
must name the repository revision, app route, viewport, theme, and panel states observed;
they do not imply release or deployment. Free and offline use remains the default; do not
add paid icon, theme, or component services.
