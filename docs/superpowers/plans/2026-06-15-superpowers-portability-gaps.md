# Superpowers portability gaps — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close gaps found stress-testing [obra/superpowers](https://github.com/obra/superpowers) so HarnessDeck mirrors, imports, and applies multi-manifest plugin repos (shared `skills/`, harness instructions, per-host hooks) without duplicate resources, false platform detection, or silent skill loss on `project mirror --reference auto`.

**Architecture:** Five focused changes on the ponytail portability branch (`feat/ponytail-portability-gaps`): (1) **mirror reference merging** — `auto` combines main-harness scan with plugin-source when skills live only under repo-root `skills/`; (2) **import deduplication** — drop harness-scan skills whose `source` path already came from plugin-source import; (3) **multi-manifest hooks** — collect hook files from every plugin manifest at the repo root, not only the first manifest in precedence order; (4) **surface detection** — warn on OpenCode `.js` server plugins; (5) **platform detection** — ignore symlinked `AGENTS.md` when detecting harnesses. Optional phase 6 documents droid/antigravity install-path limits. Each phase ships with tests using a trimmed `test/fixtures/superpowers/` fixture.

**Tech stack:** TypeScript, Bun test runner, existing scanner/plugin-import/project-sync/harness-surface-gaps modules.

**Reference analysis:** Superpowers compatibility review 2026-06-15 (post-ponytail PR #58). Baseline branch: `feat/ponytail-portability-gaps` @ `158e752`.

**Prerequisite:** Merge or branch from `feat/ponytail-portability-gaps` (dual-mode scan, mirror warnings, plugin manifest detection).

---

## File map (planned changes)

| Area | Primary files |
|------|----------------|
| Mirror reference merge | `src/services/project-sync.ts`, `src/services/reference-resources.ts` (new) |
| Import deduplication | `src/services/scanner.ts`, `src/services/scan-dedup.ts` (new) |
| Multi-manifest hooks | `src/services/plugin-source-import.ts` |
| OpenCode surface warnings | `src/services/harness-surface-gaps.ts` |
| Platform detection | `src/services/scanner.ts` |
| Docs | `docs/portability-limits.md`, `docs/scenarios/details/33-mirror-plugin-fallback.md`, `SPEC.md` |
| Tests | `test/fixtures/superpowers/`, `test/services/project-sync.test.ts`, `test/services/scanner-dual-mode.test.ts`, `test/services/plugin-source-import.test.ts`, `test/services/harness-surface-gaps.test.ts`, `test/integration/superpowers-portability.test.ts` |

---

## Fixture: `test/fixtures/superpowers/minimal/`

Hand-trimmed layout (no full upstream clone in CI):

```
minimal/
  AGENTS.md              -> symlink to CLAUDE.md
  CLAUDE.md              # short instruction body
  GEMINI.md              # short instruction body
  gemini-extension.json  # { "contextFileName": "GEMINI.md", ... }
  .claude-plugin/plugin.json
  .cursor-plugin/plugin.json   # hooks: ./hooks/hooks-cursor.json
  .codex-plugin/plugin.json
  skills/
    alpha/SKILL.md
    beta/SKILL.md
  hooks/
    hooks.json             # Claude SessionStart
    hooks-cursor.json      # Cursor sessionStart
  .opencode/plugins/bootstrap.js   # empty or minimal stub
```

Copy patterns from `test/fixtures/ponytail/minimal/` and `test/fixtures/ponytail/gemini/`.

---

## Phase 1 — Mirror auto merges plugin skills (high impact)

### Task 1: Merge main + plugin reference resources for `--reference auto`

**Problem:** `resolveReferenceResources` returns main-harness scan as soon as `mainScan.resources.length > 0`. Superpowers has `CLAUDE.md` (instruction) but skills only under repo-root `skills/` (plugin layout). `project mirror --reference auto` syncs ~32 files; `--reference plugin` syncs ~422.

**Files:**
- Create: `src/services/reference-resources.ts`
- Modify: `src/services/project-sync.ts`
- Test: `test/services/project-sync.test.ts`
- Fixture: `test/fixtures/superpowers/minimal/`

- [ ] **Step 1: Write failing test — auto merges plugin skills when main lacks skills**

```typescript
// test/services/project-sync.test.ts (add describe block)
import { join } from "node:path";

const superpowersFixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

describe("syncProject superpowers-style auto merge", () => {
  it("merges plugin skills when main harness has instructions only", async () => {
    const context = await createInitializedTestContext("project-sync-sp-auto");
    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const auto = await syncProject({
        projectRoot: superpowersFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "auto",
      });
      const pluginOnly = await syncProject({
        projectRoot: superpowersFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "plugin",
      });
      expect(auto.files_written).toBeGreaterThan(pluginOnly.files_written * 0.5);
      expect(auto.files_written).toBeGreaterThan(10);
    } finally {
      await context.cleanup();
    }
  });

  it("main strategy still uses main harness only", async () => {
    const context = await createInitializedTestContext("project-sync-sp-main");
    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const main = await syncProject({
        projectRoot: superpowersFixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "main",
      });
      expect(main.files_written).toBeLessThan(10);
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test test/services/project-sync.test.ts -t "superpowers-style"`
Expected: FAIL — `auto.files_written` too low (instruction-only mirror).

- [ ] **Step 3: Extract merge helper**

Create `src/services/reference-resources.ts`:

```typescript
import type { ResourceCreateInput } from "../types.js";

export function resourceIdentity(
  resource: Pick<ResourceCreateInput, "type" | "name" | "namespace">,
): string {
  return `${resource.type}:${resource.name}:${resource.namespace ?? ""}`;
}

/** Merge plugin resources into main scan without duplicate type:name:namespace keys. */
export function mergeReferenceResourceInputs(
  main: ResourceCreateInput[],
  supplemental: ResourceCreateInput[],
): ResourceCreateInput[] {
  const seen = new Set(main.map(resourceIdentity));
  const merged = [...main];
  for (const resource of supplemental) {
    const key = resourceIdentity(resource);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(resource);
  }
  return merged;
}

export function mainScanLacksPluginSkills(
  main: ResourceCreateInput[],
  plugin: ResourceCreateInput[],
): boolean {
  const mainHasSkills = main.some((r) => r.type === "skill");
  const pluginHasSkills = plugin.some((r) => r.type === "skill");
  return !mainHasSkills && pluginHasSkills;
}
```

- [ ] **Step 4: Use helper in `resolveReferenceResources`**

In `src/services/project-sync.ts`, import helpers and replace the `auto` early-return block (lines ~231–237):

```typescript
import {
  mergeReferenceResourceInputs,
  mainScanLacksPluginSkills,
} from "./reference-resources.js";

// inside resolveReferenceResources, after mainScan is loaded:
if (strategy === "main") {
  if (mainScan.resources.length === 0) {
    throw emptyReferenceError(mainHarness, projectRoot);
  }
  return toSyncResources(mainScan.resources);
}

if (mainScan.resources.length > 0) {
  if (
    strategy === "auto" &&
    hasPluginSourceLayout(projectRoot)
  ) {
    const pluginResources = await scanPluginReferenceResources(projectRoot);
    if (mainScanLacksPluginSkills(mainScan.resources, pluginResources)) {
      return toSyncResources(
        mergeReferenceResourceInputs(mainScan.resources, pluginResources),
      );
    }
  }
  return toSyncResources(mainScan.resources);
}

// existing plugin → agents fallback chain unchanged
```

- [ ] **Step 5: Run tests**

Run: `bun test test/services/project-sync.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/reference-resources.ts src/services/project-sync.ts test/fixtures/superpowers/ test/services/project-sync.test.ts
git commit -m "fix(mirror): merge plugin skills in auto reference when main lacks skills"
```

---

## Phase 2 — Import deduplication (medium impact)

### Task 2: Drop duplicate harness-scan skills covered by plugin-source

**Problem:** `persistMergedProjectScan` dedupes by `type:name:namespace`. Gemini harness scan imports `skills/foo/SKILL.md` (namespace `""`); plugin-source imports the same path (namespace `superpowers`). Result: 28 skills, 28 Claude skill files on apply.

**Files:**
- Create: `src/services/scan-dedup.ts`
- Modify: `src/services/scanner.ts` (`persistMergedProjectScan`, optionally `scanProjectWithPluginSource`)
- Test: `test/services/scanner-dual-mode.test.ts`
- Fixture: reuse `test/fixtures/superpowers/minimal/`

- [ ] **Step 1: Write failing test**

```typescript
// test/services/scanner-dual-mode.test.ts
const superpowersFixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

describe("persistMergedProjectScan deduplication", () => {
  it("does not duplicate skills imported from plugin source and gemini harness scan", async () => {
    const context = await createInitializedTestContext("scanner-sp-dedup");
    try {
      const scanner = await import("../../src/services/scanner.ts");
      const result = await scanner.persistMergedProjectScan(superpowersFixture, undefined, {
        originRef: superpowersFixture,
      });
      const skills = result.resources.filter((r) => r.type === "skill");
      const names = skills.map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
      expect(skills.length).toBe(2); // alpha, beta in minimal fixture
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test test/services/scanner-dual-mode.test.ts -t deduplication`
Expected: FAIL — `skills.length` is 4 (2 × 2 namespaces).

- [ ] **Step 3: Implement dedup helper**

Create `src/services/scan-dedup.ts`:

```typescript
import type { PluginSourceScanResult, ResourceCreateInput } from "../types.js";
import type { ScanResult } from "./scanner.js";

function normalizeSource(source: string): string {
  return source.replace(/^\.\//, "");
}

export function dropHarnessSkillsDuplicatingPluginSource(
  harness: ScanResult[],
  plugin: PluginSourceScanResult[],
): ScanResult[] {
  const pluginSkillSources = new Set(
    plugin
      .flatMap((entry) => entry.resources)
      .filter((r) => r.type === "skill")
      .map((r) => normalizeSource(r.source)),
  );

  if (pluginSkillSources.size === 0) {
    return harness;
  }

  return harness.map((result) => ({
    ...result,
    resources: result.resources.filter((resource) => {
      if (resource.type !== "skill") return true;
      return !pluginSkillSources.has(normalizeSource(resource.source));
    }),
  }));
}
```

- [ ] **Step 4: Wire into `persistMergedProjectScan`**

In `src/services/scanner.ts`:

```typescript
import { dropHarnessSkillsDuplicatingPluginSource } from "./scan-dedup.js";

export async function persistMergedProjectScan(...) {
  const { harness: rawHarness, plugin } = await scanProjectWithPluginSource(
    projectRoot,
    platformFilter,
  );
  const harness = dropHarnessSkillsDuplicatingPluginSource(rawHarness, plugin);
  // ... rest unchanged, use `harness` instead of raw scan for persist + return.scan.harness
}
```

Also apply the same filter in dry-run path in `src/index.ts` `handleScanCommand` before `printHarnessScanDryRun(harness)` so CLI output matches persisted state.

- [ ] **Step 5: Run tests**

Run: `bun test test/services/scanner-dual-mode.test.ts test/integration/ponytail-portability.test.ts`
Expected: PASS (ponytail fixture must still import plugin + harness skills without regression).

- [ ] **Step 6: Commit**

```bash
git add src/services/scan-dedup.ts src/services/scanner.ts src/index.ts test/services/scanner-dual-mode.test.ts
git commit -m "fix(scan): dedupe harness skills already imported from plugin source"
```

---

## Phase 3 — Multi-manifest hooks (medium impact)

### Task 3: Import hooks from every plugin manifest at repo root

**Problem:** `resolvePluginRoot` returns the first manifest (`.cursor-plugin` before `.claude-plugin`). Superpowers ships `hooks/hooks.json` (Claude) and `hooks/hooks-cursor.json` (Cursor); only Cursor hooks import today.

**Files:**
- Modify: `src/services/plugin-source-import.ts`
- Test: `test/services/plugin-source-import.test.ts`
- Fixture: `test/fixtures/superpowers/minimal/`

- [ ] **Step 1: Write failing test**

```typescript
// test/services/plugin-source-import.test.ts
const superpowersFixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

it("imports hooks from all plugin manifests at repo root", async () => {
  const entries = await scanPluginSource(superpowersFixture);
  const hooks = entries.flatMap((e) => e.resources).filter((r) => r.type === "hook");
  const sources = hooks.map((h) => h.source);
  expect(sources).toContain("hooks/hooks-cursor.json");
  expect(sources).toContain("hooks/hooks.json");
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test test/services/plugin-source-import.test.ts -t "all plugin manifests"`
Expected: FAIL — missing `hooks/hooks.json`.

- [ ] **Step 3: List all manifests and merge hook scans**

In `src/services/plugin-source-import.ts`, add:

```typescript
const PLUGIN_MANIFEST_CANDIDATES: Array<{
  manifestPath: string;
  sourcePluginKind: PluginSourceRootKind;
}> = [
  { manifestPath: ".cursor-plugin/plugin.json", sourcePluginKind: "cursor-plugin" },
  { manifestPath: ".claude-plugin/plugin.json", sourcePluginKind: "claude-plugin" },
  { manifestPath: ".codex-plugin/plugin.json", sourcePluginKind: "codex-plugin" },
  { manifestPath: ".github/plugin/plugin.json", sourcePluginKind: "copilot-plugin" },
];

function listPluginManifests(sourcePath: string): Array<{
  manifestPath: string;
  sourcePluginKind: PluginSourceRootKind;
  manifest: ValidatedPluginManifest;
}> {
  const found: Array<{
    manifestPath: string;
    sourcePluginKind: PluginSourceRootKind;
    manifest: ValidatedPluginManifest;
  }> = [];

  for (const candidate of PLUGIN_MANIFEST_CANDIDATES) {
    const manifestPath = join(sourcePath, candidate.manifestPath);
    if (!existsSync(manifestPath)) continue;
    const manifest = validatePluginManifest(
      readRequiredJson<PluginManifest>(manifestPath, "plugin manifest"),
      manifestPath,
    );
    found.push({
      manifestPath,
      sourcePluginKind: candidate.sourcePluginKind,
      manifest,
    });
  }
  return found;
}

function scanAllManifestHooks(
  rootPath: string,
  manifests: ReturnType<typeof listPluginManifests>,
  metadataBase: Omit<Parameters<typeof scanHooks>[2], never>,
): ResourceInput[] {
  const seenSources = new Set<string>();
  const resources: ResourceInput[] = [];

  for (const entry of manifests) {
    const hooks = scanHooks(rootPath, entry.manifest, {
      ...metadataBase,
      sourcePluginKind: entry.sourcePluginKind,
    });
    for (const hook of hooks) {
      if (seenSources.has(hook.source)) continue;
      seenSources.add(hook.source);
      resources.push(hook);
    }
  }
  return resources;
}
```

Refactor `resolvePluginRoot` to call `listPluginManifests` and throw if empty; keep first manifest as primary for `sourcePluginKind` metadata on skills/agents/commands.

In `scanPluginRoot`, replace single `scanHooks(rootPath, manifest, ...)` with `scanAllManifestHooks(rootPath, listPluginManifests(rootPath), metadata)`.

- [ ] **Step 4: Run tests**

Run: `bun test test/services/plugin-source-import.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/plugin-source-import.ts test/services/plugin-source-import.test.ts test/fixtures/superpowers/
git commit -m "feat(plugin-import): scan hooks from every repo-root plugin manifest"
```

---

## Phase 4 — OpenCode `.js` surface warnings (low–medium)

### Task 4: Detect OpenCode server plugins with `.js` extension

**Problem:** `detectHarnessSurfaces` only matches `.mjs`. Superpowers ships `.opencode/plugins/superpowers.js` (legacy/local bootstrap); no mirror warning today.

**Files:**
- Modify: `src/services/harness-surface-gaps.ts`
- Test: `test/services/harness-surface-gaps.test.ts`
- Fixture: `test/fixtures/superpowers/minimal/.opencode/plugins/bootstrap.js`

- [ ] **Step 1: Write failing test**

```typescript
it("detects OpenCode .js server plugins", () => {
  const surfaces = detectHarnessSurfaces(
    join(fixtureRoot, "minimal"),
  );
  expect(
    surfaces.some(
      (s) =>
        s.category === "opencode-server-plugin" &&
        s.path.endsWith(".js"),
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test test/services/harness-surface-gaps.test.ts -t "OpenCode .js"`
Expected: FAIL

- [ ] **Step 3: Extend detection**

In `src/services/harness-surface-gaps.ts`, replace `.mjs` checks with:

```typescript
function isOpencodeServerPluginFile(file: string): boolean {
  return file.endsWith(".mjs") || file.endsWith(".js");
}

// loop: if (!isOpencodeServerPluginFile(file)) continue;

// opencode.json entries: accept strings ending in .mjs or .js, or git/npm specifiers (category: opencode-server-plugin, message mentions opencode.json registration)
```

For `opencode.json` `plugin` array entries that are git URLs (e.g. `superpowers@git+https://...`), emit a surface with path set to the entry string and the same registration message.

- [ ] **Step 4: Run tests + update docs snippet in `docs/portability-limits.md` (OpenCode row: `.mjs` → `.js`/`.mjs`)**

- [ ] **Step 5: Commit**

```bash
git add src/services/harness-surface-gaps.ts test/services/harness-surface-gaps.test.ts docs/portability-limits.md
git commit -m "fix(surfaces): warn on OpenCode .js and git-registered server plugins"
```

---

## Phase 5 — Symlink-aware platform detection (low, UX)

### Task 5: Ignore symlinked `AGENTS.md` for harness detection

**Problem:** Superpowers sets `AGENTS.md -> CLAUDE.md`. `detectPlatforms` returns 30+ harnesses because every registry entry listing `AGENTS.md` matches the symlink.

**Files:**
- Modify: `src/services/scanner.ts` (`platformHasConfiguredPath`)
- Test: `test/services/scanner.test.ts` (or new `test/services/platform-detection.test.ts`)

- [ ] **Step 1: Write failing test**

```typescript
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { detectPlatforms } from "../../src/services/scanner.ts";

const fixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

describe("detectPlatforms symlink AGENTS.md", () => {
  it("does not treat symlinked AGENTS.md as a platform signal for every AGENTS-based harness", () => {
    const agentsPath = join(fixture, "AGENTS.md");
    expect(lstatSync(agentsPath).isSymbolicLink()).toBe(true);
    const detected = detectPlatforms(fixture);
    expect(detected).toContain("claude-code");
    expect(detected).toContain("gemini-cli");
    expect(detected.filter((id) => id !== "claude-code" && id !== "gemini-cli").length)
      .toBeLessThan(5);
  });
});
```

Adjust threshold after measuring baseline; goal is &lt;10 detected platforms for minimal superpowers fixture vs 30+ today.

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement**

In `src/services/scanner.ts`:

```typescript
import { existsSync, lstatSync } from "node:fs";

function pathCountsForPlatformDetection(
  projectRoot: string,
  configuredPath: string,
): boolean {
  const fullPath = join(projectRoot, configuredPath);
  if (!existsSync(fullPath)) return false;

  if (configuredPath === "AGENTS.md") {
    try {
      if (lstatSync(fullPath).isSymbolicLink()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

function platformHasConfiguredPath(projectRoot: string, configuredPath: string): boolean {
  return pathCountsForPlatformDetection(projectRoot, configuredPath);
}
```

**Regression check:** repos with a real (non-symlink) `AGENTS.md` must still detect `codex`, `cursor`, etc.

- [ ] **Step 4: Run full suite**

Run: `bun run test:run && bun run typecheck && bun run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/scanner.ts test/services/platform-detection.test.ts
git commit -m "fix(scan): ignore symlinked AGENTS.md for platform detection"
```

---

## Phase 6 — Integration guard + docs (required)

### Task 6: Superpowers integration test and doc updates

**Files:**
- Create: `test/integration/superpowers-portability.test.ts`
- Modify: `docs/portability-limits.md`, `docs/scenarios/details/33-mirror-plugin-fallback.md`, `docs/scenarios/scenarios.md`, `SPEC.md`

- [ ] **Step 1: Integration test**

```typescript
// test/integration/superpowers-portability.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";

const fixture = join(import.meta.dirname, "../fixtures/superpowers/minimal");

describe("superpowers portability", () => {
  it("scan imports skills once and both hook manifests", async () => {
    const context = await createInitializedTestContext("integration-sp-scan");
    try {
      const scanner = await import("../../src/services/scanner.ts");
      const result = await scanner.persistMergedProjectScan(fixture);
      const skills = result.resources.filter((r) => r.type === "skill");
      const hooks = result.resources.filter((r) => r.type === "hook");
      expect(skills.length).toBe(2);
      expect(hooks.length).toBe(2);
    } finally {
      await context.cleanup();
    }
  });

  it("mirror auto includes plugin skills", async () => {
    const context = await createInitializedTestContext("integration-sp-mirror");
    try {
      const { syncProject } = await import("../../src/services/project-sync.ts");
      const result = await syncProject({
        projectRoot: fixture,
        dryRun: true,
        forceShiftReference: "claude-code",
        referenceStrategy: "auto",
      });
      expect(result.files_written).toBeGreaterThan(10);
      expect(result.surface_warnings.some((w) => w.category === "opencode-server-plugin")).toBe(true);
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Update docs**

`docs/portability-limits.md` — add subsection under mirror warnings:

- `auto` reference merges plugin `skills/` when main harness has instructions but no on-disk skills.
- Symlinked `AGENTS.md` does not inflate detected harness count.

`docs/scenarios/details/33-mirror-plugin-fallback.md` — document auto-merge behavior (not only empty-main fallback).

`SPEC.md` — one line under project scan/mirror describing auto merge + symlink detection.

- [ ] **Step 3: Run full validation**

Run: `bun run test:run && bun run typecheck && bun run lint`

- [ ] **Step 4: Commit**

```bash
git add test/integration/superpowers-portability.test.ts docs/ SPEC.md
git commit -m "test(docs): superpowers portability integration guard and mirror auto-merge docs"
```

---

## Phase 7 — Optional follow-ups (defer unless requested)

### Task 7 (optional): Droid plugin manifest + Antigravity alias

**Problem:** Superpowers documents Factory Droid and Antigravity installs; HarnessDeck detects `droid` via `AGENTS.md` only and has no `antigravity` harness.

**Scope (document-only unless product priority changes):**
- Add `docs/portability-limits.md` row: Antigravity shares Gemini extension surface; use `gemini-cli` apply + native Antigravity install.
- Add `.droid-plugin/plugin.json` to `PLUGIN_MANIFEST_CANDIDATES` if/when Droid documents a standard manifest path (verify upstream first).
- No serializer work in this plan — YAGNI until a fixture exists.

---

## Verification checklist (against upstream superpowers)

After all required phases (1–6), run locally against a shallow clone:

```bash
git clone --depth 1 https://github.com/obra/superpowers.git /tmp/superpowers
cd /path/to/harnessdeck-worktree

bun run src/index.ts project scan /tmp/superpowers --dry-run
# Expect: claude instructions + superpowers plugin · 14 skills + 2 hooks (not 28 skills)

bun run src/index.ts project mirror /tmp/superpowers --reference auto --dry-run
# Expect: files_written >> 32; surface_warnings for gemini-extension + opencode .js

bun run src/index.ts layer from-project superpowers-layer --project /tmp/superpowers
bun run src/index.ts layer apply superpowers-layer --harness claude-code,codex,gemini-cli --dry-run
# Expect: 14 claude skill files (not 28); gemini instruction blob includes skill sections
```

---

## Self-review (spec coverage)

| Recommendation | Task |
|----------------|------|
| Auto mirror merges plugin skills | Task 1 |
| Dedupe skills plugin + gemini scan | Task 2 |
| Multi-manifest hooks | Task 3 |
| OpenCode `.js` warnings | Task 4 |
| Symlink AGENTS.md detection noise | Task 5 |
| Integration test + docs | Task 6 |
| Droid / Antigravity (low) | Task 7 optional |

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-superpowers-portability-gaps.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
