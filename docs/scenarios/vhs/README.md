# HarnessDeck VHS demos

Terminal walkthroughs for all [documented scenarios](../scenarios.md). Sources live in
`tapes/`; rendered GIFs in `output/`; companion docs in `walkthroughs/`. The manifest is
`scenarios.json`.

Regenerate artifacts after changing command sequences:

```bash
node scripts/scaffold-vhs-artifacts.mjs   # tapes + walkthroughs + manifest
bun run docs:vhs                          # render GIFs (requires vhs, ffmpeg, ttyd)
bun run docs:vhs -- --scenario 04-scan-import-repo
```

## Prerequisites

- `bun`
- `vhs`
- `ffmpeg`
- `ttyd`

## Walkthroughs

| # | Title | Doc |
|---|-------|-----|
| 1 | Bootstrap HarnessDeck on a machine | [walkthroughs/01-bootstrap-machine.md](walkthroughs/01-bootstrap-machine.md) |
| 2 | Choose a default main harness and aliases | [walkthroughs/02-default-harness-aliases.md](walkthroughs/02-default-harness-aliases.md) |
| 3 | Override harness preferences for one repository | [walkthroughs/03-project-harness-preferences.md](walkthroughs/03-project-harness-preferences.md) |
| 4 | Scan and import an existing repository | [walkthroughs/04-scan-import-repo.md](walkthroughs/04-scan-import-repo.md) |
| 5 | Build a reusable layer from imported resources | [walkthroughs/05-build-layer-from-resources.md](walkthroughs/05-build-layer-from-resources.md) |
| 6 | Add plugin constraints to a layer | [walkthroughs/06-plugin-constraints.md](walkthroughs/06-plugin-constraints.md) |
| 7 | Preview and apply a layer | [walkthroughs/07-preview-apply-layer.md](walkthroughs/07-preview-apply-layer.md) |
| 8 | Audit plugin resources and layer pins | [walkthroughs/08-audit-plugins.md](walkthroughs/08-audit-plugins.md) |
| 9 | Review history and recover from a bad apply | [walkthroughs/09-history-revert.md](walkthroughs/09-history-revert.md) |
| 10 | Export or import a layer bundle | [walkthroughs/10-export-import-layer.md](walkthroughs/10-export-import-layer.md) |
| 11 | Start from a catalog baseline | [walkthroughs/11-catalog-baseline.md](walkthroughs/11-catalog-baseline.md) |
| 12 | Drive HarnessDeck from scripts or agents | [walkthroughs/12-scripts-agents.md](walkthroughs/12-scripts-agents.md) |
| 13 | Choose a materialization strategy | [walkthroughs/13-materialization-strategy.md](walkthroughs/13-materialization-strategy.md) |
| 14 | Curate and clean up the local resource DB | [walkthroughs/14-curate-resource-db.md](walkthroughs/14-curate-resource-db.md) |
| 15 | Apply to a subset of target platforms | [walkthroughs/15-subset-platforms.md](walkthroughs/15-subset-platforms.md) |
| 16 | Enforce layer and plugin state in CI | [walkthroughs/16-ci-enforcement.md](walkthroughs/16-ci-enforcement.md) |
| 17 | Migrate HarnessDeck state to a new machine | [walkthroughs/17-migrate-state.md](walkthroughs/17-migrate-state.md) |
| 18 | Debug committed vs effective Claude plugin settings | [walkthroughs/18-plugin-merge-conflict.md](walkthroughs/18-plugin-merge-conflict.md) |
| 19 | Sync plugin resources from install trees | [walkthroughs/19-refresh-plugin-metadata.md](walkthroughs/19-refresh-plugin-metadata.md) |
| 20 | Inspect supported platforms before targeting | [walkthroughs/20-inspect-platforms.md](walkthroughs/20-inspect-platforms.md) |
| 21 | Detect drift between project and last applied layer | [walkthroughs/21-detect-drift.md](walkthroughs/21-detect-drift.md) |
| 22 | Diff two layers | [walkthroughs/22-diff-layers.md](walkthroughs/22-diff-layers.md) |
| 23 | Doctor-check a layer without writing | [walkthroughs/23-validate-layer.md](walkthroughs/23-validate-layer.md) |
| 24 | Apply a layer directly from a URL | [walkthroughs/24-apply-from-url.md](walkthroughs/24-apply-from-url.md) |
| 25 | Stack multiple layers | [walkthroughs/25-stack-layers.md](walkthroughs/25-stack-layers.md) |
| 26 | Turn a project's current state into a layer | [walkthroughs/26-layer-from-project.md](walkthroughs/26-layer-from-project.md) |
| 27 | True cross-harness project mirror | [walkthroughs/27-project-sync.md](walkthroughs/27-project-sync.md) |
| 28 | One-command machine migration | [walkthroughs/28-machine-migration.md](walkthroughs/28-machine-migration.md) |
