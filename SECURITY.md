# Security

This repository is intended to be public. Do not commit personal credentials or runtime state.

Never commit:

- pCloud Client Secret
- pCloud OAuth authorization code
- pCloud access token
- pCloud account password
- `.env` files
- `state.json`
- generated `.fpk` packages that may contain local test state

The app stores runtime configuration inside the Docker volume mounted at `/data`. That state is local to the NAS and is ignored by git.

If a secret is accidentally committed:

1. Revoke it in pCloud immediately.
2. Create a new Client Secret or access token.
3. Remove the leaked value from the repository history before making the repository public.

## Network exposure

The app's HTTP API has no authentication of its own. It relies on the fnOS
desktop reverse proxy for access control (`manifest` sets
`disable_authorization_path=false`, so fnOS requires a logged-in session before
proxying requests).

Because of this, the raw service port must not be reachable from the LAN. Any
client that can reach the unauthenticated API directly can read folder and file
listings and, more importantly, overwrite the pCloud sync target (for example
point it at an attacker-owned access token) and trigger uploads. That would let
an attacker redirect your NAS backups to their own pCloud account.

To prevent this, `app/docker/docker-compose.yaml` binds the published port to
the host loopback (`127.0.0.1`) by default, so only the host-local fnOS proxy
can reach it. Do not change `TRIM_SERVICE_BIND` to `0.0.0.0` unless you
specifically need direct LAN access and accept the risk above.

