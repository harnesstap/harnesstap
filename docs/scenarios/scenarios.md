# HarnessTap user scenarios

This document reflects the **current shipped CLI**. Each scenario links to a
detail page with typical commands.

**Orientation**

- Machine-wide setup: `init`, `profile use`, `harness set`
  ([Scenarios 1](./details/01-bootstrap-machine.md), [2](./details/02-default-harness-aliases.md), [36](./details/36-switch-profile.md))
- Repo adoption: `scan`, `layer apply`, `mirror`
  ([Scenarios 4](./details/04-scan-import-repo.md), [7](./details/07-preview-apply-layer.md), [27](./details/27-project-sync.md))
- Layer curation: `layer create`, `layer edit`, `layer doctor`, `add`
  ([Scenarios 5](./details/05-build-layer-from-resources.md), [23](./details/23-validate-layer.md), [35](./details/35-add-skill-package.md))
- Plugin pins: `resource sync`, `layer show`, `layer apply --strict-plugin-versions`
  ([Scenarios 8](./details/08-audit-plugins.md), [16](./details/16-ci-enforcement.md))
- Repo profiles: `config show`, `ht use`
  ([Scenario 40](./details/40-use-project-profile.md))
- Sharing: `migrate export` / `import`, `layer pull` / `layer publish`
  ([Scenarios 10](./details/10-export-import-layer.md), [28](./details/28-machine-migration.md))

See the [VHS demo pack](./vhs/README.md) for rendered walkthroughs of the covered workflows.

## Usage frequency

Frequency describes how often a **typical active user** reaches for a scenario
after HarnessTap is set up — not how important it is the first time.

| Frequency      | Meaning |
| -------------- | ------- |
| **Common**     | Regular per-repo work: onboarding, adoption, repo-specific prefs, applying layers |
| **Occasional** | Setup, customization, sharing, maintenance, automation, CI integration |
| **Rare**       | Edge cases, team-only constraints, debugging, or recovery after a mistake |

| Scenario | Title | Frequency | Status |
| -------- | ----- | --------- | ------ |
| [7](./details/07-preview-apply-layer.md)  | Preview and apply a layer                          | Common     | Shipped |
| [11](./details/11-builtin-layer.md) | Start from a catalog baseline                      | Common     | Shipped |
| [4](./details/04-scan-import-repo.md)  | Scan and import an existing repo                    | Common     | Shipped |
| [35](./details/35-add-skill-package.md) | Add a remote skill package                         | Common     | Shipped |
| [38](./details/38-layer-from-skill-package.md) | Create a layer from a skill package          | Common     | Shipped |
| [31](./details/31-dual-mode-plugin-import.md) | Import dual-mode plugin repo                 | Common     | Shipped |
| [3](./details/03-project-harness-preferences.md)  | Override harness preferences for one repository     | Common     | Shipped |
| [15](./details/15-subset-platforms.md) | Apply to a subset of target platforms               | Common     | Shipped |
| [25](./details/25-stack-layers.md) | Stack multiple layers                              | Common     | Shipped |
| [26](./details/26-layer-from-project.md) | Turn a project's current state into a layer        | Common     | Shipped |
| [27](./details/27-project-sync.md) | True cross-harness `mirror`                 | Common     | Shipped |
| [36](./details/36-switch-profile.md) | Switch global profile presets                    | Common     | Shipped |
| [40](./details/40-use-project-profile.md) | Switch repo profiles from `.harnesstap/config.toml` | Common | Shipped |
| [1](./details/01-bootstrap-machine.md)  | Bootstrap HarnessTap on a machine                  | Occasional | Shipped |
| [2](./details/02-default-harness-aliases.md)  | Choose a default main harness and aliases           | Occasional | Shipped |
| [5](./details/05-build-layer-from-resources.md)  | Build a reusable layer from imported resources     | Occasional | Shipped |
| [8](./details/08-audit-plugins.md)  | Audit plugin resources and layer pins               | Occasional | Shipped |
| [10](./details/10-export-import-layer.md) | Export or import a layer bundle                    | Occasional | Shipped |
| [12](./details/12-scripts-agents.md) | Drive HarnessTap from scripts or agents            | Occasional | Shipped |
| [13](./details/13-materialization-strategy.md) | Choose a materialization strategy (symlink vs copy) | Occasional | Shipped |
| [16](./details/16-ci-enforcement.md) | Enforce layer and plugin state in CI               | Occasional | Shipped |
| [19](./details/19-refresh-plugin-metadata.md) | Sync plugin resources from install trees            | Occasional | Shipped |
| [20](./details/20-inspect-platforms.md) | Inspect supported platforms before targeting        | Occasional | Shipped |
| [21](./details/21-detect-drift.md) | Detect drift between project and last applied layer | Occasional | Shipped |
| [22](./details/22-diff-layers.md) | Diff two layers                                    | Occasional | Shipped |
| [23](./details/23-validate-layer.md) | Doctor-check a layer without writing               | Occasional | Shipped |
| [24](./details/24-apply-from-url.md) | Apply a layer directly from a URL                  | Occasional | Shipped |
| [37](./details/37-publish-profile-layer.md) | Publish a profile layer to the catalog        | Occasional | Shipped |
| [32](./details/32-instruction-tier-apply.md) | Apply to instruction-tier harnesses          | Occasional | Shipped |
| [33](./details/33-mirror-plugin-fallback.md) | Mirror with plugin-source fallback           | Occasional | Shipped |
| [34](./details/34-portability-limits.md) | Understand portability limits                  | Occasional | Shipped |
| [39](./details/39-mcp-auth-and-environments.md) | Switch MCP tokens via environments; OAuth limits | Occasional | Documented |
| [6](./details/06-plugin-constraints.md)  | Add plugin constraints to a layer                  | Rare       | Shipped |
| [9](./details/09-history-revert.md)  | Review history and recover from a bad apply         | Rare       | Shipped |
| [14](./details/14-curate-resource-db.md) | Curate and clean up the local resource DB           | Rare       | Shipped |
| [17](./details/17-migrate-state.md) | Migrate HarnessTap state to a new machine          | Rare       | Shipped (manual) |
| [18](./details/18-plugin-merge-conflict.md) | Debug committed vs effective Claude plugin settings | Rare       | Shipped |
| [28](./details/28-machine-migration.md) | Share workspace offline with migrate export/import  | Occasional | Shipped |

**Status legend**

- **Shipped** — the commands shown in the scenario exist in the current CLI.
- **Documented** — workflow is documented with known product limits (see the scenario detail page).
- **Shipped (manual)** — achievable today with current commands but as a
  multi-step workflow (see [Scenario 17](./details/17-migrate-state.md) vs [28](./details/28-machine-migration.md)).

---

## Common

Use these when starting or adopting a repository, applying a layer, or when
one repo needs different harness defaults than your machine-wide setup.

| Scenario | Summary |
| -------- | ------- |
| [7](./details/07-preview-apply-layer.md) | Preview and apply a layer to one or more target harnesses |
| [11](./details/11-builtin-layer.md) | Start from a catalog baseline instead of building from scratch |
| [4](./details/04-scan-import-repo.md) | Scan an existing repository and import its current harness setup |
| [35](./details/35-add-skill-package.md) | Add a remote skill package |
| [38](./details/38-layer-from-skill-package.md) | Create a layer from a skill package |
| [31](./details/31-dual-mode-plugin-import.md) | Import a repo with both harness files and plugin-source layout |
| [3](./details/03-project-harness-preferences.md) | Override harness preferences for one repository |
| [15](./details/15-subset-platforms.md) | Apply a layer to a subset of target platforms |
| [25](./details/25-stack-layers.md) | Stack multiple layers in one apply |
| [26](./details/26-layer-from-project.md) | Turn a project's current state into a layer |
| [27](./details/27-project-sync.md) | True cross-harness `mirror` |
| [36](./details/36-switch-profile.md) | Switch global profile presets on the machine |
| [40](./details/40-use-project-profile.md) | Switch repo profiles from `.harnesstap/config.toml` |

---

## Occasional

Reach for these during initial setup, when curating layers, when sharing
baselines, or when integrating HarnessTap into tooling.

| Scenario | Summary |
| -------- | ------- |
| [1](./details/01-bootstrap-machine.md) | Bootstrap HarnessTap on a machine and discover existing defaults |
| [2](./details/02-default-harness-aliases.md) | Choose a default main harness and alias harnesses |
| [5](./details/05-build-layer-from-resources.md) | Build a reusable layer from imported resources |
| [8](./details/08-audit-plugins.md) | Audit plugin resources and layer pins |
| [10](./details/10-export-import-layer.md) | Export or import a layer as a portable bundle |
| [12](./details/12-scripts-agents.md) | Drive HarnessTap from scripts or other agents |
| [13](./details/13-materialization-strategy.md) | Choose a materialization strategy (symlink vs copy) |
| [16](./details/16-ci-enforcement.md) | Enforce layer and plugin state in CI |
| [19](./details/19-refresh-plugin-metadata.md) | Sync plugin resources from install trees |
| [20](./details/20-inspect-platforms.md) | Inspect supported platforms before targeting |
| [21](./details/21-detect-drift.md) | Detect drift between project files and the last applied layer |
| [22](./details/22-diff-layers.md) | Diff two layers (or a layer vs an imported bundle) |
| [23](./details/23-validate-layer.md) | Doctor-check a layer without writing to disk |
| [24](./details/24-apply-from-url.md) | Apply a layer directly from a URL |
| [28](./details/28-machine-migration.md) | Share a full workspace offline with migrate export/import |
| [37](./details/37-publish-profile-layer.md) | Publish and install profile-tagged catalog layers |
| [32](./details/32-instruction-tier-apply.md) | Apply layers to instruction-tier harnesses (windsurf, cline, copilot, …) |
| [33](./details/33-mirror-plugin-fallback.md) | Mirror alias harnesses when main harness tree is empty |
| [34](./details/34-portability-limits.md) | Review what transfers across harnesses and what does not |
| [39](./details/39-mcp-auth-and-environments.md) | Switch MCP tokens via environments; OAuth host limits (**Documented**) |

---

## Rare

These matter when requirements are strict, when something went wrong, or
when maintaining the local DB after a lot of activity.

| Scenario | Summary |
| -------- | ------- |
| [6](./details/06-plugin-constraints.md) | Add plugin constraints to a layer |
| [9](./details/09-history-revert.md) | Review project state, history, and recover from a bad apply |
| [14](./details/14-curate-resource-db.md) | Curate and clean up the local resource DB |
| [17](./details/17-migrate-state.md) | Migrate HarnessTap state to a new machine (manual workflow) |
| [18](./details/18-plugin-merge-conflict.md) | Debug committed vs effective Claude plugin settings |
