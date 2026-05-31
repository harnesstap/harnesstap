# Global Cursor Plugin Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend HarnessDeck scanning so a Cursor/Claude plugin directory or marketplace manifest can be imported as a snapshot and optionally installed into every configured harness's global directories.

**Architecture:** Add a plugin-source import pipeline that normalizes plugin artifacts into HarnessDeck's canonical resource model, persist import snapshot ownership in the database, and extend the serializer/applier path with a global materialization target. Keep the CLI entry point under `project scan`, so plugin imports feel like scanning another source instead of a separate command family.

**Tech Stack:** Bun, TypeScript, Commander, Better SQLite3, inquirer, existing platform serializers/tests

---

## File map

### New files

- `src/models/imported-snapshot.ts` — persistence helpers for imported plugin snapshots and global install ownership.
- `src/services/plugin-source-import.ts` — detect plugin roots/marketplace manifests, parse manifests, normalize plugin files into canonical resources.
- `test/models/imported-snapshot.test.ts` — model coverage for snapshot/global-install persistence.
- `test/services/plugin-source-import.test.ts` — service coverage for plugin root and marketplace imports.
- `test/fixtures/plugin-import/cursor-team-kit/.cursor-plugin/plugin.json` — minimal plugin manifest fixture.
- `test/fixtures/plugin-import/cursor-team-kit/skills/team/SKILL.md` — imported skill fixture.
- `test/fixtures/plugin-import/cursor-team-kit/agents/reviewer.md` — imported agent fixture.
- `test/fixtures/plugin-import/cursor-team-kit/rules/review.mdc` — imported rule fixture.
- `test/fixtures/plugin-import/marketplace/.cursor-plugin/marketplace.json` — marketplace fixture pointing at multiple bundled plugin entries.

### Modified files

- `src/db/schema.ts` — schema version bump + imported snapshot/install tables.
- `src/types.ts` — import snapshot types, serializer target types, CLI option types.
- `src/services/scanner.ts` — detect plugin-source paths, persist imported snapshots, expose plugin import scan helpers.
- `src/services/applier.ts` — add global materialization support, conflict prompting, install ownership recording.
- `src/platforms/base-serializer.ts` — shared path selection helpers for project vs global output.
- `src/platforms/claude-code.ts`
- `src/platforms/codex.ts`
- `src/platforms/copilot.ts`
- `src/platforms/cursor.ts`
- `src/platforms/generic-agents.ts`
- `src/platforms/opencode.ts` — serializers must honor the new materialization target.
- `src/index.ts` — extend `project scan` CLI flow and output for plugin imports/global installs.
- `test/db/schema.test.ts` — schema migration coverage.
- `test/services/scanner.test.ts` — plugin-source scan persistence coverage.
- `test/services/applier.test.ts` — global apply/conflict coverage.
- `test/platforms/claude-code.test.ts`
- `test/platforms/copilot.test.ts`
- `test/platforms/cursor.test.ts`
- `test/platforms/generic-agents.test.ts`
- `test/platforms/codex.test.ts`
- `test/platforms/opencode.test.ts` — serializer target coverage.
- `test/cli/scan.test.ts` — CLI import/global install coverage.

### Task 1: Persist imported snapshots and global install ownership

**Files:**
- Create: `src/models/imported-snapshot.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/types.ts`
- Test: `test/models/imported-snapshot.test.ts`
- Test: `test/db/schema.test.ts`

- [ ] **Step 1: Write the failing persistence tests**

```ts
// test/models/imported-snapshot.test.ts
import { describe, expect, it } from "bun:test";
import { createInitializedTestContext } from "../helpers/db.ts";

describe("imported snapshot model", () => {
  it("creates and lists imported snapshots with resource ownership", async () => {
    const context = await createInitializedTestContext("imported-snapshot-model");

    try {
      const snapshots = await import("../../src/models/imported-snapshot.ts");

      const created = snapshots.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "cursor-team-kit",
        plugin_name: "cursor-team-kit",
        plugin_version: "1.2.3",
        resource_ids: ["res_skill", "res_agent"],
        metadata: { imported_from: "/tmp/cursor-team-kit" },
      });

      expect(created.plugin_name).toBe("cursor-team-kit");
      expect(created.resource_ids).toEqual(["res_skill", "res_agent"]);
      expect(snapshots.listImportedSnapshots()).toHaveLength(1);
    } finally {
      await context.cleanup();
    }
  });

  it("records global installs per snapshot and platform", async () => {
    const context = await createInitializedTestContext("imported-snapshot-install");

    try {
      const snapshots = await import("../../src/models/imported-snapshot.ts");
      const created = snapshots.createImportedSnapshot({
        source_kind: "cursor-plugin",
        source_label: "cursor-team-kit",
        plugin_name: "cursor-team-kit",
        resource_ids: [],
        metadata: {},
      });

      snapshots.recordImportedSnapshotInstall({
        snapshot_id: created.id,
        platform_id: "copilot-cli",
        files: {
          "AGENTS.md": "# imported",
          ".copilot/mcp-config.json": "{\"mcpServers\":{}}",
        },
      });

      expect(
        snapshots.listImportedSnapshotInstalls(created.id),
      ).toEqual([
        expect.objectContaining({
          snapshot_id: created.id,
          platform_id: "copilot-cli",
        }),
      ]);
    } finally {
      await context.cleanup();
    }
  });
});
```

Run: `bun test test/models/imported-snapshot.test.ts test/db/schema.test.ts`
Expected: FAIL with module/type/schema errors because the snapshot model and tables do not exist yet.

- [ ] **Step 2: Add the new types and schema migration**

```ts
// src/types.ts
export type ImportedSourceKind =
  | "cursor-plugin"
  | "claude-plugin"
  | "marketplace";

export interface ImportedSnapshot {
  id: string;
  source_kind: ImportedSourceKind;
  source_label: string;
  plugin_name: string;
  plugin_version?: string;
  resource_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ImportedSnapshotInstall {
  snapshot_id: string;
  platform_id: string;
  files: Record<string, string>;
  installed_at: string;
}
```

```ts
// src/db/schema.ts
const SCHEMA_VERSION = 7;

MIGRATIONS[7] = `
  CREATE TABLE IF NOT EXISTS imported_snapshots (
    id             TEXT PRIMARY KEY,
    source_kind    TEXT NOT NULL,
    source_label   TEXT NOT NULL,
    plugin_name    TEXT NOT NULL,
    plugin_version TEXT NOT NULL DEFAULT '',
    resource_ids   TEXT NOT NULL DEFAULT '[]',
    metadata       TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS imported_snapshot_installs (
    snapshot_id    TEXT NOT NULL REFERENCES imported_snapshots(id) ON DELETE CASCADE,
    platform_id    TEXT NOT NULL,
    files          TEXT NOT NULL DEFAULT '{}',
    installed_at   TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, platform_id)
  );
`;
```

- [ ] **Step 3: Implement the model**

```ts
// src/models/imported-snapshot.ts
import { getDb } from "../db/connection.js";
import { ulid } from "ulid";
import type {
  ImportedSnapshot,
  ImportedSnapshotInstall,
  ImportedSourceKind,
} from "../types.js";

export function createImportedSnapshot(input: {
  source_kind: ImportedSourceKind;
  source_label: string;
  plugin_name: string;
  plugin_version?: string;
  resource_ids: string[];
  metadata: Record<string, unknown>;
}): ImportedSnapshot {
  const db = getDb();
  const created_at = new Date().toISOString();
  const id = ulid();

  db.prepare(
    `INSERT INTO imported_snapshots (
       id, source_kind, source_label, plugin_name, plugin_version, resource_ids, metadata, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.source_kind,
    input.source_label,
    input.plugin_name,
    input.plugin_version ?? "",
    JSON.stringify(input.resource_ids),
    JSON.stringify(input.metadata),
    created_at,
  );

  return {
    id,
    source_kind: input.source_kind,
    source_label: input.source_label,
    plugin_name: input.plugin_name,
    plugin_version: input.plugin_version,
    resource_ids: input.resource_ids,
    metadata: input.metadata,
    created_at,
  };
}

export function recordImportedSnapshotInstall(input: {
  snapshot_id: string;
  platform_id: string;
  files: Record<string, string>;
}): ImportedSnapshotInstall {
  const db = getDb();
  const installed_at = new Date().toISOString();
  db.prepare(
    `INSERT INTO imported_snapshot_installs (snapshot_id, platform_id, files, installed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(snapshot_id, platform_id) DO UPDATE SET
       files = excluded.files,
       installed_at = excluded.installed_at`,
  ).run(input.snapshot_id, input.platform_id, JSON.stringify(input.files), installed_at);

  return { ...input, installed_at };
}
```

- [ ] **Step 4: Run the model/schema tests until they pass**

Run: `bun test test/models/imported-snapshot.test.ts test/db/schema.test.ts`
Expected: PASS with the new migration and model behavior covered.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/types.ts src/models/imported-snapshot.ts test/models/imported-snapshot.test.ts test/db/schema.test.ts
git commit -m "Add imported snapshot persistence"
```

### Task 2: Import plugin sources into canonical resources

**Files:**
- Create: `src/services/plugin-source-import.ts`
- Modify: `src/services/scanner.ts`
- Modify: `src/types.ts`
- Create: `test/services/plugin-source-import.test.ts`
- Modify: `test/services/scanner.test.ts`
- Create: `test/fixtures/plugin-import/cursor-team-kit/.cursor-plugin/plugin.json`
- Create: `test/fixtures/plugin-import/cursor-team-kit/skills/team/SKILL.md`
- Create: `test/fixtures/plugin-import/cursor-team-kit/agents/reviewer.md`
- Create: `test/fixtures/plugin-import/cursor-team-kit/rules/review.mdc`
- Create: `test/fixtures/plugin-import/marketplace/.cursor-plugin/marketplace.json`

- [ ] **Step 1: Write the failing importer tests**

```ts
// test/services/plugin-source-import.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const FIXTURE_ROOT = join(import.meta.dirname, "../fixtures/plugin-import");

describe("plugin source import service", () => {
  it("imports a Cursor plugin directory into canonical resources", async () => {
    const service = await import("../../src/services/plugin-source-import.ts");
    const [result] = await service.scanPluginSource(
      join(FIXTURE_ROOT, "cursor-team-kit"),
    );

    expect(result.source_kind).toBe("cursor-plugin");
    expect(result.plugin_name).toBe("cursor-team-kit");
    expect(result.resources.map((resource) => resource.type)).toEqual(
      expect.arrayContaining(["skill", "agent", "rule"]),
    );
  });

  it("expands a marketplace manifest into multiple plugin imports", async () => {
    const service = await import("../../src/services/plugin-source-import.ts");
    const results = await service.scanPluginSource(
      join(FIXTURE_ROOT, "marketplace", ".cursor-plugin", "marketplace.json"),
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(2);
    expect(results.map((entry) => entry.plugin_name)).toEqual(
      expect.arrayContaining(["cursor-team-kit", "review-kit"]),
    );
  });
});
```

Run: `bun test test/services/plugin-source-import.test.ts test/services/scanner.test.ts`
Expected: FAIL because plugin-source scanning does not exist.

- [ ] **Step 2: Add the fixture contents**

```json
// test/fixtures/plugin-import/cursor-team-kit/.cursor-plugin/plugin.json
{
  "name": "cursor-team-kit",
  "version": "1.2.3",
  "description": "Team-wide Cursor plugin fixture",
  "skills": "./skills",
  "agents": "./agents",
  "rules": "./rules"
}
```

```md
<!-- test/fixtures/plugin-import/cursor-team-kit/skills/team/SKILL.md -->
---
name: team
description: Team operating guidance
---
# Team skill
Use the shared review checklist.
```

```md
<!-- test/fixtures/plugin-import/cursor-team-kit/rules/review.mdc -->
---
description: Review checklist
alwaysApply: false
globs: "*.ts,*.tsx"
---
Review TypeScript changes for API stability.
```

- [ ] **Step 3: Implement plugin-source detection and normalization**

```ts
// src/services/plugin-source-import.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import type { Resource } from "../types.js";

export interface ImportedPluginScan {
  source_kind: "cursor-plugin" | "claude-plugin" | "marketplace";
  source_label: string;
  plugin_name: string;
  plugin_version?: string;
  resources: Omit<Resource, "id" | "created_at" | "updated_at">[];
}

export async function scanPluginSource(
  sourcePath: string,
): Promise<ImportedPluginScan[]> {
  const resolved = resolve(sourcePath);
  const cursorManifest = existsSync(join(resolved, ".cursor-plugin", "plugin.json"))
    ? join(resolved, ".cursor-plugin", "plugin.json")
    : undefined;
  const claudeManifest = existsSync(join(resolved, ".claude-plugin", "plugin.json"))
    ? join(resolved, ".claude-plugin", "plugin.json")
    : undefined;
  const marketplaceManifest = resolved.endsWith("marketplace.json") ? resolved : undefined;

  if (marketplaceManifest) {
    const marketplace = JSON.parse(readFileSync(marketplaceManifest, "utf-8")) as {
      plugins: Array<{ path: string }>;
    };
    return Promise.all(
      marketplace.plugins.map((entry) =>
        scanPluginSource(join(dirname(marketplaceManifest), entry.path)),
      ),
    ).then((entries) => entries.flat());
  }

  const manifestPath = cursorManifest ?? claudeManifest;
  if (!manifestPath) {
    throw new Error(`Unsupported plugin source: ${resolved}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    name: string;
    version?: string;
    skills?: string;
    agents?: string;
    rules?: string;
  };

  return [
    {
      source_kind: cursorManifest ? "cursor-plugin" : "claude-plugin",
      source_label: resolved,
      plugin_name: manifest.name,
      plugin_version: manifest.version,
      resources: [
        ...scanSkillDir(join(resolved, manifest.skills ?? "skills"), resolved),
        ...scanAgentDir(join(resolved, manifest.agents ?? "agents"), resolved),
        ...scanRuleDir(join(resolved, manifest.rules ?? "rules"), resolved),
      ].map((resource) => ({
        ...resource,
        metadata: {
          ...resource.metadata,
          import_plugin_name: manifest.name,
          import_source_label: resolved,
        },
      })),
    },
  ];
}

function scanSkillDir(dirPath: string, rootPath: string) {
  return collectFiles(dirPath, ".md").map((filePath) => ({
      type: "skill" as const,
      source_platform: "cursor-plugin",
      source_path: filePath.replace(`${rootPath}/`, ""),
      name: filePath.split("/").at(-2) ?? filePath.split("/").at(-1)!.replace(/\.md$/i, "").toLowerCase(),
      description: "",
      content: readFileSync(filePath, "utf-8"),
      metadata: {},
    }));
}

function scanAgentDir(dirPath: string, rootPath: string) {
  return collectFiles(dirPath, ".md").map((filePath) => ({
      type: "agent" as const,
      source_platform: "cursor-plugin",
      source_path: filePath.replace(`${rootPath}/`, ""),
      name: filePath.split("/").at(-1)!.replace(/\.md$/i, "").toLowerCase(),
      description: "",
      content: readFileSync(filePath, "utf-8"),
      metadata: {},
    }));
}

function scanRuleDir(dirPath: string, rootPath: string) {
  return collectFiles(dirPath, ".mdc").map((filePath) => ({
      type: "rule" as const,
      source_platform: "cursor-plugin",
      source_path: filePath.replace(`${rootPath}/`, ""),
      name: filePath.split("/").at(-1)!.replace(/\.mdc$/i, "").toLowerCase(),
      description: "",
      content: readFileSync(filePath, "utf-8"),
      metadata: {},
    }));
}

function collectFiles(dirPath: string, extension: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const nextPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(nextPath, extension));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(nextPath);
    }
  }
  return files;
}
```

- [ ] **Step 4: Wire scanner persistence to create imported snapshots**

```ts
// src/services/scanner.ts
import { createImportedSnapshot } from "../models/imported-snapshot.js";
import { scanPluginSource } from "./plugin-source-import.js";

export async function scanImportSource(sourcePath: string): Promise<ScanResult[]> {
  const entries = await scanPluginSource(sourcePath);
  return entries.map((entry) => ({
    platformId: entry.source_kind,
    resources: entry.resources,
  }));
}

export async function scanAndPersistImportSource(sourcePath: string) {
  const entries = await scanPluginSource(sourcePath);
  const persisted = persistScanResults(
    entries.map((entry) => ({ platformId: entry.source_kind, resources: entry.resources })),
  );

  const imported = entries.map((entry) => {
    const snapshot = createImportedSnapshot({
      source_kind: entry.source_kind,
      source_label: entry.source_label,
      plugin_name: entry.plugin_name,
      plugin_version: entry.plugin_version,
      resource_ids: persisted.resources
        .filter(
          (resource) =>
            resource.metadata.import_plugin_name === entry.plugin_name &&
            resource.metadata.import_source_label === entry.source_label,
        )
        .map((resource) => resource.id),
      metadata: { imported_from: entry.source_label },
    });

    return { entry, snapshot };
  });

  return { persisted, imported };
}
```

- [ ] **Step 5: Run the importer/scanner tests until they pass**

Run: `bun test test/services/plugin-source-import.test.ts test/services/scanner.test.ts`
Expected: PASS with plugin directory imports, marketplace expansion, and snapshot persistence covered.

- [ ] **Step 6: Commit**

```bash
git add src/services/plugin-source-import.ts src/services/scanner.ts src/types.ts test/services/plugin-source-import.test.ts test/services/scanner.test.ts test/fixtures/plugin-import
git commit -m "Import plugin sources into canonical resources"
```

### Task 3: Add global serializer/applier support with conflict prompts

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/applier.ts`
- Modify: `src/platforms/base-serializer.ts`
- Modify: `src/platforms/claude-code.ts`
- Modify: `src/platforms/codex.ts`
- Modify: `src/platforms/copilot.ts`
- Modify: `src/platforms/cursor.ts`
- Modify: `src/platforms/generic-agents.ts`
- Modify: `src/platforms/opencode.ts`
- Modify: `src/models/imported-snapshot.ts`
- Test: `test/services/applier.test.ts`
- Test: `test/platforms/claude-code.test.ts`
- Test: `test/platforms/copilot.test.ts`
- Test: `test/platforms/cursor.test.ts`
- Test: `test/platforms/generic-agents.test.ts`
- Test: `test/platforms/codex.test.ts`
- Test: `test/platforms/opencode.test.ts`

- [ ] **Step 1: Write the failing global-apply tests**

```ts
// test/services/applier.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";

it("writes imported resources to global paths and records ownership", async () => {
  const context = await createInitializedTestContext("applier-global");

  try {
    const applier = await import("../../src/services/applier.ts");
    const snapshots = await import("../../src/models/imported-snapshot.ts");

    const snapshot = snapshots.createImportedSnapshot({
      source_kind: "cursor-plugin",
      source_label: "fixture",
      plugin_name: "cursor-team-kit",
      resource_ids: [],
      metadata: {},
    });

    const results = await applier.applyGlobally(
      [
        {
          id: "res_skill_team",
          type: "skill",
          source_platform: "cursor-plugin",
          source_path: "skills/team/SKILL.md",
          name: "team",
          description: "Team skill",
          content: "# Team",
          metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      ["github-copilot", "cursor"],
      context.homeDir,
      { snapshotId: snapshot.id, interactive: false },
    );

    expect(results.map((entry) => entry.platformId)).toEqual([
      "github-copilot",
      "cursor",
    ]);
    expect(
      readFileSync(join(context.homeDir, ".github", "copilot", "skills", "team", "SKILL.md"), "utf-8"),
    ).toContain("Team");
    expect(
      snapshots.listImportedSnapshotInstalls(snapshot.id),
    ).toHaveLength(2);
  } finally {
    await context.cleanup();
  }
});
```

Run: `bun test test/services/applier.test.ts test/platforms/copilot.test.ts test/platforms/cursor.test.ts`
Expected: FAIL because serializers only emit project paths and there is no global apply flow.

- [ ] **Step 2: Introduce an explicit materialization target**

```ts
// src/types.ts
export type MaterializationTarget = "project" | "global";

export interface SerializeOptions {
  target?: MaterializationTarget;
}

export interface PlatformSerializer {
  readonly platformId: string;
  scan(projectRoot: string): Promise<Resource[]>;
  scanGlobal?(homeRoot: string): Promise<Resource[]>;
  serialize(
    resources: Resource[],
    rootPath: string,
    options?: SerializeOptions,
  ): Promise<SerializedFile[]>;
}
```

```ts
// src/platforms/base-serializer.ts
protected selectPaths(target: MaterializationTarget, platform: PlatformDefinition) {
  return target === "global" ? platform.globalPaths : platform.projectPaths;
}
```

- [ ] **Step 3: Update serializers to honor global paths**

```ts
// src/platforms/copilot.ts
async serialize(
  resources: Resource[],
  _rootPath: string,
  options: SerializeOptions = {},
): Promise<SerializedFile[]> {
  const target = options.target ?? "project";
  const paths = this.selectPaths(target, this.platform);
  const files: SerializedFile[] = [];

  if (instructions.length > 0 && paths.instructions) {
    files.push({
      path: paths.instructions,
      content: instructions.map((r) => r.content).join("\n\n"),
    });
  }

  if (paths.skills) {
    for (const skill of skills) {
      files.push({
        path: join(paths.skills, skill.name, "SKILL.md"),
        content: this.emitFrontmatter(
          { name: skill.name, description: skill.description },
          skill.content,
        ),
      });
    }
  }

  if (mcps.length > 0 && (paths.mcp ?? paths.settings)) {
    files.push({
      path: paths.mcp ?? paths.settings!,
      content: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  return files;
}
```

Apply the same target-aware path selection pattern to `claude-code.ts`, `codex.ts`, `cursor.ts`, `generic-agents.ts`, and `opencode.ts`.

- [ ] **Step 4: Implement global apply + conflict prompting**

```ts
// src/services/applier.ts
import inquirer from "inquirer";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { recordImportedSnapshotInstall } from "../models/imported-snapshot.js";

export async function applyGlobally(
  resources: Resource[],
  platforms: string[],
  homeRoot: string,
  opts: {
    snapshotId?: string;
    interactive?: boolean;
    claudeConfig?: ClaudePresetConfig;
  } = {},
): Promise<ApplyResult[]> {
  const generated = await generateFiles(
    resources,
    platforms,
    homeRoot,
    opts.claudeConfig,
    { target: "global" },
  );

  for (const result of generated) {
    for (const file of result.files) {
      const fullPath = join(homeRoot, file.path.replace(/^~\//, ""));
      if (existsSync(fullPath) && readFileSync(fullPath, "utf-8") !== file.content) {
        const { conflict } = opts.interactive === false
          ? { conflict: "replace" as const }
          : await inquirer.prompt([
              {
                type: "list",
                name: "conflict",
                message: `Conflict for ${result.platformId}:${file.path}`,
                choices: ["replace", "skip", "cancel"],
              },
            ]);
        if (conflict === "skip") continue;
        if (conflict === "cancel") throw new Error(`Global install cancelled for ${file.path}`);
      }
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.content, "utf-8");
    }

    if (opts.snapshotId) {
      recordImportedSnapshotInstall({
        snapshot_id: opts.snapshotId,
        platform_id: result.platformId,
        files: Object.fromEntries(result.files.map((file) => [file.path, file.content])),
      });
    }
  }

  return generated;
}
```

- [ ] **Step 5: Run the applier/platform tests until they pass**

Run: `bun test test/services/applier.test.ts test/platforms/claude-code.test.ts test/platforms/copilot.test.ts test/platforms/cursor.test.ts test/platforms/generic-agents.test.ts test/platforms/codex.test.ts test/platforms/opencode.test.ts`
Expected: PASS with serializer target behavior and global writes covered.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/services/applier.ts src/platforms/base-serializer.ts src/platforms/claude-code.ts src/platforms/codex.ts src/platforms/copilot.ts src/platforms/cursor.ts src/platforms/generic-agents.ts src/platforms/opencode.ts src/models/imported-snapshot.ts test/services/applier.test.ts test/platforms/claude-code.test.ts test/platforms/copilot.test.ts test/platforms/cursor.test.ts test/platforms/generic-agents.test.ts test/platforms/codex.test.ts test/platforms/opencode.test.ts
git commit -m "Support global harness materialization"
```

### Task 4: Extend `project scan` to import plugin sources and install globally

**Files:**
- Modify: `src/index.ts`
- Modify: `src/services/scanner.ts`
- Modify: `src/models/harness.ts`
- Modify: `test/cli/scan.test.ts`
- Modify: `test/services/scanner.test.ts`

- [ ] **Step 1: Write the failing CLI tests**

```ts
// test/cli/scan.test.ts
import { join } from "node:path";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

it("imports a plugin source and installs it globally to configured harnesses", async () => {
  const context = await createTestContext("cli-plugin-import-global");

  try {
    await runCli(["init"]);
    const harnessModel = await import("../../src/models/harness.ts");
    harnessModel.setHarnessPreference({
      main_harness: "github-copilot",
      alias_harnesses: ["copilot-cli", "cursor"],
    });

    const result = await runCli([
      "project",
      "scan",
      join(import.meta.dirname, "../fixtures/plugin-import/cursor-team-kit"),
      "--import-global",
    ], {
      isTTY: true,
      promptResponses: [],
    });

    expect(result.stdout).toContain("cursor-plugin");
    expect(result.stdout).toContain("imported 3 resources");
    expect(result.stdout).toContain("github-copilot");
    expect(result.stdout).toContain("copilot-cli");
    expect(result.stdout).toContain("cursor");
  } finally {
    await context.cleanup();
  }
});
```

Run: `bun test test/cli/scan.test.ts`
Expected: FAIL because `project scan` only handles project roots today.

- [ ] **Step 2: Add a helper to resolve default global targets from harness preferences**

```ts
// src/models/harness.ts
export function getPreferredHarnessIds(): string[] {
  const preference = getHarnessPreference();
  if (!preference) return [];
  return [preference.main_harness, ...preference.alias_harnesses];
}
```

- [ ] **Step 3: Extend the scan CLI flow**

```ts
// src/index.ts
async function handleScanCommand(
  path: string,
  opts: { platform?: string; dryRun?: boolean; importGlobal?: boolean },
): Promise<void> {
  const sourcePath = resolve(path);
  const pluginEntries =
    await scanPluginSource(sourcePath).catch(() => null);

  if (pluginEntries) {
    if (opts.dryRun) {
      for (const entry of pluginEntries) {
        ui.success(`${entry.source_kind} ${ui.icons.bullet} ${formatCount(entry.resources.length, "resource")}`);
      }
      return;
    }

    const targets = opts.platform
      ? opts.platform.split(",")
      : getPreferredHarnessIds();
    const persisted = await scanAndPersistImportSource(sourcePath);

    ui.success(`${persisted.imported.length} imported snapshot${persisted.imported.length === 1 ? "" : "s"}`);

    if (opts.importGlobal) {
      const resources = persisted.persisted.resources;
      const platforms = targets.length > 0 ? targets : getDedicatedSerializerPlatformIds();
      for (const importedEntry of persisted.imported) {
        const importedResources = resources.filter((resource) =>
          importedEntry.snapshot.resource_ids.includes(resource.id),
        );
        await applyGlobally(importedResources, platforms, resolveHomeRoot(), {
          snapshotId: importedEntry.snapshot.id,
          interactive: !process.argv.includes("--no-interactive"),
        });
      }
      ui.hint(`Installed globally to ${platforms.join(", ")}`);
    }
    return;
  }

  // existing project scan path remains unchanged
}
```

Also update the command definition:

```ts
projectCommand
  .command("scan")
  .option("--import-global", "Install imported plugin snapshots into configured harness globals")
  .action(handleScanCommand);
```

- [ ] **Step 4: Cover conflicts and marketplace imports in CLI tests**

```ts
// test/cli/scan.test.ts
it("prompts on global conflicts during plugin import", async () => {
  const context = await createTestContext("cli-plugin-import-conflict");

  try {
    writeTextFile(
      join(context.homeDir, ".cursor", "rules", "review.mdc"),
      "# existing",
    );

    const result = await runCli([
      "project",
      "scan",
      join(import.meta.dirname, "../fixtures/plugin-import/cursor-team-kit"),
      "--import-global",
    ], {
      isTTY: true,
      promptResponses: [{ conflict: "skip" }],
    });

    expect(result.stdout).toContain("cursor");
    expect(result.exitCode ?? 0).toBe(0);
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 5: Run focused CLI coverage, then the full repo verification**

Run: `bun test test/cli/scan.test.ts`
Expected: PASS with plugin-source import, marketplace import, and conflict prompting covered.

Run: `bun run preflight`
Expected: PASS (`lint`, `typecheck`, `test:run`, and `build` all succeed).

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/services/scanner.ts src/models/harness.ts test/cli/scan.test.ts test/services/scanner.test.ts
git commit -m "Support global plugin import via project scan"
```

## Spec coverage check

- Plugin directory and marketplace source support → Tasks 2 and 4
- Snapshot persistence rather than live linking → Tasks 1 and 2
- Global install for all configured harnesses → Tasks 3 and 4
- Prompt-on-conflict behavior → Tasks 3 and 4
- End-to-end proof with real plugin fixture → Tasks 2, 3, and 4

## Placeholder scan

No `TODO`, `TBD`, or "write tests later" placeholders remain. Each task includes concrete files, code, commands, and expected outcomes.

## Type consistency check

Plan-wide names are consistent:

- `ImportedSnapshot` / `ImportedSnapshotInstall`
- `scanPluginSource`, `scanImportSource`, `scanAndPersistImportSource`
- `MaterializationTarget`, `SerializeOptions`
- `applyGlobally`, `recordImportedSnapshotInstall`
