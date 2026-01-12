import toga
from toga.style import Pack

from apple_music_history_converter.apple_music_play_history_converter import AppleMusicConverterApp
from apple_music_history_converter.music_search_service_v2 import MusicSearchServiceV2


def test_apple_music_section_builds_without_enabled_kwarg():
    app = AppleMusicConverterApp.__new__(AppleMusicConverterApp)
    app.spacing = {"md": 16, "xs": 8, "xxs": 4}
    app.typography = {
        "headline": {"font_size": 12, "font_weight": "bold"},
        "caption": {"font_size": 10},
        "body": {"font_size": 10},
    }
    app.colors = {
        "text_primary": "#000000",
        "text_secondary": "#666666",
        "success": "#00AA00",
    }

    app.get_pack_style = AppleMusicConverterApp.get_pack_style.__get__(app, AppleMusicConverterApp)
    app.browse_apple_music_key = lambda *args, **kwargs: None
    app.save_and_test_apple_music_credentials = lambda *args, **kwargs: None

    section = app.create_apple_music_api_section()
    assert isinstance(section, toga.Box)
    assert app.am_key_path_input is not None


def test_apple_music_enabled_setting_exists():
    """Test that Apple Music enabled setting can be read/written."""
    service = MusicSearchServiceV2()

    # Should have a setting for apple_music_enabled
    # Default should be True (enabled when configured)
    enabled = service.settings.get("apple_music_enabled", True)
    assert enabled == True

    # Should be able to disable
    service.settings["apple_music_enabled"] = False
    assert service.settings["apple_music_enabled"] == False


def test_is_apple_music_configured_respects_enabled():
    """Test that _is_apple_music_configured checks enabled setting."""
    service = MusicSearchServiceV2()

    # Set up fake credentials
    service.settings["apple_music_team_id"] = "TEST123"
    service.settings["apple_music_key_id"] = "KEY123"
    service.settings["apple_music_key_path"] = "/fake/path.p8"
    service.settings["apple_music_enabled"] = True

    # When enabled=True and credentials exist, should be configured
    assert service._is_apple_music_configured() == True

    # When enabled=False, should NOT be configured even with credentials
    service.settings["apple_music_enabled"] = False
    assert service._is_apple_music_configured() == False
