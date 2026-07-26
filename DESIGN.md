# HarnessTap Desktop UI Design

Visual language for the Tauri-embedded profile control plane (Variant A).

## Classifier

App UI (not marketing). Anti-slop: no purple/violet gradients, no 3-column feature grids, no icon-in-colored-circle rows, no celebratory emoji, no system-ui as the primary face font.

## Theme

Dark dense ops chrome. Reference wireframe: split pane with profiles rail (~220px) and live state workspace.

## Typography

- UI: **IBM Plex Sans** (fallback: `"Segoe UI", sans-serif`)
- Mono (paths, versions, counts): **IBM Plex Mono** (fallback: `ui-monospace, monospace`)
- Body text ≥16px equivalent for primary copy; dense rows may use 13px for secondary metadata with contrast ≥4.5:1

## CSS variables (minimum set)

- `--bg`, `--surface`, `--surface-2`, `--border`, `--fg`, `--muted`, `--accent`
- `--green`, `--yellow`, `--red` (panel status — always paired with text label `green|yellow|red`, never color alone)

## Chrome rules

- Harness blocks = bordered sections / definition lists, not a decorative card mosaic
- One accent (blue) for selection/primary actions; status colors only for G/Y/R
- Motion: minimal — status color transitions + in-progress step highlight only

## Layout

- Variant A: profiles left rail, live state right
- Below ~720px: stack rail above live pane
- Landmarks: `nav` (profiles), `main` (live)

## Interaction locks

- Select profile → Switch commits (clicking a profile does not switch)
- View: Home | Project (not a third “Both” mode). Switch applies to the current view only.
- Profiles enabled in home appear in Home; profiles in project config appear in Project; enabled in both appear in both views.
- Right pane is always machine live state; target preview is a separate drawer
- Switching mode: yellow panel, ordered steps, cancel disabled during apply step
