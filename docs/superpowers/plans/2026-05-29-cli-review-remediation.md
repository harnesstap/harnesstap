# CLI Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the reviewed CLI UX fixes from `cli-review.md`: slimmer help, richer failure guidance, better init prompts, safer preset import/search/publish flows, a cleaned-up remote preset command surface, and a full human-readable doctor report.

**Architecture:** Keep `src/index.ts` as the single Commander entrypoint, but move new interactive-only behavior into small wizard helpers under `src/services/wizards/`. Preserve existing storage and JSON contracts where possible: the biggest intentional surface change is reclaiming `preset add` for remote catalog installs, which requires renaming the current local attachment verbs to `preset attach` / `preset detach` instead of trying to support two incompatible meanings for `preset add`.

**Tech Stack:** Bun, TypeScript, Commander, Inquirer, better-sqlite3

---

## File Structure

- Modify: `src/index.ts`
  - Remove `[options]` from grouped help rows.
  - Append contextual usage/examples after Commander-style failures.
  - Update `init`, `preset show`, `preset search`, `preset add`, `preset publish`, `preset doctor`, and `preset from-project`.
  - Rename local preset mutation commands from `add/remove` to `attach/detach`.
- Modify: `src/services/harness-config.ts`
  - Show current defaults during selection.
  - Short-circuit the single-harness case.
  - Use searchable prompts for main/alias selection and preserve detected aliases as defaults.
- Modify: `src/services/wizards/shared.ts`
  - Register any searchable prompt plugins and keep the existing `promptForChoice`, `promptForConfirmation`, and `promptForValue` helpers as the shared prompt surface.
- Create: `src/services/wizards/preset-search.ts`
  - Prompt for a remote search query with examples after cloud auth is resolved.
- Create: `src/services/wizards/preset-publish.ts`
  - Prompt for an organization when multiple orgs are available.
- Modify: `package.json`
  - Add the searchable inquirer prompt dependencies needed for search/filterable harness selection.
- Modify: `bun.lock`
  - Capture the prompt dependency update.
- Modify: `test/cli/help-organization.test.ts`
  - Cover slimmer help rows and renamed preset verbs.
- Modify: `test/cli/error-output.test.ts`
  - Cover contextual error output.
- Modify: `test/cli/init.test.ts`
  - Cover rerun warnings, prompt defaults, and the removal of the no-op built-in preset line.
- Modify: `test/services/harness-config.test.ts`
  - Cover single-choice bypass and searchable prompt configuration.
- Modify: `test/services/wizard-prompts.test.ts`
  - Cover search and publish prompt modules.
- Modify: `test/cli/preset.test.ts`
  - Cover `preset attach/detach`, `preset show` prompting, doctor output, and from-project help text.
- Modify: `test/cli/preset-cloud.test.ts`
  - Cover `preset add`, interactive search, and org-aware publish.
- Modify: `test/cli/export-import.test.ts`
  - Cover duplicate import detection and overwrite confirmation.
- Modify: `README.md`
  - Document the renamed preset commands and updated examples.

### Task 1: Tighten grouped help and contextual command failures

**Files:**
- Modify: `src/index.ts`
- Test: `test/cli/help-organization.test.ts`
- Test: `test/cli/error-output.test.ts`

- [ ] **Step 1: Write the failing help/error tests**

```ts
it("omits [options] from grouped help rows", async () => {
  const result = await runCli(["preset", "--help"]);
  expect(result.stdout).toContain("show <name>");
  expect(result.stdout).not.toContain("show [options]");
  expect(result.stdout).not.toContain("publish [options] <preset>");
});

it("appends contextual usage after commander errors", () => {
  const result = runCliProcess(["preset", "validate", "empty-preset"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("error: unknown command 'preset validate'");
  expect(result.stderr).toContain("USAGE");
  expect(result.stderr).toContain("preset show");
  expect(result.stderr).toContain("preset doctor");
});
```

- [ ] **Step 2: Run the targeted help/error tests to verify they fail**

Run: `bun test test/cli/help-organization.test.ts test/cli/error-output.test.ts`

Expected: FAIL because grouped help still prints `[options]` and `renderCliError()` still emits only the error line.

- [ ] **Step 3: Remove `[options]` from grouped help and append command context on CLI errors**

```ts
function renderGroupedCommandHelp(cmd: Command, showHidden: boolean): string {
  const commandStrs = commands.map((c) => {
    const name = c.name();
    const aliases = c.aliases();
    const args = c.registeredArguments?.map((arg) => (
      arg.required ? `<${arg.name()}>` : `[${arg.name()}]`
    )).join(" ") || "";

    let fullStr = name;
    if (aliases.length) fullStr += ` (${aliases.join(", ")})`;
    if (args) fullStr += ` ${args}`;
    return fullStr;
  });
}

function resolveCommandContext(argv: string[]): Command {
  let current = program;
  for (const token of argv.slice(2)) {
    const next = current.commands.find((cmd) =>
      cmd.name() === token || cmd.aliases().includes(token),
    );
    if (!next) break;
    current = next;
  }
  return current;
}

function renderCliError(error: unknown, argv: string[] = process.argv): void {
  const message = error instanceof Error ? error.message : String(error);
  ui.danger(message);

  if (message.startsWith("error: ")) {
    const context = resolveCommandContext(argv);
    console.error("");
    console.error(context.helpInformation());
  }
}
```

- [ ] **Step 4: Re-run the help/error tests**

Run: `bun test test/cli/help-organization.test.ts test/cli/error-output.test.ts`

Expected: PASS with slimmer grouped help and contextual usage text following unknown-command failures.

- [ ] **Step 5: Commit the help/error slice**

```bash
git add src/index.ts test/cli/help-organization.test.ts test/cli/error-output.test.ts
git commit -m "feat: tighten cli help and error guidance"
```

### Task 2: Upgrade the init harness-selection UX

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/index.ts`
- Modify: `src/services/harness-config.ts`
- Modify: `src/services/wizards/shared.ts`
- Test: `test/cli/init.test.ts`
- Test: `test/services/harness-config.test.ts`

- [ ] **Step 1: Write the failing init UX tests**

```ts
it("warns before overwriting an existing harness preference and hides the no-op preset line", async () => {
  const context = await createTestContext("cli-init-rerun-warning");
  try {
    await runCli(["init", "--main", "claude-code", "--aliases", "cursor"]);
    const rerun = await runCli(["init", "--main", "cursor", "--aliases", "codex"]);
    expect(rerun.stdout).toContain("will be overwritten");
    expect(rerun.stdout).toContain("main: claude-code");
    expect(rerun.stdout).not.toContain("Built-in Presets");
    expect(rerun.stdout).not.toContain("already up to date");
  } finally {
    await context.cleanup();
  }
});

it("skips the interactive main prompt when only one harness is available", async () => {
  const registry = await import("../../src/platforms/registry.ts");
  const service = await import("../../src/services/harness-config.ts");
  spyOn(registry, "getAllPlatforms").mockReturnValue([
    { id: "claude-code", name: "Claude Code", supports: new Set(["instructions"]) },
  ]);
  const selection = await service.resolveHarnessSelection({ detected: ["claude-code"] });
  expect(selection).toEqual({
    main_harness: "claude-code",
    alias_harnesses: [],
  });
});
```

- [ ] **Step 2: Run the targeted init tests to verify they fail**

Run: `bun test test/cli/init.test.ts test/services/harness-config.test.ts`

Expected: FAIL because rerun `init` does not warn, the no-op built-in preset line still renders, and single-harness interactive flows still reach Inquirer.

- [ ] **Step 3: Add searchable prompt support and extend the init selection flow**

Run: `bun add inquirer-search-list inquirer-search-checkbox`

```ts
// src/services/wizards/shared.ts
import inquirer from "inquirer";
import SearchListPrompt from "inquirer-search-list";
import SearchCheckboxPrompt from "inquirer-search-checkbox";

inquirer.registerPrompt("search-list", SearchListPrompt);
inquirer.registerPrompt("search-checkbox", SearchCheckboxPrompt);

// src/services/harness-config.ts
if (!options.nonInteractive && harnesses.length === 1) {
  return normalizeSelection({
    main_harness: harnesses[0]!.value,
    alias_harnesses: [],
  });
}

const currentSummary = current
  ? `Current main: ${current.main_harness} | aliases: ${current.alias_harnesses.join(", ") || "(none)"}`
  : undefined;

const { main_harness } = await inquirer.prompt([{
  type: "search-list",
  name: "main_harness",
  message: [options.mainMessage ?? "Select the main harness", currentSummary].filter(Boolean).join("\n"),
  choices: harnesses,
  default: defaultMain,
}]);

const { alias_harnesses } = await inquirer.prompt([{
  type: "search-checkbox",
  name: "alias_harnesses",
  message: [options.aliasMessage ?? "Select alias harnesses to keep in sync", "Type to filter, use the prompt shortcuts to select all or clear all."].join("\n"),
  choices: harnesses.filter((choice) => choice.value !== main_harness),
  default: defaultAliases.filter((harness) => harness !== main_harness),
}]);
```

```ts
// src/index.ts
const existingPreference = getHarnessPreference();
if (existingPreference && format === "human" && shouldSelectHarness) {
  ui.warn(
    `Existing harness preference will be overwritten (main: ${existingPreference.main_harness}; aliases: ${existingPreference.alias_harnesses.join(", ") || "(none)"}).`,
  );
}

const summaryRows = [{ key: "Database", value: getDbPath() }];
if (seeded > 0) {
  summaryRows.push({
    key: "Built-in Presets",
    value: `seeded ${formatCount(seeded, "built-in preset")}`,
  });
}
ui.kvBlock(summaryRows);
```

- [ ] **Step 4: Re-run the init tests**

Run: `bun test test/cli/init.test.ts test/services/harness-config.test.ts`

Expected: PASS with rerun warnings, current-default labeling, detected alias defaults, searchable prompts, and the single-harness bypass all covered.

- [ ] **Step 5: Commit the init UX slice**

```bash
git add package.json bun.lock src/index.ts src/services/harness-config.ts src/services/wizards/shared.ts test/cli/init.test.ts test/services/harness-config.test.ts
git commit -m "feat: improve init harness selection ux"
```

### Task 3: Reclaim `preset add` for remote installs and prompt missing preset targets

**Files:**
- Modify: `src/index.ts`
- Test: `test/cli/preset.test.ts`
- Test: `test/cli/preset-cloud.test.ts`

- [ ] **Step 1: Write the failing command-surface tests**

```ts
it("uses preset attach and detach for local preset mutations", async () => {
  const context = await createTestContext("cli-preset-attach");
  try {
    await runCli(["init"]);
    const presetModel = await import("../../src/models/preset.ts");
    const resourceModel = await import("../../src/models/resource.ts");
    const preset = presetModel.createPreset({ name: "team" });
    const resource = resourceModel.createResource(
      makeResourceInput({ type: "skill", name: "shared-skill", content: "# Shared" }),
    );

    await runCli(["preset", "attach", "team", resource.id, "--type", "skill"]);
    await runCli(["preset", "detach", "team", resource.id, "--type", "skill"]);

    expect(presetModel.getPresetResources(preset.id)).toHaveLength(0);
  } finally {
    await context.cleanup();
  }
});

it("prompts for a preset when preset show is run without a name on a tty", async () => {
  const context = await createTestContext("cli-preset-show-prompt");
  try {
    await runCli(["init"]);
    const presetModel = await import("../../src/models/preset.ts");
    presetModel.createPreset({ name: "team" });

    const result = await runCli(["preset", "show"], {
      isTTY: true,
      promptResponses: [{ value: "team@1.0.0" }],
    });

    expect(result.stdout).toContain("PRESET");
    expect(result.stdout).toContain("team@1.0.0");
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the targeted preset tests to verify they fail**

Run: `bun test test/cli/preset.test.ts test/cli/preset-cloud.test.ts`

Expected: FAIL because local mutation commands are still `preset add/remove`, `preset show` still requires `<name>`, and remote install is still exposed only as `preset install`.

- [ ] **Step 3: Rename local mutation verbs, keep `org/library[@version]` canonical, and wire `preset add` to remote install**

```ts
// src/index.ts
presetCmd
  .command("attach")
  .argument("[preset]", "Preset name or ID")
  .argument("[selector]", "Attachment selector (resource, plugin ref, or dependency name)")
  .option("--type <type>", `Attachment type: ${PRESET_ATTACHMENT_TYPES.join(", ")}`)
  .action(handlePresetAttachCommand);

presetCmd
  .command("detach")
  .argument("[preset]", "Preset name or ID")
  .argument("[selector]", "Attachment selector (resource, plugin ref, or dependency name)")
  .option("--type <type>", `Attachment type: ${PRESET_ATTACHMENT_TYPES.join(", ")}`)
  .action(handlePresetDetachCommand);

presetCmd
  .command("show")
  .argument("[name]", "Preset name or ID")
  .action((name: string | undefined, opts) => handlePresetShowCommand(name, opts));

presetCmd
  .command("add")
  .argument("<selector>", "Remote library selector: org/library[@version]")
  .option("--org <slug>", "Organization slug override when the selector omits it")
  .option("--version <semver>", "Remote version override when the selector omits it")
  .option("--as <name>", "Install under a different local preset name")
  .action(handlePresetRemoteAddCommand);

presetCmd
  .command("install", { hidden: true })
  .argument("<selector>", "Remote library selector: org/library[@version]")
  .action((selector: string, opts) => {
    ui.warn("`preset install` is deprecated; use `preset add`.");
    return handlePresetRemoteAddCommand(selector, opts);
  });

function normalizeRemoteLibrarySelector(
  selector: string,
  opts: { org?: string; version?: string },
): string {
  if (selector.includes("/")) return selector;
  if (!opts.org) {
    throw new Error("Remote installs require an organization. Use org/library or pass --org.");
  }
  return `${opts.org}/${selector}${opts.version ? `@${opts.version}` : ""}`;
}

async function handlePresetRemoteAddCommand(
  selector: string,
  opts: { as?: string; org?: string; version?: string; profile?: string; format?: string },
): Promise<void> {
  const normalized = normalizeRemoteLibrarySelector(selector, opts);
  return handlePresetInstallCommand(normalized, {
    as: opts.as,
    profile: opts.profile,
    format: opts.format,
  });
}

async function handlePresetShowCommand(
  name: string | undefined,
  opts: { format?: string; interactive?: boolean; noInteractive?: boolean; showId?: boolean },
): Promise<void> {
  const resolvedName = await resolvePresetMutationTarget({
    presetName: name,
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: opts.format,
    message: "Which preset do you want to inspect?",
  });
  if (!resolvedName) throw new Error("Preset name or ID is required.");

  // Keep the existing preset lookup and rendering logic in this function,
  // but use `resolvedName` instead of the raw CLI argument.
}
```

- [ ] **Step 4: Re-run the preset command-surface tests**

Run: `bun test test/cli/preset.test.ts test/cli/preset-cloud.test.ts`

Expected: PASS with `preset attach/detach`, prompted `preset show`, and `preset add` replacing `preset install` while `preset install` remains a deprecated alias.

- [ ] **Step 5: Commit the preset command-surface slice**

```bash
git add src/index.ts test/cli/preset.test.ts test/cli/preset-cloud.test.ts
git commit -m "feat: reclaim preset add for remote installs"
```

### Task 4: Make search, import, and publish flows interactive and conflict-safe

**Files:**
- Modify: `src/index.ts`
- Create: `src/services/wizards/preset-search.ts`
- Create: `src/services/wizards/preset-publish.ts`
- Test: `test/cli/export-import.test.ts`
- Test: `test/cli/preset-cloud.test.ts`
- Test: `test/services/wizard-prompts.test.ts`

- [ ] **Step 1: Write the failing search/import/publish tests**

```ts
it("prompts for a remote query only after the cloud profile resolves", async () => {
  const result = await runCli(["preset", "search"], {
    isTTY: true,
    promptResponses: [{ value: "fastapi" }],
  });
  expect(result.stdout).toContain("acme/team");
});

it("reports duplicate import conflicts clearly and lets the user overwrite", async () => {
  const context = await createTestContext("cli-import-overwrite");
  try {
    await runCli(["init"]);
    await runCli(["preset", "create", "python-fastapi"]);
    const bundlePath = `${context.projectDir}/python-fastapi.harnessdeck.jsonc`;
    await runCli(["preset", "export", "python-fastapi", "--file", bundlePath]);

    const result = await runCli(["preset", "import", bundlePath], {
      isTTY: true,
      promptResponses: [{ value: true }],
    });

    expect(result.stdout).toContain("Imported preset python-fastapi");
    expect(result.stderr).not.toContain("UNIQUE constraint failed");
  } finally {
    await context.cleanup();
  }
});

it("prompts for an organization when publishing with multiple orgs", async () => {
  const publish = await runCli(["preset", "publish", "pubtest", "--profile", "test"], {
    isTTY: true,
    promptResponses: [{ value: "acme" }],
  });
  expect(publish.stdout).toContain("Published preset pubtest");
});
```

- [ ] **Step 2: Run the targeted search/import/publish tests to verify they fail**

Run: `bun test test/cli/export-import.test.ts test/cli/preset-cloud.test.ts test/services/wizard-prompts.test.ts`

Expected: FAIL because `preset search` still requires `<query>`, duplicate imports still surface raw SQLite errors, and `preset publish` ignores multiple organizations.

- [ ] **Step 3: Add query/org wizard helpers and preflight duplicate imports before writing anything**

```ts
// src/services/wizards/preset-search.ts
export async function runPresetSearchWizard(): Promise<string> {
  return promptForValue({
    message: "Search remote presets (examples: fastapi, auth, regex:^team-)",
  });
}

// src/services/wizards/preset-publish.ts
export async function runPresetPublishWizard(orgs: Array<{ slug: string; name?: string }>): Promise<string> {
  return promptForChoice({
    message: "Which organization should own this published preset?",
    choices: orgs.map((org) => ({
      name: org.name ? `${org.name} (${org.slug})` : org.slug,
      value: org.slug,
    })),
  });
}
```

```ts
// src/index.ts
presetCmd
  .command("search")
  .argument("[query]", "Search query")
  .action(handlePresetSearchCommand);

presetCmd
  .command("import")
  .argument("<file>", "Path to exported preset bundle")
  .option("--overwrite", "Replace any imported presets that already exist locally")
  .action(handlePresetImportCommand);

presetCmd
  .command("publish")
  .argument("<preset>", "Preset name or ID")
  .option("--org <slug>", "Organization slug to publish into")
  .action(handlePresetPublishCommand);

async function handlePresetSearchCommand(query: string | undefined, opts: { profile?: string; format?: string; interactive?: boolean; noInteractive?: boolean }) {
  const client = await resolveCloudClientForPresetCommand(opts.profile);
  if (!client) {
    ui.danger("No cloud profile configured. Use `cloud login` to create one or pass --profile.");
    return;
  }

  const shouldPrompt = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format: parseOutputFormat(opts.format),
    missingRequiredArgs: !query,
  });
  const resolvedQuery = query ?? (shouldPrompt ? await runPresetSearchWizard() : undefined);
  if (!resolvedQuery) throw new Error("Search query is required.");

  const results = await client.searchLibraries(resolvedQuery);
}

function findBundleConflicts(file: string): string[] {
  const bundle = inspectBundleFile(file);
  return bundle.presets
    .filter((entry) => getPreset(`${entry.name}@${entry.version}`))
    .map((entry) => `${entry.name}@${entry.version}`);
}

async function handlePresetImportCommand(file: string, opts: { overwrite?: boolean; interactive?: boolean; noInteractive?: boolean }): Promise<void> {
  const conflicts = findBundleConflicts(file);
  if (conflicts.length > 0) {
    const canPrompt = shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: "human",
      missingRequiredArgs: false,
    });
    const overwrite = opts.overwrite ?? (canPrompt
      ? await promptForConfirmation({
          message: `Preset already exists: ${conflicts.join(", ")}. Overwrite it?`,
          default: false,
        })
      : false);
    if (!overwrite) throw new Error(`Preset already exists: ${conflicts.join(", ")}`);
    for (const conflict of conflicts) {
      const preset = getPreset(conflict);
      if (preset) deletePreset(preset.id);
    }
  }

  const { preset, resources } = importFromFile(file);
  ui.success(`Imported preset ${ui.theme.accent(preset.name)} ${ui.icons.bullet} ${formatCount(resources.length, "resource")}`);
}

async function handlePresetPublishCommand(presetName: string, opts: { org?: string; profile?: string; format?: string; interactive?: boolean; noInteractive?: boolean }) {
  const preset = getPreset(presetName);
  if (!preset) throw new Error(`Preset not found: ${presetName}`);
  const bundleJson = JSON.stringify(exportPreset(preset.id));

  const client = await resolveCloudClientForPresetCommand(opts.profile);
  if (!client) {
    ui.danger("No cloud profile configured. Use `cloud login` to create one or pass --profile.");
    return;
  }

  const orgs = (await client.listOrgs()).map((org) => ({
    slug: String(org.slug ?? org.org_slug),
    name: typeof org.name === "string" ? org.name : undefined,
  }));
  const orgSlug = opts.org
    ?? (orgs.length === 1 ? orgs[0]!.slug : await runPresetPublishWizard(orgs));

  const resp = await client.publishPresetBundle({
    preset_name: preset.name,
    org_slug: orgSlug,
  }, bundleJson);
}
```

- [ ] **Step 4: Re-run the targeted search/import/publish tests**

Run: `bun test test/cli/export-import.test.ts test/cli/preset-cloud.test.ts test/services/wizard-prompts.test.ts`

Expected: PASS with interactive search, clear duplicate-import behavior, overwrite confirmation, and org-aware publish flows.

- [ ] **Step 5: Commit the remote-flow slice**

```bash
git add src/index.ts src/services/wizards/preset-search.ts src/services/wizards/preset-publish.ts test/cli/export-import.test.ts test/cli/preset-cloud.test.ts test/services/wizard-prompts.test.ts
git commit -m "feat: improve preset remote workflows"
```

### Task 5: Render full doctor verdicts, refresh help text, and run full verification

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli/preset.test.ts`
- Modify: `test/cli/help-organization.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing doctor/help-text tests**

```ts
it("shows every doctor check with a pass or fail marker", async () => {
  const context = await createTestContext("cli-preset-doctor-ok");
  try {
    await runCli(["init"]);
    await runCli(["preset", "create", "healthy"]);
    const result = await runCli(["preset", "doctor", "healthy"]);
    expect(result.stdout).toContain("✅");
    expect(result.stdout).toContain("empty-preset");
    expect(result.stdout).toContain("duplicate-resources");
  } finally {
    await context.cleanup();
  }
});

it("documents the updated from-project and preset command descriptions", async () => {
  const help = await runCli(["preset", "--help"]);
  expect(help.stdout).toContain("Scan current folder and create a preset from its resources");
  expect(help.stdout).toContain("attach");
  expect(help.stdout).toContain("detach");
  expect(help.stdout).toContain("add");
});
```

- [ ] **Step 2: Run the targeted doctor/docs tests to verify they fail**

Run: `bun test test/cli/preset.test.ts test/cli/help-organization.test.ts`

Expected: FAIL because `preset doctor` still prints only findings, and the preset help text still shows the old command names and from-project description.

- [ ] **Step 3: Synthesize pass rows in the human renderer, keep JSON stable, and update docs/help copy**

```ts
function handlePresetDoctorCommand(name: string | undefined, opts: { check?: string[]; format?: string; listChecks?: boolean }): void {
  const format = parseOutputFormat(opts.format);
  const checks = listPresetDoctorChecks().filter((check) =>
    opts.check?.length ? opts.check.includes(check.id) : true,
  );
  const report = runPresetDoctor({ nameOrId: name!, checkIds: opts.check });

  if (format === "json") {
    printJson(report);
    if (!report.valid) process.exitCode = 1;
    return;
  }

  const rows = checks.flatMap((check) => {
    const findings = report.results.filter((result) => result.check === check.id);
    if (findings.length === 0) {
      return [{ status: "✅", check: check.id, message: "passed" }];
    }
    return findings.map((finding) => ({
      status: finding.severity === "error" ? "❌" : "⚠️",
      check: check.id,
      message: finding.message,
    }));
  });

  ui.table.print({
    columns: [
      { key: "status", header: "OK", width: 4 },
      { key: "check", header: "CHECK", width: 24 },
      { key: "message", header: "MESSAGE", width: 48 },
    ],
    rows,
    summary: report.valid ? `${report.preset}: valid` : `${report.preset}: invalid`,
  });
}

presetCmd
  .command("from-project")
  .option("-d, --description <text>", "Preset description to write into the generated preset")
  .description("Scan current folder and create a preset from its resources");
```

```md
## Presets

- `harnessdeck preset attach team shared-skill --type skill`
- `harnessdeck preset detach team shared-skill --type skill`
- `harnessdeck preset add acme/team --as team-cloud`
- `harnessdeck preset publish team --org acme`
- `harnessdeck preset doctor team`
- `harnessdeck preset from-project starter --description "Generated from current folder"`
```

- [ ] **Step 4: Run the targeted tests and the full repo verification**

Run: `bun test test/cli/preset.test.ts test/cli/help-organization.test.ts && bun run preflight`

Expected: PASS with per-check doctor verdicts in human output, unchanged JSON output, updated help text, and the full lint/typecheck/test/build suite green.

- [ ] **Step 5: Commit the doctor/docs slice**

```bash
git add src/index.ts test/cli/preset.test.ts test/cli/help-organization.test.ts README.md
git commit -m "feat: finish cli review remediation"
```
