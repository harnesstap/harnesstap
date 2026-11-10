# HarnessTap

Agent harness configuration toolkit. Follow these conventions when working in this repo.

## Development

- **Runtime**: Bun 1.3+ for local dev, CI, and builds; the published CLI targets Node 22.12+ and 24.
- **Verify changes**: `bun run preflight` (lint + typecheck + tests + build).
- **Run the CLI from source**: `bun run start -- <args>` or `bun src/bin.ts`.
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
- Contributor product spec: `SPEC.md`. Contributing workflow: `CONTRIBUTING.md`.

## Design system

Read `DESIGN.md` before changing any UI, CLI output or user-facing copy. The top-level `DESIGN.md` wins on tokens, voice and UX rules; `apps/desktop/DESIGN.md` is the per-screen reference (layouts, recipes, exact labels). If they disagree, follow the top-level file and fix the Desktop file in the same PR.

- **Tokens only.** No raw hex, `rgb()`, `font-size` or `z-index` literals outside `apps/desktop/src/styles/tokens.css`, `src/ui/theme.ts` and `design-tokens.json`. If the color you need has no token, stop and propose one.
- **New patterns go to Design first.** A new token, component, icon meaning, a second path for an existing action, or a change to a Locked rule needs a proposal first: a draft PR or an issue with the `design-proposal` label, titled `design-proposal: <short name>`, with the problem, options, a recommendation and screenshots. Do not ship it in the same PR.
- **Voice.** No em dashes, en dashes or the single-character ellipsis in user-facing text. Tooltips are short and human: not prose, not robot, not condescending. Sentence case.
- **UX.** One path per action. Destructive actions are a quiet icon that opens a confirm (reason, then confirm). Never hide zero-count types in Library. Every icon-only control has a tooltip and an `aria-label`, and each icon keeps its one meaning.
- **Decisions.** Check `docs/design-decisions.md` before reopening a choice. Proposed items are not approved yet; do not build them unless the task says so.
- **Before opening a UI PR**, run the design review skill (`.agents/skills/design-review/SKILL.md`) and `bun run preflight`, and attach before and after screenshots.

## Scope discipline

- Minimize diff scope; do not refactor or reformat unrelated code.
- Add tests only when they cover meaningful behavior, not trivial assertions.
- Do not create git commits unless explicitly requested.

## Documentation

- User-facing docs live in `README.md` and `docs/`. Put the content there; do not link those pages at `SPEC.md` or working notes.
- `SPEC.md` is the contributor source of truth for product behavior. Keep it in git at the repo root. Update it when CLI behavior or concepts change.
- `README.md` describes only the latest published release, in the present tense: no version-gated notes and no unreleased features. The same holds for `docs/cli/command-reference.md`. Put text for unreleased behaviour in `docs/unreleased-readme.md` (format in its header, mode marker required); the release flow folds it in.
- Working notes, Superpowers plans, and local task lists belong in `docs/internal/` (gitignored). Do not commit transcripts, `TODOS.md`, or plan files.