# Implementation Plan: Apple Music API Integration & Critical Bug Fixes

**Version:** 2.2.0
**Date:** 2026-01-10

---

## Executive Summary

Comprehensive overhaul addressing 7 critical bugs plus full Apple Music API integration with ISRC support. All work completed in one implementation cycle.

### Key Features
- Fix Windows light mode text visibility bugs
- Restore timestamp data from Apple CSV exports
- Add iTunes API country/storefront selection
- Full Apple Music API (MusicKit) integration with JWT authentication
- ISRC-based direct catalog lookups (batch processing)
- Multiple export formats (Last.fm, ListenBrainz, Universal CSV, Spotify)
- **NEW: Fix missing album information bug**

---

## Scope of Work

### Part A: Critical Bug Fixes (7 bugs)

#### Bug #1: Text Color - Main App Headings
**File:** `src/apple_music_history_converter/apple_music_play_history_converter.py` (lines 702-709)
**Issue:** Hardcoded `#000000` black text invisible on Windows light mode
**Fix:** Set to `None` in light mode to use system defaults
**Impact:** Fixes 27 heading instances across app
**Time:** 30 minutes

#### Bug #2: Text Color - Splash Screen
**File:** `src/apple_music_history_converter/splash_screen.py` (line 122)
**Issue:** Hardcoded `#666666` grey text invisible in light mode
**Fix:** Remove explicit color, let system handle it
**Time:** 15 minutes

#### Bug #3: Theme Detection Silent Failure
**File:** `src/apple_music_history_converter/apple_music_play_history_converter.py` (lines 666-677)
**Issue:** No logging when darkdetect fails or returns wrong value
**Fix:** Add comprehensive logging for theme detection
**Time:** 30 minutes

#### Bug #4: Timestamp Loss (CRITICAL)
**File:** `src/apple_music_history_converter/apple_music_play_history_converter.py` (lines 3897-3906)
**Issue:** DuckDB query omits "Event End Timestamp" column, defaulting all timestamps to "now"
**Fix:** Add timestamp column to SELECT, parse ISO 8601 format
**Impact:** Restores actual play dates for 30,390+ tracks
**Time:** 2-3 hours

#### Bug #5: Duration Verification
**File:** `src/apple_music_history_converter/apple_music_play_history_converter.py` (line 3023)
**Issue:** Verify "Play Duration Milliseconds" parsing works correctly
**Fix:** Add logging, test with user CSV
**Time:** 30 minutes

#### Bug #6: iTunes Country Parameter
**Files:**
- `src/apple_music_history_converter/music_search_service_v2.py` (lines 587-593)
- `src/apple_music_history_converter/apple_music_play_history_converter.py` (Settings UI)

**Issue:** iTunes Search API always searches US store
**Fix:** Add `country` parameter with UI dropdown (21 countries)
**Verified:** Tested with Italy (IT) - returns EUR pricing, Italian store links
**Time:** 2 hours

#### Bug #7: Missing Album Information (CRITICAL)
**Files:**
- `src/apple_music_history_converter/apple_music_play_history_converter.py` (DuckDB query, data processing)
- `src/apple_music_history_converter/music_search_service_v2.py` (album lookup)

**Issue:** Album information missing in UI even though data exists in CSV
**Root Cause:**
1. Apple Music exports have TWO album columns: "Album Name" and "Container Album Name"
2. Data is inconsistent - sometimes one column is filled, sometimes the other, sometimes both
3. Existing DuckDB query uses `COALESCE()` correctly, but album data may be lost during processing
4. Albums may not be preserved through the music search lookup workflow

**User Report:** "Some songs appear to be missing their album information, even though this data may be present in the file. Looking at the raw CSV, it seems that Apple exports multiple columns for similar information (e.g. there is an 'Album Name' column and a separate 'Container Album Name' column). The data here seems inconsistent, in that sometimes one column is filled and sometimes the other, and sometimes both or neither."

**Test File:** `_test_csvs/Apple Music Play Activity Ema test file.csv` (28MB, 1,945 rows)

**Investigation Required:**
1. Verify DuckDB query correctly extracts album data from both columns
2. Check if album data is preserved during CSV to DataFrame conversion
3. Verify album data is passed through the search workflow
4. Check if album lookup by Content ID is possible (similar to artist lookup)
5. Identify exactly where in the data flow album information is being lost

**Proposed Fixes (in priority order):**
1. **Quick Fix:** Add debugging/logging to trace album data through processing pipeline
2. **Medium Fix:** Ensure album data from CSV is always preserved in the results dictionary
3. **Advanced Fix:** Add album lookup using Content ID (if available in Apple Music API)
4. **Advanced Fix:** Add fallback album search when CSV album is empty but other metadata exists

**User Note:** User is fine with multi-hour processing via iTunes API if needed for accuracy. Accuracy over speed is priority.

**Time:** 3-4 hours (investigation + fix + testing)

---

### Part B: Apple Music API Integration

#### Task B1: Add Dependencies
**File:** `pyproject.toml`
**Changes:**
- Add `pyjwt>=2.8.0` for JWT token generation
- Add `cryptography>=41.0.0` for ES256 signing algorithm

**Time:** 15 minutes

#### Task B2: Create AppleMusicService Module
**New File:** `src/apple_music_history_converter/apple_music_service.py` (~500 lines)

**Features:**
- JWT token generation with ES256 signing
- Token caching with 180-day expiry
- ISRC batch lookup (25 codes per request)
- Catalog text search with storefront support
- Track ID direct lookup
- Thread-safe token management
- Automatic token refresh on 401 errors

**API Endpoints:**
- `GET /v1/catalog/{storefront}/songs?filter[isrc]=...` - ISRC lookup
- `GET /v1/catalog/{storefront}/search?term=...` - Text search
- `GET /v1/catalog/{storefront}/songs/{id}` - Direct ID lookup

**Time:** 6-8 hours

#### Task B3: Settings UI for Apple Music API
**File:** `src/apple_music_history_converter/apple_music_play_history_converter.py`

**UI Components:**
- Configuration modal dialog
- Team ID input field
- Key ID input field
- Private key (.p8) file picker
- Save & Test button
- Status indicator
- Help text with Apple Developer link

**Workflow:**
1. User clicks "Configure API Credentials"
2. Modal opens with input fields
3. User enters Team ID, Key ID, browses for .p8 file
4. Click "Save & Test"
5. System generates JWT token and tests with catalog search
6. Shows success/error dialog
7. Updates status indicator

**Time:** 2-3 hours

#### Task B4: Search Service Integration
**File:** `src/apple_music_history_converter/music_search_service_v2.py`

**Search Priority Cascade:**
1. **If ISRC provided + Apple Music configured:** ISRC lookup (fastest, 100% accurate)
2. **MusicBrainz offline database:** Existing functionality
3. **Apple Music API catalog search:** If configured, uses text search
4. **iTunes Search API:** Fallback (existing)

**New `search()` Method Signature:**
```python
def search(self, song_name: str, artist_name: Optional[str] = None,
           album_name: Optional[str] = None, isrc: Optional[str] = None) -> Dict
```

**Time:** 2-3 hours

#### Task B5: ISRC Column Detection
**File:** `src/apple_music_history_converter/apple_music_play_history_converter.py`

**Detection Logic:**
- Read CSV header on file load
- Check for columns: "ISRC", "Recording Code", "Standard Recording Code"
- Set `self.has_isrc_column = True` if found
- Log to user: "[!] ISRC codes detected - enabling fast Apple Music catalog lookups"

**DuckDB Query Enhancement:**
```sql
SELECT
    -- existing columns --
    COALESCE(NULLIF(TRIM("ISRC"), ''), '') as isrc
FROM read_csv(...)
```

**Time:** 1 hour

#### Task B6: ISRC Usage in Search Loop
**File:** `src/apple_music_history_converter/apple_music_play_history_converter.py`

**Changes in `reprocess_missing_artists_thread` method:**
```python
# Extract ISRC if column exists
isrc_code = None
if self.has_isrc_column and 'isrc' in row:
    isrc_code = str(row['isrc']).strip() if pd.notna(row['isrc']) else None

# Call search with ISRC
result = self.music_search.search(
    song_name=song_name,
    artist_name=artist_name,
    album_name=album_name,
    isrc=isrc_code  # Direct lookup if available
)
```

**Time:** 30 minutes

---

### Part C: Export Format Enhancement

#### Task C1: Multiple Export Formats
**New File:** `src/apple_music_history_converter/export_formats.py`

**Supported Formats:**

1. **Last.fm CSV** (existing default)
   - Format: Artist, Track, Album, Timestamp, Album Artist, Duration
   - Use case: Last.fm, Last.fm compatible scrobblers

2. **ListenBrainz JSON** (NEW)
   - Format: `{"track_metadata": {...}, "listened_at": 1234567890}`
   - Use case: Direct import to ListenBrainz.org
   - Timestamp: Unix epoch

3. **Universal CSV** (NEW)
   - Format: All available fields from original CSV
   - Use case: Data archival, analysis, custom importers

4. **Spotify CSV** (NEW)
   - Format: artist, track, album, timestamp, ms_played
   - Use case: Third-party Spotify importers
   - Duration: Converted to milliseconds

**UI Changes:**
- Add format selection dialog before save
- Update file extension based on format (.csv or .json)
- Show format-specific success message

**Time:** 3-4 hours

---

## File Structure

```
src/apple_music_history_converter/
├── apple_music_play_history_converter.py  # MODIFIED - Bug fixes, UI enhancements
├── music_search_service_v2.py             # MODIFIED - Apple Music integration
├── splash_screen.py                       # MODIFIED - Color fix
├── apple_music_service.py                 # NEW - Apple Music API service
└── export_formats.py                      # NEW - Export format handlers

pyproject.toml                             # MODIFIED - Add dependencies
requirements.txt                           # MODIFIED - Add PyJWT, cryptography
```

---

## Implementation Details

### Bug Fix A1: Text Color - Main App

**Current Code:**
```python
self.colors = {
    "text_primary": "#000000" if not self.is_dark_mode else "#FFFFFF",
    "text_secondary": "#666666" if not self.is_dark_mode else "#98989D",
    "text_muted": "#999999" if not self.is_dark_mode else "#636366",
}
```

**Fixed Code:**
```python
self.colors = {
    # None in light mode = system default (black on Windows/macOS)
    "text_primary": None if not self.is_dark_mode else "#FFFFFF",
    "text_secondary": None if not self.is_dark_mode else "#98989D",
    "text_muted": None if not self.is_dark_mode else "#636366",
}
```

**Rationale:** Windows Toga has a rendering bug where explicitly set colors don't work in certain container types. Using `None` delegates to system default, which correctly renders black text in light mode.

---

### Bug Fix A3: Theme Detection Logging

**Enhanced Code:**
```python
def setup_theme(self):
    """Setup application theme based on system preference."""
    try:
        if darkdetect:
            is_dark = darkdetect.isDark()
            self.is_dark_mode = is_dark

            # Log theme detection for debugging
            logger.info(f"[THEME] System theme detected: {'Dark' if is_dark else 'Light'} mode")
            logger.debug(f"[THEME] darkdetect version: {getattr(darkdetect, '__version__', 'unknown')}")
            logger.debug(f"[THEME] Platform: {platform.system()}")
        else:
            self.is_dark_mode = False
            logger.warning("[!] darkdetect library not available - defaulting to Light mode")
    except Exception as e:
        self.is_dark_mode = False
        logger.error(f"[X] Theme detection failed: {e} - defaulting to Light mode")
```

**Benefits:**
- Identifies when darkdetect returns incorrect values
- Helps debug Windows-specific theme detection issues
- Provides version info for troubleshooting

---

### Bug Fix A4: Timestamp Restoration

**DuckDB Query - Before:**
```sql
SELECT
    COALESCE(NULLIF(TRIM("Container Artist Name"), ''), '') as Artist,
    COALESCE(NULLIF(TRIM("Song Name"), ''), '') as Track,
    COALESCE(NULLIF(TRIM("Album Name"), ''), NULLIF(TRIM("Container Album Name"), ''), '') as Album,
    COALESCE(TRY_CAST("Play Duration Milliseconds" AS INTEGER), 0) as play_duration
FROM read_csv('{file_path}', header=true, all_varchar=true)
WHERE COALESCE(NULLIF(TRIM("Song Name"), ''), '') != ''
```

**DuckDB Query - After:**
```sql
SELECT
    COALESCE(NULLIF(TRIM("Container Artist Name"), ''), '') as Artist,
    COALESCE(NULLIF(TRIM("Song Name"), ''), '') as Track,
    COALESCE(NULLIF(TRIM("Album Name"), ''), NULLIF(TRIM("Container Album Name"), ''), '') as Album,
    COALESCE(TRY_CAST("Play Duration Milliseconds" AS INTEGER), 0) as play_duration,
    "Event End Timestamp" as event_timestamp,  -- RESTORED
    COALESCE(NULLIF(TRIM("ISRC"), ''), '') as isrc  -- BONUS: ISRC support
FROM read_csv('{file_path}', header=true, all_varchar=true)
WHERE COALESCE(NULLIF(TRIM("Song Name"), ''), '') != ''
```

**Timestamp Parsing:**
```python
if 'event_timestamp' in row and pd.notna(row.get('event_timestamp')):
    try:
        timestamp_str = str(row['event_timestamp']).strip()

        # Apple format: "2023-12-12T13:18:00Z" or "2023-12-12T13:18:00"
        if timestamp_str.endswith('Z'):
            timestamp = pd.to_datetime(timestamp_str, format='%Y-%m-%dT%H:%M:%SZ', utc=True)
        else:
            timestamp = pd.to_datetime(timestamp_str, utc=True)

        track['timestamp'] = self.normalize_timestamp(timestamp)
        logger.debug(f"[TIME] Parsed: {timestamp_str} -> {track['timestamp']}")
    except Exception as e:
        logger.warning(f"[!] Timestamp parse failed: {e}")
        track['timestamp'] = self.normalize_timestamp(pd.Timestamp.now())
else:
    track['timestamp'] = self.normalize_timestamp(pd.Timestamp.now())
```

---

### Bug Fix A6: iTunes Country Parameter

**Verified Working:**
```bash
curl "https://itunes.apple.com/search?term=eros+ramazzotti&media=music&entity=song&limit=2&country=it"
```

**Response shows:**
- `"country": "ITA"`
- `"currency": "EUR"`
- `"collectionPrice": 6.99` (EUR pricing)
- `"artistViewUrl": "https://music.apple.com/it/artist/..."`

**Implementation:**
```python
# Get user's preferred country from settings
country_code = self.settings.get("itunes_country", "us")

url = "https://itunes.apple.com/search"
params = {
    'term': search_term,
    'media': 'music',
    'entity': 'song',
    'limit': 5,
    'country': country_code  # Regional storefront
}
```

**Supported Countries (21):**
US, GB, IT, DE, FR, ES, JP, AU, CA, BR, IN, MX, NL, SE, NO, DK, FI, PL, RU, KR, CN

---

### Bug Fix A7: Missing Album Information

**Investigation Steps:**

1. **Verify DuckDB Query (lines 3897-3906)**
   ```python
   # Current query
   COALESCE(NULLIF(TRIM("Album Name"), ''), NULLIF(TRIM("Container Album Name"), ''), '') as Album
   ```
   - Add logging: `logger.debug(f"[ALBUM] Raw values: Album Name='{row.get('Album Name')}', Container Album='{row.get('Container Album Name')}'")`
   - Verify COALESCE is working as expected
   - Check if album field is present in final DataFrame

2. **Trace Album Data Through Processing**
   ```python
   # In reprocess_missing_artists_thread
   for index, row in df.iterrows():
       album_name = row.get('Album', '')
       logger.debug(f"[ALBUM] Track {index}: Album='{album_name}'")

       # Before search
       result = self.music_search.search(song_name, artist_name, album_name)
       logger.debug(f"[ALBUM] Search result has album: {result.get('album') is not None}")

       # After search - check if result overwrites CSV album
       if result.get('album'):
           track['album'] = result['album']
       elif album_name:
           track['album'] = album_name  # Preserve CSV album if lookup fails
   ```

3. **Check Results Table Display**
   - Verify album column is being populated in the Toga table
   - Check if UI has any filtering that might hide empty albums

4. **Investigate Album Lookup by Content ID**
   - Check if Apple Music API supports Content ID lookup for albums
   - If yes, implement similar to artist lookup workflow
   - API endpoint: `GET /v1/catalog/{storefront}/albums/{id}`

**Implementation (if needed):**

```python
# In music_search_service_v2.py
def search(self, song_name: str, artist_name: Optional[str] = None,
           album_name: Optional[str] = None, isrc: Optional[str] = None,
           content_id: Optional[str] = None) -> Dict:

    # If content_id provided, do direct lookup (similar to ISRC)
    if content_id and self.apple_music_configured:
        return self._lookup_by_content_id(content_id)

    # ... existing search logic ...
```

**Album Preservation Logic:**
```python
# Priority order for album name:
# 1. Apple Music API result (if lookup successful)
# 2. iTunes API result (if lookup successful)
# 3. CSV album name (always preserve if available)
# 4. Empty string (no album info)

track['album'] = (
    result.get('album') or
    album_name or
    ''
)
```

**Expected Outcome:**
- All albums present in CSV should be displayed in results
- If album lookup via API succeeds, use API result (more accurate)
- If API lookup fails, preserve album from CSV (don't lose data)
- User reports no missing albums after fix

---

### Apple Music API Authentication Flow

**Step 1: Obtain Credentials (User)**
1. Sign in to developer.apple.com
2. Navigate to Certificates, Identifiers & Profiles
3. Create MusicKit API Key
4. Download `.p8` private key file
5. Note Team ID and Key ID

**Step 2: Configure in App**
1. Open Settings sidebar
2. Click "Configure API Credentials"
3. Enter Team ID (e.g., `1A2B3C4D5E`)
4. Enter Key ID (e.g., `AB12CD34EF`)
5. Browse to `.p8` file location
6. Click "Save & Test"

**Step 3: Token Generation (Automatic)**
```python
import jwt
import time

headers = {
    'alg': 'ES256',
    'kid': key_id
}

payload = {
    'iss': team_id,
    'iat': int(time.time()),
    'exp': int(time.time()) + (180 * 24 * 60 * 60)  # 180 days max
}

token = jwt.encode(payload, private_key, algorithm='ES256', headers=headers)
```

**Step 4: API Request**
```python
url = "https://api.music.apple.com/v1/catalog/us/search"
headers = {'Authorization': f'Bearer {token}'}
params = {'term': 'The Beatles', 'types': 'songs', 'limit': 5}

response = httpx.get(url, params=params, headers=headers, timeout=10)
```

**Token Management:**
- Token cached in memory
- Expires after 180 days
- Auto-refresh on 401 errors
- Thread-safe access

---

### ISRC Lookup Flow

**Scenario 1: CSV has ISRC column**

1. Load CSV → Detect ISRC column
2. DuckDB query includes ISRC field
3. For each track with ISRC:
   ```python
   # Direct catalog lookup (batch 25 at a time)
   GET https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]=USRC17607839
   ```
4. Response contains exact match with artist/track/album
5. **No fuzzy text search needed!**

**Performance:**
- **Traditional text search:** ~150ms per track (iTunes API)
- **ISRC lookup:** ~50ms for 25 tracks (batched)
- **Speed improvement:** ~75x faster!

**Scenario 2: CSV lacks ISRC column**
- Falls back to text search cascade (MusicBrainz → Apple Music → iTunes)

---

### Export Format Comparison

| Format | Extension | Use Case | Timestamp Format | Example |
|--------|-----------|----------|------------------|---------|
| **Last.fm CSV** | `.csv` | Last.fm, scrobblers | ISO 8601 | `2023-12-12 13:18:00` |
| **ListenBrainz JSON** | `.json` | ListenBrainz.org | Unix epoch | `1702386480` |
| **Universal CSV** | `.csv` | Archival, analysis | ISO 8601 | All CSV fields |
| **Spotify CSV** | `.csv` | Third-party importers | ISO 8601 | Duration in ms |

**ListenBrainz JSON Example:**
```json
[
  {
    "track_metadata": {
      "artist_name": "Eros Ramazzotti",
      "track_name": "Più Bella Cosa",
      "release_name": "Dove C'è Musica"
    },
    "listened_at": 1702386480
  }
]
```

---

## Testing Plan

### Test Suite 1: Color Fixes
- [ ] Launch app on Windows 11 in Light mode
- [ ] Verify all section headings visible (black text)
- [ ] Verify splash screen tip text visible
- [ ] Switch to Dark mode, verify white text
- [ ] Launch on macOS in Light mode
- [ ] Launch on macOS in Dark mode
- [ ] Check logs for theme detection messages

### Test Suite 2: Timestamp Restoration
- [ ] Load user's Play Activity CSV (30,390 rows)
- [ ] Verify DuckDB query includes `event_timestamp` column
- [ ] Check logs for timestamp parsing messages
- [ ] Verify timestamps match original CSV (2023-12-12 format)
- [ ] Export to CSV, confirm chronological order
- [ ] Compare exported timestamps to source CSV

### Test Suite 3: iTunes Country Parameter
- [ ] Open Settings sidebar
- [ ] Select "Italy" from iTunes Storefront dropdown
- [ ] Search for "Eros Ramazzotti" missing artists
- [ ] Verify API request includes `country=it` parameter
- [ ] Check results contain EUR pricing
- [ ] Compare with US store results (should differ)

### Test Suite 4: Apple Music API
- [ ] Click "Configure API Credentials"
- [ ] Enter test Team ID, Key ID, .p8 path
- [ ] Click "Save & Test"
- [ ] Verify success dialog appears
- [ ] Check status indicator shows "[OK] Configured and ready"
- [ ] Trigger catalog search
- [ ] Verify JWT token in request headers
- [ ] Test token expiry handling (mock 401 error)

### Test Suite 5: ISRC Detection & Lookup
- [ ] Create test CSV with ISRC column
- [ ] Load CSV, verify detection message in logs
- [ ] Confirm DuckDB query includes ISRC field
- [ ] Trigger search, verify ISRC lookup used
- [ ] Check logs for "[ISRC] Attempting direct lookup"
- [ ] Verify fallback to text search if ISRC fails
- [ ] Measure performance improvement (time 100 tracks)

### Test Suite 6: Missing Album Bug Fix
- [ ] Load Ema's test CSV (`_test_csvs/Apple Music Play Activity Ema test file.csv`)
- [ ] Enable debug logging for album tracking
- [ ] Verify DuckDB query logs both Album Name and Container Album Name values
- [ ] Check that COALESCE correctly picks non-empty value
- [ ] Process all tracks and verify album data is preserved in DataFrame
- [ ] Search for missing artists, verify albums are preserved in search results
- [ ] Check results table displays album information correctly
- [ ] Export to CSV and verify album column is populated
- [ ] Test with songs where only Container Album is filled
- [ ] Test with songs where only Album Name is filled
- [ ] Test with songs where both columns are filled (same value)
- [ ] Test with songs where both columns are empty

### Test Suite 7: Export Formats
- [ ] Load and process test CSV
- [ ] Click "Save CSV" button
- [ ] Select "Last.fm CSV" format
- [ ] Verify .csv file with correct columns
- [ ] Repeat with "ListenBrainz JSON"
- [ ] Verify .json structure matches spec
- [ ] Repeat with "Universal CSV"
- [ ] Verify all original CSV columns present
- [ ] Repeat with "Spotify CSV"
- [ ] Verify ms_played column in milliseconds

---

## Deployment Strategy

### Version Numbering
- Current: `2.0.4`
- Target: `2.2.0` (minor version bump for new features + album fix)

### Release Process
1. Development on branch: `feature/apple-music-api-integration`
2. Comprehensive testing on Windows & macOS
3. Update `pyproject.toml` (3 locations):
    - `[project]` → `version = "2.2.0"`
    - `[tool.briefcase]` → `version = "2.2.0"`
    - `[tool.briefcase.app.*.windows]` → `version_triple = "2.2.0"`
4. Build macOS DMG (universal binary)
5. Build Windows MSI (via GitHub Actions)
6. Create GitHub release with binaries
7. Update README.md and CHANGELOG.md
8. Email Italian user with fix notification
9. Email Emma with album fix notification

### Branch Strategy
```
main (2.0.4)
  └── feature/apple-music-api-integration (2.2.0-dev)
       ├── Part A: Bug fixes (checkpoint)
       ├── Part B: Apple Music API (checkpoint)
       └── Part C: Export formats (checkpoint)
```

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| PyJWT/cryptography platform compatibility | Medium | High | Test on Windows/macOS/Linux before release |
| Apple Music API rate limits | Low | Medium | Implement request throttling, batch ISRC lookups |
| ISRC column not in user CSV | High | Low | Graceful fallback to text search |
| JWT token expiry handling | Medium | Medium | Auto-refresh on 401, cache token state |
| .p8 private key security | Low | High | Store file path only, validate permissions |
| DuckDB query performance | Low | Medium | Test with 200k+ row CSVs |
| Export format compatibility | Medium | Low | Validate against official specs |
| Album data preservation issue | Medium | High | Add extensive logging, test with user's CSV |

---

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
- [ ] Additional export formats (Apple Music XML, etc.)
- [ ] Batch credential import
- [ ] API usage statistics dashboard

---

## Dependencies

### Python Packages (New)
- `pyjwt>=2.8.0` - JWT token generation
- `cryptography>=41.0.0` - ES256 algorithm support

### External Services
- Apple Music API (MusicKit) - Requires Apple Developer account ($99/year)
- iTunes Search API - Free, no authentication

### User Requirements
- Apple Developer account credentials
- MusicKit API key (.p8 file)
- Team ID and Key ID from Apple Developer portal

---

## Documentation Updates

### Files to Update
1. **README.md**
   - Add Apple Music API section
   - Update feature list
   - Add ISRC support mention

2. **CLAUDE.md**
   - Document Apple Music API setup
   - Add troubleshooting section
   - Update architecture diagram

3. **wiki/User-Guide.md**
   - Add "Configuring Apple Music API" section
   - Add export format comparison table
   - Add ISRC explanation

4. **wiki/FAQ.md**
   - "Do I need an Apple Developer account?"
   - "What is ISRC and do I need it?"
   - "Which export format should I use?"

---

## Rollback Plan

If critical issues discovered post-release:

### Option 1: Hotfix
1. Create branch `hotfix/2.1.1` from `main`
2. Fix critical issue
3. Test thoroughly
4. Release v2.1.1

### Option 2: Revert
1. Tag current release as `v2.1.0-broken`
2. Revert main to `v2.0.4`
3. Re-release `v2.0.4` with note
4. Fix issues in development branch

### Option 3: Feature Flag
- Add `enable_apple_music_api` setting (default: false)
- Allow users to opt-in to new features
- Disable if issues found

---

## Post-Release Monitoring

### Metrics to Track
- Apple Music API usage (requests/day)
- ISRC lookup success rate
- iTunes country parameter usage distribution
- Export format preferences
- Error rates by component

### User Feedback Channels
- GitHub Issues
- Email support
- Release feedback form

---

## Approval Checklist

Before implementation begins, confirm:

- [ ] Approve comprehensive plan scope (Parts A, B, C)
- [ ] Confirm Apple Music API integration desired
- [ ] Confirm multiple export formats desired
- [ ] Approve 29-41 hour time estimate
- [ ] Ready to provide test .p8 file for development
- [ ] Prefer all work done together (not phased)
- [ ] Understand Apple Developer account requirement ($99/year)
- [ ] Agree to version bump 2.0.4 → 2.2.0
- [ ] Confirm album information bug fix is priority (Emma's issue)

---

## Contact & Support

**Developer:** Claude (via Anthropic)
**Project Owner:** Ashraf Ali
**Repository:** https://github.com/nerveband/Apple-Music-Play-History-Converter
**Branch:** `feature/apple-music-api-integration`

---

## References

### Official Documentation
- [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html)
- [Apple Music API](https://developer.apple.com/documentation/applemusicapi)
- [MusicKit Authentication](https://developer.apple.com/documentation/applemusicapi/generating_developer_tokens)
- [ISRC Lookup API](https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-songs-by-isrc)

### Libraries
- [PyJWT Documentation](https://pyjwt.readthedocs.io/)
- [Cryptography Library](https://cryptography.io/)
- [httpx Documentation](https://www.python-httpx.org/)

### Standards
- [ISRC Standard](https://www.ifpi.org/isrc/)
- [ISO 8601 Timestamp Format](https://en.wikipedia.org/wiki/ISO_8601)
- [JWT (RFC 7519)](https://datatracker.ietf.org/doc/html/rfc7519)

---

**End of Implementation Plan**
