# Skilldeck Test Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first real automated test suite for `skilldeck`, covering the
core data model, services, serializers, and primary CLI flows.

**Architecture:** Build the suite from the inside out. Start with a reusable
test harness for isolated SQLite databases and temporary project directories,
then add stable unit tests for pure logic and model behavior, then add
serializer and CLI smoke tests over real files. Prefer real temp files and test
databases over mocks where persistence behavior matters.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Node.js filesystem and path
utilities, temporary directories, existing CLI entrypoint in `src/index.ts`

---

### Task 1: Create the shared test harness

**Files:**
- Create: `test/helpers/db.ts`
- Create: `test/helpers/fs.ts`
- Create: `test/helpers/cli.ts`
- Create: `test/helpers/resources.ts`
- Test: `test/helpers/db.test.ts`

**Step 1: Write the failing test**

Create `test/helpers/db.test.ts` with a test that:
- creates an isolated temporary database path
- initializes the schema
- proves a second test run gets a fresh database state

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- test/helpers/db.test.ts`
Expected: FAIL because the helper files do not exist yet.

**Step 3: Write minimal implementation**

Create helper utilities that:
- create temporary working directories under the OS temp folder
- set or reset any process state needed for `getDb()` isolation
- initialize schema through `initializeSchema()`
- expose cleanup helpers for temp files

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- test/helpers/db.test.ts`
Expected: PASS with one green test.

**Step 5: Commit**

```bash
git add test/helpers/db.ts test/helpers/fs.ts test/helpers/cli.ts test/helpers/resources.ts test/helpers/db.test.ts
git commit -m "test: add shared skilldeck test harness"
```

### Task 2: Cover schema and model behavior

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/models/resource.ts`
- Modify: `src/models/preset.ts`
- Modify: `src/models/project.ts`
- Modify: `src/models/snapshot.ts`
- Test: `test/db/schema.test.ts`
- Test: `test/models/resource.test.ts`
- Test: `test/models/preset.test.ts`
- Test: `test/models/project.test.ts`
- Test: `test/models/snapshot.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- idempotent schema initialization
- resource CRUD, metadata round-trip, filter behavior
- preset CRUD, template filtering, resource ordering
- project upsert and preset application
- snapshot state round-trip and ordering

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- test/db/schema.test.ts test/models/resource.test.ts test/models/preset.test.ts test/models/project.test.ts test/models/snapshot.test.ts`
Expected: FAIL because the tests expose missing harness pieces or behavior gaps.

**Step 3: Write minimal implementation**

Adjust only what the tests require. Favor helper extraction for repetitive setup
in the tests over production refactors unless a test reveals a real bug.

**Step 4: Run tests to verify they pass**

Run: `npm run test:run -- test/db/schema.test.ts test/models/resource.test.ts test/models/preset.test.ts test/models/project.test.ts test/models/snapshot.test.ts`
Expected: PASS for all database and model suites.

**Step 5: Commit**

```bash
git add src/db/schema.ts src/models/resource.ts src/models/preset.ts src/models/project.ts src/models/snapshot.ts test/db/schema.test.ts test/models/resource.test.ts test/models/preset.test.ts test/models/project.test.ts test/models/snapshot.test.ts
git commit -m "test: cover schema and model behavior"
```

### Task 3: Cover pure utilities and registry behavior

**Files:**
- Modify: `src/services/git.ts`
- Modify: `src/platforms/registry.ts`
- Test: `test/services/git.test.ts`
- Test: `test/platforms/registry.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- git URL normalization across SSH and HTTPS inputs
- project name extraction from supported URL shapes
- registry lookup, platform list completeness, and representative feature/path
  invariants for Claude Code, Cursor, Codex, and one generic platform

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- test/services/git.test.ts test/platforms/registry.test.ts`
Expected: FAIL where behavior is underspecified or not yet stable.

**Step 3: Write minimal implementation**

Fix only the behavior required to make the tests pass. Do not expand the public
API unless the tests force it.

**Step 4: Run tests to verify they pass**

Run: `npm run test:run -- test/services/git.test.ts test/platforms/registry.test.ts`
Expected: PASS for both suites.

**Step 5: Commit**

```bash
git add src/services/git.ts src/platforms/registry.ts test/services/git.test.ts test/platforms/registry.test.ts
git commit -m "test: cover git helpers and platform registry"
```

### Task 4: Cover scanner, applier, and exporter services

**Files:**
- Modify: `src/services/scanner.ts`
- Modify: `src/services/applier.ts`
- Modify: `src/services/exporter.ts`
- Test: `test/services/scanner.test.ts`
- Test: `test/services/applier.test.ts`
- Test: `test/services/exporter.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- scan deduplication across platforms by `type:name`
- platform filtering in `scanProject()`
- generated file aggregation in `generateFiles()`
- recursive writes in `writeFiles()`
- bundle export shape and import round-trip behavior

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- test/services/scanner.test.ts test/services/applier.test.ts test/services/exporter.test.ts`
Expected: FAIL due to missing helpers, brittle seams, or uncovered bugs.

**Step 3: Write minimal implementation**

Make the smallest production changes needed to support stable testing. Prefer
temp directories and real files over heavy mocking. If a seam is untestable,
extract a tiny helper rather than rewriting the service.

**Step 4: Run tests to verify they pass**

Run: `npm run test:run -- test/services/scanner.test.ts test/services/applier.test.ts test/services/exporter.test.ts`
Expected: PASS for all service suites.

**Step 5: Commit**

```bash
git add src/services/scanner.ts src/services/applier.ts src/services/exporter.ts test/services/scanner.test.ts test/services/applier.test.ts test/services/exporter.test.ts
git commit -m "test: cover scan apply and export services"
```

### Task 5: Cover serializer behavior with fixtures

**Files:**
- Modify: `src/platforms/base-serializer.ts`
- Modify: `src/platforms/claude-code.ts`
- Modify: `src/platforms/cursor.ts`
- Modify: `src/platforms/codex.ts`
- Modify: `src/platforms/generic-agents.ts`
- Create: `test/fixtures/claude-project/`
- Create: `test/fixtures/cursor-project/`
- Create: `test/fixtures/codex-project/`
- Create: `test/fixtures/generic-project/`
- Test: `test/platforms/base-serializer.test.ts`
- Test: `test/platforms/claude-code.test.ts`
- Test: `test/platforms/cursor.test.ts`
- Test: `test/platforms/codex.test.ts`
- Test: `test/platforms/generic-agents.test.ts`

**Step 1: Write the failing tests**

Add fixture-driven tests for:
- frontmatter round-trip helpers
- scan behavior for representative files
- serialize output paths and content for representative resource sets
- omission of unsupported features where expected

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- test/platforms/base-serializer.test.ts test/platforms/claude-code.test.ts test/platforms/cursor.test.ts test/platforms/codex.test.ts test/platforms/generic-agents.test.ts`
Expected: FAIL for missing fixtures or serializer edge cases.

**Step 3: Write minimal implementation**

Add only the production fixes needed for deterministic serializer behavior.
Keep fixtures tiny and focused on one behavior each.

**Step 4: Run tests to verify they pass**

Run: `npm run test:run -- test/platforms/base-serializer.test.ts test/platforms/claude-code.test.ts test/platforms/cursor.test.ts test/platforms/codex.test.ts test/platforms/generic-agents.test.ts`
Expected: PASS across all serializer suites.

**Step 5: Commit**

```bash
git add src/platforms/base-serializer.ts src/platforms/claude-code.ts src/platforms/cursor.ts src/platforms/codex.ts src/platforms/generic-agents.ts test/fixtures test/platforms/base-serializer.test.ts test/platforms/claude-code.test.ts test/platforms/cursor.test.ts test/platforms/codex.test.ts test/platforms/generic-agents.test.ts
git commit -m "test: cover platform serializers"
```

### Task 6: Add CLI smoke tests for primary flows

**Files:**
- Modify: `src/index.ts`
- Test: `test/cli/init.test.ts`
- Test: `test/cli/scan.test.ts`
- Test: `test/cli/preset.test.ts`
- Test: `test/cli/resource.test.ts`
- Test: `test/cli/apply.test.ts`
- Test: `test/cli/history-revert.test.ts`
- Test: `test/cli/export-import.test.ts`
- Test: `test/cli/platforms-status-template.test.ts`

**Step 1: Write the failing tests**

Add smoke tests that execute the CLI against temp projects and assert:
- `init` creates schema state
- `scan` imports resources and project metadata
- `preset` and `resource` commands operate on persisted data
- `apply --dry-run` reports files and `apply` writes files plus snapshots
- `history` and `revert` work from stored snapshots
- `export` and `import` round-trip a bundle
- `platforms`, `status`, and `template` report expected output

**Step 2: Run tests to verify they fail**

Run: `npm run test:run -- test/cli/init.test.ts test/cli/scan.test.ts test/cli/preset.test.ts test/cli/resource.test.ts test/cli/apply.test.ts test/cli/history-revert.test.ts test/cli/export-import.test.ts test/cli/platforms-status-template.test.ts`
Expected: FAIL because the CLI currently has no test harness and may need small
testability fixes.

**Step 3: Write minimal implementation**

Keep production changes surgical. Only extract helpers or stabilize behavior
when a smoke test exposes a real issue or an untestable hard dependency.

**Step 4: Run tests to verify they pass**

Run: `npm run test:run -- test/cli/init.test.ts test/cli/scan.test.ts test/cli/preset.test.ts test/cli/resource.test.ts test/cli/apply.test.ts test/cli/history-revert.test.ts test/cli/export-import.test.ts test/cli/platforms-status-template.test.ts`
Expected: PASS for the primary CLI workflows.

**Step 5: Commit**

```bash
git add src/index.ts test/cli/init.test.ts test/cli/scan.test.ts test/cli/preset.test.ts test/cli/resource.test.ts test/cli/apply.test.ts test/cli/history-revert.test.ts test/cli/export-import.test.ts test/cli/platforms-status-template.test.ts
git commit -m "test: add cli smoke coverage"
```

### Task 7: Run the full suite and clean up

**Files:**
- Modify: `package.json`
- Test: `test/**/*.test.ts`

**Step 1: Write the failing test**

If needed, add one final regression test for any bug uncovered while running the
full suite.

**Step 2: Run test to verify it fails**

Run: `npm run test:run`
Expected: FAIL only if the full suite exposes an uncovered issue.

**Step 3: Write minimal implementation**

Fix only the remaining failures. If no extra bug is found, skip this step.

**Step 4: Run test to verify it passes**

Run: `npm run test:run && npm run lint`
Expected: PASS for the full suite and TypeScript check.

**Step 5: Commit**

```bash
git add package.json src test
git commit -m "test: finalize initial skilldeck coverage"
```
