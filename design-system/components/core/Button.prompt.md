Solid action button — `primary` (blue) for the main action, `soft` (pale blue) for secondary actions on cards/dialogs, `ghost` for nav/transparent, `link` for the "create task" affordance.

```jsx
<Button onClick={scan}>立即扫描</Button>
<Button variant="soft">查看日志</Button>
<Button variant="primary" disabled>停止同步</Button>
<Button variant="link">＋ 创建新任务</Button>
```

Variants: `primary` | `soft` | `ghost` | `link`. Props: `fullWidth`, `disabled`, plus all native `<button>` attributes. Buttons are `min-height: 36px`, weight 700, 6px radius; hover darkens (primary) or deepens the tint (soft).
