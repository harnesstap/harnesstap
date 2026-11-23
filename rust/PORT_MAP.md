# Port map: rust-port-w0

4 of 54 units have a Rust port; no original changed since it was recorded.

## Ports

| Unit | Crate | In Rust | Kept in the original | Cases | Last diff | Original |
| --- | --- | --- | --- | ---: | ---: | --- |
| `src/constants/` | `rust/constants-rs` | `isEmptyBuiltinProfile`, `isReservedProfileName`, `isProfilePlugin`, `isProjectProfilePlugin`, `isAutoSeededDefaultProfileName` | `listProfilePlugins` | 668 | 668/668 | unchanged |
| `src/node-version.ts` | `rust/node-version-rs` | `parseNodeVersion`, `isSupportedNodeVersion`, `launchedByBun`, `nodeVersionRefusalMessage`, `isBunRuntime`, `assertSupportedRuntime` | - | 58 | 58/58 | unchanged |
| `src/services/toml/` | `rust/toml-rs` | `environmentsToTomlRecord`, `environmentsFromTomlRecord`, `environmentToTomlDocument`, `readTransportFile`, `sortStringRecord`, `assertTomlExtension`, `readSchemaHeader`, `formatTransportToml`, `writeTransportToml` | `parseTransportToml`, `sortKeysDeep` | 1709 | 1709/1709 | unchanged |
| `src/version.ts` | `rust/version-rs` | `isReleaseBuild`, `readGitSha`, `formatDevBuildVersion`, `resolveBuildVersion` | - | 90 | 90/90 | unchanged |

## Not ported yet

In the order `analyze` suggests.

| Unit | Lines | Exports | Readiness |
| --- | ---: | ---: | ---: |
| `src/services/wizards/adapters/` | 138 | 4 | 100 |
| `src/services/completion/providers/` | 516 | 22 | 74 |
| `src/copy/` | 489 | 56 | 74 |
| `src/services/wizards/prompts/hooks/` | 300 | 21 | 73 |
| `src/services/completion/` | 690 | 12 | 59 |
| `src/services/export/` | 677 | 11 | 59 |
| `src/services/plugin-doctor/checks/` | 127 | 0 | 100 |
| `src/services/plugin-doctor/` | 24 | 0 | 100 |
| `src/index.ts` | 17 | 0 | 100 |
| `apps/desktop/src/components/motion/` | 353 | 0 | 80 |
| `apps/desktop/src/components/discover/` | 28 | 0 | 100 |
| `apps/desktop/src/components/library/` | 317 | 0 | 86 |
| `src/bin.ts` | 43 | 0 | 90 |
| `apps/desktop/src/App.tsx` | 496 | 0 | 79 |
| `src/types.ts` | 667 | 0 | 74 |
| `apps/desktop/src/main.tsx` | 42 | 0 | 87 |
| `src/generated/` | 841 | 0 | 81 |
| `src/plugins/providers/` | 1066 | 8 | 51 |
| `src/telemetry/` | 860 | 44 | 52 |
| `src/config/` | 926 | 47 | 45 |
| `apps/desktop/src/components/ui/` | 1340 | 0 | 48 |
| `src/services/resolve/` | 1383 | 16 | 42 |
| `apps/desktop/src/components/settings/` | 1357 | 0 | 46 |
| `apps/desktop/src/components/environments/` | 1480 | 0 | 43 |
| `src/services/wizards/prompts/` | 1271 | 10 | 42 |
| `src/db/` | 1163 | 18 | 18 |
| `src/services/package-cache/` | 1795 | 48 | 23 |
| `scripts/` | 2334 | 0 | 0 |
| `apps/desktop/src/components/harnesses/` | 1983 | 0 | 26 |
| `src/utils/` | 1330 | 61 | 8 |
| `apps/desktop/scripts/` | 1348 | 5 | 12 |
| `src/cli/` | 1718 | 45 | 11 |
| `src/platforms/` | 6540 | 28 | 0 |
| `src/plugins/` | 1941 | 70 | 0 |
| `src/services/agent-plugins/` | 3648 | 59 | 0 |
| `src/cli/handlers/` | 2526 | 47 | 4 |
| `src/services/` | 65325 | 1373 | 0 |
| `src/ui/` | 3563 | 121 | 0 |
| `apps/desktop/src/lib/` | 13386 | 0 | 0 |
| `src/models/` | 3725 | 144 | 0 |
| `apps/desktop/src/components/` | 20381 | 0 | 0 |
| `apps/desktop/src/lib/api/` | 2676 | 115 | 0 |
| `apps/desktop/src/state/` | 4768 | 0 | 0 |
| `src/agent/` | 6159 | 107 | 0 |
| `src/agent/parity-handlers/` | 6106 | 34 | 0 |
| `src/services/wizards/` | 2904 | 49 | 0 |
| `apps/desktop/src/components/shell/` | 3623 | 0 | 0 |
| `apps/desktop/src/components/parity/` | 2057 | 0 | 7 |
| `src/cli/commands/` | 10328 | 54 | 0 |
| `apps/desktop/src/components/live/` | 2610 | 0 | 0 |

Regenerate with `rust-anything map --write`. Commit this file: when the original changes upstream, the next map marks every port whose recording it outdated.
