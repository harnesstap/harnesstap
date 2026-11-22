# Handoff

Start with `MAP.md` (goal, ADR index, units and their states, open questions), then
this file. Load the `rust-anything` skill and its `whole-app.md`.

## Where the port stands (2026-11-22)

- Wave 0 (foundation) is done except `src/models/`. `MAP.md` says why it stopped and which
  six leaf models come next.
- The front door (`app/`) answers `ht --version`, `-V` and `--harnesstap-version`
  itself. Everything else falls back to the original: 563 of 564 recorded cases (99.8%).
- Units with a crate and a passing gate: `version-rs`, `node-version-rs`, `toml-rs`,
  `constants-rs` and `plugin-semver-rs`. Their per-function state is in `PORT_MAP.md`
  (regenerate it with `rust-anything map . --write`).
- Plain library crates, pinned by fixtures recorded from the original:
  - `emit-rs`: YAML and JSON emitters (ADR-008, ADR-010).
  - `db-rs`: `src/db` on rusqlite (ADR-012).
  Each crate's `tests/make-fixtures.*` re-records its fixtures.
- `research/` covers the dependencies with no drop-in crate (ADR-009).

## Before you run anything

- Replay: use the commands in `MAP.md`, under "Record and replay". Build the front door
  with `HT_RELEASE=1` first, and always replay through `run-sandboxed.sh`.
- rust-anything 3.3.0 needs a one-line patch for units that reach `src/constants`,
  `src/models` or `src/db`, and TS units need `--node-arg=--experimental-transform-types`
  (`MAP.md`, open question 4).
- CI does not build `rust/` (open question 3). Before every push, run `cargo fmt --check`,
  `cargo clippy --all-targets -- -D warnings` and `cargo test` in each crate.

## Next

1. The leaf models on top of `db-rs`, with an injected clock and id source (`research/ulid.md`).
2. Wave 1 (`MAP.md`): harness writers, resolve, package cache, apm and lock. They need the
   frontmatter emitter (`research/gray-matter.md`) and the smol-toml parser
   (`research/smol-toml.md`) first.
3. Wire each command in the front door as soon as its units pass gate, with `app wire`
   (see `whole-app.md`).

## Decisions that matter now

- ADR-003: the equivalence bar.
- ADR-008 and ADR-010: emitters and normalization.
- ADR-009: dependencies with no crate.
- ADR-012: SQLite.
- ADR-013: targets and MSRV.

All are in `DECISIONS.md`.
