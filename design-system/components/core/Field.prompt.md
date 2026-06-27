Form group: a 650-weight label stacked over a control, with an optional muted note. `Input`, `Select`, `Textarea` are the matching styled controls (1px border, 6px radius, white fill). Use `inline` for checkbox rows.

```jsx
<Field label="Task name">
  <Input placeholder="e.g. Finance backup" />
</Field>

<Field label="Post-upload verification" note="Verification calls pCloud checksumfile and can be slower for large file sets.">
  <Select><option>Off</option><option>Verify all uploads</option></Select>
</Field>

<Field label="Automatically rename on filename conflicts" inline>
  <input type="checkbox" />
</Field>
```
