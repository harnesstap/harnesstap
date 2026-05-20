# Plugin Check and Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-platform `harnessdeck plugin list|check|update|refresh` with configurable refresh cache policy, Claude native updates, and Cursor git best-effort updates.

**Architecture:** Plugin provider registry per harness; shared config (`~/.harnessdeck/config.json`) and refresh cache; orchestration in `plugin-lifecycle` service; CLI command group in `index.ts`. Build on branch `cursor/preset-marketplace-config` Claude preset work; inventory DB (phase 3) follows lifecycle spec.

**Tech Stack:** TypeScript, Commander, better-sqlite3, Vitest, Bun, child_process for `claude plugin`, simple-git or `git` CLI for cache refresh

**Spec:** [docs/superpowers/specs/2026-05-19-plugin-lifecycle-design.md](../specs/2026-05-19-plugin-lifecycle-design.md)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/config/settings.ts` | Load/validate `~/.harnessdeck/config.json` |
| `src/plugins/types.ts` | Shared plugin types |
| `src/plugins/refresh-cache.ts` | Read/write `plugin-refresh-cache.json`, staleness checks |
| `src/plugins/refresh.ts` | Git fetch/checkout helpers for FS providers |
| `src/plugins/registry.ts` | Platform → provider map |
| `src/plugins/providers/claude-code.ts` | Claude inventory, check, native update |
| `src/plugins/providers/cursor.ts` | Cursor cache scan, git update |
| `src/services/plugin-lifecycle.ts` | Multi-platform orchestration, refresh policy |
| `src/utils/output-format.ts` | `--format human\|json` helper |
| `src/index.ts` | `plugin` command group |
| `test/plugins/*.test.ts` | Unit tests with fixtures |
| `test/cli/plugin.test.ts` | CLI integration tests |

---

### Task 1: User settings and refresh cache

**Files:**
- Create: `src/config/settings.ts`
- Create: `src/plugins/refresh-cache.ts`
- Create: `test/config/settings.test.ts`
- Create: `test/plugins/refresh-cache.test.ts`

- [ ] **Step 1: Write failing settings test**

```ts
import { describe, it, expect } from "vitest";
import { loadSettings } from "../../src/config/settings.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadSettings", () => {
  it("defaults refreshMaxAgeHours to 24 when config missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "hd-config-"));
    const settings = loadSettings(dir);
    expect(settings.plugins.refreshMaxAgeHours).toBe(24);
  });

  it("reads refreshMaxAgeHours from config.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "hd-config-"));
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ plugins: { refreshMaxAgeHours: 48 } }),
    );
    expect(loadSettings(dir).plugins.refreshMaxAgeHours).toBe(48);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun run test:run test/config/settings.test.ts`

- [ ] **Step 3: Implement settings loader**

```ts
// src/config/settings.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface HarnessdeckSettings {
  plugins: { refreshMaxAgeHours: number };
}

const DEFAULTS: HarnessdeckSettings = {
  plugins: { refreshMaxAgeHours: 24 },
};

export function loadSettings(harnessdeckDir: string): HarnessdeckSettings {
  const path = join(harnessdeckDir, "config.json");
  if (!existsSync(path)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<HarnessdeckSettings>;
    const hours = raw.plugins?.refreshMaxAgeHours;
    return {
      plugins: {
        refreshMaxAgeHours:
          typeof hours === "number" && hours > 0 ? hours : DEFAULTS.plugins.refreshMaxAgeHours,
      },
    };
  } catch {
    return DEFAULTS;
  }
}
```

- [ ] **Step 4: Write failing refresh-cache test**

```ts
import { describe, it, expect } from "vitest";
import { isSourceStale, markSourceRefreshed } from "../../src/plugins/refresh-cache.ts";

describe("refresh-cache", () => {
  it("treats missing entry as stale", () => {
    expect(isSourceStale({}, "claude:foo", 24)).toBe(true);
  });

  it("returns not stale within max age", () => {
    const now = new Date();
    const cache = markSourceRefreshed({}, "claude:foo", now);
    expect(isSourceStale(cache, "claude:foo", 24, now)).toBe(false);
  });
});
```

- [ ] **Step 5: Implement refresh-cache**

Implement `loadRefreshCache`, `saveRefreshCache`, `isSourceStale`, `markSourceRefreshed`, `getSourcesToRefresh(sourceKeys, cache, maxAgeHours, forceRefresh)`.

- [ ] **Step 6: Run tests — expect PASS**

Run: `bun run test:run test/config/settings.test.ts test/plugins/refresh-cache.test.ts`

---

### Task 2: Plugin types and registry

**Files:**
- Create: `src/plugins/types.ts`
- Create: `src/plugins/registry.ts`
- Create: `test/plugins/registry.test.ts`

- [ ] **Step 1: Add types** (`PluginScope`, `PluginInstall`, `PluginCheckResult`, `PluginUpdateResult`, `PluginProvider`, `PluginContext`)

- [ ] **Step 2: Registry returns `claude-code` and `cursor` providers; null for unknown platforms**

```ts
export function getPluginProvider(platformId: string): PluginProvider | undefined {
  return providers.get(platformId);
}

export function getPluginProviders(platformIds?: string[]): PluginProvider[] {
  const ids = platformIds ?? ["claude-code", "cursor"];
  return ids.map((id) => getPluginProvider(id)).filter((p): p is PluginProvider => !!p);
}
```

- [ ] **Step 3: Test registry lists two providers**

---

### Task 3: Output format utility

**Files:**
- Create: `src/utils/output-format.ts`
- Create: `test/utils/output-format.test.ts`

- [ ] **Step 1: Implement `parseOutputFormat(opts)` → `'human' | 'json'`**, throw on invalid

- [ ] **Step 2: Implement `printJson(value)`** — `console.log(JSON.stringify(value, null, 2))`

- [ ] **Step 3: Tests for parse and invalid format**

---

### Task 4: Claude Code provider

**Files:**
- Create: `src/plugins/providers/claude-code.ts`
- Create: `test/fixtures/claude-plugins-home/installed_plugins.json`
- Create: `test/fixtures/claude-plugins-home/marketplaces/demo/.claude-plugin/marketplace.json`
- Create: `test/plugins/claude-code-provider.test.ts`

- [ ] **Step 1: Write test — list reads installed_plugins.json**

Fixture `installed_plugins.json` with one plugin `demo@demo-market` version `1.0.0`.

- [ ] **Step 2: Implement `list()`** — parse `installed_plugins.json`, map scopes, read `plugin.json` from `installPath` when present

- [ ] **Step 3: Write test — check marks outdated when marketplace sha differs**

Mock `runClaude(args)` helper (injectable) returning marketplace JSON / list JSON.

- [ ] **Step 4: Implement `check()`**

1. Resolve sources to refresh via refresh policy
2. Call `claude plugin marketplace update` for stale sources (injectable `runClaude`)
3. Compare installed version/gitCommitSha to marketplace entry

- [ ] **Step 5: Write test — update calls `claude plugin update demo@demo-market`**

- [ ] **Step 6: Implement `update()`** with `--scope` passthrough

- [ ] **Step 7: Run tests**

Run: `bun run test:run test/plugins/claude-code-provider.test.ts`

---

### Task 5: Cursor filesystem provider

**Files:**
- Create: `src/plugins/providers/cursor.ts`
- Create: `src/plugins/refresh.ts`
- Create: `test/fixtures/cursor-plugins-home/cache/cursor-public/demo/abc123/.cursor-plugin/plugin.json`
- Create: `test/plugins/cursor-provider.test.ts`

- [ ] **Step 1: Implement cache walker** — `~/.cursor/plugins/cache/{marketplace}/{plugin}/{hash}/.cursor-plugin/plugin.json`

- [ ] **Step 2: Write test — list finds demo plugin**

- [ ] **Step 3: Implement `refresh.ts` git helper** — `refreshGitSource(url, ref, targetDir)` using `git clone` or `git -C fetch && checkout` (injectable `runGit` for tests)

- [ ] **Step 4: Write test — check outdated when remote sha != cache folder name** (mock git)

- [ ] **Step 5: Implement `check()` and `update()`** — update replaces/creates new hash directory; record refresh cache key `cursor:repo:{url}`

- [ ] **Step 6: Run tests**

---

### Task 6: Lifecycle orchestration service

**Files:**
- Create: `src/services/plugin-lifecycle.ts`
- Create: `test/services/plugin-lifecycle.test.ts`

- [ ] **Step 1: `listPlugins(opts)`** — merge results from providers, add `unsupported_platforms`

- [ ] **Step 2: `checkPlugins(opts)`** — apply refresh policy across providers; return `{ refreshed_sources, results, summary, unsupported_platforms }`

- [ ] **Step 3: `updatePlugins(opts)`** — filter outdated (or single ref); respect `--yes`; aggregate exit code

- [ ] **Step 4: `refreshPluginSources(opts)`** — force refresh all sources

- [ ] **Step 5: Tests with mocked providers**

---

### Task 7: CLI `plugin` command group

**Files:**
- Modify: `src/index.ts`
- Create: `test/cli/plugin.test.ts`
- Modify: `README.md` (short section)

- [ ] **Step 1: Add command group**

```ts
const pluginCmd = program.command("plugin").description("List, check, and update harness plugins");
pluginCmd.command("list").argument("[path]", ".", ".")...
pluginCmd.command("check")...
pluginCmd.command("update").argument("[ref]")...
pluginCmd.command("refresh")...
```

Shared options: `--format`, `--platform`, `--scope`, `--refresh`, `--yes`, `--all`, `--continue`

- [ ] **Step 2: Write CLI test — `plugin check --format json` returns summary object** (mock lifecycle or use fixtures + inject home dir via env `HARNESSDECK_HOME` — add env support in `getDbPath` / settings dir helper)

- [ ] **Step 3: Add `HARNESSDECK_HOME` override** in `src/db/connection.ts` or new `src/config/paths.ts` for tests:

```ts
export function getHarnessdeckDir(): string {
  return process.env.HARNESSDECK_HOME ?? join(homedir(), ".harnessdeck");
}
```

- [ ] **Step 4: Human output for check** — table with platform, ref, version, latest, scope, status

- [ ] **Step 5: Exit code 1 from check when outdated > 0**

- [ ] **Step 6: Run `bun run test:run test/cli/plugin.test.ts`**

---

### Task 8: Wire scan/status summaries (minimal)

**Files:**
- Modify: `src/index.ts` (`handleScanCommand`, `handleProjectStatusCommand`)
- Modify: `src/services/scanner.ts` (optional hook)

- [ ] **Step 1: After scan success, print plugin count** via `listPlugins({ projectRoot, platformIds: ['claude-code'] })` — "Plugins: N installed (M outdated)" if quick check without network is cheap; otherwise count only

- [ ] **Step 2: `project status` plugin subsection** — one line per platform with installed count

- [ ] **Step 3: CLI test for status containing plugin line** (fixture project)

---

### Task 9: Documentation and SPEC

**Files:**
- Modify: `SPEC.md`
- Modify: `README.md`

- [ ] **Step 1: Add command table rows** for `plugin list|show|check|update|refresh`

- [ ] **Step 2: Document `~/.harnessdeck/config.json` and refresh behavior**

- [ ] **Step 3: Run full preflight**

Run: `bun run preflight`

---

## Phase 3 (separate follow-up plan)

Inventory DB (`project_plugin_state`, `preset_plugins`), bundle v2, and preset apply validation remain as defined in [2026-05-19-claude-plugin-inventory-design.md](../specs/2026-05-19-claude-plugin-inventory-design.md). Do not block plugin check/update on phase 3.

---

## Plan self-review (spec coverage)

| Spec requirement | Task |
|------------------|------|
| Config `refreshMaxAgeHours` | Task 1 |
| Refresh cache + stale auto-refresh | Task 1, 6 |
| `--refresh` override | Task 6, 7 |
| Claude native update | Task 4 |
| Cursor git best-effort | Task 5 |
| All scopes | Task 4 (Claude); Cursor user/project as discoverable |
| `--format json` | Task 3, 7 |
| Unsupported platforms skipped | Task 2, 6 |
| `plugin list\|check\|update\|refresh` | Task 7 |
| Managed update-only | Task 4 — reject install in update if scope managed + not installed |

No placeholders remain in task steps above; engineers fill exact assertion strings when implementing git mock fixtures.
