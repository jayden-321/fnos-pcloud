The signature surface of the product: one sync task with a name, colored status line, optional scan-source detail, an inline count grid, and right-aligned soft buttons. Composes `StatusPill` and `Button`.

```jsx
<TaskCard
  name="Finance backup"
  status="success"
  statusLabel="Sync complete"
  scanMode="Remote diff"
  scanDetail="Local 1,284 · Remote 1,266 · Local scan 0.4s"
  stats={{ total: 1284, existing: 1266, synced: 18, pending: 0, failed: 0 }}
/>
```

Pass `actions` to override the default View Logs / Edit buttons. `status` drives the status color: `success` | `failed` | `uploading` | `queued`.
