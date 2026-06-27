The signature surface of the product: one sync task with a name, colored status line, optional scan-source detail, an inline count grid, and right-aligned soft buttons. Composes `StatusPill` and `Button`.

```jsx
<TaskCard
  name="财务备份"
  status="success"
  statusLabel="同步完成"
  scanMode="远端增量"
  scanDetail="本地 1,284 · 远端 1,266 · 本地扫描 0.4s"
  stats={{ total: 1284, existing: 1266, synced: 18, pending: 0, failed: 0 }}
/>
```

Pass `actions` to override the default 查看日志 / 编辑 buttons. `status` drives the status color: `success` | `failed` | `uploading` | `queued`.
