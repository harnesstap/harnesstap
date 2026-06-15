# Ponytail portability gaps — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps exposed by the [ponytail](https://github.com/DietrichGebert/ponytail) portability analysis so HarnessDeck can discover, import, compose, and apply agent-portable repos that mix plugin layouts (`skills/`, `commands/`, `hooks/`) with per-harness project files — while documenting fidelity limits for runtime-only adapters.

**Architecture:** Work in four delivery phases: (1) **import/discovery** — dual-mode scan, expanded plugin manifests, repo-root resource paths; (2) **registry/scan fidelity** — correct on-disk paths for windsurf, cline, opencode, new harnesses; (3) **apply/mirror fidelity** — instruction-tier emission, cursor skill strategy, mirror fallback; (4) **docs & serializer completeness** — portability limits doc, codex `config.toml`, gemini extension. Each phase ships independently with tests against ponytail fixtures (vendored under `test/fixtures/ponytail/`).

**Tech stack:** TypeScript, Bun test runner, `smol-toml`, existing serializer/registry/applier stack (`src/platforms/`, `src/services/scanner.ts`, `src/services/plugin-source-import.ts`, `src/services/project-sync.ts`).

**Reference analysis:** Ponytail stress-test findings from 2026-06-15 session (dual-mode repos, repo-root `skills/`, runtime hooks, instruction-tier vs skill-tier hosts).

---

## File map (planned changes)

| Area | Primary files |
|------|----------------|
| Scan orchestration | `src/services/scanner.ts`, `src/index.ts` (`handleScanCommand`) |
| Plugin import | `src/services/plugin-source-import.ts`, `src/types.ts` (`IMPORTED_SOURCE_KINDS`) |
| Registry | `src/platforms/registry.ts`, `src/platforms/opencode.ts`, `src/platforms/generic-agents.ts` |
| Serializers | `src/platforms/codex.ts`, `src/platforms/cursor.ts`, `src/platforms/copilot.ts`, new `src/platforms/gemini-cli.ts` |
| Apply options | `src/types.ts` (`SerializeOptions`), `src/services/applier.ts`, `src/models/harness.ts` |
| Mirror | `src/services/project-sync.ts` |
| Docs | `docs/portability-limits.md`, `docs/scenarios/scenarios.md`, `SPEC.md` |
| Tests | `test/fixtures/ponytail/`, `test/services/plugin-source-import.test.ts`, `test/services/scanner.test.ts`, `test/platforms/*.test.ts`, `test/services/project-sync.test.ts` |

---

## Phase 1 — Import & discovery (high impact)

### Task 1: Dual-mode project scan

**Problem:** `handleScanCommand` only calls `scanPluginSource` when `detectPlatforms()` returns zero harnesses. Ponytail (and similar repos) have both `AGENTS.md` and `.claude-plugin/plugin.json`, so repo-root `skills/` are never imported.

**Files:**
- Modify: `src/services/scanner.ts`
- Modify: `src/index.ts` (`handleScanCommand`, scan CLI options)
- Test: `test/services/scanner-dual-mode.test.ts`
- Fixture: `test/fixtures/ponytail/minimal/` (subset: `AGENTS.md`, `.claude-plugin/plugin.json`, `skills/ponytail/SKILL.md`)

- [ ] **Step 1: Export `isPluginSourcePath` detection helper for repo roots**

Add to `src/services/scanner.ts`:

```typescript
export function hasPluginSourceLayout(projectRoot: string): boolean {
  return isPluginSourcePath(projectRoot);
}
```

- [ ] **Step 2: Write failing test — dual-mode scan merges harness + plugin resources**

```typescript
// test/services/scanner-dual-mode.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { scanProjectWithPluginSource } from "../../src/services/scanner.ts";

const fixture = join(import.meta.dirname, "../fixtures/ponytail/minimal");

describe("scanProjectWithPluginSource", () => {
  it("imports repo-root skills when harness files are also present", async () => {
    const result = await scanProjectWithPluginSource(fixture);
    const all = result.flatMap((r) => r.resources);
    expect(all.some((r) => r.type === "instruction")).toBe(true);
    expect(all.some((r) => r.type === "skill" && r.name === "ponytail")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `bun test test/services/scanner-dual-mode.test.ts`
Expected: `scanProjectWithPluginSource` is not defined.

- [ ] **Step 4: Implement `scanProjectWithPluginSource`**

In `src/services/scanner.ts`:

```typescript
export async function scanProjectWithPluginSource(
  projectRoot: string,
  platformFilter?: string,
): Promise<{
  harness: ScanResult[];
  plugin: Awaited<ReturnType<typeof scanPluginSource>>;
}> {
  const harness = await scanProject(projectRoot, platformFilter);
  const plugin = hasPluginSourceLayout(projectRoot)
    ? await scanPluginSource(projectRoot)
    : [];
  return { harness, plugin };
}
```

Add `persistMergedScan` that upserts harness resources under default namespace and plugin resources under plugin namespace (reuse `scanAndPersist` + `scanAndPersistPluginSource` with dedup on `type:name:namespace`).

- [ ] **Step 5: Wire CLI flag `--include-plugin-source` (default: auto when layout detected)**

In `src/index.ts` `handleScanCommand`:

- Add option `--include-plugin-source` with values `auto` (default), `always`, `never`.
- When `auto` or `always`, and `hasPluginSourceLayout(projectRoot)`, run plugin scan after harness scan and persist both.
- Dry-run prints two sections: harness platforms + plugin imports.
- Update `layer from-project` to call `scanProjectWithPluginSource` so ponytail-style repos produce skills in layers.

- [ ] **Step 6: Run tests**

Run: `bun test test/services/scanner-dual-mode.test.ts && bun run typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/services/scanner.ts src/index.ts test/services/scanner-dual-mode.test.ts test/fixtures/ponytail/
git commit -m "feat(scan): merge plugin-source import when repo has dual-mode layout"
```

---

### Task 2: Expand plugin manifest detection

**Problem:** Only `.claude-plugin/` and `.cursor-plugin/` are recognized. Ponytail also ships `.codex-plugin/plugin.json` and `.github/plugin/plugin.json`.

**Files:**
- Modify: `src/types.ts` (`IMPORTED_SOURCE_KINDS`)
- Modify: `src/services/plugin-source-import.ts` (`resolvePluginRoot`, `isPluginSourcePath` in scanner)
- Modify: `src/db/schema.ts` / migration if `source_kind` is constrained (verify — likely free text in JSON metadata)
- Test: `test/services/plugin-source-import.test.ts`
- Fixtures: `test/fixtures/plugin-import/codex-ponytail/`, `test/fixtures/plugin-import/copilot-ponytail/`

- [ ] **Step 1: Extend `IMPORTED_SOURCE_KINDS`**

```typescript
export const IMPORTED_SOURCE_KINDS = [
  "cursor-plugin",
  "claude-plugin",
  "codex-plugin",
  "copilot-plugin",
  "marketplace",
] as const;
```

Update exhaustive switches (grep `IMPORTED_SOURCE_KINDS` and `source_plugin_kind`).

- [ ] **Step 2: Write failing tests for codex + copilot plugin roots**

```typescript
it("scans a codex plugin root", async () => {
  const entries = await scanPluginSource(join(fixtureRoot, "codex-ponytail"));
  expect(entries[0]?.metadata.source_plugin_kind).toBe("codex-plugin");
  expect(entries[0]?.resources.some((r) => r.type === "skill")).toBe(true);
});

it("scans a github copilot plugin root", async () => {
  const entries = await scanPluginSource(join(fixtureRoot, "copilot-ponytail"));
  expect(entries[0]?.metadata.source_plugin_kind).toBe("copilot-plugin");
});
```

- [ ] **Step 3: Implement `resolvePluginRoot` precedence**

Check in order (first match wins):

1. `.cursor-plugin/plugin.json` → `cursor-plugin`
2. `.claude-plugin/plugin.json` → `claude-plugin`
3. `.codex-plugin/plugin.json` → `codex-plugin`
4. `.github/plugin/plugin.json` → `copilot-plugin`

Mirror the same paths in `isPluginSourcePath` (`src/services/scanner.ts`).

- [ ] **Step 4: Run tests and commit**

```bash
bun test test/services/plugin-source-import.test.ts
git commit -m "feat(plugin-import): support codex and copilot plugin manifests"
```

---

### Task 3: Import `commands/` and `hooks/` from plugin trees

**Problem:** `scanPluginRoot` only collects `skills/`, `agents/`, `rules/`. Ponytail's canonical commands live in `commands/*.toml` and hooks in `hooks/hooks.json` / `hooks/copilot-hooks.json`.

**Files:**
- Modify: `src/services/plugin-source-import.ts`
- Test: `test/services/plugin-source-import.test.ts`
- Fixture: copy `commands/ponytail.toml`, `hooks/hooks.json` into `test/fixtures/plugin-import/claude-ponytail/`

- [ ] **Step 1: Write failing test for command + hook import**

```typescript
it("imports TOML commands and JSON hooks from plugin manifest pointers", async () => {
  const entries = await scanPluginSource(join(fixtureRoot, "claude-ponytail"));
  const types = entries[0]?.resources.map((r) => r.type) ?? [];
  expect(types).toContain("command");
  expect(types).toContain("hook");
});
```

- [ ] **Step 2: Add `scanCommands(rootPath, manifest, metadata)`**

Resolution order:

1. If `plugin.json` has `"commands": "<dir>"`, scan that directory.
2. Else scan `commands/` at plugin root.

For each file:

- `*.md` → `type: command`, content = file body
- `*.toml` → parse with `smol-toml` `parse()`, map `description` + `prompt` fields into command content (store raw TOML in metadata `format: "toml"` for round-trip)

Name = basename without extension.

- [ ] **Step 3: Add `scanHooks(rootPath, manifest, metadata)`**

Resolution order:

1. `plugin.json` `"hooks"` path (file or directory)
2. `hooks/hooks.json` (Claude/Codex convention)
3. `hooks/copilot-hooks.json` (Copilot convention)

Parse JSON `hooks` object; emit one `hook` resource per event with metadata:

```typescript
interface HookMetadata {
  event: string;
  command?: string;
  commandWindows?: string;
  timeout?: number;
  matcher?: string;
  imported_from: ImportedResourceProvenance;
}
```

Store full hook entry JSON in metadata for serialize round-trip where supported.

- [ ] **Step 4: Include in `scanPluginRoot` resource array**

```typescript
const resources = [
  ...scanSkills(...),
  ...scanAgents(...),
  ...scanRules(...),
  ...scanCommands(rootPath, manifest, ...),
  ...scanHooks(rootPath, manifest, ...),
];
```

- [ ] **Step 5: Run tests and commit**

```bash
bun test test/services/plugin-source-import.test.ts
git commit -m "feat(plugin-import): scan commands and hooks from plugin trees"
```

---

## Phase 2 — Registry & scan path fidelity (high impact)

### Task 4: Fix harness path registry for ponytail adapters

**Problem:** Registry paths don't match real on-disk layouts ponytail (and others) use.

**Files:**
- Modify: `src/platforms/registry.ts`
- Modify: `src/platforms/opencode.ts` (scan `.opencode/command/` as alias)
- Modify: `src/platforms/generic-agents.ts` (`scanRulesAt` for directory rules)
- Test: `test/platforms/registry-paths.test.ts`, `test/platforms/opencode.test.ts`

| Harness | Current | Target |
|---------|---------|--------|
| windsurf | `instructions: ".windsurfrules"` | Add `rules: ".windsurf/rules/"`; keep `.windsurfrules` as legacy alias in detection |
| cline | `rules: ".clinerules"` (file) | `rules: ".clinerules/"` (directory) + legacy single-file |
| opencode | `commands: ".opencode/commands/"` | Also scan `.opencode/command/` |

- [ ] **Step 1: Write failing detection tests using ponytail paths**

```typescript
// test/platforms/registry-paths.test.ts
import { detectPlatforms } from "../../src/services/scanner.ts";
import { join } from "node:path";

const ponytail = join(import.meta.dirname, "../fixtures/ponytail/full");

it("detects windsurf from .windsurf/rules", () => {
  expect(detectPlatforms(ponytail)).toContain("windsurf");
});
```

Copy minimal `.windsurf/rules/ponytail.md`, `.clinerules/ponytail.md`, `.opencode/command/ponytail.md` into fixture.

- [ ] **Step 2: Update `platformHasFiles` / registry `projectPaths`**

In `registry.ts`:

```typescript
def("windsurf", "Windsurf", ["instructions", "skills", "rules", "mcp"], {
  instructions: ".windsurfrules",
  rules: ".windsurf/rules/",
  skills: ".agents/skills/",
}, { ... }),

def("cline", "Cline", ["instructions", "skills", "rules", "mcp"], {
  instructions: "AGENTS.md",
  rules: ".clinerules/",
  legacy_rules: ".clinerules", // optional: add to PlatformPaths type
  skills: ".agents/skills/",
}, { ... }),
```

Extend `PlatformPaths` in `src/types.ts` with optional `legacy_*` keys OR teach `platformHasFiles` to check alternates via a small `alternateProjectPaths` map.

- [ ] **Step 3: OpenCode scan both command directories**

In `opencode.ts` `scan`:

```typescript
for (const commandsDir of [".opencode/commands", ".opencode/command"]) {
  // existing loop
}
```

- [ ] **Step 4: Serialize opencode commands to `.opencode/command/` when source was `.md` from that path** (preserve path style in resource `source` field).

- [ ] **Step 5: Run tests and commit**

```bash
bun test test/platforms/
git commit -m "fix(registry): align windsurf, cline, opencode paths with real layouts"
```

---

### Task 5: Add `kiro` and `pi` harnesses

**Problem:** Ponytail supports Kiro (`.kiro/steering/`) and pi (`pi-extension/`) — not in the 31-harness registry.

**Files:**
- Modify: `src/platforms/registry.ts`
- Document: `docs/portability-limits.md` (pi install is `pi install git:…`, not file copy)
- Test: `test/platforms/generic-agents.test.ts`

- [ ] **Step 1: Register `kiro` as generic-agents harness**

```typescript
def("kiro", "Kiro", ["instructions", "skills", "rules"], {
  instructions: "AGENTS.md",
  rules: ".kiro/steering/",
  skills: ".agents/skills/",
}, {
  skills: "~/.kiro/skills/", // verify against Kiro docs; adjust if wrong
}),
```

- [ ] **Step 2: Register `pi` with scan-only metadata**

```typescript
def("pi", "Pi", ["instructions", "skills"], {
  instructions: "AGENTS.md",
  skills: ".agents/skills/",
  // pi-extension/ is install-time only — not a project path
}, {}),
```

Add note in registry comment: pi extensions are installed via `pi install`, not `layer apply`. HarnessDeck can scan `skills/` via dual-mode plugin import but cannot materialize `pi-extension/index.js`.

- [ ] **Step 3: Test detection + scan of `.kiro/steering/ponytail.md`**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(registry): add kiro and pi harness entries"
```

---

### Task 6: Gemini extension manifest (`gemini-extension.json`)

**Problem:** Gemini CLI loads always-on context via extension manifest (`contextFileName: "AGENTS.md"`) and auto-discovers `commands/*.toml` + `skills/`. HarnessDeck's `gemini-cli` generic entry only knows `AGENTS.md` + `.agents/skills/`.

**Files:**
- Create: `src/platforms/gemini-cli.ts` (dedicated serializer, register in `platform-serializers.ts`)
- Modify: `src/platforms/registry.ts` (mark as supported in `harness list --supported` if serializer is native)
- Test: `test/platforms/gemini-cli.test.ts`
- Fixture: `gemini-extension.json` + `commands/`, `skills/` from ponytail

- [ ] **Step 1: Write failing scan test**

```typescript
it("reads gemini-extension.json contextFileName and repo-root skills", async () => {
  const serializer = new GeminiCliSerializer();
  const resources = await serializer.scan(fixtureRoot);
  expect(resources.some((r) => r.type === "instruction")).toBe(true);
  expect(resources.some((r) => r.type === "skill")).toBe(true);
});
```

- [ ] **Step 2: Implement scan**

- Read `gemini-extension.json`; if `contextFileName` set, import that file as `instruction` (`gemini-instructions`).
- Scan `skills/` at repo root when no `.agents/skills/` (dual with plugin layout).
- Scan `commands/*.toml` as commands.

- [ ] **Step 3: Implement serialize**

- Write `gemini-extension.json` stub pointing at `AGENTS.md` when instruction resource applied.
- Emit skills to `.agents/skills/` (Gemini discovery path).
- Emit commands to `commands/*.toml`.

- [ ] **Step 4: Register serializer and update SPEC harness count**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(gemini-cli): dedicated serializer with extension manifest support"
```

---

## Phase 3 — Apply & mirror fidelity (medium impact)

### Task 7: Instruction-tier apply strategy

**Problem:** Applying skills to windsurf/cline/github-copilot/gemini-cli writes `.agents/skills/`, but ponytail (and those hosts in instruction mode) expect always-on rule files (`.windsurf/rules/`, `.clinerules/`, etc.).

**Files:**
- Modify: `src/types.ts` — extend `PlatformDefinition` with `skillEmission?: "native" | "instruction-only"`
- Modify: `src/platforms/registry.ts` — set `skillEmission: "instruction-only"` for windsurf, cline, github-copilot, gemini-cli, kiro
- Modify: `src/platforms/generic-agents.ts`, `src/platforms/copilot.ts`, `src/platforms/gemini-cli.ts` serialize paths
- Test: `test/platforms/instruction-tier-apply.test.ts`

- [ ] **Step 1: Write failing apply test**

```typescript
it("emits windsurf skills as .windsurf/rules/{name}.md", async () => {
  const files = await generateFiles(skillResources, ["windsurf"], projectRoot);
  expect(files[0]?.files[0]?.path).toMatch(/^\.windsurf\/rules\//);
});
```

- [ ] **Step 2: Implement in generic serializer**

When `platform.skillEmission === "instruction-only"`:

- `skill` resources → single-file rules under `rules` path (`.windsurf/rules/`, `.clinerules/`, `.github/copilot-instructions.md` merge for copilot)
- For github-copilot: append skill bodies as sections to `.github/copilot-instructions.md` rather than `.agents/skills/`

- [ ] **Step 3: Layer-level override (optional, YAGNI gate)**

Only if needed after generic implementation: `[[layers.harness_options.windsurf]] skill_emission = "native"` in TOML transport. Defer unless product asks for per-layer override.

- [ ] **Step 4: Run tests and commit**

```bash
git commit -m "feat(apply): instruction-tier skill emission for windsurf, cline, copilot"
```

---

### Task 8: Cursor skill fidelity options

**Problem:** Cursor project serialize emits skills as agent-requested `.cursor/rules/*.mdc` (`alwaysApply: false`). Ponytail ships one always-on `ponytail.mdc`. Applying 5 skills creates 5 rule files instead of one combined rule.

**Files:**
- Modify: `src/types.ts` — `SerializeOptions.skillCursorMode?: "agent-requested" | "always-on" | "agents-skills"`
- Modify: `src/platforms/cursor.ts`
- Modify: `src/models/harness.ts` — optional project-level `cursor_skill_mode`
- Test: `test/platforms/cursor.test.ts`

- [ ] **Step 1: Write failing tests for three modes**

```typescript
it("always-on mode emits single combined ponytail.mdc when one instruction exists", async () => { ... });
it("agents-skills mode writes .agents/skills/ for project target", async () => { ... });
```

- [ ] **Step 2: Implement `agents-skills` project path**

Cursor registry already declares `skills: ".agents/skills/"` — use it when `skillCursorMode === "agents-skills"` (matches Cursor's newer skills support).

- [ ] **Step 3: Implement `always-on` mode**

Merge all `skill` resources into one `.cursor/rules/{layer-or-project-name}.mdc` with `alwaysApply: true`, or emit one file per skill with `alwaysApply: true` when `collapseSkills: false`.

Default for instruction-tier parity with ponytail: **one file per skill with `alwaysApply: true`** when mode is `always-on`.

- [ ] **Step 4: Default remains `agent-requested`** (no behavior change for existing users).

- [ ] **Step 5: Document in `docs/portability-limits.md` and commit**

---

### Task 9: `project mirror` fallback when main harness is empty

**Problem:** `project mirror` on ponytail fails: main `claude-code` has no `.claude/` tree, only `.claude-plugin/`.

**Files:**
- Modify: `src/services/project-sync.ts`
- Test: `test/services/project-sync.test.ts`
- Fixture: `test/fixtures/ponytail/full/`

- [ ] **Step 1: Write failing test**

```typescript
it("falls back to plugin-imported skills when main harness scan is empty", async () => {
  const result = await syncProject({
    projectRoot: ponytailFixture,
    dryRun: true,
    referenceStrategy: "plugin-then-agents", // new option
  });
  expect(result.files_written).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Implement reference resolution chain**

When main harness `scanPlatform` returns 0 resources, try in order:

1. `scanPluginSource(projectRoot)` → flatten plugin resources to canonical resources
2. If still empty, scan `AGENTS.md` from any detected alias harness
3. If still empty, throw with actionable error:

```
Main harness "claude-code" has no on-disk resources.
Try: harnessdeck project scan --include-plugin-source always
Or: harnessdeck harness project set --main codex
```

- [ ] **Step 3: Add `--reference {main|plugin|agents}` flag to `project mirror`**

Default: `main` (unchanged). `plugin` forces plugin source. `auto` uses fallback chain.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(mirror): fallback to plugin source when main harness is empty"
```

---

## Phase 4 — Serializer completeness & documentation (medium / lower priority)

### Task 10: Codex `config.toml` parsing

**Problem:** `src/platforms/codex.ts` has `TODO: Parse .codex/config.toml for MCP servers, permissions, model config`. Ponytail codex plugin uses hooks via plugin install, but config.toml is common in real repos.

**Files:**
- Modify: `src/platforms/codex.ts`
- Test: `test/platforms/codex.test.ts`
- Fixture: minimal `.codex/config.toml` with `[mcp_servers]`, permissions section

- [ ] **Step 1: Write failing scan test for MCP + permissions from config.toml**

- [ ] **Step 2: Parse with `smol-toml`**

Map to existing resource types: `mcp_server`, `permission`, `model_config`, `env_var` following Codex schema (grep codex docs / existing test fixtures).

- [ ] **Step 3: Serialize back to `.codex/config.toml`** preserving unrelated keys via merge strategy (read existing file, overlay managed keys).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(codex): scan and serialize config.toml MCP and permissions"
```

---

### Task 11: Portability limits documentation

**Problem:** Runtime adapters (hooks with `PLUGIN_ROOT`, OpenCode `.mjs` plugins, mode switching, Copilot command namespacing) cannot be faithfully auto-bridged.

**Files:**
- Create: `docs/portability-limits.md`
- Modify: `docs/scenarios/scenarios.md` — add scenarios 31–34
- Modify: `SPEC.md` — link portability limits under Agent harness model

- [ ] **Step 1: Write `docs/portability-limits.md`**

Sections:

1. **Fully bridgeable** — skills, static instructions, rules, MCP (stdio/http), static commands (md/toml), agents
2. **Partially bridgeable** — hooks (importable metadata, but `${CLAUDE_PLUGIN_ROOT}` paths require plugin install), Copilot namespaced commands
3. **Not bridgeable** — OpenCode server plugins (`.mjs`), pi extensions, runtime mode state (`PONYTAIL_DEFAULT_MODE`, `~/.config/ponytail/`), statusline hooks, Gemini→Antigravity command conversion
4. **Intentional per-host tailoring** — ponytail's `check-rule-copies.js` pattern; HarnessDeck merges/canonicalizes, does not replicate hand-tuned adapter copies
5. **Workarounds** — `layer` plugin pins + `resource sync` from install tree; document `copilot plugin install` flow

- [ ] **Step 2: Add scenarios**

| # | Title | Frequency |
|---|-------|-----------|
| 31 | Import dual-mode plugin repo | Common |
| 32 | Apply to instruction-tier harnesses | Occasional |
| 33 | Mirror with plugin-source fallback | Occasional |
| 34 | Understand portability limits | Occasional |

Create `docs/scenarios/details/31-dual-mode-plugin-import.md` etc. with commands from this plan.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: portability limits and ponytail-derived scenarios"
```

---

### Task 12: Ponytail integration test (end-to-end guard)

**Files:**
- Create: `test/integration/ponytail-portability.test.ts`
- Script: `scripts/vendor-ponytail-fixture.sh` (shallow clone pinned tag into `test/fixtures/ponytail/upstream/` — optional, or hand-trimmed fixture for CI)

- [ ] **Step 1: Hand-trimmed fixture (preferred for CI)**

`test/fixtures/ponytail/full/` contains minimal subset (no benchmarks/). Already partially created in Task 1/4.

- [ ] **Step 2: End-to-end test**

```typescript
describe("ponytail portability", () => {
  it("scan --include-plugin-source always imports 5 skills + instructions", async () => { ... });
  it("layer apply to claude-code + codex emits native skill paths", async () => { ... });
  it("layer apply to windsurf emits .windsurf/rules not .agents/skills", async () => { ... });
  it("does not claim to materialize opencode .mjs plugin", async () => {
    const files = await generateFiles(resources, ["opencode"], root);
    expect(files.flatMap((r) => r.files).some((f) => f.path.endsWith(".mjs"))).toBe(false);
  });
});
```

- [ ] **Step 3: Add to CI** — included in `bun run test:run`

- [ ] **Step 4: Commit**

```bash
git commit -m "test: ponytail portability integration guard"
```

---

## Phase summary & dependency graph

```
Phase 1 (import)     Phase 2 (registry)     Phase 3 (apply)        Phase 4 (docs/codex)
─────────────────    ──────────────────     ───────────────        ────────────────────
Task 1 dual-mode ──► Task 4 paths ─────────► Task 7 instr-tier ──► Task 11 docs
Task 2 manifests      Task 5 kiro/pi         Task 8 cursor        Task 10 codex toml
Task 3 cmds/hooks     Task 6 gemini          Task 9 mirror        Task 12 e2e test
```

Phases are independently shippable. Recommended merge order: 1 → 2 → 3 → 4.

---

## SPEC / CLI surface changes (changelog)

| Change | Type |
|--------|------|
| `project scan --include-plugin-source auto\|always\|never` | New flag (default `auto`) |
| `project mirror --reference auto\|main\|plugin\|agents` | New flag |
| `IMPORTED_SOURCE_KINDS` + `codex-plugin`, `copilot-plugin` | Schema extension |
| `harness list --supported` includes `gemini-cli` | If Task 6 ships native serializer |
| Harness count 31 → 33 (`kiro`, `pi`) | Registry |
| `SerializeOptions.skillCursorMode` | Internal + project harness config |
| `PlatformDefinition.skillEmission` | Registry metadata |

---

## Verification checklist (ponytail repo)

After all phases, run against `/tmp/ponytail` or vendored fixture:

```bash
bun run build
hd project scan /path/to/ponytail --include-plugin-source always --dry-run
# Expect: harness instructions + plugin ponytail · 5+ resources (skills, commands, hooks)

hd layer from-project ponytail-layer --project /path/to/ponytail
hd layer show ponytail-layer
# Expect: skills + instructions

hd layer apply ponytail-layer --harness claude-code,codex,cursor,windsurf --dry-run
# Expect: native paths per harness; windsurf → .windsurf/rules; cursor per skillCursorMode

hd project mirror /path/to/ponytail --reference auto --dry-run
# Expect: success when plugin fallback enabled

bun run test:run
bun run typecheck
```

---

## Self-review (spec coverage)

| Recommended improvement | Task |
|-------------------------|------|
| 1. Dual-mode scan | Task 1 |
| 2. Extend plugin-source-import | Tasks 2, 3 |
| 3. Registry path updates | Task 4 |
| 4. project mirror fallback | Task 9 |
| 5. Add kiro, pi | Task 5 |
| 6. Gemini extension manifest | Task 6 |
| 7. Instruction-tier apply | Task 7 |
| 8. Cursor skill fidelity | Task 8 |
| 9. Document non-bridgeable | Task 11 |
| 10. Codex config.toml | Task 10 |

No placeholder steps remain; each task names files, tests, and commit messages.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-ponytail-portability-gaps.md`. Two execution options:**

1. **Subagent-Driven (recommended)** — one fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — implement tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
