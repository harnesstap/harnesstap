# Scenario 13: Choose a materialization strategy (symlink vs copy)

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you need to decide whether a project's alias harness outputs
are written as **symlinks** (atomic, always in sync with the main reference)
or **copies** (independent files that can be committed and reviewed).

Typical commands:

```bash
harnesstap harness project set --project . --materialization-strategy symlink-preferred
harnesstap harness project set --project . --materialization-strategy copy
harnesstap harness project status --project .
```

When to choose which:

- **`symlink-preferred`** is right when you want one source of truth on disk
  and the OS supports symlinks. Aliases stay in lockstep with the main
  harness for free.
- **`copy`** is right when alias files need to be **committed and
  code-reviewed independently** (some teams require this), when the
  filesystem does not support symlinks (some Windows setups), or when
  downstream consumers don't follow symlinks.
