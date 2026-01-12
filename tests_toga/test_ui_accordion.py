# tests_toga/test_ui_accordion.py
"""Tests for the AccordionSection component."""
import toga
from toga.style import Pack
from toga.constants import COLUMN


def test_accordion_section_creates_header():
    """Test that AccordionSection creates a clickable header."""
    from apple_music_history_converter.accordion_section import AccordionSection

    content = toga.Box()
    section = AccordionSection(title="Test Section", content=content, expanded=False)

    assert section.title == "Test Section"
    assert section.header_box is not None
    assert section.expanded == False


def test_accordion_section_toggle():
    """Test that AccordionSection can toggle expanded state."""
    from apple_music_history_converter.accordion_section import AccordionSection

    content = toga.Label("Content")
    section = AccordionSection(title="Test", content=content, expanded=False)

    assert section.expanded == False
    section.toggle()
    assert section.expanded == True
    section.toggle()
    assert section.expanded == False


def test_accordion_section_get_box():
    """Test that AccordionSection returns a complete Box widget."""
    from apple_music_history_converter.accordion_section import AccordionSection

    content = toga.Label("Content")
    section = AccordionSection(title="Test", content=content, expanded=True)

    box = section.get_box()
    assert isinstance(box, toga.Box)


def test_accordion_section_expand_collapse():
    """Test explicit expand and collapse methods."""
    from apple_music_history_converter.accordion_section import AccordionSection

    content = toga.Label("Content")
    section = AccordionSection(title="Test", content=content, expanded=False)

    assert section.expanded == False
    section.expand()
    assert section.expanded == True
    section.expand()  # Should stay expanded
    assert section.expanded == True
    section.collapse()
    assert section.expanded == False
    section.collapse()  # Should stay collapsed
    assert section.expanded == False


def test_accordion_section_on_toggle_callback():
    """Test that on_toggle callback is called when toggling."""
    from apple_music_history_converter.accordion_section import AccordionSection

    callback_called = []

    def on_toggle(section):
        callback_called.append(section.expanded)

    content = toga.Label("Content")
    section = AccordionSection(
        title="Test",
        content=content,
        expanded=False,
        on_toggle=on_toggle
    )

    section.toggle()
    assert callback_called == [True]
    section.toggle()
    assert callback_called == [True, False]


def test_accordion_section_chevron_text():
    """Test that chevron displays correct indicator based on state."""
    from apple_music_history_converter.accordion_section import AccordionSection

    content = toga.Label("Content")

    # Test collapsed state
    section_collapsed = AccordionSection(title="Test", content=content, expanded=False)
    assert section_collapsed.chevron_label.text == "[>]"

    # Test expanded state
    section_expanded = AccordionSection(title="Test", content=content, expanded=True)
    assert section_expanded.chevron_label.text == "[v]"


def test_accordion_section_custom_colors():
    """Test that custom colors are applied."""
    from apple_music_history_converter.accordion_section import AccordionSection

    custom_colors = {
        "surface": "#FF0000",
        "text_primary": "#00FF00",
        "text_secondary": "#0000FF"
    }

    content = toga.Label("Content")
    section = AccordionSection(
        title="Test",
        content=content,
        colors=custom_colors
    )

    assert section.colors == custom_colors


def test_accordion_section_custom_spacing():
    """Test that custom spacing is applied."""
    from apple_music_history_converter.accordion_section import AccordionSection

    custom_spacing = {"xs": 2, "sm": 4, "md": 8}

    content = toga.Label("Content")
    section = AccordionSection(
        title="Test",
        content=content,
        spacing=custom_spacing
    )

    assert section.spacing == custom_spacing
