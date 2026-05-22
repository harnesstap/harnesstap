# Scenario 8: Audit plugin inventory and lifecycle

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

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
