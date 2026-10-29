# myprettycloud — User Manual

myprettycloud turns your Clever Cloud infrastructure into a living medieval city.
Every application and add-on is a building. Its status and live metrics drive how
it looks and moves; problems show up as events in the streets — smoke, fires, the
toll of a bell. This manual explains how to use it.

> **New here?** Jump to the step-by-step **Tutorial** (section 14) for a ~10-minute
> walkthrough, from sign-in to your first live alert.

## 1. Signing in

1. Open the app. You'll land on the sign-in screen.
2. Click **Sign in with Clever Cloud**. You'll be redirected to Clever Cloud to
   authorize access, then back to your city.
3. The app only ever uses your Clever Cloud account — there is no separate
   password. Your access tokens are stored encrypted.

Pick your **organisation** from the selector in the top-right. Each organisation
has its own city map.

## 2. Reading the city

- **Buildings** are your apps and add-ons. You place and arrange them on the hex
  grid in builder mode (below); each is bound to one Clever Cloud resource.
- **Building colour = status:**
  - green — running / healthy
  - blue — deploying (a wooden scaffold appears during a build)
  - red — failed / stopped (a fire and black smoke)
  - amber — warning
  - grey — created but never deployed
- **Movement = load.** Windmills, water-wheels and other animated parts spin
  faster as the resource's CPU climbs — a calm mill is an idle service; a mill
  ripping at full speed is a hot one.
- **Traffic = network activity.** Horse-drawn carts and riders (or small trucks
  and shuttles in the space theme) travel between your buildings. Every trip
  starts at a building's doorstep and ends at another's — vehicles never appear
  or vanish in open country, and shuttles take off from and land on the
  buildings they serve (a map needs at least two buildings to see traffic). The
  more network traffic your apps handle, the busier the roads — and deliveries
  converge on the buildings doing the work. Vehicles follow your roads, bridges
  (or tunnels) when you've built them, and find their way across open ground
  otherwise; they never drive through buildings or scenery.
- **Crates = memory, depot = disk.** As a building's RAM fills, barrels and
  crates (cargo containers in space) pile up at its door — at 90 %+ it visibly
  overflows. A separate resource depot beside the building grows with disk
  usage. One glance tells you who is full without opening a dashboard.
- **Ambient life:** chimney smoke, blacksmith sparks, mine dust and watchtower
  lights give each building type its own character. A **day/night cycle** lights
  the city's lanterns after dark, with fireflies.
- **Alerts as events:** when a monitoring rule fires critical, the affected
  building catches fire and a bell tolls; warnings raise amber smoke. A matching
  toast appears bottom-right.

Status updates arrive in real time (sub-second when Clever Cloud webhooks are
configured, otherwise within a few seconds via polling).

## 3. Building your city (builder mode)

A fresh map doesn't start empty: it opens on a hand-composed **starter scene**.
Medieval maps get the **starter realm** — northern mountains, a river bridged by
the main road, a sea coast, forests and farms. Space maps get the **starter
outpost** — mesas with a quarry and drill, a tunnel spine, landing pads with a
resting lander, greenhouse farms, solar panels and wind turbines. In both, the
central plaza is left free for your buildings. **Clear** (left rail) resets back
to the kit's starter scene, and both are available as built-in templates
(section 10). Auto-placed resources settle on the plaza first: placement never
builds over roads, tunnels, rivers, coasts or decorated cells. It fills the
buildable ground you already have, and only when the city runs out of room does it
grow just enough new ground at the edge — buildings never land detached out in the
void.

Switch to builder mode (left rail) to lay out your town. Select a hex to open the
**Inspector** on the left; its top (asset preview + cell coords) stays pinned while
the rest scrolls.

- **Place resources** — the Resources panel (right) lists your apps/add-ons; click
  one to drop it on the map (or auto-place all). Each building is bound to one
  Clever Cloud resource and coloured by its live status.
- **Ground tiles** — pick grass, water, coast, rivers (incl. dry "waterless"
  variants), roads and slope ramps; rotate the tile in 60° steps.
- **Elevation** — raise/lower a cell in steps (up to 4) to sculpt plains, hills and
  plateaus; raised tiles get a solid cliff skirt so nothing floats.
- **Structures** — place walls, fences, gates, bridges, a wheat field, dirt or
  ruins, and rotate them to align.
- **Decorations** — trees, hills, mountains, rocks, water plants and props, grouped
  in the palette; each placed decoration can be rotated individually.
- **Move** — select a placed building and use **Move** (or press **M**) to relocate
  it to another tile; **Esc** cancels.
- **Hover** any building to see its name in a small floating label (builder & view).
- Your layout **saves automatically** per organisation, so it's there next time.

You can also reuse layouts via **templates** and change the look with **seasons /
ambiance** — see sections 10 and 11.

## 4. Inspecting a building

Click any building to select it. A quick card shows its name, live status and a
sparkline. Use it to open the **building drawer**, which has two tabs:

- **Overview** — current status, last deploy, and live readings.
- **Metrics** — interactive charts (CPU, memory, network, disk) over a time range
  you choose (1h / 6h / 24h / 7d / 30d), with a live mode. Zoom and pan to inspect.

Monitoring rules are managed org-wide from the **⚙️ Workflows** button in the top
bar (next section).

## 5. Arming workflows (monitoring & alerting)

Workflows (rules) watch your resources and act when conditions are met. You
create them in the **visual graph editor**: open **⚙️ Workflows** in the top bar
and click **+ New workflow**, then wire nodes together — condition nodes
(thresholds, states), AND/OR groups, and action nodes. The graph handles
everything from a one-condition alert to multi-step workflows: chained state
changes, cross-resource references, and **escalations** (act now, then escalate
after a delay if still unresolved).

In the graph editor, click **Test** at any time — even before saving — to evaluate
the drawn rule against your infrastructure's *current* state. The result is
painted onto the graph: each condition shows the live value it read and a
true/false verdict, AND/OR nodes show theirs, the paths that are currently true
light up, and each action shows whether it **would run**. Conditions with a
`for X minutes` window also tell you when they are *"true now, but not held for
the duration yet"*. The overlay clears as soon as you edit the graph; test again
whenever you like. Use the searchable picker to find a monitor or group quickly,
and the **×** on a node to remove it.

Every rule supports:

- **Conditions:** thresholds on CPU/memory/disk/network and on monitor state, with
  `for X minutes` time windows, combined with AND/OR.
- **Actions:** notify a channel, change a (synthetic) monitor's state, or escalate
  after a delay. A state-changing action can tick **revert when condition
  recovers**: the moment the workflow stops matching, the target is
  automatically restored to the exact state (and message) it had before the
  action overwrote it.
- **Cooldown:** avoids repeat spam while a problem persists, but always fires on a
  real change (e.g. recovery).
- **Dry-run:** test a rule against current state — from the editor's **Test**
  button while authoring, or from Diagnose once saved.
- **Versions:** the last few edits are kept so you can roll back.

Rules that span multiple resources or whole groups are presented as **decrees**
issued from the town hall.

### The Workflows manager

All of an organisation's rules are managed from the **⚙️ Workflows** button in the
top bar. Each workflow shows whether it's enabled and when it last fired, with:

- **Diagnose** — answers *"why isn't it firing?"*: a live trace of every condition
  (expected vs. actual value, per-branch verdicts), the state of the monitors and
  groups it references, the health of its notification channels, cooldown status,
  recent activity, a dry-run button, and version history with one-click restore.
- **Edit** — opens the graph editor.
- **Clone** — duplicates a workflow as a starting point. The copy is created
  **disabled** so it can't double-fire; review it, then enable.
- **Enable / Disable / Delete.**

Creating or editing workflows requires **Builder** mode; listing and diagnostics
are always available.

## 6. Notification channels

Set up where alerts go from the **🔔 Channels** button in the top bar:

- **Email** (SMTP) — one or more recipients.
- **Slack** — an incoming webhook URL.
- **Discord** — a webhook URL.
- **Generic webhook** — POST/PUT to any URL, with optional custom headers.

Each rule's *notify* action picks a channel. Channels track their recent
success/failure so you can spot a misconfigured destination.

## 7. Groups

Group related monitors (manually, or automatically by name pattern / kind / tags).
A group shows a rolled-up state — the worst state among its members — so you can
watch a whole subsystem at a glance, and write rules against the group rather than
each resource.

## 8. The mayor

The mayor is your in-city advisor. They surface recent alerts and recommendations
in a popup, so you get a friendly summary of what needs attention without leaving
the city view.

**When you open a city,** the buildings appear at once but take a moment to show
their real status colour and live readings while data is gathered. The mayor pins
a **"The realm takes stock…"** notice with a live count ("N of TOTAL holdings have
reported.") and keeps it up until every building is reporting correctly — then
gives an all-clear (**"The realm stands true."**), or flags trouble if an app has
fallen. This usually takes only a few seconds. The loading notice stays visible
even if you've muted the mayor (it's a status indicator, not an alert); the
all-clear and trouble messages still respect muting.

## 9. Settings

- **MCP access** — enable the Model Context Protocol and generate a Bearer token
  to let an AI assistant (e.g. Claude) read your monitors and author rules on your
  behalf. The token is shown **once** at creation; store it safely. You can revoke
  and regenerate it anytime.
- **Webhook setup** — the top bar shows a **Hook up / Re-install** button (with a
  "Required" badge until done). One click installs the Clever Cloud webhook for the
  current organisation so the city reacts to deployments and lifecycle events in
  real time (sub-second), instead of waiting on polling.

## 10. Scene templates

Save a city layout and reuse it elsewhere from the **🗺️ Templates** button:

- **Save current scene** — captures the landscape (tiles, decorations, decorative
  structures) — **not** your app/add-on/monitor buildings, which are specific to
  each org. Choose **Private** or **Public**.
- **Apply** a template (yours or a public one) to the current organisation — it
  replaces the scene; you then re-place your resources.
- **Share** — flip a template to Public and any other user can browse and apply it
  under the Public tab (your name is shown as the author).
- **Built-in starters** — the Public tab always offers **"Starter — Medieval
  realm"** and **"Starter — Space outpost"**, the landscapes new maps begin
  with, so you can return to them anytime (each applies only to a map of its
  style).

## 11. Seasons & ambiance

In builder mode (left rail):

- **Season** — switch the whole city's palette between Default / Summer / Fall /
  Winter (🌿 / ☀️ / 🍂 / ❄️). The change is instant.
- **Ambiance toggles** — wind, water animation, day/night cycle, particles,
  clouds, **traffic** (🐴 / 🚀 — the metric-driven vehicles) and **RAM / disk
  props** (📦 — the crates and depots around buildings).

Both the season and the ambiance toggles are **saved per organisation**, so each
city reopens exactly as you left it.

## 12. Custom monitored buildings

Beyond apps and add-ons you can place **custom monitors** — buildings that aren't
backed by a Clever Cloud resource but whose state is driven entirely by your rules
(e.g. a "Queue depth" or "SLA" marker). From the builder's **Custom monitors**
panel: create one (name + building type), and it appears as a building you can
target in rules (`Set monitor state`) and condition on. You can also set its
default state (ok / warning / critical / unknown) directly from its inspector.
Deleting the building removes the monitor.

## 13. Tips

- Keep the org selector pointed at the organisation you're actively watching — the
  live stream follows it.
- If buildings ever look stuck on an old state, a quick page refresh re-syncs from
  the latest known status.
- Use a short metrics time-range with live mode for incident triage, and a long
  range to spot trends.
- The **version badge** sits discreetly in the bottom-right corner; toggle it with
  the **🏷️ Version** button in the top bar. Click it to open the release notes —
  what changed in each version.

## 14. Tutorial — your first city in ~10 minutes

A complete walkthrough, from signing in to watching a live alert. No prior setup
needed beyond a Clever Cloud account with at least one app or add-on.

### Step 1 — Sign in and pick your org
1. Open the app and click **Sign in with Clever Cloud**; authorize access.
2. In the top bar, choose the **organisation** you want to watch. Everything below
   (map, metrics, rules, settings) is scoped to that org.

### Step 2 — Turn on real-time updates
In the top bar, click **Hook up** (it shows a "Required" badge until done). This
installs the Clever Cloud webhook for the org so deployments and status changes
reach the city within a second. Without it the city still updates, just on a slower
poll. The button becomes **Re-install** once active.

### Step 3 — Lay out your city (builder mode)
1. Click **Builder** in the left rail. A new medieval map already comes with the
   **starter realm** landscape — mountains, a river, a road and a sea — with the
   village plaza in the middle left free for your buildings.
2. In the **Resources** panel on the right, click each app/add-on to drop it on the
   map — or use **Auto-place** to position them all at once (they fill the plaza and
   any other open ground, never over the scenery, and the map only grows when it runs
   out of room). Each becomes a building coloured by its live status.
3. Optional polish: select a tile to set its **ground type**, **elevation** (raise
   hills/plateaus), add **structures** (walls, bridges, a wheat field) and
   **decorations** (trees, rocks), rotating pieces as you like. To relocate a
   building, select it and press **M** (or **Move**), then click the destination.
   Lay **roads** between your buildings and the city's traffic will use them.
4. Everything **autosaves** for this org — no save button.

### Step 4 — Inspect a building and its metrics
1. Click a building to open the **building drawer**.
2. Open the **Metrics** tab and explore CPU / memory / network / disk. Pick a time
   range (1h … 30d) and toggle **live** mode. (Hover any building to see its name.)

### Step 5 — Create a notification channel
1. Click **🔔 Channels** in the top bar.
2. **+ New channel** → choose a type and fill the config:
   - **Slack/Discord**: paste an incoming-webhook URL.
   - **Email**: one or more recipients.
   - **Webhook**: a URL (+ optional headers).
3. Save. You'll target this channel from a rule next.

### Step 6 — Arm your first workflow
1. Make sure you're in **Builder** mode (workflow editing is builder-only), then
   click **⚙️ Workflows** in the top bar and **+ New workflow**.
2. In the graph editor: add a **Condition** node (*your app's CPU ≥ 80, for 5m*),
   connect it to **Rule output**, and attach an **Action** node (*Send
   notification → your channel*). Name the workflow.
3. Click **Test** — the graph lights up with live values and per-node verdicts so
   you can see exactly what would happen right now — then **Save**. Later,
   troubleshoot any workflow from the same manager (the **Diagnose** panel
   explains exactly why it does or doesn't match).

### Step 7 — Watch it live
1. Switch to **View** mode (left rail) — clicking a building now gently flies the
   camera to it.
2. When the rule fires critical, the building catches **fire** and a **bell** tolls;
   warnings raise amber smoke, and a toast appears bottom-right. Your channel gets
   the notification. The **mayor** popup also summarises what needs attention.

### Step 8 — Make it yours (optional)
- **Seasons & ambiance** (builder left rail): switch the palette to Summer / Fall /
  Winter and toggle wind / water / day-night / particles / clouds. These persist
  per org.
- **Custom monitors**: add a building that isn't a CC resource (e.g. "Queue depth")
  and drive its colour entirely from your rules.
- **Templates** (**🗺️ Templates**): save your landscape and reuse it in another org,
  or share it publicly.

That's the full loop: **sign in → build → inspect → alert → react**. From here,
group related monitors (section 7), wire escalations in the graph editor (section
5), or let an AI assistant manage rules via MCP (section 9).
