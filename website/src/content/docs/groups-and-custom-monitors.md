---
title: Groups & custom monitors
description: Watch whole subsystems with rolled-up groups, and place synthetic buildings driven entirely by your rules.
---

## Groups

Group related monitors — manually, or automatically by name pattern, kind, or tags. A group shows a rolled-up state: the worst state among its members. That lets you:

- watch a whole subsystem at a glance, and
- write [workflows](/docs/workflows) against the group rather than against each resource.

## Custom monitored buildings

Beyond apps and add-ons you can place **custom monitors** — buildings that aren't backed by a Clever Cloud resource but whose state is driven entirely by your rules. Typical uses: a *"Queue depth"* marker, an *"SLA"* building.

From the builder's **Custom monitors** panel:

1. Create one (name + building type). It appears as a building on your map.
2. Target it in workflows with the *Set monitor state* action, and condition on it like any other monitor.
3. Set its default state (ok / warning / critical / unknown) directly from its inspector if you need a baseline.

Deleting the building removes the monitor.
