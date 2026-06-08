# Plugin Lifecycle Design (Inventory, Check, Update)

**Status:** Superseded (2026-06-07). See [unified composition resources design](./2026-06-07-unified-composition-resources-design.md).

> Previously superseded the update/install non-goals in [Claude plugin inventory design](./2026-05-19-claude-plugin-inventory-design.md). Replaced by `hd resource sync` and composition `plugin` resources.

## Problem

Harnessdeck manages agent configuration as resources and presets, but teams also depend on **plugins** (versioned bundles of skills, hooks, MCP servers, etc.) across multiple harnesses. Today there is no unified way to:

1. See what plugins are installed across scopes and platforms.
2. Know which plugins are outdated relative to marketplace or git sources.
3. Update plugins from the CLI, including harnesses without a native update command.

Claude Code already exposes `claude plugin list|update` and marketplace refresh. Cursor and other harnesses use filesystem caches and manifests. Harnessdeck should orchestrate these consistently.

## Goals

- **Inventory:** List installed plugins per harness, including `user`, `project`, `local`, and `managed` scopes where applicable.
- **Check:** Report outdated plugins using a refresh policy (local by default, auto-refresh stale cache, `--refresh` override).
- **Update:** Update plugins per harness — native CLI when available, git/filesystem best-effort otherwise.
- **Coverage:** Every registered harness with a discoverable plugin model gets a provider; others are reported as `unsupported` without failing the whole command.
- **Automation:** `--format human|json` per [CLI UX design](./2026-04-28-cli-ux-design.md); script-friendly flags (`--yes`, `--platform`, `--scope`).

## Non-Goals (v1)

- `plugin install` / `uninstall` / `tag` (use native Claude CLI or IDE for install).
- Harnessdeck-hosted plugin marketplace or registry.
- Token cost estimates (`claude plugin details` parity).
- Auto-exploding plugin components into atomic preset resources.

## Decisions (from design review)

| Topic | Decision |
|-------|----------|
| Platform coverage | All harnesses with discoverable plugin layout; skip others |
| Scopes | `user`, `project`, `local`, `managed` (managed = update-only) |
| Non-native update | Best-effort git/filesystem refresh from `repository` or marketplace source |
| Refresh policy | Local compare by default; `--refresh` forces pull; auto-refresh sources older than `refreshMaxAgeHours` (default 24) |
| Settings | `~/.harnessdeck/config.json` for `plugins.refreshMaxAgeHours` |

## Architecture

### Plugin provider registry

Each harness with a stable on-disk contract registers a `PluginProvider`:

```ts
type PluginUpdateMethod = "native-cli" | "git" | "unsupported";

interface PluginProvider {
  readonly platformId: string;
  readonly capabilities: {
    inventory: boolean;
    check: boolean;
    update: boolean;
    updateMethod: PluginUpdateMethod;
  };
  list(ctx: PluginContext): Promise<PluginInstall[]>;
  check(ctx: PluginContext, opts: PluginCheckOptions): Promise<PluginCheckResult[]>;
  update(ctx: PluginContext, opts: PluginUpdateOptions): Promise<PluginUpdateResult[]>;
}
```

`PluginContext` carries `projectRoot`, optional `homeRoot` override (tests), and resolved config.

Registry in `src/plugins/registry.ts` maps `platformId → provider | null`. Commands iterate configured or detected platforms.

### v1 providers

| Platform | Discovery | Check | Update |
|----------|-----------|-------|--------|
| `claude-code` | `installed_plugins.json`, `.claude/settings.json` (+ local), cache paths | Compare installed version/SHA to marketplace after refresh | `claude plugin marketplace update`, `claude plugin update` |
| `cursor` | `~/.cursor/plugins/cache/{marketplace}/{name}/{hash}/`, project plugin paths | Compare `plugin.json` version / cache hash to refreshed git ref | Git fetch/checkout into cache layout |
| *future* | Per harness contract | Same pattern | Native or git |

Platforms without a provider return no rows and appear in summary `unsupported_platforms[]`.

### Shared types

```ts
type PluginScope = "user" | "project" | "local" | "managed";

interface PluginInstall {
  ref: string;           // e.g. formatter@acme-marketplace or ./plugins/foo
  platformId: string;
  name: string;
  version: string;
  versionSource: "manifest" | "marketplace" | "git_sha" | "unknown";
  scope: PluginScope;
  enabled: boolean;
  installPath?: string;
  metadata?: { description?: string; repository?: string; homepage?: string };
}

interface PluginCheckResult extends PluginInstall {
  status: "current" | "outdated" | "unknown";
  latestVersion?: string;
  latestSource?: string;
  refreshSkipped?: boolean;
  message?: string;
}

interface PluginUpdateResult {
  ref: string;
  platformId: string;
  scope: PluginScope;
  status: "updated" | "skipped" | "failed" | "unsupported";
  previousVersion?: string;
  newVersion?: string;
  message: string;
}
```

### Settings and refresh cache

**`~/.harnessdeck/config.json`**

```json
{
  "plugins": {
    "refreshMaxAgeHours": 24
  }
}
```

Defaults apply when file is missing. Validate `refreshMaxAgeHours` is a positive number.

**`~/.harnessdeck/plugin-refresh-cache.json`**

```json
{
  "sources": {
    "claude:marketplace:teads-plugins": { "lastRefreshedAt": "2026-05-19T10:00:00.000Z" },
    "cursor:repo:https://github.com/cursor/plugins": { "lastRefreshedAt": "2026-05-18T08:00:00.000Z" }
  }
}
```

**Refresh policy for `plugin check` and `plugin update` (before version compare):**

1. If `--refresh` → refresh all sources referenced by installed plugins.
2. Else for each source: if `now - lastRefreshedAt > refreshMaxAgeHours` → refresh that source.
3. Else use local marketplace/cache state only.

`plugin refresh` always runs step 1 for all known sources (optional `--platform` filter).

**Claude refresh:** `claude plugin marketplace update [name]` (all if omitted).

**Git refresh:** `git fetch` + resolve target ref (marketplace `sha` / `ref` / semver tag) into provider-specific cache directory.

### Scopes

| Scope | Claude | Cursor (v1) |
|-------|--------|----------------|
| `user` | `~/.claude/settings.json`, user cache | `~/.cursor/plugins/cache/` |
| `project` | `.claude/settings.json` | Project-level plugin config when present |
| `local` | `.claude/settings.local.json` | N/A unless discovered |
| `managed` | Managed settings file | Team/managed distribution when detectable |

**Managed:** `update` allowed; `install`/`disable` rejected with clear error.

### Inventory (from inventory spec — unchanged intent)

Persist per tracked project for Claude (extend later for Cursor):

- `project_plugin_state`: `committed` vs `effective` plugin lists, refreshed on `project scan`.
- Preset plugin pins: `preset_plugins` table, bundle plugin fields, apply validation.

Inventory service remains separate from update execution but shares `PluginInstall` parsing helpers.

## CLI Surface

| Command | Behavior |
|---------|----------|
| `plugin list [path]` | All installs across platforms/scopes. `--platform` filter. JSON: `{ installs: PluginInstall[] }`. |
| `plugin show <ref> [path]` | Detail for one ref across scopes. |
| `plugin check [path]` | Outdated report; applies refresh policy. `--platform`, `--scope`, `--format json`. Exit `1` if any outdated (for CI). |
| `plugin update [ref]` | Update one ref, or all outdated with `--all`. `--platform`, `--scope`, `--yes` (non-interactive), `--continue` on partial failure. |
| `plugin refresh` | Force metadata refresh. `--platform`. |

Flags shared with CLI UX spec: `--format human|json`.

**Human `check` example:**

```
Plugin status (3 outdated, 7 current, 2 platforms skipped)

claude-code
  superpowers@claude-plugins-official   5.1.0 → 5.2.0   user     outdated
  devx@teads-plugins                    0.3.1           user     current

cursor
  superpowers@cursor-public             5.0.7 → 5.0.8   user     outdated
```

**JSON `check` excerpt:**

```json
{
  "refreshed_sources": ["claude:marketplace:claude-plugins-official"],
  "results": [
    {
      "ref": "superpowers@claude-plugins-official",
      "platformId": "claude-code",
      "status": "outdated",
      "version": "5.1.0",
      "latestVersion": "5.2.0",
      "scope": "user"
    }
  ],
  "summary": { "outdated": 3, "current": 7, "unknown": 0 },
  "unsupported_platforms": ["warp", "codex"]
}
```

### Integration

- `project scan` — refresh `project_plugin_state` (Claude); print plugin counts.
- `project status` — plugin subsection per platform with outdated count.
- `project apply` — validate preset plugin constraints (from inventory spec); **warn** on mismatch by default; `--strict-plugin-versions` to fail; suggest `harnessdeck plugin update`.

## Error Handling

| Situation | Behavior |
|-----------|----------|
| Platform unsupported | Skip; list in `unsupported_platforms` |
| `claude` CLI missing | Claude provider check/update fails with install hint |
| Git refresh fails | `failed` row; continue with `--continue` |
| No `repository` / source for Cursor plugin | `unsupported` update method; message to use IDE |
| Managed scope install attempt | Error, exit non-zero |
| Stale cache, offline | Check uses local state; `refreshSkipped: true` in JSON |

## Phasing

| Phase | Deliverable |
|-------|-------------|
| **1** | Config + refresh cache, provider registry, Claude check/update, CLI commands |
| **2** | Cursor FS provider (list/check/update git best-effort) |
| **3** | Inventory DB + scan/status + preset pins (inventory spec B/C) |
| **4** | Additional harness providers |

## Testing

Fixtures:

- `test/fixtures/claude-plugins-project/` — settings, cache, marketplace stub
- `test/fixtures/cursor-plugins-home/` — cache layout with `plugin.json`
- Temp home roots in tests; never touch real `~/.claude` / `~/.cursor`

Tests:

- Refresh policy: no network when fresh cache; auto-refresh when timestamp &gt; max age
- `--refresh` forces refresh
- Claude provider mocks `claude` CLI stdout
- Cursor provider mocks git operations
- `plugin check` exit code 1 when outdated
- `plugin update --all --yes` batch behavior
- JSON schema stability

## References

- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [Cursor plugins reference](https://cursor.com/docs/reference/plugins)
- [CLI UX design](./2026-04-28-cli-ux-design.md)
- [Claude plugin inventory design](./2026-05-19-claude-plugin-inventory-design.md) (preset pins, bundle export)
