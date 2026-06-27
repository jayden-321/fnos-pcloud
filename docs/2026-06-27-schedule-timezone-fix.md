# Schedule Timezone Fix

## Problem

Daily and weekly schedules were previously evaluated with JavaScript local-time methods such as `Date#getHours()` and `Date#getDay()`. Inside the fnOS Docker container, the process timezone can be UTC even when the NAS user expects a local timezone such as `Asia/Shanghai`.

That meant a task configured for `09:30` could run at the wrong wall-clock time when the container timezone differed from the user's intended timezone.

## Fix

v0.4.0 adds `sync.timezone`, validated as an IANA timezone. Daily and weekly schedules now evaluate wall-clock date, time, and weekday through `Intl.DateTimeFormat` with the configured timezone.

Interval schedules are unchanged because they are duration-based rather than wall-clock based.

## UI

Settings now includes a scheduler timezone field. Existing configs without an explicit timezone are normalized to the runtime default, and the browser UI pre-fills the browser timezone when possible.
