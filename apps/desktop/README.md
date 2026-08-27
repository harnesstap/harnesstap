# HarnessTap Desktop

Tauri 2 desktop app for the profile control plane. Visual language: [DESIGN.md](./DESIGN.md).

## Prerequisites

- Bun 1.3+
- Rust toolchain (for Tauri)
- macOS: Xcode command line tools (for `.app` / `.dmg` builds)
- Linux: WebKitGTK 4.1 and GTK deps (see [Tauri v2 Linux prerequisites](https://v2.tauri.app/start/prerequisites/#linux))
- Windows: MSVC Build Tools (for NSIS / MSI)

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
bun src/agent/entry.ts
```

Set `VITE_AGENT_URL=http://127.0.0.1:7474` and `VITE_AGENT_TOKEN=$(cat ~/.harnesstap/agent-token)` when testing mutating routes in the browser.

## Build packaged app

```bash
bun run desktop:build
```

Output: `apps/desktop/src-tauri/target/release/bundle/`

`tauri.conf.json` requests DMG, NSIS, MSI, AppImage, deb, and rpm; Tauri v2 keeps only the formats the host OS can produce.

GitHub Releases attach those installers on each tagged CLI release:

| Platform | Runner | Artifacts |
| --- | --- | --- |
| macOS Apple Silicon | `macos-latest` | `HarnessTap_<version>_aarch64.dmg` |
| macOS Intel | `macos-15-intel` | `HarnessTap_<version>_x64.dmg` |
| Windows x64 | `windows-latest` | NSIS `*-setup.exe`, MSI `*.msi` |
| Windows arm64 | `windows-11-arm` | NSIS `*-setup.exe`, MSI `*.msi` |
| Linux x64 | `ubuntu-22.04` | `.AppImage`, `.deb`, `.rpm` |
| Linux arm64 | `ubuntu-22.04-arm` | `.AppImage`, `.deb`, `.rpm` |

Linux uses Ubuntu 22.04 (the oldest GitHub-hosted image with WebKitGTK 4.1) so glibc stays compatible with Ubuntu 22.04 / Debian 12. There is one builder per arch, not a matrix of distros. Snap, Flatpak, and AUR are out of scope.

Release jobs build `.deb` and `.rpm` first, then AppImage (`APPIMAGE_EXTRACT_AND_RUN=1`, `NO_STRIP=1`). GitHub-hosted Ubuntu 22.04 has no FUSE, so CI extracts linuxdeploy and the appimage plugin with `unsquashfs` and places ELF stubs at `~/.cache/tauri/linuxdeploy-${ARCH}.AppImage`. linuxdeploy also `ldd`s `usr/bin/ht-agent` (Bun `--compile`) and SIGABRTs; the wrap/GTK wrappers move that ELF aside for the scan and restore it next to the desktop executable. The Linux job fails if no `.AppImage` is produced.

CI builds are **unsigned**. There are no Apple Developer ID / notarization, Windows Authenticode, or Linux package-signing secrets in the workflow. macOS Gatekeeper may require **Open Anyway**; Windows SmartScreen may warn; unsigned Linux packages are normal for GitHub downloads. Signing can be added later without changing this artifact matrix.

To build and install straight into `/Applications` (macOS; quits a running instance first):

```bash
bun run desktop:install
```

## Sidecar embedding

- Root `bun run build:sidecar` compiles `src/agent/entry.ts` → `dist/sidecar/ht-agent`
- `apps/desktop/scripts/prepare-sidecar.sh` copies the binary to `src-tauri/binaries/ht-agent-<target-triple>` (`.exe` suffix on Windows)
- `tauri.conf.json` lists `externalBin: ["binaries/ht-agent"]` (Release AppImage bundling shelters this ELF from linuxdeploy's `ldd` scan; the sidecar stays next to the desktop executable)

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
