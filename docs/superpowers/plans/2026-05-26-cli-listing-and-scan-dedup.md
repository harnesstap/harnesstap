# CLI Listing and Scan De-duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split preset version into its own column, hide list-table IDs unless `--show-id` is passed, and stop project scans from generating synthetic duplicate shared-instruction rows while adding `.harnessdeckignore` support for project-derived scan flows.

**Architecture:** Keep the CLI output changes inside `src/index.ts`, using a small shared helper for opt-in ID columns so human-mode tables stay consistent without changing JSON output. Keep scan behavior changes centered in `src/services/scanner.ts`, with one focused ignore helper for gitignore-style path matching and one normalization pass that canonicalizes overlapping shared instruction sources before persistence. Let `preset from-project` inherit the new scan behavior by continuing to call `scanAndPersist`.

**Tech Stack:** TypeScript, Bun test runner, Commander, cli-table3, picomatch, better-sqlite3-backed models

---

### Task 1: Update human-mode preset/resource tables and add `--show-id`

**Files:**
- Modify: `src/index.ts:963-1039`
- Modify: `src/index.ts:2098-2123`
- Modify: `src/index.ts:2501-2569`
- Test: `test/cli/preset.test.ts:24-67`
- Test: `test/cli/preset.test.ts:290-396`
- Test: `test/cli/resource.test.ts:65-100`
- Test: `test/cli/resource.test.ts:195-231`

- [ ] **Step 1: Write the failing CLI tests for the new table behavior**

Add or replace tests so they assert the new preset/resource output contract before any production changes. Use the existing `runCli`, `createTestContext`, and `makeResourceInput` helpers.

```ts
it("preset list shows separate name and version columns", async () => {
  const context = await createTestContext("cli-preset-list-columns");
  try {
    await runCli(["init"]);
    await runCli(["preset", "create", "team-stack", "--version", "1.0.0"]);
    await runCli(["preset", "create", "team-stack", "--version", "2.0.0"]);

    const listResult = await runCli(["preset", "list"]);

    expect(listResult.stdout).toContain("NAME");
    expect(listResult.stdout).toContain("VERSION");
    expect(listResult.stdout).toContain("DESCRIPTION");
    expect(listResult.stdout).not.toContain("team-stack@1.0.0");
    expect(listResult.stdout).not.toContain("team-stack@2.0.0");
    expect(listResult.stdout).toMatch(/team-stack\s+1\.0\.0/);
    expect(listResult.stdout).toMatch(/team-stack\s+2\.0\.0/);
  } finally {
    await context.cleanup();
  }
});

it("preset show hides resource IDs by default and reveals them with --show-id", async () => {
  const context = await createTestContext("cli-preset-show-ids");
  try {
    await runCli(["init"]);
    const resourceModel = await import("../../src/models/resource.ts");
    const resource = resourceModel.createResource(
      makeResourceInput({
        type: "skill",
        name: "shared-skill",
        description: "Shared helper",
        content: "# Shared",
      }),
    );

    await runCli(["preset", "create", "team"]);
    await runCli(["preset", "add", "team", resource.id, "--type", "skill"]);

    const hidden = await runCli(["preset", "show", "team"]);
    const shown = await runCli(["preset", "show", "team", "--show-id"]);

    expect(hidden.stdout).toContain("RESOURCES");
    expect(hidden.stdout).not.toContain("│ ID ");
    expect(hidden.stdout).not.toContain(resource.id.slice(0, 6));
    expect(shown.stdout).toContain("│ ID ");
    expect(shown.stdout).toContain(resource.id.slice(0, 6));
  } finally {
    await context.cleanup();
  }
});

it("resource list hides IDs by default and reveals them with --show-id", async () => {
  const context = await createTestContext("cli-resource-show-id-flag");
  try {
    await runCli(["init"]);
    const resourceModel = await import("../../src/models/resource.ts");
    const resource = resourceModel.createResource(
      makeResourceInput({
        type: "skill",
        name: "openapi-mcp-baseline",
        description: "OpenAPI MCP baseline",
        content: "# OpenAPI MCP Baseline",
      }),
    );

    const hidden = await runCli(["resource", "list"]);
    const shown = await runCli(["resource", "list", "--show-id"]);

    expect(hidden.stdout).not.toContain("│ ID ");
    expect(hidden.stdout).not.toContain(resource.id.slice(0, 6));
    expect(shown.stdout).toContain("│ ID ");
    expect(shown.stdout).toContain(resource.id.slice(0, 6));
  } finally {
    await context.cleanup();
  }
});

it("resource ambiguity table hides IDs by default and reveals them with --show-id", async () => {
  const context = await createTestContext("cli-resource-ambiguous-show-id");
  try {
    await runCli(["init"]);
    const resourceModel = await import("../../src/models/resource.ts");
    resourceModel.createResource(makeResourceInput({ type: "skill", name: "duplicate-name" }));
    resourceModel.createResource(makeResourceInput({ type: "rule", name: "duplicate-name" }));

    const hidden = await runCli(["resource", "show", "duplicate-name"]);
    const shown = await runCli(["resource", "show", "duplicate-name", "--show-id"]);

    expect(hidden.stdout).toContain("TYPE");
    expect(hidden.stdout).toContain("NAME");
    expect(hidden.stdout).not.toContain("ID");
    expect(shown.stdout).toContain("ID");
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the preset/resource CLI tests to verify they fail for the expected reason**

Run:

```bash
bun test test/cli/preset.test.ts test/cli/resource.test.ts
```

Expected: FAIL because the current human-mode output still renders `name@version`, still includes list-table IDs by default, and does not accept `--show-id`.

- [ ] **Step 3: Implement the minimal `src/index.ts` changes**

Add one small helper for the repeated ID column logic, thread `showId` through the relevant commands, and switch preset list rows from a synthetic `label` field back to the stored `name` + `version`.

```ts
function makeIdColumn(showId: boolean, width = 12) {
  return showId
    ? [{
        key: "id",
        header: "ID",
        width,
        transform: (value: string) => ui.format.shortenId(String(value)),
      }]
    : [];
}

function handlePresetShowCommand(
  name: string,
  opts: { format?: string; showId?: boolean },
): void {
  // ...
  ui.table.print({
    columns: [
      { key: "type", header: "TYPE", width: 14 },
      { key: "name", header: "NAME", width: 26 },
      ...makeIdColumn(Boolean(opts.showId)),
    ],
    rows: resources,
    empty: "No resources in this preset.",
  });
}

presetCmd
  .command("list")
  .alias("ls")
  .option("--show-id", "Include ID column in the human-mode table")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { format?: string; showId?: boolean }) => {
    // ...
    ui.table.print({
      columns: [
        { key: "name", header: "NAME", width: 26 },
        { key: "version", header: "VERSION", width: 12 },
        ...makeIdColumn(Boolean(opts.showId)),
        {
          key: "description",
          header: "DESCRIPTION",
          width: 44,
          transform: (value) => value || "—",
        },
      ],
      rows: presets,
      summary: `${presets.length} presets ${ui.icons.bullet} run \`${formatCommand("preset show <name>")}\` for details`,
      empty: "No presets found.",
    });
  });

resourceCmd
  .command("list")
  .alias("ls")
  .option("--show-id", "Include ID column in the human-mode table")
  .option("--format <mode>", "Output format: human or json", "human")
  .action((opts: { type?: string; search?: string; format?: string; showId?: boolean }) => {
    // ...
    ui.table.print({
      columns: [
        { key: "type", header: "TYPE", width: 14 },
        { key: "name", header: "NAME", width: 28 },
        ...makeIdColumn(Boolean(opts.showId)),
        {
          key: "updated_at",
          header: "UPDATED",
          width: 16,
          transform: (value) => ui.format.formatRelativeTime(String(value)),
        },
      ],
      rows: resources,
      summary: resources.length === 0 ? undefined : `${resources.length} resources`,
      empty: `No resources found.\n  → Run \`${formatCommand("project scan")}\` to import some.`,
    });
  });
```

- [ ] **Step 4: Run the focused CLI tests again**

Run:

```bash
bun test test/cli/preset.test.ts test/cli/resource.test.ts
```

Expected: PASS. The human-mode table tests should now show separate preset versions and hide IDs unless `--show-id` is passed, while JSON tests remain untouched.

- [ ] **Step 5: Commit the table-output slice**

```bash
git add src/index.ts test/cli/preset.test.ts test/cli/resource.test.ts
git commit -m "feat: streamline CLI list table output"
```

### Task 2: Canonicalize shared instruction imports and clean up stale synthetic duplicates

**Files:**
- Modify: `src/services/scanner.ts:99-243`
- Test: `test/services/scanner.test.ts:1-151`
- Test: `test/cli/scan.test.ts:1-60`

- [ ] **Step 1: Write failing tests for overlapping `AGENTS.md` imports and stale duplicate cleanup**

Extend scanner coverage with one unit test for in-memory normalization and one CLI-facing test for the persisted DB outcome.

```ts
it("collapses overlapping AGENTS.md instructions into one canonical imported resource", async () => {
  const context = await createInitializedTestContext("scanner-shared-agents");
  try {
    writeTextFile(`${context.projectDir}/AGENTS.md`, "# Shared agents instructions");

    const scanner = await import("../../src/services/scanner.ts");
    const resourceModel = await import("../../src/models/resource.ts");

    const resources = await scanner.scanAndPersist(context.projectDir);
    const instructions = resources.filter((resource) => resource.type === "instruction");

    expect(instructions).toHaveLength(1);
    expect(instructions[0]?.name).toBe("agents-instructions");
    expect(instructions[0]?.source).toBe("AGENTS.md");
    expect(
      resourceModel.listResources().filter((resource) => resource.source === "AGENTS.md"),
    ).toHaveLength(1);
  } finally {
    await context.cleanup();
  }
});

it("removes stale synthetic AGENTS.md duplicates on a rescan", async () => {
  const context = await createTestContext("cli-scan-shared-agents-cleanup");
  try {
    initGitRepo(context.projectDir);
    writeTextFile(`${context.projectDir}/AGENTS.md`, "# Shared agents instructions");

    await runCli(["init"]);
    const resourceModel = await import("../../src/models/resource.ts");
    const { makeResourceInput } = await import("../helpers/resources.ts");

    resourceModel.createResource(
      makeResourceInput({
        type: "instruction",
        name: "kode-instructions",
        content: "# Shared agents instructions",
        source: "AGENTS.md",
      }),
    );
    resourceModel.createResource(
      makeResourceInput({
        type: "instruction",
        name: "codex-instructions",
        content: "# Shared agents instructions",
        source: "AGENTS.md",
      }),
    );

    await runCli(["project", "scan", context.projectDir]);

    const names = resourceModel
      .listResources()
      .filter((resource) => resource.source === "AGENTS.md")
      .map((resource) => resource.name);

    expect(names).toEqual(["agents-instructions"]);
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the scanner and CLI scan tests to verify they fail**

Run:

```bash
bun test test/services/scanner.test.ts test/cli/scan.test.ts
```

Expected: FAIL because `scanAndPersist()` currently persists every per-platform synthetic instruction row from the same `AGENTS.md`, and there is no cleanup pass for existing duplicates.

- [ ] **Step 3: Implement the normalization and cleanup pass in `src/services/scanner.ts`**

Add a narrow canonicalization pass for overlapping shared instruction sources and a conservative cleanup step before persisting new project-scan results.

```ts
const SHARED_PROJECT_INSTRUCTION_NAMES = new Map<string, string>([
  ["AGENTS.md", "agents-instructions"],
]);

function canonicalInstructionNameForSource(source: string): string | undefined {
  return SHARED_PROJECT_INSTRUCTION_NAMES.get(source);
}

function normalizeProjectScanResults(results: ScanResult[]): ScanResult[] {
  const seenSharedSources = new Set<string>();

  return results.map((result) => ({
    ...result,
    resources: result.resources.flatMap((resource) => {
      const canonicalName =
        resource.type === "instruction"
          ? canonicalInstructionNameForSource(resource.source)
          : undefined;

      if (!canonicalName) {
        return [resource];
      }

      if (seenSharedSources.has(resource.source)) {
        return [];
      }

      seenSharedSources.add(resource.source);
      return [{ ...resource, name: canonicalName }];
    }),
  }));
}

function cleanupSharedInstructionDuplicates(resources: Resource[]): void {
  const existing = listResources();

  for (const resource of resources) {
    if (resource.type !== "instruction") continue;
    const canonicalName = canonicalInstructionNameForSource(resource.source);
    if (!canonicalName) continue;

    for (const duplicate of existing) {
      if (duplicate.type !== "instruction") continue;
      if (duplicate.source !== resource.source) continue;
      if (duplicate.content !== resource.content) continue;
      if (!duplicate.name.endsWith("-instructions")) continue;
      if (duplicate.name === canonicalName) continue;
      deleteResource(duplicate.id);
    }
  }
}

export async function scanAndPersist(
  projectRoot: string,
  platformFilter?: string,
): Promise<Resource[]> {
  const results = normalizeProjectScanResults(
    await scanProject(projectRoot, platformFilter),
  );
  const persisted = persistScanResults(results).resources;
  cleanupSharedInstructionDuplicates(persisted);
  return persisted;
}
```

- [ ] **Step 4: Run the focused scanner tests again**

Run:

```bash
bun test test/services/scanner.test.ts test/cli/scan.test.ts
```

Expected: PASS. A single `AGENTS.md` import should yield one canonical `agents-instructions` resource, and a rescan should remove existing synthetic duplicates with matching content.

- [ ] **Step 5: Commit the scanner de-duplication slice**

```bash
git add src/services/scanner.ts test/services/scanner.test.ts test/cli/scan.test.ts
git commit -m "fix: dedupe shared instruction scan imports"
```

### Task 3: Add `.harnessdeckignore` support for project-derived scan flows

**Files:**
- Create: `src/services/scanner-ignore.ts`
- Modify: `src/services/scanner.ts:99-243`
- Test: `test/services/scanner.test.ts:1-151`
- Test: `test/cli/planned-scenarios.test.ts:9-115`
- Test: `test/services/planned-scenarios.test.ts:166-190`

- [ ] **Step 1: Write the failing ignore-file tests**

Add one scanner-level test for pattern matching and one end-to-end `preset from-project` test to prove the ignored resource never lands in the created preset.

```ts
it("respects .harnessdeckignore patterns and ! re-inclusion", async () => {
  const context = await createInitializedTestContext("scanner-ignore");
  try {
    writeTextFile(`${context.projectDir}/AGENTS.md`, "# Ignore me");
    writeTextFile(
      `${context.projectDir}/.agents/skills/private-helper/SKILL.md`,
      "---\nname: private-helper\ndescription: Private helper\n---\n# Private helper\n",
    );
    writeTextFile(
      `${context.projectDir}/.agents/skills/shared-helper/SKILL.md`,
      "---\nname: shared-helper\ndescription: Shared helper\n---\n# Shared helper\n",
    );
    writeTextFile(
      `${context.projectDir}/.harnessdeckignore`,
      "AGENTS.md\n.agents/skills/*\n!.agents/skills/shared-helper/SKILL.md\n",
    );

    const scanner = await import("../../src/services/scanner.ts");
    const resources = await scanner.scanAndPersist(context.projectDir);

    expect(resources.some((resource) => resource.source === "AGENTS.md")).toBe(false);
    expect(resources.some((resource) => resource.name === "private-helper")).toBe(false);
    expect(resources.some((resource) => resource.name === "shared-helper")).toBe(true);
  } finally {
    await context.cleanup();
  }
});

it("preset from-project excludes ignored resources", async () => {
  const context = await createTestContext("cli-from-project-ignore");
  try {
    await runCli(["init"]);
    mkdirSync(join(context.projectDir, ".claude"), { recursive: true });
    writeFileSync(join(context.projectDir, "CLAUDE.md"), "# Keep me\n", "utf-8");
    writeFileSync(join(context.projectDir, "AGENTS.md"), "# Ignore me\n", "utf-8");
    writeFileSync(join(context.projectDir, ".harnessdeckignore"), "AGENTS.md\n", "utf-8");

    const result = await runCli([
      "preset",
      "from-project",
      "cli-inferred",
      "--project",
      context.projectDir,
    ]);

    expect(result.stdout).toContain("cli-inferred");

    const presetModel = await import("../../src/models/preset.ts");
    const preset = presetModel.getPreset("cli-inferred");
    if (!preset) throw new Error("Expected cli-inferred preset");

    const resources = presetModel.getPresetResources(preset.id);
    expect(resources.some((resource) => resource.source === "AGENTS.md")).toBe(false);
    expect(resources.some((resource) => resource.source === "CLAUDE.md")).toBe(true);
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the ignore-related tests to verify they fail**

Run:

```bash
bun test test/services/scanner.test.ts test/cli/planned-scenarios.test.ts test/services/planned-scenarios.test.ts
```

Expected: FAIL because the current scanner has no `.harnessdeckignore` parser, no picomatch-based filtering step, and `preset from-project` imports everything returned by `scanAndPersist()`.

- [ ] **Step 3: Implement the ignore helper and wire it into project scans**

Create a dedicated helper that parses `.harnessdeckignore` once and exposes a simple matcher for relative scan-source paths, then apply it during the project-scan normalization pass before persistence.

```ts
// src/services/scanner-ignore.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import picomatch from "picomatch";

export interface ScanIgnoreMatcher {
  ignores(source: string): boolean;
}

export function loadScanIgnore(projectRoot: string): ScanIgnoreMatcher {
  const ignorePath = join(projectRoot, ".harnessdeckignore");
  if (!existsSync(ignorePath)) {
    return { ignores: () => false };
  }

  const rules = readFileSync(ignorePath, "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => ({
      include: line.startsWith("!"),
      match: picomatch(line.startsWith("!") ? line.slice(1) : line),
    }));

  return {
    ignores(source: string): boolean {
      let ignored = false;
      for (const rule of rules) {
        if (!rule.match(source)) continue;
        ignored = !rule.include;
      }
      return ignored;
    },
  };
}
```

Then apply it inside `src/services/scanner.ts`:

```ts
import { loadScanIgnore } from "./scanner-ignore.js";

function normalizeProjectScanResults(
  projectRoot: string,
  results: ScanResult[],
): ScanResult[] {
  const ignore = loadScanIgnore(projectRoot);
  const seenSharedSources = new Set<string>();

  return results.map((result) => ({
    ...result,
    resources: result.resources.flatMap((resource) => {
      if (ignore.ignores(resource.source)) {
        return [];
      }

      const canonicalName =
        resource.type === "instruction"
          ? canonicalInstructionNameForSource(resource.source)
          : undefined;

      if (!canonicalName) {
        return [resource];
      }

      if (seenSharedSources.has(resource.source)) {
        return [];
      }

      seenSharedSources.add(resource.source);
      return [{ ...resource, name: canonicalName }];
    }),
  }));
}

export async function scanAndPersist(
  projectRoot: string,
  platformFilter?: string,
): Promise<Resource[]> {
  const results = normalizeProjectScanResults(
    projectRoot,
    await scanProject(projectRoot, platformFilter),
  );
  const persisted = persistScanResults(results);
  cleanupSharedInstructionDuplicates(persisted.resources);
  return persisted.resources;
}
```

- [ ] **Step 4: Run the scanner and preset-from-project tests again**

Run:

```bash
bun test test/services/scanner.test.ts test/cli/planned-scenarios.test.ts test/services/planned-scenarios.test.ts
```

Expected: PASS. The scanner should honor `.harnessdeckignore`, `!` re-inclusion should work, and `preset from-project` should inherit the filtered resource set without any behavior change to its JSON or wizard surfaces.

- [ ] **Step 5: Commit the ignore-flow slice**

```bash
git add src/services/scanner-ignore.ts src/services/scanner.ts test/services/scanner.test.ts test/cli/planned-scenarios.test.ts test/services/planned-scenarios.test.ts
git commit -m "feat: honor .harnessdeckignore during project scans"
```

### Task 4: Run full verification and reconcile any integration fallout

**Files:**
- Modify: only the files touched in Tasks 1-3 if the verification run exposes integration mismatches

- [ ] **Step 1: Run the full targeted CLI/service suite for the changed surface**

Run:

```bash
bun test test/cli/preset.test.ts test/cli/resource.test.ts test/cli/scan.test.ts test/cli/planned-scenarios.test.ts test/services/scanner.test.ts test/services/planned-scenarios.test.ts
```

Expected: PASS. This catches integration mismatches across CLI rendering, project scan persistence, and preset-from-project reuse.

- [ ] **Step 2: Run the repository preflight**

Run:

```bash
bun run preflight
```

Expected: PASS with lint, typecheck, tests, and build all green.

- [ ] **Step 3: If preflight exposes fallout, fix the smallest failing surface and re-run the exact failing command first**

Use the same TDD loop:

```bash
bun test <failing-test-file>
# make the smallest code change
bun test <failing-test-file>
bun run preflight
```

Expected: the focused fix goes green before the full preflight is re-run.

- [ ] **Step 4: Commit the final integrated result**

```bash
git add src/index.ts src/services/scanner.ts src/services/scanner-ignore.ts test/cli/preset.test.ts test/cli/resource.test.ts test/cli/scan.test.ts test/cli/planned-scenarios.test.ts test/services/scanner.test.ts test/services/planned-scenarios.test.ts
git commit -m "feat: streamline CLI listings and project scan imports"
```
