# Preset Composition and Version Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class preset composition with versioned presets, local sbt-style highest-compatible dependency resolution, deterministic conflict handling, and bundle/apply support while keeping bundle schema version `1`.

**Architecture:** Extend the preset data model from a flat resource container into a versioned preset graph. Resolve root preset selectors into a transitive closure using local semver constraints, choose one winning preset version per logical name, linearize the graph, then merge contributions with typed conflict rules instead of silent last-wins everywhere. Keep bundle schema version `1` because the format is still unreleased, but extend the bundle payload to carry preset version and dependencies.

**Tech Stack:** TypeScript, Commander, better-sqlite3, Bun, Vitest, `semver`

**Decision:** Keep `BUNDLE_VERSION = 1` and `urn:harnessdeck:bundle:v1`; extend the payload in place before first release.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/db/schema.ts` | Migration 5: versioned presets and `preset_dependencies` table; preserve existing preset/resource/plugin data during migration |
| `src/types.ts` | Add `Preset.version`, `PresetDependency`, resolver result types, and bundle fields for preset version + dependencies |
| `src/models/preset.ts` | Version-aware preset CRUD, selector parsing, latest-version lookup, dependency CRUD |
| `src/services/preset-resolver.ts` | New resolver: constraint accumulation, highest-compatible local selection, cycle detection, topological ordering |
| `src/services/preset-merge.ts` | Merge resolved preset graphs with typed conflict policies and deterministic override behavior |
| `src/services/preset-validate.ts` | Resolve and validate composed presets; report missing deps, cycles, invalid constraints, and merge conflicts |
| `src/services/exporter.ts` | Export/import preset version and dependencies while keeping bundle version `1` |
| `src/services/preset-diff.ts` | Include version/dependency metadata in preset diffs and bundle diffs |
| `src/index.ts` | CLI support for versioned preset selectors, dependency commands, resolver-backed apply/export/validate/show/list |
| `test/db/schema.test.ts` | Schema version 5 and table/column assertions |
| `test/models/preset.test.ts` | Versioned preset CRUD, latest lookup, dependency CRUD |
| `test/services/preset-resolver.test.ts` | Resolver semantics: highest-compatible local version, cycles, missing versions, virtual roots |
| `test/services/preset-merge.test.ts` | Conflict policy coverage across resources, plugin pins, and Claude config |
| `test/services/exporter.test.ts` | Bundle v1 round-trip with preset version + dependencies |
| `test/cli/preset.test.ts` | CLI create/show/list/add-dependency/remove-dependency for versioned presets |
| `test/cli/apply.test.ts` | Resolver-backed apply, composed preset output, conflict failure behavior |
| `test/cli/export-import.test.ts` | CLI export/import keeps bundle v1 and preserves dependency metadata |
| `README.md` | Document versioned presets, dependency commands, and apply selectors |
| `docs/scenarios/details/25-stack-presets.md` | Update scenario to show first-class composed presets instead of only ad-hoc stacking |

---

### Task 1: Add versioned preset storage and migration 5

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/types.ts`
- Modify: `test/db/schema.test.ts`

- [ ] **Step 1: Extend schema tests for versioned presets**

```ts
it("migration 5 adds preset versioning and dependency storage", async () => {
  const context = await createTestContext("schema-migration-5");

  try {
    context.schema.initializeSchema(context.connection.getDb());

    const tables = context.connection
      .getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const columns = context.connection
      .getDb()
      .prepare("PRAGMA table_info(presets)")
      .all() as Array<{ name: string }>;
    const versionRow = context.connection
      .getDb()
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number };

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(["preset_dependencies", "presets"]),
    );
    expect(columns.map((column) => column.name)).toContain("version");
    expect(versionRow.version).toBe(5);
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run schema test and verify it fails**

Run: `bun run test:run test/db/schema.test.ts`

Expected: FAIL because `preset_dependencies` does not exist and `schema_version` is still `4`.

- [ ] **Step 3: Implement migration 5 and extend shared types**

`src/db/schema.ts`:

```ts
const SCHEMA_VERSION = 5;

const MIGRATIONS: Record<number, string> = {
  5: `
    ALTER TABLE presets RENAME TO presets_legacy;
    ALTER TABLE preset_resources RENAME TO preset_resources_legacy;
    ALTER TABLE preset_plugins RENAME TO preset_plugins_legacy;
    ALTER TABLE project_presets RENAME TO project_presets_legacy;

    CREATE TABLE presets (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      version       TEXT NOT NULL DEFAULT '1.0.0',
      description   TEXT NOT NULL DEFAULT '',
      tags          TEXT NOT NULL DEFAULT '[]',
      claude_config TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE (name, version)
    );

    INSERT INTO presets (id, name, version, description, tags, claude_config, created_at, updated_at)
    SELECT id, name, '1.0.0', description, tags, COALESCE(claude_config, '{}'), created_at, updated_at
    FROM presets_legacy;

    CREATE TABLE preset_resources (
      preset_id   TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      "order"     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (preset_id, resource_id)
    );

    INSERT INTO preset_resources (preset_id, resource_id, "order")
    SELECT preset_id, resource_id, "order" FROM preset_resources_legacy;

    CREATE TABLE preset_plugins (
      preset_id          TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      ref                TEXT NOT NULL,
      version_constraint TEXT NOT NULL,
      "order"            INTEGER NOT NULL DEFAULT 0,
      embed_on_export    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (preset_id, ref)
    );

    INSERT INTO preset_plugins (preset_id, ref, version_constraint, "order", embed_on_export)
    SELECT preset_id, ref, version_constraint, "order", embed_on_export
    FROM preset_plugins_legacy;

    CREATE TABLE project_presets (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      preset_id  TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      platforms  TEXT NOT NULL DEFAULT '[]',
      applied_at TEXT NOT NULL,
      PRIMARY KEY (project_id, preset_id)
    );

    INSERT INTO project_presets (project_id, preset_id, platforms, applied_at)
    SELECT project_id, preset_id, platforms, applied_at FROM project_presets_legacy;

    CREATE TABLE preset_dependencies (
      preset_id          TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
      dependency_name    TEXT NOT NULL,
      version_constraint TEXT NOT NULL DEFAULT '*',
      "order"            INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (preset_id, dependency_name)
    );

    CREATE INDEX idx_preset_dependencies_preset
      ON preset_dependencies(preset_id, "order");
    CREATE INDEX idx_presets_name_version
      ON presets(name, version);

    DROP TABLE project_presets_legacy;
    DROP TABLE preset_plugins_legacy;
    DROP TABLE preset_resources_legacy;
    DROP TABLE presets_legacy;
  `,
};
```

`src/types.ts`:

```ts
export interface Preset {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  claude?: ClaudePresetConfig;
  created_at: string;
  updated_at: string;
}

export interface PresetDependency {
  preset_id: string;
  dependency_name: string;
  version_constraint: string;
  order: number;
}

export interface ExportBundlePreset {
  name: string;
  version: string;
  description: string;
  tags: string[];
  claude?: ClaudePresetConfig;
  dependencies?: Array<{
    name: string;
    version_constraint: string;
  }>;
}

export interface ExportBundle {
  $schema: typeof BUNDLE_SCHEMA;
  version: typeof BUNDLE_VERSION;
  preset: ExportBundlePreset;
  resources: Omit<Resource, "id" | "created_at" | "updated_at" | "source">[];
  claude?: ClaudePresetConfig;
  plugins: ExportBundlePresetPluginPin[];
  embedded_plugins: ExportBundleEmbeddedPlugin[];
}
```

- [ ] **Step 4: Re-run schema test and verify it passes**

Run: `bun run test:run test/db/schema.test.ts`

Expected: PASS with all schema assertions green.

- [ ] **Step 5: Commit the migration groundwork**

```bash
git add src/db/schema.ts src/types.ts test/db/schema.test.ts
git commit -m "feat: add versioned preset schema"
```

---

### Task 2: Make preset model APIs version-aware and add dependency CRUD

**Files:**
- Modify: `src/models/preset.ts`
- Modify: `test/models/preset.test.ts`

- [ ] **Step 1: Add failing model tests for versioned presets and dependencies**

```ts
it("stores multiple versions for the same preset name and resolves latest by default", async () => {
  const context = await createInitializedTestContext("preset-versions");

  try {
    const presetModel = await import("../../src/models/preset.ts");

    const v1 = presetModel.createPreset({ name: "team-stack", version: "1.0.0" });
    const v2 = presetModel.createPreset({ name: "team-stack", version: "1.2.0" });

    expect(presetModel.getPreset("team-stack@1.0.0")?.id).toBe(v1.id);
    expect(presetModel.getPreset("team-stack")?.id).toBe(v2.id);
    expect(
      presetModel.listPresets().map((preset) => `${preset.name}@${preset.version}`),
    ).toEqual(["team-stack@1.0.0", "team-stack@1.2.0"]);
  } finally {
    await context.cleanup();
  }
});

it("adds and lists preset dependencies in insertion order", async () => {
  const context = await createInitializedTestContext("preset-dependencies");

  try {
    const presetModel = await import("../../src/models/preset.ts");

    const app = presetModel.createPreset({ name: "app", version: "1.0.0" });
    presetModel.addDependencyToPreset(app.id, "baseline", "^1.0.0");
    presetModel.addDependencyToPreset(app.id, "reviewers", "~2.1.0");

    expect(presetModel.listPresetDependencies(app.id)).toEqual([
      expect.objectContaining({
        preset_id: app.id,
        dependency_name: "baseline",
        version_constraint: "^1.0.0",
        order: 0,
      }),
      expect.objectContaining({
        preset_id: app.id,
        dependency_name: "reviewers",
        version_constraint: "~2.1.0",
        order: 1,
      }),
    ]);
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run model tests and verify they fail**

Run: `bun run test:run test/models/preset.test.ts`

Expected: FAIL because `Preset.version`, selector parsing, and dependency CRUD do not exist.

- [ ] **Step 3: Implement selector parsing, latest-version lookup, and dependency CRUD**

```ts
interface PresetRow {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string;
  claude_config: string;
  created_at: string;
  updated_at: string;
}

interface PresetDependencyRow {
  preset_id: string;
  dependency_name: string;
  version_constraint: string;
  order: number;
}

export function parsePresetSelector(input: string): {
  id?: string;
  name?: string;
  versionConstraint?: string;
} {
  if (input.startsWith("01") && input.length >= 26) {
    return { id: input };
  }

  const at = input.lastIndexOf("@");
  if (at <= 0) {
    return { name: input };
  }

  return {
    name: input.slice(0, at),
    versionConstraint: input.slice(at + 1),
  };
}

export function createPreset(input: {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
  claude?: ClaudePresetConfig;
}): Preset {
  const version = input.version ?? "1.0.0";
  parseVersionConstraint(version);
  const now = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO presets (id, name, version, description, tags, claude_config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    version,
    input.description ?? "",
    JSON.stringify(input.tags ?? []),
    serializeClaudeConfig(input.claude),
    now,
    now,
  );

  return {
    id,
    name: input.name,
    version,
    description: input.description ?? "",
    tags: input.tags ?? [],
    ...(input.claude ? { claude: input.claude } : {}),
    created_at: now,
    updated_at: now,
  };
}

export function getPreset(selector: string): Preset | undefined {
  const parsed = parsePresetSelector(selector);
  if (parsed.id) {
    const row = db.prepare("SELECT * FROM presets WHERE id = ?").get(parsed.id);
    return row ? rowToPreset(row as PresetRow) : undefined;
  }
  if (!parsed.name) return undefined;

  const rows = db
    .prepare("SELECT * FROM presets WHERE name = ? ORDER BY version DESC")
    .all(parsed.name) as PresetRow[];
  if (parsed.versionConstraint) {
    return rows
      .filter((row) => satisfiesConstraint(parsed.versionConstraint as string, row.version))
      .sort((left, right) => semver.rcompare(left.version, right.version))
      .map(rowToPreset)[0];
  }

  return rows
    .sort((left, right) => semver.rcompare(left.version, right.version))
    .map(rowToPreset)[0];
}

export function addDependencyToPreset(
  presetId: string,
  dependencyName: string,
  versionConstraint: string,
): void {
  parseVersionConstraint(versionConstraint);
  const maxOrder = db
    .prepare(
      'SELECT COALESCE(MAX("order"), -1) as max_order FROM preset_dependencies WHERE preset_id = ?',
    )
    .get(presetId) as { max_order: number };

  db.prepare(
    'INSERT OR REPLACE INTO preset_dependencies (preset_id, dependency_name, version_constraint, "order") VALUES (?, ?, ?, ?)',
  ).run(presetId, dependencyName, versionConstraint, maxOrder.max_order + 1);
}

export function listPresetDependencies(presetId: string): PresetDependency[] {
  const rows = db
    .prepare(
      'SELECT preset_id, dependency_name, version_constraint, "order" FROM preset_dependencies WHERE preset_id = ? ORDER BY "order"',
    )
    .all(presetId) as PresetDependencyRow[];

  return rows.map((row) => ({
    preset_id: row.preset_id,
    dependency_name: row.dependency_name,
    version_constraint: row.version_constraint,
    order: row.order,
  }));
}

export function removeDependencyFromPreset(presetId: string, dependencyName: string): void {
  db.prepare(
    "DELETE FROM preset_dependencies WHERE preset_id = ? AND dependency_name = ?",
  ).run(presetId, dependencyName);
}
```

- [ ] **Step 4: Re-run model tests and verify they pass**

Run: `bun run test:run test/models/preset.test.ts`

Expected: PASS with new version/dependency expectations green.

- [ ] **Step 5: Commit the model changes**

```bash
git add src/models/preset.ts test/models/preset.test.ts
git commit -m "feat: add versioned preset model"
```

---

### Task 3: Build the preset dependency resolver

**Files:**
- Create: `src/services/preset-resolver.ts`
- Create: `test/services/preset-resolver.test.ts`

- [ ] **Step 1: Write failing resolver tests**

```ts
import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("preset resolver", () => {
  it("chooses the highest local version that satisfies all constraints", async () => {
    const context = await createInitializedTestContext("preset-resolver-highest");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resolver = await import("../../src/services/preset-resolver.ts");

      presetModel.createPreset({ name: "baseline", version: "1.0.0" });
      presetModel.createPreset({ name: "baseline", version: "1.5.0" });
      presetModel.createPreset({ name: "baseline", version: "2.0.0" });

      const app = presetModel.createPreset({ name: "app", version: "1.0.0" });
      presetModel.addDependencyToPreset(app.id, "baseline", "^1.0.0");

      const resolved = resolver.resolvePresetGraph(["app"]);

      expect(
        resolved.orderedPresets.map((preset: { name: string; version: string }) =>
          `${preset.name}@${preset.version}`,
        ),
      ).toEqual(["baseline@1.5.0", "app@1.0.0"]);
    } finally {
      await context.cleanup();
    }
  });

  it("fails when constraints are unsatisfied or cyclic", async () => {
    const context = await createInitializedTestContext("preset-resolver-errors");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resolver = await import("../../src/services/preset-resolver.ts");

      const a = presetModel.createPreset({ name: "a", version: "1.0.0" });
      const b = presetModel.createPreset({ name: "b", version: "1.0.0" });
      presetModel.addDependencyToPreset(a.id, "b", "^1.0.0");
      presetModel.addDependencyToPreset(b.id, "a", "^1.0.0");

      expect(() => resolver.resolvePresetGraph(["a"])).toThrow(/cycle/i);
      expect(() => resolver.resolvePresetGraph(["missing@^1.0.0"])).toThrow(/No preset version/i);
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run resolver tests and verify they fail**

Run: `bun run test:run test/services/preset-resolver.test.ts`

Expected: FAIL because `src/services/preset-resolver.ts` does not exist.

- [ ] **Step 3: Implement a local highest-compatible resolver with cycle detection**

```ts
import semver from "semver";
import {
  getPreset,
  listPresets,
  listPresetDependencies,
  parsePresetSelector,
} from "../models/preset.js";
import type { Preset, PresetDependency } from "../types.js";
import { satisfiesConstraint } from "./plugin-constraints.js";

export interface ResolvedPresetGraph {
  requested: string[];
  orderedPresets: Preset[];
  dependenciesByPresetId: Map<string, PresetDependency[]>;
}

function chooseHighestCompatible(name: string, constraints: string[]): Preset {
  const candidates = listPresets()
    .filter((preset) => preset.name === name)
    .sort((left, right) => semver.rcompare(left.version, right.version));

  const winner = candidates.find((preset) =>
    constraints.every((constraint) => satisfiesConstraint(constraint, preset.version)),
  );
  if (!winner) {
    throw new Error(
      `No preset version found for ${name} satisfying ${constraints.join(", ")}`,
    );
  }
  return winner;
}

export function resolvePresetGraph(rootSelectors: string[]): ResolvedPresetGraph {
  const constraints = new Map<string, string[]>();
  const chosen = new Map<string, Preset>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: Preset[] = [];
  const dependenciesByPresetId = new Map<string, PresetDependency[]>();

  function visit(selector: string): void {
    const parsed = parsePresetSelector(selector);
    const name = parsed.name ?? getPreset(selector)?.name;
    if (!name) {
      throw new Error(`Preset not found: ${selector}`);
    }

    const list = constraints.get(name) ?? [];
    if (parsed.versionConstraint) {
      list.push(parsed.versionConstraint);
      constraints.set(name, list);
    }

    const winner = chooseHighestCompatible(name, constraints.get(name) ?? ["*"]);
    chosen.set(name, winner);

    const nodeKey = `${winner.name}@${winner.version}`;
    if (visiting.has(nodeKey)) {
      throw new Error(`Preset dependency cycle detected at ${nodeKey}`);
    }
    if (visited.has(nodeKey)) {
      return;
    }

    visiting.add(nodeKey);
    const deps = listPresetDependencies(winner.id);
    dependenciesByPresetId.set(winner.id, deps);
    for (const dep of deps) {
      visit(`${dep.dependency_name}@${dep.version_constraint}`);
    }
    visiting.delete(nodeKey);
    visited.add(nodeKey);
    ordered.push(winner);
  }

  for (const selector of rootSelectors) {
    visit(selector);
  }

  return { requested: rootSelectors, orderedPresets: ordered, dependenciesByPresetId };
}
```

- [ ] **Step 4: Re-run resolver tests and verify they pass**

Run: `bun run test:run test/services/preset-resolver.test.ts`

Expected: PASS with highest-compatible selection and cycle detection covered.

- [ ] **Step 5: Commit the resolver**

```bash
git add src/services/preset-resolver.ts test/services/preset-resolver.test.ts
git commit -m "feat: resolve preset dependency graphs"
```

---

### Task 4: Replace flat preset stacking with typed merge conflicts

**Files:**
- Modify: `src/services/preset-merge.ts`
- Modify: `src/services/preset-validate.ts`
- Create: `test/services/preset-merge.test.ts`

- [ ] **Step 1: Add failing merge tests for overrides and hard conflicts**

```ts
import { describe, expect, it } from "vitest";
import { createInitializedTestContext } from "../helpers/db.ts";
import { makeResourceInput } from "../helpers/resources.ts";

describe("preset merge", () => {
  it("allows later instruction resources to override earlier ones", async () => {
    const context = await createInitializedTestContext("preset-merge-override");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const resolver = await import("../../src/services/preset-resolver.ts");
      const merger = await import("../../src/services/preset-merge.ts");

      const base = presetModel.createPreset({ name: "base", version: "1.0.0" });
      const app = presetModel.createPreset({ name: "app", version: "1.0.0" });
      presetModel.addDependencyToPreset(app.id, "base", "^1.0.0");

      const baseCtx = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "project-context", content: "# Base" }),
      );
      const appCtx = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "project-context", content: "# App" }),
      );
      presetModel.addResourceToPreset(base.id, baseCtx.id);
      presetModel.addResourceToPreset(app.id, appCtx.id);

      const merged = merger.mergeResolvedPresets(resolver.resolvePresetGraph(["app"]));
      expect(merged.resources.find((resource: { name: string }) => resource.name === "project-context")?.content).toBe("# App");
    } finally {
      await context.cleanup();
    }
  });

  it("fails on incompatible permission duplicates", async () => {
    const context = await createInitializedTestContext("preset-merge-permission-conflict");

    try {
      const presetModel = await import("../../src/models/preset.ts");
      const resourceModel = await import("../../src/models/resource.ts");
      const resolver = await import("../../src/services/preset-resolver.ts");
      const merger = await import("../../src/services/preset-merge.ts");

      const base = presetModel.createPreset({ name: "base", version: "1.0.0" });
      const app = presetModel.createPreset({ name: "app", version: "1.0.0" });
      presetModel.addDependencyToPreset(app.id, "base", "^1.0.0");

      const allow = resourceModel.createResource(
        makeResourceInput({
          type: "permission",
          name: "git-push",
          metadata: { action: "allow", pattern: "git push" },
        }),
      );
      const deny = resourceModel.createResource(
        makeResourceInput({
          type: "permission",
          name: "git-push",
          metadata: { action: "deny", pattern: "git push" },
        }),
      );
      presetModel.addResourceToPreset(base.id, allow.id);
      presetModel.addResourceToPreset(app.id, deny.id);

      expect(() =>
        merger.mergeResolvedPresets(resolver.resolvePresetGraph(["app"])),
      ).toThrow(/permission conflict/i);
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run merge tests and verify they fail**

Run: `bun run test:run test/services/preset-merge.test.ts`

Expected: FAIL because `mergePresets()` still accepts raw preset names and silently last-wins every duplicate.

- [ ] **Step 3: Implement resolver-backed merge and conflict policies**

```ts
import { getPresetResources } from "../models/preset.js";
import { listPresetPlugins } from "../models/plugin.js";
import type { ClaudePluginEntry, ClaudePresetConfig, Resource, ResourceType } from "../types.js";
import type { ResolvedPresetGraph } from "./preset-resolver.js";

const OVERRIDE_TYPES = new Set<ResourceType>([
  "instruction",
  "skill",
  "rule",
  "model_config",
]);

function resourceKey(resource: Pick<Resource, "type" | "name">): string {
  return `${resource.type}:${resource.name}`;
}

function sameResource(left: Resource, right: Resource): boolean {
  return JSON.stringify({
    type: left.type,
    name: left.name,
    description: left.description,
    content: left.content,
    metadata: left.metadata,
  }) ===
    JSON.stringify({
      type: right.type,
      name: right.name,
      description: right.description,
      content: right.content,
      metadata: right.metadata,
    });
}

function mergeClaudeConfig(
  base: ClaudePresetConfig | undefined,
  next: ClaudePresetConfig | undefined,
): ClaudePresetConfig | undefined {
  if (!base) return next;
  if (!next) return base;

  const marketplaces = { ...(base.marketplaces ?? {}) };
  for (const [name, entry] of Object.entries(next.marketplaces ?? {})) {
    const existing = marketplaces[name];
    if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) {
      throw new Error(`Claude marketplace conflict: ${name}`);
    }
    marketplaces[name] = entry;
  }

  const pluginMap = new Map<string, ClaudePluginEntry>();
  for (const plugin of [...(base.plugins ?? []), ...(next.plugins ?? [])]) {
    const existing = pluginMap.get(plugin.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(plugin)) {
      throw new Error(`Claude plugin conflict: ${plugin.id}`);
    }
    pluginMap.set(plugin.id, plugin);
  }

  return {
    ...(Object.keys(marketplaces).length > 0 ? { marketplaces } : {}),
    ...(pluginMap.size > 0 ? { plugins: [...pluginMap.values()] } : {}),
  };
}

export function mergeResolvedPresets(graph: ResolvedPresetGraph) {
  const resourceOrder: string[] = [];
  const resourceByKey = new Map<string, Resource>();
  const pluginPins = new Map<string, { ref: string; version_constraint: string }>();
  let claude: ClaudePresetConfig | undefined;

  for (const preset of graph.orderedPresets) {
    for (const resource of getPresetResources(preset.id)) {
      const key = resourceKey(resource);
      const existing = resourceByKey.get(key);
      if (!existing) {
        resourceOrder.push(key);
        resourceByKey.set(key, resource);
        continue;
      }
      if (sameResource(existing, resource)) continue;
      if (OVERRIDE_TYPES.has(resource.type)) {
        resourceByKey.set(key, resource);
        continue;
      }
      throw new Error(`${resource.type} conflict on ${key}`);
    }

    for (const pin of listPresetPlugins(preset.id)) {
      const existing = pluginPins.get(pin.ref);
      if (existing && existing.version_constraint !== pin.version_constraint) {
        throw new Error(`Plugin pin conflict: ${pin.ref}`);
      }
      pluginPins.set(pin.ref, {
        ref: pin.ref,
        version_constraint: pin.version_constraint,
      });
    }

    claude = mergeClaudeConfig(claude, preset.claude);
  }

  return {
    presets: graph.orderedPresets,
    resources: resourceOrder.map((key) => resourceByKey.get(key)).filter(Boolean),
    claude,
    pluginPins: [...pluginPins.values()],
  };
}
```

`src/services/preset-validate.ts`:

```ts
import { resolvePresetGraph } from "./preset-resolver.js";
import { mergeResolvedPresets } from "./preset-merge.js";

export function validatePreset(nameOrId: string): PresetValidationReport {
  const preset = getPreset(nameOrId);
  const issues: PresetValidationIssue[] = [];

  if (!preset) {
    return {
      preset: nameOrId,
      valid: false,
      issues: [
        {
          severity: "error",
          code: "preset_not_found",
          message: `Preset not found: ${nameOrId}`,
        },
      ],
    };
  }

  const resources = getPresetResources(preset.id);
  if (resources.length === 0) {
    issues.push({
      severity: "warning",
      code: "empty_preset",
      message: "Preset has no resources",
    });
  }

  for (const pin of listPresetPlugins(preset.id)) {
    try {
      parseVersionConstraint(pin.version_constraint);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "invalid_version_constraint",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const graph = resolvePresetGraph([nameOrId]);
    mergeResolvedPresets(graph);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "preset_resolution_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    preset: `${preset.name}@${preset.version}`,
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}
```

- [ ] **Step 4: Re-run merge tests and validation-adjacent tests**

Run: `bun run test:run test/services/preset-merge.test.ts test/models/preset.test.ts`

Expected: PASS with override and hard-conflict behaviors enforced.

- [ ] **Step 5: Commit merge policy changes**

```bash
git add src/services/preset-merge.ts src/services/preset-validate.ts test/services/preset-merge.test.ts
git commit -m "feat: add preset conflict resolution"
```

---

### Task 5: Add version-aware preset CLI and dependency commands

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli/preset.test.ts`

- [ ] **Step 1: Add failing CLI tests for versioned presets and dependencies**

```ts
it("creates, shows, and manages versioned preset dependencies", async () => {
  const context = await createTestContext("cli-preset-versioned");

  try {
    await runCli(["init"]);

    await runCli([
      "preset",
      "create",
      "team-stack",
      "--version",
      "1.0.0",
      "--description",
      "Team base",
    ]);
    await runCli(["preset", "create", "team-stack", "--version", "1.2.0"]);
    await runCli([
      "preset",
      "add-dependency",
      "team-stack@1.2.0",
      "baseline",
      "--version",
      "^1.0.0",
    ]);

    const show = await runCli(["preset", "show", "team-stack@1.2.0"]);
    const list = await runCli(["preset", "list"]);

    expect(show.stdout).toContain("team-stack@1.2.0");
    expect(show.stdout).toContain("baseline");
    expect(show.stdout).toContain("^1.0.0");
    expect(list.stdout).toContain("team-stack@1.0.0");
    expect(list.stdout).toContain("team-stack@1.2.0");
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run CLI preset tests and verify they fail**

Run: `bun run test:run test/cli/preset.test.ts`

Expected: FAIL because `preset create` has no `--version` flag and `add-dependency` does not exist.

- [ ] **Step 3: Implement version-aware preset commands**

`src/index.ts`:

```ts
presetCmd
  .command("create")
  .argument("<name>", "Preset name")
  .option("--version <semver>", "Preset version", "1.0.0")
  .option("-d, --description <text>", "Preset description")
  .option("--tags <tags>", "Comma-separated tags")
  .action((name: string, opts: { version?: string; description?: string; tags?: string }) => {
    const db = getDb();
    initializeSchema(db);
    const tags = opts.tags?.split(",").map((t) => t.trim()) ?? [];
    const preset = createPreset({
      name,
      version: opts.version,
      description: opts.description,
      tags,
    });
    log.success(`Preset created: ${preset.name}@${preset.version} (${preset.id})`);
  });

presetCmd
  .command("add-dependency")
  .argument("<preset>", "Preset selector (name, id, or name@constraint)")
  .argument("<dependency>", "Dependency preset name")
  .requiredOption("--version <constraint>", "Dependency version constraint")
  .action((presetSelector: string, dependencyName: string, opts: { version: string }) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetSelector);
    if (!preset) {
      log.error(`Preset not found: ${presetSelector}`);
      return;
    }
    addDependencyToPreset(preset.id, dependencyName, opts.version);
    log.success(
      `Added dependency ${dependencyName}@${opts.version} to ${preset.name}@${preset.version}`,
    );
  });

presetCmd
  .command("remove-dependency")
  .argument("<preset>", "Preset selector")
  .argument("<dependency>", "Dependency preset name")
  .action((presetSelector: string, dependencyName: string) => {
    const db = getDb();
    initializeSchema(db);
    const preset = getPreset(presetSelector);
    if (!preset) {
      log.error(`Preset not found: ${presetSelector}`);
      return;
    }
    removeDependencyFromPreset(preset.id, dependencyName);
    log.success(`Removed dependency ${dependencyName} from ${preset.name}@${preset.version}`);
  });
```

Also update `handlePresetShowCommand()` and `preset list` output to include `preset.version` and `listPresetDependencies(preset.id)`.

- [ ] **Step 4: Re-run CLI preset tests and verify they pass**

Run: `bun run test:run test/cli/preset.test.ts`

Expected: PASS with versioned create/show/list/add-dependency coverage.

- [ ] **Step 5: Commit the CLI preset UX**

```bash
git add src/index.ts test/cli/preset.test.ts
git commit -m "feat: add versioned preset CLI"
```

---

### Task 6: Wire resolver-backed apply/export/import/validate and update docs

**Files:**
- Modify: `src/index.ts`
- Modify: `src/services/exporter.ts`
- Modify: `src/services/preset-diff.ts`
- Modify: `src/services/preset-validate.ts`
- Modify: `test/cli/apply.test.ts`
- Modify: `test/services/exporter.test.ts`
- Modify: `test/cli/export-import.test.ts`
- Modify: `README.md`
- Modify: `docs/scenarios/details/25-stack-presets.md`

- [ ] **Step 1: Add failing integration tests for apply and bundle round-trip**

`test/cli/apply.test.ts`:

```ts
it("applies a composed preset using the resolved dependency version", async () => {
  const context = await createTestContext("cli-apply-composed");

  try {
    initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-composed.git");
    await runCli(["init"]);

    const presetModel = await import("../../src/models/preset.ts");
    const resourceModel = await import("../../src/models/resource.ts");

    const baseV1 = presetModel.createPreset({ name: "baseline", version: "1.0.0" });
    const baseV2 = presetModel.createPreset({ name: "baseline", version: "1.2.0" });
    const app = presetModel.createPreset({ name: "app", version: "1.0.0" });
    presetModel.addDependencyToPreset(app.id, "baseline", "^1.0.0");

    const v1Resource = resourceModel.createResource(
      makeResourceInput({ type: "instruction", name: "project-context", content: "# Old" }),
    );
    const v2Resource = resourceModel.createResource(
      makeResourceInput({ type: "instruction", name: "project-context", content: "# New" }),
    );
    presetModel.addResourceToPreset(baseV1.id, v1Resource.id);
    presetModel.addResourceToPreset(baseV2.id, v2Resource.id);

    const result = await runCli([
      "project",
      "apply",
      "app",
      "--project",
      context.projectDir,
      "--platform",
      "claude-code",
    ]);

    expect(result.stdout).toContain("claude-code: wrote 1 file(s)");
    expect(readFileSync(join(context.projectDir, "CLAUDE.md"), "utf-8")).toContain("# New");
  } finally {
    await context.cleanup();
  }
});
```

`test/services/exporter.test.ts`:

```ts
it("exports bundle v1 with preset version and dependencies", async () => {
  const context = await createInitializedTestContext("export-versioned-preset");

  try {
    const presetModel = await import("../../src/models/preset.ts");
    const exporter = await import("../../src/services/exporter.ts");

    const preset = presetModel.createPreset({ name: "team-stack", version: "1.2.0" });
    presetModel.addDependencyToPreset(preset.id, "baseline", "^1.0.0");

    const bundle = exporter.exportPreset(preset.id);

    expect(bundle.version).toBe(1);
    expect(bundle.preset.version).toBe("1.2.0");
    expect(bundle.preset.dependencies).toEqual([
      { name: "baseline", version_constraint: "^1.0.0" },
    ]);
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run integration tests and verify they fail**

Run: `bun run test:run test/cli/apply.test.ts test/services/exporter.test.ts test/cli/export-import.test.ts`

Expected: FAIL because apply still uses `mergePresets(presetNames)` directly and bundles do not carry preset version/dependency metadata.

- [ ] **Step 3: Integrate the resolver into apply/export/import/validate/diff**

`src/index.ts`:

```ts
import { resolvePresetGraph } from "./services/preset-resolver.js";
import { mergeResolvedPresets } from "./services/preset-merge.js";

async function resolveApplyPresets(
  presetNames: [string, ...string[]],
  projectRoot: string,
): Promise<{
  presets: ReturnType<typeof getPreset>[];
  resources: Resource[];
  claude?: import("./types.js").ClaudePresetConfig;
  primaryPresetId: string;
}> {
  if (presetNames.length === 1 && isPresetUrl(presetNames[0])) {
    const tempFile = await fetchPresetBundleToTempFile(presetNames[0]);
    const { preset } = importFromFile(tempFile, { embeddedTargetDir: projectRoot });
    const resolved = mergeResolvedPresets(resolvePresetGraph([`${preset.name}@${preset.version}`]));
    return {
      presets: resolved.presets,
      resources: resolved.resources,
      claude: resolved.claude,
      primaryPresetId: preset.id,
    };
  }

  if (presetNames.length === 1 && isBundleFilePath(presetNames[0])) {
    const { preset } = importFromFile(presetNames[0], { embeddedTargetDir: projectRoot });
    const resolved = mergeResolvedPresets(resolvePresetGraph([`${preset.name}@${preset.version}`]));
    return {
      presets: resolved.presets,
      resources: resolved.resources,
      claude: resolved.claude,
      primaryPresetId: preset.id,
    };
  }

  const merged = mergeResolvedPresets(resolvePresetGraph([...presetNames]));
  return {
    presets: merged.presets,
    resources: merged.resources,
    claude: merged.claude,
    primaryPresetId: merged.presets[merged.presets.length - 1]?.id ?? "",
  };
}
```

`src/services/exporter.ts`:

```ts
const presetSubset = {
  name: preset.name,
  version: preset.version,
  description: preset.description,
  tags: preset.tags,
  dependencies: listPresetDependencies(preset.id).map((dependency) => ({
    name: dependency.dependency_name,
    version_constraint: dependency.version_constraint,
  })),
  ...(preset.claude ? { claude: preset.claude } : {}),
};

const preset = createPreset({
  name: bundle.preset.name,
  version: bundle.preset.version ?? "1.0.0",
  description: bundle.preset.description,
  tags: bundle.preset.tags,
  ...(claude ? { claude } : {}),
});

for (const dependency of bundle.preset.dependencies ?? []) {
  addDependencyToPreset(
    preset.id,
    dependency.name,
    dependency.version_constraint,
  );
}
```

`src/services/preset-diff.ts`:

```ts
interface PresetView {
  label: string;
  version: string;
  dependencies: Array<{ name: string; version_constraint: string }>;
  resources: Array<{ key: string; order: number; resource: Resource }>;
  plugins: Array<{ ref: string; version_constraint: string }>;
  description: string;
  tags: string[];
  claudeJson: string;
}

if (left.version !== right.version) {
  changes.push({
    kind: "metadata",
    key: "version",
    left: left.version,
    right: right.version,
    change: "modified",
  });
}

if (JSON.stringify(left.dependencies) !== JSON.stringify(right.dependencies)) {
  changes.push({
    kind: "metadata",
    key: "dependencies",
    left: JSON.stringify(left.dependencies),
    right: JSON.stringify(right.dependencies),
    change: "modified",
  });
}
```

Also update `preset validate` output to include resolver errors, and update `README.md` + `docs/scenarios/details/25-stack-presets.md` with:

````md
```bash
harnessdeck preset create team-stack --version 1.1.0 --description "Team baseline"
harnessdeck preset add-dependency team-stack@1.1.0 baseline --version "^1.0.0"
harnessdeck project apply team-stack@^1 --project . --platform claude-code,codex
```
````

- [ ] **Step 4: Run focused integration tests and full repository verification**

Run:

```bash
bun run test:run test/db/schema.test.ts test/models/preset.test.ts test/services/preset-resolver.test.ts test/services/preset-merge.test.ts test/services/exporter.test.ts test/cli/preset.test.ts test/cli/apply.test.ts test/cli/export-import.test.ts
bun run preflight
```

Expected: PASS for the focused tests, then PASS for lint, typecheck, full tests, and build.

- [ ] **Step 5: Commit the end-to-end integration**

```bash
git add src/index.ts src/services/exporter.ts src/services/preset-diff.ts src/services/preset-validate.ts test/cli/apply.test.ts test/services/exporter.test.ts test/cli/export-import.test.ts README.md docs/scenarios/details/25-stack-presets.md
git commit -m "feat: add composed versioned presets"
```

---

## Self-Review Checklist

- **Spec coverage:** This plan covers schema, model APIs, resolution, merge conflicts, CLI commands, apply/export/import, validation, diffs, docs, and verification.
- **Placeholder scan:** No `TBD`, `TODO`, or “implement later” placeholders should remain after edits. If you add a new function name while implementing, update all later tasks to use the same name.
- **Type consistency:** Keep these names consistent across all files: `Preset.version`, `PresetDependency`, `parsePresetSelector`, `resolvePresetGraph`, `mergeResolvedPresets`, `addDependencyToPreset`, `listPresetDependencies`, `removeDependencyFromPreset`.
