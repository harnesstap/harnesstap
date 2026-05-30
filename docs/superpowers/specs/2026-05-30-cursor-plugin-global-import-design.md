# Cursor Plugin Global Import Design

**Status:** Approved (2026-05-30).

## Problem

HarnessDeck can already scan project files, detect home-directory harness resources, and inventory installed Cursor and Claude plugins. It cannot yet take a local plugin source such as `cursor-team-kit/` or `.cursor-plugin/marketplace.json`, snapshot its skills/agents/rules into HarnessDeck, and then install those resources into the **global** locations of every configured harness.

That leaves a gap for teams that author or collect Cursor plugins but want to reuse the same content across Copilot, Copilot CLI, Claude Code, Cursor, Codex, and other supported harnesses through one HarnessDeck workflow.

## Goals

- Accept a **plugin directory** or **marketplace manifest** as an importable scan source.
- Snapshot imported plugin contents into HarnessDeck-managed canonical resources rather than keeping a live link to the original source directory.
- Install imported resources into the **global** directories of every configured harness that can represent them.
- Prompt on conflicts by default before overwriting existing global files.
- Support marketplace manifests that expand into multiple plugin snapshots in one import.
- Prove the flow with end-to-end coverage using a real plugin fixture such as `cursor-team-kit`.

## Non-Goals (v1)

- Continuous sync from the original plugin directory after import.
- Full plugin lifecycle management (`install`, `update`, `uninstall`) for native IDE plugin managers.
- Preserving unsupported plugin-only behaviors that do not map to HarnessDeck resource types.
- Remote marketplace hosting or network registry management inside HarnessDeck.

## Decisions

| Topic | Decision |
|-------|----------|
| Source types | Support plugin roots and marketplace manifest files |
| Persistence model | Snapshot into HarnessDeck-managed canonical resources |
| Install target | Global harness directories, not project directories |
| Harness coverage | All configured harnesses that can serialize the imported resource types |
| Conflict policy | Prompt by default with replace / skip / cancel |
| UX shape | Extend scanning/import flow instead of adding a separate dedicated command |

## Approach

Use a **plugin-source import pipeline** that feeds the existing canonical resource model, then add a **global apply/install mode** that reuses current serializers but writes to each platform's `globalPaths` instead of `projectPaths`.

This keeps plugin import as a source-ingestion problem rather than creating a parallel plugin-to-harness translation system. It also avoids introducing a second long-lived snapshot store beyond HarnessDeck's current resource/preset model.

Rejected alternatives:

- **Managed snapshot install layer outside the resource model** — stronger separation, but duplicates existing persistence and apply concepts.
- **Direct plugin-to-harness translators** — faster initially, but duplicates serializer logic and scales poorly across supported harnesses.

## Architecture

### 1. Plugin-source detection

Extend scanning/import entry points so a source path can resolve to:

- a plugin root containing `.cursor-plugin/plugin.json`
- a plugin root containing `.claude-plugin/plugin.json`
- a marketplace manifest such as `.cursor-plugin/marketplace.json`

Detection should identify the source kind before normalization and return a clear error for unsupported layouts.

### 2. Normalization into canonical resources

Imported plugin artifacts are mapped into existing HarnessDeck resource types:

- plugin `skills` → canonical `skill` resources
- plugin `agents` → canonical `agent` resources
- plugin `rules` / instruction files → canonical rule/instruction resources where supported

Each imported resource carries provenance metadata including:

- source kind (`cursor-plugin`, `claude-plugin`, `marketplace`)
- plugin name / version when available
- imported-at timestamp
- original relative file path inside the plugin snapshot

Marketplace imports expand into multiple plugin snapshots, then reuse the same normalization path for each plugin entry.

### 3. Snapshot persistence

Because imports are one-time snapshots, HarnessDeck stores the normalized resources and enough provenance to explain where they came from, but it does not keep a live dependency on the original filesystem path.

At minimum, imported snapshots must make it possible to:

- inspect what plugin content was imported
- reinstall the snapshot globally later
- distinguish imported/generated files from unmanaged user-authored files

### 4. Global apply/install mode

Add a global-target install path that:

1. resolves the configured harness set
2. filters imported resources to what each harness can represent
3. serializes through the existing per-platform serializer layer
4. writes into each platform's `globalPaths`

This is the key behavioral change: today HarnessDeck writes project output only. Global install makes imported plugin content available to any configured harness without depending on a project directory.

## Data Model

HarnessDeck should keep using canonical resources as the primary stored unit. Add import metadata rather than a separate first-class plugin resource type.

Suggested shape:

```ts
interface ImportedSnapshot {
  id: string;
  sourceKind: "cursor-plugin" | "claude-plugin" | "marketplace";
  sourceLabel: string;
  pluginName: string;
  pluginVersion?: string;
  importedAt: string;
  resources: ImportedResourceRef[];
}

interface ImportedResourceRef {
  resourceId: string;
  resourceType: string;
  relativePath: string;
}
```

Also track generated global outputs so conflict prompts and future cleanup can distinguish:

- HarnessDeck-generated files owned by an imported snapshot
- unmanaged pre-existing files in the target harness

## CLI Surface

Keep the workflow scan/import-first rather than inventing a new standalone command family.

| Command shape | Behavior |
|---------------|----------|
| `harnessdeck scan <plugin-dir-or-marketplace>` | Detect plugin source, snapshot it into canonical resources, report imported counts |
| `harnessdeck scan ... --import-global` | After snapshotting, install globally to configured harnesses |
| `harnessdeck scan ... --harness <id>` | Limit global installation to specific harnesses |
| `harnessdeck scan ... --dry-run` | Show what would import/install without writing files |

## Import Flow

```text
scan source path
  -> detect plugin root or marketplace manifest
  -> parse plugin manifests and declared resource files
  -> snapshot referenced files
  -> normalize into canonical resources
  -> persist imported snapshot metadata
  -> optionally install globally
       -> resolve configured harnesses
       -> filter by serializer capability
       -> prompt on conflicts
       -> write to each harness global path
```

## Conflict Handling

| Situation | Behavior |
|-----------|----------|
| Missing manifest or referenced file | Fail import with clear path-specific error |
| Unsupported plugin artifact type | Warn and skip that artifact; fail only if no supported resources remain to import |
| Harness has no known global path | Report unsupported target; continue with others |
| Existing unmanaged target file | Prompt replace / skip / cancel |
| Existing HarnessDeck-generated target file | Prompt with snapshot ownership details before replace |
| Marketplace entry malformed | Fail that entry clearly; continue or fail whole import based on existing batch error conventions |

## Testing

Fixtures:

- `cursor-team-kit` plugin root fixture
- marketplace manifest fixture containing multiple plugin entries
- temp global home roots for each harness; never write to the real user home in tests

Coverage:

- detect plugin root vs marketplace manifest
- import plugin contents into canonical resources
- preserve provenance metadata on snapshot import
- install imported resources to harness global paths
- filter unsupported resources per harness without failing supported ones
- prompt-driven conflict handling
- end-to-end: import `cursor-team-kit` once, install globally, then verify the resulting resources are discoverable for multiple configured harnesses

## Phasing

| Phase | Deliverable |
|-------|-------------|
| 1 | Source detection for plugin roots and marketplace manifests |
| 2 | Normalization into canonical resources with snapshot metadata |
| 3 | Global apply/install mode using platform `globalPaths` |
| 4 | Conflict ownership tracking and end-to-end multi-harness tests |

## References

- `src/plugins/providers/cursor.ts`
- `src/plugins/providers/claude-code.ts`
- `src/services/scanner.ts`
- `src/services/applier.ts`
- `src/platforms/*.ts`
