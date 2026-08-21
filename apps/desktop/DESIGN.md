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
- Labeled `btn primary` for the one accent action in a cluster; labeled `btn` for secondary. Icon-only is for header and rail chrome (workspace back, refresh, settings, History), never for Library, Sources, or Environments record actions. Header destinations show icon plus name.
- Action clusters: flex, gap ≥ `0.4rem`, never flush, never `space-between` siblings for two or three related buttons.
- Overlays: full-screen panels (not side drawers) for settings, create/edit, import, apply, browse, migrate, account, stash, history, and resource inspect. Back (top left) and Esc leave the panel. Confirm dialogs only for destructive or discard. Report dialogs for Doctor. Library record detail is a full-panel document in the workspace, not a modal. Cloud browse overlay is gone.
- Settings: labeled tabs **Harnesses | Marketplaces | Publish catalogs | Project | Advanced**. One tab visible at a time. Project tab uses the project directory picker (recent + Browse) to inspect `.harnesstap/config.toml`.

## Layout

Header destinations: **Library | Sources | Environments | Global | Project**. No header Plugins tab. No header Apply-plugin control.

| Workspace | Shell |
| --- | --- |
| Global / Project | Profiles rail (~220px) + live-state `main`. Below ~720px, stack rail above the pane. |
| Library | Filter sidebar + one main pane (list **or** detail). No profile rail. No Items/Packages tabs. |
| Sources | Source sidebar + one main pane (list **or** plugin-tree **or** preview). No profile rail. |
| Environments | Full-width list + detail. No profile rail. |

Landmarks: `nav` (profiles rail, scope layout only), `main` (live, library, sources, or environments).

## Interaction locks

Durable contracts only. Screen recipes belong in the feature spec that introduced them.

**Header destinations**

- Re-clicking an already-active header destination (Library, Sources, Environments, Global, Project) returns that view to its entrypoint and clears its filters. Clicking a different destination only switches.
- Back icon to the left of the panel title (Library, Environments, Profiles). Back returns to the previous screen: nested pane first (Library detail / history / draft, or edit-profile), then the previous header destination. The control deactivates when there is no previous screen.
- Library re-click applies default filters and returns to the list via the same path as a sidebar filter change (`applyFilterChange`).
- Sources re-click clears the search query, checks all sources, and returns to the list. Add/edit panels stay if open.
- Environments re-click clears the name filter and deselects. Create/edit full-screen panel stays if open.
- Global and Project re-click clear the profile rail search and close edit-profile; the selected profile stays. Project re-click does not reopen the directory picker.

**Scope (Global / Project)**

- Clicking a profile selects it; **Switch** commits. No “Both” view. Switch applies to the current view only.
- Profiles enabled in home appear in Global; profiles in project config appear in Project; enabled in both appear in both.
- Right pane is always machine live state. Target preview is a collapsible details block in that pane.
- Switching: yellow panel, ordered steps, cancel disabled during apply.
- **Remove profile** is a labeled `btn` in the edit-profile header action cluster (next to Done), not icon-only. The same labeled control appears on the live-state header when a profile is selected. Confirm dialog keeps the delete-plugin checkbox.
- Name and description are the first fields of the edit pane (not behind Metadata). Composition stays below.

**Apply vs Sync**

- Rail Apply = profile switch / re-apply.
- Library plugin Apply = `ht apply` (plugin graph). Does not use profile switch. Global apply of a profile-tagged package still records the active profile (`ht apply --global`).
- Library **Update** = origin fetch (`plugin update` / `ht plugin update`). Replaces a syncable working head from marketplace, git, or catalog. Never labeled Sync.
- Library Sync = `resource sync` (refresh the library copy from its install source). Never means Apply.
- Sync on a library row is `resource sync`.

**Library**

- Client-merged list of resources and plugin packages. Plugin packages are type **plugin**; composition-ref rows (`resources.type = plugin`) are type **plugin ref**. Type filters and list groups are separate.
- Main pane is list XOR full-panel detail. Back (top left) and Esc return to the list. Esc while editing a field cancels that edit only. Sidebar filter changes return to the list (blocked while a confirm is open or an action is in flight).
- Authored plugin detail **History** opens a version list in the main pane (not a drawer). Frozen inspect is the same detail document, read-only. Back/Esc: frozen → version list → working head → library list.
- Restore copies a frozen snapshot onto the working head and marks it dirty. It does not Apply.
- Filters: type as badges; updated as a segment; namespace as a searchable select; origin as a radio list. Origin groups `manual` and `local_snapshot` as **Local**; `marketplace_link` as **Marketplace**. Same labels on hover and detail. Storage `origin_kind` is unchanged.
- Detail: title is the name (double-click to rename). Other fields are icon + value; icon tooltip names the field. Double-click to edit. Default environment is only the field-row combobox. Updated is locale absolute date with relative time in parentheses. Plugin-type rows (`resources.type = plugin`) omit Description, Namespace, and Content; Origin is Local / Marketplace only (no `origin_ref`); Marketplace URL shows for Marketplace origin when the registry has a URL; Path is the install directory. Contained files are grouped relative paths with an icon-only open-in-editor control (the only Library icon-only record action).
- Header cluster (right of the Library title): **Create plugin** (accent), **Import**, **Tracked directories**, **Update all**. Labeled, compact, not icon-only. Create plugin (accent primary). **Update all** is secondary (`btn`, not accent); disabled when origin check found no outdated plugin-package heads or an update is in flight. Confirm: “Update N plugins from origin?”
- Plugin-package list rows show a yellow **Update available** badge (color + text, never color alone) when origin check is outdated. Not on authored, frozen, or resource rows.
- Plugin detail actions for upstream/catalog working heads: Apply, labeled **Update**, Fork, Doctor, Delete. Update has no extra confirm; busy disables the cluster.
- Delete confirm: list profiles and plugins that still attach this selector. Offer **Remove from active profile** as a tertiary action when it is enabled there. Primary action is **Delete from library + disk**; secondary is **Delete from library**. Load a delete plan before opening the dialog; group locations by global / project / source; show **Protected** blockers and disable only the disk-inclusive action when blockers exist.

**Sources**

- Source sidebar + one main pane (list XOR plugin-tree XOR preview). No profile rail. Marketplaces and catalogs are managed in Sources, not Settings.
- Sources re-click clears the search query, checks all sources, and returns to the list. Back/Esc: preview → plugin-tree → list (standalone preview skips the tree). Esc while a confirm is open dismisses the confirm only.
- Header cluster (right of the Sources title): **Add marketplace** (accent), **Connect catalog**. Labeled, compact, not icon-only. Add marketplace is the only accent control in this cluster.
- Record actions on the plugin tree (preview inherits parent plugin actions) are labeled: **Pull**, **Pin to plugin**, **Attach to plugin**, **Open in Library**. Not icon-only. No Update button on Sources.
- In-library marketplace and catalog hits show a yellow **Update available** badge (color + text) next to In library when origin check is outdated. Open in Library is the apply path. Pin stays.
- Cloud catalog discovery lives in Sources. The Cloud browse overlay is gone; the Cloud header control is account-only.

**Environments**

- Globally active environment is a list-row `active` badge, not a header status marker.
- Name filter lives in the list sidebar. Sidebar inventory is values and secrets only. Plugins that default to this environment appear in detail as “Plugins referencing this environment” and open that plugin’s Library detail.
- Detail: keyed definition list + harness blocks. Apply / edit / delete are icon-actions in the detail header. Apply (`environment use`) only when process env drifted from this environment.

**Lists**

- Resource hover cards sit at the pointer and close when the pointer leaves.
