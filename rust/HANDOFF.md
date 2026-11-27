# Handoff

Start with `MAP.md` (goal, ADR index, units and their states, open questions), then
this file. Load the `rust-anything` skill and its `whole-app.md`
(https://github.com/erkamyaman/rust-anything, 5.0.1).

## Where the port stands (2026-11-27)

- Wave 1 (core engine) is merged except the harness writers (`src/platforms/*.ts`
  serializers), snapshots and revert, and the apm graph, import, pack and bundle services.
  `MAP.md` lists what each still waits on.
- Wave 2 has started. `rust/cli-rs` is the CLI front end: the commander 13 parse over the
  original's dumped command tree, root help, `--help` anywhere, a group's own help and every
  commander error, plus the first ported action (`help`). Replay is 564/564 with a
  fallback rate of 77.8% (439/564), down from 99.8%.
- Rust actions go in `cli-rs/src/actions/<group>.rs`. An action builds its whole output
  before any side effect and is printed only when the original would add nothing after it
  (ADR-018). Until the theme, telemetry and self-update are ported, interactive runs
  (a TTY, telemetry not switched off) still reach the original.

## Before you run anything

- Replay: use the commands in `MAP.md` under "Record and replay". Build the front door
  with `HT_RELEASE=1`, hard-link it as `harnesstap` (ADR-018), and replay through
  `run-sandboxed.sh` with `SHELL` unset and `TMPDIR=/tmp`, or the `init` cases differ.
- `bun run build` regenerates `src/generated/scenarios.ts`; restore it afterwards.
  `cli-rs/tests/dump-tree.ts` takes the scenarios the way the build does.
- Re-run `NO_COLOR=1 bun rust/cli-rs/tests/dump-tree.ts` and
  `node rust/cli-rs/tests/make-fixtures.mjs` whenever a command, option, help entry or
  scenario changes.
- Crate tests that rebuild file trees fail on macOS when two names differ only by case
  (`apm-rs manifest_fixtures`, `lockfile-rs deployed_hash_diffs`); Linux CI passes.
- Rust CI (`.github/workflows/rust-ci.yml`) runs fmt, clippy on 1.90, the tests and the
  replay on every pull request that touches `rust/`.

## Next

1. Runtime services that keep interactive runs in Rust: `self-update.ts` (the notice after
   an action), `src/telemetry/` (notice and startup event), `src/ui/theme.ts` (chalk
   levels and colors). Then relax the hand-back rules in `cli-rs/src/lib.rs`.
2. Command groups whose services are ported: `config`, `lock`, `harness`, `targets`,
   `policy`, `environment`, then `resource` and `plugin`.
3. Harness writers once `merge-skill-markdown` and `agent-bridge` are ported (the
   frontmatter writer and the config editors are done).

## Decisions that matter now

- ADR-003: the equivalence bar.
- ADR-012: on-disk compatibility.
- ADR-016: network effects.
- ADR-018: invocation name and the front end's hand-back rules.

All are in `DECISIONS.md`.
