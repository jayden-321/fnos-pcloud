# pCloud NAS Sync — Design System

A design system reverse-engineered from the **pCloud NAS Sync** product: a
Docker-based **fnOS** application that performs one-way backup of selected NAS
folders to **pCloud** over OAuth 2.0. The UI is a small, utilitarian,
self-hosted control panel — three tabs (Sync Tasks, Sync Logs, Settings), a
left navigation rail, metric tiles, task cards, log tables, and folder-picker
dialogs. It ships entirely in **Simplified Chinese (zh-CN)**.

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

**Language.** Primary and only UI language is **Simplified Chinese**. Technical
nouns stay in English/Latin where they are proper names or units: `pCloud`,
`Client ID`, `Client Secret`, `Token`, `Access Token`, `NAS`, `B/s`, `MB`,
`checksumfile`, file paths (`/vol1/1000/photos`). Everything else is Chinese.

**Voice.** Terse, operational, neutral — a systems utility, not a consumer
brand. Labels are nouns or noun phrases (`同步任务`, `队列状态`, `上传速度`);
buttons are imperative verbs (`立即扫描`, `远端重新比对`, `停止同步`, `重试失败`,
`保存设置`, `换取 Token`). No marketing adjectives, no exclamation, no emoji in
product copy.

**Person.** The UI rarely addresses the user directly — it labels state and
actions, not "you/your". Helper notes are impersonal advisories, e.g.
*"默认不做全量校验；校验会调用 pCloud checksumfile，文件多时会更慢。"* and
*"0 表示不按时间删除。"*

**Casing & punctuation.** Chinese needs no casing. English fragments use natural
casing of the proper noun (`pCloud`, not `Pcloud`). Mixed CJK/Latin lines put a
space around Latin runs (`换取 Token`, `pCloud 文件夹`). Counts use
`Intl.NumberFormat('zh-CN')` thousands separators (`1,284`).

**Status vocabulary (use verbatim):**
- 未扫描 (not scanned) · 扫描中 (scanning) · 同步中 (syncing) · 同步完成 (done)
- 成功 (success) · 失败 (failed) · 上传中 (uploading) · 待上传 / 待处理 (pending)
- 已存在 (existing) · 总文件 (total) · 已成功 (synced) · 上传速度 (speed)
- 扫描依据 (scan source): 远端全量比对 / 本地缓存 / 远端增量

**Microcopy examples.**
- Empty state: *"还没有同步任务 — 创建一个任务，选择本地文件夹和 pCloud 目标文件夹后即可开始同步。"*
- Toast: *"扫描已触发"*, *"Token 已保存"*, *"已删除 128 条日志"*, *"正在停止同步"*.
- Placeholder: *"例如 财务备份"*, *"/vol1/1000/work"*, *"搜索文件名称"*,
  *"已保存时可留空"*.

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
The generic OS faces already include CJK glyphs (with `sans-serif` as the final
catch-all), so Simplified Chinese renders natively without naming a specific CJK
family. Base body
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
  Chinese text labels. This is the defining iconography decision: do not add an
  icon library where the product uses words.
- **Unicode glyphs as the only "icons":** a fullwidth plus `＋` prefixes "创建新任务",
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
> "Segoe UI", sans-serif`). Those generic faces already resolve to system fonts
> that include CJK glyphs, so no CJK family is named and **no font files are
> needed** — everything renders from the user's operating system.

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
