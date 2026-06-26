# Hardening Raw API Network Exposure

## Background

`pcloud-nas-sync` exposes HTTP API routes under `/api/*`. Those routes do not
implement their own login session, API key, or request origin check. Access
control is expected to come from the fnOS desktop reverse proxy. The app
manifest keeps `disable_authorization_path=false`, so fnOS should require a
logged-in session before proxying requests to the app.

The previous Docker Compose port mapping published the app on every host
interface:

```yaml
ports:
  - "${TRIM_SERVICE_PORT:-17880}:8080"
```

Docker treats that form as a `0.0.0.0` bind. On a NAS, that means
`NAS-IP:17880` can reach the raw app directly and bypass the fnOS reverse proxy.

## Risk

When the raw port is reachable from the LAN, any LAN client can call the
unauthenticated API. The saved pCloud access token is redacted by `GET
/api/config`, but an attacker can still:

- read sync status, task paths, folder listings, and file names;
- overwrite configuration, including the pCloud sync target;
- exchange an OAuth code for a different pCloud account;
- trigger scans and uploads.

The most serious outcome is data exfiltration: an attacker can configure the app
to upload NAS files to an attacker-controlled pCloud account.

## Decision

The app now binds the published host port to loopback by default:

```yaml
ports:
  - "${TRIM_SERVICE_BIND:-127.0.0.1}:${TRIM_SERVICE_PORT:-17880}:8080"
```

This keeps the raw API reachable to the host-local fnOS reverse proxy while
blocking direct LAN access to the published port. The bind address remains
overridable for unusual deployments:

```sh
TRIM_SERVICE_BIND=0.0.0.0
```

That override should only be used when direct LAN access is intentional and the
operator accepts that it bypasses fnOS reverse-proxy authorization.

## Follow-Up Items

- Running the container as a non-root user would be a useful defense-in-depth
  improvement, but it needs validation on real fnOS installs because `/data`
  bind-mount ownership can break state writes.
- Adding separate app-level authentication would change the fnOS integration
  model and needs a design pass before implementation.

## Verification

- `node --test` covers the Docker Compose bind default with
  `test/security.test.js`.
- `docker-compose -f app/docker/docker-compose.yaml config` should render the
  port mapping as `127.0.0.1:17880:8080` when `TRIM_SERVICE_BIND` is unset.
