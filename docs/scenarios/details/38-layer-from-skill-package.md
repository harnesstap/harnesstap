# Scenario 38: Create a layer from a skill package

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to configure a reusable layer from a remote skill
package like `dbt-labs/dbt-agent-skills` without applying it to a project yet.

Typical commands:

```bash
# Configure only (no hub install, no layer apply)
harnessdeck layer create dbt-expert \
  --from dbt-labs/dbt-agent-skills \
  --all --exclude-category dbt-migration \
  -d "dbt analytics engineering baseline" -y

# Interactive skill picker (migration skills unchecked by default)
harnessdeck layer create dbt-expert --from dbt-labs/dbt-agent-skills

# Merge new skills into an existing layer
harnessdeck layer create dbt-expert \
  --from dbt-labs/dbt-agent-skills \
  --skill running-dbt-commands \
  --on-conflict merge -y

harnessdeck layer show dbt-expert
```

`layer create --from` imports the package into the HarnessDeck library and
attaches namespaced skill refs to the layer. Use `layer apply` when you are ready
to materialize the layer to a project. Use `--install` only when you also want
skills copied or symlinked into hub paths immediately.

See [Scenario 35](./35-add-skill-package.md) for the lower-level `add` command
and [Scenario 5](./05-build-layer-from-resources.md) for manual layer curation.
