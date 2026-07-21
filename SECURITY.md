# Security

This repository is intended to be public. Do not commit personal credentials or runtime state.

Never commit:

- pCloud Client Secret
- pCloud OAuth authorization code
- pCloud access token
- pCloud account password
- `encryption.key`
- `.env` files
- `state.sqlite`, `state.sqlite-wal`, `state.sqlite-shm`, or legacy `state.json`
- generated `.fpk` packages that may contain local test state

The app stores runtime configuration and sync state in SQLite inside the Docker volume mounted at `/data`. That state is local to the NAS and is ignored by git.

If upload encryption is enabled, the app also stores `/data/encryption.key`.
That key allows unattended scheduled uploads, but anyone who can read it can
decrypt files uploaded by this app. Back it up securely and keep it out of git,
support bundles, screenshots, and public issue reports.

The Settings page can export the existing key for backup. Treat the downloaded
`encryption.key` exactly like the NAS copy: store it offline and never share it.

If a secret is accidentally committed:

1. Revoke it in pCloud immediately.
2. Create a new Client Secret or access token.
3. Remove the leaked value from the repository history before making the repository public.

## Network Exposure

The app's HTTP API does not implement its own login session or API key. Real
fnOS app center launches this app as an iframe that connects to the NAS LAN
address and the configured service port, so the package publishes the service
port on the LAN by default.

A client that can reach the unauthenticated API can read folder and file status,
change the pCloud sync target, and trigger uploads. In the worst case, an
attacker on the LAN could point the app at an attacker-owned pCloud account and
cause NAS files to be uploaded there. Install this package only on a trusted LAN.

`app/docker/docker-compose.yaml` binds the published host port to all interfaces
by default so the fnOS iframe can open the app:

```yaml
ports:
  - "${TRIM_SERVICE_BIND:-0.0.0.0}:${TRIM_SERVICE_PORT:-17880}:8080"
```

Set `TRIM_SERVICE_BIND=127.0.0.1` only when a separate host-local reverse proxy
is handling access and direct fnOS iframe launch is not required.

## Storage Access

The package must not receive an entire NAS storage space. 小皓OS mounts only the
directories selected in the installation plan below `/sources` as read-only and
uses a separate writable `/restore` mount. Direct fnOS installations must set
`PCLOUD_SOURCE_DIR` and `RESTIC_RESTORE_DIR` to equally narrow directories.
