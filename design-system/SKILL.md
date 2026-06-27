---
name: pcloud-nas-sync-design
description: Use this skill to generate well-branded interfaces and assets for pCloud NAS Sync (the fnOS Docker app that backs up NAS folders to pCloud), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Quick facts
- **Product:** pCloud NAS Sync — a self-hosted fnOS Docker control panel for one-way NAS-to-pCloud backup. UI copy is **English**.
- **Accent:** interface blue `#2775df` (hover `#1c5db3`); brand mark green `#1d6f5f` + yellow `#f2c14e` (icon only).
- **Type:** native OS UI stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`), no webfonts. Base 14px/1.45.
- **Look:** flat, light, 1px lines, 6/8px radii, **no shadows** (except dialog scrim + toast), no gradients, no imagery, **text-first / near icon-free**.

## Map
- `styles.css` + `tokens/` — link `styles.css`; tokens are CSS custom properties.
- `components/` — React primitives on `window.PCloudNASSyncDesignSystem_4c073a` (Button, NavItem, Panel, MetricCard, StatusPill, Field/Input/Select/Textarea, TaskCard). Each has a `.prompt.md` and `.d.ts`.
- `cards/` — foundation specimens.
- `ui_kits/pcloud-sync/` — full interactive product recreation to copy from.
- `assets/` — app icon.

Stay text-first and in English to match the product. Source: https://github.com/jayden-321/fnos-pcloud
