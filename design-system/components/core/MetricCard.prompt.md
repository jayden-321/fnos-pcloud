Dashboard statistic tile: a 26px/760 number over a 13px muted label, on a flat bordered panel. Used in a 7-up metrics strip on the Sync Tasks page.

```jsx
<MetricCard value="1,284" label="Total files" />
<MetricCard value="248" label="Uploaded" tone="success" />
<MetricCard value="3" label="Failed" tone="danger" />
<MetricCard value="1.2 MB/s" label="Upload speed" tone="accent" />
```

Props: `value`, `label`, `tone` (`default` | `success` | `danger` | `accent` | `muted`).
