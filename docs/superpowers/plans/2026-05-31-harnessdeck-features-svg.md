# HarnessDeck Features SVG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a stunning SVG visual that communicates HarnessDeck's main features and supported harness workflow.

**Architecture:** Add a standalone documentation asset under `docs/assets/` and a focused Bun test that verifies the asset exists, is SVG-shaped, includes accessible metadata, and names the approved feature set. The SVG remains static so it can render in GitHub Markdown, browsers, and documentation pages without runtime dependencies.

**Tech Stack:** SVG 1.1-compatible markup, Bun test runner, Node `fs/promises`.

---

### Task 1: SVG Asset Validation

**Files:**
- Create: `test/docs/harnessdeck-features-svg.test.ts`
- Create: `docs/assets/harnessdeck-features.svg`

- [x] **Step 1: Write the failing test**

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

describe("HarnessDeck features SVG", () => {
  test("documents the approved HarnessDeck feature map", async () => {
    const svg = await readFile("docs/assets/harnessdeck-features.svg", "utf8");

    expect(svg).toStartWith("<svg ");
    expect(svg).toContain("<title>HarnessDeck feature map</title>");
    expect(svg).toContain("<desc>");

    const requiredLabels = [
      "HarnessDeck",
      "Claude Code",
      "Cursor",
      "Codex",
      "GitHub Copilot",
      "Scan",
      "SQLite library",
      "Reusable presets",
      "Apply & sync",
      "Snapshots",
      "Drift detection",
      "Plugin governance",
      "Cloud sharing",
      "Migration export",
    ];

    for (const label of requiredLabels) {
      expect(svg).toContain(label);
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test test/docs/harnessdeck-features-svg.test.ts`
Expected: FAIL with `ENOENT` because `docs/assets/harnessdeck-features.svg` does not exist yet.

- [x] **Step 3: Create the SVG asset**

Create `docs/assets/harnessdeck-features.svg` as a self-contained 1600x1000 SVG. Use a dark radial-gradient background, central HarnessDeck hub, connected harness nodes, and labeled feature cards for scan, SQLite library, presets, apply/sync, snapshots, drift detection, plugin governance, cloud sharing, and migration export.

- [x] **Step 4: Run focused test to verify it passes**

Run: `bun test test/docs/harnessdeck-features-svg.test.ts`
Expected: PASS.

- [x] **Step 5: Run repository verification**

Run: `bun run lint && bun run typecheck && bun test test/docs/harnessdeck-features-svg.test.ts && bun run build`
Expected: all commands pass.
