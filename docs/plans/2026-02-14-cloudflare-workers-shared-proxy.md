# Cloudflare Workers Shared Apple Music Proxy (Option B)

**Date**: February 14, 2026  
**Decision**: Use one shared Cloudflare Worker backend for consumer-friendly setup.

## Scope

- Keep Apple `.p8` private key server-side only.
- Let app users call a shared proxy URL.
- Add minimal abuse controls and a shutdown switch.

## Implemented

1. Cloudflare Worker project added at:
   - `cloudflare-worker/apple-music-proxy`
2. Worker features:
   - Apple developer-token signing (ES256) server-side.
   - Endpoints:
     - `/v1/search`
     - `/v1/isrc`
     - `/v1/songs/:id`
     - `/v1/test`
     - `/health`
   - Durable Object global per-IP rate limiting.
   - Optional `x-proxy-key` guard.
   - Kill switch (`PROXY_ENABLED=false`).
3. App integration:
   - `AppleMusicService` supports `proxy_base_url` + optional `proxy_api_key`.
   - `MusicSearchServiceV2` treats `apple_music_proxy_url` as valid Apple Music config.
   - Tauri Services UI supports:
     - Cloudflare Proxy URL
     - Optional Proxy Access Key
   - Sidecar saves and uses proxy settings.

## Required Secrets (Cloudflare)

- `APPLE_MUSIC_TEAM_ID`
- `APPLE_MUSIC_KEY_ID`
- `APPLE_MUSIC_PRIVATE_KEY`

Optional:
- `PROXY_ACCESS_KEY`

## Operational Notes

- Build-time embedding of secrets in client binaries is still extractable.
- Shared proxy can be abused; if needed, disable quickly by setting:
  - `PROXY_ENABLED=false`
  - redeploy Worker
