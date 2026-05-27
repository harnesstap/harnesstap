# CLI Color Strategy Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the CLI color system so help/status/table output has clearer hierarchy, restrained semantic color, and a stable non-spinner path in tests.

**Architecture:** Keep all styling centralized in `src/ui/theme.ts`, but split today’s generic tokens into explicit role-based helpers. Then rewire the renderers (`status`, `progress`, `section`, `table`, and CLI help output in `src/index.ts`) to compose prefixes, labels, and entities instead of painting whole lines. Treat Bun test runs as non-spinner output so the test harness remains deterministic.

**Tech Stack:** TypeScript, Bun test runner, Chalk, Ora, Commander, cli-table3

---

### Task 1: Stabilize progress behavior in test environments

**Files:**
- Modify: `src/ui/progress.ts`
- Modify: `test/ui/progress.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("suppresses the spinner in test mode even when stdout is a TTY", async () => {
  const originalStdoutIsTTY = process.stdout.isTTY;
  const originalNodeEnv = process.env.NODE_ENV;
  const lines: string[] = [];
  const origLog = console.log;

  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
  process.env.NODE_ENV = "test";
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));

  try {
    const { createProgress } = await import("../../src/ui/progress.ts");
    const handle = createProgress("doing work");
    handle.succeed("work done");
  } finally {
    console.log = origLog;
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalStdoutIsTTY,
      configurable: true,
    });
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }

  expect(lines.some((line) => line.includes("work done"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/ui/progress.test.ts`
Expected: FAIL because `createProgress()` starts `ora` whenever `process.stdout.isTTY === true`, so the verdict bypasses the intercepted `console.log`.

- [ ] **Step 3: Write minimal implementation**

```ts
function shouldAnimateProgress(): boolean {
  return isTty() && process.env.NODE_ENV !== "test";
}

export function createProgress(message: string): ProgressHandle {
  let spinner: Ora | null = null;
  if (shouldAnimateProgress()) {
    spinner = ora(message).start();
  }
  // existing succeed/fail/stop body stays the same
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/ui/progress.test.ts`
Expected: PASS with no `ora` concurrent-spinner warnings.

- [ ] **Step 5: Commit**

```bash
git add src/ui/progress.ts test/ui/progress.test.ts
git commit -m "fix: suppress progress spinners in tests"
```

### Task 2: Expand the theme into explicit UI roles

**Files:**
- Modify: `src/ui/theme.ts`
- Modify: `test/ui/theme.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("styles headings and commands with distinct role tokens when color is enabled", async () => {
  const originalNoColor = process.env.NO_COLOR;
  delete process.env.NO_COLOR;

  const { theme } = await import("../../src/ui/theme.ts");
  const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);

  try {
    expect(theme.heading("USAGE")).toMatch(ansiEscapeRegex);
    expect(theme.command("hd project apply")).toMatch(ansiEscapeRegex);
    expect(theme.entity("nextjs-fullstack")).toMatch(ansiEscapeRegex);
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  }
});

it("keeps role tokens plain when NO_COLOR is set", async () => {
  const originalNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";

  try {
    const { theme } = await import("../../src/ui/theme.ts");
    expect(theme.heading("USAGE")).toBe("USAGE");
    expect(theme.command("--platform")).toBe("--platform");
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/ui/theme.test.ts`
Expected: FAIL because `heading`, `command`, and `entity` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export const theme = {
  primary: maybe((value) => chalk.bold(value)),
  heading: maybe((value) => chalk.bold.hex("#7dd3fc")(value)),
  label: maybe((value) => chalk.bold.hex("#94a3b8")(value)),
  command: maybe((value) => chalk.hex("#60a5fa")(value)),
  flag: maybe((value) => chalk.hex("#60a5fa")(value)),
  entity: maybe((value) => chalk.bold.hex("#c4b5fd")(value)),
  path: maybe((value) => chalk.hex("#38bdf8")(value)),
  info: maybe((value) => chalk.hex("#38bdf8")(value)),
  muted: maybe((value) => chalk.hex("#6b7280")(value)),
  border: maybe((value) => chalk.hex("#475569")(value)),
  success: maybe((value) => chalk.hex("#10b981")(value)),
  warn: maybe((value) => chalk.hex("#f59e0b")(value)),
  danger: maybe((value) => chalk.hex("#ef4444")(value)),
  badge: maybe((value) => chalk.bgHex("#1d4ed8").white.bold(` ${value} `)),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/theme.test.ts`
Expected: PASS, with old theme behavior still available through compatible tokens such as `primary`, `muted`, `success`, `warn`, `danger`, and `badge`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/theme.ts test/ui/theme.test.ts
git commit -m "feat: add role-based CLI theme tokens"
```

### Task 3: Apply role-based styling to help, status, sections, and tables

**Files:**
- Modify: `src/ui/status.ts`
- Modify: `src/ui/section.ts`
- Modify: `src/ui/table.ts`
- Modify: `src/index.ts`
- Test: `test/ui/status.test.ts`
- Test: `test/ui/section.test.ts`
- Test: `test/ui/table.test.ts`
- Test: `test/cli/help-organization.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("renders success messages with a colored verdict prefix and muted hint", () => {
  const output = renderSuccess('Applied preset "team"', {
    hint: "Snapshot saved",
  });
  expect(output).toContain("✓");
  expect(output).toContain('Applied preset "team"');
  expect(output).toContain("Snapshot saved");
});

it("renders headers and rules using the new section roles", () => {
  expect(renderHeader("USAGE")).toContain("USAGE");
  expect(renderSubheader("OPTIONS")).toContain("OPTIONS");
  expect(renderRule()).toContain("─");
});

it("renders help with the visible command and option labels intact", async () => {
  const result = await runCli(["--help"]);
  expect(result.stdout).toContain("USAGE");
  expect(result.stdout).toContain("COMMANDS");
  expect(result.stdout).toContain("--no-color");
  expect(result.stdout).toContain("hd [options] [command]");
});
```

- [ ] **Step 2: Run targeted tests to verify they fail or expose the old hierarchy**

Run: `bun test test/ui/status.test.ts test/ui/section.test.ts test/ui/table.test.ts test/cli/help-organization.test.ts`
Expected: Existing assertions pass, but new assertions fail until the renderers adopt the role-based theme helpers.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/ui/status.ts
function renderVerdict(prefix: string, message: string, tone: ThemeFn): string {
  return `${tone(prefix)} ${theme.entity(message)}`;
}

export function renderSuccess(message: string, opts?: { hint?: string }): string {
  const headline = renderVerdict(`${icons.success} Applied`, message, theme.success);
  return opts?.hint ? `${headline}\n  ${theme.muted(`${icons.hint} ${opts.hint}`)}` : headline;
}

// src/ui/section.ts
export function renderHeader(title: string): string {
  return theme.heading(title);
}

export function renderSubheader(title: string): string {
  return theme.label(title);
}

export function renderRule(): string {
  return theme.border("─".repeat(terminalColumns()));
}
```

```ts
// src/index.ts help formatter excerpts
ui.theme.heading("USAGE");
`  ${ui.theme.command(resolveInvocationName())} [options] [command]`;
`  ${ui.theme.flag("--no-color")}  disable color output`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/ui/status.test.ts test/ui/section.test.ts test/ui/table.test.ts test/cli/help-organization.test.ts`
Expected: PASS with help/status output still containing the same visible labels while benefiting from ANSI styling in TTY mode and plain text when `NO_COLOR=1`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/status.ts src/ui/section.ts src/ui/table.ts src/index.ts \
  test/ui/status.test.ts test/ui/section.test.ts test/ui/table.test.ts test/cli/help-organization.test.ts
git commit -m "feat: apply refreshed CLI color roles"
```

### Task 4: Verify end-to-end, push, and open the pull request

**Files:**
- Modify: `.gitignore`
- Review: `docs/superpowers/plans/2026-05-26-cli-color-strategy-refresh.md`

- [ ] **Step 1: Run full verification**

Run: `bun run preflight`
Expected: PASS for lint, typecheck, tests, and build.

- [ ] **Step 2: Inspect help output manually**

Run: `bun src/index.ts --help`
Expected: Help text shows the same content as before, but with clearer role-based emphasis for the binary name, section labels, and options.

- [ ] **Step 3: Commit the remaining changes**

```bash
git add .gitignore docs/superpowers/plans/2026-05-26-cli-color-strategy-refresh.md
git commit -m "chore: track CLI color refresh worktree and plan"
```

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feat/cli-color-strategy-refresh
```

- [ ] **Step 5: Open the pull request**

```bash
gh pr create \
  --base main \
  --head feat/cli-color-strategy-refresh \
  --title "feat: refresh CLI color strategy" \
  --body "## Summary\n- add role-based CLI theme tokens\n- apply refined color hierarchy to help/status/table output\n- suppress progress spinners in test mode\n\n## Testing\n- bun run preflight"
```

- [ ] **Step 6: Wait for CI and confirm success**

Run: `gh pr checks --watch`
Expected: All required checks finish with passing status before completion.
