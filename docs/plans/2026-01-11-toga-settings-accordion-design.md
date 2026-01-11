# Toga Settings UX Refresh (Accordion)

## Summary
Rework the Settings panel into collapsible/expandable sections with separate Apple Music and iTunes API controls. This reduces scrolling, clarifies service toggles, and makes the settings easier to navigate on both desktop and mobile.

## Goals
- Separate Apple Music API and iTunes API toggles so they can be configured independently.
- Reduce vertical scrolling by grouping settings into collapsible sections.
- Improve clarity with concise labels and a predictable navigation pattern.
- Keep the UI consistent with existing Toga widgets and styles.

## Non-goals
- Redesigning the entire app layout outside Settings.
- Adding new backend service capabilities.
- Changing the config schema beyond what is needed for the separate Apple Music API toggle.

## Current Issues
- Apple Music API effectively always-on due to built-in key, no separate toggle.
- Settings is a long scroll with mixed concerns, hard to find controls.
- Service configuration fields are buried among unrelated options.

## Proposed Structure (Accordion Sections)

1. **Services** (default expanded)
   - Apple Music API
     - Enable checkbox (new explicit toggle)
     - Status label (Configured / Not configured)
     - Read-only client info (if present)
   - iTunes API
     - Enable checkbox (existing toggle)
     - Country selector

2. **Import / Export**
   - Import file selection
   - Export format toggles
   - Export destination settings

3. **Matching & Processing**
   - Matching strategy
   - ISRC/MusicBrainz options
   - Processing toggles

4. **Advanced**
   - Logging / debug settings
   - Experimental flags
   - Reset / clear cache actions

Each section is collapsible and only one (or more) may be open at a time. Default behavior: expand the first section or last-opened section. All sections are visible with headers even when collapsed.

## Apple Music vs iTunes API Controls
- Add a separate `Apple Music API` checkbox (enabled by default if configured).
- Keep iTunes API checkbox as-is; do not link or merge toggles.
- If Apple Music API is not configured, show a concise status message (e.g. “Not configured”).
- If Apple Music API is configured with a built-in key, label as “Configured (built-in)”.

## Toga Implementation Recommendations

### Accordion Pattern
- Use a vertical `toga.Box` container for the accordion list.
- Each section has:
  - A header row (Box) with a title label and a chevron button.
  - A content container (Box) that is added/removed from the DOM based on expanded state.
- Toggle by swapping the content container in/out of the accordion list and updating the chevron.

### Example Component Structure
- `SettingsPanel` (Box)
  - `AccordionSection` (Services)
  - `AccordionSection` (Import / Export)
  - `AccordionSection` (Matching & Processing)
  - `AccordionSection` (Advanced)

`AccordionSection` fields:
- `title`
- `header_box`
- `content_box`
- `expanded` boolean

### Navigation and UX
- Allow multiple sections expanded, or enforce single-open (choose consistent behavior; default to multiple for flexibility).
- Keep headers large and clickable (text + chevron).
- Use spacing and subtle separators to reduce visual noise.

## Config and State
- Store Apple Music API toggle in config (new key) and honor it in service logic.
- Optionally store expanded/collapsed state in memory only (no persistence required initially).

## Risks
- If Apple Music config is treated as always-on elsewhere, ensure service calls check the new toggle.
- Avoid heavy re-layout that could break existing tests; adjust tests to new section structure.

## Validation
- Manual: verify each section expands/collapses correctly and controls update config.
- Automated: add UI tests for section rendering and Apple Music/iTunes toggles.

## Open Questions
- Should sections allow multiple expanded at once or enforce single-open?
- Should expanded state persist across app sessions?

