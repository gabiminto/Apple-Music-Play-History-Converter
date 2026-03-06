# Apple Music Play History Converter

Desktop app for converting Apple Music CSV exports into multiple output formats, built with Tauri + React + TypeScript + Rust, with a Python sidecar for matching/search/export logic.

## Current Stack

- Frontend: Tauri + React + Vite
- Backend host: Rust (`tauri-app/src-tauri`)
- Search/export engine: Python sidecar (`tauri-app/python-sidecar/sidecar.py`)
- Shared Python modules: `src/apple_music_history_converter`

## Features

- Apple Music CSV analysis and preview
- Search providers:
  - MusicBrainz local database
  - MusicBrainz API
  - iTunes API
  - Apple Music API (credentials or shared proxy)
- Export formats:
  - Last.fm CSV
  - ListenBrainz JSON
  - Spotify CSV
  - Universal CSV
  - iTunes XML
- Retry for missing/rate-limited tracks
- Resume support and settings persistence

## Development

### Prerequisites

- Node.js 20+
- Rust toolchain
- Python 3.8+

### Install dependencies

```bash
cd tauri-app
npm install

cd python-sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run app

```bash
cd tauri-app
npm run tauri dev
```

## Verification

```bash
cd tauri-app && npm run test
cd tauri-app/src-tauri && cargo check
cd tauri-app/python-sidecar && python3 test_sidecar.py
cd tauri-app/python-sidecar && python3 test_retry_rate_limited.py
```

## Project Layout

- `tauri-app/`: Tauri application (frontend + Rust backend)
- `tauri-app/python-sidecar/`: Sidecar runtime and sidecar tests
- `src/apple_music_history_converter/`: Shared Python backend modules used by sidecar
- `_test_csvs/`: Test CSV fixtures
- `cloudflare-worker/apple-music-proxy/`: Shared Apple Music proxy worker
