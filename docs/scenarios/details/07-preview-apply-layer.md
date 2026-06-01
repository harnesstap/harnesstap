# Scenario 7: Preview and apply a layer to one or more target harnesses

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you are ready to materialize a known-good setup into a project.
The dry-run preview is itself a frequent check before a real write.

Typical commands:

```bash
harnessdeck project apply my-setup --project . --platform claude-code,codex,cursor --dry-run
harnessdeck project apply my-setup --project . --platform claude-code,codex,cursor
harnessdeck project status .
```

Plugin-version policy when the layer carries plugin pins:

```bash
harnessdeck project apply my-setup --strict-plugin-versions   # exit 2 on pin violation
harnessdeck project apply my-setup --ignore-plugin-versions   # skip validation
```

Important distinction: `project apply` is still the layer-driven write path
when you want to materialize a known baseline onto disk. If you later want to
sync alias harness outputs from the current on-disk main harness without
re-specifying the layer, use [`harnessdeck project sync`](./27-project-sync.md)
instead.
