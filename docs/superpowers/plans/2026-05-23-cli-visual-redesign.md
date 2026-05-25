# CLI Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `harnessdeck` human-mode CLI output around a shared `src/ui/` rendering module without changing any JSON-mode contracts, command behavior, or exit codes.

**Architecture:** Add a focused `src/ui/` peer module that owns theme, formatting, tables, panels, diffs, verdicts, and spinner/progress output. Migrate `src/index.ts` command families in small TDD slices so the old logger remains as a temporary compatibility shim until the entire CLI uses the new primitives. Keep repository conventions by using relative imports instead of introducing a new `@/` path alias.

**Tech Stack:** TypeScript, Bun, Commander, Chalk, cli-table3, ora, Vitest, tsup

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Add `cli-table3` and `ora` dependencies used by the renderer |
| `bun.lock` | Record the new runtime dependencies |
| `src/ui/theme.ts` | Theme roles, icons, `NO_COLOR` / TTY detection, ASCII table chars |
| `src/ui/format.ts` | Pure helpers such as `truncate`, `shortenId`, relative-time formatting, and count summaries |
| `src/ui/status.ts` | Single-line verdict and hint rendering; temporary `log` shim target |
| `src/ui/section.ts` | Section headers, subheaders, and horizontal rules |
| `src/ui/kv.ts` | Label/value row rendering for panels |
| `src/ui/panel.ts` | Detail-view panels composed from section + kv primitives |
| `src/ui/table.ts` | Shared table renderer built on `cli-table3` |
| `src/ui/diff.ts` | Compact diff-table renderer with colored change-kind glyphs |
| `src/ui/progress.ts` | Ora-backed spinner wrapper with non-TTY no-op behavior |
| `src/ui/index.ts` | Public `ui` namespace re-export surface |
| `src/utils/logger.ts` | Phase-A compatibility shim that delegates to `ui.status.*` |
| `src/index.ts` | Command definitions and all human-mode rendering call sites |
| `test/ui/*.test.ts` | Renderer unit coverage for every primitive in color and no-color modes |
| `test/helpers/cli.ts` | Existing CLI capture harness; unchanged, but the first task validates that `ui` output is captured through it |
| `test/cli/*.test.ts` | Representative human-mode regressions for migrated commands plus unchanged JSON-mode coverage |
| `README.md` | Refresh visible output examples once the redesign lands |
| `docs/scenarios/vhs/tapes/01-existing-repo-adoption.tape` | Re-record the primary walkthrough after spinner/progress output stabilizes |

---

### Task 1: Build the shared `src/ui/` module and dependency foundation

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/ui/index.ts`
- Create: `src/ui/theme.ts`
- Create: `src/ui/format.ts`
- Create: `src/ui/status.ts`
- Create: `src/ui/section.ts`
- Create: `src/ui/kv.ts`
- Create: `src/ui/panel.ts`
- Create: `src/ui/table.ts`
- Create: `src/ui/diff.ts`
- Create: `src/ui/progress.ts`
- Modify: `src/utils/logger.ts`
- Create: `test/ui/theme.test.ts`
- Create: `test/ui/format.test.ts`
- Create: `test/ui/status.test.ts`
- Create: `test/ui/table.test.ts`
- Create: `test/ui/panel.test.ts`
- Create: `test/ui/diff.test.ts`
- Create: `test/ui/progress.test.ts`
- Modify: `test/helpers/cli.ts`
- Test: `test/ui/*.test.ts`

- [ ] **Step 1: Write failing renderer tests before adding production code**

```ts
// test/ui/theme.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";

describe("ui theme", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses ASCII table chars when stdout is not a TTY", async () => {
    vi.stubGlobal("process", { ...process, stdout: { ...process.stdout, isTTY: false, columns: 80 } });
    const { getTableChars } = await import("../../src/ui/theme.ts");
    expect(getTableChars().top).toBe("+");
  });

  it("disables color styles when NO_COLOR is set", async () => {
    vi.stubEnv("NO_COLOR", "1");
    const { theme } = await import("../../src/ui/theme.ts");
    expect(theme.success("ok")).toBe("ok");
  });
});

// test/ui/table.test.ts
import { describe, expect, it } from "vitest";
import { renderTable } from "../../src/ui/table.ts";

describe("ui table", () => {
  it("renders headers, rows, and a summary footer", () => {
    const output = renderTable({
      columns: [
        { key: "name", header: "NAME", width: 12 },
        { key: "description", header: "DESCRIPTION", width: 24 },
      ],
      rows: [{ name: "nextjs-fullstack", description: "Next.js fullstack preset" }],
      summary: "1 preset · run `harnessdeck preset show <name>` for details",
    });

    expect(output).toContain("NAME");
    expect(output).toContain("nextjs-fullstack");
    expect(output).toContain("1 preset");
  });
});

// test/ui/status.test.ts
import { describe, expect, it } from "vitest";
import { renderDanger, renderSuccess } from "../../src/ui/status.ts";

describe("ui status", () => {
  it("renders verdicts with icons and optional hints", () => {
    expect(renderSuccess('Preset "team" is valid.')).toContain("✓");
    expect(
      renderDanger("Preset not found: team", {
        hint: "Run `harnessdeck preset list` to see available presets.",
      }),
    ).toContain("→");
  });
});

// test/helpers/cli.ts (new assertion)
it("captures ui renderer output written through console.log", async () => {
  const result = await runCli(["-h"]);
  expect(result.stdout.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the renderer tests and confirm they fail because the module does not exist yet**

Run: `bun run test:run test/ui/theme.test.ts test/ui/table.test.ts test/ui/status.test.ts`

Expected: FAIL with module-resolution errors for `../../src/ui/*.ts`.

- [ ] **Step 3: Add dependencies and implement the renderer module**

```ts
// src/ui/theme.ts
import chalk from "chalk";

export type ThemeFn = (value: string) => string;

function colorEnabled(): boolean {
  return !process.env.NO_COLOR && chalk.level > 0;
}

function maybe(style: ThemeFn): ThemeFn {
  return (value) => (colorEnabled() ? style(value) : value);
}

export const icons = {
  success: "✓",
  warn: "⚠",
  danger: "✗",
  hint: "→",
  bullet: "·",
  added: "+",
  removed: "−",
  modified: "~",
} as const;

export const theme = {
  primary: maybe((value) => chalk.bold(value)),
  accent: maybe((value) => chalk.hex("#3b82f6")(value)),
  muted: maybe((value) => chalk.hex("#6b7280")(value)),
  success: maybe((value) => chalk.hex("#10b981")(value)),
  warn: maybe((value) => chalk.hex("#f59e0b")(value)),
  danger: maybe((value) => chalk.hex("#ef4444")(value)),
  badge: maybe((value) => chalk.bgHex("#1d4ed8").white.bold(` ${value} `)),
};

export function isTty(): boolean {
  return process.stdout.isTTY === true;
}

export function terminalColumns(): number {
  return process.stdout.columns ?? 80;
}

export function getTableChars() {
  return isTty() && !process.env.NO_COLOR
    ? {}
    : {
        top: "-",
        "top-mid": "+",
        "top-left": "+",
        "top-right": "+",
        bottom: "-",
        "bottom-mid": "+",
        "bottom-left": "+",
        "bottom-right": "+",
        left: "|",
        "left-mid": "+",
        mid: "-",
        "mid-mid": "+",
        right: "|",
        "right-mid": "+",
        middle: "|",
      };
}
```

```ts
// src/ui/format.ts
export function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return "…";
  return `${value.slice(0, Math.max(0, width - 1))}…`;
}

export function shortenId(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function formatRelativeTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return `${Math.max(1, Math.floor(diffMs / 1000))} seconds ago`;
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} minutes ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} hours ago`;
  if (diffMs <= 30 * day) return `${Math.floor(diffMs / day)} days ago`;
  return date.toISOString().slice(0, 10);
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
```

```ts
// src/ui/status.ts
import { icons, theme } from "./theme.js";

function line(icon: string, message: string): string {
  return `${icon} ${message}`;
}

export function renderSuccess(message: string, opts?: { hint?: string }): string {
  return opts?.hint
    ? `${theme.success(line(icons.success, message))}\n  ${theme.muted(`${icons.hint} ${opts.hint}`)}`
    : theme.success(line(icons.success, message));
}

export function renderWarn(message: string, opts?: { hint?: string }): string {
  return opts?.hint
    ? `${theme.warn(line(icons.warn, message))}\n  ${theme.muted(`${icons.hint} ${opts.hint}`)}`
    : theme.warn(line(icons.warn, message));
}

export function renderDanger(message: string, opts?: { hint?: string }): string {
  return opts?.hint
    ? `${theme.danger(line(icons.danger, message))}\n  ${theme.muted(`${icons.hint} ${opts.hint}`)}`
    : theme.danger(line(icons.danger, message));
}

export const status = {
  success: (message: string, opts?: { hint?: string }) => console.log(renderSuccess(message, opts)),
  warn: (message: string, opts?: { hint?: string }) => console.log(renderWarn(message, opts)),
  danger: (message: string, opts?: { hint?: string }) => console.error(renderDanger(message, opts)),
  info: (message: string) => console.log(theme.muted(message)),
  dim: (message: string) => console.log(theme.muted(message)),
  hint: (message: string) => console.log(`  ${theme.muted(`${icons.hint} ${message}`)}`),
};
```

```ts
// src/ui/index.ts
import * as format from "./format.js";
import { renderTable, table } from "./table.js";
import { renderPanel, panel, kvBlock } from "./panel.js";
import { renderDiffTable, diffTable } from "./diff.js";
import { progress } from "./progress.js";
import { status } from "./status.js";
import { icons, theme } from "./theme.js";
import { header, subheader, rule } from "./section.js";

export const ui = {
  format,
  icons,
  theme,
  header,
  subheader,
  rule,
  table,
  renderTable,
  panel,
  renderPanel,
  kvBlock,
  diffTable,
  renderDiffTable,
  spinner: progress,
  ...status,
};
```

```ts
// src/utils/logger.ts
import { status } from "../ui/status.js";

export const log = {
  info: (message: string) => status.info(message),
  success: (message: string) => status.success(message),
  warn: (message: string) => status.warn(message),
  error: (message: string) => status.danger(message),
  dim: (message: string) => status.dim(message),
  table: (data: Record<string, string>[]) => console.table(data),
};
```

- [ ] **Step 4: Run the new UI tests and then the full baseline**

Run: `bun install && bun run test:run test/ui/theme.test.ts test/ui/format.test.ts test/ui/status.test.ts test/ui/table.test.ts test/ui/panel.test.ts test/ui/diff.test.ts test/ui/progress.test.ts && bun run preflight`

Expected: PASS, with the old CLI behavior unchanged and the renderer tests green.

- [ ] **Step 5: Commit the foundation slice**

```bash
git add package.json bun.lock src/ui src/utils/logger.ts test/ui test/helpers/cli.ts
git commit -m "feat: add shared CLI UI foundation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Migrate all listing commands to the shared table renderer

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli/output-format.test.ts`
- Modify: `test/cli/preset.test.ts`
- Modify: `test/cli/resource.test.ts`
- Modify: `test/cli/plugin.test.ts`
- Test: `test/cli/preset.test.ts`
- Test: `test/cli/resource.test.ts`
- Test: `test/cli/output-format.test.ts`

- [ ] **Step 1: Add failing human-mode assertions for representative list commands**

```ts
// test/cli/preset.test.ts
it("renders preset list as a shared table with a summary footer", async () => {
  const context = await createTestContext("cli-preset-list-table");
  try {
    await runCli(["init"]);
    const result = await runCli(["preset", "list"]);
    expect(result.stdout).toContain("NAME");
    expect(result.stdout).toContain("DESCRIPTION");
    expect(result.stdout).toContain("run `harnessdeck preset show <name>` for details");
  } finally {
    await context.cleanup();
  }
});

// test/cli/resource.test.ts
it("renders resource list as a shared table with updated timestamps", async () => {
  const context = await createTestContext("cli-resource-list-table");
  try {
    await runCli(["init"]);
    const result = await runCli(["resource", "list"]);
    expect(result.stdout).toContain("TYPE");
    expect(result.stdout).toContain("UPDATED");
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the targeted list tests and confirm they fail against the old logger-driven output**

Run: `bun run test:run test/cli/preset.test.ts test/cli/resource.test.ts -t "table"`

Expected: FAIL because current list commands print prefixed lines instead of boxed tables and summary footers.

- [ ] **Step 3: Replace list-command rendering with `ui.table` while preserving JSON early returns**

```ts
// src/index.ts (inside preset list)
const presets = listPresets();
if (format === "json") {
  printJson(presets);
  return;
}

ui.table({
  columns: [
    { key: "name", header: "NAME", width: 18 },
    { key: "description", header: "DESCRIPTION", width: 44, transform: (value) => value || "—" },
  ],
  rows: presets,
  summary: `${presets.length} presets ${ui.icons.bullet} run \`harnessdeck preset show <name>\` for details`,
  empty: "No presets found.",
});

// src/index.ts (inside resource list)
if (format === "json") {
  printJson(resources);
  return;
}

ui.table({
  columns: [
    { key: "type", header: "TYPE", width: 14 },
    { key: "name", header: "NAME", width: 28 },
    { key: "id", header: "ID", width: 12, transform: (value) => ui.format.shortenId(String(value)) },
    { key: "updated_at", header: "UPDATED", width: 16, transform: (value) => ui.format.formatRelativeTime(String(value)) },
  ],
  rows: resources,
  summary: resources.length === 0 ? undefined : `${resources.length} resources`,
  empty: "No resources found.\n  → Run `harnessdeck project scan` to import some.",
});
```

- [ ] **Step 4: Extend the same table pattern to `platform list`, `plugin installed`, `plugin check`, and `project history`**

```ts
ui.table({
  columns: [
    { key: "status", header: "STATUS", width: 10, style: (value) => value === "outdated" ? ui.theme.warn(value) : value === "current" ? ui.theme.success(value) : ui.theme.muted(value) },
    { key: "platform", header: "PLATFORM", width: 14, style: (value) => ui.theme.muted(value) },
    { key: "ref", header: "REF", width: 28 },
    { key: "latest", header: "LATEST", width: 12 },
  ],
  rows: rows,
  summary: `${rows.length} plugins ${ui.icons.bullet} ${summary.current} current ${ui.icons.bullet} ${summary.outdated} outdated ${ui.icons.bullet} ${summary.unknown} unknown`,
});
```

- [ ] **Step 5: Re-run the list tests plus the JSON-format guard tests**

Run: `bun run test:run test/cli/preset.test.ts test/cli/resource.test.ts test/cli/output-format.test.ts test/cli/plugin.test.ts`

Expected: PASS, proving the human-mode output changed while JSON-mode payloads remained intact.

- [ ] **Step 6: Commit the list-rendering slice**

```bash
git add src/index.ts test/cli/preset.test.ts test/cli/resource.test.ts test/cli/output-format.test.ts test/cli/plugin.test.ts
git commit -m "feat: redesign list command output" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Migrate detail views to panels and sub-tables

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli/preset.test.ts`
- Modify: `test/cli/resource.test.ts`
- Modify: `test/cli/plugin-inventory.test.ts`
- Modify: `test/cli/platforms-status-builtins.test.ts`
- Modify: `test/cli/harness.test.ts`
- Test: `test/cli/preset.test.ts`
- Test: `test/cli/resource.test.ts`
- Test: `test/cli/harness.test.ts`

- [ ] **Step 1: Write failing detail-view tests for one preset panel and one project-status panel**

```ts
it("renders preset show as a detail panel with a resource sub-table", async () => {
  const context = await createTestContext("cli-preset-show-panel");
  try {
    await runCli(["init"]);
    const result = await runCli(["preset", "show", "nextjs-fullstack"]);
    expect(result.stdout).toContain("PRESET");
    expect(result.stdout).toContain("Description");
    expect(result.stdout).toContain("RESOURCES");
  } finally {
    await context.cleanup();
  }
});

it("renders project status as a detail panel with plugin state", async () => {
  const context = await createTestContext("cli-project-status-panel");
  try {
    await runCli(["init"]);
    const result = await runCli(["project", "status", context.projectDir]);
    expect(result.stdout).toContain("PROJECT");
    expect(result.stdout).toContain("Platforms");
    expect(result.stdout).toContain("Plugins");
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the targeted detail tests and confirm they fail against the ad-hoc `console.log` formatting**

Run: `bun run test:run test/cli/preset.test.ts test/cli/harness.test.ts -t "panel"`

Expected: FAIL because the current detail views do not render shared uppercase headers or sub-tables.

- [ ] **Step 3: Convert `preset show`, `resource show`, `plugin show`, `plugin list`, `project status`, `harness status`, and `harness project status` to `ui.panel`**

```ts
// src/index.ts (inside preset show)
if (format === "json") {
  printJson({ preset, resources, plugins });
  return;
}

ui.panel({
  title: ["PRESET", preset.name],
  rows: [
    ["Description", preset.description || "—"],
    ["Tags", preset.tags.length > 0 ? preset.tags.join(", ") : "—"],
    ["ID", ui.format.shortenId(preset.id)],
    ["Resources", `${resources.length} (${summarizeResourceTypes(resources) || "none"})`],
    ["Plugins", plugins.length === 0 ? "(none pinned)" : `${plugins.length}`],
    ["Updated", ui.format.formatRelativeTime(preset.updated_at)],
  ],
});

ui.subheader("RESOURCES");
ui.table({
  columns: [
    { key: "type", header: "TYPE", width: 14 },
    { key: "name", header: "NAME", width: 26 },
    { key: "id", header: "ID", width: 12, transform: (value) => ui.format.shortenId(String(value)) },
  ],
  rows: resources,
  empty: "No resources in this preset.",
});
```

- [ ] **Step 4: Render ambiguous resource selectors as a danger verdict plus a match table**

```ts
if (resolution.status === "ambiguous") {
  ui.danger(`Ambiguous resource selector: ${selector}`);
  ui.table({
    columns: [
      { key: "type", header: "TYPE", width: 14 },
      { key: "name", header: "NAME", width: 26 },
      { key: "id", header: "ID", width: 12, transform: (value) => ui.format.shortenId(String(value)) },
    ],
    rows: resolution.matches,
  });
  process.exitCode = 1;
  return;
}
```

- [ ] **Step 5: Re-run the representative detail tests and the JSON-format test suite**

Run: `bun run test:run test/cli/preset.test.ts test/cli/resource.test.ts test/cli/plugin-inventory.test.ts test/cli/platforms-status-builtins.test.ts test/cli/harness.test.ts test/cli/output-format.test.ts`

Expected: PASS, including unchanged JSON payloads for `status`, `history`, and `init`.

- [ ] **Step 6: Commit the detail-view slice**

```bash
git add src/index.ts test/cli/preset.test.ts test/cli/resource.test.ts test/cli/plugin-inventory.test.ts test/cli/platforms-status-builtins.test.ts test/cli/harness.test.ts test/cli/output-format.test.ts
git commit -m "feat: redesign detail command output" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Migrate diff, drift, and validate flows to diff tables and verdicts

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli/planned-scenarios.test.ts`
- Modify: `test/services/planned-scenarios.test.ts`
- Modify: `test/cli/preset.test.ts`
- Test: `test/cli/preset.test.ts`
- Test: `test/services/planned-scenarios.test.ts`

- [ ] **Step 1: Add failing tests for diff-table and validate-table rendering**

```ts
it("renders preset diff as a compact diff table with a summary footer", async () => {
  const context = await createTestContext("cli-preset-diff-ui");
  try {
    await runCli(["init"]);
    const result = await runCli(["preset", "diff", "nextjs-fullstack", "python-fastapi"]);
    expect(result.stdout).toContain("DIFF");
    expect(result.stdout).toContain("~");
  } finally {
    await context.cleanup();
  }
});

it("renders preset validate warnings as a severity table", async () => {
  const context = await createTestContext("cli-preset-validate-ui");
  try {
    await runCli(["init"]);
    const presetModel = await import("../../src/models/preset.ts");
    presetModel.createPreset({ name: "empty-preset" });
    const result = await runCli(["preset", "validate", "empty-preset"]);
    expect(result.stdout).toContain("SEVERITY");
    expect(result.stdout).toContain("empty_preset");
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Run the targeted diff/validate tests and confirm they fail**

Run: `bun run test:run test/cli/preset.test.ts -t "diff|validate"`

Expected: FAIL because current output uses plain lines instead of a diff table and severity table.

- [ ] **Step 3: Implement `ui.diffTable` and wire diff/drift/validate commands to verdict-first rendering**

```ts
// src/ui/diff.ts
import { icons, theme } from "./theme.js";

export function renderDiffTable(changes: Array<{ kind: "added" | "removed" | "modified"; scope: string; key: string; detail: string }>): string {
  return changes
    .map((change) => {
      const glyph = change.kind === "added" ? icons.added : change.kind === "removed" ? icons.removed : icons.modified;
      const style = change.kind === "added" ? theme.success : change.kind === "removed" ? theme.danger : theme.warn;
      return `  ${style(glyph)} ${change.scope.padEnd(10)} ${change.key.padEnd(28)} ${change.detail}`;
    })
    .join("\n");
}

// src/index.ts (inside preset diff)
if (changes.length === 0) {
  ui.success("No differences.");
  return;
}

console.log(`DIFF  ${left} ↔ ${right}`);
console.log("");
console.log(ui.renderDiffTable(changes));
console.log("");
console.log(`${changes.length} changes ${ui.icons.bullet} ${added} added ${ui.icons.bullet} ${removed} removed ${ui.icons.bullet} ${modified} modified`);
```

- [ ] **Step 4: Re-run the diff/drift/validate coverage**

Run: `bun run test:run test/cli/preset.test.ts test/services/planned-scenarios.test.ts test/cli/planned-scenarios.test.ts`

Expected: PASS, with unchanged exit codes and unchanged JSON-mode behavior.

- [ ] **Step 5: Commit the diff/verdict slice**

```bash
git add src/index.ts src/ui/diff.ts test/cli/preset.test.ts test/services/planned-scenarios.test.ts test/cli/planned-scenarios.test.ts
git commit -m "feat: redesign diff and validation output" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Remap `init` and all single-line mutation commands to the shared verdict language

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli/init.test.ts`
- Modify: `test/cli/preset.test.ts`
- Modify: `test/cli/export-import.test.ts`
- Modify: `test/cli/history-revert.test.ts`
- Modify: `test/cli/harness.test.ts`
- Test: `test/cli/init.test.ts`
- Test: `test/cli/export-import.test.ts`
- Test: `test/cli/history-revert.test.ts`

- [ ] **Step 1: Add failing tests for the renamed init section header and single-line verdict phrasing**

```ts
// test/cli/init.test.ts
expect(result.stdout).toContain("HOME DEFAULTS");
expect(result.stdout).not.toContain("Home defaults overview");

// test/cli/apply.test.ts
expect(applyResult.stdout).toContain("claude-code · wrote 1 file");

// test/cli/export-import.test.ts
expect(result.stdout).toContain("✓ Exported preset");
```

- [ ] **Step 2: Run the targeted init/export/revert tests and confirm they fail**

Run: `bun run test:run test/cli/init.test.ts test/cli/export-import.test.ts test/cli/history-revert.test.ts test/cli/apply.test.ts`

Expected: FAIL because the old narrative and `:`-delimited messages are still in place.

- [ ] **Step 3: Replace the init helpers and mutation success lines with `ui.panel`, `ui.success`, and `ui.warn`**

```ts
// src/index.ts (inside init)
ui.success("Harnessdeck initialized");
console.log("");
ui.kvBlock([
  ["Database", getDbPath()],
  ["Built-in Presets", `seeded ${seededCount} built-in presets`],
]);
console.log("");
ui.subheader("HOME DEFAULTS");
for (const summary of homeDefaults) {
  console.log(`  ${ui.theme.badge(summary.label)} ${summary.folder}`);
  ui.kvBlock(
    [
      ["Contains", summary.contains],
      ["Found", `${summary.count} resources (${summary.breakdown})`],
      ["Status", summary.status],
    ],
    { indent: 4 },
  );
}

// single-line mutation example
ui.success(`Created preset ${ui.theme.accent(name)} ${ui.icons.bullet} ${resourceCount} resources`);
```

- [ ] **Step 4: Re-run the targeted tests**

Run: `bun run test:run test/cli/init.test.ts test/cli/export-import.test.ts test/cli/history-revert.test.ts test/cli/apply.test.ts`

Expected: PASS, including the spec-required `Harnessdeck initialized` phrase and the updated `HOME DEFAULTS` heading.

- [ ] **Step 5: Commit the init/verdict slice**

```bash
git add src/index.ts test/cli/init.test.ts test/cli/export-import.test.ts test/cli/history-revert.test.ts test/cli/apply.test.ts test/cli/harness.test.ts test/cli/preset.test.ts
git commit -m "feat: redesign init and verdict output" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Add progress rendering for long-running commands and refresh the recorded demo

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli/apply.test.ts`
- Modify: `test/cli/scan.test.ts`
- Modify: `test/cli/plugin.test.ts`
- Modify: `README.md`
- Modify: `docs/scenarios/vhs/tapes/01-existing-repo-adoption.tape`
- Modify: `docs/scenarios/vhs/output/01-existing-repo-adoption.gif`
- Test: `test/cli/apply.test.ts`
- Test: `test/cli/scan.test.ts`
- Test: `test/cli/plugin.test.ts`
- Test: `test/services/vhs-scenarios.test.ts`

- [ ] **Step 1: Add failing tests that assert the resolved verdict lines for spinner-driven commands in non-TTY mode**

```ts
// test/cli/scan.test.ts
it("renders per-platform scan verdicts without spinner frames in tests", async () => {
  const context = await createTestContext("cli-scan-progress");
  try {
    const result = await runCli(["project", "scan", context.projectDir, "--dry-run"]);
    expect(result.stdout).toContain("[dry run]");
    expect(result.stdout).toContain("imported");
    expect(result.stdout).not.toContain("⠋");
  } finally {
    await context.cleanup();
  }
});

// test/cli/apply.test.ts
expect(applyResult.stdout).toContain("claude-code · wrote 1 file");
expect(applyResult.stdout).not.toContain("⠋");
```

- [ ] **Step 2: Run the progress-command tests and confirm they fail**

Run: `bun run test:run test/cli/apply.test.ts test/cli/scan.test.ts test/cli/plugin.test.ts`

Expected: FAIL because the old output uses mixed logger lines and no unified verdict phrasing.

- [ ] **Step 3: Implement a spinner wrapper that no-ops in non-TTY/JSON mode and wire the progress commands**

```ts
// src/ui/progress.ts
import ora from "ora";
import { isTty } from "./theme.js";

export function progress(label: string) {
  const spinner = isTty() && !process.env.NO_COLOR ? ora({ text: label }).start() : null;

  return {
    step(message: string) {
      if (spinner) spinner.text = message;
    },
    succeed(message: string) {
      if (spinner) spinner.succeed(message);
      else console.log(`✓ ${message}`);
    },
    fail(message: string) {
      if (spinner) spinner.fail(message);
      else console.error(`✗ ${message}`);
    },
    stop() {
      spinner?.stop();
    },
  };
}

// src/index.ts (inside project apply)
const spinner = ui.spinner(`Applying ${presetName}…`);
for (const result of generated) {
  spinner.step(`Applying ${result.platformId}…`);
  writeFiles(result.files, projectRoot);
  spinner.succeed(`${result.platformId} ${ui.icons.bullet} wrote ${ui.format.formatCount(result.files.length, "file")}`);
  for (const file of result.files) {
    console.log(`  ${ui.icons.bullet} ${file.path}`);
  }
}
```

- [ ] **Step 4: Re-run the progress tests and then regenerate the walkthrough GIF**

Run: `bun run test:run test/cli/apply.test.ts test/cli/scan.test.ts test/cli/plugin.test.ts && bun run docs:vhs -- --scenario 01-existing-repo-adoption && bun run test:run test/services/vhs-scenarios.test.ts`

Expected: PASS, with spinner frames absent from tests and the recorded tape/GIF matching the new human output.

- [ ] **Step 5: Update the README snippets to match the redesigned human-mode output and commit**

```md
## Demo

[![HarnessDeck walkthrough](docs/scenarios/vhs/output/01-existing-repo-adoption.gif)](docs/scenarios/vhs/walkthroughs/01-existing-repo-adoption.md)

✓ Harnessdeck initialized
HOME DEFAULTS
  Claude Code   ~/.claude
  ...
```

```bash
git add src/index.ts src/ui/progress.ts test/cli/apply.test.ts test/cli/scan.test.ts test/cli/plugin.test.ts README.md docs/scenarios/vhs/tapes/01-existing-repo-adoption.tape docs/scenarios/vhs/output/01-existing-repo-adoption.gif test/services/vhs-scenarios.test.ts
git commit -m "feat: redesign progress command output" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Override help output and add the global `--no-color` flag

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cli/help-organization.test.ts`
- Modify: `test/cli/output-format.test.ts`
- Test: `test/cli/help-organization.test.ts`

- [ ] **Step 1: Write failing help-format and no-color tests**

```ts
it("renders grouped themed help and exposes --no-color", async () => {
  const result = await runCli(["--help"]);
  expect(result.stdout).toContain("USAGE");
  expect(result.stdout).toContain("COMMANDS");
  expect(result.stdout).toContain("--no-color");
  expect(result.stdout).not.toContain("help [command]");
});

it("shows hidden aliases only when --help --all is used", async () => {
  const defaultHelp = await runCli(["--help"]);
  const allHelp = await runCli(["--help", "--all"]);
  expect(defaultHelp.stdout).not.toContain("apply [options]");
  expect(allHelp.stdout).toContain("apply [options]");
});
```

- [ ] **Step 2: Run the targeted help tests and confirm they fail against Commander’s default formatter**

Run: `bun run test:run test/cli/help-organization.test.ts`

Expected: FAIL because help output is currently Commander’s built-in format and there is no global `--no-color` flag.

- [ ] **Step 3: Add the global flag and override help rendering through a shared formatter**

```ts
program
  .option("--no-color", "Disable color output")
  .hook("preAction", (command) => {
    const opts = command.optsWithGlobals();
    if (opts.noColor) {
      process.env.NO_COLOR = "1";
      chalk.level = 0;
    }
  })
  .configureHelp({
    formatHelp: (cmd, helper) => {
      const lines = [
        "harnessdeck — preset-based AI coding assistant configuration manager",
        "",
        ui.theme.muted("USAGE"),
        `  ${helper.commandUsage(cmd)}`,
        "",
        ui.theme.muted("COMMANDS"),
        renderGroupedCommandHelp(cmd, helper, { showHidden: process.argv.includes("--all") }),
      ];
      return lines.join("\n");
    },
  });
```

- [ ] **Step 4: Re-run the help and JSON-format tests**

Run: `bun run test:run test/cli/help-organization.test.ts test/cli/output-format.test.ts`

Expected: PASS, with grouped help output and no JSON regressions.

- [ ] **Step 5: Commit the help/flag slice**

```bash
git add src/index.ts test/cli/help-organization.test.ts test/cli/output-format.test.ts
git commit -m "feat: redesign help output" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Remove the logger shim, eliminate direct `chalk` rendering outside `src/ui/`, and run final verification

**Files:**
- Modify: `src/index.ts`
- Delete: `src/utils/logger.ts`
- Modify: `test/cli/*.test.ts` (only if cleanup changes import behavior or exact strings)
- Test: `bun run lint`
- Test: `bun run typecheck`
- Test: `bun run test:run`
- Test: `bun run build`

- [ ] **Step 1: Add a failing cleanup assertion that `src/index.ts` no longer imports `chalk` or `log` directly**

```ts
// test/ui/cleanup.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("CLI visual redesign cleanup", () => {
  it("keeps direct chalk usage inside src/ui only", () => {
    const indexSource = readFileSync(resolve(import.meta.dirname, "../../src/index.ts"), "utf-8");
    expect(indexSource).not.toContain('from "chalk"');
    expect(indexSource).not.toContain("log.");
  });
});
```

- [ ] **Step 2: Run the cleanup test and confirm it fails before the final migration**

Run: `bun run test:run test/ui/cleanup.test.ts`

Expected: FAIL because `src/index.ts` still imports `chalk` and uses the compatibility `log` shim.

- [ ] **Step 3: Remove the shim and finish the call-site cleanup**

```ts
// src/index.ts
import { ui } from "./ui/index.js";
// remove: import chalk from "chalk";
// remove: import { log } from "./utils/logger.js";

// replace remaining log/chalk calls with ui helpers
ui.success("Harnessdeck initialized");
ui.warn("Plugin version mismatch: ...");
ui.danger("Preset not found: missing-preset", {
  hint: "Run `harnessdeck preset list` to see available presets.",
});
```

```bash
git rm src/utils/logger.ts
```

- [ ] **Step 4: Run full repository verification**

Run: `bun run preflight`

Expected: PASS (`lint`, `typecheck`, `test:run`, and `build` all succeed).

- [ ] **Step 5: Commit the cleanup slice**

```bash
git add src/index.ts test/ui/cleanup.test.ts
git commit -m "refactor: finish CLI visual redesign cleanup" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review

- **Spec coverage:** Task 1 covers the new `src/ui/` module, theme, format helpers, new deps, and logger shim. Tasks 2-7 cover every command-family migration from the spec’s phase table, including list/detail/diff/verdict/progress/help, plus `--no-color`, non-TTY behavior, README, and VHS refresh. Task 8 covers the final logger removal and `chalk` containment.
- **Placeholder scan:** No `TBD`, `TODO`, or “implement later” markers remain; each task names exact files, concrete test commands, and representative code to add.
- **Type consistency:** The plan uses one public namespace (`ui`) with consistent helper names (`ui.table`, `ui.panel`, `ui.diffTable`, `ui.spinner`, `ui.success`, `ui.warn`, `ui.danger`, `ui.format.*`). It intentionally keeps relative imports (`./ui/index.js`) instead of introducing an unplanned `@/ui` path alias, matching the current `tsconfig.json`.
