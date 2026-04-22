# Merge, negative serializer coverage, and CI design

This design covers the next integration step for `skilldeck`. You want to land
the already-tested worktree changes on `main`, add serializer tests for
unsupported or invalid inputs, and introduce GitHub Actions CI so the new test
suite runs automatically.

## Goals

This work keeps the recent spec and test investment durable. The immediate goal
is to move the validated test-coverage branch content onto `main` without
rewriting the boundary of the work. After that, we fill the remaining coverage
gap around negative serializer behavior and add CI that runs the existing
project commands.

- Preserve the current worktree changes as a reviewable git unit.
- Land those changes onto `main` before starting new follow-up work.
- Add serializer tests for malformed files and unsupported feature shapes.
- Add GitHub Actions CI that runs the existing validation commands.

## Approach options

There are two practical ways to land the current worktree changes.

### Option 1: Commit on the worktree branch, then fast-forward `main`

This option preserves the existing branch boundary. We commit the tested
changes on `test-coverage`, then move `main` forward to that commit. This is
the safest path when the branch already contains the exact behavior we want to
keep.

### Option 2: Re-apply the diff directly on `main`

This option copies the same content onto `main` and creates a fresh commit
there. It is simpler when branch history does not matter, but it throws away
the already-isolated worktree boundary.

We will use **Option 1**. It preserves history, matches the validated worktree
state, and makes the merge step explicit.

## Merge strategy

The merge step must avoid surprising unrelated local files. The original `main`
checkout already has untracked local content, so the safest operational path is
to complete the work on the `test-coverage` branch, commit it there, and only
then advance `main` in a controlled way after checking for overwrite risk.

The sequence is:

1. Add the missing design and plan artifacts in the worktree branch.
2. Add the negative serializer tests and CI workflow in that same branch.
3. Run the existing verification commands in the worktree branch.
4. Commit the branch once the full stack is green.
5. Fast-forward or cherry-pick onto `main`, depending on what the checkout
   state safely permits.

If the local `main` worktree cannot be updated cleanly because untracked files
would be overwritten, we will preserve the committed branch state and report
the exact blocker instead of forcing a destructive checkout.

## Negative serializer coverage

The current serializer tests prove the happy-path materialization behavior. The
remaining gap is around unsupported data and malformed platform files. This
coverage should stay focused on observable contract behavior rather than
implementation details.

We will add cases for:

- malformed JSON in platform-owned files, such as Cursor or Codex settings
- malformed YAML or frontmatter where a serializer reads structured metadata
- unsupported resource or prompt shapes that a target platform intentionally
  cannot express
- omission behavior, where the serializer must skip unsupported features
  instead of producing invalid output

The expected outcomes are explicit. Supported files must deserialize cleanly.
Malformed files must either surface a clear failure or fall back according to
the current platform contract. Unsupported features must not leak into emitted
files as invalid platform syntax.

## CI workflow

CI should validate exactly what the repository already exposes. This keeps the
workflow small and avoids inventing new commands just for automation.

The workflow will:

1. Run on pushes to `main` and on pull requests.
2. Set up a current Node environment.
3. Install dependencies with `npm ci`.
4. Run `npm run test:run`.
5. Run `npm run lint`.
6. Optionally run `npm run build` if the repository already uses it as a normal
   local verification step and it remains fast enough.

The workflow will live in `.github/workflows/ci.yml`. It will not add coverage
uploading, required matrices, or release behavior in this pass.

## Verification

Verification must prove both the code and the integration path. We will keep it
limited to commands that already exist in the repository.

We will run:

- `npm run test:run`
- `npm run lint`
- `npm run build`

If the branch merge onto `main` succeeds locally, we will also verify the final
branch state after the merge step.

## Next steps

The next step is to turn this design into an execution plan, then implement the
branch integration, serializer negatives, and CI in that order.
