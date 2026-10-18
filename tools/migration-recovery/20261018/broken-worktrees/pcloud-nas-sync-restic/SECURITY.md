# Security

This repository is intended to be public. Do not commit personal credentials or runtime state.

Never commit:

- pCloud Client Secret
- pCloud OAuth authorization code
- pCloud access token
- pCloud account password
- `.env` files
- `state.sqlite`, `state.sqlite-wal`, `state.sqlite-shm`, or legacy `state.json`
- generated `.fpk` packages that may contain local test state

The app stores runtime configuration and sync state in SQLite inside the Docker volume mounted at `/data`. That state is local to the NAS and is ignored by git.

If a secret is accidentally committed:

1. Revoke it in pCloud immediately.
2. Create a new Client Secret or access token.
3. Remove the leaked value from the repository history before making the repository public.

## Network Exposure

The app's HTTP API does not implement its own login session or API key. It is
designed to sit behind the fnOS desktop reverse proxy, with
`disable_authorization_path=false` in `manifest` so fnOS handles access control
before proxying requests to the app.

Because of that model, the raw service port must not be exposed directly to the
LAN. A client that can reach the unauthenticated API can read folder and file
status, change the pCloud sync target, and trigger uploads. In the worst case,
an attacker on the LAN could point the app at an attacker-owned pCloud account
and cause NAS files to be uploaded there.

`app/docker/docker-compose.yaml` binds the published host port to the NAS LAN by
default so the fnOS launcher can reach it:

```yaml
ports:
  - "${TRIM_SERVICE_BIND:-0.0.0.0}:${TRIM_SERVICE_PORT:-17880}:8080"
```

Only expose this port on a trusted LAN. Set `TRIM_SERVICE_BIND=127.0.0.1` when a
separate host-local reverse proxy is configured.
