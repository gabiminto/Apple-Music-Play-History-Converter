# Tauri App - Remaining Work

**Last Updated**: February 14, 2026  
**Status**: Active

## Current Focus

- Production packaging and signing validation
- Cross-platform runtime validation (especially Windows)
- Performance and security hardening

## TODO

### P0

- [ ] Validate production build/signing/notarization end-to-end.
- [ ] Verify bundled sidecar behavior in release artifacts.

### P1

- [ ] Full Windows QA pass.
- [ ] Performance benchmark pass for large CSV workflows.
- [ ] Security review for file handling, settings persistence, and token logging.

### P2

- [ ] Auto-updater support.
- [ ] Batch CSV processing.
- [ ] Expanded metrics dashboard.

## Verification Commands

```bash
cd tauri-app && npm run test
cd tauri-app/src-tauri && cargo check
cd tauri-app/python-sidecar && python3 test_sidecar.py
cd tauri-app/python-sidecar && python3 test_retry_rate_limited.py
```
