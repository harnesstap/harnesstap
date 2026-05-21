# Claude Plugin Inventory and Preset Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement committed vs effective Claude plugin inventory on scan/status, preset plugin pins with exact/semver constraints, hybrid bundle export, and apply-time validation (warn by default, `--strict-plugin-versions` to fail).

**Architecture:** Reuse `src/plugins/types.ts`, `ClaudeCodePluginProvider`, and `ClaudePresetConfig`. Add `claude-plugin-inventory.ts` for settings merge + `project_plugin_state` persistence. Extend preset model with `preset_plugins` table and bundle plugin fields. Wire CLI `plugin list|show` for project inventory.

**Tech Stack:** TypeScript, Commander, better-sqlite3, `semver` package, Vitest, Bun

**Spec:** [docs/superpowers/specs/2026-05-19-claude-plugin-inventory-design.md](../specs/2026-05-19-claude-plugin-inventory-design.md) (approved)

**Shipped with:** [plugin check and update plan](./2026-05-19-plugin-check-update.md) and Claude marketplace preset config in [PR #6](https://github.com/bqbooster/harnessdeck/pull/6). Lifecycle commands (`plugin installed|check|update|refresh`) live in the sibling plan but landed in the same PR.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/plugins/types.ts` | Add `ProjectPluginInventory`, `PluginVersionConstraint` helpers |
| `src/services/claude-plugin-inventory.ts` | Parse settings scopes, merge effective, resolve versions |
| `src/models/plugin.ts` | `project_plugin_state`, `preset_plugins` CRUD |
| `src/services/plugin-constraints.ts` | Parse exact vs range; `satisfies(constraint, version)` |
| `src/services/plugin-bundle.ts` | Embed trees; bundle import/export |
| `src/db/schema.ts` | Migration 4: `project_plugin_state`, `preset_plugins` |
| `src/types.ts` | Extend `ExportBundle` with plugin pins + embedded trees |
| `src/services/exporter.ts` | Bundle export/import, `--embed-plugins` |
| `src/services/applier.ts` | Post-apply constraint validation |
| `src/index.ts` | `plugin list|show`, preset plugin commands, apply flags |
| `test/fixtures/claude-plugins-project/` | Settings + cache + in-repo plugin |
| `test/services/claude-plugin-inventory.test.ts` | Inventory merge tests |
| `test/models/plugin.test.ts` | DB round-trip |
| `test/services/plugin-constraints.test.ts` | Semver tests |
| `test/cli/plugin-inventory.test.ts` | CLI committed/effective |
| `test/cli/preset-plugin.test.ts` | add-plugin, export/import, apply warn/strict |

---

## Task 1: Semver constraint helper

**Files:**
- Create: `src/services/plugin-constraints.ts`
- Create: `test/services/plugin-constraints.test.ts`
- Modify: `package.json` (add `semver` dependency)

- [ ] **Step 1: Add dependency**

Run: `bun add semver` and `bun add -d @types/semver`

- [ ] **Step 2: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  parseVersionConstraint,
  satisfiesConstraint,
} from "../../src/services/plugin-constraints.ts";

describe("plugin-constraints", () => {
  it("treats plain semver as exact pin", () => {
    expect(parseVersionConstraint("2.1.0").kind).toBe("exact");
    expect(satisfiesConstraint("2.1.0", "2.1.0")).toBe(true);
    expect(satisfiesConstraint("2.1.0", "2.1.1")).toBe(false);
  });

  it("evaluates semver ranges", () => {
    const range = ">=2.1.0 <3.0.0";
    expect(parseVersionConstraint(range).kind).toBe("range");
    expect(satisfiesConstraint(range, "2.5.0")).toBe(true);
    expect(satisfiesConstraint(range, "3.0.0")).toBe(false);
  });

  it("returns false for unknown installed version", () => {
    expect(satisfiesConstraint("2.0.0", "unknown")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `bun run test:run test/services/plugin-constraints.test.ts`

- [ ] **Step 4: Implement**

```ts
import semver from "semver";

export type VersionConstraint =
  | { kind: "exact"; version: string }
  | { kind: "range"; range: string };

export function parseVersionConstraint(raw: string): VersionConstraint {
  const trimmed = raw.trim();
  if (semver.valid(trimmed)) {
    return { kind: "exact", version: trimmed };
  }
  if (semver.validRange(trimmed)) {
    return { kind: "range", range: trimmed };
  }
  throw new Error(`Invalid version constraint: ${raw}`);
}

export function satisfiesConstraint(constraint: string, installed: string): boolean {
  if (installed === "unknown") return false;
  const parsed = parseVersionConstraint(constraint);
  if (parsed.kind === "exact") {
    return semver.eq(installed, parsed.version);
  }
  return semver.satisfies(installed, parsed.range, { includePrerelease: true });
}
```

- [ ] **Step 5: Run test — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/services/plugin-constraints.ts test/services/plugin-constraints.test.ts
git commit -m "feat: add semver constraint helper for plugin pins"
```

---

## Task 2: Claude plugin inventory service

**Files:**
- Create: `src/services/claude-plugin-inventory.ts`
- Create: `test/fixtures/claude-plugins-project/.claude/settings.json`
- Create: `test/fixtures/claude-plugins-project/.claude/settings.local.json`
- Create: `test/fixtures/claude-plugins-project/plugins/demo/.claude-plugin/plugin.json`
- Create: `test/services/claude-plugin-inventory.test.ts`

- [ ] **Step 1: Write fixture settings**

`settings.json`:

```json
{
  "enabledPlugins": {
    "formatter@acme-marketplace": true,
    "security@claude-code-marketplace": true
  }
}
```

`settings.local.json`:

```json
{
  "enabledPlugins": {
    "formatter@acme-marketplace": false
  }
}
```

`plugins/demo/.claude-plugin/plugin.json`:

```json
{ "name": "demo", "version": "1.0.0", "description": "In-repo demo" }
```

- [ ] **Step 2: Write failing inventory test**

```ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanClaudePluginInventory } from "../../src/services/claude-plugin-inventory.ts";

describe("claude-plugin-inventory", () => {
  const projectRoot = join(import.meta.dirname, "../fixtures/claude-plugins-project");
  const homeRoot = join(import.meta.dirname, "../fixtures/claude-plugins-home");

  it("builds committed from project settings only", async () => {
    const inv = await scanClaudePluginInventory({ projectRoot, homeRoot });
    const committedRefs = inv.committed.map((p) => p.ref);
    expect(committedRefs).toContain("formatter@acme-marketplace");
    expect(committedRefs).not.toContain("user-only@demo");
  });

  it("merges effective with local overriding project enablement", async () => {
    const inv = await scanClaudePluginInventory({ projectRoot, homeRoot });
    const formatter = inv.effective.find((p) => p.ref === "formatter@acme-marketplace");
    expect(formatter?.enabled).toBe(false);
    expect(formatter?.scope).toBe("local");
  });
});
```

Add minimal `test/fixtures/claude-plugins-home/.claude/settings.json` with `user-only@demo` enabled and stub `installed_plugins.json` mapping refs to install paths (copy pattern from plugin-check-update plan fixtures).

- [ ] **Step 3: Run test — expect FAIL**

- [ ] **Step 4: Implement `scanClaudePluginInventory`**

Responsibilities:

1. Read `enabledPlugins` from user/project/local settings paths (normalize object map; support array of strings as enabled-only).
2. For each ref, resolve install path via `~/.claude/plugins/installed_plugins.json` + cache (reuse parsing helpers from `src/plugins/providers/claude-code.ts` — extract shared `readInstalledPlugins(homeRoot)` to `src/plugins/claude-installed.ts` to avoid duplication).
3. `readManifestVersion(installPath)` for version/metadata.
4. `committed` = entries from project `settings.json` only.
5. `effective` = merge by ref with precedence local > project > user; attach winning `scope`.
6. Discover in-repo plugins under `{projectRoot}/plugins/**/.claude-plugin/plugin.json` and include when referenced.

Export type:

```ts
export interface ProjectPluginInventory {
  scanned_at: string;
  committed: PluginInstall[];
  effective: PluginInstall[];
}
```

- [ ] **Step 5: Run test — expect PASS**

- [ ] **Step 6: Commit**

---

## Task 3: Database migration and models

**Files:**
- Modify: `src/db/schema.ts` (SCHEMA_VERSION = 4)
- Create: `src/models/plugin.ts`
- Create: `test/models/plugin.test.ts`
- Modify: `test/db/schema.test.ts`

- [ ] **Step 1: Write failing schema test**

```ts
it("migration 4 creates project_plugin_state and preset_plugins", () => {
  const db = openTestDb();
  initializeSchema(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: { name: string }) => r.name);
  expect(tables).toContain("project_plugin_state");
  expect(tables).toContain("preset_plugins");
});
```

- [ ] **Step 2: Add migration 4**

```sql
CREATE TABLE IF NOT EXISTS project_plugin_state (
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  harness      TEXT NOT NULL DEFAULT 'claude-code',
  scanned_at   TEXT NOT NULL,
  committed    TEXT NOT NULL DEFAULT '[]',
  effective    TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (project_id, harness)
);

CREATE TABLE IF NOT EXISTS preset_plugins (
  preset_id            TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  ref                  TEXT NOT NULL,
  version_constraint   TEXT NOT NULL,
  "order"              INTEGER NOT NULL DEFAULT 0,
  embed_on_export      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (preset_id, ref)
);
```

- [ ] **Step 3: Implement model helpers**

```ts
export function upsertProjectPluginState(
  projectId: string,
  inventory: ProjectPluginInventory,
): void;

export function getProjectPluginState(
  projectId: string,
  harness?: string,
): ProjectPluginInventory | null;

export function addPluginToPreset(
  presetId: string,
  ref: string,
  versionConstraint: string,
  opts?: { embedOnExport?: boolean; order?: number },
): void;

export function listPresetPlugins(presetId: string): PresetPluginRow[];
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Task 4: Wire scan and project status

**Files:**
- Modify: `src/services/scanner.ts`
- Modify: `src/index.ts` (scan + status handlers)
- Create: `test/cli/plugin-inventory.test.ts`

- [ ] **Step 1: After project upsert in scanner, call inventory + upsertProjectPluginState**

Only when `claude-code` is among detected harnesses.

- [ ] **Step 2: Write CLI test**

```ts
it("scan reports committed and effective plugin counts", async () => {
  const ctx = await createTestContext("scan-plugins");
  // copy claude-plugins-project fixture into temp dir with git init if needed
  const result = await runCli(["scan", ctx.projectDir]);
  expect(result.stdout).toMatch(/plugins:.*committed.*effective/i);
});
```

- [ ] **Step 3: Extend `project status` human + JSON output with `plugins` block**

```json
{
  "claude_code": {
    "plugins": {
      "scanned_at": "...",
      "committed_count": 2,
      "effective_count": 3
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Task 5: CLI `plugin list` and `plugin show` (inventory view)

**Files:**
- Modify: `src/index.ts`
- Modify: `src/utils/output-format.ts` (reuse if present)
- Modify: `test/cli/plugin-inventory.test.ts`

- [ ] **Step 1: Add commands**

When `[path]` is provided (default `.`):

- Load inventory from DB if fresh; else run `scanClaudePluginInventory` and persist.
- Human: two tables (Committed / Effective) per spec.
- JSON: `{ scanned_at, committed, effective }`.

`plugin show <ref> [path]`:

- Filter effective entries matching ref; print per-scope rows + manifest metadata.

When no path and lifecycle service exists: fall through to provider `list()` (installed_plugins.json). If lifecycle CLI not merged yet, document-only stub or call `ClaudeCodePluginProvider.list` directly.

- [ ] **Step 2: CLI tests for `--format json`**

- [ ] **Step 3: Commit**

---

## Task 6: Preset plugin commands (phase C1)

**Files:**
- Modify: `src/index.ts`
- Modify: `src/models/preset.ts`
- Create: `test/cli/preset-plugin.test.ts`

- [ ] **Step 1: `preset add-plugin <preset> <ref> --version <constraint>`**

Validate constraint via `parseVersionConstraint`. Insert `preset_plugins` row. Optionally sync `preset.claude.plugins[]` for backward-compatible apply of `enabledPlugins` (map `ref` → `id`, `version_constraint` → document only in claude json).

- [ ] **Step 2: `preset remove-plugin <preset> <ref>`**

- [ ] **Step 3: Extend `preset show` to list plugin refs + constraints**

- [ ] **Step 4: Tests for add/remove/show**

- [ ] **Step 5: Commit**

---

## Task 7: Bundle plugin pins and hybrid export (phase C2)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/exporter.ts`
- Create: `src/services/plugin-bundle.ts`
- Modify: `test/cli/export-import.test.ts`

- [ ] **Step 1: Extend bundle type**

```ts
export const BUNDLE_SCHEMA = "urn:harnessdeck:bundle:v1";
export const BUNDLE_VERSION = 1;
// ExportBundle.plugins + ExportBundle.embedded_plugins
```

- [ ] **Step 2: Write failing export test**

Preset with marketplace plugin ref + in-repo `./plugins/demo`; export without flag embeds only in-repo; with `--embed-plugins` embeds all.

- [ ] **Step 3: Implement `collectEmbeddedPlugin(ref, projectRoot)`**

Walk plugin root; build `files: Record<relativePath, string>`.

- [ ] **Step 4: Extend `exportPreset` / `importFromFile`**

- Export always includes `plugins[]` and `embedded_plugins[]`
- Import: insert `preset_plugins`; write embedded files to `plugins/<root>/`

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

---

## Task 8: Apply validation (warn / strict / ignore)

**Files:**
- Modify: `src/services/applier.ts`
- Modify: `src/index.ts` (`project apply` options)
- Modify: `test/cli/apply.test.ts`

- [ ] **Step 1: Write failing apply test**

Preset with `formatter@acme` constraint `2.1.0`; effective version `1.9.0`:

- Default apply: exit 0, stderr contains `warning` and `plugin update`
- `--strict-plugin-versions`: exit 2
- `--ignore-plugin-versions`: no plugin warning

- [ ] **Step 2: Implement `validatePresetPluginConstraints`**

```ts
export interface PluginValidationIssue {
  ref: string;
  constraint: string;
  installed: string;
  message: string;
}

export function validatePresetPluginConstraints(
  presetId: string,
  inventory: ProjectPluginInventory,
): PluginValidationIssue[];
```

Call after files written. Log warnings to stderr; strict mode sets `process.exitCode = 2`.

- [ ] **Step 3: Add Commander flags to `project apply`**

`--strict-plugin-versions`, `--ignore-plugin-versions`

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

---

## Task 9: Documentation

**Files:**
- Modify: `SPEC.md`
- Modify: `README.md`

- [ ] **Step 1: Document `plugin list|show`, preset plugin commands, apply flags, bundle plugin fields**

- [ ] **Step 2: Cross-link lifecycle plan for `plugin check|update`**

- [ ] **Step 3: Run preflight**

Run: `bun run preflight`

- [ ] **Step 4: Commit**

---

## Plan self-review (spec coverage)

| Spec requirement | Task |
|------------------|------|
| Committed vs effective inventory | Task 2, 4, 5 |
| Version resolution order | Task 2 (reuse claude provider helpers) |
| `project_plugin_state` table | Task 3 |
| `plugin list\|show` + JSON | Task 5 |
| scan/status integration | Task 4 |
| Exact + semver constraints | Task 1 |
| `preset_plugins` + CLI | Task 6 |
| Hybrid export + bundle plugin fields | Task 7 |
| Apply warn default | Task 8 |
| `--strict-plugin-versions` | Task 8 |
| `--ignore-plugin-versions` | Task 8 |
| Claude Code only v1 | Tasks scoped to claude-code paths |
| Non-goals (install/tag) | Out of scope |

| Spec requirement | Notes |
|------------------|-------|
| `--embed-plugins` on export | Task 7 |

No TBD placeholders in task steps.

---

## Execution order

1. Tasks 1–3 (foundation)
2. Tasks 4–5 (B — inventory visible)
3. Tasks 6–8 (C — presets + validation)
4. Task 9 (docs)

Lifecycle CLI was implemented alongside this plan; see [plugin-check-update](./2026-05-19-plugin-check-update.md).
