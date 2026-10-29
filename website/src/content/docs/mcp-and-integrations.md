---
title: MCP & webhooks
description: Let an AI assistant manage your monitors over MCP, and install the Clever Cloud webhook for sub-second updates.
---

Both integrations live in **Settings** and the top bar.

## MCP access

Enable the **Model Context Protocol** and generate a Bearer token to let an AI assistant (e.g. Claude) read your monitors and author [workflows](/docs/workflows) on your behalf.

- The token is shown **once** at creation; store it safely.
- You can revoke and regenerate it anytime.

## Real-time webhooks

The top bar shows a **Hook up / Re-install** button, with a *"Required"* badge until done. One click installs the Clever Cloud webhook for the current organisation so the city reacts to deployments and lifecycle events in real time — sub-second — instead of waiting on polling.

Without the webhook the city still updates, just on a slower poll. The button becomes **Re-install** once active.
