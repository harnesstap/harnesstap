# CLI UX Consistency and Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `harnessdeck` predictable for humans, scripts, and AI by standardizing selectors, exposing reusable IDs, adding explicit `--format json` support to structured commands, and surfacing harness configuration through fully non-interactive CLI commands.

**Architecture:** Keep `src/index.ts` as the command-definition entrypoint, but extract shared output-format behavior into a small utility so list/show/status/history-style commands can share one contract. Reuse existing model and harness-selection services rather than inventing parallel logic: selector parity should live in model helpers, JSON formatting in utility helpers, and harness CLI commands should compose `resolveHarnessSelection`, `setHarnessPreference`, `setProjectHarnessConfig`, and `upsertProject`.

**Tech Stack:** TypeScript, Commander, better-sqlite3, Vitest, Bun, tsup

---

## File Structure

- Modify: `src/index.ts`
  - Add `--format` support to structured commands.
  - Normalize selector/help text for preset/resource/snapshot workflows.
  - Add a new `harness` command group with explicit argv-driven flows.
- Create: `src/utils/output-format.ts`
  - Parse and validate `--format human|json`.
  - Render stable JSON output without decorative prefixes.
- Modify: `src/models/resource.ts`
  - Reuse `resolveResource()` everywhere selector parity is needed.
- Modify: `src/models/preset.ts`
  - Add a helper that resolves resource selectors before preset association changes.
- Modify: `src/models/snapshot.ts`
  - Keep snapshot lookup explicit by full ID; no truncation helpers.
- Modify: `src/models/project.ts`
  - Reuse `upsertProject()` for project-scoped harness settings when a git-backed project is targeted.
- Modify: `src/services/harness-config.ts`
  - Reuse existing `nonInteractive` behavior and only extend it if command-level defaults need new option plumbing.
- Create: `test/cli/output-format.test.ts`
  - Cover JSON mode for list/show/status/history/apply-dry-run/init/platform commands.
- Create: `test/cli/harness.test.ts`
  - Cover global and project harness commands, non-interactive flags, and optional interactive mode.
- Modify: `test/cli/resource.test.ts`
  - Keep resource selector and ambiguity coverage aligned with JSON mode.
- Modify: `test/cli/preset.test.ts`
  - Add preset add/remove resource-selector parity coverage.
- Modify: `test/cli/history-revert.test.ts`
  - Assert full snapshot IDs in history output and reuse in revert.
- Modify: `test/cli/help-organization.test.ts`
  - Verify the new `harness` command group and updated help text.
- Modify: `README.md`
  - Document `--format json`, reusable IDs, and non-interactive harness workflows.

### Task 1: Add shared output-format plumbing and resource JSON coverage

**Files:**
- Create: `src/utils/output-format.ts`
- Modify: `src/index.ts`
- Modify: `test/cli/resource.test.ts`
- Test: `test/cli/resource.test.ts`

- [ ] **Step 1: Write the failing resource JSON tests**

```ts
it("emits JSON for resource list and show", async () => {
  const context = await createTestContext("cli-resource-json");
  try {
    await runCli(["init"]);
    const resourceModel = await import("../../src/models/resource.ts");
    const resource = resourceModel.createResource(
      makeResourceInput({
        type: "skill",
        name: "json-resource",
        description: "JSON resource",
        content: "# JSON Resource",
      }),
    );

    const list = await runCli(["resource", "list", "--format", "json"]);
    const show = await runCli(["resource", "show", resource.id, "--format", "json"]);

    expect(JSON.parse(list.stdout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: resource.id, name: "json-resource", type: "skill" }),
      ]),
    );
    expect(JSON.parse(show.stdout)).toEqual(
      expect.objectContaining({ id: resource.id, name: "json-resource", content: "# JSON Resource" }),
    );
  } finally {
    await context.cleanup();
  }
});

it("emits JSON ambiguity payloads for resource selectors", async () => {
  const context = await createTestContext("cli-resource-json-ambiguous");
  try {
    await runCli(["init"]);
    const resourceModel = await import("../../src/models/resource.ts");
    resourceModel.createResource(makeResourceInput({ type: "skill", name: "dup-name" }));
    resourceModel.createResource(makeResourceInput({ type: "rule", name: "dup-name" }));

    const result = await runCli(["resource", "show", "dup-name", "--format", "json"]);

    expect(JSON.parse(result.stdout)).toEqual(
      expect.objectContaining({
        error: "ambiguous_resource_name",
        input: "dup-name",
        matches: expect.arrayContaining([expect.objectContaining({ name: "dup-name" })]),
      }),
    );
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the targeted test command and confirm it fails for missing `--format` handling**

Run: `bun run test:run test/cli/resource.test.ts -t "emits JSON"`

Expected: FAIL with Commander rejecting the unknown `--format` flag or assertions failing because human output is returned.

- [ ] **Step 3: Add a shared output-format utility**

```ts
// src/utils/output-format.ts
export type OutputFormat = "human" | "json";

export function parseOutputFormat(format?: string): OutputFormat {
  if (!format || format === "human") return "human";
  if (format === "json") return "json";
  throw new Error(`Invalid format: ${format}. Valid: human, json`);
}

export function writeJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
```

- [ ] **Step 4: Wire resource commands to the helper with minimal JSON payloads**

```ts
resourceCmd
  .command("list")
  .option("--format <format>", "Output format: human or json", "human")
  .action((opts: { type?: string; search?: string; format?: string }) => {
    const format = parseOutputFormat(opts.format);
    const type = opts.type as ResourceType | undefined;
    const resources = listResources({ type, search: opts.search });
    if (format === "json") {
      writeJson(resources);
      return;
    }
    for (const resource of resources) {
      log.info(`${resource.id} ${resource.type.padEnd(14)} ${resource.name}`);
    }
  });

resourceCmd
  .command("show")
  .option("--format <format>", "Output format: human or json", "human")
  .action((resource: string, opts: { format?: string }) => {
    const format = parseOutputFormat(opts.format);
    const result = resolveResource(resource);
    if (result.status === "ambiguous" && format === "json") {
      writeJson({ error: "ambiguous_resource_name", input: resource, matches: result.matches });
      return;
    }
    if (result.status === "found" && format === "json") {
      writeJson(result.resource);
      return;
    }
    if (result.status === "not_found") {
      log.error(`Resource not found: ${resource}`);
      return;
    }
    for (const match of result.matches) {
      log.dim(`  ${match.id} ${match.type.padEnd(14)} ${match.name}`);
    }
  });
```

- [ ] **Step 5: Run the resource CLI tests and make sure they pass**

Run: `bun run test:run test/cli/resource.test.ts`

Expected: PASS with existing selector tests still green and the new JSON tests passing.

- [ ] **Step 6: Commit the resource-format slice**

```bash
git add src/utils/output-format.ts src/index.ts test/cli/resource.test.ts
git commit -m "feat: add resource json output mode"
```

### Task 2: Normalize preset resource selectors and snapshot ID reuse

**Files:**
- Modify: `src/index.ts`
- Modify: `src/models/resource.ts`
- Modify: `test/cli/preset.test.ts`
- Modify: `test/cli/history-revert.test.ts`
- Test: `test/cli/preset.test.ts`
- Test: `test/cli/history-revert.test.ts`

- [ ] **Step 1: Write failing preset-selector and history-ID tests**

```ts
it("accepts resource names when adding and removing preset resources", async () => {
  const context = await createTestContext("cli-preset-resource-selector");
  try {
    await runCli(["init"]);
    const presetModel = await import("../../src/models/preset.ts");
    const resourceModel = await import("../../src/models/resource.ts");
    const preset = presetModel.createPreset({ name: "team" });
    const resource = resourceModel.createResource(
      makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
    );

    await runCli(["preset", "add", "team", "shared-skill"]);
    expect(presetModel.getPresetResources(preset.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: resource.id })]),
    );

    await runCli(["preset", "remove", "team", "shared-skill"]);
    expect(presetModel.getPresetResources(preset.id)).toHaveLength(0);
  } finally {
    await context.cleanup();
  }
});

it("prints full snapshot IDs in history output", async () => {
  const context = await createTestContext("cli-history-full-id");
  try {
    initGitRepo(context.projectDir);
    await runCli(["init"]);
    const presetModel = await import("../../src/models/preset.ts");
    const projectModel = await import("../../src/models/project.ts");
    const resourceModel = await import("../../src/models/resource.ts");
    const snapshotModel = await import("../../src/models/snapshot.ts");
    const git = await import("../../src/services/git.ts");

    const preset = presetModel.createPreset({ name: "history-preset" });
    const resource = resourceModel.createResource(
      makeResourceInput({ type: "instruction", name: "history", content: "# Original instructions" }),
    );
    presetModel.addResourceToPreset(preset.id, resource.id);
    await runCli(["project", "apply", "history-preset", "--project", context.projectDir, "--platform", "claude-code"]);

    const history = await runCli(["project", "history", "--project", context.projectDir]);
    const project = projectModel.getProjectByOrigin(
      git.normalizeGitUrl("git@github.com:acme/harnessdeck-history.git"),
    );
    const snapshot = project ? snapshotModel.listSnapshots(project.id)[0] : undefined;

    expect(snapshot).toBeDefined();
    expect(history.stdout).toContain(snapshot?.id ?? "");
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the targeted tests and confirm the selector/ID parity failures**

Run: `bun run test:run test/cli/preset.test.ts test/cli/history-revert.test.ts`

Expected: FAIL because `preset add/remove` still require raw IDs and `project history` still truncates snapshot IDs.

- [ ] **Step 3: Resolve resource selectors before preset add/remove**

```ts
const resourceResult = resolveResource(resourceSelector);
if (resourceResult.status !== "found") {
  log.error(
    resourceResult.status === "ambiguous"
      ? `Ambiguous resource name: ${resourceSelector}`
      : `Resource not found: ${resourceSelector}`,
  );
  return;
}
addResourceToPreset(preset.id, resourceResult.resource.id);
```

- [ ] **Step 4: Stop truncating snapshot IDs in history output**

```ts
for (const snapshot of snapshots) {
  log.info(`${snapshot.id} ${snapshot.created_at} — ${snapshot.label}`);
}
```

- [ ] **Step 5: Run the targeted tests and make sure they pass**

Run: `bun run test:run test/cli/preset.test.ts test/cli/history-revert.test.ts`

Expected: PASS with preset resource-name workflows and full snapshot ID reuse covered.

- [ ] **Step 6: Commit the selector-parity slice**

```bash
git add src/index.ts src/models/resource.ts test/cli/preset.test.ts test/cli/history-revert.test.ts
git commit -m "feat: normalize selector parity for preset and project flows"
```

### Task 3: Add JSON mode across the remaining structured commands

**Files:**
- Modify: `src/index.ts`
- Create: `test/cli/output-format.test.ts`
- Test: `test/cli/output-format.test.ts`

- [ ] **Step 1: Write the failing cross-command JSON tests**

```ts
it("emits JSON for preset, status, history, platform, init, and apply dry-run commands", async () => {
  const context = await createTestContext("cli-output-format");
  try {
    await runCli(["init"]);
    const platforms = await runCli(["platform", "list", "--format", "json"]);
    expect(JSON.parse(platforms.stdout)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "claude-code" })]),
    );

    const initResult = await runCli(["init", "--format", "json"]);
    expect(JSON.parse(initResult.stdout)).toEqual(
      expect.objectContaining({ database_path: expect.any(String), built_in_presets: expect.anything() }),
    );
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the format test and confirm the missing coverage**

Run: `bun run test:run test/cli/output-format.test.ts`

Expected: FAIL because most commands do not yet accept `--format`.

- [ ] **Step 3: Add `--format` to the remaining structured commands and keep human output unchanged**

```ts
presetCmd
  .command("list")
  .option("--format <format>", "Output format: human or json", "human")
  .action((opts) => {
    const format = parseOutputFormat(opts.format);
    const presets = listPresets();
    if (format === "json") {
      writeJson(presets);
      return;
    }
    for (const preset of presets) {
      log.info(`${preset.name} — ${preset.description || "(no description)"}`);
    }
  });

projectCmd
  .command("status")
  .option("--format <format>", "Output format: human or json", "human")
  .action((path: string, opts: { format?: string }) => {
    const projectRoot = resolve(path);
    const gitOrigin = getGitOrigin(projectRoot);
    const detected = detectPlatforms(projectRoot);
    const project = gitOrigin ? getProjectByOrigin(normalizeGitUrl(gitOrigin)) : undefined;
    const presets = project ? getProjectPresets(project.id) : [];
    const snapshots = project ? listSnapshots(project.id) : [];
    if (parseOutputFormat(opts.format) === "json") {
      writeJson({
        project_root: projectRoot,
        git_origin: gitOrigin,
        platforms: detected,
        applied_presets: presets.length,
        snapshots: snapshots.length,
      });
      return;
    }
    // existing console.log output
  });
```

- [ ] **Step 4: Include JSON payloads for `init` and `project apply --dry-run`**

```ts
if (format === "json") {
  writeJson({
    built_in_presets: { seeded, status: seeded > 0 ? "seeded" : "already_up_to_date" },
    home_defaults: homeDefaults.results,
    database_path: getDbPath(),
  });
  return;
}

if (opts.dryRun && format === "json") {
  writeJson({
    preset: preset.name,
    project_root: projectRoot,
    platforms: generated.map((result) => ({
      platform: result.platformId,
      files: result.files.map((file) => ({ path: file.path })),
    })),
  });
  return;
}
```

- [ ] **Step 5: Run the new format test plus the existing CLI coverage**

Run: `bun run test:run test/cli/output-format.test.ts test/cli/platforms-status-builtins.test.ts test/cli/apply.test.ts test/cli/init.test.ts`

Expected: PASS with the new JSON coverage green and the human-readable regression tests unchanged.

- [ ] **Step 6: Commit the shared JSON coverage slice**

```bash
git add src/index.ts test/cli/output-format.test.ts test/cli/platforms-status-builtins.test.ts test/cli/apply.test.ts test/cli/init.test.ts
git commit -m "feat: add json output for structured cli commands"
```

### Task 4: Expose harness preferences through explicit CLI commands

**Files:**
- Modify: `src/index.ts`
- Modify: `src/models/project.ts`
- Modify: `src/models/harness.ts`
- Modify: `src/services/harness-config.ts`
- Create: `test/cli/harness.test.ts`
- Modify: `test/cli/help-organization.test.ts`
- Test: `test/cli/harness.test.ts`

- [ ] **Step 1: Write the failing harness CLI tests**

```ts
it("sets and shows global harness preferences non-interactively", async () => {
  const context = await createTestContext("cli-harness-global");
  try {
    await runCli(["init"]);
    await runCli([
      "harness",
      "set",
      "--main",
      "claude-code",
      "--aliases",
      "cursor,codex",
    ]);

    const show = await runCli(["harness", "status", "--format", "json"]);
    expect(JSON.parse(show.stdout)).toEqual(
      expect.objectContaining({
        main_harness: "claude-code",
        alias_harnesses: ["cursor", "codex"],
      }),
    );
  } finally {
    await context.cleanup();
  }
});

it("sets and shows project harness preferences non-interactively", async () => {
  const context = await createTestContext("cli-harness-project");
  try {
    initGitRepo(context.projectDir, "git@github.com:acme/harnessdeck-harness.git");
    await runCli(["init"]);

    await runCli([
      "harness",
      "project",
      "set",
      "--project",
      context.projectDir,
      "--main",
      "cursor",
      "--aliases",
      "codex",
      "--materialization-strategy",
      "copy",
    ]);

    const show = await runCli([
      "harness",
      "project",
      "status",
      "--project",
      context.projectDir,
      "--format",
      "json",
    ]);

    expect(JSON.parse(show.stdout)).toEqual(
      expect.objectContaining({
        main_harness: "cursor",
        alias_harnesses: ["codex"],
        materialization_strategy: "copy",
      }),
    );
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the harness CLI tests and confirm the new commands are missing**

Run: `bun run test:run test/cli/harness.test.ts`

Expected: FAIL because the `harness` command group does not exist yet.

- [ ] **Step 3: Add the `harness` command group with explicit non-interactive flags**

```ts
const harnessCmd = program
  .command("harness")
  .description("Manage harness preferences for main and alias platforms");

harnessCmd
  .command("set")
  .option("--main <slug>", "Main harness slug")
  .option("--aliases <slugs>", "Comma-separated alias harness slugs")
  .option("--interactive", "Prompt instead of relying on explicit flags")
  .action(async (opts) => {
    const selection = await resolveHarnessSelection({
      main: opts.main,
      aliases: opts.aliases?.split(",").map((value) => value.trim()),
      nonInteractive: !opts.interactive,
    });
    const saved = setHarnessPreference(selection);
    log.success(`Saved harness preference: ${saved.main_harness}`);
  });
```

- [ ] **Step 4: Add project-scoped harness commands and auto-register git-backed projects**

```ts
const gitOrigin = getGitOrigin(projectRoot);
if (!gitOrigin) {
  log.error("Not a git repository.");
  return;
}

const project = upsertProject({
  git_origin: normalizeGitUrl(gitOrigin),
  name: projectNameFromUrl(gitOrigin),
  local_path: projectRoot,
});

const saved = setProjectHarnessConfig({
  project_id: project.id,
  main_harness: selection.main_harness,
  alias_harnesses: selection.alias_harnesses,
  materialization_strategy: opts.materializationStrategy,
});
```

- [ ] **Step 5: Run the harness and help tests**

Run: `bun run test:run test/cli/harness.test.ts test/cli/help-organization.test.ts`

Expected: PASS with new `harness` help entries and both global/project harness flows covered.

- [ ] **Step 6: Commit the harness CLI slice**

```bash
git add src/index.ts src/models/project.ts src/models/harness.ts src/services/harness-config.ts test/cli/harness.test.ts test/cli/help-organization.test.ts
git commit -m "feat: add non-interactive harness cli commands"
```

### Task 5: Update documentation and run full verification

**Files:**
- Modify: `README.md`
- Modify: `test/cli/help-organization.test.ts`
- Test: `test/cli/*.test.ts`

- [ ] **Step 1: Update the README examples for reusable IDs, JSON mode, and harness commands**

~~~md
3. List the imported resources.

```bash
harnessdeck resource list
harnessdeck resource list --format json
```

5. Add imported resources to that preset.

```bash
harnessdeck preset add my-setup openapi-mcp-baseline
```

8. Inspect or set harness preferences without prompts.

```bash
harnessdeck harness status --format json
harnessdeck harness set --main claude-code --aliases cursor,codex
```
~~~

- [ ] **Step 2: Update help assertions for the final command surface**

```ts
const harnessHelp = await runCli(["harness", "-h"]);
expect(help.stdout).toContain("harness");
expect(harnessHelp.stdout).toContain("status");
expect(harnessHelp.stdout).toContain("set");
expect(harnessHelp.stdout).toContain("project");
```

- [ ] **Step 3: Run the focused documentation/help regression tests**

Run: `bun run test:run test/cli/help-organization.test.ts test/cli/platforms-status-builtins.test.ts`

Expected: PASS with the updated help output and README-aligned workflows preserved.

- [ ] **Step 4: Run full verification**

Run: `bun run lint && bun run typecheck && bun run test:run && bun run build`

Expected: all commands succeed; Vitest reports all CLI, model, platform, and service tests passing; `tsup` completes with a successful build.

- [ ] **Step 5: Commit the documentation and final verification slice**

```bash
git add README.md test/cli/help-organization.test.ts
git commit -m "docs: document consistent cli automation workflows"
```
