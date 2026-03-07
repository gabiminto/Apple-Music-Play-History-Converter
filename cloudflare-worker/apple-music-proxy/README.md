# Apple Music Proxy (Cloudflare Workers Free)

Shared Apple Music proxy for consumer builds. The Apple private key stays on Cloudflare as a secret and is never shipped in the app.

## What This Worker Does

- Signs Apple Music developer tokens server-side using your `.p8` key
- Proxies these endpoints:
  - `GET /v1/search?term=...&storefront=us&limit=5`
  - `GET /v1/isrc?codes=USRC...,GBUM...&storefront=us`
  - `GET /v1/songs/:id?storefront=us`
  - `GET /v1/test`
  - `GET /health`
- Applies global per-IP rate limiting via Durable Objects
- Supports optional `x-proxy-key` header check
- Supports kill switch (`PROXY_ENABLED=false`)

## Required Secrets

Set these with `wrangler secret put`:

- `APPLE_MUSIC_TEAM_ID`
- `APPLE_MUSIC_KEY_ID`
- `APPLE_MUSIC_PRIVATE_KEY` (paste full `.p8` content, including BEGIN/END lines)

Optional:

- `PROXY_ACCESS_KEY` (if set, requests must send `x-proxy-key`)

## Optional Variables

Set these with `wrangler secret put` or `[vars]` in `wrangler.toml`:

- `REQUESTS_PER_MINUTE` (default `120`)
- `DEVELOPER_TOKEN_TTL_SECONDS` (default `3600`, min `300`, max `15552000`)
- `PROXY_ENABLED` (`true` by default; set `false` to disable quickly)

## Local Setup

```bash
cd cloudflare-worker/apple-music-proxy
npm install
cp .dev.vars.example .dev.vars
# fill .dev.vars values
npm run dev
```

## Deploy

```bash
cd cloudflare-worker/apple-music-proxy
npm run deploy
```

After deploy, copy your Worker URL (for example `https://apple-music-proxy.<subdomain>.workers.dev`) into the app’s **Apple Music > Cloudflare Proxy URL** field and save.

## Security Notes

- Do not hardcode Apple Team ID/Key ID/private key in app binaries or source.
- Build-time embedding in desktop apps is still extractable.
- If abuse happens, set `PROXY_ENABLED=false` and redeploy.
