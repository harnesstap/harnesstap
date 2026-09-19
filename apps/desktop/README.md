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

Runs the UI in a normal browser against a manually started agent. Useful for fast visual iteration and for the screenshot walk below; no Rust toolchain needed.

Terminal 1 — agent with an isolated demo `HOME` and project built from `test/fixtures` (root `/tmp/htdemo`, override with `HT_DEMO_ROOT`; port via `HARNESSTAP_AGENT_PORT`):

```bash
bun run desktop:demo-agent
```

Terminal 2 — Vite, pointed at that agent:

```bash
cd apps/desktop && VITE_AGENT_URL=http://127.0.0.1:7474 VITE_AGENT_TOKEN=$(cat /tmp/htdemo/home/.harnesstap/agent-token) bun run dev
```

Open the printed URL in Chrome. Without a Tauri runtime the UI skips `start_sidecar` and probes `VITE_AGENT_URL` / `VITE_AGENT_PORT` / 7474+ for `GET /v1/health`. Native commands are unavailable in the browser: the folder picker and “open in editor” do nothing, and `sidecar-reloaded` is not delivered.

Terminal 3 — screenshot walk (Playwright + system Chrome):

```bash
bun run desktop:shots
```

`scripts/ui-shots.mjs` installs `scripts/tauri-shim.js` via `addInitScript`, which fakes `window.__TAURI_INTERNALS__` so `invoke`/`listen`/`open` resolve instead of throwing (the folder dialog returns the demo project path, `read_agent_token` returns the demo token). It then walks Global/Project scope, Library list/detail/create picker, Discover list/tree, Environments, the Settings tabs, and the Export/Import/Account overlays at 1440×900 and 960×640, writing PNGs to `e2e/artifacts/shots/` (gitignored). Exit code is 1 if any `pageerror` fired.

Knobs: `SHOTS_BASE_URL` (default `http://127.0.0.1:5173/`), `SHOTS_AGENT_PORT`, `SHOTS_TOKEN_PATH`, `SHOTS_PROJECT_PATH`, `SHOTS_OUT`, `SHOTS_CHROME_CHANNEL=chrome` or `SHOTS_CHROME_PATH=/usr/bin/google-chrome-stable` (falls back to Playwright's bundled Chromium; `bunx playwright install chromium` if neither is available), `--viewports 1440x900,960x640`, `--reduced-motion`.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘/Ctrl+K` | Command palette |
| `⌘/Ctrl+1` | Go to Library |
| `⌘/Ctrl+2` | Go to Discover |
| `⌘/Ctrl+3` | Go to Environments |
| `[` | Switch to Global |
| `]` | Switch to Project |
| `/` | Focus the current workspace filter |
| `?` | Keyboard shortcuts |
| `Esc` | Dismiss the top overlay, else Back |

`?` lists the same table in-app. Workspace-specific actions (Create resource, Apply, Add marketplace, and so on) appear under **Actions on this screen** in the palette.

## Visual regression (web mode)

With a running Vite server and `ht-agent` (`apps/desktop/scripts/demo-home.sh`):

```bash
bun run desktop:shots
bun run desktop:check
```

`scripts/ui-shots.mjs` shims Tauri IPC, walks Global/Project, Library, Discover, Environments, Settings, and Export/Import/Account at 1440×900 and 960×640, and writes PNGs to `e2e/artifacts/shots/` (gitignored). `--compare` diffs those against committed baselines in `e2e/visual/` (`pixelmatch`, 0.2% pixels). `--axe` fails on axe-core `serious` / `critical`. `--reduced-motion` asserts `document.getAnimations().length === 0` after each screen. `--trace` records rAF frame times for palette open/close and a list scroll and fails if any frame exceeds 32ms. `--update-baselines` copies the latest shots into `e2e/visual/`.

`bun run desktop:check` is shots + compare + axe + reduced-motion + trace. Nightly: `.github/workflows/desktop-e2e.yml` `visual` job (web mode, no Tauri).

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

Release jobs build `.deb` and `.rpm` first, then AppImage (`APPIMAGE_EXTRACT_AND_RUN=1`, `NO_STRIP=1`). GitHub-hosted Ubuntu 22.04 has no FUSE, so CI extracts linuxdeploy and the appimage plugin with `unsquashfs` and places ELF stubs at `~/.cache/tauri/linuxdeploy-${ARCH}.AppImage`. linuxdeploy's GTK plugin `ldd`s `usr/bin/ht-agent` (Bun `--compile`) and SIGABRTs if that ELF is present; wrap/GTK wrappers move `ht-agent` aside by sidecar name (system `ldd` often exits 0 on Bun standalones) and restore it next to the desktop executable. The Linux job fails if no `.AppImage` is produced.

CI builds are **unsigned**. There are no Apple Developer ID / notarization, Windows Authenticode, or Linux package-signing secrets in the workflow. macOS jobs ad-hoc reseal `HarnessTap.app` after the Tauri bundle (`codesign --force --deep --sign -`) so CodeResources exist; without that, Gatekeeper reports a quarantined app as damaged rather than offering Open Anyway. Windows SmartScreen may warn; unsigned Linux packages are normal for GitHub downloads. Signing can be added later without changing this artifact matrix.

To build and install straight into `/Applications` (macOS; quits a running instance first):

```bash
bun run desktop:install
```

## Sidecar embedding

- Root `bun run build:sidecar` compiles `src/agent/entry.ts` → `dist/sidecar/ht-agent`
- `apps/desktop/scripts/prepare-sidecar.sh` copies the binary to `src-tauri/binaries/ht-agent-<target-triple>` (`.exe` suffix on Windows)
- `tauri.conf.json` lists `externalBin: ["binaries/ht-agent"]` (Release AppImage bundling shelters `ht-agent` from linuxdeploy's `ldd` scan by sidecar name; the sidecar stays next to the desktop executable)

## Dogfood checklist

- [ ] Fresh machine: install app, no global `ht` required
- [ ] Second launch focuses existing window (single-instance)
- [ ] Sidecar health must succeed before UI shows connected
- [ ] Profiles rail lists profile-tagged plugins (default seeded on first boot)
- [ ] Switch shows SSE steps; Cancel disabled during apply step
- [ ] Live panel G/Y/R from `GET /v1/status`
- [ ] After apply / switch / Project Install, a yellow strip lists parked executable refs (`ht approve` / `ht deny`)
- [ ] Project view auto-bootstraps `apm.yml` on first use
- [ ] Settings → Project edits raw `apm.yml` in-app; Save validates before write

## End-to-end tests (Tauri + WebdriverIO)

```bash
bun run desktop:e2e:build   # debug build with --features e2e
bun run desktop:e2e         # WebdriverIO golden path
```

Uses isolated `HOME` / `HARNESSTAP_HOME` and `HARNESSTAP_E2E_PROJECT_PATH` (only honored when built with Cargo feature `e2e`). CI: `.github/workflows/desktop-e2e.yml` (Ubuntu, nightly / manual — not a PR gate yet).
