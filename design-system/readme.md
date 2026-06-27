# pCloud NAS Sync — Design System

A design system reverse-engineered from the **pCloud NAS Sync** product: a
Docker-based **fnOS** application that performs one-way backup of selected NAS
folders to **pCloud** over OAuth 2.0. The UI is a small, utilitarian,
self-hosted control panel — three tabs (Sync Tasks, Sync Logs, Settings), a
left navigation rail, metric tiles, task cards, log tables, and folder-picker
dialogs. It ships entirely in **English**.

This system captures that product's visual language so you can design new
pCloud-NAS-Sync surfaces — additional screens, marketing pages, slides, or
in-app dialogs — that look native to it.

## Sources

Everything here was derived from the product's own source code:

- **GitHub:** https://github.com/jayden-321/fnos-pcloud
  - UI: `app/docker/pcloud-sync/public/` — `index.html`, `styles.css`,
    `app.js`, `logRows.js`, `taskStatus.js`
  - App icon: `app/ui/images/icon_256.png`, `ICON_256.PNG`

Explore that repository for deeper context on the sync engine, pCloud API
usage, and the full feature set when building product-accurate work.

> The reader is encouraged to browse the repository above to do a better job of
> building designs based on this product.

---

## What this product is

pCloud NAS Sync runs inside fnOS (a NAS operating system) behind its reverse
proxy. It is a focused single-purpose tool: configure tasks that map a local
NAS folder to a pCloud destination folder, then upload on a schedule (manual,
interval, daily, weekly) or on demand. It surfaces detailed counts (total,
existing, synced, pending, failed, uploading), per-file logs with progress, and
optional checksum verification. There is no marketing site and no mobile app —
**the product is this one web control panel.**

---

## CONTENT FUNDAMENTALS

**Language.** Primary and only UI language is **English**. Technical nouns keep
their official spelling where they are proper names or units: `pCloud`,
`Client ID`, `Client Secret`, `Token`, `Access Token`, `NAS`, `B/s`, `MB`,
`checksumfile`, and file paths such as `/vol1/1000/photos`.

**Voice.** Terse, operational, neutral — a systems utility, not a consumer
brand. Labels are nouns or noun phrases (`Sync Tasks`, `Queue Status`, `Upload speed`);
buttons are imperative verbs (`Scan Now`, `Force Remote Compare`, `Stop Sync`, `Retry Failed`,
`Save Settings`, `Exchange Token`). No marketing adjectives, no exclamation, no emoji in
product copy.

**Person.** The UI rarely addresses the user directly — it labels state and
actions, not "you/your". Helper notes are impersonal advisories, e.g.
*"Full verification is off by default; verification calls pCloud checksumfile and can be slower for large file sets."* and
*"0 disables age-based deletion."*

**Casing & punctuation.** Use sentence-style English for helper text and title
case for short navigation labels and panel headings. Keep proper nouns exact
(`pCloud`, not `Pcloud`). Counts use standard comma thousands separators
(`1,284`).

**Status vocabulary (use verbatim):**
- Not scanned (not scanned) · Scanning (scanning) · Syncing (syncing) · Sync complete (done)
- Success (success) · Failed (failed) · Uploading (uploading) · Pending upload / Queued (pending)
- Existing (existing) · Total files (total) · Uploaded (synced) · Upload speed (speed)
- Scan source (scan source): Full remote comparison / Local cache / Remote diff

**Microcopy examples.**
- Empty state: *"No sync tasks yet - create a task, choose a local folder and a pCloud destination, then start syncing."*
- Toast: *"Scan started"*, *"Token saved"*, *"Deleted 128 log entries"*, *"Stopping sync"*.
- Placeholder: *"e.g. Finance backup"*, *"/vol1/1000/work"*, *"Search file name"*,
  *"Leave blank if already saved"*.

**Vibe.** Honest, transparent, slightly nerdy. The product over-discloses
internal mechanics (scan source, local/remote timings, mtime mismatches) rather
than hiding them — copy reflects an audience of self-hosters who want to see
exactly what the engine did.

---

## VISUAL FOUNDATIONS

**Overall.** Clean, flat, light, dense-but-breathable admin UI. Think native NAS
control panel, not SaaS dashboard. Structure is built from **1px lines and
surface fills, never drop shadows.**

**Color.** Two color stories:
- **Brand** lives only in the app icon: a teal-green tile (`#1d6f5f`) with a
  white `pC` wordmark and a yellow sync arrow (`#f2c14e`). It does **not** appear
  in the UI chrome.
- **Interface accent** is a confident blue — `#2775df` for primary actions and
  the active nav item, deepening to `#1c5db3` on hover. Secondary actions use a
  pale-blue "soft" fill (`#eef4fb` bg / `#2c5f9e` ink). Surfaces are cool grays:
  canvas `#f6f8fb`, sidebar `#edf2f7`, panels `#ffffff`, lines `#d9e1ea`. Text
  is near-black `#17202a` with muted `#728199`.
- **Status** is communicated as **bold colored text** (not filled badges):
  green `#2f9a4b` success, red `#b7322c` failed, blue accent uploading, gray
  `#718096` queued.

**Type.** No webfonts — the native OS UI stack (`-apple-system,
BlinkMacSystemFont, "Segoe UI", sans-serif`), exactly as the product ships it.
The generic OS faces cover broad Unicode ranges (with `sans-serif` as the final
catch-all), so the UI stays native without bundled font files. Base body
14px/1.45. Scale: 12 (notes) · 13 (stats, table heads) · 14 (body) · 16 (nav) ·
20 (task titles, weight 700) · 24 (page title) · 26 (metric numbers, weight
760). Weights cluster at 650 (labels), 700 (buttons/status), 760 (metrics).

**Spacing.** ~8px rhythm (4/6/8/10/12/14/16) with workspace-scale steps
(18/22/28/32). Sidebar is 228px; workspace padding 28px top / 32px sides.
Buttons and inputs are 36px tall; nav items 40px.

**Radius.** Tight and consistent: **6px** for buttons/inputs/selects, **8px**
for cards/panels/dialogs/toast. The app icon tile is a ~22% squircle.

**Borders & cards.** A card is `--panel` fill + `1px solid --line` + 8px radius.
**No box-shadow** anywhere in-app; the only shadows in the whole system are the
dialog scrim and the toast. Tables use 1px bottom-border row dividers and a
subtle `#fbfcfd` zebra on log rows; the log table head is sticky with a
`#fbfcfd` fill.

**Backgrounds.** Flat solid fills only. No gradients, no imagery, no textures,
no patterns, no illustrations. The canvas is a single cool off-white.

**Animation.** Minimal and functional. The toast is the only real transition:
opacity + 8px translateY over 160ms ease. Buttons change background on hover
with a short ease; there are no bounces, no entrance animations, no decorative
motion. Status refreshes every 5s by re-rendering, not animating.

**Hover / press.** Primary buttons darken (`--accent` → `--accent-strong`). Soft
buttons deepen tint (`#eef4fb` → `#ddeafa`). Sidebar items tint to `#dde8f6`.
Disabled = `opacity: 0.48` + `not-allowed` cursor, hover suppressed. There is no
explicit press/scale state.

**Transparency & blur.** None in-app except the dialog backdrop
(`rgb(15 23 42 / 0.34)` scrim). No frosted glass, no blur effects.

**Layout rules.** Two-column app grid: a sticky full-height sidebar + a scrolling
workspace. The metrics strip is a 7-column grid collapsing to 2 on narrow
viewports. The settings page is a two-column grid (editor column spans full
width). Everything is left-aligned; the create-task button pins to the bottom of
the sidebar via `margin-top: auto`.

**Imagery vibe.** There is no photography or illustration. The only raster asset
is the app icon. If imagery is ever needed, keep it screenshot-literal (real
product UI), not stylized.

---

## ICONOGRAPHY

The product is **almost icon-free** — a deliberate, text-first interface.

- **No icon font, no SVG icon set, no sprite.** Navigation and actions are pure
  English text labels. This is the defining iconography decision: do not add an
  icon library where the product uses words.
- **Unicode glyphs as the only "icons":** a plain plus `+` prefixes "Create New Task",
  and folder rows in the picker use the `📁` emoji. These are the sole
  pictographic elements. (The `📁` is the one emoji in the system; use it only in
  folder listings, nowhere else.)
- **App icon** (`assets/app-icon-256.png`, `app-icon-64.png`,
  `app-icon-full-256.png`): the green `pC` + sync-arrow tile. Use it for the
  product mark / sidebar brand lockup, not as a UI glyph.

**Guidance for new work:** stay text-first. If a genuinely new surface needs
icons (e.g. a marketing page), introduce a thin-stroke line set (Lucide is the
closest CDN match to the product's restraint) and **flag it as an addition** —
it is not in the source product.

> ⚠️ **Substitution flag:** The product uses no icon system, so any icon set you
> introduce is a net-new design decision, not a recreation. Lucide (CDN) is the
> recommended match if icons become necessary.

---

## Foundations, tokens & fonts

- `styles.css` — root entry point (import manifest only).
- `tokens/colors.css` — brand, surfaces, text, lines, accent, status, overlay.
- `tokens/typography.css` — font stacks, size scale, weights, line heights.
- `tokens/spacing.css` — spacing scale, radius, borders, control sizing, layout,
  elevation.

> **Font note:** the system intentionally has **no `@font-face`** — it uses the
> product's exact OS-native UI stack (`-apple-system, BlinkMacSystemFont,
> "Segoe UI", sans-serif`). Those generic faces cover broad Unicode ranges, so
> **no font files are needed** — everything renders from the user's operating
> system.

---

## Index / manifest

**Root**
- `styles.css` — design-system entry (link this one file).
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skill manifest for portable use.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`.
- `assets/` — `app-icon-256.png`, `app-icon-64.png`, `app-icon-full-256.png`.

**Components** (`window.PCloudNASSyncDesignSystem_4c073a.<Name>`)
- `components/core/` — `Button`, `Panel`, `MetricCard`, `StatusPill`,
  `Field` (+ `Input`, `Select`, `Textarea`).
- `components/navigation/` — `NavItem`.
- `components/tasks/` — `TaskCard`.

**Foundation cards** (Design System tab)
- `cards/` — colors (brand / surfaces / status), type (scale / families),
  spacing (scale / radius), brand (app mark).

**UI kit**
- `ui_kits/pcloud-sync/` — interactive recreation of the full product
  (Sync Tasks, Sync Logs, Settings, folder picker).

---

## Using the components

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
<script type="text/babel">
  const { Button, TaskCard, MetricCard } = window.PCloudNASSyncDesignSystem_4c073a;
</script>
```

Each component has a sibling `.prompt.md` with usage notes and a `.d.ts` props
contract.
