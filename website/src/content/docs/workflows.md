---
title: Workflows
description: Monitoring and alerting rules — the visual graph editor, live testing, escalations, and the Diagnose panel.
---

Workflows (rules) watch your resources and act when conditions are met. You create them in the **visual graph editor**: open **⚙️ Workflows** in the top bar and click **+ New workflow**, then wire nodes together — condition nodes (thresholds, states), AND/OR groups, and action nodes.

The graph handles everything from a one-condition alert to multi-step workflows: chained state changes, cross-resource references, and **escalations** (act now, then escalate after a delay if still unresolved). Rules that span multiple resources or whole [groups](/docs/groups-and-custom-monitors) are presented as **decrees** issued from the town hall.

Creating or editing workflows requires **Builder** mode; listing and diagnostics are always available.

## Test before you save

In the graph editor, click **Test** at any time — even before saving — to evaluate the drawn rule against your infrastructure's *current* state. The result is painted onto the graph:

- each condition shows the live value it read and a true/false verdict;
- AND/OR nodes show theirs;
- the paths that are currently true light up;
- each action shows whether it **would run**;
- conditions with a `for X minutes` window tell you when they are *"true now, but not held for the duration yet"*.

The overlay clears as soon as you edit the graph; test again whenever you like. Use the searchable picker to find a monitor or group quickly, and the **×** on a node to remove it.

## What every rule supports

- **Conditions** — thresholds on CPU/memory/disk/network and on monitor state, with `for X minutes` time windows, combined with AND/OR.
- **Actions** — notify a [channel](/docs/notification-channels), change a [synthetic monitor's](/docs/groups-and-custom-monitors#custom-monitored-buildings) state, or escalate after a delay. A state-changing action can tick **revert when condition recovers**: the moment the workflow stops matching, the target is automatically restored to the exact state (and message) it had before the action overwrote it.
- **Cooldown** — avoids repeat spam while a problem persists, but always fires on a real change (e.g. recovery).
- **Dry-run** — test a rule against current state: from the editor's **Test** button while authoring, or from Diagnose once saved.
- **Versions** — the last few edits are kept so you can roll back.

## The Workflows manager

All of an organisation's rules are managed from the same **⚙️ Workflows** button. Each workflow shows whether it's enabled and when it last fired, with:

- **Diagnose** — answers *"why isn't it firing?"*: a live trace of every condition (expected vs. actual value, per-branch verdicts), the state of the monitors and groups it references, the health of its notification channels, cooldown status, recent activity, a dry-run button, and version history with one-click restore.
- **Edit** — opens the graph editor.
- **Clone** — duplicates a workflow as a starting point. The copy is created **disabled** so it can't double-fire; review it, then enable.
- **Enable / Disable / Delete.**
