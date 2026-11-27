# Decisions

Architecture decision records for the Rust port of the HarnessTap CLI and the
Desktop sidecar agent. Numbered in order and never renumbered; a changed
decision gets a new ADR that supersedes the old one.

## ADR-001: Pure Rust core shared by CLI and Desktop
Status: accepted (2026-11-22)
Context: The CLI runs on Node (npm `dist/bin.js`) and the Desktop sidecar runs as a Bun-compiled binary (`ht-agent`). Two JS runtimes ship today.
Decision: Port the whole app to Rust: one Rust core used by the `ht` CLI and by the Desktop sidecar. No Bun or Node at runtime once the port is done.
Consequences: Every unit in `src/` moves to Rust. The original TypeScript stays in the repo as reference until the v2.0 switch (ADR-005).

## ADR-002: Keep the Desktop web UI, replace the sidecar
Status: accepted (2026-11-22)
Context: `analyze --whole-app` marks `apps/desktop/src/*` as keep units (UI code). The Tauri shell (`apps/desktop/src-tauri`) is already Rust.
Decision: The Desktop web UI stays in Tauri as it is. The background sidecar agent (`src/agent/`, served today by `Bun.serve`) is replaced with Rust.
Consequences: Decisions D2 to D16 of the plan are settled as keep. The UI's JS dependencies (react, radix-ui, lucide-react, @tauri-apps/*, and so on) need no Rust crate.

## ADR-003: Equivalence bar
Status: accepted (2026-11-22)
Context: Users commit generated harness files and `apm.lock.yaml`; scripts depend on flags and exit codes.
Decision: Harness config files and the lockfile are byte-identical to the original. CLI flags and exit codes are the same. CLI text (stdout, stderr) is equal after normalizing whitespace.
Consequences: `app record` cases compare written files byte for byte. Values that differ between two runs of the original (timestamps, ULIDs, temp paths) are wildcards in the cases, never in the port.

## ADR-004: Distribution unchanged
Status: accepted (2026-11-22)
Context: HarnessTap ships through npm (`harnesstap`), the Homebrew tap (formula and cask) and the Desktop installers from release.yml.
Decision: Keep every channel. Each one carries the Rust binary once it replaces the original.
Consequences: Packaging work is part of the cutover wave (ADR-013 lists the targets).

## ADR-005: Side-by-side front door, then one v2.0 switch
Status: accepted (2026-11-22)
Context: The port is long; the app must stay releasable at every step.
Decision: The Rust front door (`rust/app`) owns the entry point and falls back to the original for everything not ported yet. When every unit passes `gate` and `app replay` passes with fallback rate 0, the app switches to Rust in one v2.0 release, only on Christophe's go.
Consequences: Releases before v2.0 keep shipping the TypeScript CLI. The front door is not shipped until the switch.

## ADR-006: Blocked units (plan D17, D18)
Status: accepted (2026-11-22)
Context: `analyze` blocks `scripts/` and `src/bin.ts` for dynamic code (computed imports).
Decision: `scripts/` stays in TypeScript as dev tooling; it is not shipped. The dynamic command loaders behind `src/bin.ts` become a static clap command registry in Rust.
Consequences: No Rust port of `scripts/`. Lazy command loading has no Rust equivalent and is not needed.

## ADR-007: Tangled pieces are ported by command (plan D45, D46)
Status: accepted (2026-11-22)
Context: 27 directories under `src/` import each other (115,022 lines per `analyze`), and `src/agent/` with `parity-handlers/` form a second cycle (12,265 lines).
Decision: The one-piece label is used for planning only. The port moves by command through the front door (`app wire --command`), with `app replay` as the proof. The agent is its own wave, wired by route.
Consequences: Unit crates may cover part of a cycle. A command is wired only when everything it reaches is in Rust.

## ADR-008: YAML (plan D42)
Status: accepted (2026-11-22)
Context: `yaml` maps to saphyr and serde_yaml_ng only in part: no crate rewrites YAML while keeping comments and layout.
Decision: Parse with saphyr. Write a small layout-preserving emitter for `apm.yml` edits and `apm.lock.yaml`, pinned by recorded cases.
Consequences: The emitter is a foundation unit (wave 0). Every YAML-writing command needs recorded cases before it is wired.

## ADR-009: Dependencies with no crate in the plan
Status: accepted (2026-11-22)
Context: `gray-matter`, `ulid`, `@inquirer/core`, `@inquirer/search` and `cli-table3` have fit `unknown`.
Decision: Research each against primary sources into `rust/research/<topic>.md` before porting what uses it. Prompts and spinners are checked at the normalized-text level only.
Consequences: Units that use these wait for their research file.

## ADR-010: Normalization and emit rules
Status: accepted (2026-11-22)
Context: ADR-003 needs stable cases while some values change on every run.
Decision: Timestamps, ULIDs, snapshot IDs and temp paths are normalized in the cases. JSON, YAML and TOML output match the original's formatting and key order exactly (insertion-ordered maps). `sha256:` hashes in manifests and the lockfile must round-trip identically.
Consequences: Use `indexmap` where order reaches output, and emitters written to match `JSON.stringify`, the `yaml` package and `smol-toml`.

## ADR-011: Sidecar protocol unchanged
Status: accepted (2026-11-22)
Context: The Desktop UI talks to the sidecar over HTTP.
Decision: The Rust sidecar keeps 127.0.0.1:7474 (`HARNESSTAP_AGENT_PORT` override), the token file, the port file and every `/v1/*` route with the same status codes and bodies. Embedding the core in the Tauri process is deferred.
Consequences: Desktop UI and Tauri shell need no change for the swap. Agent cases are recorded with `app record --http`.

## ADR-012: On-disk compatibility while both run
Status: accepted (2026-11-22)
Context: The original and the Rust build share one HOME during the side-by-side period.
Decision: Same SQLite file and schema, same WAL and locking behavior, same lockfile and `~/.harnesstap` layout.
Consequences: rusqlite (bundled) with the same pragmas; no schema change before v2.0.

## ADR-013: Targets and MSRV
Status: accepted (2026-11-22)
Context: release.yml builds Desktop for 6 targets: macos-aarch64, macos-x64, windows-x64, windows-arm64, linux-x64, linux-arm64.
Decision: The Rust CLI and sidecar build for the same 6 targets. The CLI ships through per-platform npm packages (optionalDependencies of `harnesstap`) with a thin launcher. MSRV is Rust 1.90, the highest minimum among the planned crates (tauri 2.12 needs 1.90, rusqlite 0.43 needs 1.89).
Consequences: Packaging is checked with `rust-anything package` in the cutover wave. Rust CI is proposed separately; no workflow change without approval.

## ADR-014: Tests
Status: accepted (2026-11-22)
Context: 782 test files run under `bun test`.
Decision: Black-box suites (`test/cli`, `test/agent`, scenarios) are run against the Rust binary. Ports get cargo tests and recorded cases. Unit tests of TypeScript internals are not translated.
Consequences: Black-box suites must be able to take the binary under test from the environment.

## ADR-015: Checkpoints
Status: accepted (2026-11-22)
Decision: Stop for Christophe's go after each wave. The v2.0 switch needs his explicit go.
Consequences: Each wave ends with `rust/HANDOFF.md` and an updated `rust/MAP.md`.

## ADR-016: Network effects
Status: accepted (2026-11-22)
Context: The CLI calls HarnessTap Cloud, the public catalog, the MCP Registry and GitHub (device flow).
Decision: Record these calls with `app record --effects http`. API shapes are coordinated with the Cloud owner through the Chief of staff.
Consequences: Wave 0 cases run with network calls refused; effect cases come with the units that make the calls.

## ADR-017: Scope
Status: accepted (2026-11-22)
Decision: Every one of the 44 registered harnesses is ported. No feature is dropped.
Consequences: The harness writers (`src/platforms/`) are ported whole.

## ADR-018: Invocation name and the front end's hand-back rules
Status: accepted (2026-11-27)
Context: `resolveInvocationName` prints `ht` when the script is launched as `ht` and `harnesstap` otherwise. The cases were recorded through `node dist/bin.js`, so they show `harnesstap`, while the front door binary is named `ht`. The front end (`cli-rs`) also meets output it cannot reproduce yet: chalk colors, the telemetry notice and startup event, the CLI update check, and `--verbose` stacks.
Decision: The Rust front door reads its own argv[0] the same way (`ht` only when launched as `ht`), and replay runs it through a `harnesstap` hard link, which is the npm package's other bin name. `cli-rs` answers only when the original's output is plain text and has no side effect it does not reproduce: help when commander's or chalk's color rules give no color, any run only when `HARNESSTAP_TELEMETRY` is off, a command group's own help only when the update check is skipped, errors only without `-v`/`--verbose`. Everything else runs the original.
Consequences: Real interactive runs (TTY, telemetry not switched off) still reach the original until the theme, telemetry and self-update are ported; the recorded cases run in Rust. Porting those three units widens the front end without changing its parser.
