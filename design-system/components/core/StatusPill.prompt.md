Status as bold colored text (not a filled chip) — the convention used throughout logs, the queue table and task-card status lines.

```jsx
<StatusPill status="success" />     {/* 成功, green */}
<StatusPill status="failed" />      {/* 失败, red */}
<StatusPill status="uploading" />   {/* 上传中, blue */}
<StatusPill status="queued">待上传</StatusPill>
```

Statuses: `success` | `failed` | `uploading` | `queued` | `existing`. Pass `children` to override the label.
