# Skilldeck Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hard-rename the project to `skilldeck` across package metadata, CLI behavior, storage paths, bundle schema, tests, and docs.

**Architecture:** Start with failing regression tests that lock the new public name and persisted path expectations. Then update the runtime constants and user-facing strings, followed by the remaining docs and fixtures that still reference the old name. Finish with full project validation so the renamed package is publishable as `skilldeck`.

**Tech Stack:** TypeScript, Bun, Commander, Vitest, Biome, tsup, SQLite

---

### Task 1: Lock the new public name in tests

**Files:**
- Modify: `test/cli/init.test.ts`
- Modify: `test/services/exporter.test.ts`
- Modify: `test/helpers/cli.ts`
- Test: `test/cli/init.test.ts`
- Test: `test/services/exporter.test.ts`

**Step 1: Write the failing test**

Update the CLI init assertions to expect `Skilldeck initialized` and a database path under `~/.skilldeck/skilldeck.db`. Update the exporter schema assertion to expect the bundle schema identifier. Update the CLI helper argv name to `skilldeck`.

**Step 2: Run test to verify it fails**

Run: `bun run vitest run test/cli/init.test.ts test/services/exporter.test.ts`
Expected: FAIL because runtime output and schema still use the previous project name.

**Step 3: Write minimal implementation**

Update the runtime naming constants and storage path helpers so those tests pass.

**Step 4: Run test to verify it passes**

Run: `bun run vitest run test/cli/init.test.ts test/services/exporter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add test/cli/init.test.ts test/services/exporter.test.ts test/helpers/cli.ts src/index.ts src/db/connection.ts src/services/exporter.ts
git commit -m "refactor: rename runtime surfaces to skilldeck"
```

### Task 2: Rename package metadata and CLI defaults

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/index.ts`
- Modify: `src/services/exporter.ts`
- Modify: `templates/nextjs-fullstack.json`
- Modify: `templates/python-fastapi.json`
- Test: `test/cli/export-import.test.ts`

**Step 1: Write the failing test**

Update export/import tests and expectations so default bundle naming and schema references use `skilldeck`.

**Step 2: Run test to verify it fails**

Run: `bun run vitest run test/cli/export-import.test.ts`
Expected: FAIL because package defaults still emit the previous project name.

**Step 3: Write minimal implementation**

Rename the npm package, bin entry, CLI program name, init/help text, schema URL, and default exported bundle suffix to `skilldeck`.

**Step 4: Run test to verify it passes**

Run: `bun run vitest run test/cli/export-import.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json bun.lock src/index.ts src/services/exporter.ts templates/nextjs-fullstack.json templates/python-fastapi.json test/cli/export-import.test.ts
git commit -m "refactor: rename package metadata to skilldeck"
```

### Task 3: Sweep docs, specs, and fixtures

**Files:**
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `CONTRIBUTING.md`
- Modify: `test/**/*.ts`

**Step 1: Write the failing test**

Update remaining tests and fixtures that still use the previous project name, temp prefixes, repo fixtures, and CLI usage so they target `skilldeck`.

**Step 2: Run test to verify it fails**

Run: `bun run vitest run`
Expected: FAIL anywhere old naming still appears in assertions or helper data.

**Step 3: Write minimal implementation**

Replace remaining user-facing references with `skilldeck`, while leaving literal repository filesystem paths alone where they describe the current checkout location.

**Step 4: Run test to verify it passes**

Run: `bun run vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add README.md SPEC.md CONTRIBUTING.md test
git commit -m "docs: rename project references to skilldeck"
```

### Task 4: Final validation

**Files:**
- Modify: none expected

**Step 1: Run validation**

Run: `bun run lint && bun run typecheck && bun run test:run && bun run build`
Expected: PASS

**Step 2: Commit**

```bash
git add -A
git commit -m "refactor: hard rename to skilldeck"
```
