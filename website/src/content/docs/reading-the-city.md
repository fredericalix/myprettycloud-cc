---
title: Reading the city
description: How building colours, animation speed, traffic, crates and ambient life map to the live state of your infrastructure.
---

The city is a dashboard you can read at a glance. Each visual element maps to one metric or state — nothing is decorative noise.

## Buildings and status colours

**Buildings** are your apps and add-ons. You place and arrange them on the hex grid in [builder mode](/docs/building-your-city); each is bound to one Clever Cloud resource and coloured by its live status:

| Colour | Meaning |
| --- | --- |
| Green | Running / healthy |
| Blue | Deploying — a wooden scaffold appears during the build |
| Red | Failed or stopped — a fire and black smoke |
| Amber | Warning |
| Grey | Created but never deployed |

## Movement = CPU load

Windmills, water-wheels and other animated parts spin faster as the resource's CPU climbs. A calm mill is an idle service; a mill ripping at full speed is a hot one.

## Traffic = network activity

Horse-drawn carts and riders (or small trucks and shuttles in the space theme) travel between your buildings. Every trip starts at a building's doorstep and ends at another's — vehicles never appear or vanish in open country, and shuttles take off from and land on the buildings they serve (a map needs at least two buildings to see traffic). The more network traffic your apps handle, the busier the roads — and deliveries converge on the buildings doing the work. Vehicles follow your roads, bridges (or tunnels) when you've built them, and find their way across open ground otherwise; they never drive through buildings or scenery.

## Crates = memory, depot = disk

As a building's RAM fills, barrels and crates (cargo containers in space) pile up at its door — at 90 %+ it visibly overflows. A separate resource depot beside the building grows with disk usage. One glance tells you who is full without opening a dashboard.

## Ambient life

Chimney smoke, blacksmith sparks, mine dust and watchtower lights give each building type its own character. A **day/night cycle** lights the city's lanterns after dark, with fireflies.

## Alerts as events

When a [workflow](/docs/workflows) fires critical, the affected building catches fire and a bell tolls; warnings raise amber smoke. A matching toast appears bottom-right, and [the mayor](/docs/the-mayor) summarises what needs attention.

Status updates arrive in real time — sub-second when the [Clever Cloud webhook](/docs/mcp-and-integrations#real-time-webhooks) is installed, otherwise within a few seconds via polling.

## The version badge

A discreet version number sits in the bottom-right corner of the city. Toggle it with the **🏷️ Version** button in the top bar, and click it to open the [release notes](/releases) — what changed in each version.
