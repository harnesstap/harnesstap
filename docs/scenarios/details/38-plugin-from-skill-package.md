# Scenario 38: Create a plugin from a skill package

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to configure a reusable plugin from a remote skill
package like `dbt-labs/dbt-agent-skills` without applying it to a project yet.

Typical commands:

```bash
# Configure only (no hub install, no apply)
harnesstap plugin create dbt-expert \
  --from dbt-labs/dbt-agent-skills \
  --all --exclude-category dbt-migration \
  -d "dbt analytics engineering baseline" -y

# Interactive skill picker (migration skills unchecked by default)
harnesstap plugin create dbt-expert --from dbt-labs/dbt-agent-skills

# Merge new skills into an existing plugin
harnesstap plugin create dbt-expert \
  --from dbt-labs/dbt-agent-skills \
  --skill running-dbt-commands \
  --on-conflict merge -y

harnesstap plugin show dbt-expert
```

`plugin create --from` imports the package into the HarnessTap library and
attaches namespaced skill refs to the plugin. Use `apply` when you are ready
to materialize the plugin to a project. Use `--install` only when you also want
skills copied or symlinked into hub paths immediately.

See [Scenario 35](./35-add-skill-package.md) for the lower-level `add` command
and [Scenario 5](./05-build-plugin-from-resources.md) for manual plugin curation.
