Flat white content container — fill + 1px border, no shadow. Wraps tables, settings groups, and empty states. Optional `title` and right-aligned `action`.

```jsx
<Panel title="队列状态">
  <table>…</table>
</Panel>

<Panel title="任务配置" action={<Button variant="soft">新增任务</Button>}>
  …
</Panel>
```

Props: `title`, `action`, `padding` (default 18). Never add a box-shadow — the system is intentionally flat.
