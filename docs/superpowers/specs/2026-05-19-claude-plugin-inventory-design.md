# Claude Plugin Inventory and Preset Versioning Design

**Status:** Approved (2026-05-19). Implementation plan: [2026-05-19-claude-plugin-inventory.md](../plans/2026-05-19-claude-plugin-inventory.md).

> **Check/update across platforms:** See [plugin lifecycle design](./2026-05-19-plugin-lifecycle-design.md). This doc covers inventory, committed vs effective, and preset versioning.

## Problem

Harnessdeck manages agent configuration as atomic resources (skills, hooks, MCP servers, etc.) but does not model **Claude Code plugins** as versioned, scoped bundles. Teams need to:

1. **Inventory** what plugins a project declares vs what actually loads at runtime.
2. **Package** plugins into presets with optional version pins (exact or semver range), using hybrid embed/reference export.

Claude Code's plugin system defines manifest metadata (`.claude-plugin/plugin.json`), scoped enablement (`user` / `project` / `local` settings), cache-based installs, and version resolution rules documented in the [plugins reference](https://code.claude.com/docs/en/plugins-reference).

## Goals

### Phase B — Inventory

- On scan and status, report **committed** plugins (project `.claude/settings.json`) separately from **effective** plugins (merged user + project + local scopes).
- Resolve installed version and metadata from cache manifests and in-repo plugin trees.
- Expose inventory via `harnessdeck plugin list|show` with `--format human|json`.
- Extend `harnessdeck scan` and `harnessdeck project status` summaries.

### Phase C — Presets

- Allow presets to reference plugins with **exact pin** (`2.1.0`) or **semver range** (`>=2.1.0 <3.0.0`).
- **Hybrid export**: marketplace plugins as references by default; embed in-repo plugin trees or all plugins with `--embed-plugins`.
- Validate plugin versions on `project apply` against preset constraints.
- Extend the v1 bundle format with `plugins[]` and `embedded_plugins[]` (missing keys import as empty arrays).

## Non-Goals (v1)

- Wrapping `claude plugin install`, `uninstall`, or `tag` (update is in [plugin lifecycle design](./2026-05-19-plugin-lifecycle-design.md)).
- Plugin inventory for non–Claude Code harnesses (lifecycle design adds Cursor + providers).
- Token cost estimates (`claude plugin details` parity).
- Marketplace authoring or remote registry inside harnessdeck.

## Approach

Use a **dedicated plugin model** (separate from atomic `resources`) rather than `type: "plugin"` resources. Plugins are bundles; inventory is project-scoped state; presets link via `preset_plugins` with version constraints.

Rejected alternatives:

- **Plugin as resource type** — duplicates scanned skills/hooks from the same tree; poor fit for committed/effective inventory.
- **Delegate to `claude plugin list --json`** — requires Claude CLI, blocks offline/CI, cannot support hybrid embed.

## Data Model

### Plugin identity

- **Marketplace ref:** `formatter@my-marketplace` (matches Claude CLI).
- **Path ref:** normalized relative path from project root, e.g. `./plugins/formatter` (in-repo plugins).

### Plugin entry (inventory)

```ts
interface PluginEntry {
  ref: string;
  name: string;
  version: string; // semver, git SHA, or "unknown"
  version_source: "manifest" | "marketplace" | "git_sha" | "unknown";
  enabled: boolean;
  scope: "user" | "project" | "local"; // declaring scope for this row in effective list
  install_path?: string;
  metadata?: {
    description?: string;
    author?: { name?: string; email?: string; url?: string };
    homepage?: string;
    repository?: string;
    license?: string;
    keywords?: string[];
  };
}
```

### Version resolution

Match Claude Code order for each installed copy:

1. `version` in `.claude-plugin/plugin.json`
2. `version` in marketplace entry (when marketplace config is discoverable)
3. Git commit SHA for git-sourced installs
4. `unknown` for npm or non-git local dirs without manifest version

### Project plugin state

Persisted per tracked project (refreshed on scan):

```ts
interface ProjectPluginState {
  project_id: string;
  harness: "claude-code";
  scanned_at: string; // ISO timestamp
  committed: PluginEntry[]; // .claude/settings.json only
  effective: PluginEntry[]; // merged user + project + local
}
```

**Effective merge:** Read `~/.claude/settings.json`, then `.claude/settings.json`, then `.claude/settings.local.json`. Later scopes override enable/disable for the same `ref`. Deduplicate effective list by `ref`, keeping winning scope label.

**Settings parsing:** Normalize supported `enabledPlugins` shapes (object map and array forms). If unknown, store entry with `version: unknown` and optional raw payload in debug JSON mode — do not fail scan.

**In-repo plugins:** Discover directories under project root containing `.claude-plugin/plugin.json`. Include in committed when referenced in project settings; use for auto-embed on export.

### Preset plugin reference (Phase C)

Table `preset_plugins`:

| Column | Description |
|--------|-------------|
| `preset_id` | FK to presets |
| `ref` | Plugin ref |
| `version_constraint` | Exact (`2.1.0`) or range (`>=2.1.0 <3.0.0`) |
| `order` | Display/apply order |

**Constraint rules:**

- If the string is a single valid semver without range operators → **exact pin**.
- Otherwise parse as semver **range** (use `semver` npm package).

### Database additions

- `project_plugin_state` — one row per project + harness, JSON columns `committed` / `effective`, `scanned_at`.
- `preset_plugins` — preset ↔ plugin ref + constraint.

No separate global `plugins` catalog table in v1; inventory is derived from filesystem on each scan.

## CLI Surface

Align with [CLI UX design](./2026-04-28-cli-ux-design.md): default human output, `--format json` for structured commands.

### Phase B

| Command | Behavior |
|---------|----------|
| `harnessdeck plugin list [path]` | Committed + effective tables. JSON: `{ scanned_at, committed, effective }`. |
| `harnessdeck plugin show <ref> [path]` | Single plugin detail across scopes. |
| `harnessdeck scan [path]` | Refresh `project_plugin_state`; print plugin counts. |
| `harnessdeck project status [path]` | Plugin subsection under Claude Code. |

### Phase C

| Command | Behavior |
|---------|----------|
| `harnessdeck preset add-plugin <preset> <ref> --version <constraint>` | Add plugin ref to preset. |
| `harnessdeck preset remove-plugin <preset> <ref>` | Remove plugin ref. |
| `harnessdeck preset show <preset>` | Include `plugins` section. |
| `harnessdeck preset export <preset> [--embed-plugins]` | Hybrid bundle (see below). |
| `harnessdeck preset import <file>` | Load refs + materialize embedded trees. |
| `harnessdeck project apply <preset> [path]` | Check effective versions after writing files (warn by default). |
| `harnessdeck project apply ... --strict-plugin-versions` | Fail on version mismatch. |
| `harnessdeck project apply ... --ignore-plugin-versions` | Skip plugin version checks. |

**Apply validation (default: warn):** On mismatch, print a warning listing required vs actual version and suggested `claude plugin update` command; apply still completes for resources/files.

**Strict mode:** `--strict-plugin-versions` fails with exit code `2` on any mismatch (same message as warn).

**Skip validation:** `--ignore-plugin-versions` skips plugin version checks entirely.

### Human output example (`plugin list`)

```
Plugins (claude-code)

Committed (.claude/settings.json)
  formatter@acme-marketplace              2.1.0    enabled
  security-guidance@claude-code-marketplace  1.2.0    enabled

Effective (user + project + local)
  formatter@acme-marketplace              2.1.0    enabled    project
  my-tool@acme-marketplace                abc123f  enabled    user
```

## Bundle format

```json
{
  "$schema": "urn:harnessdeck:bundle:v1",
  "version": 1,
  "preset": {
    "name": "team-setup",
    "description": "",
    "tags": []
  },
  "resources": [],
  "plugins": [
    {
      "ref": "formatter@acme-marketplace",
      "version_constraint": ">=2.1.0 <3.0.0"
    }
  ],
  "embedded_plugins": [
    {
      "ref": "./plugins/custom",
      "version_constraint": "1.0.0",
      "root": "custom",
      "files": {
        ".claude-plugin/plugin.json": "{ ... }",
        "skills/example/SKILL.md": "..."
      }
    }
  ]
}
```

**Hybrid export rules:**

| Source | Default | `--embed-plugins` |
|--------|---------|-------------------|
| Marketplace-installed | `plugins[]` reference only | Optional full embed if flag set |
| In-repo `./plugins/...` | Auto `embedded_plugins[]` | Same |

Importer treats missing `plugins` / `embedded_plugins` as empty arrays. Bundles without `embedded_plugins` entries are reference-only for marketplace refs.

## Implementation Flow

```
scan → read settings (user, project, local)
     → parse enabledPlugins
     → resolve install paths (~/.claude/plugins/cache, in-repo)
     → read plugin.json / compute version
     → build committed + effective
     → upsert project_plugin_state
```

New modules:

- `src/services/claude-plugin-inventory.ts` — parsing, resolution, merge
- `src/models/plugin.ts` — `project_plugin_state`, `preset_plugins`
- `src/services/plugin-bundle.ts` — embed/extract, semver check
- `src/db/schema.ts` — migration

Extend `ClaudeCodeSerializer` only if needed for in-repo path discovery; inventory stays out of atomic resource scan to avoid duplicating plugin skills as loose resources (optional future: `--explode-plugins`).

## Phasing

| Phase | Deliverable |
|-------|-------------|
| B1 | Schema, inventory service, scan/status integration |
| B2 | `plugin list|show`, JSON format, fixture tests |
| C1 | `preset_plugins`, add/remove/show, export references |
| C2 | Hybrid embed, import, apply validation, bundle plugin fields |

## Testing

Fixtures under `test/fixtures/claude-plugins-project/`:

- `.claude/settings.json` with `enabledPlugins`
- `.claude/settings.local.json` override
- Stub `~/.claude` home layout in tests (temp dir)
- Minimal `plugin.json` + cache directory layout
- In-repo `./plugins/demo/.claude-plugin/plugin.json`

Tests:

- Committed vs effective merge precedence
- Version resolution from manifest vs SHA
- Exact vs range constraint satisfaction
- Export embed vs reference
- Apply warns on mismatch by default; fails only with `--strict-plugin-versions`; skips with `--ignore-plugin-versions`

## Error Handling

| Situation | Behavior |
|-----------|----------|
| Missing settings file | Empty list for that scope |
| Invalid JSON in settings | Warn on scan; skip plugin section for that file |
| Plugin enabled but not in cache | Show in inventory with `version: unknown`, `install_path` absent |
| Constraint mismatch on apply (default) | Warning on stderr; apply succeeds |
| Constraint mismatch with `--strict-plugin-versions` | Exit 2, human + JSON error payload |
| Unknown `enabledPlugins` shape | Best-effort parse; never abort full scan |

## Resolved Decisions

- `project apply` defaults to **warn** on plugin version mismatch; use `--strict-plugin-versions` to fail.

## Open Questions (deferred)

- Auto-exploding plugin components into preset resources for non-Claude harness sync (out of scope v1).

## References

- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference) — manifest schema, scopes, version management, CLI
- [Harnessdeck SPEC.md](../../../SPEC.md) — core concepts and command surface
- [CLI UX design](./2026-04-28-cli-ux-design.md) — `--format json` contract
