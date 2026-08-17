# HarnessTap Desktop UI Design

Visual language for the Tauri control plane. Product behavior lives in `SPEC.md` and feature specs; this file is the UI lockfile.

## Classifier

App UI (not marketing). Anti-slop: no purple/violet gradients, no 3-column feature grids, no icon-in-colored-circle rows, no celebratory emoji, no system-ui as the primary face font.

## Theme

Dark dense ops chrome. One accent (blue) for selection and primary actions. Status colors only for traffic-light state, always paired with a text label (`green` / `yellow` / `red`), never color alone.

## Typography

- UI: **IBM Plex Sans** (fallback: `"Segoe UI", sans-serif`)
- Mono (paths, versions, timestamps, content, counts): **IBM Plex Mono** (fallback: `ui-monospace, monospace`)
- Primary copy ≥16px; dense metadata 13px with contrast ≥4.5:1
- Title sans; field values 16px sans; path / version / content / timestamps mono 13px

## Tokens

`:root` in `styles.css` is the source of truth. Do not invent extra palette roles. Do not reuse `--accent` or `--muted` as shadcn surface tokens.

- Surfaces: `--bg`, `--surface`, `--surface-2`, `--border`
- Text: `--fg`, `--muted`
- Accent: `--accent`
- Status: `--green`, `--yellow`, `--red`
- Type: `--font`, `--mono`
- Radius: `--radius` (`0.25rem`; tight. Pills only for small filter chips)

## Chrome

- Harness inventories are bordered sections / definition lists, not a card mosaic.
- Motion: status color transitions and in-progress switch-step highlight only.
- Focus: 2px `--accent` outline, 2px offset.
- Labeled `btn primary` for the one accent action in a cluster; labeled `btn` for secondary. Icon-only is for header and rail chrome (workspace switcher, refresh, settings), never for Library or Environments record actions.
- Action clusters: flex, gap ≥ `0.4rem`, never flush, never `space-between` siblings for two or three related buttons.
- Overlays: drawers for preview / apply / import. Confirm dialogs only for destructive or discard. Library record detail is a full-panel document, not a modal.

## Layout

Header destinations: **Library | Environments | Global | Project**. No header Plugins tab. No header Apply-plugin control.

| Workspace | Shell |
| --- | --- |
| Global / Project | Profiles rail (~220px) + live-state `main`. Below ~720px, stack rail above the pane. |
| Library | Filter sidebar + one main pane (list **or** detail). No profile rail. No Items/Packages tabs. |
| Environments | Full-width list + detail. No profile rail. |

Landmarks: `nav` (profiles rail, scope layout only), `main` (live, library, or environments).

## Interaction locks

Durable contracts only. Screen recipes belong in the feature spec that introduced them.

**Header destinations**

- Re-clicking an already-active header destination (Library, Environments, Global, Project) returns that view to its entrypoint and clears its filters. Clicking a different destination only switches.
- Library re-click applies default filters and returns to the list via the same path as a sidebar filter change (`applyFilterChange`).
- Environments re-click clears the name filter and deselects. Create/edit drawer stays if open.
- Global and Project re-click clear the profile rail search and close edit-profile; the selected profile stays. Project re-click does not reopen the directory picker.

**Scope (Global / Project)**

- Clicking a profile selects it; **Switch** commits. No “Both” view. Switch applies to the current view only.
- Profiles enabled in home appear in Global; profiles in project config appear in Project; enabled in both appear in both.
- Right pane is always machine live state. Target preview is a drawer.
- Switching: yellow panel, ordered steps, cancel disabled during apply.

**Apply vs Sync**

- Rail Apply = profile switch / re-apply.
- Library plugin Apply = `ht apply` (plugin graph). Does not use profile switch. Global apply of a profile-tagged package still records the active profile (`ht apply --global`).
- Library Sync = `resource sync` (refresh the library copy from its install source). Never means Apply.
- Sync on a library row is `resource sync`.

**Library**

- Client-merged list of resources and plugin packages. Composition-ref rows (`resources.type = plugin`) display as **plugin ref**; type filter `plugin` includes both.
- Main pane is list XOR full-panel detail. Back (top left) and Esc return to the list. Esc while editing a field cancels that edit only. Sidebar filter changes return to the list (blocked while a confirm is open or an action is in flight).
- Filters: type as badges; updated as a segment; namespace as a searchable select; origin as a radio list. Origin groups `manual` and `local_snapshot` as **Local**; `marketplace_link` as **Marketplace**. Same labels on hover and detail. Storage `origin_kind` is unchanged.
- Detail: title is the name (double-click to rename). Other fields are icon + value; icon tooltip names the field. Double-click to edit. Default environment is only the field-row combobox.
- Header cluster (right of the Library title): **Create plugin** (accent), **Import**, **Tracked directories**. Labeled, compact, not icon-only. Create plugin (accent primary).

**Environments**

- Globally active environment is a list-row `active` badge, not a header status marker.
- Name filter lives in the list sidebar. Sidebar inventory is values and secrets only. Plugins that default to this environment appear in detail as “Plugins referencing this environment” and open that plugin’s Library detail.
- Detail: keyed definition list + harness blocks. Apply / edit / delete are icon-actions in the detail header. Apply (`environment use`) only when process env drifted from this environment.

**Lists**

- Resource hover cards sit at the pointer and close when the pointer leaves.
