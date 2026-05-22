# HarnessDeck user scenarios

This document reflects the **current shipped CLI**.

Two corrections matter up front:

- `harnessdeck init` initializes `~/.harnessdeck`, seeds built-in presets, and
  imports supported home-directory defaults. It does **not** currently choose a
  main harness during init — use Scenario 2 immediately after.
- For cross-harness updates without re-specifying a preset name, use
  `harnessdeck project sync` (Scenario P7). Re-applying a preset to selected
  platforms (Scenarios 7 and 15) remains the right path when you want to push a
  known preset baseline onto disk.

## Usage frequency

Frequency describes how often a **typical active user** reaches for a scenario
after HarnessDeck is set up — not how important it is the first time.

| Frequency      | Meaning |
| -------------- | ------- |
| **Common**     | Regular per-repo work: onboarding, adoption, repo-specific prefs, applying presets |
| **Occasional** | Setup, customization, sharing, maintenance, automation, CI integration |
| **Rare**       | Edge cases, team-only constraints, debugging, or recovery after a mistake |

| Scenario | Title | Frequency | Status |
| -------- | ----- | --------- | ------ |
| 7  | Preview and apply a preset                          | Common     | Shipped |
| 11 | Start from a built-in preset                        | Common     | Shipped |
| 4  | Scan and import an existing repo                    | Common     | Shipped |
| 3  | Override harness preferences for one repository     | Common     | Shipped |
| 15 | Apply to a subset of target platforms               | Common     | Shipped |
| 1  | Bootstrap HarnessDeck on a machine                  | Occasional | Shipped |
| 2  | Choose a default main harness and aliases           | Occasional | Shipped |
| 5  | Build a reusable preset from imported resources     | Occasional | Shipped |
| 8  | Audit plugin inventory and lifecycle                | Occasional | Shipped |
| 10 | Export or import a preset bundle                    | Occasional | Shipped |
| 12 | Drive HarnessDeck from scripts or agents            | Occasional | Shipped |
| 13 | Choose a materialization strategy (symlink vs copy) | Occasional | Shipped |
| 16 | Enforce preset and plugin state in CI               | Occasional | Shipped |
| 19 | Refresh stale plugin metadata                       | Occasional | Shipped |
| 20 | Inspect supported platforms before targeting        | Occasional | Shipped |
| 6  | Add plugin constraints to a preset                  | Rare       | Shipped |
| 9  | Review history and recover from a bad apply         | Rare       | Shipped |
| 14 | Curate and clean up the local resource DB           | Rare       | Shipped |
| 17 | Migrate HarnessDeck state to a new machine          | Rare       | Shipped (manual) |
| 18 | Debug a Claude plugin merge conflict                | Rare       | Shipped |
| P1 | Detect drift between project and last applied preset | Occasional | Shipped |
| P2 | Diff two presets                                    | Occasional | Shipped |
| P3 | Validate a preset without writing                   | Occasional | Shipped |
| P4 | Apply a preset directly from a URL                  | Occasional | Shipped |
| P5 | Stack multiple presets                              | Common     | Shipped |
| P6 | Turn a project's current state into a preset        | Common     | Shipped |
| P7 | True cross-harness `project sync`                   | Common     | Shipped |
| P8 | One-command machine migration                       | Rare       | Shipped |

**Status legend**

- **Shipped** — the commands shown in the scenario exist in the current CLI.
- **Shipped (manual)** — achievable today with current commands but as a
  multi-step workflow (see Scenario 17 vs P8).

---

## Extended workflows (P1–P8)

### Scenario P1: Detect drift between project files and the last applied preset

**Frequency: Occasional** · **Status: Shipped**

```bash
harnessdeck project drift --project .
harnessdeck project drift --project . --format json   # exit 1 when drift exists
```

### Scenario P2: Diff two presets

**Frequency: Occasional** · **Status: Shipped**

```bash
harnessdeck preset diff team-baseline my-fork
harnessdeck preset diff team-baseline ./incoming-bundle.harnessdeck.json
```

### Scenario P3: Validate a preset without writing

**Frequency: Occasional** · **Status: Shipped**

```bash
harnessdeck preset validate my-setup
harnessdeck preset validate my-setup --format json
```

### Scenario P4: Apply a preset directly from a URL

**Frequency: Occasional** · **Status: Shipped**

```bash
harnessdeck project apply https://team.example.com/baselines/web.json --project .
```

### Scenario P5: Stack multiple presets

**Frequency: Common** · **Status: Shipped**

```bash
harnessdeck project apply team-baseline my-overrides --project .
```

### Scenario P6: Turn a project's current state into a preset

**Frequency: Common** · **Status: Shipped**

```bash
harnessdeck preset from-project my-setup --project . --description "Inferred from web repo"
```

### Scenario P7: True cross-harness `project sync`

**Frequency: Common** · **Status: Shipped**

```bash
harnessdeck project sync .
harnessdeck project sync . --force-shift-reference codex
harnessdeck project sync . --dry-run
```

### Scenario P8: One-command machine migration

**Frequency: Rare** · **Status: Shipped**

```bash
harnessdeck migrate export ./harnessdeck-state.tar.gz --include-plugins
harnessdeck migrate import ./harnessdeck-state.tar.gz
```

---

## Common

Use these when starting or adopting a repository, applying a preset, or when
one repo needs different harness defaults than your machine-wide setup.

### Scenario 7: Preview and apply a preset to one or more target harnesses

**Frequency: Common** · **Status: Shipped**

Use this when you are ready to materialize a known-good setup into a project.
The dry-run preview is itself a frequent check before a real write.

Typical commands:

```bash
harnessdeck project apply my-setup --project . --platform claude-code,codex,cursor --dry-run
harnessdeck project apply my-setup --project . --platform claude-code,codex,cursor
harnessdeck project status .
```

Plugin-version policy when the preset carries plugin pins:

```bash
harnessdeck project apply my-setup --strict-plugin-versions   # exit 2 on pin violation
harnessdeck project apply my-setup --ignore-plugin-versions   # skip validation
```

Important correction: this is the current CLI's real cross-harness write path.
If you think in terms of "sync", the current product does that by **re-applying
the preset** to the desired platforms, not by running a separate `project sync`
command.

### Scenario 11: Start from a built-in preset instead of building from scratch

**Frequency: Common** · **Status: Shipped**

Use this when you want a fast starting point and only need to tailor it for
your repo afterward.

Typical commands:

```bash
harnessdeck init
harnessdeck preset list
harnessdeck project apply nextjs-fullstack --project . --platform codex
```

This is often the fastest path for a new repo: seed starter presets, apply
one, then scan or extend it with project-specific resources later.

### Scenario 4: Scan an existing repository and import its current harness setup

**Frequency: Common** · **Status: Shipped**

Use this when a repository already contains agent instructions, skills, MCP
config, rules, hooks, or agent files that you want HarnessDeck to manage.

Typical commands:

```bash
harnessdeck project scan . --dry-run                  # preview what would be imported
harnessdeck project scan .
harnessdeck project scan . --platform claude-code     # scope to a single harness
harnessdeck resource list
harnessdeck resource show <resource-name-or-id>
```

This is the normal "adopt an existing repo" workflow. It works well for repos
that already contain files such as `CLAUDE.md`, `AGENTS.md`, `.claude/skills/`,
`.cursor/rules/`, `.codex/config.toml`, and similar harness-specific layouts.

Re-scanning is idempotent within a run: resources deduplicate by `type:name`
before insertion, so running the same scan twice does not create duplicate
records.

### Scenario 3: Override harness preferences for one repository

**Frequency: Common** · **Status: Shipped**

Use this when your global preference is not the right fit for a specific repo.
For example, you may usually author in Claude Code but want one project to use
Codex as the canonical harness.

Typical commands:

```bash
harnessdeck harness project set --project . --main codex --aliases claude-code,cursor
harnessdeck harness project status --project .
```

You can also set `--materialization-strategy symlink-preferred` or `copy` when
the project needs a specific write strategy. See Scenario 13 for the tradeoff.

### Scenario 15: Apply a preset to a subset of target platforms

**Frequency: Common** · **Status: Shipped**

Use this when a repo opts into some harnesses but not others. For example, a
backend repo that supports Claude Code and Codex but never used Cursor.

Typical commands:

```bash
harnessdeck project apply my-setup --project . --platform claude-code,codex --dry-run
harnessdeck project apply my-setup --project . --platform claude-code,codex
```

The `--platform` flag also lets you migrate one harness at a time: apply only
the new target first, verify the result, then add the remaining harnesses on
a follow-up run.

---

## Occasional

Reach for these during initial setup, when curating presets, when sharing
baselines, or when integrating HarnessDeck into tooling.

### Scenario 1: Bootstrap HarnessDeck on a machine and discover existing defaults

**Frequency: Occasional** (typically once per machine) · **Status: Shipped**

Use this when setting up HarnessDeck for the first time on a laptop, dev box,
or CI-like agent environment.

Typical commands:

```bash
harnessdeck init
harnessdeck platform list
harnessdeck preset list
```

What this gives you:

- a local SQLite database under `~/.harnessdeck/harnessdeck.db`
- an optional settings file at `~/.harnessdeck/config.json` (e.g. plugin
  refresh cadence — see Scenario 19)
- built-in starter presets seeded into the database
- imported resources from supported home-directory harness folders when
  present (`~/.claude/`, `~/.codex/`, …)
- a quick view of which harnesses the current release knows how to handle

Follow with Scenario 2 to choose a main harness and alias set — init does not
prompt for that today.

### Scenario 2: Choose a default main harness and alias harnesses

**Frequency: Occasional** (once after init, then when your toolchain changes) · **Status: Shipped**

Use this when you want one harness to be your canonical setup and a few
others to be kept aligned with it.

Typical commands:

```bash
harnessdeck harness set --main claude-code --aliases cursor,codex
harnessdeck harness status
```

Notes:

- `harnessdeck platform list` is the source of truth for valid harness IDs.
- `--interactive` is available, but the non-interactive flag path is the main
  automation-friendly workflow.

### Scenario 5: Build a reusable preset from imported resources

**Frequency: Occasional** · **Status: Shipped**

Use this when you want to turn a working repository setup into a named,
reusable harness baseline.

Typical commands:

```bash
harnessdeck preset create my-setup --description "Shared project assistant setup"
harnessdeck resource list --search auth        # find what to add
harnessdeck preset add my-setup <resource-name-or-id>
harnessdeck preset show my-setup
```

This is where HarnessDeck becomes useful as a setup optimizer rather than just
a scanner: you can separate reusable instructions, skills, hooks, MCP config,
and other resources from one project and re-apply them elsewhere in a
controlled way.

### Scenario 8: Audit plugin inventory and lifecycle

**Frequency: Occasional** · **Status: Shipped**

Use this when you want to understand whether installed plugins match the
setup you expect, or when you want to update stale plugin installs.

There are two distinct surfaces, often confused:

**Inventory** — Claude Code only, project-scoped:

```bash
harnessdeck plugin list .                              # committed vs effective
harnessdeck plugin show formatter@team-marketplace .   # which scope declares it
```

- **Committed** plugins are those declared in the project's
  `.claude/settings.json` (what your team commits).
- **Effective** plugins are the merged result of user, project, and local
  settings — what Claude actually loads.

**Lifecycle** — provider-driven, multi-harness (Claude Code and Cursor today):

```bash
harnessdeck plugin installed                # what providers report
harnessdeck plugin check                    # exit 1 if any outdated
harnessdeck plugin update --all --yes       # update everything outdated
harnessdeck plugin refresh                  # force re-fetch metadata
```

Use **inventory** when chasing *"why is this plugin loaded?"* and
**lifecycle** when chasing *"is this plugin up to date?"*. See Scenario 18
for a focused debug flow when the two surfaces disagree.

### Scenario 10: Export or import a preset as a portable bundle

**Frequency: Occasional** · **Status: Shipped**

Use this when you want to move a harness setup between machines, bootstrap a
new repo quickly, or share a team baseline.

Typical commands:

```bash
harnessdeck preset export my-setup --file ./my-setup.harnessdeck.json
harnessdeck preset export my-setup --file ./team.harnessdeck.json --embed-plugins
harnessdeck preset import ./my-setup.harnessdeck.json
```

This is the main sharing story today. Bundles carry the preset definition
plus its resources, and `--embed-plugins` inlines Claude marketplace-installed
plugin trees so the receiving machine does not need to re-fetch them at apply
time.

### Scenario 12: Drive HarnessDeck from scripts or other agents

**Frequency: Occasional** (often daily in CI, less often for interactive
users) · **Status: Shipped**

Use this when another automation layer needs structured output instead of
human text.

Typical commands:

```bash
harnessdeck init --format json
harnessdeck platform list --format json
harnessdeck resource list --format json
harnessdeck preset show my-setup --format json
harnessdeck project history --project . --format json
harnessdeck project apply my-setup --project . --dry-run --format json
```

**Exit codes worth scripting against**:

- `harnessdeck plugin check` returns **exit code 1** when any plugin is
  outdated.
- `harnessdeck plugin update` returns **exit code 1** when any update fails.
- `harnessdeck project apply --strict-plugin-versions` returns **exit code 2**
  when a pinned plugin's installed version violates its constraint.

This matters for agent-harness optimization because HarnessDeck is not only a
human CLI; it can also be the state and serialization layer that other agents
inspect before deciding how to update a repo's assistant environment.

### Scenario 13: Choose a materialization strategy (symlink vs copy)

**Frequency: Occasional** · **Status: Shipped**

Use this when you need to decide whether a project's alias harness outputs
are written as **symlinks** (atomic, always in sync with the main reference)
or **copies** (independent files that can be committed and reviewed).

Typical commands:

```bash
harnessdeck harness project set --project . --materialization-strategy symlink-preferred
harnessdeck harness project set --project . --materialization-strategy copy
harnessdeck harness project status --project .
```

When to choose which:

- **`symlink-preferred`** is right when you want one source of truth on disk
  and the OS supports symlinks. Aliases stay in lockstep with the main
  harness for free.
- **`copy`** is right when alias files need to be **committed and
  code-reviewed independently** (some teams require this), when the
  filesystem does not support symlinks (some Windows setups), or when
  downstream consumers don't follow symlinks.

### Scenario 16: Enforce preset and plugin state in CI

**Frequency: Occasional** (per-project; in CI it runs on every PR) · **Status: Shipped**

Use this when you want CI to fail if the project drifts away from its preset
or its pinned plugin versions.

Typical commands (each exits non-zero on a problem):

```bash
harnessdeck plugin check --format json
harnessdeck project apply my-setup --project . --dry-run --strict-plugin-versions --format json
```

This pairs naturally with Scenario 12. The `--dry-run` keeps CI from writing
files, while `--strict-plugin-versions` forces failure (exit 2) on a pin
violation. Use `plugin check` exit code 1 as the "plugins are stale" signal
in a separate job or step.

### Scenario 19: Refresh stale plugin metadata

**Frequency: Occasional** · **Status: Shipped**

Use this when a plugin marketplace or git source has new versions you cannot
see yet because HarnessDeck cached metadata.

Typical commands:

```bash
harnessdeck plugin refresh
harnessdeck plugin check --refresh
```

Configure refresh cadence in `~/.harnessdeck/config.json`:

```json
{
  "plugins": {
    "refreshMaxAgeHours": 24
  }
}
```

Without `--refresh`, HarnessDeck uses cached metadata unless it is older than
`refreshMaxAgeHours`.

### Scenario 20: Inspect supported platforms before targeting

**Frequency: Occasional** · **Status: Shipped**

Use this when planning which harnesses to use as main and aliases, or when
an unfamiliar harness ID appears in someone else's preset.

Typical commands:

```bash
harnessdeck platform list
harnessdeck platform list --format json | jq '.[] | {id, supports}'
```

The registry is the source of truth for the 30+ harness IDs that HarnessDeck
understands today, and tells you which feature surfaces (instructions,
skills, rules, MCP, hooks, agents, commands, …) each harness supports.

---

## Rare

These matter when requirements are strict, when something went wrong, or
when maintaining the local DB after a lot of activity.

### Scenario 6: Add plugin constraints to a preset

**Frequency: Rare** · **Status: Shipped**

Use this when your environment depends on Claude plugins and you want the
preset to describe not just files, but also expected plugin versions.

Typical commands:

```bash
harnessdeck preset add-plugin my-setup formatter@team-marketplace --version "^2.1.0"
harnessdeck preset remove-plugin my-setup formatter@team-marketplace
harnessdeck preset show my-setup
```

This is especially useful for team-wide setups where the harness environment
should stay compatible across machines. See Scenario 16 for enforcing the
constraints in CI.

### Scenario 9: Review project state, history, and recover from a bad apply

**Frequency: Rare** · **Status: Shipped**

Use this when a preset write produced files you want to inspect or undo.

Typical commands:

```bash
harnessdeck project status .
harnessdeck project history --project .
harnessdeck project revert <snapshot-id>
```

This is the safety-net workflow. Snapshots are created during `project apply`
**only when the project has a git `origin`** — repos without a remote will
see an empty history and have nothing to revert to. If you need this safety
net for a local-only repo, push to a remote (even a local bare repo) before
applying.

### Scenario 14: Curate and clean up the local resource DB

**Frequency: Rare** · **Status: Shipped**

Use this when months of scans have left the local DB with duplicates, stale
resources from deleted repos, or noisy imports you no longer need.

Typical commands:

```bash
harnessdeck resource list --type skill
harnessdeck resource list --type instruction --search legacy
harnessdeck resource show <id>
harnessdeck resource delete <id>
harnessdeck preset delete <stale-preset-name>
```

Valid `--type` values: `instruction`, `skill`, `rule`, `mcp_server`,
`permission`, `hook`, `agent`, `command`, `env_var`, `model_config`.

### Scenario 17: Migrate HarnessDeck state to a new machine

**Frequency: Rare** · **Status: Shipped (manual workflow — see Scenario P8 for one-command migration)**

Use this when moving setups across laptops or onto a dev box. For a single
archive that includes harness preferences and config, prefer Scenario P8.

Manual workflow with current commands:

```bash
# On the old machine
mkdir -p ./bundles
for p in $(harnessdeck preset list --format json | jq -r '.[].name'); do
  harnessdeck preset export "$p" --file "./bundles/$p.harnessdeck.json" --embed-plugins
done

# Copy ./bundles/ to the new machine, then:
harnessdeck init
for f in ./bundles/*.harnessdeck.json; do
  harnessdeck preset import "$f"
done
harnessdeck harness set --main claude-code --aliases cursor,codex   # restore selection
```

`--embed-plugins` is recommended for portability so the new machine does not
need to re-fetch marketplace plugin trees. This workflow does not currently
carry over harness preferences or `~/.harnessdeck/config.json`; copy those by
hand or use Scenario P8.

### Scenario 18: Debug a Claude plugin merge conflict (committed vs effective)

**Frequency: Rare** · **Status: Shipped**

Use this when `plugin list` shows that the committed plugin set in
`.claude/settings.json` differs from the effective set Claude actually loads.

Typical commands:

```bash
harnessdeck plugin list .
harnessdeck plugin show formatter@team-marketplace .
```

`plugin show` reveals which scope (user, project, local) declares the plugin
and which version wins after the merge. That is usually enough to explain
unexpected behavior like *"I removed this plugin but Claude still loads it"*
— a `~/.claude/settings.json` user-scope entry typically wins over the
project scope.

---

