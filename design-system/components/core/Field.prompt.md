Form group: a 650-weight label stacked over a control, with an optional muted note. `Input`, `Select`, `Textarea` are the matching styled controls (1px border, 6px radius, white fill). Use `inline` for checkbox rows.

```jsx
<Field label="任务名称">
  <Input placeholder="例如 财务备份" />
</Field>

<Field label="上传后校验" note="校验会调用 pCloud checksumfile，文件多时会更慢。">
  <Select><option>不校验</option><option>全部校验</option></Select>
</Field>

<Field label="文件名冲突时自动重命名" inline>
  <input type="checkbox" />
</Field>
```
