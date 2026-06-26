# 加固：限制无鉴权 API 的网络暴露面

## 背景

`pcloud-nas-sync` 的 HTTP API（`src/web/server.js` 的 `/api/*`）**自身没有任何鉴权**——
没有 token / session / 来源校验。它的访问控制完全依赖 fnOS 桌面反向代理：
`manifest` 中 `disable_authorization_path=false`，意味着 fnOS 会先要求用户登录，
再把请求代理到本应用。

问题在于 `app/docker/docker-compose.yaml` 把服务端口直接发布到 **宿主机所有网卡**：

```yaml
ports:
  - "${TRIM_SERVICE_PORT:-17880}:8080"
```

Docker 的 `host:container` 端口发布默认绑定 `0.0.0.0`。因此 `NAS-IP:17880` 这个
裸端口**绕过了 fnOS 的鉴权反代**，在局域网内任何人都能直接打到无鉴权的 API。

可被利用的危害（端口在 LAN 可达时）：

- `POST /api/config` / `POST /api/oauth/exchange`：把 `pcloud.accessToken`、
  `remoteRoot` 改成**攻击者自己的 pCloud 账号** → NAS 会把用户文件上传到攻击者云盘
  （数据外泄）。
- `GET /api/local-folders`、`GET /api/status`：枚举目录结构、文件列表、任务路径。
- `POST /api/scan`：触发扫描 / 上传。

> 注：`GET /api/config` 已对 `clientSecret` / `accessToken` 做 redact（返回 `***`），
> 攻击者**读不到**已保存的密钥；危害集中在“改写配置 + 触发外泄”，而非读取既有密钥。

## 对比

- **ebig / saas 参考**：本项目是独立的 fnOS Docker 应用，与 ruoyi 的 ebig/saas
  代码库无对应模块，无可比对的同类实现。fnOS 第三方应用的通行做法即“应用本身不做
  鉴权，由 fnOS 反代统一鉴权”，所以正确的边界是**不要把裸端口暴露到 LAN**，而不是
  在应用里再加一套鉴权（那会与反代的鉴权模型冲突，且反代未必透传凭据）。
- **Docker 通行加固**：对“仅供同机反代访问”的服务，标准做法是把发布地址绑到
  `127.0.0.1`，而不是 `0.0.0.0`。

## 决策

把发布端口默认绑定到宿主机 loopback，并保留环境变量可覆盖：

```yaml
ports:
  - "${TRIM_SERVICE_BIND:-127.0.0.1}:${TRIM_SERVICE_PORT:-17880}:8080"
```

- 默认 `127.0.0.1`：只有运行在宿主机上的 fnOS 反代能连到该端口，LAN 直连被阻断。
- `TRIM_SERVICE_BIND` 可被覆盖为 `0.0.0.0`：当维护者确实需要 LAN 直连并接受风险时
  仍可一键放开，改动可逆。
- 不在应用层新增鉴权：会与 fnOS 反代的鉴权模型冲突，且无法在本仓库验证，故不做。

### 未纳入本 PR 的后续项

- **容器以 root 运行**（`Dockerfile` 无 `USER`、`config/privilege` 为 `run-as: root`）：
  改为非 root 需处理 `/data` bind-mount 在真实 fnOS 上的属主/写权限，无法在本仓库验证，
  贸然修改可能导致安装后无法写状态文件。建议另开 follow-up，在真实 NAS 上验证后再改。
- `SyncEngine.recordUploadProgress()` 为死代码（`processPending` 调 `uploadFile` 未传
  `onProgress`）：与本次安全加固无关，留作单独清理。

## 用法

- 默认安装无需任何改动：fnOS 反代经 `127.0.0.1:17880` 访问应用，行为不变。
- 健康检查 `checkport=true` 由宿主机发起，`127.0.0.1:17880` 在宿主机本地可达，不受影响。
- 若需 LAN 直连（不推荐），在部署环境设置 `TRIM_SERVICE_BIND=0.0.0.0`。

## 测试

- `cd app/docker/pcloud-sync && node --test` —— 48 个测试全过（本次仅改 compose / 文档，
  不触碰应用代码，行为不变）。
- compose 语法：`ports` 三段式 `IP:host:container` 为 Docker Compose 合法写法。
- 人工核对：`disable_authorization_path=false` 与 loopback 绑定一致——访问控制交给 fnOS
  反代，裸端口不再对 LAN 暴露。
