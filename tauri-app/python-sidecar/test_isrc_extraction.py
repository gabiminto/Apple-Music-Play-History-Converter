import importlib.util
from pathlib import Path


def _load_sidecar_module():
    sidecar_path = Path(__file__).parent / "sidecar.py"
    spec = importlib.util.spec_from_file_location("sidecar_module", sidecar_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_normalize_tracks_extracts_isrc_from_standard_column():
    sidecar = _load_sidecar_module()

    rows = [{
        "Artist": "Artist A",
        "Song Name": "Track A",
        "Album Name": "Album A",
        "Event End Timestamp": "2025-01-01T00:00:00Z",
        "Media Duration In Milliseconds": "123000",
        "ISRC": "usrc17607839",
    }]

    tracks = sidecar.normalize_tracks(rows, "Play Activity")

    assert tracks[0]["isrc"] == "USRC17607839"


def test_normalize_tracks_extracts_isrc_from_fallback_column_name():
    sidecar = _load_sidecar_module()

    rows = [{
        "Artist": "Artist B",
        "Song Name": "Track B",
        "Album Name": "Album B",
        "Event End Timestamp": "2025-01-01T00:00:00Z",
        "Media Duration In Milliseconds": "231000",
        "Recording ISRC Code": "GBUM71029604",
    }]

    tracks = sidecar.normalize_tracks(rows, "Play Activity")

    assert tracks[0]["isrc"] == "GBUM71029604"
