# pCloud NAS Sync

fnOS pCloud NAS Sync is a Docker-based fnOS application for backing up selected NAS folders to pCloud with OAuth 2.0. It supports multiple one-way upload tasks, local and remote folder pickers, pCloud API based remote scanning, retry handling, detailed sync logs, and upload progress. The project is designed for personal self-hosted NAS backup and does not include any bundled pCloud credentials, user IDs, secrets, or tokens.

## Features

- One-way uploads from multiple NAS folders to pCloud.
- Local deletions are not propagated to pCloud.
- Web UI with Sync Tasks, Sync Logs, and Settings pages.
- Local folder picker for NAS paths that are visible inside the container.
- pCloud remote folder picker and remote folder creation.
- Summary metrics for total files, synced files, failed files, pending files, active uploads, and aggregate upload speed.
- Filterable file-level sync logs with file size and active upload progress.
- Configurable sync log retention by age and count, plus one-click log deletion.
- Failed or stale uploading files can be retried manually; queued files are processed immediately after retry.
- Active sync runs can be stopped from the web UI; stopped uploads return to the pending queue.
- The raw app port binds to host loopback by default so unauthenticated APIs stay behind the fnOS reverse proxy.

## pCloud Authorization

This app uses pCloud OAuth 2.0. The repository does not include any Client ID, Client Secret, access token, or personal account data. Each user must request and configure their own pCloud API/OAuth application credentials.

1. Open [pCloud for Developers](https://docs.pcloud.com/).
2. Open [My Apps](https://docs.pcloud.com/my_apps/) and create an OAuth app to obtain a Client ID and Client Secret.
3. If your account cannot access My Apps, cannot create an app, or needs API/OAuth access enabled, contact [pCloud Support](https://help.pcloud.com/contact). You can also email `support@pcloud.com` and explain that you need a pCloud API OAuth app for a personal self-hosted NAS sync tool.
4. Open the authorization URL and replace `<CLIENT_ID>` with your app Client ID:

   `https://my.pcloud.com/oauth2/authorize?client_id=<CLIENT_ID>&response_type=code`

5. Sign in to pCloud and authorize the app. pCloud will show a one-time authorization code, usually valid for 600 seconds.
6. In the app UI, enter the Client ID, Client Secret, and authorization code, then click the token exchange button.
7. If pCloud returns a data-center hostname, the app saves and uses that official API host, such as `api.pcloud.com`, `eapi.pcloud.com`, or a regional pCloud API host.

Do not commit Client Secrets, authorization codes, access tokens, `state.json`, or `.env` files to a public repository. Common runtime state and package artifacts are ignored by `.gitignore`.

See [SECURITY.md](SECURITY.md) for public-repository safety notes.

## pCloud APIs Used

The sync logic uses the official pCloud HTTP/JSON API:

- OAuth: `oauth2_token`
- Account connectivity: `userinfo`
- Remote browsing and comparison: `listfolder`
- Remote folder creation: `createfolderifnotexists`
- Uploads: `uploadfile`
- Upload server selection: `getapiserver`, `currentserver`
- Upload progress and speed: `uploadprogress` plus the `progresshash` parameter on `uploadfile`
- Remote verification and future incremental features: `checksumfile`, `diff`

The local folder picker reads NAS paths that are mounted into the Docker container. pCloud does not provide an API for local NAS filesystem browsing. Remote folder browsing, remote folder creation, uploads, progress, and verification-related features are implemented through pCloud APIs.

## NAS Folder Mounts

The default Docker Compose file mounts `/vol1` read-only:

```yaml
volumes:
  - "/vol1:/vol1:ro"
```

If your sync folders are on `/vol2` or another volume, add the matching read-only mount in `app/docker/docker-compose.yaml`, for example:

```yaml
volumes:
  - "/vol2:/vol2:ro"
```

The UI folder picker can browse paths that are visible inside the container, such as `/vol1/1000/photos`. By default, only `/vol1` is mounted and visible. Add more volume mounts if you need to browse other NAS volumes.

## Base Image

fnOS builds the Docker image on the NAS during installation. The default base image is the DaoCloud mirror `docker.m.daocloud.io/library/node:22-alpine`, which avoids Docker Hub proxy issues that can happen when the NAS resolves `node:22-alpine` through `docker.fnnas.com`.

If your NAS cannot access DaoCloud, edit `app/docker/docker-compose.yaml` and set `NODE_BASE_IMAGE` to a Node 22 Alpine image that your NAS can pull:

```yaml
args:
  NODE_BASE_IMAGE: docker.m.daocloud.io/library/node:22-alpine
```

## Network Exposure

The app API does not have built-in authentication. It is intended to be reached
through the fnOS desktop reverse proxy, which performs login enforcement before
proxying requests to the app. For that reason, Docker Compose binds the raw
service port to `127.0.0.1` by default:

```yaml
ports:
  - "${TRIM_SERVICE_BIND:-127.0.0.1}:${TRIM_SERVICE_PORT:-17880}:8080"
```

Only set `TRIM_SERVICE_BIND=0.0.0.0` if direct LAN access is intentional and you
accept that it bypasses fnOS reverse-proxy authorization. See
[SECURITY.md](SECURITY.md) for details.

## Local Development

```bash
cd app/docker/pcloud-sync
node --test
DATA_DIR="$(pwd)/.data" PORT=17880 node src/index.js
```

## Packaging

Run this from the app root:

```bash
fnpack build
```

The fnOS Docker app template expects the root directory to include `manifest`, `cmd/main`, `config/resource`, `config/privilege`, `app/docker/docker-compose.yaml`, and `app/ui/config`. This repository is organized around that structure.

## Current Limitations

- v0.2.4 is one-way upload only, not two-way sync.
- v0.2.4 does not propagate local deletions to pCloud.
- File changes are discovered by periodic scans. The default interval is 300 seconds, and users can trigger a manual scan in the UI.
- Real installation behavior should still be validated on an fnOS NAS through the app center.

## Changelog

- v0.2.4: Removes the default pCloud root setting from the UI, treats each task's pCloud folder as the exact remote destination, opens the remote picker from root when no folder is selected, and adds a Stop Sync action that aborts active uploads back to pending.
- v0.2.3: Adds file size and active upload progress to Sync Logs, fixes unrealistic upload speed spikes by treating the first pCloud `uploadprogress` response as a baseline, and binds the raw app port to host loopback by default.
- v0.2.2: Adds configurable sync log retention by age and count, plus a one-click log delete action. Settings now shows task configuration first, documents that pCloud official upload docs do not publish a recommended concurrency number, and removes decorative sidebar branding.
- v0.2.1: Bumps the package version for fnOS installation and upgrade detection. Sync logs now show file-level upload rows, task cards are compact, saved access tokens display a masked value, and deleting all tasks also clears migrated legacy `sources`.
- v0.2.0: Adds a multi-task model, left navigation, local folder picker, pCloud remote folder picker, remote folder creation, and aggregate upload speed. Adds pCloud API integration for `getapiserver`, `currentserver`, `uploadprogress`, `checksumfile`, and `diff`.
- v0.1.9: Converts sync logs into a table view with task, status, and filename filters. Successful uploads now create per-file log entries. Retrying failed or stale files immediately drains the pending queue.
- v0.1.8: Fixes files stuck in `uploading` when the failed count is zero. Status API and UI now show the running version and uploading-file details.
- v0.1.7: Adds rsync-like remote comparison. The app scans the pCloud destination, skips unchanged remote files, uploads missing or changed files, and cleans old `--` state.
- v0.1.6: Recovers stale `uploading` files after interrupted uploads. Legacy `--` remote directory migrations preserve internal state and re-upload to the corrected directory.
- v0.1.5: Fixes non-ASCII source folder names being converted into `--` remote folders and migrates old `--` config.
- v0.1.4: Fixes parent folder creation, concurrent state-file writes, upload `Content-Length`, and transient socket reset retries.
- v0.1.3: Fixes pCloud API calls to use the OAuth `access_token` parameter.
- v0.1.2: Switches the default base image to a DaoCloud mirror for easier installation in China.
- v0.1.1: Fixes fnOS installation failures caused by Docker Hub proxy 401 errors when pulling `node:22-alpine`.
- v0.1.0: Initial one-way sync release with pCloud authorization, folder config, status metrics, and failed-file retry.
