# Hardening: limit the network exposure of the unauthenticated API

## Background

`pcloud-nas-sync`'s HTTP API (`/api/*` in `src/web/server.js`) has **no
authentication of its own** — no token / session / origin check. Access control
relies entirely on the fnOS desktop reverse proxy: `manifest` sets
`disable_authorization_path=false`, so fnOS requires a logged-in session before
proxying requests to the app.

The problem is that `app/docker/docker-compose.yaml` publishes the service port
directly on **every host interface**:

```yaml
ports:
  - "${TRIM_SERVICE_PORT:-17880}:8080"
```

Docker's `host:container` port publishing binds to `0.0.0.0` by default. So the
raw port `NAS-IP:17880` **bypasses the fnOS reverse proxy**, and anyone on the
LAN can hit the unauthenticated API directly.

Exploitable impact (when the port is reachable on the LAN):

- `POST /api/config` / `POST /api/oauth/exchange`: change `pcloud.accessToken` /
  `remoteRoot` to an **attacker-owned pCloud account** → the NAS uploads the
  user's files to the attacker's cloud (data exfiltration).
- `GET /api/local-folders`, `GET /api/status`: enumerate folder structure, file
  lists, and task paths.
- `POST /api/scan`: trigger scans / uploads.

> Note: `GET /api/config` already redacts `clientSecret` / `accessToken`
> (returns `***`), so an attacker **cannot read** the stored secrets; the risk
> is centered on "rewriting the config + triggering exfiltration," not reading
> existing secrets.

## Comparison

- **fnOS third-party app convention**: this is a standalone fnOS Docker app. The
  common pattern is "the app does no auth itself; the fnOS proxy handles auth
  uniformly," so the correct boundary is **not to expose the raw port to the
  LAN**, rather than adding a second auth layer inside the app (which would
  conflict with the proxy's auth model, and the proxy may not forward
  credentials).
- **Standard Docker hardening**: for a service meant to be reached only by a
  same-host proxy, the standard practice is to bind the published address to
  `127.0.0.1` rather than `0.0.0.0`.

## Decision

Bind the published port to the host loopback by default, keeping an
env-overridable escape hatch:

```yaml
ports:
  - "${TRIM_SERVICE_BIND:-127.0.0.1}:${TRIM_SERVICE_PORT:-17880}:8080"
```

- Default `127.0.0.1`: only the host-local fnOS proxy can reach the port; direct
  LAN access is blocked.
- `TRIM_SERVICE_BIND` can be overridden to `0.0.0.0`: when a maintainer truly
  needs direct LAN access and accepts the risk, it can still be opened with one
  setting — fully reversible.
- No app-level auth added: it would conflict with the fnOS proxy's auth model
  and cannot be validated in this repo, so it is out of scope.

### Follow-up items not in this PR

- **Container runs as root** (`Dockerfile` has no `USER`; `config/privilege` is
  `run-as: root`): switching to non-root requires handling `/data` bind-mount
  ownership/write permissions on a real fnOS install, which cannot be validated
  in this repo and could break state writes after install. Best done as a
  separate follow-up, validated on a real NAS.
- `SyncEngine.recordUploadProgress()` is dead code (`processPending` calls
  `uploadFile` without `onProgress`): unrelated to this hardening; left for a
  separate cleanup.

## Usage

- Default install needs no changes: the fnOS proxy reaches the app via
  `127.0.0.1:17880`; behavior is unchanged.
- The `checkport=true` health check is initiated from the host, and
  `127.0.0.1:17880` is reachable host-locally, so it is unaffected.
- If direct LAN access is needed (not recommended), set
  `TRIM_SERVICE_BIND=0.0.0.0` in the deployment environment.

## Testing

- `cd app/docker/pcloud-sync && node --test` — all 48 tests pass (this change
  only touches compose / docs, not app code; behavior unchanged).
- Compose syntax: the three-part `IP:host:container` form is valid Docker
  Compose.
- Manual check: `disable_authorization_path=false` is consistent with the
  loopback bind — access control is delegated to the fnOS proxy, and the raw
  port is no longer exposed to the LAN.
