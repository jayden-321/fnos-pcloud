Flat white content container — fill + 1px border, no shadow. Wraps tables, settings groups, and empty states. Optional `title` and right-aligned `action`.

```jsx
<Panel title="Queue Status">
  <table>…</table>
</Panel>

<Panel title="Task Configuration" action={<Button variant="soft">Add Task</Button>}>
  …
</Panel>
```

Props: `title`, `action`, `padding` (default 18). Never add a box-shadow — the system is intentionally flat.
