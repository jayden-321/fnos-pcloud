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

