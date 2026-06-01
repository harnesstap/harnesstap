# HarnessDeck Features SVG Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the HarnessDeck feature SVG so it reads as a cleaner product diagram with one consolidated agent harness panel, better-fitting text, and consistent icon/text alignment.

**Architecture:** Keep the asset as a single static SVG under `docs/assets/` and update the existing Bun test to lock in the new semantic grouping. The layout change stays within the current dark neon visual language but restructures the composition into a single harness panel plus a cleaner feature grid with normalized card internals.

**Tech Stack:** SVG 1.1-compatible markup, Bun test runner, Node `fs/promises`.

---

### Task 1: Lock in the consolidated harness panel

**Files:**
- Modify: `test/docs/harnessdeck-features-svg.test.ts`
- Modify: `docs/assets/harnessdeck-features.svg`

- [x] **Step 1: Write the failing test**

```ts
const requiredLabels = [
  "HarnessDeck",
  "Agent harnesses",
  "Claude Code",
  "Cursor",
  "Codex",
  "GitHub Copilot",
  "Other CLIs",
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

const removedLabels = ["Future Harnesses"];
```

Update the test so it requires a single `Agent harnesses` label, keeps the named harness examples, and rejects the old extra harness box label `Future Harnesses`.

- [x] **Step 2: Run test to verify it fails**

Run: `bun test test/docs/harnessdeck-features-svg.test.ts`
Expected: FAIL because the current SVG still contains `Future Harnesses` and does not contain `Agent harnesses`.

- [x] **Step 3: Update the SVG layout**

Replace the six scattered harness example boxes with one top panel titled `Agent harnesses` that contains the example names in compact chips or inline rows. Rebuild the feature area as an even grid with consistent card widths, shared icon/title alignment, and a widened `Migration export` card so its supporting text stays inside the box.

- [x] **Step 4: Run focused test to verify it passes**

Run: `bun test test/docs/harnessdeck-features-svg.test.ts`
Expected: PASS.

- [x] **Step 5: Run repository verification**

Run: `bun run lint && bun run typecheck && bun run test:run && bun run build`
Expected: all commands pass.
