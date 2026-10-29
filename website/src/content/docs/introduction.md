---
title: Introduction
description: What myprettycloud is, how to sign in, and a few things worth knowing before you start.
---

myprettycloud turns your Clever Cloud infrastructure into a living medieval city. Every application and add-on is a building. Its status and live metrics drive how it looks and moves; problems show up as events in the streets — smoke, fires, the toll of a bell.

It is also a full monitoring product underneath: click a building for metric dashboards, and arm [workflows](/docs/workflows) that watch thresholds and notify [your channels](/docs/notification-channels) when something drifts.

> New here? The [tutorial](/tutorial) walks you from sign-in to your first live alert in about ten minutes.

## Signing in

1. Open [the app](https://myprettycloud-frontend.cleverapps.io). You'll land on the sign-in screen.
2. Click **Sign in with Clever Cloud**. You're redirected to Clever Cloud to authorize access, then back to your city.
3. The app only ever uses your Clever Cloud account — there is no separate password. Your access tokens are stored encrypted.

Pick your **organisation** from the selector in the top-right. Each organisation has its own city map, and everything else — metrics, workflows, settings — is scoped to the org you're looking at.

## Good to know

- Keep the org selector pointed at the organisation you're actively watching — the live stream follows it.
- Status updates arrive in real time: sub-second once the [Clever Cloud webhook](/docs/mcp-and-integrations#real-time-webhooks) is installed, otherwise within a few seconds via polling.
- If buildings ever look stuck on an old state, a quick page refresh re-syncs from the latest known status.
- For incident triage, use a short metrics time-range with live mode; for trends, use a long one. See [inspecting buildings](/docs/inspecting-buildings).
