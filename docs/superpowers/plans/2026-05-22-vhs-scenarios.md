# VHS Scenario Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a checked-in VHS demo pack for the highest-value HarnessDeck scenarios, render the GIF outputs, link them from the scenario docs, and ship the work in a pull request.

**Architecture:** Keep the scenario selection in a single checked-in manifest, drive rendering through one repo script, and store both the `.tape` files and rendered `.gif` assets under `docs/scenarios/vhs/`. Use repo-local demo fixtures plus per-scenario shell setup so the recordings run against isolated `HOME` and `HARNESSDECK_HOME` directories instead of the contributor's real machine.

**Tech Stack:** TypeScript + Vitest for manifest/docs validation, Bash for rendering orchestration, Bun for build/test commands, VHS for terminal recordings, GitHub CLI for PR creation

---

## File Structure

| File | Responsibility |
|------|----------------|
| `docs/scenarios/vhs/scenarios.json` | Single source of truth for covered scenario IDs, slugs, docs, tapes, outputs, and optional fixture roots |
| `scripts/generate-vhs-scenarios.sh` | Lists scenarios, builds the CLI, prepares isolated temp workspaces, and renders one/all tapes |
| `docs/scenarios/vhs/README.md` | User-facing instructions for prerequisites, regeneration, and covered demos |
| `docs/scenarios/vhs/tapes/_shared.tape` | Shared VHS settings (shell, terminal size, pacing) |
| `docs/scenarios/vhs/tapes/*.tape` | One tape per covered scenario |
| `docs/scenarios/vhs/fixtures/**` | Small fixture inputs copied into temp repos/homes before recording |
| `docs/scenarios/vhs/output/*.gif` | Generated GIF artifacts committed to the repo |
| `test/services/vhs-scenarios.test.ts` | Validates the scenario manifest, render script `--list` output, tape/fixture presence, and docs links |
| `package.json` | Adds a Bun script for regeneration (`docs:vhs`) |
| `docs/scenarios/scenarios.md` | Links the demo pack from the main scenarios index |
| `docs/scenarios/details/{01,04,07,11,21,27}-*.md` | Links each covered scenario to its tape and GIF |

---

### Task 1: Add the curated scenario manifest and validate its shape

**Files:**
- Create: `docs/scenarios/vhs/scenarios.json`
- Create: `test/services/vhs-scenarios.test.ts`

- [ ] **Step 1: Write the failing manifest test**

```ts
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface VhsScenarioDefinition {
  id: number;
  slug: string;
  title: string;
  detailPath: string;
  tapePath: string;
  outputPath: string;
  fixturePath?: string;
}

const repoRoot = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(repoRoot, "docs/scenarios/vhs/scenarios.json");
const expectedIds = [1, 4, 7, 11, 21, 27];

describe("VHS scenario manifest", () => {
  it("declares the curated scenarios with repo-relative paths", () => {
    expect(existsSync(manifestPath)).toBe(true);

    const definitions = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as VhsScenarioDefinition[];

    expect(definitions.map((definition) => definition.id)).toEqual(expectedIds);

    for (const definition of definitions) {
      expect(definition.detailPath.startsWith("docs/scenarios/details/")).toBe(
        true,
      );
      expect(definition.tapePath.startsWith("docs/scenarios/vhs/tapes/")).toBe(
        true,
      );
      expect(definition.outputPath.startsWith("docs/scenarios/vhs/output/")).toBe(
        true,
      );
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test:run test/services/vhs-scenarios.test.ts`

Expected: FAIL with `expected false to be true` or `ENOENT` because `docs/scenarios/vhs/scenarios.json` does not exist yet.

- [ ] **Step 3: Create the manifest**

```json
[
  {
    "id": 1,
    "slug": "bootstrap-machine",
    "title": "Bootstrap HarnessDeck on a machine",
    "detailPath": "docs/scenarios/details/01-bootstrap-machine.md",
    "tapePath": "docs/scenarios/vhs/tapes/01-bootstrap-machine.tape",
    "outputPath": "docs/scenarios/vhs/output/01-bootstrap-machine.gif"
  },
  {
    "id": 4,
    "slug": "scan-import-repo",
    "title": "Scan an existing repository",
    "detailPath": "docs/scenarios/details/04-scan-import-repo.md",
    "tapePath": "docs/scenarios/vhs/tapes/04-scan-import-repo.tape",
    "outputPath": "docs/scenarios/vhs/output/04-scan-import-repo.gif",
    "fixturePath": "docs/scenarios/vhs/fixtures/scan-project"
  },
  {
    "id": 7,
    "slug": "preview-apply-preset",
    "title": "Preview and apply a preset",
    "detailPath": "docs/scenarios/details/07-preview-apply-preset.md",
    "tapePath": "docs/scenarios/vhs/tapes/07-preview-apply-preset.tape",
    "outputPath": "docs/scenarios/vhs/output/07-preview-apply-preset.gif"
  },
  {
    "id": 11,
    "slug": "builtin-preset",
    "title": "Start from a built-in preset",
    "detailPath": "docs/scenarios/details/11-builtin-preset.md",
    "tapePath": "docs/scenarios/vhs/tapes/11-builtin-preset.tape",
    "outputPath": "docs/scenarios/vhs/output/11-builtin-preset.gif"
  },
  {
    "id": 21,
    "slug": "detect-drift",
    "title": "Detect project drift",
    "detailPath": "docs/scenarios/details/21-detect-drift.md",
    "tapePath": "docs/scenarios/vhs/tapes/21-detect-drift.tape",
    "outputPath": "docs/scenarios/vhs/output/21-detect-drift.gif",
    "fixturePath": "docs/scenarios/vhs/fixtures/drift-project"
  },
  {
    "id": 27,
    "slug": "project-sync",
    "title": "Sync alias harness outputs from the on-disk main harness",
    "detailPath": "docs/scenarios/details/27-project-sync.md",
    "tapePath": "docs/scenarios/vhs/tapes/27-project-sync.tape",
    "outputPath": "docs/scenarios/vhs/output/27-project-sync.gif",
    "fixturePath": "docs/scenarios/vhs/fixtures/sync-project"
  }
]
```

- [ ] **Step 4: Re-run the manifest test**

Run: `bun run test:run test/services/vhs-scenarios.test.ts`

Expected: PASS for the manifest-shape test.

- [ ] **Step 5: Commit**

```bash
git add docs/scenarios/vhs/scenarios.json test/services/vhs-scenarios.test.ts
git commit -m "test: add VHS scenario manifest coverage" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Add the render script and Bun entry point

**Files:**
- Create: `scripts/generate-vhs-scenarios.sh`
- Modify: `package.json`
- Test: `test/services/vhs-scenarios.test.ts`

- [ ] **Step 1: Extend the test with a failing `--list` assertion**

```ts
import { spawnSync } from "node:child_process";

it("lists the curated scenarios without requiring VHS", () => {
  const result = spawnSync("bash", ["scripts/generate-vhs-scenarios.sh", "--list"], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("01-bootstrap-machine");
  expect(result.stdout).toContain("27-project-sync");
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `bun run test:run test/services/vhs-scenarios.test.ts`

Expected: FAIL because `scripts/generate-vhs-scenarios.sh` does not exist yet.

- [ ] **Step 3: Implement the render script**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/docs/scenarios/vhs/scenarios.json"
MODE="render"
SCENARIO=""
NO_BUILD=0

while (($#)); do
  case "$1" in
    --list)
      MODE="list"
      shift
      ;;
    --scenario)
      SCENARIO="${2:?missing scenario value}"
      shift 2
      ;;
    --no-build)
      NO_BUILD=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

readarray -t SCENARIOS < <(node - <<'NODE' "$MANIFEST" "$SCENARIO"
const fs = require("node:fs");
const [manifestPath, selected] = process.argv.slice(2);
const definitions = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
for (const definition of definitions) {
  const key = `${String(definition.id).padStart(2, "0")}-${definition.slug}`;
  if (!selected || selected === key || selected === definition.slug || selected === String(definition.id)) {
    console.log([
      key,
      definition.tapePath,
      definition.outputPath,
      definition.fixturePath ?? "",
    ].join("\t"));
  }
}
NODE
)

if [[ "$MODE" == "list" ]]; then
  printf '%s\n' "${SCENARIOS[@]}"
  exit 0
fi

command -v bun >/dev/null || { echo "bun is required" >&2; exit 1; }
command -v vhs >/dev/null || { echo "vhs is required" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
command -v ttyd >/dev/null || { echo "ttyd is required" >&2; exit 1; }

if [[ "$NO_BUILD" -eq 0 ]]; then
  bun run build >/dev/null
fi

prepare_git_repo() {
  local dir="$1"
  git -C "$dir" init -q
  git -C "$dir" config user.email "demo@example.com"
  git -C "$dir" config user.name "HarnessDeck Demo"
  git -C "$dir" remote add origin "git@github.com:acme/harnessdeck-demo.git"
  git -C "$dir" add -A
  git -C "$dir" commit --allow-empty -q -m "init"
}

cd "$ROOT"

for row in "${SCENARIOS[@]}"; do
  IFS=$'\t' read -r key tape output fixture <<<"$row"
  work_root="$(mktemp -d "${TMPDIR:-/tmp}/harnessdeck-vhs-${key}-XXXX")"
  home_dir="$work_root/home"
  hd_dir="$work_root/harnessdeck-home"
  project_dir="$work_root/project"
  mkdir -p "$home_dir" "$hd_dir" "$project_dir"

  if [[ -n "$fixture" ]]; then
    cp -R "$ROOT/$fixture/." "$project_dir/"
  fi

  prepare_git_repo "$project_dir"

  HOME="$home_dir" \
  HARNESSDECK_HOME="$hd_dir" \
  HD_REPO_ROOT="$ROOT" \
  HD_PROJECT_ROOT="$project_dir" \
  HD_SCENARIO_KEY="$key" \
  vhs "$ROOT/$tape"

  rm -rf "$work_root"
done
```

- [ ] **Step 4: Add the Bun wrapper script**

```json
{
  "scripts": {
    "docs:vhs": "bash scripts/generate-vhs-scenarios.sh"
  }
}
```

Merge that into the existing `scripts` object in `package.json`; do not remove any current entries.

- [ ] **Step 5: Re-run the targeted test**

Run: `bun run test:run test/services/vhs-scenarios.test.ts`

Expected: PASS for the manifest test and the `--list` test.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-vhs-scenarios.sh package.json test/services/vhs-scenarios.test.ts
git commit -m "feat: add VHS render script" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Add shared tape settings, fixtures, and one tape per scenario

**Files:**
- Create: `docs/scenarios/vhs/tapes/_shared.tape`
- Create: `docs/scenarios/vhs/tapes/01-bootstrap-machine.tape`
- Create: `docs/scenarios/vhs/tapes/04-scan-import-repo.tape`
- Create: `docs/scenarios/vhs/tapes/07-preview-apply-preset.tape`
- Create: `docs/scenarios/vhs/tapes/11-builtin-preset.tape`
- Create: `docs/scenarios/vhs/tapes/21-detect-drift.tape`
- Create: `docs/scenarios/vhs/tapes/27-project-sync.tape`
- Create: `docs/scenarios/vhs/fixtures/scan-project/CLAUDE.md`
- Create: `docs/scenarios/vhs/fixtures/scan-project/.github/agents/research.md`
- Create: `docs/scenarios/vhs/fixtures/drift-project/CLAUDE.md`
- Create: `docs/scenarios/vhs/fixtures/sync-project/CLAUDE.md`
- Test: `test/services/vhs-scenarios.test.ts`

- [ ] **Step 1: Extend the test with failing tape and fixture assertions**

```ts
it("has checked-in tapes and fixture roots for the curated scenarios", () => {
  const definitions = JSON.parse(
    readFileSync(manifestPath, "utf-8"),
  ) as VhsScenarioDefinition[];

  for (const definition of definitions) {
    expect(existsSync(resolve(repoRoot, definition.tapePath))).toBe(true);

    if (definition.fixturePath) {
      expect(existsSync(resolve(repoRoot, definition.fixturePath))).toBe(true);
    }
  }
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `bun run test:run test/services/vhs-scenarios.test.ts`

Expected: FAIL because the tapes and fixture directories do not exist yet.

- [ ] **Step 3: Create the shared VHS header**

```text
Set Shell "bash"
Set FontSize 24
Set Width 1200
Set Height 720
Set Padding 20
Set TypingSpeed 35ms
Set WindowBar Colorful
```

- [ ] **Step 4: Create the fixture files**

```text
docs/scenarios/vhs/fixtures/scan-project/CLAUDE.md
-----------------------------------------------
# Existing repo instructions

docs/scenarios/vhs/fixtures/scan-project/.github/agents/research.md
-------------------------------------------------------------------
# Research agent

docs/scenarios/vhs/fixtures/drift-project/CLAUDE.md
---------------------------------------------------
# Original

docs/scenarios/vhs/fixtures/sync-project/CLAUDE.md
--------------------------------------------------
# Main harness
```

- [ ] **Step 5: Create the scenario tapes**

```text
# docs/scenarios/vhs/tapes/01-bootstrap-machine.tape
Output docs/scenarios/vhs/output/01-bootstrap-machine.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require node

Hide
Type "export HOME=\"$HOME\" HARNESSDECK_HOME=\"$HARNESSDECK_HOME\""
Enter
Show

Type "cd \"$HD_PROJECT_ROOT\""
Enter
Type "node \"$HD_REPO_ROOT/dist/index.js\" init"
Enter
Sleep 800ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" platform list"
Enter
Sleep 800ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" preset list"
Enter
Sleep 1s
```

```text
# docs/scenarios/vhs/tapes/04-scan-import-repo.tape
Output docs/scenarios/vhs/output/04-scan-import-repo.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require node

Type "cd \"$HD_PROJECT_ROOT\""
Enter
Type "node \"$HD_REPO_ROOT/dist/index.js\" init"
Enter
Sleep 600ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" project scan ."
Enter
Sleep 600ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" resource list"
Enter
Sleep 1s
```

```text
# docs/scenarios/vhs/tapes/07-preview-apply-preset.tape
Output docs/scenarios/vhs/output/07-preview-apply-preset.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require node

Type "cd \"$HD_PROJECT_ROOT\""
Enter
Type "node \"$HD_REPO_ROOT/dist/index.js\" init"
Enter
Sleep 600ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" project apply nextjs-fullstack --project . --platform codex --dry-run"
Enter
Sleep 900ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" project apply nextjs-fullstack --project . --platform codex"
Enter
Sleep 1s
```

```text
# docs/scenarios/vhs/tapes/11-builtin-preset.tape
Output docs/scenarios/vhs/output/11-builtin-preset.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require node

Type "cd \"$HD_PROJECT_ROOT\""
Enter
Type "node \"$HD_REPO_ROOT/dist/index.js\" init"
Enter
Sleep 600ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" preset list"
Enter
Sleep 600ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" project apply nextjs-fullstack --project . --platform codex"
Enter
Sleep 1s
```

```text
# docs/scenarios/vhs/tapes/21-detect-drift.tape
Output docs/scenarios/vhs/output/21-detect-drift.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require node

Type "cd \"$HD_PROJECT_ROOT\""
Enter
Type "printf '# Hand edited\n' > CLAUDE.md"
Enter
Sleep 500ms
Type "node \"$HD_REPO_ROOT/dist/index.js\" project drift --project . --format json"
Enter
Sleep 1s
```

```text
# docs/scenarios/vhs/tapes/27-project-sync.tape
Output docs/scenarios/vhs/output/27-project-sync.gif
Source docs/scenarios/vhs/tapes/_shared.tape
Require node

Type "cd \"$HD_PROJECT_ROOT\""
Enter
Type "node \"$HD_REPO_ROOT/dist/index.js\" project sync . --dry-run"
Enter
Sleep 1s
```

Use hidden pre-commands in `scripts/generate-vhs-scenarios.sh` for scenario-specific setup that should not appear in the GIFs:

- scenario 21: initialize HarnessDeck, create/apply a preset, then leave the project ready for the visible manual edit
- scenario 27: initialize HarnessDeck, set `claude-code` as main with `cursor` alias, create/apply a preset, edit `CLAUDE.md`, and leave the project ready for the visible sync command

- [ ] **Step 6: Re-run the targeted test**

Run: `bun run test:run test/services/vhs-scenarios.test.ts`

Expected: PASS for manifest, `--list`, tape-path, and fixture-path assertions.

- [ ] **Step 7: Commit**

```bash
git add docs/scenarios/vhs/tapes docs/scenarios/vhs/fixtures test/services/vhs-scenarios.test.ts scripts/generate-vhs-scenarios.sh
git commit -m "docs: add VHS tapes and fixtures" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Render the GIFs and link them from the docs

**Files:**
- Create: `docs/scenarios/vhs/README.md`
- Create: `docs/scenarios/vhs/output/01-bootstrap-machine.gif`
- Create: `docs/scenarios/vhs/output/04-scan-import-repo.gif`
- Create: `docs/scenarios/vhs/output/07-preview-apply-preset.gif`
- Create: `docs/scenarios/vhs/output/11-builtin-preset.gif`
- Create: `docs/scenarios/vhs/output/21-detect-drift.gif`
- Create: `docs/scenarios/vhs/output/27-project-sync.gif`
- Modify: `docs/scenarios/scenarios.md`
- Modify: `docs/scenarios/details/01-bootstrap-machine.md`
- Modify: `docs/scenarios/details/04-scan-import-repo.md`
- Modify: `docs/scenarios/details/07-preview-apply-preset.md`
- Modify: `docs/scenarios/details/11-builtin-preset.md`
- Modify: `docs/scenarios/details/21-detect-drift.md`
- Modify: `docs/scenarios/details/27-project-sync.md`
- Test: `test/services/vhs-scenarios.test.ts`

- [ ] **Step 1: Extend the test with failing docs-link assertions**

```ts
it("links the demo GIF and tape from each covered scenario doc", () => {
  const definitions = JSON.parse(
    readFileSync(manifestPath, "utf-8"),
  ) as VhsScenarioDefinition[];

  for (const definition of definitions) {
    const doc = readFileSync(resolve(repoRoot, definition.detailPath), "utf-8");
    expect(doc).toContain(
      definition.outputPath.replace("docs/scenarios/", "../"),
    );
    expect(doc).toContain(
      definition.tapePath.replace("docs/scenarios/", "../"),
    );
  }
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `bun run test:run test/services/vhs-scenarios.test.ts`

Expected: FAIL because the docs do not link to the GIF and tape files yet.

- [ ] **Step 3: Add the demo landing page**

````md
# HarnessDeck VHS demos

These demos are generated from the checked-in tapes in `docs/scenarios/vhs/tapes/`.

## Prerequisites

- `bun`
- `vhs`
- `ffmpeg`
- `ttyd`

## Regenerate

```bash
bun run docs:vhs
bun run docs:vhs -- --scenario 07-preview-apply-preset
```

## Covered scenarios

| Scenario | Demo |
|----------|------|
| 1 | [`01-bootstrap-machine.gif`](./output/01-bootstrap-machine.gif) |
| 4 | [`04-scan-import-repo.gif`](./output/04-scan-import-repo.gif) |
| 7 | [`07-preview-apply-preset.gif`](./output/07-preview-apply-preset.gif) |
| 11 | [`11-builtin-preset.gif`](./output/11-builtin-preset.gif) |
| 21 | [`21-detect-drift.gif`](./output/21-detect-drift.gif) |
| 27 | [`27-project-sync.gif`](./output/27-project-sync.gif) |
````

- [ ] **Step 4: Link the demo pack from the scenarios docs**

Add this sentence near the top of `docs/scenarios/scenarios.md` after the intro corrections:

```md
See the [VHS demo pack](./vhs/README.md) for rendered walkthroughs of the covered workflows.
```

Add these exact blocks to the six covered detail pages immediately after the back-link:

```text
docs/scenarios/details/01-bootstrap-machine.md
----------------------------------------------
## Demo

- [View demo GIF](../vhs/output/01-bootstrap-machine.gif)
- [View tape source](../vhs/tapes/01-bootstrap-machine.tape)

docs/scenarios/details/04-scan-import-repo.md
---------------------------------------------
## Demo

- [View demo GIF](../vhs/output/04-scan-import-repo.gif)
- [View tape source](../vhs/tapes/04-scan-import-repo.tape)

docs/scenarios/details/07-preview-apply-preset.md
-------------------------------------------------
## Demo

- [View demo GIF](../vhs/output/07-preview-apply-preset.gif)
- [View tape source](../vhs/tapes/07-preview-apply-preset.tape)

docs/scenarios/details/11-builtin-preset.md
-------------------------------------------
## Demo

- [View demo GIF](../vhs/output/11-builtin-preset.gif)
- [View tape source](../vhs/tapes/11-builtin-preset.tape)

docs/scenarios/details/21-detect-drift.md
-----------------------------------------
## Demo

- [View demo GIF](../vhs/output/21-detect-drift.gif)
- [View tape source](../vhs/tapes/21-detect-drift.tape)

docs/scenarios/details/27-project-sync.md
-----------------------------------------
## Demo

- [View demo GIF](../vhs/output/27-project-sync.gif)
- [View tape source](../vhs/tapes/27-project-sync.tape)
```

- [ ] **Step 5: Render the GIFs**

Run: `bun run docs:vhs`

Expected: six GIFs are created/updated under `docs/scenarios/vhs/output/`.

- [ ] **Step 6: Re-run the targeted test**

Run: `bun run test:run test/services/vhs-scenarios.test.ts`

Expected: PASS for manifest, script list output, tape/fixture presence, and doc-link assertions.

- [ ] **Step 7: Commit**

```bash
git add docs/scenarios/vhs/README.md docs/scenarios/vhs/output docs/scenarios/scenarios.md docs/scenarios/details/01-bootstrap-machine.md docs/scenarios/details/04-scan-import-repo.md docs/scenarios/details/07-preview-apply-preset.md docs/scenarios/details/11-builtin-preset.md docs/scenarios/details/21-detect-drift.md docs/scenarios/details/27-project-sync.md test/services/vhs-scenarios.test.ts
git commit -m "docs: publish VHS scenario demos" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Final verification and pull request

**Files:**
- Review only: no planned file changes in this task

- [ ] **Step 1: Run the repository checks**

Run: `bun run preflight`

Expected: PASS, with the current known lint warning in `test/services/planned-scenarios.test.ts` still remaining only as a warning unless it becomes an error.

- [ ] **Step 2: Re-render once from a clean state**

Run: `rm -f docs/scenarios/vhs/output/*.gif && bun run docs:vhs`

Expected: all six GIFs are recreated successfully.

- [ ] **Step 3: Review the diff**

Run: `git --no-pager diff --stat`

Expected: manifest, script, tapes, fixtures, docs, tests, and six GIFs are present; no temp files are included.

- [ ] **Step 4: Push the branch**

Run: `git push -u origin feat/vhs-scenarios`

Expected: branch is published successfully.

- [ ] **Step 5: Open the pull request**

Run:

```bash
gh pr create \
  --title "docs: add VHS scenario demos" \
  --body "## Summary
- add a curated VHS demo pack for six high-value HarnessDeck scenarios
- check in the tape sources, fixtures, render script, and generated GIF outputs
- link the demos from the scenario index and covered scenario detail pages

## Testing
- bun run test:run test/services/vhs-scenarios.test.ts
- bun run docs:vhs
- bun run preflight"
```

Expected: a PR URL is printed to stdout.

---

## Self-Review

### Spec coverage

- **Checked-in tapes and GIF outputs** → Tasks 1, 3, and 4
- **Curated Common + key Occasional coverage** → Task 1 manifest pins scenarios `1, 4, 7, 11, 21, 27`
- **Deterministic isolated execution** → Task 2 render script uses temp `HOME`, temp `HARNESSDECK_HOME`, and temp git repos
- **Doc discoverability** → Task 4 landing page + scenario index + six detail-page links
- **No CI dependency on VHS** → Task 5 verifies manually through `bun run docs:vhs`, not through preflight
- **PR delivery** → Task 5 push + `gh pr create`

### Placeholder scan

- No `TODO` / `TBD` markers remain.
- Each file-creating task names exact paths.
- Each code-changing step includes a concrete snippet or command.

### Type consistency

- Manifest fields are consistently `id`, `slug`, `title`, `detailPath`, `tapePath`, `outputPath`, and optional `fixturePath`.
- The script and tests both use the same manifest field names.
