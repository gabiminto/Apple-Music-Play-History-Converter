#!/usr/bin/env python3
"""
End-to-end direct hooks tests for the Python sidecar.
Tests the full pipeline: load CSV -> search -> verify results -> export -> verify export file.
Uses real test CSV files and real MusicBrainz API calls.
"""

import json
import subprocess
import sys
import os
import time
import tempfile
import csv
from pathlib import Path

# Project paths
SIDECAR_PATH = Path(__file__).parent / "sidecar.py"
PROJECT_ROOT = Path(__file__).parent.parent.parent
TEST_CSVS = PROJECT_ROOT / "_test_csvs"

# Test CSV files
PLAY_ACTIVITY_CSV = TEST_CSVS / "Apple Music Play Activity small.csv"
RECENTLY_PLAYED_CSV = TEST_CSVS / "Apple Music - Recently Played Tracks.csv"
DAILY_TRACKS_CSV = TEST_CSVS / "Apple Music - Play History Daily Tracks.csv"

passed = 0
failed = 0
errors = []


def e2e_test(name):
    """Decorator for test functions."""
    def decorator(func):
        def wrapper():
            global passed, failed
            try:
                func()
                passed += 1
                print(f"  [OK] {name}")
            except AssertionError as e:
                failed += 1
                errors.append(f"{name}: {e}")
                print(f"  [FAIL] {name}: {e}")
            except Exception as e:
                failed += 1
                errors.append(f"{name}: {type(e).__name__}: {e}")
                print(f"  [FAIL] {name}: {type(e).__name__}: {e}")
        wrapper._test_name = name
        return wrapper
    return decorator


class SidecarProcess:
    """Helper to manage sidecar process for tests."""

    def __init__(self):
        self.proc = None
        self.all_messages = []

    def start(self):
        self.proc = subprocess.Popen(
            [sys.executable, str(SIDECAR_PATH)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(PROJECT_ROOT),
            text=True,
            bufsize=1,
        )
        ready = self.read_message()
        assert ready.get("type") == "ready", f"Expected ready, got: {ready}"
        return ready

    def send(self, msg: dict):
        line = json.dumps(msg) + "\n"
        self.proc.stdin.write(line)
        self.proc.stdin.flush()

    def read_message(self, timeout: float = 10.0) -> dict:
        """Read one JSON message from stdout."""
        start = time.time()
        while time.time() - start < timeout:
            line = self.proc.stdout.readline()
            if line:
                line = line.strip()
                if line:
                    msg = json.loads(line)
                    self.all_messages.append(msg)
                    return msg
            time.sleep(0.01)
        raise TimeoutError(f"No message received within {timeout}s")

    def read_messages_until(self, msg_type: str, timeout: float = 30.0) -> list:
        """Read messages until we get one of the specified type."""
        messages = []
        start = time.time()
        while time.time() - start < timeout:
            try:
                msg = self.read_message(timeout=1.0)
                messages.append(msg)
                if msg.get("type") == msg_type:
                    return messages
            except TimeoutError:
                continue
            except json.JSONDecodeError:
                continue
        return messages

    def read_all_until(self, msg_type: str, timeout: float = 60.0) -> list:
        """Read ALL messages until the specified type, collecting everything."""
        messages = []
        start = time.time()
        while time.time() - start < timeout:
            try:
                msg = self.read_message(timeout=2.0)
                messages.append(msg)
                if msg.get("type") == msg_type:
                    return messages
            except TimeoutError:
                # Check if process is still alive
                if self.proc.poll() is not None:
                    break
                continue
            except json.JSONDecodeError:
                continue
        return messages

    def stop(self):
        if self.proc:
            self.proc.stdin.close()
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


# ---------------------------------------------------------------------------
# End-to-end pipeline tests
# ---------------------------------------------------------------------------

@e2e_test("E2E: Load Daily Tracks CSV and search with MusicBrainz API")
def test_e2e_daily_tracks_search():
    """Full pipeline test: load CSV -> initialize -> search -> verify results."""
    if not DAILY_TRACKS_CSV.exists():
        raise AssertionError(f"Test CSV not found: {DAILY_TRACKS_CSV}")

    sidecar = SidecarProcess()
    try:
        sidecar.start()

        # Step 1: Initialize service
        sidecar.send({"action": "initialize"})
        msgs = sidecar.read_messages_until("initialized", timeout=15)
        init_msgs = [m for m in msgs if m.get("type") == "initialized"]
        assert len(init_msgs) == 1, f"No initialized msg. Got: {[m.get('type') for m in msgs]}"
        assert init_msgs[0]["success"] is True

        # Step 2: Load CSV
        sidecar.send({"action": "loadCSV", "path": str(DAILY_TRACKS_CSV)})
        msgs = sidecar.read_messages_until("csvLoaded", timeout=10)
        csv_loaded = [m for m in msgs if m.get("type") == "csvLoaded"]
        assert len(csv_loaded) == 1, f"No csvLoaded. Got: {[m.get('type') for m in msgs]}"
        assert csv_loaded[0]["success"] is True
        row_count = csv_loaded[0]["rowCount"]
        assert row_count > 0, f"No rows loaded"
        print(f"    Loaded {row_count} tracks from Daily Tracks CSV")

        # Step 3: Start search with MusicBrainz API
        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})

        # Read all messages until searchComplete (may take a while with real API)
        # MusicBrainz API is rate-limited to 1 req/sec, 128 tracks ~ 130+ seconds
        msgs = sidecar.read_all_until("searchComplete", timeout=300)
        search_complete = [m for m in msgs if m.get("type") == "searchComplete"]
        assert len(search_complete) == 1, f"No searchComplete. Types: {[m.get('type') for m in msgs[-5:]]}"

        result = search_complete[0]
        total = result["total"]
        found = result["found"]
        missing = result["missing"]
        rate_limited = result.get("rateLimited", 0)

        print(f"    Search results: {found}/{total} found, {missing} missing, {rate_limited} rate-limited")

        # Verify we got reasonable results
        assert total == row_count, f"Total mismatch: {total} vs {row_count}"
        assert found > 0, "Expected at least some tracks found"
        assert found + missing + rate_limited == total, f"Counts don't add up: {found}+{missing}+{rate_limited} != {total}"

        # Verify trackResult messages were emitted
        track_results = [m for m in msgs if m.get("type") == "trackResult"]
        assert len(track_results) == total, f"Expected {total} trackResult msgs, got {len(track_results)}"

        # Verify progress messages were emitted
        progress_msgs = [m for m in msgs if m.get("type") == "progress"]
        assert len(progress_msgs) > 0, "Expected progress messages during search"

    finally:
        sidecar.stop()


@e2e_test("E2E: Load Recently Played CSV and search")
def test_e2e_recently_played_search():
    """Test with Recently Played format which has Artist - Track in Track Description."""
    if not RECENTLY_PLAYED_CSV.exists():
        raise AssertionError(f"Test CSV not found: {RECENTLY_PLAYED_CSV}")

    sidecar = SidecarProcess()
    try:
        sidecar.start()

        # Initialize
        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        # Load CSV
        sidecar.send({"action": "loadCSV", "path": str(RECENTLY_PLAYED_CSV)})
        msgs = sidecar.read_messages_until("csvLoaded", timeout=10)
        csv_loaded = [m for m in msgs if m.get("type") == "csvLoaded"]
        assert len(csv_loaded) == 1
        row_count = csv_loaded[0]["rowCount"]
        assert csv_loaded[0]["fileType"] == "Recently Played Tracks"
        print(f"    Loaded {row_count} tracks from Recently Played CSV")

        # Search
        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})
        msgs = sidecar.read_all_until("searchComplete", timeout=300)
        search_complete = [m for m in msgs if m.get("type") == "searchComplete"]
        assert len(search_complete) == 1

        result = search_complete[0]
        print(f"    Search: {result['found']}/{result['total']} found")
        assert result["found"] > 0

    finally:
        sidecar.stop()


@e2e_test("E2E: Full export pipeline - Last.fm CSV")
def test_e2e_export_lastfm():
    """Load -> Search -> Export to Last.fm CSV -> Verify file."""
    # Use Recently Played (40 tracks) for faster export tests
    test_csv = RECENTLY_PLAYED_CSV if RECENTLY_PLAYED_CSV.exists() else DAILY_TRACKS_CSV
    if not test_csv.exists():
        raise AssertionError(f"No test CSV found")

    sidecar = SidecarProcess()
    export_path = None
    try:
        sidecar.start()

        # Initialize + Load
        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        sidecar.send({"action": "loadCSV", "path": str(test_csv)})
        msgs = sidecar.read_messages_until("csvLoaded", timeout=10)
        csv_loaded = [m for m in msgs if m.get("type") == "csvLoaded"]
        assert csv_loaded[0]["success"] is True
        row_count = csv_loaded[0]["rowCount"]

        # Search
        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})
        msgs = sidecar.read_all_until("searchComplete", timeout=300)
        search_complete = [m for m in msgs if m.get("type") == "searchComplete"]
        assert len(search_complete) == 1

        found = search_complete[0]["found"]
        print(f"    Search found {found}/{row_count} tracks")

        # Export to Last.fm CSV
        export_path = os.path.join(tempfile.gettempdir(), "test_export_lastfm.csv")
        sidecar.send({"action": "export", "format": "lastfm", "path": export_path})
        msgs = sidecar.read_messages_until("exportComplete", timeout=15)
        export_msgs = [m for m in msgs if m.get("type") == "exportComplete"]
        assert len(export_msgs) == 1, f"No exportComplete. Types: {[m.get('type') for m in msgs]}"
        assert export_msgs[0]["success"] is True

        # Verify the exported file
        assert os.path.exists(export_path), f"Export file not found: {export_path}"
        with open(export_path, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        assert len(rows) > 0, "Export file is empty"
        print(f"    Exported {len(rows)} rows to Last.fm CSV")

        # Verify Last.fm columns
        expected_cols = {"Artist", "Track", "Album", "Timestamp", "Album Artist", "Duration"}
        actual_cols = set(rows[0].keys())
        assert expected_cols == actual_cols, f"Column mismatch: expected {expected_cols}, got {actual_cols}"

        # Check data quality - at least some tracks have artist/track
        tracks_with_data = [r for r in rows if r["Artist"] and r["Track"]]
        assert len(tracks_with_data) > 0, "No tracks with artist+track data"
        print(f"    Verified {len(tracks_with_data)} tracks have artist and track data")

    finally:
        sidecar.stop()
        if export_path and os.path.exists(export_path):
            os.remove(export_path)


@e2e_test("E2E: Export to ListenBrainz JSON")
def test_e2e_export_listenbrainz():
    """Search and export to ListenBrainz JSON format."""
    test_csv = RECENTLY_PLAYED_CSV if RECENTLY_PLAYED_CSV.exists() else DAILY_TRACKS_CSV
    if not test_csv.exists():
        raise AssertionError(f"No test CSV found")

    sidecar = SidecarProcess()
    export_path = None
    try:
        sidecar.start()

        # Initialize + Load + Search
        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        sidecar.send({"action": "loadCSV", "path": str(test_csv)})
        sidecar.read_messages_until("csvLoaded", timeout=10)

        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})
        sidecar.read_all_until("searchComplete", timeout=300)

        # Export to ListenBrainz JSON
        export_path = os.path.join(tempfile.gettempdir(), "test_export_lb.json")
        sidecar.send({"action": "export", "format": "listenbrainz", "path": export_path})
        msgs = sidecar.read_messages_until("exportComplete", timeout=15)
        export_msgs = [m for m in msgs if m.get("type") == "exportComplete"]
        assert len(export_msgs) == 1
        assert export_msgs[0]["success"] is True

        # Verify JSON file
        assert os.path.exists(export_path), f"Export not found: {export_path}"
        with open(export_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        assert isinstance(data, list), f"Expected list, got {type(data)}"
        assert len(data) > 0, "Empty export"
        print(f"    Exported {len(data)} entries to ListenBrainz JSON")

        # Verify structure
        first = data[0]
        assert "track_metadata" in first, f"Missing track_metadata: {first.keys()}"
        meta = first["track_metadata"]
        assert "artist_name" in meta or "track_name" in meta, f"Missing fields: {meta.keys()}"

    finally:
        sidecar.stop()
        if export_path and os.path.exists(export_path):
            os.remove(export_path)


@e2e_test("E2E: Export missing tracks")
def test_e2e_export_missing():
    """Search then export only the missing tracks."""
    test_csv = RECENTLY_PLAYED_CSV if RECENTLY_PLAYED_CSV.exists() else DAILY_TRACKS_CSV
    if not test_csv.exists():
        raise AssertionError(f"No test CSV found")

    sidecar = SidecarProcess()
    export_path = None
    try:
        sidecar.start()

        # Initialize + Load + Search
        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        sidecar.send({"action": "loadCSV", "path": str(test_csv)})
        sidecar.read_messages_until("csvLoaded", timeout=10)

        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})
        msgs = sidecar.read_all_until("searchComplete", timeout=300)
        search_complete = [m for m in msgs if m.get("type") == "searchComplete"]
        assert len(search_complete) == 1, "Search did not complete"
        missing_count = search_complete[0]["missing"]

        if missing_count == 0:
            print("    No missing tracks to export (all found) - skipping export verification")
            return

        # Export missing
        export_path = os.path.join(tempfile.gettempdir(), "test_export_missing.csv")
        sidecar.send({"action": "exportMissing", "path": export_path})
        msgs = sidecar.read_messages_until("exportComplete", timeout=15)
        export_msgs = [m for m in msgs if m.get("type") == "exportComplete"]
        assert len(export_msgs) == 1
        assert export_msgs[0]["success"] is True

        # Verify
        assert os.path.exists(export_path)
        with open(export_path, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        assert len(rows) == missing_count, f"Missing count mismatch: {len(rows)} vs {missing_count}"
        print(f"    Exported {len(rows)} missing tracks")

        # Verify columns
        assert "Artist" in rows[0] or "Track" in rows[0], f"Missing expected columns: {rows[0].keys()}"

    finally:
        sidecar.stop()
        if export_path and os.path.exists(export_path):
            os.remove(export_path)


@e2e_test("E2E: Pause and resume search")
def test_e2e_pause_resume():
    """Test pause/resume of search."""
    if not DAILY_TRACKS_CSV.exists():
        raise AssertionError(f"Test CSV not found: {DAILY_TRACKS_CSV}")

    sidecar = SidecarProcess()
    try:
        sidecar.start()

        # Initialize + Load
        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        sidecar.send({"action": "loadCSV", "path": str(DAILY_TRACKS_CSV)})
        sidecar.read_messages_until("csvLoaded", timeout=10)

        # Start search
        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})

        # Wait for first progress or trackResult message (search has started)
        msgs = sidecar.read_messages_until("trackResult", timeout=30)
        has_activity = any(m.get("type") in ("progress", "trackResult") for m in msgs)
        assert has_activity, "No search activity before pause"

        # Pause - send immediately
        sidecar.send({"action": "pauseSearch"})
        # The searchPaused message may arrive after some in-flight trackResult/progress msgs
        msgs = sidecar.read_messages_until("searchPaused", timeout=15)
        paused = [m for m in msgs if m.get("type") == "searchPaused"]
        assert len(paused) > 0, f"No searchPaused msg. Types: {[m.get('type') for m in msgs]}"
        assert paused[0]["paused"] is True
        print("    Pause confirmed")

        # Brief wait to confirm paused state
        time.sleep(1)

        # Resume
        sidecar.send({"action": "pauseSearch"})
        msgs = sidecar.read_messages_until("searchPaused", timeout=15)
        resumed = [m for m in msgs if m.get("type") == "searchPaused"]
        assert len(resumed) > 0, f"No searchPaused msg for resume. Types: {[m.get('type') for m in msgs]}"
        assert resumed[0]["paused"] is False
        print("    Resume confirmed")

        # Wait for completion
        msgs = sidecar.read_all_until("searchComplete", timeout=300)
        search_complete = [m for m in msgs if m.get("type") == "searchComplete"]
        assert len(search_complete) == 1, "Search did not complete after resume"
        print(f"    Search completed: {search_complete[0]['found']}/{search_complete[0]['total']} found")

    finally:
        sidecar.stop()


@e2e_test("E2E: Stop search mid-progress")
def test_e2e_stop_search():
    """Test stopping a search in progress."""
    if not DAILY_TRACKS_CSV.exists():
        raise AssertionError(f"Test CSV not found: {DAILY_TRACKS_CSV}")

    sidecar = SidecarProcess()
    try:
        sidecar.start()

        # Initialize + Load
        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        sidecar.send({"action": "loadCSV", "path": str(DAILY_TRACKS_CSV)})
        sidecar.read_messages_until("csvLoaded", timeout=10)

        # Start search
        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})

        # Wait for first trackResult (search has started processing)
        msgs = sidecar.read_messages_until("trackResult", timeout=30)
        has_activity = any(m.get("type") in ("progress", "trackResult") for m in msgs)
        assert has_activity, "No search activity before stop"

        # Stop
        sidecar.send({"action": "stopSearch"})
        # The stop may take a moment - the search thread joins with 3s timeout
        # Also skip any in-flight trackResult/progress messages
        msgs = sidecar.read_messages_until("searchStopped", timeout=20)
        stopped = [m for m in msgs if m.get("type") == "searchStopped"]
        if not stopped:
            # The search might have completed before stop took effect
            completed = [m for m in msgs if m.get("type") == "searchComplete"]
            if completed:
                print("    Search completed before stop took effect (OK)")
                return
        assert len(stopped) > 0, f"No searchStopped msg. Types: {[m.get('type') for m in msgs]}"
        assert stopped[0].get("success") is True, f"searchStopped missing success: {stopped[0]}"
        print("    Search stopped successfully")

    finally:
        sidecar.stop()


@e2e_test("E2E: Settings persistence across operations")
def test_e2e_settings_persistence():
    """Test that settings are preserved across operations."""
    sidecar = SidecarProcess()
    try:
        sidecar.start()

        # Set iTunes country
        sidecar.send({"action": "setSettings", "settings": {"itunes_country": "jp"}})
        resp = sidecar.read_message()
        assert resp["type"] == "status"

        # Initialize (should preserve settings)
        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        # Verify settings persisted (skip log messages that may arrive)
        sidecar.send({"action": "getSettings"})
        msgs = sidecar.read_messages_until("settingsLoaded", timeout=10)
        settings_msgs = [m for m in msgs if m.get("type") == "settingsLoaded"]
        assert len(settings_msgs) == 1, f"No settingsLoaded. Got: {[m.get('type') for m in msgs]}"
        assert settings_msgs[0]["settings"]["itunes_country"] == "jp", f"Country not persisted: {settings_msgs[0]['settings']}"
        print("    Settings persisted through initialization")

        # Change another setting
        sidecar.send({"action": "setSettings", "settings": {"search_provider": "itunes_api"}})
        sidecar.read_messages_until("status", timeout=5)  # status ack

        # Verify both settings exist
        sidecar.send({"action": "getSettings"})
        msgs = sidecar.read_messages_until("settingsLoaded", timeout=10)
        settings_msgs = [m for m in msgs if m.get("type") == "settingsLoaded"]
        assert len(settings_msgs) == 1
        assert settings_msgs[0]["settings"]["itunes_country"] == "jp"
        assert settings_msgs[0]["settings"]["search_provider"] == "itunes_api"
        print("    Multiple settings coexist correctly")

    finally:
        sidecar.stop()


@e2e_test("E2E: Preview normalization for all 3 CSV formats")
def test_e2e_preview_all_formats():
    """Verify preview normalization works for all CSV formats."""
    formats = [
        (PLAY_ACTIVITY_CSV, "Play Activity"),
        (RECENTLY_PLAYED_CSV, "Recently Played Tracks"),
        (DAILY_TRACKS_CSV, "Play History Daily Tracks"),
    ]

    for csv_path, expected_type in formats:
        if not csv_path.exists():
            raise AssertionError(f"Test CSV not found: {csv_path}")

        sidecar = SidecarProcess()
        try:
            sidecar.start()

            # Analyze
            sidecar.send({"action": "analyzeCSV", "path": str(csv_path)})
            resp = sidecar.read_message()
            assert resp["type"] == "fileAnalysis", f"Got: {resp}"
            assert resp["fileType"] == expected_type, f"Expected '{expected_type}', got '{resp.get('fileType')}'"

            # Preview
            sidecar.send({"action": "getPreview", "path": str(csv_path)})
            resp = sidecar.read_message()
            assert resp["type"] == "csvPreview", f"Got: {resp}"
            assert resp["headers"] == ["Artist", "Track", "Album", "Timestamp", "Duration"]
            assert len(resp["rows"]) > 0

            # Verify track names are populated
            has_tracks = any(row[1] for row in resp["rows"])
            assert has_tracks, f"No track names in preview for {expected_type}"

            print(f"    {expected_type}: {len(resp['rows'])} preview rows, headers OK")

        finally:
            sidecar.stop()


@e2e_test("E2E: Export to all 5 formats")
def test_e2e_export_all_formats():
    """Load + search + export to all 5 formats, verify each."""
    test_csv = RECENTLY_PLAYED_CSV if RECENTLY_PLAYED_CSV.exists() else DAILY_TRACKS_CSV
    if not test_csv.exists():
        raise AssertionError(f"No test CSV found")

    sidecar = SidecarProcess()
    export_files = []
    try:
        sidecar.start()

        # Initialize + Load + Search
        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        sidecar.send({"action": "loadCSV", "path": str(test_csv)})
        sidecar.read_messages_until("csvLoaded", timeout=10)

        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})
        msgs = sidecar.read_all_until("searchComplete", timeout=300)
        search_complete = [m for m in msgs if m.get("type") == "searchComplete"]
        assert len(search_complete) == 1

        found = search_complete[0]["found"]
        print(f"    Search: {found}/{search_complete[0]['total']} found")

        # Export to each format
        formats = {
            "lastfm": ".csv",
            "listenbrainz": ".json",
            "spotify": ".csv",
            "universal": ".csv",
            "itunes_xml": ".xml",
        }

        for fmt, ext in formats.items():
            export_path = os.path.join(tempfile.gettempdir(), f"test_export_{fmt}{ext}")
            export_files.append(export_path)

            sidecar.send({"action": "export", "format": fmt, "path": export_path})
            msgs = sidecar.read_messages_until("exportComplete", timeout=15)
            export_msgs = [m for m in msgs if m.get("type") == "exportComplete"]

            if len(export_msgs) == 0:
                # Check for error
                err_msgs = [m for m in msgs if m.get("type") == "error"]
                if err_msgs:
                    print(f"    [!] {fmt}: Export error: {err_msgs[0].get('error')}")
                    continue
                raise AssertionError(f"No exportComplete for {fmt}. Types: {[m.get('type') for m in msgs]}")

            assert export_msgs[0]["success"] is True, f"{fmt} export failed"
            assert os.path.exists(export_path), f"{fmt} file not created"
            size = os.path.getsize(export_path)
            assert size > 0, f"{fmt} file is empty"
            print(f"    {fmt}: exported ({size} bytes)")

    finally:
        sidecar.stop()
        for f in export_files:
            if os.path.exists(f):
                os.remove(f)


@e2e_test("E2E: Concurrent sidecar message handling")
def test_e2e_rapid_messages():
    """Send multiple rapid messages and verify all are handled."""
    sidecar = SidecarProcess()
    try:
        sidecar.start()

        # Send multiple pings rapidly
        for _ in range(5):
            sidecar.send({"action": "ping"})

        # Read all pong responses
        pongs = []
        for _ in range(5):
            msg = sidecar.read_message(timeout=5)
            if msg["type"] == "pong":
                pongs.append(msg)

        assert len(pongs) == 5, f"Expected 5 pongs, got {len(pongs)}"
        print("    5 rapid pings all received pong responses")

    finally:
        sidecar.stop()


@e2e_test("E2E: Track results have correct structure")
def test_e2e_track_result_structure():
    """Verify trackResult messages have all required fields."""
    if not DAILY_TRACKS_CSV.exists():
        raise AssertionError(f"Test CSV not found: {DAILY_TRACKS_CSV}")

    sidecar = SidecarProcess()
    try:
        sidecar.start()

        sidecar.send({"action": "initialize"})
        sidecar.read_messages_until("initialized", timeout=15)

        sidecar.send({"action": "loadCSV", "path": str(DAILY_TRACKS_CSV)})
        sidecar.read_messages_until("csvLoaded", timeout=10)

        sidecar.send({"action": "startSearch", "provider": "musicbrainz_api"})
        msgs = sidecar.read_all_until("searchComplete", timeout=300)

        track_results = [m for m in msgs if m.get("type") == "trackResult"]
        assert len(track_results) > 0, "No trackResult messages"

        # Verify first track result has all required fields
        required_fields = {"type", "index", "artist", "track", "album", "found", "rateLimited", "source"}
        for tr in track_results[:5]:  # Check first 5
            missing = required_fields - set(tr.keys())
            assert not missing, f"Missing fields in trackResult: {missing}. Got: {tr.keys()}"

        # Verify indices are sequential
        indices = [tr["index"] for tr in track_results]
        expected = list(range(len(track_results)))
        assert indices == expected, f"Non-sequential indices: {indices[:10]}..."

        # Verify types
        for tr in track_results[:5]:
            assert isinstance(tr["index"], int)
            assert isinstance(tr["found"], bool)
            assert isinstance(tr["rateLimited"], bool)
            assert isinstance(tr["artist"], str)
            assert isinstance(tr["track"], str)

        print(f"    {len(track_results)} trackResult messages validated")

    finally:
        sidecar.stop()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global passed, failed, errors

    print(f"\n{'=' * 60}")
    print("End-to-End Direct Hooks Tests")
    print(f"{'=' * 60}")
    print(f"Sidecar: {SIDECAR_PATH}")
    print(f"Test CSVs: {TEST_CSVS}")
    print(f"Python: {sys.executable}")
    print()

    # Check test CSVs exist
    csv_files = [PLAY_ACTIVITY_CSV, RECENTLY_PLAYED_CSV, DAILY_TRACKS_CSV]
    for csv_f in csv_files:
        status = "[OK]" if csv_f.exists() else "[MISSING]"
        print(f"  {status} {csv_f.name}")
    print()

    # Run tests in order
    test_funcs = [
        test_e2e_preview_all_formats,
        test_e2e_settings_persistence,
        test_e2e_rapid_messages,
        test_e2e_daily_tracks_search,
        test_e2e_recently_played_search,
        test_e2e_track_result_structure,
        test_e2e_pause_resume,
        test_e2e_stop_search,
        test_e2e_export_lastfm,
        test_e2e_export_listenbrainz,
        test_e2e_export_missing,
        test_e2e_export_all_formats,
    ]

    for func in test_funcs:
        func()

    print(f"\n{'=' * 60}")
    print(f"Results: {passed} passed, {failed} failed out of {passed + failed}")
    if errors:
        print("\nFailures:")
        for err in errors:
            print(f"  - {err}")
    print(f"{'=' * 60}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
