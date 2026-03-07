#!/usr/bin/env python3
"""
Test script for sidecar IPC communication.

Spawns the sidecar process, sends JSON messages on stdin, reads JSON
responses from stdout, and validates each handler.
"""

import json
import subprocess
import sys
import os
import time
import threading
import queue
from pathlib import Path

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
SIDECAR_SCRIPT = Path(__file__).parent / "python-sidecar" / "sidecar.py"
PROJECT_ROOT = Path(__file__).parent.parent
TEST_CSV_DIR = PROJECT_ROOT / "_test_csvs"

RECENTLY_PLAYED_CSV = TEST_CSV_DIR / "Apple Music - Recently Played Tracks.csv"
PLAY_ACTIVITY_CSV = TEST_CSV_DIR / "Apple Music Play Activity small.csv"

TIMEOUT = 15  # seconds per test

# Track results
results = []


def start_sidecar():
    """Spawn sidecar process and return the Popen handle."""
    env = os.environ.copy()
    # Add src/ directory to PYTHONPATH so the sidecar's imports work
    src_dir = str(PROJECT_ROOT / "src")
    pkg_dir = str(PROJECT_ROOT / "src" / "apple_music_history_converter")
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{src_dir}:{pkg_dir}:{existing}" if existing else f"{src_dir}:{pkg_dir}"

    proc = subprocess.Popen(
        [sys.executable, str(SIDECAR_SCRIPT)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        cwd=str(PROJECT_ROOT),
        env=env,
    )

    # Read stdout continuously into a queue so text buffering cannot hide lines
    # from select/poll timing in test assertions.
    proc._stdout_queue = queue.Queue()

    def _pump_stdout():
        for line in proc.stdout:
            proc._stdout_queue.put(line.rstrip("\n"))

    proc._stdout_thread = threading.Thread(target=_pump_stdout, daemon=True)
    proc._stdout_thread.start()

    return proc


def _read_stdout_line(proc, timeout: float):
    """Read one stdout line from the sidecar queue within timeout seconds."""
    try:
        return proc._stdout_queue.get(timeout=max(0.0, timeout))
    except queue.Empty:
        return None


def send_message(proc, msg: dict, expected_type: str | None = None, timeout: float = TIMEOUT) -> list:
    """Send a JSON message and collect response lines.

    If expected_type is provided, waits until that response type is seen or timeout.
    Otherwise, reads until the output stream goes idle.
    """
    line = json.dumps(msg) + "\n"
    try:
        proc.stdin.write(line)
        proc.stdin.flush()
    except BrokenPipeError:
        return [{"type": "error", "error": "Broken pipe - sidecar crashed"}]

    responses = []
    deadline = time.time() + timeout

    while time.time() < deadline:
        remaining = max(0.0, deadline - time.time())
        resp_line = _read_stdout_line(proc, min(0.5, remaining))
        if resp_line is not None:
            resp_line = resp_line.strip()
            if resp_line:
                try:
                    parsed = json.loads(resp_line)
                except json.JSONDecodeError:
                    parsed = {"type": "raw", "raw": resp_line}

                responses.append(parsed)

                if expected_type and parsed.get("type") == expected_type:
                    # Drain any immediately queued messages, then return.
                    settle_deadline = time.time() + 0.2
                    while time.time() < settle_deadline:
                        extra = _read_stdout_line(proc, 0.05)
                        if extra is None:
                            break
                        extra = extra.strip()
                        if not extra:
                            continue
                        try:
                            responses.append(json.loads(extra))
                        except json.JSONDecodeError:
                            responses.append({"type": "raw", "raw": extra})
                    break
        else:
            if responses and not expected_type:
                break

    return responses


def read_initial_ready(proc) -> list:
    """Read the initial 'ready' message sent on startup."""
    responses = []
    deadline = time.time() + 10

    while time.time() < deadline:
        line = _read_stdout_line(proc, 1.0)
        if line is None:
            if responses:
                break
            continue
        line = line.strip()
        if line:
            try:
                responses.append(json.loads(line))
            except json.JSONDecodeError:
                responses.append({"type": "raw", "raw": line})
            if any(r.get("type") == "ready" for r in responses):
                break

    return responses


def find_response(responses, type_key):
    """Find a response with a specific type in a list of responses."""
    for r in responses:
        if r.get("type") == type_key:
            return r
    return None


def record(test_name, passed, detail=""):
    """Record a test result."""
    status = "[PASS]" if passed else "[FAIL]"
    results.append((test_name, passed, detail))
    print(f"  {status} {test_name}" + (f" -- {detail}" if detail else ""))


# ===================================================================
# TESTS
# ===================================================================

def test_startup_ready(proc):
    """Test 0: Verify sidecar sends 'ready' on startup."""
    responses = read_initial_ready(proc)
    ready = find_response(responses, "ready")
    if ready:
        record("startup_ready", True, f"version={ready.get('version')}")
    else:
        record("startup_ready", False, f"Got: {responses}")
    return responses


def test_ping(proc):
    """Test 1: ping -> pong."""
    responses = send_message(proc, {"action": "ping"}, expected_type="pong")
    pong = find_response(responses, "pong")
    if pong:
        record("ping", True, "Received pong")
    else:
        record("ping", False, f"Expected pong, got: {responses}")


def test_analyze_csv_recently_played(proc):
    """Test 2: analyzeCSV with Recently Played Tracks."""
    path = str(RECENTLY_PLAYED_CSV)
    responses = send_message(proc, {"action": "analyzeCSV", "path": path}, expected_type="fileAnalysis")
    analysis = find_response(responses, "fileAnalysis")
    if analysis:
        file_type = analysis.get("fileType", "")
        row_count = analysis.get("rowCount", 0)
        name = analysis.get("name", "")
        passed = (file_type == "Recently Played Tracks" and row_count > 0)
        record(
            "analyzeCSV_recently_played",
            passed,
            f"fileType={file_type}, rowCount={row_count}, name={name}"
        )
    else:
        err = find_response(responses, "error")
        record("analyzeCSV_recently_played", False, f"No fileAnalysis. Responses: {responses}")


def test_analyze_csv_play_activity(proc):
    """Test 3: analyzeCSV with Play Activity small."""
    path = str(PLAY_ACTIVITY_CSV)
    responses = send_message(proc, {"action": "analyzeCSV", "path": path}, expected_type="fileAnalysis")
    analysis = find_response(responses, "fileAnalysis")
    if analysis:
        file_type = analysis.get("fileType", "")
        row_count = analysis.get("rowCount", 0)
        name = analysis.get("name", "")
        passed = (file_type == "Play Activity" and row_count > 0)
        record(
            "analyzeCSV_play_activity",
            passed,
            f"fileType={file_type}, rowCount={row_count}, name={name}"
        )
    else:
        record("analyzeCSV_play_activity", False, f"No fileAnalysis. Responses: {responses}")


def test_preview_csv(proc):
    """Test 4: getPreview with Recently Played Tracks."""
    path = str(RECENTLY_PLAYED_CSV)
    responses = send_message(proc, {"action": "getPreview", "path": path}, expected_type="csvPreview")
    preview = find_response(responses, "csvPreview")
    if preview:
        headers = preview.get("headers", [])
        rows = preview.get("rows", [])
        expected_headers = ["Artist", "Track", "Album", "Timestamp", "Duration"]
        headers_ok = headers == expected_headers
        rows_ok = len(rows) > 0
        passed = headers_ok and rows_ok
        # Check first row has data
        first_row_detail = ""
        if rows:
            first_row_detail = f", first_row={rows[0]}"
        record(
            "getPreview_recently_played",
            passed,
            f"headers_ok={headers_ok}, rows={len(rows)}{first_row_detail}"
        )
    else:
        record("getPreview_recently_played", False, f"No csvPreview. Responses: {responses}")


def test_load_csv(proc):
    """Test 5: loadCSV with Recently Played Tracks."""
    path = str(RECENTLY_PLAYED_CSV)
    responses = send_message(proc, {"action": "loadCSV", "path": path}, expected_type="csvLoaded")
    # loadCSV sends: status, csvLoaded, log
    loaded = find_response(responses, "csvLoaded")
    if loaded:
        success = loaded.get("success", False)
        row_count = loaded.get("rowCount", 0)
        file_type = loaded.get("fileType", "")
        passed = success and row_count > 0 and file_type == "Recently Played Tracks"
        record(
            "loadCSV_recently_played",
            passed,
            f"success={success}, rowCount={row_count}, fileType={file_type}"
        )
    else:
        record("loadCSV_recently_played", False, f"No csvLoaded. Responses: {responses}")


def test_get_settings(proc):
    """Test 6: getSettings."""
    responses = send_message(proc, {"action": "getSettings"}, expected_type="settingsLoaded")
    settings_resp = find_response(responses, "settingsLoaded")
    if settings_resp:
        settings = settings_resp.get("settings", {})
        record("getSettings", True, f"settings_keys={list(settings.keys())}")
    else:
        record("getSettings", False, f"No settingsLoaded. Responses: {responses}")


def test_set_settings(proc):
    """Test 7: setSettings with provider."""
    responses = send_message(proc, {
        "action": "setSettings",
        "settings": {"provider": "itunes_api"}
    }, expected_type="status")
    status = find_response(responses, "status")
    if status and "updated" in status.get("status", "").lower():
        record("setSettings", True, f"status={status.get('status')}")
    else:
        # Check if we got any response
        record("setSettings", bool(responses), f"Responses: {responses}")


def test_get_database_status(proc):
    """Test 8: getDatabaseStatus."""
    responses = send_message(proc, {"action": "getDatabaseStatus"}, expected_type="databaseStatus")
    db_status = find_response(responses, "databaseStatus")
    if db_status:
        record(
            "getDatabaseStatus",
            True,
            f"downloaded={db_status.get('downloaded')}, "
            f"trackCount={db_status.get('trackCount')}, "
            f"size={db_status.get('size')}, "
            f"optimized={db_status.get('optimized')}"
        )
    else:
        record("getDatabaseStatus", False, f"No databaseStatus. Responses: {responses}")


def test_analyze_csv_nonexistent(proc):
    """Test 9: analyzeCSV with nonexistent file - should return error."""
    responses = send_message(
        proc,
        {"action": "analyzeCSV", "path": "/tmp/nonexistent_file.csv"},
        expected_type="error"
    )
    err = find_response(responses, "error")
    if err:
        record("analyzeCSV_nonexistent", True, f"Got expected error: {err.get('error', '')[:80]}")
    else:
        record("analyzeCSV_nonexistent", False, f"Expected error response. Got: {responses}")


def test_unknown_action(proc):
    """Test 10: unknown action -> error."""
    responses = send_message(proc, {"action": "totallyFakeAction"}, expected_type="error")
    err = find_response(responses, "error")
    if err and "Unknown action" in err.get("error", ""):
        record("unknown_action", True, f"Got expected error: {err.get('error')}")
    else:
        record("unknown_action", False, f"Expected unknown action error. Got: {responses}")


def test_invalid_json(proc):
    """Test 11: send invalid JSON -> error."""
    try:
        proc.stdin.write("this is not json\n")
        proc.stdin.flush()
    except BrokenPipeError:
        record("invalid_json", False, "Broken pipe")
        return

    responses = []
    deadline = time.time() + 5
    while time.time() < deadline:
        line = _read_stdout_line(proc, 0.5)
        if line is None:
            if responses:
                break
            continue
        line = line.strip()
        if line:
            try:
                responses.append(json.loads(line))
            except json.JSONDecodeError:
                responses.append({"type": "raw", "raw": line})

    err = find_response(responses, "error")
    if err and "Invalid JSON" in err.get("error", ""):
        record("invalid_json", True, f"Got expected error: {err.get('error')[:80]}")
    else:
        record("invalid_json", False, f"Expected JSON parse error. Got: {responses}")


def test_get_settings_after_set(proc):
    """Test 12: verify setSettings persists by calling getSettings again."""
    responses = send_message(proc, {"action": "getSettings"}, expected_type="settingsLoaded")
    settings_resp = find_response(responses, "settingsLoaded")
    if settings_resp:
        settings = settings_resp.get("settings", {})
        has_provider = settings.get("provider") == "itunes_api"
        record(
            "getSettings_after_set",
            has_provider,
            f"provider={settings.get('provider')} (expected 'itunes_api')"
        )
    else:
        record("getSettings_after_set", False, f"No settingsLoaded. Responses: {responses}")


# ===================================================================
# MAIN
# ===================================================================

def main():
    print("=" * 70)
    print("  Sidecar IPC Test Suite")
    print("=" * 70)
    print()

    # Verify paths
    print(f"Sidecar script: {SIDECAR_SCRIPT}")
    print(f"Project root:   {PROJECT_ROOT}")
    print(f"Test CSV dir:   {TEST_CSV_DIR}")
    print()

    if not SIDECAR_SCRIPT.exists():
        print(f"[FAIL] Sidecar script not found: {SIDECAR_SCRIPT}")
        sys.exit(1)
    if not RECENTLY_PLAYED_CSV.exists():
        print(f"[FAIL] Test CSV not found: {RECENTLY_PLAYED_CSV}")
        sys.exit(1)
    if not PLAY_ACTIVITY_CSV.exists():
        print(f"[FAIL] Test CSV not found: {PLAY_ACTIVITY_CSV}")
        sys.exit(1)

    print("[OK] All files found. Starting sidecar process...")
    print()

    proc = start_sidecar()

    try:
        # Test 0: Startup ready
        print("--- Startup ---")
        test_startup_ready(proc)
        print()

        # Check if process is still alive
        if proc.poll() is not None:
            stderr_out = proc.stderr.read()
            print(f"[FAIL] Sidecar process exited with code {proc.returncode}")
            if stderr_out:
                print(f"  STDERR: {stderr_out[:500]}")
            sys.exit(1)

        # Test 1: Ping
        print("--- Test 1: ping ---")
        test_ping(proc)
        print()

        # Test 2: Analyze CSV - Recently Played
        print("--- Test 2: analyzeCSV (Recently Played Tracks) ---")
        test_analyze_csv_recently_played(proc)
        print()

        # Test 3: Analyze CSV - Play Activity
        print("--- Test 3: analyzeCSV (Play Activity small) ---")
        test_analyze_csv_play_activity(proc)
        print()

        # Test 4: Preview CSV
        print("--- Test 4: getPreview (Recently Played Tracks) ---")
        test_preview_csv(proc)
        print()

        # Test 5: Load CSV
        print("--- Test 5: loadCSV (Recently Played Tracks) ---")
        test_load_csv(proc)
        print()

        # Test 6: Get Settings
        print("--- Test 6: getSettings ---")
        test_get_settings(proc)
        print()

        # Test 7: Set Settings
        print("--- Test 7: setSettings ---")
        test_set_settings(proc)
        print()

        # Test 8: Get Database Status
        print("--- Test 8: getDatabaseStatus ---")
        test_get_database_status(proc)
        print()

        # Test 9: Analyze CSV - nonexistent file
        print("--- Test 9: analyzeCSV (nonexistent file) ---")
        test_analyze_csv_nonexistent(proc)
        print()

        # Test 10: Unknown action
        print("--- Test 10: unknown action ---")
        test_unknown_action(proc)
        print()

        # Test 11: Invalid JSON
        print("--- Test 11: invalid JSON ---")
        test_invalid_json(proc)
        print()

        # Test 12: Verify settings persistence
        print("--- Test 12: getSettings after setSettings ---")
        test_get_settings_after_set(proc)
        print()

    finally:
        # Clean up
        proc.stdin.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()

        # Print stderr for debugging
        stderr_out = proc.stderr.read()
        if stderr_out:
            print("--- Sidecar stderr (debug info) ---")
            # Limit output
            lines = stderr_out.strip().split("\n")
            for line in lines[:30]:
                print(f"  {line}")
            if len(lines) > 30:
                print(f"  ... ({len(lines) - 30} more lines)")
            print()

    # Summary
    print("=" * 70)
    print("  RESULTS SUMMARY")
    print("=" * 70)
    total = len(results)
    passed = sum(1 for _, p, _ in results if p)
    failed = sum(1 for _, p, _ in results if not p)

    for name, p, detail in results:
        status = "[PASS]" if p else "[FAIL]"
        print(f"  {status} {name}")

    print()
    print(f"  Total: {total}   Passed: {passed}   Failed: {failed}")
    print("=" * 70)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
