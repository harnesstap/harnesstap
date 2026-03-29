# Merge, negative serializer coverage, and CI implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

**Goal:** Land the validated test-coverage branch on `main`, add negative
serializer coverage, and add GitHub Actions CI with the repository's existing
commands.

**Architecture:** Keep all remaining work on the existing
`test-coverage` worktree until it is fully verified, then commit it as one
reviewable branch unit and move `main` forward to that commit if it is safe to
do so. Extend the serializer test suite around malformed and unsupported input
first, make only the minimal production changes required by those tests, and
then add a small CI workflow that mirrors local verification.

**Tech Stack:** TypeScript, Vitest, Commander, GitHub Actions, npm, tsup

---

### Task 1: Capture the branch state in documentation

This task records the intended integration sequence before touching the branch
contents again. It makes the next steps explicit for anyone who picks up the
worktree cold.

**Files:**
- Create:
  `docs/plans/2026-03-29-merge-negative-ci-design.md`
- Create:
  `docs/plans/2026-03-29-merge-negative-ci-plan.md`

**Step 1: Re-read the design doc**

Read `docs/plans/2026-03-29-merge-negative-ci-design.md`.

Expected: The doc states the merge order, negative test scope, and CI shape.

**Step 2: Re-read this plan**

Read `docs/plans/2026-03-29-merge-negative-ci-plan.md`.

Expected: The plan names the exact code, test, and workflow files.

**Step 3: Commit the docs if they are the only pending changes**

Run:

```bash
git add docs/plans/2026-03-29-merge-negative-ci-design.md \
  docs/plans/2026-03-29-merge-negative-ci-plan.md
git commit -m "docs: plan merge, serializer negatives, and ci"
```

Expected: Git creates a documentation commit, unless later code changes make a
single combined commit more practical.

### Task 2: Add failing negative serializer tests

This task expands coverage around invalid inputs and unsupported output shapes.
Write the tests first and keep them narrow, so each failure points at one
behavior.

**Files:**
- Modify: `test/platforms/cursor.test.ts`
- Modify: `test/platforms/codex.test.ts`
- Modify: `test/platforms/generic-agents.test.ts`
- Modify: `test/platforms/claude-code.test.ts`
- Test: `test/platforms/cursor.test.ts`
- Test: `test/platforms/codex.test.ts`
- Test: `test/platforms/generic-agents.test.ts`
- Test: `test/platforms/claude-code.test.ts`

**Step 1: Write one failing malformed-file test for Cursor**

Add a case that seeds an invalid JSON file in the Cursor fixture or a temp
project and then calls the Cursor serializer scan path.

Expected failure: The current behavior either throws an unhandled parse error
or does not document the fallback path clearly.

**Step 2: Run the single Cursor test**

Run:

```bash
npm run test:run -- test/platforms/cursor.test.ts
```

Expected: FAIL in the new malformed-file case.

**Step 3: Write one failing malformed-file test for Codex**

Add a case that seeds invalid structured content in the Codex-owned settings
file and then scans it through `CodexSerializer`.

Expected failure: The serializer does not yet match the intended failure or
fallback contract.

**Step 4: Run the single Codex test**

Run:

```bash
npm run test:run -- test/platforms/codex.test.ts
```

Expected: FAIL in the new malformed-file case.

**Step 5: Write one failing unsupported-feature omission test**

Add a case in `test/platforms/generic-agents.test.ts` or
`test/platforms/claude-code.test.ts` that serializes a resource shape the
target platform cannot represent and asserts the serializer omits or degrades it
according to the platform contract.

Expected failure: The serializer currently emits more than the contract allows,
or the omission behavior is not asserted yet.

**Step 6: Run the targeted platform tests**

Run:

```bash
npm run test:run -- test/platforms/generic-agents.test.ts \
  test/platforms/claude-code.test.ts
```

Expected: FAIL in the new unsupported-feature cases.

### Task 3: Make the minimal serializer changes

This task fixes only what the new tests prove is missing. Keep the behavior
local to the serializer layer and avoid broad scanner changes unless the tests
show they are required.

**Files:**
- Modify: `src/platforms/cursor.ts`
- Modify: `src/platforms/codex.ts`
- Modify: `src/platforms/generic-agents.ts`
- Modify: `src/platforms/claude-code.ts`
- Test: `test/platforms/cursor.test.ts`
- Test: `test/platforms/codex.test.ts`
- Test: `test/platforms/generic-agents.test.ts`
- Test: `test/platforms/claude-code.test.ts`

**Step 1: Fix the Cursor malformed-input behavior**

Update `src/platforms/cursor.ts` so invalid platform-owned file content produces
the intended outcome from the test. Prefer explicit failure or explicit ignore
logic over silent partial parsing.

**Step 2: Run the Cursor platform test**

Run:

```bash
npm run test:run -- test/platforms/cursor.test.ts
```

Expected: PASS.

**Step 3: Fix the Codex malformed-input behavior**

Update `src/platforms/codex.ts` to match the test contract for malformed
platform files.

**Step 4: Run the Codex platform test**

Run:

```bash
npm run test:run -- test/platforms/codex.test.ts
```

Expected: PASS.

**Step 5: Fix unsupported-feature serialization only where needed**

Update `src/platforms/generic-agents.ts` and `src/platforms/claude-code.ts`
only if the new tests prove the serializers emit unsupported content instead of
omitting or degrading it correctly.

**Step 6: Run the remaining targeted platform tests**

Run:

```bash
npm run test:run -- test/platforms/generic-agents.test.ts \
  test/platforms/claude-code.test.ts
```

Expected: PASS.

**Step 7: Commit the serializer work**

Run:

```bash
git add src/platforms/cursor.ts src/platforms/codex.ts \
  src/platforms/generic-agents.ts src/platforms/claude-code.ts \
  test/platforms/cursor.test.ts test/platforms/codex.test.ts \
  test/platforms/generic-agents.test.ts test/platforms/claude-code.test.ts
git commit -m "test: cover negative serializer behavior"
```

Expected: Git creates a focused serializer coverage commit, unless the final
branch uses one combined commit instead.

### Task 4: Add GitHub Actions CI

This task adds a single workflow that mirrors the repository's normal local
checks. Keep it minimal.

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: `package.json`

**Step 1: Write the workflow file**

Create `.github/workflows/ci.yml` with a job that checks out the repository,
installs Node 20, runs `npm ci`, then runs `npm run test:run`, `npm run lint`,
and `npm run build`.

**Step 2: Self-review the workflow**

Read `.github/workflows/ci.yml`.

Expected: It only uses commands that already exist in `package.json`.

**Step 3: Commit the workflow**

Run:

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add github actions validation"
```

Expected: Git creates a CI workflow commit, unless the final branch uses one
combined commit instead.

### Task 5: Verify the worktree end to end

This task proves that the branch is ready to land. Run the repo commands before
touching `main`.

**Files:**
- Test: `package.json`
- Test: `test/platforms/cursor.test.ts`
- Test: `test/platforms/codex.test.ts`
- Test: `test/platforms/generic-agents.test.ts`
- Test: `test/platforms/claude-code.test.ts`

**Step 1: Run the full test suite**

Run:

```bash
npm run test:run
```

Expected: PASS.

**Step 2: Run the type-check**

Run:

```bash
npm run lint
```

Expected: PASS.

**Step 3: Run the build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 4: Inspect git state**

Run:

```bash
git --no-pager status --short
git --no-pager log --oneline -5
```

Expected: Only the intended work is present, and the branch is ready to land.

### Task 6: Land the branch on `main`

This task moves the validated work onto `main` without forcing destructive
working-tree cleanup.

**Files:**
- Modify: `src/index.ts`
- Modify: `src/services/templates.ts`
- Modify: `src/platforms/cursor.ts`
- Modify: `src/platforms/codex.ts`
- Modify: `src/platforms/generic-agents.ts`
- Modify: `src/platforms/claude-code.ts`
- Modify: `test/**/*.ts`
- Create: `.github/workflows/ci.yml`
- Create: `docs/plans/2026-03-29-merge-negative-ci-design.md`
- Create: `docs/plans/2026-03-29-merge-negative-ci-plan.md`

**Step 1: Commit any remaining branch work**

Run:

```bash
git add src test .github/workflows/ci.yml docs/plans
git commit -m "feat: expand serializer coverage and add ci"
```

Expected: The worktree branch is fully committed.

**Step 2: Check whether `main` can move forward cleanly**

Run from the repository root:

```bash
git -C /Users/christophe.oudar/dev/opensource/skillset --no-pager status --short
git -C /Users/christophe.oudar/dev/opensource/skillset --no-pager diff --stat
```

Expected: You can see whether untracked local files would block a merge.

**Step 3: Fast-forward or cherry-pick safely**

If `main` is clean enough, run:

```bash
git -C /Users/christophe.oudar/dev/opensource/skillset merge --ff-only \
  test-coverage
```

If that fails only because of local checkout state, preserve the committed
branch and use the least-destructive safe landing path available, such as a
cherry-pick in a clean checkout.

**Step 4: Re-run verification on `main` if the landing succeeded**

Run:

```bash
cd /Users/christophe.oudar/dev/opensource/skillset
npm run test:run
npm run lint
npm run build
```

Expected: PASS on `main`.
