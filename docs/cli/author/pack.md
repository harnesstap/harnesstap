---
description: Pack an apm.yml project into an Agent Plugins 1.0 bundle.
---

# Pack a bundle (Author)

`ht pack` is the producer side of handing a project to a consumer without publishing to a catalog. From a tree that has `apm.yml`, it writes an **Agent Plugins 1.0** package — the same `plugin.json` layout HarnessTap already uses for publish, cut, migrate export, and apply-from-path. There is no second catalog package format and no `--format apm` legacy flag.

```bash
ht pack
ht pack --archive -o ./dist
ht pack --dry-run --verbose
```

## Output

Default output is a directory under `./build/`:

```
build/<name>/
  plugin.json
  agents/
  skills/
  commands/
  hooks/
  apm.lock.yaml
```

`--archive` writes `build/<name>-<version>.zip` (zip only). `-o` changes the output directory.

`plugin.json` is synthesized from `apm.yml` (`name`, `version`, `description`, `author`, `license`, `homepage`, `repository`, `keywords`) unless you already authored one at the project root or under `.github/plugin/`, `.claude-plugin/`, or `.cursor-plugin/`.

The embedded `apm.lock.yaml` carries `pack.bundle_files`: SHA-256 for every packed file except the lockfile itself.

## Source layout

When `.apm/` exists, local primitives are taken from `.apm/agents`, `.apm/skills`, `.apm/commands`, and `.apm/hooks`. Root-level `agents/` / `skills/` / `commands/` / `hooks/` are skipped with a warning. Without `.apm/`, those root directories are pack sources. Root `.mcp.json` (or `mcp.json`) is packed as `mcp.json` regardless of layout.

Dependency files are packed only from lockfile-attested `deployed_files`, never from `apm_modules`. A hash mismatch or a missing attested file fails the pack. Symlinks in the bundle fail the pack. Critical hidden-Unicode (tag characters, bidi overrides, SMP variation selectors) fails the pack; warnings are printed and packing continues.

Bundles are target-agnostic. The consumer's project decides which harness layouts receive files at apply time.

## Consumer

Share the directory or zip. The consumer runs:

```bash
ht apply ./build/my-pkg
ht apply ./dist/my-pkg-1.0.0.zip
```

Apply rehashes every `pack.bundle_files` entry and fails closed on mismatch, extra files, missing files, or symlinks. `plugin.json` is bundle metadata and is never deployed as a harness file.

See also: [Command reference](../command-reference.md), [Plugins](../concepts/plugins.md).
