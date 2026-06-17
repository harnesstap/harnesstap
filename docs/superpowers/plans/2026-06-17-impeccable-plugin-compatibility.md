# Impeccable Plugin Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HarnessDeck correctly import, merge, mirror, and apply multi-harness plugin repos like [Impeccable](https://github.com/pbakaus/impeccable) — including repo-root dual-mode layouts, marketplace manifests, skill auxiliary trees, and hooks.

**Architecture:** Fix plugin-source discovery first (manifest `skills` path, marketplace `source` alias, non-fatal dual-mode merge). Then enrich scan metadata (skill `scripts`/`references`, harness hook files). Finally extend serializers and a small shared helper to emit auxiliary skill files and preserve nested hook structure on apply. Defer SKILL.md path rewriting and command-metadata → slash-command generation to a follow-up (P3).

**Tech Stack:** TypeScript, Bun test, existing `plugin-source-import.ts`, platform serializers (`claude-code`, `cursor`, `codex`, `generic-agents`), `scanner.ts`, `project-sync.ts`.

---

## File map

| File | Responsibility |
|------|----------------|
| `src/services/plugin-source-import.ts` | Plugin manifest parsing, skills/commands/hooks scan |
| `src/services/scanner.ts` | Dual-mode merge; graceful plugin-source fallback |
| `src/services/project-sync.ts` | Mirror reference resolution (uses plugin scan) |
| `src/services/skill-auxiliary.ts` | **New** — list + emit skill `scripts/` / `reference(s)/` files |
| `src/services/hook-serialization.ts` | **New** — shared nested hook JSON build/parse helpers |
| `src/platforms/base-serializer.ts` | Populate skill aux metadata on harness scan |
| `src/platforms/claude-code.ts` | Scan + serialize hooks in `.claude/settings.json` |
| `src/platforms/cursor.ts` | Scan + serialize `.cursor/hooks.json` |
| `src/platforms/codex.ts` | Scan + serialize `.codex/hooks.json` |
| `src/platforms/generic-agents.ts` | Use nested hook serializer |
| `test/fixtures/plugin-import/impeccable-layout/` | **New** — minimal Impeccable-style repo root fixture |
| `test/services/plugin-source-import.test.ts` | Plugin-source unit tests |
| `test/services/scanner-dual-mode.test.ts` | Dual-mode merge tests |
| `test/services/skill-auxiliary.test.ts` | **New** — aux file list/emit tests |
| `test/services/hook-serialization.test.ts` | **New** — nested hook round-trip tests |
| `test/platforms/hook-apply.test.ts` | **New** — hook emission per harness |
| `test/integration/impeccable-layout.test.ts` | **New** — end-to-end scan + apply |
| `docs/portability-limits.md` | Document improved coverage + remaining limits |

---

## Phase 0 — Fixture: Impeccable-style repo root

### Task 1: Add minimal dual-mode fixture

**Files:**
- Create: `test/fixtures/plugin-import/impeccable-layout/AGENTS.md`
- Create: `test/fixtures/plugin-import/impeccable-layout/.claude-plugin/plugin.json`
- Create: `test/fixtures/plugin-import/impeccable-layout/.claude-plugin/marketplace.json`
- Create: `test/fixtures/plugin-import/impeccable-layout/.claude/skills/impeccable/SKILL.md`
- Create: `test/fixtures/plugin-import/impeccable-layout/.claude/skills/impeccable/scripts/context.mjs`
- Create: `test/fixtures/plugin-import/impeccable-layout/.claude/skills/impeccable/reference/polish.md`
- Create: `test/fixtures/plugin-import/impeccable-layout/.claude/agents/impeccable-manual-edit-applier.md`
- Create: `test/fixtures/plugin-import/impeccable-layout/.claude/settings.json` (hooks block)
- Create: `test/fixtures/plugin-import/impeccable-layout/.cursor/hooks.json`
- Create: `test/fixtures/plugin-import/impeccable-layout/.codex/hooks.json`
- Create: `test/fixtures/plugin-import/impeccable-layout/plugin/.claude-plugin/plugin.json` (canonical pack, for marketplace `source`)

- [ ] **Step 1: Create fixture tree**

`.claude-plugin/plugin.json` (repo root — skills NOT under `skills/`):

```json
{
  "name": "impeccable-fixture",
  "version": "1.0.0",
  "description": "Impeccable-style layout fixture",
  "skills": "./.claude/skills/"
}
```

`.claude-plugin/marketplace.json` (uses Claude `source` field):

```json
{
  "name": "impeccable-fixture",
  "plugins": [
    {
      "name": "impeccable-fixture",
      "version": "1.0.0",
      "source": "./plugin"
    }
  ]
}
```

`plugin/.claude-plugin/plugin.json`:

```json
{
  "name": "impeccable-fixture",
  "version": "1.0.0",
  "description": "Canonical plugin pack",
  "hooks": "hooks/hooks.json"
}
```

Add minimal `plugin/hooks/hooks.json` with one nested PostToolUse hook (copy structure from `test/fixtures/superpowers/minimal/hooks/hooks.json`).

`SKILL.md` frontmatter: `name: impeccable`, short description, body referencing `scripts/context.mjs`.

- [ ] **Step 2: Commit**

```bash
git add test/fixtures/plugin-import/impeccable-layout
git commit -m "test: add impeccable-layout plugin import fixture"
```

---

## Phase 1 — P0: Plugin-source discovery fixes

### Task 2: Honor manifest `skills` path

**Files:**
- Modify: `src/services/plugin-source-import.ts`
- Test: `test/services/plugin-source-import.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("scans skills from manifest skills pointer (impeccable-style layout)", async () => {
  const entries = await scanPluginSource(
    join(fixtureRoot, "impeccable-layout"),
  );
  expect(entries).toHaveLength(1);
  const skill = entries[0]?.resources.find((r) => r.type === "skill");
  expect(skill?.name).toBe("impeccable");
  expect(skill?.source).toBe(".claude/skills/impeccable/SKILL.md");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/services/plugin-source-import.test.ts -t "impeccable-style"`
Expected: FAIL — no skill found or scan throws.

- [ ] **Step 3: Implement**

In `plugin-source-import.ts`:

1. Extend `PluginManifest` / `ValidatedPluginManifest` with optional `skills?: string`.
2. Parse `skills` in `validatePluginManifest` (same trim rules as `commands`/`hooks`).
3. Add `resolveSkillsDir(rootPath, manifest)` mirroring `resolveCommandsDir`:

```typescript
function resolveSkillsDir(
  rootPath: string,
  manifest: ValidatedPluginManifest,
): string | null {
  const skillsDir = manifest.skills
    ? join(rootPath, manifest.skills)
    : join(rootPath, "skills");
  return isDirectory(skillsDir) ? skillsDir : null;
}
```

4. Change `scanSkills` to accept `skillsDir: string | null` instead of assuming `join(rootPath, "skills")`.
5. In `scanPluginRoot`, pass `resolveSkillsDir(rootPath, manifest)`.

- [ ] **Step 4: Run test — expect PASS**

Run: `bun test test/services/plugin-source-import.test.ts -t "impeccable-style"`

- [ ] **Step 5: Commit**

```bash
git add src/services/plugin-source-import.ts test/services/plugin-source-import.test.ts
git commit -m "fix: honor plugin manifest skills path"
```

---

### Task 3: Marketplace `source` alias for `path`

**Files:**
- Modify: `src/services/plugin-source-import.ts`
- Test: `test/services/plugin-source-import.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("accepts marketplace entry source as alias for path", async () => {
  const entries = await scanPluginSource(
    join(fixtureRoot, "impeccable-layout/.claude-plugin/marketplace.json"),
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]?.plugin_name).toBe("impeccable-fixture");
  expect(entries[0]?.resources.some((r) => r.type === "hook")).toBe(true);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test test/services/plugin-source-import.test.ts -t "source as alias"`

- [ ] **Step 3: Implement**

1. Extend `MarketplacePluginEntry` with `source?: string`.
2. In `validateMarketplaceManifest`, resolve entry path:

```typescript
const rawPath = entry?.path ?? entry?.source;
if (typeof rawPath !== "string") {
  throw new Error(`Marketplace entry path must be a string: ${manifestPath}`);
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: accept marketplace source field as plugin path"
```

---

### Task 4: Graceful dual-mode plugin-source fallback

**Files:**
- Modify: `src/services/plugin-source-import.ts`
- Modify: `src/services/scanner.ts`
- Modify: `src/services/project-sync.ts`
- Test: `test/services/scanner-dual-mode.test.ts`
- Test: `test/integration/impeccable-layout.test.ts` (create)

- [ ] **Step 1: Write failing dual-mode test**

`test/services/scanner-dual-mode.test.ts`:

```typescript
it("merges harness scan when repo-root plugin manifest has no conventional skills/ dir", async () => {
  const scanner = await import("../../src/services/scanner.ts");
  const fixture = join(fixtureRoot, "impeccable-layout");
  const result = await scanner.scanProjectWithPluginSource(fixture);
  expect(result.harness.flatMap((h) => h.resources).some((r) => r.type === "instruction")).toBe(true);
  expect(result.plugin.flatMap((p) => p.resources).some((r) => r.type === "skill" && r.name === "impeccable")).toBe(true);
});
```

Before Task 2 lands, adjust expectation: after Task 2, plugin side should find skill. Before Task 4 only, test should assert **no throw** and harness side works even if plugin empty — split into two tests if needed.

- [ ] **Step 2: Add `scanPluginSourceForMerge` helper**

In `plugin-source-import.ts`:

```typescript
export async function scanPluginSourceForMerge(
  sourcePath: string,
): Promise<PluginSourceScanResult[]> {
  try {
    return await scanPluginSource(sourcePath);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("No supported plugin resources found in")
    ) {
      return [];
    }
    throw error;
  }
}
```

Keep `scanPluginSource` strict (throws on empty) for dedicated plugin-only CLI paths.

- [ ] **Step 3: Use merge helper in scanner + project-sync**

Replace `scanPluginSource` with `scanPluginSourceForMerge` in:
- `scanner.ts` → `scanProjectWithPluginSource`
- `project-sync.ts` → `scanPluginReferenceResources`

Do **not** change `index.ts` plugin-only scan path or `resource-sync.ts` install sync (those should still fail loudly on empty trees).

- [ ] **Step 4: Write integration test**

`test/integration/impeccable-layout.test.ts`:

```typescript
it("project scan dry-run does not throw on impeccable-layout root", async () => {
  const context = await createInitializedTestContext("impeccable-layout-scan");
  try {
    const scanner = await import("../../src/services/scanner.ts");
    const fixture = join(import.meta.dirname, "../fixtures/plugin-import/impeccable-layout");
    const merged = await scanner.persistMergedProjectScan(fixture, undefined, {
      originRef: fixture,
    });
    expect(merged.resources.some((r) => r.type === "skill" && r.name === "impeccable")).toBe(true);
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 5: Run tests**

Run: `bun test test/services/scanner-dual-mode.test.ts test/integration/impeccable-layout.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git commit -m "fix: graceful plugin-source fallback during dual-mode project scan"
```

---

## Phase 2 — P1: Skill auxiliary files

### Task 5: Shared skill auxiliary helper

**Files:**
- Create: `src/services/skill-auxiliary.ts`
- Test: `test/services/skill-auxiliary.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  listSkillAuxiliaryFiles,
  emitSkillAuxiliaryFiles,
} from "../../src/services/skill-auxiliary.ts";

const fixture = join(import.meta.dirname, "../fixtures/plugin-import/impeccable-layout");

describe("skill-auxiliary", () => {
  it("lists scripts and reference files from skill directory", () => {
    const listed = listSkillAuxiliaryFiles(
      join(fixture, ".claude/skills/impeccable"),
    );
    expect(listed.scripts).toContain("context.mjs");
    expect(listed.references).toContain("polish.md");
  });

  it("emits auxiliary files under target skill prefix", () => {
    const files = emitSkillAuxiliaryFiles({
      sourceSkillDir: join(fixture, ".claude/skills/impeccable"),
      targetPrefix: ".claude/skills/impeccable",
      scripts: ["context.mjs"],
      references: ["polish.md"],
    });
    expect(files.map((f) => f.path)).toEqual([
      ".claude/skills/impeccable/scripts/context.mjs",
      ".claude/skills/impeccable/reference/polish.md",
    ]);
    expect(files[0]?.content).toContain("//"); // or whatever fixture contains
  });
});
```

- [ ] **Step 2: Implement `skill-auxiliary.ts`**

Reuse listing logic from `skill-package-import.ts` (`listRelativeFiles`) but support both `reference/` and `references/` directory names (Impeccable uses `reference/`).

```typescript
export function listSkillAuxiliaryFiles(skillDir: string): {
  scripts: string[];
  references: string[];
} {
  const scripts = listRelativeFiles(join(skillDir, "scripts"));
  const references = listRelativeFiles(join(skillDir, "reference"))
    .concat(listRelativeFiles(join(skillDir, "references")))
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort();
  return { scripts, references };
}

export function emitSkillAuxiliaryFiles(input: {
  sourceSkillDir: string;
  targetPrefix: string;
  scripts: string[];
  references: string[];
}): SerializedFile[] { /* readFileSync each, normalize paths */ }
```

Export `listRelativeFiles` from one place — either move to `skill-auxiliary.ts` and import from `skill-package-import.ts`, or duplicate minimally (prefer single export to avoid drift).

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add skill auxiliary file list/emit helper"
```

---

### Task 6: Populate aux metadata on scan

**Files:**
- Modify: `src/services/plugin-source-import.ts` (`scanSkills`)
- Modify: `src/platforms/base-serializer.ts` (`scanSkillsDirAt`)
- Test: extend `plugin-source-import.test.ts` and scanner tests

- [ ] **Step 1: Failing test — metadata populated**

```typescript
expect(skill?.metadata).toMatchObject({
  scripts: expect.arrayContaining(["context.mjs"]),
  references: expect.arrayContaining(["polish.md"]),
});
```

- [ ] **Step 2: Update `scanSkills`**

After parsing each skill, call `listSkillAuxiliaryFiles(skillDir)` and set `metadata.scripts` / `metadata.references`.

- [ ] **Step 3: Update `base-serializer.scanSkillsDirAt`**

Same — populate metadata from disk at harness scan time.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: capture skill scripts and references on scan"
```

---

### Task 7: Emit auxiliary files on serialize

**Files:**
- Modify: `src/platforms/base-serializer.ts` (new protected helper)
- Modify: `src/platforms/claude-code.ts`, `codex.ts`, `cursor.ts`, `generic-agents.ts`, `opencode.ts`, `copilot.ts`, `gemini-cli.ts`
- Modify: `src/types.ts` (`SerializeOptions`)
- Test: `test/integration/impeccable-layout.test.ts`

- [ ] **Step 1: Extend `SerializeOptions`**

```typescript
export interface SerializeOptions {
  target?: SerializerTarget;
  skillCursorMode?: CursorSkillMode;
  /** When set, skill auxiliary files are read from this tree (scan origin). */
  skillSourceRoot?: string;
}
```

- [ ] **Step 2: Add `emitSkillWithAuxiliary` to `BaseSerializer`**

```typescript
protected emitSkillWithAuxiliary(
  resource: Resource,
  skillMdPath: string,
  options: SerializeOptions,
): SerializedFile[] {
  const files: SerializedFile[] = [{ path: skillMdPath, content: /* existing fm + body */ }];
  const meta = resource.metadata as SkillMetadata;
  if (!options.skillSourceRoot || !meta.scripts?.length && !meta.references?.length) {
    return files;
  }
  const sourceSkillDir = this.resolveSkillSourceDir(resource, options.skillSourceRoot);
  if (!sourceSkillDir) return files;
  const targetPrefix = skillMdPath.replace(/\/SKILL\.md$/, "");
  files.push(
    ...emitSkillAuxiliaryFiles({
      sourceSkillDir,
      targetPrefix,
      scripts: meta.scripts ?? [],
      references: meta.references ?? [],
    }),
  );
  return files;
}

protected resolveSkillSourceDir(resource: Resource, sourceRoot: string): string | undefined {
  // resource.source e.g. ".claude/skills/impeccable/SKILL.md" or "skills/foo/SKILL.md"
  const dir = dirname(join(sourceRoot, resource.source));
  return existsSync(dir) ? dir : undefined;
}
```

Replace inline skill emission loops in each native serializer with `emitSkillWithAuxiliary`.

- [ ] **Step 3: Pass `skillSourceRoot` from applier**

In `generateFiles` (`applier.ts`), derive `skillSourceRoot` from resources:

```typescript
const skillSourceRoot = resources.find(
  (r) => r.type === "skill" && r.origin_ref,
)?.origin_ref;
```

Pass to each serializer via `SerializeOptions`. For project scan imports, `origin_ref` is the scanned project path.

- [ ] **Step 4: Integration test — apply emits scripts**

```typescript
const generated = await generateFiles(resources, ["claude-code"], context.projectDir, {
  skillSourceRoot: fixture,
});
const paths = generated.flatMap((g) => g.files).map((f) => f.path);
expect(paths).toContain(".claude/skills/impeccable/scripts/context.mjs");
```

- [ ] **Step 5: Run `bun test test/integration/impeccable-layout.test.ts` — PASS**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: emit skill auxiliary files on apply when source root is available"
```

**Known limitation (document, do not fix in this plan):** Layer export/import to another machine without `origin_ref` still drops auxiliary files unless `--embed-plugins` or future blob storage is used.

---

## Phase 3 — P1: Hooks scan + serialize

### Task 8: Shared nested hook serialization

**Files:**
- Create: `src/services/hook-serialization.ts`
- Test: `test/services/hook-serialization.test.ts`

- [ ] **Step 1: Failing round-trip test**

```typescript
it("rebuilds nested PostToolUse matcher hooks from hook resources", () => {
  const resources: HookMetadata[] = [{
    event: "PostToolUse",
    script: 'node "hook.mjs"',
    matcher: "Edit|Write",
    hook_entry: {
      type: "command",
      command: 'node "hook.mjs"',
      timeout: 5,
      statusMessage: "Checking",
    },
  }];
  const json = buildHooksJson(resources);
  expect(json.hooks.PostToolUse[0]).toMatchObject({
    matcher: "Edit|Write",
    hooks: [{ type: "command", command: 'node "hook.mjs"', timeout: 5 }],
  });
});
```

- [ ] **Step 2: Implement `buildHooksJson`**

Group hook resources by event. When `hook_entry` is present, push `hook_entry` (or reconstructed nested entry with matcher wrapper) instead of flat `{ command }`.

When multiple hooks share an event with matchers, preserve array structure per Claude/Cursor format.

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: shared nested hook JSON builder"
```

---

### Task 9: Claude Code hooks in settings.json

**Files:**
- Modify: `src/platforms/claude-code.ts`
- Test: `test/platforms/hook-apply.test.ts`

- [ ] **Step 1: Failing scan test**

Scan `test/fixtures/claude-project/.claude/settings.json` or impeccable fixture — expect `hook` resources when settings contains `hooks` key.

Extract hook parsing into a shared function used by `claude-code.ts` and plugin-source (optional refactor later).

- [ ] **Step 2: Scan hooks from settings**

In `claude-code.ts` scan block for settings.json, after env vars, if `settings.hooks` exists, reuse `collectPluginHookEntries` pattern from plugin-source (import from `hook-serialization.ts` or export collector from plugin-source).

- [ ] **Step 3: Serialize hooks into settings.json**

In `serialize`, merge hooks into settings object alongside permissions/env. Use `buildHooksJson`.

- [ ] **Step 4: Failing apply test**

```typescript
const files = await generateFiles(hookResources, ["claude-code"], projectDir);
const settings = files.flatMap((r) => r.files).find((f) => f.path.endsWith("settings.json"));
expect(JSON.parse(settings!.content).hooks.PostToolUse).toBeDefined();
```

- [ ] **Step 5: Run tests — PASS**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: scan and emit Claude Code hooks in settings.json"
```

---

### Task 10: Cursor + Codex hook scan/serialize

**Files:**
- Modify: `src/platforms/cursor.ts`
- Modify: `src/platforms/codex.ts`
- Modify: `src/platforms/generic-agents.ts` (use `buildHooksJson`)
- Test: `test/platforms/hook-apply.test.ts`

- [ ] **Step 1: Cursor — add hook scan**

Import or duplicate `scanHooksAt` logic from `generic-agents.ts` (consider extracting to `hook-serialization.ts` as `scanHooksFile(path)`).

In `cursor.ts` `scan()`, after agents, scan `.cursor/hooks.json`.

- [ ] **Step 2: Cursor — serialize hooks**

In `serialize()`, emit hooks file using `buildHooksJson` (currently hooks are explicitly skipped).

- [ ] **Step 3: Codex — scan `.codex/hooks.json`**

Add hook scan in `codex.ts` `scan()` (currently missing despite registry entry).

- [ ] **Step 4: Codex — serialize hooks**

Emit `.codex/hooks.json` in `serialize()`.

- [ ] **Step 5: Generic serializer — nested hooks**

Replace flat `{ command: meta.script }` loop in `generic-agents.ts` with `buildHooksJson`.

- [ ] **Step 6: Tests for cursor + codex apply**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: hook scan and nested emit for cursor, codex, and generic harnesses"
```

---

### Task 11: Integration — impeccable-layout apply dry-run

**Files:**
- Test: `test/integration/impeccable-layout.test.ts`

- [ ] **Step 1: End-to-end test**

After scan + layer from-project on fixture:

```typescript
const generated = await generateFiles(resources, ["claude-code", "codex", "cursor"], projectDir, {
  skillSourceRoot: fixture,
});
// Expect SKILL.md + context.mjs + hooks file per harness
```

- [ ] **Step 2: Run full test suite**

Run: `bun run preflight`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git commit -m "test: impeccable-layout end-to-end apply coverage"
```

---

## Phase 4 — Docs + follow-ups

### Task 12: Update portability docs

**Files:**
- Modify: `docs/portability-limits.md`

- [ ] **Step 1: Document fixes**

Under "Dual-mode scan", note:
- Manifest `skills` pointer supported
- Marketplace `source` accepted
- Empty plugin layout no longer blocks harness scan

Under "Partially bridgeable", update hooks section — now emitted for Claude/Cursor/Codex when imported.

Add remaining limits:
- `${CLAUDE_PLUGIN_ROOT}` paths still need native install
- SKILL.md in-body paths (`.claude/skills/...`) not rewritten on cross-harness apply
- Skill aux files require `origin_ref` / `skillSourceRoot` at apply time
- Impeccable sub-commands (`reference/*.md`) are not separate slash commands

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: update portability limits for impeccable-style plugins"
```

---

## Phase 5 — P2 (optional, separate PR)

Track but **do not implement in the first PR** unless time permits:

### Task 13 (optional): Generate command resources from `command-metadata.json`

- Detect `scripts/command-metadata.json` beside skills during `scanSkills`
- Emit `command` resources named `impeccable:polish` etc.
- Serialize to harness-native command paths

### Task 14 (optional): Marketplace auto-resolve at repo root

When root plugin-source is empty but `marketplace.json` exists, try first marketplace entry path before giving up.

---

## Self-review (spec coverage)

| Requirement | Task |
|-------------|------|
| Honor `skills` in plugin.json | Task 2 |
| Marketplace `source` alias | Task 3 |
| Dual-mode scan no longer throws | Task 4 |
| Skill scripts/references on scan | Task 6 |
| Skill aux files on apply | Task 7 |
| Hooks scanned from harness files | Tasks 9–10 |
| Hooks emitted on apply | Tasks 8–10 |
| Nested hook matchers preserved | Task 8 |
| Tests + docs | Tasks 1, 11–12 |
| Command-metadata / path rewriting | Phase 5 (deferred) |

---

## Execution order

```mermaid
flowchart LR
  T1[Fixture] --> T2[skills path]
  T2 --> T3[marketplace source]
  T3 --> T4[graceful merge]
  T4 --> T5[aux helper]
  T5 --> T6[aux scan]
  T6 --> T7[aux emit]
  T7 --> T8[hook builder]
  T8 --> T9[claude hooks]
  T9 --> T10[cursor codex hooks]
  T10 --> T11[e2e]
  T11 --> T12[docs]
```

**Estimated commits:** 10–12 focused commits across 2–3 PRs (P0 PR, P1 PR, docs).

---

Plan complete and saved to `docs/superpowers/plans/2026-06-17-impeccable-plugin-compatibility.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — implement tasks in this session with checkpoints after each phase

Which approach do you want?
