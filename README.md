# pCloud NAS Sync

fnOS pCloud NAS Sync is a Docker-based fnOS application for backing up selected NAS folders to pCloud with OAuth 2.0. It supports multiple one-way upload tasks, local and remote folder pickers, pCloud API based remote scanning, retry handling, detailed sync logs, and upload progress. The project is designed for personal self-hosted NAS backup and does not include any bundled pCloud credentials, user IDs, secrets, or tokens.

## 功能

- 多个 NAS 本地目录 -> pCloud 单向上传。
- 本地删除不会删除 pCloud 文件。
- Web UI 提供同步任务、同步日志和设置三个页面。
- 支持从 NAS 挂载目录中选择本地文件夹，并从 pCloud 目录树中选择或新建远端文件夹。
- 展示总文件数、成功数、失败数、待上传数、上传速度和可筛选的同步日志。
- 失败或卡住文件支持自动保留和手动重试，重试后会立即处理待上传队列。

## pCloud 授权

本应用使用 pCloud OAuth 2.0。仓库里不会内置任何 Client ID、Client Secret、access token 或个人账号信息，需要每个使用者自己去 pCloud 官方申请。

1. 打开 [pCloud for Developers](https://docs.pcloud.com/)。
2. 进入开发者文档里的 [My Apps](https://docs.pcloud.com/my_apps/) 创建 OAuth 应用，拿到 Client ID 和 Client Secret。
3. 如果你的账号看不到 My Apps、不能创建应用，或需要开通 API/OAuth 权限，请通过 [pCloud Contact Support](https://help.pcloud.com/contact) 联系官方，也可以写邮件到 `support@pcloud.com`，说明你要为个人/自建 NAS 同步工具申请 pCloud API OAuth app，申请 Client ID 和 Client Secret。
4. 打开授权地址获取 code：

   `https://my.pcloud.com/oauth2/authorize?client_id=<CLIENT_ID>&response_type=code`

5. 浏览器会要求登录 pCloud 账号并授权应用。授权完成后页面会显示一次性 code，通常 600 秒内有效。
6. 在应用 UI 填入 Client ID、Client Secret 和授权 Code，点击“换取 Token”。
7. 如果 pCloud 返回了数据中心 hostname，应用会自动保存并使用对应官方 API host，例如 `api.pcloud.com`、`eapi.pcloud.com` 或 pCloud 返回的区域 API host。

请不要把 Client Secret、授权 code、access token、`state.json` 或 `.env` 文件提交到公开仓库。`.gitignore` 已默认忽略常见运行状态和打包产物。

更多公开仓库安全注意事项见 [SECURITY.md](SECURITY.md)。

## 使用到的 pCloud API

当前同步逻辑只走 pCloud 官方 HTTP/JSON API：

- OAuth: `oauth2_token`
- 账号连通性: `userinfo`
- 远端目录浏览和比对: `listfolder`
- 远端目录创建: `createfolderifnotexists`
- 上传: `uploadfile`
- 上传服务器选择: `getapiserver`、`currentserver`
- 上传进度/速度: `uploadprogress` + `uploadfile` 的 `progresshash`
- 远端校验/后续增量能力: `checksumfile`、`diff`

本地文件夹选择来自 NAS 容器内可见目录，这部分不是 pCloud API 能提供的能力；远端文件夹选择、新建、上传、进度和校验相关能力都通过 pCloud API 实现。

## NAS 目录

默认 Docker Compose 只读挂载 `/vol1:/vol1:ro`。如果你的同步目录在 `/vol2` 或其他卷，请在 `app/docker/docker-compose.yaml` 里增加对应只读挂载，例如：

```yaml
volumes:
  - "/vol2:/vol2:ro"
```

UI 里可以通过“选择”按钮浏览容器可见路径，例如 `/vol1/1000/photos`。默认只读挂载 `/vol1`，因此选择器默认只能看到 `/vol1` 系列目录；新增其他卷后可在任务设置里选择。

## 基础镜像源

飞牛安装时会在 NAS 上构建 Docker 镜像。默认基础镜像使用国内 DaoCloud 镜像 `docker.m.daocloud.io/library/node:22-alpine`，避免 Docker Hub 短名 `node:22-alpine` 被 NAS 的 Docker Hub 代理解析到 `docker.fnnas.com` 后出现 401。

如果你的 NAS 无法访问 DaoCloud，可以在 `app/docker/docker-compose.yaml` 里把 `NODE_BASE_IMAGE` 改成你能访问的 Node 22 Alpine 镜像，例如：

```yaml
args:
  NODE_BASE_IMAGE: docker.m.daocloud.io/library/node:22-alpine
```

## 本地开发

```bash
cd app/docker/pcloud-sync
node --test
DATA_DIR="$(pwd)/.data" PORT=17880 node src/index.js
```

## 打包

在应用根目录执行：

```bash
fnpack build
```

官方 Docker 应用模板要求根目录包含 `manifest`、`cmd/main`、`config/resource`、`config/privilege`、`app/docker/docker-compose.yaml` 和 `app/ui/config`。本项目已按该结构组织。

## 当前限制

- v0.2.0 仍是单向上传，不做双向同步。
- v0.2.0 不传播本地删除到 pCloud。
- 文件变化目前通过定时扫描发现，默认 300 秒一次；也可以在 UI 手动触发扫描。
- 首次安装后的真实 FPK 行为建议在飞牛 NAS 上用应用中心实机验证。

## 变更记录

- v0.2.0: 升级为多任务模型，新增左侧导航、本地文件夹选择、pCloud 远端文件夹选择、远端新建文件夹和上传总速度；接入 `getapiserver`、`currentserver`、`uploadprogress`、`checksumfile` 和 `diff` 等 pCloud 官方 API；同步日志保留表格筛选，旧 `sources` 配置会自动迁移为任务。
- v0.1.9: 同步日志改为表格视图，支持按任务、状态和文件名筛选；成功上传会记录逐文件日志；重试失败或卡住文件后会立即处理待上传队列。
- v0.1.8: 修复 0 失败但仍有文件卡在 `uploading` 时重试和队列处理无法继续上传的问题，状态接口和页面显示运行版本及上传中文件明细。
- v0.1.7: 采用 rsync-like 远端真实比对，扫描 pCloud 目录后跳过已存在未变化文件，只上传远端缺失或已变化文件，并清理旧 `--` 状态。
- v0.1.6: 修复历史上传中断后文件长期停留在 `uploading` 导致无法重试的问题；迁移旧 `--` 远端目录名时保留内部状态并重新上传到正确目录。
- v0.1.5: 修复中文源目录名被自动转换成 `--` 远端文件夹的问题，并迁移旧的 `--` 配置。
- v0.1.4: 修复远端目录需逐级创建、状态文件并发保存冲突，并为上传增加 `Content-Length` 和瞬时断线重试。
- v0.1.3: 修复 OAuth access token 调用 pCloud API 时的参数名，改用 `access_token`。
