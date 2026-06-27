Solid action button — `primary` (blue) for the main action, `soft` (pale blue) for secondary actions on cards/dialogs, `ghost` for nav/transparent, `link` for the "create task" affordance.

```jsx
<Button onClick={scan}>Scan Now</Button>
<Button variant="soft">View Logs</Button>
<Button variant="primary" disabled>Stop Sync</Button>
<Button variant="link">+ Create New Task</Button>
```

Variants: `primary` | `soft` | `ghost` | `link`. Props: `fullWidth`, `disabled`, plus all native `<button>` attributes. Buttons are `min-height: 36px`, weight 700, 6px radius; hover darkens (primary) or deepens the tint (soft).
