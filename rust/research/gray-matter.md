# gray-matter 4.0.3

## How the original uses it

- Reading: `parseFrontmatter` and `parseFrontmatterLenient` in `src/utils/frontmatter.ts`,
  used by the platform serializers (`base-serializer.ts`, `generic-agents.ts`,
  `copilot.ts`), `agent-bridge.ts`, `skill-package-import.ts` and
  `plugin-source-import.ts`. It is always called with an options object, which turns off
  gray-matter's content cache (see the comment in `frontmatter.ts`).
- Writing: `emitFrontmatter` in `base-serializer.ts` calls `matter.stringify(content, data)`
  after dropping `undefined`, `null` and `""` fields.

## What a port has to reproduce

gray-matter parses and dumps with **js-yaml 3.14**, not the `yaml` 2.8 package that
`emit-rs::yaml` reproduces. The two disagree on almost every quoting rule:

| Input | `matter.stringify` (js-yaml 3 `safeDump`) | `yaml` 2.8 with the repo's options |
| --- | --- | --- |
| `"1.0"` | `version: '1.0'` | `version: "1.0"` |
| `"yes"`, `"on"` as key | `'on': 'yes'` (YAML 1.1 booleans are quoted) | `on: yes` |
| `"y"` | `- 'y'` | `- y` |
| `"2024-01-01"` | `'2024-01-01'` | `2024-01-01` |
| a string over 80 columns | folded: `>-` then lines wrapped at 80 | one line, no folding (`lineWidth: 0`) |

Reading, js-yaml 3 `safeLoad` turns `2024-01-01` into a `Date` (it later prints as
`2024-01-01T00:00:00.000Z`), `0x1F` into `31`, and keeps `yes` as a string. gray-matter
also:

- splits on a first line of exactly `---` (an optional language after it, as in `---json`,
  switches the parser; `json` is parsed with `JSON.parse`);
- returns `content` without the frontmatter, `matter` (the raw YAML), `data`, `isEmpty`
  and `excerpt` (always `""` here, since no caller asks for excerpts);
- on an empty block (`---\n---`), gives `data: {}`;
- on invalid YAML, throws js-yaml's `YAMLException`, whose message
  `parseFrontmatterLenient` catches.
- `matter.stringify` writes `---\n<yaml>---\n<content>` and adds a newline to
  content that does not end in one.

## Crate options

- `gray_matter` (Rust): different splitting rules and a pluggable YAML engine, but nothing
  close to js-yaml 3 output. Not byte-compatible.
- `serde_yaml_ng` / `saphyr`: parse YAML 1.2. Neither turns timestamps into dates the way
  js-yaml 3 does, so the reader needs a small conversion pass for the js-yaml 3
  `safe` schema (timestamp, int with `0x`/`0o`/`_`, float, `<<` merge).

## Recommendation

1. Hand port the split (about 150 lines of gray-matter: `parse`, `stringify`, the
   delimiter and language rules), as part of `src/utils/frontmatter.ts`.
2. Read with saphyr and apply the js-yaml 3 safe-schema conversions.
3. Write a js-yaml 3 `safeDump` emitter next to `emit-rs::yaml`, pinned the same way:
   fixtures recorded from `matter.stringify` over generated values plus every frontmatter
   file in `rust/app-cases`. It is roughly the size of `emit-rs::yaml` plus folding at 80
   columns.

The `parseFrontmatterLenient` fallback is plain string work and ports directly.

## Status

Reading is done in `rust/frontmatter-rs`, with one change to the plan above: instead of
saphyr plus conversions, the js-yaml 3.14 loader is ported line by line. Callers branch on
whether a read throws (the lenient fallback, the importers' error reports), and a saphyr
based reader accepted or rejected different inputs and gave different messages and marks.
The port is about 1700 lines and replays 9176 recorded cases (see the MAP.md row).
Writing (step 3) is done too: the js-yaml 3 dumper is ported line by line next to the loader
(`src/dumper.rs`), pinned by 7047 recorded `matter.stringify` cases (see the MAP.md row).
