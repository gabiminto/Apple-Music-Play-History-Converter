"""
Accordion Section Component for Settings UI.
Provides collapsible/expandable sections with header and content.

NOTE: No emojis - Windows console crashes on Unicode.
Use ASCII indicators: [>] for collapsed, [v] for expanded.
"""
import toga
from toga.style import Pack
from toga.constants import COLUMN, ROW, CENTER


class AccordionSection:
    """A collapsible section with header and content."""

    def __init__(
        self,
        title: str,
        content: toga.Widget,
        expanded: bool = True,
        on_toggle=None,
        colors: dict = None,
        typography: dict = None,
        spacing: dict = None
    ):
        """
        Create an accordion section.

        Args:
            title: Section header text
            content: Widget to show/hide when expanded/collapsed
            expanded: Initial expanded state
            on_toggle: Callback when section is toggled (receives section instance)
            colors: Theme colors dict with keys like 'surface', 'text_primary', 'text_secondary'
            typography: Typography styles dict
            spacing: Spacing values dict with keys like 'xs', 'sm', 'md'
        """
        self.title = title
        self.content = content
        self.expanded = expanded
        self.on_toggle = on_toggle
        self.colors = colors or {}
        self.typography = typography or {}
        self.spacing = spacing or {"xs": 4, "sm": 8, "md": 12}

        # Create header with chevron
        self.header_box = self._create_header()

        # Container box
        self._container = toga.Box(style=Pack(direction=COLUMN))
        self._container.add(self.header_box)

        # Add content if expanded
        if self.expanded:
            self._container.add(self.content)

    def _create_header(self) -> toga.Box:
        """Create the clickable header row with title and chevron."""
        header = toga.Box(
            style=Pack(
                direction=ROW,
                align_items=CENTER,
                margin=self.spacing.get("sm", 8),
                background_color=self.colors.get("surface", "#F5F5F5")
            )
        )

        # Chevron indicator - ASCII only, no emojis!
        chevron_text = "[v]" if self.expanded else "[>]"
        self.chevron_label = toga.Label(
            chevron_text,
            style=Pack(
                font_size=12,
                width=30,
                color=self.colors.get("text_secondary", "#666666")
            )
        )
        header.add(self.chevron_label)

        # Title label
        self.title_label = toga.Label(
            self.title,
            style=Pack(
                font_size=14,
                font_weight="bold",
                flex=1,
                color=self.colors.get("text_primary", "#000000")
            )
        )
        header.add(self.title_label)

        # Toggle button
        self.toggle_button = toga.Button(
            chevron_text,
            on_press=self._on_header_click,
            style=Pack(width=40, height=30)
        )
        header.add(self.toggle_button)

        return header

    def _on_header_click(self, widget):
        """Handle header click to toggle section."""
        self.toggle()

    def toggle(self):
        """Toggle expanded/collapsed state."""
        self.expanded = not self.expanded
        self._update_ui()
        if self.on_toggle:
            self.on_toggle(self)

    def expand(self):
        """Expand the section."""
        if not self.expanded:
            self.expanded = True
            self._update_ui()

    def collapse(self):
        """Collapse the section."""
        if self.expanded:
            self.expanded = False
            self._update_ui()

    def _update_ui(self):
        """Update UI to reflect current expanded state."""
        # Update chevron - ASCII only, no emojis!
        chevron_text = "[v]" if self.expanded else "[>]"
        self.chevron_label.text = chevron_text
        self.toggle_button.text = chevron_text

        # Add/remove content
        if self.expanded:
            if self.content not in self._container.children:
                self._container.add(self.content)
        else:
            if self.content in self._container.children:
                self._container.remove(self.content)

    def get_box(self) -> toga.Box:
        """Return the container box widget."""
        return self._container

    def set_content(self, content: toga.Widget):
        """
        Replace the content widget.

        Args:
            content: New widget to show when expanded
        """
        # Remove old content if present
        if self.content in self._container.children:
            self._container.remove(self.content)

        self.content = content

        # Add new content if expanded
        if self.expanded:
            self._container.add(self.content)

    def set_title(self, title: str):
        """
        Update the section title.

        Args:
            title: New title text
        """
        self.title = title
        self.title_label.text = title
