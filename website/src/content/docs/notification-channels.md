---
title: Notification channels
description: Route alerts to email, Slack, Discord or any webhook, and watch each channel's delivery health.
---

Set up where alerts go from the **🔔 Channels** button in the top bar:

- **Email** (SMTP) — one or more recipients.
- **Slack** — an incoming webhook URL.
- **Discord** — a webhook URL.
- **Generic webhook** — POST/PUT to any URL, with optional custom headers.

Each [workflow's](/docs/workflows) *notify* action picks a channel.

## Channel health

Channels track their recent success/failure so you can spot a misconfigured destination — a channel that keeps failing shows it right in the list.
