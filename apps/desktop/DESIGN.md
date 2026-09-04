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
- Labeled `btn primary` for dialog confirm actions (Create, Publish, Save, Update) together with an icon. Profiles rail **Apply** / **Re-apply** is a full-width accent `btn primary` with visible text and the icon to the right of the label. Other persistent page chrome — Clear, Remove, Add all, More, Show all, Install, Library/Sources header actions, and record actions — is icon-only with a hover tooltip that keeps the original label. Header destinations show icon plus name.
- Action clusters: flex, gap ≥ `0.4rem`, never flush, never `space-between` siblings for two or three related buttons.
- Header icon-only chrome may include an **Update available** control (arrow-up icon plus a red badge). The badge is paired with the accessible name **Update available** (current → newer). Click opens a centered dialog with release notes, a GitHub release link (text link, not a chrome button), and **Update** (icon plus label; downloads the matching GitHub installer for this os/arch). The control is omitted when Desktop is current.
- Overlays: full-screen panels (not side drawers) for settings, create/edit, import, apply, browse, migrate, account, stash, and history. Resource inspect is a centered, viewport-capped dialog (scrollable body, height follows content). File apply diffs are the same centered, viewport-capped dialog (not pinned to a pane corner). Back (top left) and Esc leave the panel or dialog. Confirm dialogs only for destructive or discard. Report dialogs for Doctor. The Library create-resource type picker is a centered dialog. Library record detail is a full-panel document in the workspace, not a modal. Cloud browse overlay is gone.
- Settings: labeled tabs **Harnesses | Project | Advanced**. One tab visible at a time. Project tab: project directory picker (recent + Browse), raw `apm.yml` editor (Library Content mono chrome; save runs existing config validate and refuses on errors), icon-only Open config as the external-editor escape hatch (tooltip **Open config**), profile definition list, validation/load errors. It reads and writes `apm.yml` only. Marketplaces and catalogs are managed in Sources, not Settings.

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
- Back icon to the left of the panel title (Library, Sources, Environments, Profiles). Back returns to the previous screen: nested pane first (Library detail / history, Sources preview / plugin-tree, or edit-profile), then the previous header destination. The control deactivates when there is no previous screen.
- Library re-click applies default filters and returns to the list via the same path as a sidebar filter change (`applyFilterChange`).
- Sources re-click clears the search query, checks all sources, and returns to the list. Add/edit panels stay if open. Sidebar **Clear filters** uses the same filter defaults (empty search, every source checkbox checked).
- Environments re-click clears the name filter and deselects. Create/edit full-screen panel stays if open.
- Global and Project re-click clear the profile rail search and close edit-profile; the selected profile stays. Project re-click does not reopen the directory picker.

**Scope (Global / Project)**

- Clicking a profile selects it; **Switch** commits. No “Both” view. Switch applies to the current view only.
- Profiles enabled in home appear in Global; profiles in project config appear in Project; enabled in both appear in both. The init profile is named **global default** and stays Global-only. Desktop project bootstrap seeds a **project default** from that repo’s on-disk resources and does not enable the global profile in the project. Auto-seeded project defaults are project-scoped only.
- Profile resources lists the selected profile’s composition. When that profile is also active, the list is live library state for it. Target preview is a collapsible apply-delta block in the same pane: stack and file changes omit material already deployed by an inherited host plugin; host-native plugin MCP (for example Cursor Slack) is present, not an install gap. Install gaps (in profile): MCP that is in the profile and not currently installed uses **+**; MCP whose live config differs from the expected install uses **!**; missing plugins keep **!**. Snapshot-only MCP from a whole-file `mcp.json` import is omitted from stack removals when that server is gone from the live file. Shared host configs such as Claude `.claude/settings.json` preview as edits (merged profile keys), never whole-file deletions. Skill apply diffs merge extra live frontmatter and body when the profile snapshot is a subset of the live file. Not-staged live resources (on disk, not in the selected profile — including extra MCP servers in a shared `mcp.json` and skills managed on disk by another profile — plus live resources that are in the profile but differ from the stored snapshot) stay below that list: Plus adds one or overwrites the profile with the live version; Diff on a modified row opens the apply diff; icon-only **Add all** (tooltip **Add all**) in the Profile resources header adds every not-staged resource to the selected profile. Truncated lists use icon-only **More** and **Show all**.
- Switching: yellow panel, ordered steps, cancel disabled during apply. After apply, switch, or Project Install, a yellow pending-approvals strip lists parked executable refs when the trust gate is on.
- **Remove profile** is an icon-only control in the edit-profile header (accessible name and tooltip **Remove profile**), next to Done. Confirm dialog keeps the delete-plugin checkbox. The same icon-only **Remove profile** control appears on the live-state header when a profile is selected.
- Name and description are the first fields of the edit pane (not behind Metadata). Composition stays below. Clicking a composition resource row (not its checkbox) opens the resource inspect dialog.
- Profile rail rows can be dragged to reorder when the filter is empty. Profile rail order is a desktop-only localStorage preference, separate for Global and Project. The Profiles header action cluster is stash, restore, **Publish**, then create. Publish opens a centered catalog-picker dialog (checkboxes, select-all, remembered last selection). With no registered catalog the list shows **no catalog registered** and Publish is disabled. Default environment Clear is an icon to the left of the dropdown; the dropdown includes **None** and **Create a new environment** (+). Profiles filter **Clear** is icon-only (X, tooltip **Clear**). Rail **Apply** / **Re-apply** is a full-width labeled accent button with Check / RotateCw to the right of the text.

**Apply vs Sync**

- Rail Apply = profile switch / re-apply (full-width labeled accent button; icon to the right of **Apply** / **Re-apply**).
- Project **Install** = `ht install` (`POST /v1/apply` with `plugins: []`, project scope). Icon-only with tooltip **Install**. Never labeled Sync or Switch. No `--global` install.
- Library plugin Apply = `ht apply` (plugin graph). Does not use profile switch. Global apply of a profile-tagged package still records the active profile (`ht apply --global`).
- Library **Update** = origin fetch (`plugin update` / `ht plugin update`). Replaces a syncable working head from marketplace, git, or catalog. Never labeled Sync.
- Library Sync = `resource sync` (refresh the library copy from its install source). Never means Apply.
- Sync on a library row is `resource sync`.

**Library**

- Client-merged list of resources and plugin packages. Plugin packages are type **plugin**; composition-ref rows (`resources.type = plugin`) are type **plugin ref**. Type filters and list groups are separate.
- Main pane is list XOR full-panel detail. Back (top left) and Esc return to the list. Esc while editing a field cancels that edit only. Sidebar filter changes return to the list (blocked while a confirm is open or an action is in flight).
- Authored plugin detail **History** opens a version list in the main pane (not a drawer). Frozen inspect is the same detail document, read-only. Back/Esc: frozen → version list → working head → library list.
- Restore copies a frozen snapshot onto the working head and marks it dirty. It does not Apply.
- Filters: type as badges; updated as a segment; namespace as a searchable select; origin as a radio list. Origin groups `manual` and `local_snapshot` as **Local**; `marketplace_link` as **Marketplace**. Same labels on hover and detail. Storage `origin_kind` is unchanged. **Clear filters** restores every facet to its default (All / empty).
- Detail: title is the name (double-click to rename). Other fields are icon + value; icon tooltip names the field. Double-click to edit. Default environment is only the field-row combobox. Updated is locale absolute date with relative time in parentheses. Plugin-type rows (`resources.type = plugin`) omit Description, Namespace, and Content; Origin is Local / Marketplace only (no `origin_ref`); Marketplace URL shows for Marketplace origin when the registry has a URL; Path is the install directory. Contained files are grouped relative paths with an icon-only open-in-editor control. Material Content is a 15-line code block. Path has the only material open-in-editor control (not the inspect header or Content row). Detail field rows use even vertical gap with no per-row vertical margin. MCP server Content shows that server’s config from the live `mcp.json` (or metadata), not an empty placeholder.
- Header cluster (right of the Library title): icon-only **Create resource** (accent), **Import**, **Tracked directories**, **Update all**, each with a hover tooltip of that label. Create resource opens the centered type-picker dialog, then a full-screen single-page form per type with Cancel/Create in the footer; canceling dirty edits confirms discard. Material forms offer an optional add-to-current-profile-and-apply checkbox. **Update all** is disabled when origin check found no outdated plugin-package heads or an update is in flight. Confirm: “Update N plugins from origin?”
- Plugin-package list rows show a yellow **Update available** badge (color + text, never color alone) when origin check is outdated. Not on authored, frozen, or resource rows.
- Plugin detail actions for upstream/catalog working heads: icon-only Apply, **Update**, Fork, Doctor, Delete (tooltips keep those labels). Update has no extra confirm; busy disables the cluster.
- Delete confirm: list profiles and plugins that still attach this selector. Offer **Remove from active profile** as a tertiary action when it is enabled there. Primary action is **Delete from library + disk**; secondary is **Delete from library**. Load a delete plan before opening the dialog; group locations by global / project / source; show **Protected** blockers and disable only the disk-inclusive action when blockers exist.

**Sources**

- Source sidebar + one main pane (list XOR plugin-tree XOR preview). No profile rail. Marketplaces and catalogs are managed in Sources, not Settings.
- The sidebar lists HarnessTap-registered marketplaces and host-configured Claude Code marketplaces from `~/.claude/plugins/known_marketplaces.json`. Host-only rows are not editable or removable in Sources.
- The source sidebar groups checkboxes under Local, Marketplaces, and Cloud. Empty sections are omitted. A top-level **All sources** checkbox selects or clears every source; mixed selection is indeterminate. **Clear filters** clears search and checks every source.
- Sources re-click clears the search query, checks all sources, and returns to the list. Back/Esc: preview → plugin-tree → list (standalone preview skips the tree). Esc while a confirm is open dismisses the confirm only.
- Header cluster (right of the Sources title): icon-only **Add marketplace** (accent) and **Connect catalog**, with those tooltips. Add marketplace is the only accent control in this cluster.
- Record actions on the plugin tree (preview inherits parent plugin actions) are icon-only: **Pull**, **Pin to plugin**, **Attach to plugin**, **Open in Library**. Tooltips keep those labels. No Update button on Sources.
- In-library marketplace and catalog hits show a yellow **Update available** badge (color + text) next to In library when origin check is outdated. Open in Library is the apply path. Pin stays.
- Cloud catalog discovery lives in Sources. The Cloud browse overlay is gone; the Cloud header control is account-only.

**Environments**

- Globally active environment is a list-row `active` badge, not a header status marker.
- Name filter lives in the list sidebar. **Clear filter** clears that query. Sidebar inventory is values and secrets only. Plugins that default to this environment appear in detail as “Plugins referencing this environment” and open that plugin’s Library detail.
- Detail: keyed definition list + harness blocks. Apply / edit / delete are icon-actions in the detail header. Apply (`environment use`) only when process env drifted from this environment.

**Lists**

- Resource hover cards sit at the pointer and close when the pointer leaves.
- Profile rail order is a desktop-only localStorage preference.
