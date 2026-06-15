# Scenario 7: Preview and apply a layer to one or more target harnesses

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you are ready to materialize a known-good setup into a project.
The dry-run preview is itself a frequent check before a real write.

Typical commands:

```bash
harnessdeck layer apply my-setup --project . --harness claude-code,codex,cursor --dry-run
harnessdeck layer apply my-setup --project . --harness claude-code,codex,cursor
harnessdeck project status .
```

Plugin-version policy when the layer carries plugin pins:

```bash
harnessdeck layer apply my-setup --strict-plugin-versions   # exit 2 on pin violation
harnessdeck layer apply my-setup --ignore-plugin-versions   # skip validation
```

`layer apply` is the canonical write path for one or more layers. For a
pre-curated stack stored as a deck, use [`deck apply`](./29-apply-deck.md)
instead.

Important distinction: applying a layer writes a known baseline onto disk. If
you later want to sync alias harness outputs from the current on-disk main
harness without re-specifying the layer, use
[`harnessdeck project mirror`](./27-project-sync.md) instead.

`project apply` still works as a deprecated alias for `layer apply`.
