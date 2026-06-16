# Scenario 35: Add a remote skill package

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to install skills from a GitHub repo or local skill
package in one step — similar to `skills add`, but with HarnessDeck library
import and optional layer composition.

Typical commands:

```bash
# Discover skills without installing
harnessdeck add mattpocock/skills --list

# Install selected skills globally (non-interactive)
harnessdeck add mattpocock/skills --skill caveman,tdd --global --yes

# Install all skills and create a reusable layer
harnessdeck add mattpocock/skills --all --global --create-layer mattpocock-skills -y

# Install into the current project
harnessdeck add ./vendor/skills --project . --skill triage --yes
```

The command:

1. Resolves the source (GitHub shorthand, URL, or local path) and clones into
   `~/.harnessdeck/cache/sources/` when remote.
2. Discovers skills recursively under `skills/` or `.agents/skills/`.
3. Imports **all** discovered skills into the HarnessDeck library under a
   source namespace (for example `mattpocock/skills`).
4. Installs the selected subset to the hub at `~/.agents/skills/{name}/` (global)
   or `{project}/.agents/skills/{name}/` (project), with fan-out symlinks to
   each target harness.
5. Optionally creates or updates a layer with namespaced skill refs such as
   `skill:caveman@mattpocock/skills` for downstream `layer apply` workflows.

After install, combine or apply the layer:

```bash
harnessdeck layer show mattpocock-skills
harnessdeck layer apply mattpocock-skills --project .
```

See [Scenario 4](./04-scan-import-repo.md) for adopting an existing project tree
and [Scenario 5](./05-build-layer-from-resources.md) for building layers from
already-imported resources.
