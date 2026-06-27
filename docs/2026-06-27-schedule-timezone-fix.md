# Fix: fire scheduled tasks in the configured time zone (not container UTC)

## Background

Tasks support `daily` / `weekly` scheduling. Whether a schedule is due is
decided by `scheduleSlot` / `timeMatches` in `src/sync/engine.js`, which
originally used:

```js
function timeMatches(time, now) {
  const hour = String(now.getHours()).padStart(2, '0');   // container local time
  ...
}
function scheduleSlot(schedule, now) {
  ...
  if (!weekdays.includes(now.getDay())) { ... }            // container local time
}
```

`getHours()` / `getDay()` use the **container process's local time zone**. But
`docker-compose.yaml`, `Dockerfile`, and `manifest` set no `TZ`, so the Node
container defaults to **UTC**.

## Problem

A user sets "daily backup at 09:30" expecting **local time**. The container
evaluates it in UTC, so:

- A Malaysian user (UTC+8): 09:30 actually fires at **17:30** local — off by 8
  hours;
- `weekly`'s "day of week" shifts to the previous/next day at boundary times.

`interval` (fixed interval) mode only computes a time delta and is unaffected —
only `daily` / `weekly` are wrong, and those are the more recently added
features.

## Comparison

- **The container `TZ` approach has a trap**: the `node:alpine` base image does
  **not** ship `tzdata`, so musl libc cannot resolve named time zones and `Date`
  silently falls back to UTC. You'd have to `apk add tzdata` in the Dockerfile,
  and it only helps if an operator manually sets `TZ`.
- **This approach (in-app time zone + Intl)**: use Node's bundled ICU
  (`Intl.DateTimeFormat`) to compute the wall-clock time in the configured zone.
  It does **not** depend on the OS `tzdata`, needs no env change or image
  rebuild, and the time zone is an app config the UI can set directly. More
  self-contained and a better fit for "the app manages its own behavior."

## Decision

1. Add a sync config field `sync.timezone` (`src/config/config.js`):
   - Validate it is a real IANA zone name via `Intl.DateTimeFormat`; on an
     invalid or empty value, fall back to the **container's system time zone**
     (i.e. the pre-change behavior — no regression).
2. Make schedule matching time-zone aware (`src/sync/engine.js`):
   - Add `zonedScheduleParts(now, timeZone)`, using
     `Intl.DateTimeFormat(..., { timeZone }).formatToParts` to read the
     hour/minute/weekday/date in that zone;
   - `scheduleSlot` compares `HH:MM` and `weekday` accordingly, and uses that
     zone's date as the dedupe slot key;
   - `taskIsDue` / `rememberTaskScheduleSlot` pass `sync.timezone` through.
3. UI (`public/index.html` + `public/app.js`):
   - Add a "schedule time zone" input to the Sync Rules section;
   - When the stored zone is still the default (UTC), the front end
     **auto-fills the browser's time zone**, so one click of "Save settings"
     takes effect — correct out of the box without being forced.

> The default is the "system time zone" rather than a hard-coded UTC for
> **zero regression**: existing deployments (container UTC) behave the same
> until the user explicitly sets a zone.

## Usage

- Open Settings → Sync Rules → schedule time zone, confirm/enter the zone (e.g.
  `Asia/Kuala_Lumpur`), and save.
- After that, `daily` / `weekly` fire at the "wall-clock time" in that zone.
- `interval` tasks need not care about the time zone.

## Testing

- `cd app/docker/pcloud-sync && node --test` — **122 tests pass**.
- New cases:
  - `config.test.js`: a valid zone is kept; an invalid/empty value falls back to
    the system zone;
  - `engine.test.js`: with the zone set to `Asia/Kuala_Lumpur`, `daily 09:30`
    fires at **01:30 UTC** and does **not** fire at **09:30 UTC**. This case is
    independent of the machine's local time zone — the old `getHours()`
    implementation would fail it.

## Incidental fix

- `package.json` `engines` raised from `>=22.5` to `>=22.13`: `node:sqlite`
  stopped requiring `--experimental-sqlite` only at v22.13.0 (confirmed against
  the official Node docs). `node:22-alpine` already pulls the latest 22.x and
  runs fine; raising the floor just avoids a startup crash for anyone pinning
  22.5–22.12.
