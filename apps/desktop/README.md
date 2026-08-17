# HarnessTap Desktop

Tauri 2 desktop app for the profile control plane. Visual language: [DESIGN.md](./DESIGN.md).

## Prerequisites

- Bun 1.3+
- Rust toolchain (for Tauri)
- macOS: Xcode command line tools (for `.app` / `.dmg` builds)

## Local development

From the repo root:

```bash
bun run desktop:dev
```

This cleans up stale sidecar/Vite listeners from a previous dev session, prepares the `ht-agent` sidecar, installs desktop deps, then runs `tauri dev` **plus** a sidecar watcher.

- **UI (`apps/desktop/src`)** — Vite HMR reloads automatically.
- **Agent / library (`src/`)** — the watcher rebuilds `ht-agent` and the Tauri shell restarts the sidecar in place (no need to kill `desktop:dev`). The UI reconnects on `sidecar-reloaded`.

To only clear orphaned listeners and session files:

```bash
bun run desktop:cleanup
```

The app spawns the bundled `ht-agent` sidecar, waits for `GET /v1/health`, then reads `~/.harnesstap/agent-token` for mutating API calls.

### Web-only dev (no Tauri shell)

```bash
cd apps/desktop && bun install && bun run dev
```

In another terminal, start the agent manually:

```bash
bun run start -- agent serve
```

Set `VITE_AGENT_URL=http://127.0.0.1:7474` and `VITE_AGENT_TOKEN=$(cat ~/.harnesstap/agent-token)` when testing mutating routes in the browser.

## Build macOS app

```bash
bun run desktop:build
```

Output: `apps/desktop/src-tauri/target/release/bundle/`

## Sidecar embedding

- Root `bun run build:sidecar` compiles `src/agent/entry.ts` → `dist/sidecar/ht-agent`
- `apps/desktop/scripts/prepare-sidecar.sh` copies the binary to `src-tauri/binaries/ht-agent-<target-triple>`
- `tauri.conf.json` lists `externalBin: ["binaries/ht-agent"]`

## Dogfood checklist

- [ ] Fresh machine: install app, no global `ht` required
- [ ] Second launch focuses existing window (single-instance)
- [ ] Sidecar health must succeed before UI shows connected
- [ ] Profiles rail lists profile-tagged plugins (default seeded on first boot)
- [ ] Switch shows SSE steps; Cancel disabled during apply step
- [ ] Live panel G/Y/R from `GET /v1/status`
- [ ] Project view auto-bootstraps `.harnesstap/config.toml` on first use

## End-to-end tests (Tauri + WebdriverIO)

```bash
bun run desktop:e2e:build   # debug build with --features e2e
bun run desktop:e2e         # WebdriverIO golden path
```

Uses isolated `HOME` / `HARNESSTAP_HOME` and `HARNESSTAP_E2E_PROJECT_PATH` (only honored when built with Cargo feature `e2e`). CI: `.github/workflows/desktop-e2e.yml` (Ubuntu, nightly / manual — not a PR gate yet).
