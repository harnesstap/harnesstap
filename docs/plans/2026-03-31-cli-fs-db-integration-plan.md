# CLI, filesystem, and database integration test implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Add a dedicated integration suite that drives real `skilldeck` CLI
commands and verifies generated files plus persisted SQLite state for the main
spec workflows.

**Architecture:** Keep the existing `test/cli` smoke tests intact and add a new
`test/integration` layer for multi-command scenarios. Reuse the current temp
HOME, temp project, git fixture, and CLI harness helpers where possible, then
add only the small helper surface needed to keep database and filesystem
assertions readable.

**Tech Stack:** TypeScript, Vitest, Commander, better-sqlite3, SQLite, git
fixtures, temporary filesystem helpers

---

### Task 1: Add reusable integration helpers

**Files:**
- Create: `test/helpers/integration.ts`
- Modify: `test/helpers/db.ts`
- Test: `test/helpers/db.test.ts`

**Step 1: Write the failing helper test**

Add one focused test in `test/helpers/db.test.ts` that proves a helper can:

```ts
const context = await createTestContext("integration-helper");
expect(context.projectDir).toContain("integration-helper");
expect(context.homeDir).toContain("integration-helper");
```

Then extend it with the integration helper contract:

```ts
const models = await loadModels();
expect(typeof models.resource.listResources).toBe("function");
expect(typeof models.project.getProjectPresets).toBe("function");
```

**Step 2: Run the helper test to verify it fails**

Run:

```bash
npm run test:run -- test/helpers/db.test.ts
```

Expected: FAIL because `loadModels()` or the new integration helper surface
does not exist yet.

**Step 3: Write the minimal helper implementation**

Create `test/helpers/integration.ts` with a tiny API that centralizes model
imports and common assertions:

```ts
export async function loadModels() {
  return {
    resource: await import("../../src/models/resource.ts"),
    preset: await import("../../src/models/preset.ts"),
    project: await import("../../src/models/project.ts"),
    snapshot: await import("../../src/models/snapshot.ts"),
  };
}
```

If needed, update `test/helpers/db.ts` to expose any missing context fields in
one place instead of duplicating imports in every integration test.

**Step 4: Run the helper test to verify it passes**

Run:

```bash
npm run test:run -- test/helpers/db.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add test/helpers/integration.ts test/helpers/db.ts test/helpers/db.test.ts
git commit -m "test: add integration test helpers"
```

### Task 2: Add cross-platform sync integration coverage

**Files:**
- Create: `test/integration/cross-platform-sync.test.ts`
- Test: `test/helpers/integration.ts`
- Test: `test/fixtures/generic-project/AGENTS.md`
- Test: `test/fixtures/generic-project/.agents/skills/research/SKILL.md`

**Step 1: Write the failing cross-platform integration test**

Create a scenario that:

1. Creates an isolated test context.
2. Seeds a git repo with generic GitHub Copilot-style content:

```ts
writeTextFile(`${context.projectDir}/AGENTS.md`, "# Shared instructions");
writeTextFile(
  `${context.projectDir}/.agents/skills/research/SKILL.md`,
  "---\nname: research\ndescription: Research helper\n---\n# Research\n",
);
```

3. Runs:

```ts
await runCli(["init"]);
await runCli(["scan", context.projectDir, "--platform", "github-copilot"]);
await runCli(["preset", "create", "shared-sync"]);
```

4. Loads resources from the database, adds them to the preset, then runs:

```ts
await runCli([
  "apply",
  "shared-sync",
  "--project",
  context.projectDir,
  "--platform",
  "claude-code,cursor,opencode,codex",
]);
```

5. Asserts:

```ts
expect(existsSync(`${context.projectDir}/CLAUDE.md`)).toBe(true);
expect(existsSync(`${context.projectDir}/.cursor/rules/research.mdc`)).toBe(true);
expect(existsSync(`${context.projectDir}/.opencode/AGENTS.md`)).toBe(true);
expect(existsSync(`${context.projectDir}/.codex/agents`)).toBe(true);
```

6. Verifies DB state:

```ts
expect(project.getProjectByOrigin(normalizeGitUrl(remote))).toBeDefined();
expect(project.getProjectPresets(projectId)[0]?.platforms).toEqual([
  "claude-code",
  "cursor",
  "opencode",
  "codex",
]);
expect(snapshot.listSnapshots(projectId).length).toBeGreaterThan(0);
```

**Step 2: Run the new test to verify it fails**

Run:

```bash
npm run test:run -- test/integration/cross-platform-sync.test.ts
```

Expected: FAIL because the new scenario file does not exist yet or because one
or more path and state assertions are not wired correctly.

**Step 3: Implement the minimal scenario helpers and assertions**

Use `loadModels()` and the existing git helper so the test stays readable. If
the exact `opencode` project path differs from the assumption above, use the
registry-defined path and update the assertion to the real emitted file.

**Step 4: Run the cross-platform test to verify it passes**

Run:

```bash
npm run test:run -- test/integration/cross-platform-sync.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add test/integration/cross-platform-sync.test.ts test/helpers/integration.ts
git commit -m "test: cover cross-platform sync integration"
```

### Task 3: Add listing and preset lifecycle integration coverage

**Files:**
- Create: `test/integration/listing-and-preset-lifecycle.test.ts`
- Test: `test/integration/cross-platform-sync.test.ts`

**Step 1: Write the failing lifecycle integration test**

Create a scenario that scans a seeded project, creates a preset, adds imported
resources, removes one resource, then runs:

```ts
const presets = await runCli(["preset", "list"]);
const shown = await runCli(["preset", "show", "shared-sync"]);
const resources = await runCli(["resource", "list"]);
const status = await runCli(["status", context.projectDir]);
```

Assert:

```ts
expect(presets.stdout).toContain("shared-sync");
expect(shown.stdout).toContain("research");
expect(resources.stdout).toContain("instruction");
expect(status.stdout).toContain("Applied presets:");
```

Then verify:

```ts
expect(preset.getPreset("shared-sync")).toBeDefined();
expect(preset.getPresetResources(presetId)).toHaveLength(expectedCount);
```

**Step 2: Run the lifecycle test to verify it fails**

Run:

```bash
npm run test:run -- test/integration/listing-and-preset-lifecycle.test.ts
```

Expected: FAIL until the scenario is wired to real imported resource IDs and
expected counts.

**Step 3: Implement the minimal test logic**

Keep the test focused on list, show, add, remove, and status consistency. Do
not add export or revert here.

**Step 4: Run the lifecycle test to verify it passes**

Run:

```bash
npm run test:run -- test/integration/listing-and-preset-lifecycle.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add test/integration/listing-and-preset-lifecycle.test.ts
git commit -m "test: cover listing and preset lifecycle integration"
```

### Task 4: Add export and import round-trip integration coverage

**Files:**
- Create: `test/integration/export-import-roundtrip.test.ts`
- Test: `test/helpers/integration.ts`

**Step 1: Write the failing export/import integration test**

Create two isolated test contexts. In the first context:

1. Seed a preset with scanned resources.
2. Run:

```ts
await runCli(["export", "shared-sync", "--file", bundlePath]);
```

In the second context:

1. Run:

```ts
await runCli(["init"]);
await runCli(["import", bundlePath]);
```

2. Assert CLI output and DB state:

```ts
expect(importResult.stdout).toContain('Imported preset "shared-sync"');
expect(preset.getPreset("shared-sync")).toBeDefined();
expect(resource.listResources().length).toBeGreaterThan(0);
```

3. Apply the imported preset and assert generated files exist.

**Step 2: Run the round-trip test to verify it fails**

Run:

```bash
npm run test:run -- test/integration/export-import-roundtrip.test.ts
```

Expected: FAIL until the bundle handoff and imported apply flow are fully
asserted.

**Step 3: Implement the minimal round-trip logic**

Use real bundle files on disk. Assert that imported resources do not depend on
the original context's local database IDs or `source` fields.

**Step 4: Run the round-trip test to verify it passes**

Run:

```bash
npm run test:run -- test/integration/export-import-roundtrip.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add test/integration/export-import-roundtrip.test.ts
git commit -m "test: cover export import roundtrip integration"
```

### Task 5: Add snapshot, history, and revert integration coverage

**Files:**
- Create: `test/integration/history-revert-roundtrip.test.ts`
- Test: `src/index.ts`

**Step 1: Write the failing history/revert integration test**

Create a tracked git project, build a preset from imported resources, run
`apply`, mutate one generated file, then run:

```ts
const history = await runCli(["history", "--project", context.projectDir]);
await runCli(["revert", snapshotId]);
```

Assert:

```ts
expect(history.stdout).toContain("Before applying: shared-sync");
expect(readFileSync(`${context.projectDir}/CLAUDE.md`, "utf-8")).toContain(
  "# Shared instructions",
);
expect(snapshot.listSnapshots(projectId)).toHaveLength(expectedCount);
```

**Step 2: Run the history/revert test to verify it fails**

Run:

```bash
npm run test:run -- test/integration/history-revert-roundtrip.test.ts
```

Expected: FAIL until the scenario captures the right snapshot ID and target file
paths.

**Step 3: Implement the minimal history/revert logic**

Reuse the project lookup and snapshot model helpers so the test stays readable.

**Step 4: Run the history/revert test to verify it passes**

Run:

```bash
npm run test:run -- test/integration/history-revert-roundtrip.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add test/integration/history-revert-roundtrip.test.ts
git commit -m "test: cover snapshot revert integration"
```

### Task 6: Add template and repeated-run integration coverage

**Files:**
- Create: `test/integration/template-and-rerun.test.ts`
- Test: `src/services/templates.ts`

**Step 1: Write the failing template and rerun integration test**

Create one scenario that:

1. Runs `init`.
2. Runs `template list`.
3. Runs:

```ts
await runCli([
  "template",
  "apply",
  "nextjs-fullstack",
  "--project",
  context.projectDir,
  "--platform",
  "codex",
]);
```

4. Re-runs either `scan` or `apply` against the same project.

Assert:

```ts
expect(templateList.stdout).toContain("nextjs-fullstack");
expect(existsSync(`${context.projectDir}/AGENTS.md`)).toBe(true);
expect(project.getProjectPresets(projectId).length).toBeGreaterThan(0);
```

If the current documented rerun behavior creates another snapshot, assert that
exact behavior instead of forcing a different contract.

**Step 2: Run the template/rerun test to verify it fails**

Run:

```bash
npm run test:run -- test/integration/template-and-rerun.test.ts
```

Expected: FAIL until the rerun expectations match the current implementation.

**Step 3: Implement the minimal template/rerun logic**

Keep this file focused on seeded templates and repeated-run persistence. Do not
add export/import checks here.

**Step 4: Run the template/rerun test to verify it passes**

Run:

```bash
npm run test:run -- test/integration/template-and-rerun.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add test/integration/template-and-rerun.test.ts
git commit -m "test: cover template and rerun integration"
```

### Task 7: Verify the full suite and clean up overlap

**Files:**
- Modify: `test/cli/*.test.ts`
- Create: `test/integration/*.test.ts`
- Test: `package.json`

**Step 1: Run only the new integration tests**

Run:

```bash
npm run test:run -- test/integration/*.test.ts
```

Expected: PASS.

**Step 2: Remove only redundant assertions if the new integration layer fully
replaces them**

If a smoke test becomes exact duplicate coverage, trim only the redundant parts.
Do not delete broad smoke coverage unless the integration file now owns the same
behavior more clearly.

**Step 3: Run the full suite**

Run:

```bash
npm run test:run
```

Expected: PASS.

**Step 4: Run the type-check and build**

Run:

```bash
npm run lint
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add test src
git commit -m "test: add CLI filesystem database integration coverage"
```
