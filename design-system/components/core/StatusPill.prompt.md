Status as bold colored text (not a filled chip) — the convention used throughout logs, the queue table and task-card status lines.

```jsx
<StatusPill status="success" />     {/* Success, green */}
<StatusPill status="failed" />      {/* Failed, red */}
<StatusPill status="uploading" />   {/* Uploading, blue */}
<StatusPill status="queued">Pending upload</StatusPill>
```

Statuses: `success` | `failed` | `uploading` | `queued` | `existing`. Pass `children` to override the label.
