# 修复：定时任务按配置时区触发（不再固定走容器 UTC）

## 背景

任务支持 `daily` / `weekly` 定时调度。调度是否到点由 `src/sync/engine.js` 的
`scheduleSlot` / `timeMatches` 判断，原实现用的是：

```js
function timeMatches(time, now) {
  const hour = String(now.getHours()).padStart(2, '0');   // 容器本地时区
  ...
}
function scheduleSlot(schedule, now) {
  ...
  if (!weekdays.includes(now.getDay())) { ... }            // 容器本地时区
}
```

`getHours()` / `getDay()` 用的是**容器进程的本地时区**。而
`docker-compose.yaml`、`Dockerfile`、`manifest` 都没有设置 `TZ`，Node 容器默认是
**UTC**。

## 问题

用户在 UI 设置"每天 09:30 备份"，期望是**本地时间**。但容器按 UTC 判断，于是：

- 马来西亚用户（UTC+8）：09:30 实际在本地 **17:30** 才触发，偏 8 小时；
- `weekly` 的"周几"在跨日时间点会错位到前一天/后一天。

`interval`（按固定间隔）模式只算时间差，不受影响——只有 `daily` / `weekly` 出错，
而这正是较新加入的功能。

## 对比

- **容器 `TZ` 方案的坑**：给 compose 加 `TZ=Asia/Kuala_Lumpur` 看似简单，但
  `node:alpine` 基础镜像**不带 `tzdata`**，musl libc 解析不了具名时区，`Date` 会静默
  回退到 UTC——必须再往 Dockerfile 里 `apk add tzdata`，且只有运维手动设了 `TZ` 才生效。
- **本方案（应用内时区 + Intl）**：用 Node 自带的 ICU（`Intl.DateTimeFormat`）按配置时区
  换算"墙上时间"，**不依赖系统 `tzdata`**，也不需要重建镜像/改环境变量；时区作为应用配置
  项，UI 可直接设置。更自洽，也更符合"应用自管行为"的边界。

## 决策

1. 新增同步配置项 `sync.timezone`（`src/config/config.js`）：
   - 用 `Intl.DateTimeFormat` 校验是否为合法 IANA 时区名；非法或留空时回退到**容器系统时区**
     （即保持改动前的行为，无回归）。
2. 调度判断改为时区感知（`src/sync/engine.js`）：
   - 新增 `zonedScheduleParts(now, timeZone)`，用 `Intl.DateTimeFormat(..., { timeZone })`
     的 `formatToParts` 取该时区下的 时/分/星期/日期；
   - `scheduleSlot` 据此比对 `HH:MM` 与 `weekday`，并用该时区的日期作为去重 slot key；
   - `taskIsDue` / `rememberTaskScheduleSlot` 透传 `sync.timezone`。
3. UI（`public/index.html` + `public/app.js`）：
   - "同步规则"区新增"定时任务时区"输入框；
   - 当已存时区仍是默认（UTC）时，前端**自动填入浏览器所在时区**，用户点一次"保存设置"
     即生效——开箱即可修正，又不强制。

> 默认值取"系统时区"而非写死 UTC，是为了**零回归**：现有部署（容器 UTC）行为不变，
> 直到用户显式设置时区。

## 用法

- 打开"设置 → 同步规则 → 定时任务时区"，确认/填写时区（如 `Asia/Kuala_Lumpur`），保存。
- 之后 `daily` / `weekly` 按该时区的"墙上时间"触发。
- `interval` 任务无需关心时区。

## 测试

- `cd app/docker/pcloud-sync && node --test` —— **122 项全过**。
- 新增用例：
  - `config.test.js`：合法时区保留、非法/空回退到系统时区；
  - `engine.test.js`：时区设为 `Asia/Kuala_Lumpur` 时，`daily 09:30` 在 **01:30 UTC** 触发、
    在 **09:30 UTC** 不触发（该用例与机器本地时区无关，旧的 `getHours()` 实现会失败）。

## 附带的小修

- `package.json` 的 `engines` 由 `>=22.5` 提升到 `>=22.13`：`node:sqlite` 在 22.x 上要到
  v22.13.0 才不再需要 `--experimental-sqlite`（已查 Node 官方文档确认）。`node:22-alpine`
  本就拉最新 22.x，实际可跑；提高下限只是避免有人 pin 22.5–22.12 时启动崩溃。
