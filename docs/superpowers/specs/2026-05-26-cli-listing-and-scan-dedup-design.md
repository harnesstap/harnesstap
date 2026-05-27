# CLI Listing and Scan De-duplication Design

## Context

HarnessDeck's human-mode tables still expose a few implementation details more
prominently than users want:

- `hd p ls` renders preset identity as a combined `name@version` label instead
  of separating version into its own scan-friendly column.
- list-oriented tables such as `hd r ls` and the resources table in
  `hd p show <preset>` show shortened IDs by default even when name + type are
  the primary things the user is reading.

At the same time, project scanning currently over-imports shared instruction
files. Any project with a plain `AGENTS.md` can be detected as several
AGENTS-based platforms (`codex`, `opencode`, `kode`, and others). Each matching
serializer then creates its own synthetic instruction resource name
(`codex-instructions`, `kode-instructions`, etc.) even though all of those rows
come from the same physical file. Those resources persist in the shared
`~/.harnessdeck` database and later appear in `hd r ls`, which makes the result
feel arbitrary and noisy.

The user asked for:

1. a dedicated version column in preset list output
2. IDs hidden by default in list-oriented human tables, with an explicit opt-in
3. removal of the surprising synthetic `kode-instructions` style imports
4. a `.harnessdeckignore` mechanism similar to `.gitignore` for project scans

## Approaches Considered

### 1. UI-only cleanup plus ignore file

Adjust the tables and add `.harnessdeckignore`, but leave scanner behavior
otherwise unchanged.

- **Pros:** smallest change set
- **Cons:** does not fix the root cause; shared `AGENTS.md` files would still
  generate arbitrary per-platform instruction names unless manually ignored

### 2. Canonical shared-source scan plus ignore file **(recommended)**

Adjust the tables, collapse overlapping shared instruction files into one
canonical import, and add `.harnessdeckignore` for manual exclusions.

- **Pros:** fixes the duplicate-import root cause while still giving users an
  escape hatch for project-specific exclusions
- **Cons:** requires a bit more scan logic and a small amount of targeted
  cleanup for already-imported synthetic duplicates

### 3. Only scan shared instructions for explicitly requested platforms

Keep today's per-platform naming model, but stop auto-importing AGENTS-based
instructions unless the user passes `--platform`.

- **Pros:** eliminates surprise imports aggressively
- **Cons:** makes the default scan less useful and changes the discovery model
  more than needed for this problem

## Recommended Design

### 1. Human-mode table behavior

#### `hd p ls`

Change the preset list table from:

- `NAME` (currently `name@version`)
- `DESCRIPTION`

to:

- `NAME`
- `VERSION`
- `DESCRIPTION`

The `NAME` column shows only the preset name. The `VERSION` column shows the
stored preset semver. JSON output remains unchanged and still returns the full
preset objects.

#### Shared `--show-id` flag for list-oriented tables

Introduce a human-mode `--show-id` flag anywhere the table is primarily a list
or a disambiguation surface:

- `hd p ls --show-id`
- `hd p show <preset> --show-id` (for the `RESOURCES` table only)
- `hd r ls --show-id`
- ambiguous selector tables that are meant to help the user pick the right row

Default human-mode behavior hides IDs in those tables. Detailed panels keep
their current fidelity unless explicitly changed elsewhere, so `resource show`
still presents the full resource ID in the metadata panel.

This keeps the default output focused on the information a human is usually
scanning, while preserving an explicit path to the identifier when needed.

### 2. Canonical import for overlapping shared instruction files

When multiple detected platforms point at the same project instruction source,
the scanner should import one canonical instruction for that shared file instead
of one synthetic row per platform.

The primary case in scope is `AGENTS.md`, which is currently shared by many
platform definitions. After this change:

- a normal `project scan` should not create new `kode-instructions`,
  `codex-instructions`, `opencode-instructions`, and similar rows from the same
  `AGENTS.md`
- the scanner should keep platform-specific resources (skills, rules, MCP
  config, hooks, agents, commands) exactly as they are today
- only overlapping shared instruction-file imports are canonicalized

The canonicalization key should be based on the imported resource kind plus the
physical source path, rather than platform identity. That keeps the fix narrow:
this change is about shared instruction files, not about redefining the entire
resource identity model.

#### Existing synthetic duplicates

To make the fix user-visible immediately, project scan should perform a targeted
cleanup pass for already-imported synthetic shared-instruction duplicates when
it sees the canonical source again.

That cleanup should be conservative:

- only apply to `instruction` resources
- only apply to rows from the same source path (for example `AGENTS.md`)
- only remove rows whose content matches the newly scanned canonical content
- only remove known synthetic `*-instructions` names that came from the
  overlapping-platform import path

This avoids broad database churn while ensuring a fresh scan can remove stale
noise such as the existing `kode-instructions` entries.

### 3. Project-local `.harnessdeckignore`

Add `.harnessdeckignore` at the project root for project-derived scan flows,
modeled after a small, familiar subset of `.gitignore` behavior.

#### Syntax

- blank lines are ignored
- lines beginning with `#` are comments
- glob patterns match resource source paths relative to the project root
- `!pattern` re-includes a previously ignored path

Examples:

```gitignore
AGENTS.md
.agents/skills/private-*
!.agents/skills/shared/SKILL.md
```

#### Scope

Apply the ignore file to scan flows that read project files:

- `hd project scan`
- `hd preset from-project`

Do not expand the first version of this feature to home-default discovery during
`hd init`. That keeps the semantics simple and aligned with the user's stated
need: controlling what gets imported from a project repository.

#### Match point

Ignore matching should happen before persistence, against the relative source
path that would be stored on the resource (`AGENTS.md`,
`.agents/skills/foo/SKILL.md`, and so on). That makes patterns intuitive and
keeps the behavior independent from resource naming changes.

### 4. Output and compatibility rules

- JSON output stays unchanged for preset and resource commands.
- Human-mode output changes are additive and opt-in where identifiers are
  concerned.
- Existing commands keep their current names; this design changes formatting and
  scan behavior, not the command surface.
- The ignore file is optional. Repositories without `.harnessdeckignore`
  continue to scan normally, with the new shared-instruction de-duplication.

## File Impact

- **Modify:** `src/index.ts` — preset/resource table rendering and `--show-id`
  option plumbing
- **Modify:** `src/services/scanner.ts` — shared-instruction canonicalization,
  ignore handling, and targeted duplicate cleanup
- **Modify:** one or more platform serializers only if needed to expose enough
  source/canonical metadata for the scan pass
- **Add:** a small scanner ignore helper/service if the logic does not fit
  cleanly inside `scanner.ts`
- **Modify:** CLI and scanner tests covering table output, ignore matching, and
  duplicate shared-instruction imports

## Testing

Cover at least these behaviors:

1. `preset list` human output shows separate `NAME`, `VERSION`, and
   `DESCRIPTION` columns
2. `preset list --show-id` includes the ID column, while the default output does
   not
3. `preset show` resource table hides IDs by default and includes them with
   `--show-id`
4. `resource list` hides IDs by default and includes them with `--show-id`
5. scanning a project with one `AGENTS.md` does not create multiple synthetic
   `*-instructions` resources for AGENTS-based platforms
6. a rescan can remove previously imported synthetic duplicates when the source
   content matches
7. `.harnessdeckignore` excludes matching project resources and supports `!`
   re-inclusion

## Success Criteria

- `hd p ls` is easier to scan because version has its own column
- human-mode list tables no longer lead with IDs unless the user explicitly opts
  in
- a normal project scan no longer creates new `kode-instructions`-style noise
  from shared `AGENTS.md` files
- users can exclude project scan inputs with `.harnessdeckignore` patterns
