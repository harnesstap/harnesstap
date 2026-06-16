# `harnessdeck add` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `bunx harnessdeck@latest add owner/repo` — clone a remote skill package, import all skills into the HarnessDeck library under a source namespace, and install a user-selected subset globally (or to a project) via a `~/.agents/skills/` hub with symlink fan-out, matching `skills add` UX while enabling `layer combine` / deck workflows.

**Architecture:** Six focused modules on `main`: (1) **source-resolver** — GitHub shorthand → URL + cache path; (2) **skill-discovery** — recursive `SKILL.md` scan with categories; (3) **repo-profile** — route to skill-package wizard in v1; (4) **skill-package-import** — persist imported snapshot + namespaced resources; (5) **skill-install** — hub + symlink fan-out using registry global paths; (6) **CLI `add`** — wizard, flags, JSON output. Reuses `refreshGitSource`, `createImportedSnapshot`, `addLayerAttachment`, and harness target resolution from existing scan/global install.

**Tech stack:** TypeScript, Bun test runner, existing scanner/resource/applier/layer-attachment modules.

**Design spec:** [2026-06-15-add-command-design.md](../specs/2026-06-15-add-command-design.md)

---

## File map

| Area | Files |
| ---- | ----- |
| Source resolution | `src/services/source-resolver.ts` (new) |
| Skill discovery | `src/services/skill-discovery.ts` (new) |
| Repo routing | `src/services/repo-profile.ts` (new) |
| Library import | `src/services/skill-package-import.ts` (new) |
| Disk install | `src/services/skill-install.ts` (new) |
| Orchestration | `src/services/add-package.ts` (new) |
| Harness targets | `src/services/harness-targets.ts` (new, extract from `index.ts`) |
| Wizard | `src/cli/add-wizard.ts` (new) |
| Types | `src/types.ts` |
| CLI wiring | `src/index.ts` |
| Fixture | `test/fixtures/skill-packages/mattpocock-minimal/` |
| Tests | `test/services/source-resolver.test.ts`, `skill-discovery.test.ts`, `skill-package-import.test.ts`, `skill-install.test.ts`, `test/cli/add.test.ts`, `test/integration/add-skill-package.test.ts` |
| Docs | `docs/cli/command-reference.md`, `docs/scenarios/scenarios.md`, `docs/scenarios/details/35-add-skill-package.md`, `SPEC.md`, `docs/superpowers/specs/README.md` |

---

## Fixture: `test/fixtures/skill-packages/mattpocock-minimal/`

```
mattpocock-minimal/
  .claude-plugin/plugin.json          # { "name": "mattpocock-skills", ... }
  skills/
    caveman/SKILL.md                  # flat skill
    engineering/
      tdd/SKILL.md                    # nested skill
      triage/SKILL.md
  README.md
```

Example `skills/caveman/SKILL.md`:

```markdown
---
name: caveman
description: Caveman debugging skill
---
# Caveman
```

Example `skills/engineering/tdd/SKILL.md`:

```markdown
---
name: tdd
description: Test-driven development loop
---
# TDD
```

---

## Phase 1 — Source resolver & cache

### Task 1: Resolve GitHub shorthand and cache paths

**Files:**
- Create: `src/services/source-resolver.ts`
- Test: `test/services/source-resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/services/source-resolver.test.ts
import { describe, expect, it } from "bun:test";
import {
  resolveRemoteSource,
  sourceCacheDir,
} from "../../src/services/source-resolver.ts";

describe("source-resolver", () => {
  it("resolves owner/repo to github git URL", () => {
    expect(resolveRemoteSource("mattpocock/skills")).toEqual({
      kind: "git",
      url: "https://github.com/mattpocock/skills.git",
      label: "mattpocock/skills",
      owner: "mattpocock",
      repo: "skills",
    });
  });

  it("normalizes https github URLs", () => {
    expect(resolveRemoteSource("https://github.com/mattpocock/skills")).toMatchObject({
      kind: "git",
      url: "https://github.com/mattpocock/skills.git",
      label: "mattpocock/skills",
    });
  });

  it("passes through local directories", () => {
    const fixture = new URL("../fixtures/skill-packages/mattpocock-minimal", import.meta.url).pathname;
    expect(resolveRemoteSource(fixture)).toEqual({
      kind: "local",
      path: fixture,
      label: "mattpocock-minimal",
    });
  });

  it("builds stable cache dir under harnessdeck home", () => {
    expect(sourceCacheDir("/hd/home", "mattpocock", "skills")).toBe(
      "/hd/home/cache/sources/mattpocock/skills",
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test test/services/source-resolver.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 3: Implement resolver**

```typescript
// src/services/source-resolver.ts
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { projectNameFromUrl } from "./git.js";

export interface GitRemoteSource {
  kind: "git";
  url: string;
  label: string;
  owner: string;
  repo: string;
}

export interface LocalRemoteSource {
  kind: "local";
  path: string;
  label: string;
}

export type ResolvedRemoteSource = GitRemoteSource | LocalRemoteSource;

const GITHUB_SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function parseOwnerRepo(label: string): { owner: string; repo: string } {
  const [owner, repo] = label.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid source: ${label}`);
  }
  return { owner, repo };
}

export function resolveRemoteSource(input: string): ResolvedRemoteSource {
  const trimmed = input.trim();

  if (existsSync(trimmed)) {
    return {
      kind: "local",
      path: resolve(trimmed),
      label: basename(resolve(trimmed)),
    };
  }

  if (GITHUB_SHORTHAND.test(trimmed)) {
    const { owner, repo } = parseOwnerRepo(trimmed);
    return {
      kind: "git",
      url: `https://github.com/${owner}/${repo}.git`,
      label: trimmed,
      owner,
      repo,
    };
  }

  if (trimmed.startsWith("git@") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const label = projectNameFromUrl(trimmed);
    const { owner, repo } = parseOwnerRepo(label);
    const url = trimmed.endsWith(".git") ? trimmed : `${trimmed.replace(/\/$/, "")}.git`;
    return { kind: "git", url, label, owner, repo };
  }

  throw new Error(
    `Unrecognized source "${input}". Use owner/repo, a Git URL, or a local path.`,
  );
}

export function sourceCacheDir(harnessdeckDir: string, owner: string, repo: string): string {
  return `${harnessdeckDir}/cache/sources/${owner}/${repo}`;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bun test test/services/source-resolver.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/source-resolver.ts test/services/source-resolver.test.ts
git commit -m "feat: add remote source resolver for hd add"
```

---

## Phase 2 — Recursive skill discovery

### Task 2: Discover nested SKILL.md trees with categories

**Files:**
- Create: `src/services/skill-discovery.ts`
- Create: `test/fixtures/skill-packages/mattpocock-minimal/` (layout above)
- Test: `test/services/skill-discovery.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/services/skill-discovery.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { discoverSkillPackage } from "../../src/services/skill-discovery.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("skill-discovery", () => {
  it("finds flat and nested skills under skills/", () => {
    const found = discoverSkillPackage(fixture);
    expect(found.map((s) => s.name).sort()).toEqual(["caveman", "tdd", "triage"]);
  });

  it("assigns category from path segment", () => {
    const found = discoverSkillPackage(fixture);
    expect(found.find((s) => s.name === "tdd")).toMatchObject({
      category: "engineering",
      skillDirRelative: "skills/engineering/tdd",
    });
    expect(found.find((s) => s.name === "caveman")).toMatchObject({
      category: "general",
      skillDirRelative: "skills/caveman",
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test test/services/skill-discovery.test.ts`

- [ ] **Step 3: Implement discovery**

```typescript
// src/services/skill-discovery.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import matter from "gray-matter";

export interface DiscoveredSkill {
  name: string;
  description: string;
  category: string;
  skillDirRelative: string;
  skillMdRelative: string;
}

const SKILL_ROOTS = ["skills", ".agents/skills"] as const;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readSkillMd(skillDir: string): { name: string; description: string; body: string } | null {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  const raw = readFileSync(skillPath, "utf-8");
  const parsed = matter(raw);
  const dirName = skillDir.split(/[/\\]/).pop() ?? "skill";
  return {
    name: typeof parsed.data.name === "string" && parsed.data.name.trim()
      ? parsed.data.name.trim()
      : dirName,
    description: typeof parsed.data.description === "string" ? parsed.data.description : "",
    body: parsed.content,
  };
}

function walkForSkills(rootPath: string, currentDir: string, results: DiscoveredSkill[]): void {
  if (!isDirectory(currentDir)) return;

  const skill = readSkillMd(currentDir);
  if (skill) {
    const skillDirRelative = relative(rootPath, currentDir).split("\\").join("/");
    const parts = skillDirRelative.split("/");
    const category =
      parts.length >= 3 && parts[0] === "skills" ? parts[1] ?? "general" : "general";
    results.push({
      name: skill.name,
      description: skill.description,
      category,
      skillDirRelative,
      skillMdRelative: `${skillDirRelative}/SKILL.md`,
    });
    return;
  }

  for (const entry of readdirSync(currentDir)) {
    if (entry.startsWith(".")) continue;
    walkForSkills(rootPath, join(currentDir, entry), results);
  }
}

export function discoverSkillPackage(rootPath: string): DiscoveredSkill[] {
  const results: DiscoveredSkill[] = [];
  for (const root of SKILL_ROOTS) {
    const dir = join(rootPath, root);
    if (!isDirectory(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      walkForSkills(rootPath, join(dir, entry), results);
    }
  }

  const byName = new Map<string, DiscoveredSkill>();
  for (const skill of results) {
    byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Create fixture files** (directories + SKILL.md content from spec)

- [ ] **Step 5: Run test — expect PASS**

Run: `bun test test/services/skill-discovery.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/services/skill-discovery.ts test/services/skill-discovery.test.ts test/fixtures/skill-packages/
git commit -m "feat: recursive skill package discovery"
```

---

## Phase 3 — Types & repo profile

### Task 3: Add skill-package source kind and repo classifier

**Files:**
- Modify: `src/types.ts`
- Create: `src/services/repo-profile.ts`
- Test: `test/services/repo-profile.test.ts`

- [ ] **Step 1: Extend IMPORTED_SOURCE_KINDS**

In `src/types.ts`, add `"skill-package"` to `IMPORTED_SOURCE_KINDS` array.

- [ ] **Step 2: Write failing repo-profile test**

```typescript
// test/services/repo-profile.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { classifyRepo } from "../../src/services/repo-profile.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("repo-profile", () => {
  it("detects skill-package for mattpocock-style repo", () => {
    expect(classifyRepo(fixture)).toEqual({
      primary: "skill-package",
      profiles: expect.arrayContaining(["skill-package", "plugin-source"]),
    });
  });
});
```

- [ ] **Step 3: Implement classifier**

```typescript
// src/services/repo-profile.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { discoverSkillPackage } from "./skill-discovery.js";
import { hasPluginSourceLayout } from "./scanner.js";
import { detectPlatforms } from "./scanner.js";

export type RepoProfile =
  | "skill-package"
  | "plugin-source"
  | "layer-bundle"
  | "deck-repo"
  | "harness-project"
  | "unknown";

export interface RepoClassification {
  primary: RepoProfile;
  profiles: RepoProfile[];
}

export function classifyRepo(rootPath: string): RepoClassification {
  const profiles: RepoProfile[] = [];

  if (discoverSkillPackage(rootPath).length > 0) {
    profiles.push("skill-package");
  }
  if (hasPluginSourceLayout(rootPath)) {
    profiles.push("plugin-source");
  }
  if (existsSync(join(rootPath, ".harnessdeck", "deck.toml"))) {
    profiles.push("deck-repo");
  }
  if (detectPlatforms(rootPath).length > 0) {
    profiles.push("harness-project");
  }

  const primary =
    profiles.includes("skill-package") ? "skill-package"
    : profiles.includes("plugin-source") ? "plugin-source"
    : profiles.includes("deck-repo") ? "deck-repo"
    : profiles.includes("harness-project") ? "harness-project"
    : "unknown";

  return { primary, profiles };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `bun test test/services/repo-profile.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/services/repo-profile.ts test/services/repo-profile.test.ts
git commit -m "feat: classify repos for hd add routing"
```

---

## Phase 4 — Skill package import to library

### Task 4: Persist namespaced skills + imported snapshot

**Files:**
- Create: `src/services/skill-package-import.ts`
- Test: `test/services/skill-package-import.test.ts`

- [ ] **Step 1: Write failing import test**

```typescript
// test/services/skill-package-import.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { importSkillPackage } from "../../src/services/skill-package-import.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("skill-package-import", () => {
  it("persists all skills under source namespace", async () => {
    const context = await createInitializedTestContext("skill-package-import");
    try {
      const result = await importSkillPackage({
        rootPath: fixture,
        sourceLabel: "mattpocock/skills",
        gitSha: "abc123",
        gitUrl: "https://github.com/mattpocock/skills.git",
      });

      expect(result.snapshot.source_kind).toBe("skill-package");
      expect(result.resources).toHaveLength(3);

      const resourceModel = await import("../../src/models/resource.ts");
      const caveman = resourceModel.findExistingResource("skill", "caveman", "mattpocock/skills");
      expect(caveman).toMatchObject({
        type: "skill",
        name: "caveman",
        namespace: "mattpocock/skills",
        description: "Caveman debugging skill",
      });
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement import**

Key behavior:
- `discoverSkillPackage(rootPath)` → build resources with `readFileSync` on each `SKILL.md`
- `namespace: sourceLabel` (e.g. `mattpocock/skills`)
- `origin_kind: "marketplace_link"` or new `"remote_git"` — match plugin import: use `origin_kind: "local_snapshot"`, `origin_ref: `${sourceLabel}@${gitSha}``
- `metadata.imported_from` with `source_kind: "skill-package"`, `relative_path`, `plugin_name` = display name from README title or repo segment
- `createImportedSnapshot({ source_kind: "skill-package", ... })`
- `upsertResource` for each skill (reuse `scanAndPersistPluginSource` upsert loop pattern from `scanner.ts`)

Export:

```typescript
export interface ImportSkillPackageResult {
  snapshot: ImportedSnapshot;
  resources: Resource[];
}

export async function importSkillPackage(options: {
  rootPath: string;
  sourceLabel: string;
  gitUrl?: string;
  gitSha?: string;
  pluginDisplayName?: string;
}): Promise<ImportSkillPackageResult>;
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bun test test/services/skill-package-import.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/skill-package-import.ts test/services/skill-package-import.test.ts
git commit -m "feat: import skill packages into harnessdeck library"
```

---

## Phase 5 — Hub + symlink install

### Task 5: Install selected skills to global hub with fan-out

**Files:**
- Create: `src/services/skill-install.ts`
- Create: `src/services/harness-targets.ts` (extract `resolveScanGlobalHarnessTargets` from `index.ts`)
- Modify: `src/index.ts` (re-export / delegate to harness-targets)
- Test: `test/services/skill-install.test.ts`

- [ ] **Step 1: Extract harness target resolver**

Move `resolveScanGlobalHarnessTargets` and helpers it needs from `src/index.ts` to `src/services/harness-targets.ts`. Update `index.ts` to import from there. Run existing scan tests:

Run: `bun test test/cli/scan.test.ts test/services/scanner.test.ts`

- [ ] **Step 2: Write failing install test**

```typescript
// test/services/skill-install.test.ts
import { describe, expect, it } from "bun:test";
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { installSkillsToGlobal } from "../../src/services/skill-install.ts";
import { discoverSkillPackage } from "../../src/services/skill-discovery.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("skill-install", () => {
  it("symlinks hub and claude global path to cache skill dir", async () => {
    const context = await createInitializedTestContext("skill-install-global");
    try {
      const skills = discoverSkillPackage(fixture).filter((s) => s.name === "caveman");
      const result = await installSkillsToGlobal({
        checkoutRoot: fixture,
        skills,
        harnesses: ["claude-code", "codex"],
        homeRoot: context.homeDir,
        method: "symlink",
      });

      expect(result.installed).toEqual(["caveman"]);
      const hub = join(context.homeDir, ".agents/skills/caveman");
      const claude = join(context.homeDir, ".claude/skills/caveman");
      expect(lstatSync(hub).isSymbolicLink()).toBe(true);
      expect(lstatSync(claude).isSymbolicLink()).toBe(true);
      expect(readlinkSync(claude)).toContain(".agents/skills/caveman");
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 3: Implement install**

```typescript
// src/services/skill-install.ts — core helpers
import { existsSync, mkdirSync, rmSync, symlinkSync, cpSync, lstatSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { getAllPlatforms } from "../platforms/registry.js";
import type { DiscoveredSkill } from "./skill-discovery.js";

export type SkillInstallMethod = "symlink" | "copy";

function resolveGlobalSkillPath(homeRoot: string, platformId: string): string | undefined {
  const platform = getAllPlatforms().find((p) => p.id === platformId);
  const configured = platform?.globalPaths.skills;
  if (!configured) return undefined;
  return configured.startsWith("~/")
    ? join(homeRoot, configured.slice(2))
    : join(homeRoot, configured);
}

function ensureSymlink(linkPath: string, targetPath: string): void {
  mkdirSync(dirname(linkPath), { recursive: true });
  if (existsSync(linkPath)) {
    rmSync(linkPath, { recursive: true, force: true });
  }
  symlinkSync(relative(dirname(linkPath), targetPath), linkPath);
}

export async function installSkillsToGlobal(options: {
  checkoutRoot: string;
  skills: DiscoveredSkill[];
  harnesses: string[];
  homeRoot: string;
  method: SkillInstallMethod;
}): Promise<{ installed: string[]; files: string[] }> {
  const installed: string[] = [];
  const files: string[] = [];

  for (const skill of options.skills) {
    const sourceDir = join(options.checkoutRoot, skill.skillDirRelative);
    const hubDir = join(options.homeRoot, ".agents/skills", skill.name);

    if (options.method === "copy") {
      mkdirSync(hubDir, { recursive: true });
      cpSync(sourceDir, hubDir, { recursive: true });
    } else {
      ensureSymlink(hubDir, sourceDir);
    }
    files.push(join(".agents/skills", skill.name));
    installed.push(skill.name);

    for (const harness of options.harnesses) {
      const targetRoot = resolveGlobalSkillPath(options.homeRoot, harness);
      if (!targetRoot) continue;
      const targetDir = join(targetRoot, skill.name);
      const hubPath = hubDir;
      if (targetDir === hubPath) continue;
      if (options.method === "copy") {
        mkdirSync(targetDir, { recursive: true });
        cpSync(sourceDir, targetDir, { recursive: true });
      } else {
        ensureSymlink(targetDir, hubPath);
      }
      files.push(join(targetRoot.replace(options.homeRoot + "/", ""), skill.name));
    }
  }

  return { installed, files };
}
```

Extend with `installSkillsToProject` mirroring hub under `{projectRoot}/.agents/skills/`.

Wire `recordImportedSnapshotInstall` when `snapshotId` passed (orchestration layer in Task 6).

- [ ] **Step 4: Run test — expect PASS**

Run: `bun test test/services/skill-install.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/skill-install.ts src/services/harness-targets.ts src/index.ts test/services/skill-install.test.ts
git commit -m "feat: hub-based global skill install with symlink fan-out"
```

---

## Phase 6 — Orchestration service

### Task 6: `addPackage` coordinates clone → import → install → layer

**Files:**
- Create: `src/services/add-package.ts`
- Test: `test/integration/add-skill-package.test.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
// test/integration/add-skill-package.test.ts
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInitializedTestContext } from "../helpers/db.ts";
import { addSkillPackage } from "../../src/services/add-package.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("addSkillPackage integration", () => {
  it("imports and installs selected skills from local source", async () => {
    const context = await createInitializedTestContext("add-skill-package");
    try {
      const { setHarnessPreference } = await import("../../src/models/harness.ts");
      setHarnessPreference({
        main_harness: "codex",
        alias_harnesses: ["claude-code"],
      });

      const result = await addSkillPackage({
        source: fixture,
        skillNames: ["caveman", "tdd"],
        scope: "global",
        method: "symlink",
        homeRoot: context.homeDir,
        harnessdeckDir: context.connection.getHarnessdeckDir(),
      });

      expect(result.importedSkills).toEqual(["caveman", "tdd", "triage"]);
      expect(result.installedSkills).toEqual(["caveman", "tdd"]);
      expect(existsSync(join(context.homeDir, ".agents/skills/caveman"))).toBe(true);
      expect(existsSync(join(context.homeDir, ".agents/skills/tdd"))).toBe(true);

      const resourceModel = await import("../../src/models/resource.ts");
      expect(
        resourceModel.findExistingResource("skill", "tdd", result.namespace),
      ).toBeDefined();
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Implement orchestrator**

```typescript
// src/services/add-package.ts
export interface AddSkillPackageOptions {
  source: string;
  skillNames?: string[];
  all?: boolean;
  scope: "global" | "project";
  projectRoot?: string;
  method: "symlink" | "copy";
  harnesses?: string[];
  homeRoot: string;
  harnessdeckDir: string;
  createLayer?: string;
  layer?: string;
  dryRun?: boolean;
}

export interface AddSkillPackageResult {
  namespace: string;
  importedSkills: string[];
  installedSkills: string[];
  layer?: string;
  snapshotId: string;
}
```

Flow:
1. `resolveRemoteSource(source)`
2. If git: `refreshGitSource` into `sourceCacheDir`; capture sha
3. `classifyRepo` — if not `skill-package`, throw with hint
4. `discoverSkillPackage`
5. Filter skills by `skillNames` or `--all`
6. Unless `dryRun`: `importSkillPackage` (always all discovered skills)
7. Unless `dryRun`: `installSkillsToGlobal` or `installSkillsToProject` for subset
8. Record snapshot installs; update snapshot metadata `installed_skill_names`
9. If `createLayer` / `layer`: `addLayerAttachment` for each installed skill

- [ ] **Step 3: Run integration test — expect PASS**

Run: `bun test test/integration/add-skill-package.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/services/add-package.ts test/integration/add-skill-package.test.ts
git commit -m "feat: orchestrate skill package add flow"
```

---

## Phase 7 — CLI `add` command + wizard

### Task 7: Wire top-level `add` command

**Files:**
- Create: `src/cli/add-wizard.ts`
- Modify: `src/index.ts`
- Test: `test/cli/add.test.ts`

- [ ] **Step 1: Write failing CLI test**

```typescript
// test/cli/add.test.ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

const fixture = join(import.meta.dirname, "../fixtures/skill-packages/mattpocock-minimal");

describe("CLI add", () => {
  it("installs skills globally with non-interactive flags", async () => {
    const context = await createTestContext("cli-add-global");
    try {
      await runCli(["init", "--main", "codex", "--aliases", "claude-code"]);
      const result = await runCli([
        "add", fixture,
        "--skill", "caveman",
        "--global",
        "--yes",
        "--format", "json",
      ]);
      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.installed_skills).toEqual(["caveman"]);
      expect(existsSync(join(context.homeDir, ".agents/skills/caveman"))).toBe(true);
    } finally {
      await context.cleanup();
    }
  });

  it("lists discovered skills with --list", async () => {
    const context = await createTestContext("cli-add-list");
    try {
      const result = await runCli(["add", fixture, "--list", "--format", "json"]);
      expect(JSON.parse(result.stdout).skills.map((s: { name: string }) => s.name)).toContain("tdd");
    } finally {
      await context.cleanup();
    }
  });
});
```

- [ ] **Step 2: Register command in index.ts**

```typescript
program
  .command("add")
  .argument("<source>", "GitHub owner/repo, Git URL, or local path")
  .option("--skill <names>", "Skills to install (comma-separated)")
  .option("--all", "Install all discovered skills")
  .option("--harness <slugs>", "Target harnesses")
  .option("--global", "Install to user home")
  .option("--project [path]", "Install to project directory")
  .option("--method <mode>", "symlink or copy", "symlink")
  .option("--layer <name>", "Combine into existing layer")
  .option("--create-layer <name>", "Create layer and attach skills")
  .option("--list", "List discovered skills only")
  .option("--dry-run", "Show plan without writing")
  .option("-y, --yes", "Skip prompts")
  .option("--format <mode>", "human or json", "human")
  .description("Add skills or other packages from a remote or local source")
  .action(handleAddCommand);
```

Implement `handleAddCommand`:
- Parse flags; if interactive (`shouldUseWizard`), call `runAddWizard` from `add-wizard.ts`
- Delegate to `addSkillPackage`
- Human mode: print summary panel (installed paths, namespace, layer hint)
- JSON mode: `{ source, namespace, discovered, imported, installed, layer, snapshot_id }`

- [ ] **Step 3: Implement wizard** (`runAddWizard`)

Steps match design spec §6; reuse `@clack/prompts` patterns from `init` / `layer from-project` wizards in `index.ts`.

- [ ] **Step 4: Run CLI tests — expect PASS**

Run: `bun test test/cli/add.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/cli/add-wizard.ts src/index.ts test/cli/add.test.ts
git commit -m "feat: add top-level hd add command for skill packages"
```

---

## Phase 8 — Layer combine helper & docs

### Task 8: `--create-layer` attaches namespaced skill refs

**Files:**
- Modify: `src/services/add-package.ts`
- Test: extend `test/integration/add-skill-package.test.ts`

- [ ] **Step 1: Write failing layer test**

```typescript
it("creates layer with skill refs when --create-layer set", async () => {
  const context = await createInitializedTestContext("add-create-layer");
  try {
    setHarnessPreference({ main_harness: "codex", alias_harnesses: [] });
    await addSkillPackage({
      source: fixture,
      skillNames: ["caveman"],
      scope: "global",
      method: "symlink",
      homeRoot: context.homeDir,
      harnessdeckDir: context.connection.getHarnessdeckDir(),
      createLayer: "mattpocock-skills",
    });
    const { getPlugin, listPluginResources } = await import("../../src/models/plugin-component.ts");
    const layer = getPlugin("mattpocock-skills");
    expect(layer).toBeDefined();
    const attached = listPluginResources(layer!.id);
    expect(attached.some((r) => r.type === "skill" && r.name === "caveman")).toBe(true);
  } finally {
    await context.cleanup();
  }
});
```

- [ ] **Step 2: Implement layer step in orchestrator**

After import, for each installed skill:

```typescript
await addLayerAttachment({
  layer,
  selector: `skill:${skill.name}@${namespace}`,
  type: "skill",
});
```

- [ ] **Step 3: Run tests — expect PASS**

Run: `bun test test/integration/add-skill-package.test.ts`

- [ ] **Step 4: Update docs**

- `docs/cli/command-reference.md` — new `add` section with flags table
- `docs/scenarios/details/35-add-skill-package.md` — walkthrough
- `docs/scenarios/scenarios.md` — row for scenario 35 (Common, Shipped after merge)
- `docs/superpowers/specs/README.md` — link design spec
- `SPEC.md` — short `add` behavior under scan/import section

- [ ] **Step 5: Run full test suite**

Run: `bun test`

- [ ] **Step 6: Commit**

```bash
git add src/services/add-package.ts test/integration/add-skill-package.test.ts docs/
git commit -m "feat: attach imported skills to layers via hd add --create-layer"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| ---------------- | ---- |
| `hd add <source>` top-level command | Task 7 |
| GitHub shorthand / URL / local path | Task 1 |
| Clone to harnessdeck cache | Task 6 (orchestrator) |
| Recursive skill discovery + categories | Task 2 |
| Repo auto-detection (skill-package v1) | Task 3 |
| Import all skills to library + namespace | Task 4 |
| Hub `~/.agents/skills/` + fan-out symlinks | Task 5 |
| Global and project scope | Tasks 5, 6 |
| Interactive wizard | Task 7 |
| `--format json`, `-y`, `--dry-run`, `--list` | Task 7 |
| `--create-layer` / `--layer` | Task 8 |
| Fixture mattpocock-minimal | Task 2 |
| Documentation | Task 8 |

**Deferred (Phase 2+):** plugin/layer/deck routing, `--update`, security assessments, skills.sh search.

---

## Manual smoke test (post-implementation)

```bash
bun run src/index.ts add mattpocock/skills --list
bun run src/index.ts add mattpocock/skills --skill caveman --global --yes
bun run src/index.ts resource list --type skill --search caveman
bun run src/index.ts layer combine my-skills skill:caveman@mattpocock/skills
ls -la ~/.agents/skills/caveman
ls -la ~/.claude/skills/caveman   # symlink when claude-code in aliases
```
