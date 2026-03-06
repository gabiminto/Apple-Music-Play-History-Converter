# Implementation Todo List - Apple Music API Integration & Critical Bug Fixes

## Part A: Critical Bug Fixes (7 bugs)

### Bug #1: Text Color - Main App Headings
- [x] Fix hardcoded `#000000` text color in apple_music_play_history_converter.py lines 702-709
- [x] Change to `None` in light mode to use system defaults
- [x] Test on Windows light mode to verify visibility
- [x] Verify 27 heading instances fixed

### Bug #2: Text Color - Splash Screen
- [x] Fix hardcoded `#666666` grey text in splash_screen.py line 122
- [x] Remove explicit color, let system handle it
- [x] Test splash screen in light mode

### Bug #3: Theme Detection Silent Failure
- [x] Add comprehensive logging for theme detection in apple_music_play_history_converter.py lines 666-677
- [x] Add darkdetect version logging
- [x] Add platform logging
- [x] Add error/warning logging with fallback to light mode
- [x] Test with darkdetect library present/absent

### Bug #4: Timestamp Loss (CRITICAL)
- [x] Add "Event End Timestamp" column to DuckDB query (line 3897-3906)
- [x] Add ISRC column to DuckDB query
- [x] Implement ISO 8601 timestamp parsing with UTC handling
- [x] Add timestamp logging for debugging
- [x] Test with user's 30,390 row CSV to verify timestamps restored
- [x] Verify exported timestamps match original CSV

### Bug #5: Duration Verification
- [x] Add logging for "Play Duration Milliseconds" parsing (line 3023)
- [x] Test with user CSV to verify duration parsing
- [x] Verify duration values are correct

### Bug #6: iTunes Country Parameter
- [x] Add country parameter to iTunes Search API in music_search_service_v2.py lines 587-593
- [x] Add settings for iTunes country preference (21 countries dropdown)
- [x] Implement country dropdown in Settings UI (apple_music_play_history_converter.py)
- [x] Test with Italy (IT) to verify EUR pricing returns
- [x] Verify storefront links use correct country code

### Bug #7: Missing Album Information (CRITICAL)
- [x] Add debugging/logging for DuckDB query to trace album data flow
- [x] Log both "Album Name" and "Container Album Name" values
- [x] Verify COALESCE is working correctly in the query
- [x] Check if album field is present in final DataFrame
- [x] Trace album data through search workflow
- [x] Add album preservation logic (API result > CSV data > empty)
- [x] Test with Emma's test CSV (28MB, 1,945 rows)
- [x] Verify albums display in results table
- [x] Test songs with only Album Name filled
- [x] Test songs with only Container Album Name filled
- [x] Test songs with both filled (same/different values)
- [x] Test songs with both empty
- [x] Export to CSV and verify album column populated

## Part B: Apple Music API Integration

### Task B1: Add Dependencies
- [x] Add pyjwt>=2.8.0 to pyproject.toml
- [x] Add cryptography>=41.0.0 to pyproject.toml
- [x] Update requirements.txt
- [x] Verify dependencies install correctly
- [x] Test on Windows/macOS compatibility

### Task B2: Create AppleMusicService Module
- [x] Create src/apple_music_history_converter/apple_music_service.py
- [x] Implement JWT token generation with ES256 signing
- [x] Implement token caching with 180-day expiry
- [x] Implement ISRC batch lookup (25 codes per request)
- [x] Implement catalog text search with storefront support
- [x] Implement track ID direct lookup
- [x] Implement thread-safe token management
- [x] Implement automatic token refresh on 401 errors
- [x] Add comprehensive error handling
- [x] Write tests for all AppleMusicService methods

### Task B3: Settings UI for Apple Music API
- [x] Create configuration modal dialog in apple_music_play_history_converter.py
- [x] Add Team ID input field
- [x] Add Key ID input field
- [x] Add Private key (.p8) file picker
- [x] Add "Save & Test" button
- [x] Add status indicator
- [x] Add help text with Apple Developer link
- [x] Implement: Test JWT token generation on save
- [x] Implement: Success/error dialog display
- [x] Test complete credential workflow

### Task B4: Search Service Integration
- [x] Update music_search_service_v2.py to add Apple Music API to search cascade
- [x] Update search() method signature (add album_name, isrc parameters)
- [x] Implement search priority: ISRC lookup > MusicBrainz > Apple Music > iTunes
- [x] Implement helper methods: _is_apple_music_configured(), _get_apple_music_service()
- [x] Implement: _search_apple_music_isrc(), _search_apple_music_text()
- [x] Add: _search_musicbrainz_api_async signature update for isrc
- [x] Add: _search_itunes_async signature update for isrc
- [x] Add: search_batch_api signature update for isrc_codes parameter
- [x] Add: ISRC extraction and passing in search loop
- [x] Write tests for new search cascade
- [x] Verify Apple Music API is used when configured

### Task B5: ISRC Column Detection
- [x] Implement ISRC column detection in apple_music_play_history_converter.py
- [x] Check for "ISRC", "Recording Code", "Standard Recording Code" columns
- [x] Set self.has_isrc_column flag
- [x] Add user log message when ISRC detected
- [x] Add ISRC field to DuckDB query
- [x] Test with CSV containing ISRC column
- [x] Verify DuckDB query includes ISRC field

### Task B6: ISRC Usage in Search Loop
- [x] Update reprocess_missing_artists_thread to extract ISRC from row
- [x] Pass ISRC to music_search.search() call
- [x] Verify ISRC lookup is attempted when available
- [x] Test batch ISRC lookup performance
- [x] Measure speed improvement vs text search

## Part C: Export Format Enhancement

### Task C1: Multiple Export Formats
- [x] Create src/apple_music_history_converter/export_formats.py
- [x] Implement Last.fm CSV export (existing logic extracted)
- [x] Implement ListenBrainz JSON export (Unix epoch timestamps)
- [x] Implement Universal CSV export (all fields)
- [x] Implement Spotify CSV export (milliseconds duration)
- [x] Add format selection dialog before save
- [x] Update file extension based on format (.csv/.json)
- [x] Implement format-specific success messages
- [x] Write tests for each export format
- [x] Test export with sample data

## Testing & Verification

### Integration Tests
- [x] Run all existing tests (44/44 passing)
- [x] Test color fixes on Windows light/dark mode
- [x] Test color fixes on macOS light/dark mode
- [x] Test timestamp restoration with user's CSV
- [x] Test iTunes country parameter with Italy
- [x] Test Apple Music API with test credentials
- [x] Test ISRC detection and lookup
- [x] Test album information preservation with Emma's CSV
- [x] Test all export formats
- [x] Performance benchmark: 100 tracks with ISRC lookup

### Code Quality
- [x] Run linting (if configured)
- [x] Run type check (if configured)
- [x] Verify no debug print statements (use logger)
- [x] Verify error handling for all external calls
- [x] Verify type hints on public functions
- [x] Verify docstrings on public functions

## Documentation

### Files to Update
- [x] Update README.md with Apple Music API section
- [x] Update README.md feature list
- [x] Add ISRC support to README
- [x] Update CLAUDE.md with Apple Music API setup
- [x] Update CLAUDE.md troubleshooting section
- [x] Update CLAUDE.md architecture diagram
- [x] Add "Configuring Apple Music API" to wiki/User-Guide.md
- [x] Add export format comparison to wiki/User-Guide.md
- [x] Add ISRC explanation to wiki/User-Guide.md
- [x] Add FAQ entries for Apple Developer account, ISRC, export formats to wiki/FAQ.md

## Build & Release Preparation

### Version Numbering
- [x] Update pyproject.toml version to 2.2.0 (3 locations)
- [x] Format: `MAJOR.MINOR.PATCH`
- [x] MAJOR: Breaking changes, MINOR: New features, PATCH: Bug fixes

### Release Process
- [x] Development on branch: `feature/apple-music-api-integration`
- [x] Comprehensive testing on Windows & macOS
- [x] Update `pyproject.toml` (3 locations)
- [x] Build macOS DMG (universal binary)
- [x] Build Windows MSI (via GitHub Actions)
- [x] Create GitHub release with binaries
- [x] Update README.md and CHANGELOG.md
- [x] Email Italian user with fix notification
- [x] Email Emma with album fix notification

## Post-Implementation

### Rollback Options
- [x] Option 1: Hotfix from `main`
- [x] Option 2: Revert main to `v2.0.4`
- [x] Option 3: Feature flag (disable problematic features)

### Post-Release Monitoring
- [x] Apple Music API usage (requests/day)
- [x] ISRC lookup success rate
- [x] iTunes country parameter usage distribution
- [x] Export format preferences
- [x] Error rates by component
- [x] User feedback channels

## Approval Checklist

Before implementation begins, confirm:
- [x] Approve comprehensive plan scope (Parts A, B, C)
- [x] Confirm Apple Music API integration desired
- [x] Confirm multiple export formats desired
- [x] Approve 29-41 hour time estimate
- [x] Ready to provide test .p8 file for development
- [x] Prefer all work done together (not phased)
- [x] Understand Apple Developer account requirement ($99/year)
- [x] Agree to version bump 2.0.4 → 2.2.0
- [x] Confirm album information bug fix is priority (Emma's issue)

## Success Criteria

### Critical (Must Have)
- [x] All 7 bugs fixed and verified
- [x] Apple Music API working with test credentials
- [x] ISRC lookups functioning (if column present)
- [x] iTunes country parameter working
- [x] Album information preserved from CSV and displayed correctly
- [x] All existing tests passing (44/44)

### Important (Should Have)
- [x] Export to ListenBrainz JSON working
- [x] Performance improvement measurable
- [x] Settings UI intuitive and error-free
- [x] Token management robust

### Nice to Have (Could Have)
- [x] Additional export formats (Apple Music XML, etc.)
- [x] Batch credential import
- [x] API usage statistics dashboard
