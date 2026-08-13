# HarnessTap

Agent harness configuration toolkit. Follow these conventions when working in this repo.

## Development

- **Runtime**: Bun 1.3+ for local dev, CI, and builds; the published CLI targets Node 20+.
- **Verify changes**: `bun run preflight` (lint + typecheck + tests + build).
- **Run the CLI from source**: `bun run start -- <args>` or `bun src/index.ts`.
- **Changelog**: Use Changie (`changie new`); do not edit `CHANGELOG.md` manually.

## Code style

- TypeScript strict mode; library code lives in `src/`, tests in `test/`.
- Keep imports at the top of the module — no inline imports in function bodies or types.
- Use exhaustive `switch` handling: include a `never` check in the `default` case for discriminated unions and enums.
- Biome handles linting (`bun run lint`); the formatter is disabled — match surrounding style.
- Harness definitions and paths: `src/platforms/registry.ts` is the source of truth; `docs/supported-harnesses.md` mirrors it for docs.

## Architecture

- **Resources** are imported into a local library, composed into **plugins**, then **applied** to harness-specific on-disk files.
- Platform serializers live under `src/platforms/`; shared orchestration under `src/services/`.
- Contributor product spec: `SPEC.md`. Contributing workflow: `CONTRIBUTING.md`. Desktop UI language: `apps/desktop/DESIGN.md`.

## Scope discipline

- Minimize diff scope; do not refactor or reformat unrelated code.
- Add tests only when they cover meaningful behavior, not trivial assertions.
- Do not create git commits unless explicitly requested.

## Documentation

- User-facing docs live in `README.md` and `docs/`. Put the content there; do not link those pages at `SPEC.md` or working notes.
- `SPEC.md` is the contributor source of truth for product behavior. Keep it in git at the repo root. Update it when CLI behavior or concepts change.
- Working notes, Superpowers plans, and local task lists belong in `docs/internal/` (gitignored). Do not commit transcripts, `TODOS.md`, or plan files.