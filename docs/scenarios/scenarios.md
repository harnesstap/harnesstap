# HarnessDeck user scenarios

This document reflects the **current shipped CLI**.

Two corrections matter up front:

- `harnessdeck init` initializes `~/.harnessdeck`, seeds built-in layers,
  imports supported home-directory defaults, and can choose the default main
  harness (plus alias harnesses) during init. [Scenario 2](./details/02-default-harness-aliases.md) is for changing that
  preference later.
- The current CLI **does** expose a standalone `harnessdeck project sync`
  command ([Scenario 27](./details/27-project-sync.md)). Use it when you want
  to sync alias harness outputs from the on-disk main harness. Re-applying a
  layer to selected platforms ([Scenarios 7](./details/07-preview-apply-layer.md) and [15](./details/15-subset-platforms.md))
  remains the right path when you want to push a known layer baseline onto
  disk.

See the [VHS demo pack](./vhs/README.md) for rendered walkthroughs of the covered workflows.

## Usage frequency

Frequency describes how often a **typical active user** reaches for a scenario
after HarnessDeck is set up — not how important it is the first time.

| Frequency      | Meaning |
| -------------- | ------- |
| **Common**     | Regular per-repo work: onboarding, adoption, repo-specific prefs, applying layers |
| **Occasional** | Setup, customization, sharing, maintenance, automation, CI integration |
| **Rare**       | Edge cases, team-only constraints, debugging, or recovery after a mistake |

| Scenario | Title | Frequency | Status |
| -------- | ----- | --------- | ------ |
| [7](./details/07-preview-apply-layer.md)  | Preview and apply a layer                          | Common     | Shipped |
| [11](./details/11-builtin-layer.md) | Start from a built-in layer                        | Common     | Shipped |
| [4](./details/04-scan-import-repo.md)  | Scan and import an existing repo                    | Common     | Shipped |
| [3](./details/03-project-harness-preferences.md)  | Override harness preferences for one repository     | Common     | Shipped |
| [15](./details/15-subset-platforms.md) | Apply to a subset of target platforms               | Common     | Shipped |
| [25](./details/25-stack-layers.md) | Stack multiple layers                              | Common     | Shipped |
| [26](./details/26-layer-from-project.md) | Turn a project's current state into a layer        | Common     | Shipped |
| [27](./details/27-project-sync.md) | True cross-harness `project sync`                   | Common     | Shipped |
| [1](./details/01-bootstrap-machine.md)  | Bootstrap HarnessDeck on a machine                  | Occasional | Shipped |
| [2](./details/02-default-harness-aliases.md)  | Choose a default main harness and aliases           | Occasional | Shipped |
| [5](./details/05-build-layer-from-resources.md)  | Build a reusable layer from imported resources     | Occasional | Shipped |
| [8](./details/08-audit-plugins.md)  | Audit plugin inventory and lifecycle                | Occasional | Shipped |
| [10](./details/10-export-import-layer.md) | Export or import a layer bundle                    | Occasional | Shipped |
| [12](./details/12-scripts-agents.md) | Drive HarnessDeck from scripts or agents            | Occasional | Shipped |
| [13](./details/13-materialization-strategy.md) | Choose a materialization strategy (symlink vs copy) | Occasional | Shipped |
| [16](./details/16-ci-enforcement.md) | Enforce layer and plugin state in CI               | Occasional | Shipped |
| [19](./details/19-refresh-plugin-metadata.md) | Refresh stale plugin metadata                       | Occasional | Shipped |
| [20](./details/20-inspect-platforms.md) | Inspect supported platforms before targeting        | Occasional | Shipped |
| [21](./details/21-detect-drift.md) | Detect drift between project and last applied layer | Occasional | Shipped |
| [22](./details/22-diff-layers.md) | Diff two layers                                    | Occasional | Shipped |
| [23](./details/23-validate-layer.md) | Validate a layer without writing                   | Occasional | Shipped |
| [24](./details/24-apply-from-url.md) | Apply a layer directly from a URL                  | Occasional | Shipped |
| [6](./details/06-plugin-constraints.md)  | Add plugin constraints to a layer                  | Rare       | Shipped |
| [9](./details/09-history-revert.md)  | Review history and recover from a bad apply         | Rare       | Shipped |
| [14](./details/14-curate-resource-db.md) | Curate and clean up the local resource DB           | Rare       | Shipped |
| [17](./details/17-migrate-state.md) | Migrate HarnessDeck state to a new machine          | Rare       | Shipped (manual) |
| [18](./details/18-plugin-merge-conflict.md) | Debug a Claude plugin merge conflict                | Rare       | Shipped |
| [28](./details/28-machine-migration.md) | One-command machine migration                       | Rare       | Shipped |

**Status legend**

- **Shipped** — the commands shown in the scenario exist in the current CLI.
- **Shipped (manual)** — achievable today with current commands but as a
  multi-step workflow (see [Scenario 17](./details/17-migrate-state.md) vs [28](./details/28-machine-migration.md)).

---

## Common

Use these when starting or adopting a repository, applying a layer, or when
one repo needs different harness defaults than your machine-wide setup.

| Scenario | Summary |
| -------- | ------- |
| [7](./details/07-preview-apply-layer.md) | Preview and apply a layer to one or more target harnesses |
| [11](./details/11-builtin-layer.md) | Start from a built-in layer instead of building from scratch |
| [4](./details/04-scan-import-repo.md) | Scan an existing repository and import its current harness setup |
| [3](./details/03-project-harness-preferences.md) | Override harness preferences for one repository |
| [15](./details/15-subset-platforms.md) | Apply a layer to a subset of target platforms |
| [25](./details/25-stack-layers.md) | Stack multiple layers in one apply |
| [26](./details/26-layer-from-project.md) | Turn a project's current state into a layer |
| [27](./details/27-project-sync.md) | True cross-harness `project sync` |

---

## Occasional

Reach for these during initial setup, when curating layers, when sharing
baselines, or when integrating HarnessDeck into tooling.

| Scenario | Summary |
| -------- | ------- |
| [1](./details/01-bootstrap-machine.md) | Bootstrap HarnessDeck on a machine and discover existing defaults |
| [2](./details/02-default-harness-aliases.md) | Choose a default main harness and alias harnesses |
| [5](./details/05-build-layer-from-resources.md) | Build a reusable layer from imported resources |
| [8](./details/08-audit-plugins.md) | Audit plugin inventory and lifecycle |
| [10](./details/10-export-import-layer.md) | Export or import a layer as a portable bundle |
| [12](./details/12-scripts-agents.md) | Drive HarnessDeck from scripts or other agents |
| [13](./details/13-materialization-strategy.md) | Choose a materialization strategy (symlink vs copy) |
| [16](./details/16-ci-enforcement.md) | Enforce layer and plugin state in CI |
| [19](./details/19-refresh-plugin-metadata.md) | Refresh stale plugin metadata |
| [20](./details/20-inspect-platforms.md) | Inspect supported platforms before targeting |
| [21](./details/21-detect-drift.md) | Detect drift between project files and the last applied layer |
| [22](./details/22-diff-layers.md) | Diff two layers (or a layer vs an imported bundle) |
| [23](./details/23-validate-layer.md) | Validate a layer without writing to disk |
| [24](./details/24-apply-from-url.md) | Apply a layer directly from a URL |

---

## Rare

These matter when requirements are strict, when something went wrong, or
when maintaining the local DB after a lot of activity.

| Scenario | Summary |
| -------- | ------- |
| [6](./details/06-plugin-constraints.md) | Add plugin constraints to a layer |
| [9](./details/09-history-revert.md) | Review project state, history, and recover from a bad apply |
| [14](./details/14-curate-resource-db.md) | Curate and clean up the local resource DB |
| [17](./details/17-migrate-state.md) | Migrate HarnessDeck state to a new machine (manual workflow) |
| [18](./details/18-plugin-merge-conflict.md) | Debug a Claude plugin merge conflict (committed vs effective) |
| [28](./details/28-machine-migration.md) | One-command machine migration (export/import archive) |
