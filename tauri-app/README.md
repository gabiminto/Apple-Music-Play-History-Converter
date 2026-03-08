# Tauri App

This directory contains the desktop application:

- React + TypeScript frontend in `src`
- Rust/Tauri host in `src-tauri`
- bundled Python sidecar in `python-sidecar`

## Scripts

```bash
npm run dev
npm run test
npm run build
npm run build:sidecar
npm run build:release
npm run tauri dev
npm run tauri build
```

## Development

```bash
cd tauri-app
npm install
npm run tauri dev
```

`npm run tauri dev` uses the Python sidecar source directly during development.

## Release Builds

`npm run tauri build` runs the configured `beforeBuildCommand`, which is `npm run build:release`.

That release build:

1. builds the frontend
2. bundles the Python sidecar with PyInstaller
3. packages the app with Tauri

Release builds are intended to be self-contained for end users. They should not depend on a user-installed Python runtime or pip packages.

### macOS

- Default local builds are ad-hoc signed
- For a distributable build, set:
  - `APPLE_SIGNING_IDENTITY`
  - `APPLE_ID`
  - `APPLE_TEAM_ID`
  - `APPLE_PASSWORD`
- If your shell environment stores `APPLE_APP_SPECIFIC_PASSWORD`, export `APPLE_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"` before building

### Windows

- Windows builds bundle the offline WebView2 installer
- Current release builds produce unsigned `.msi` and `.exe` installers

## Release Outputs

Packaged binaries are written under:

- `src-tauri/target/release/bundle/dmg`
- `src-tauri/target/release/bundle/macos`
- `src-tauri/target/release/bundle/msi`
- `src-tauri/target/release/bundle/nsis`

## Logs

If you need user diagnostics:

- macOS logs: `~/Library/Logs/AppleMusicConverter`
- Windows logs: `%LOCALAPPDATA%\AppleMusicConverter\Logs`

## Canonical Release Guide

Use the repository-level guide for the full release process:

- `../docs/RELEASING.md`
- `../AGENTS.md`
