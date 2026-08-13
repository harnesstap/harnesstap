# HarnessTap VHS demos

These demos are generated from the checked-in tapes in `tapes/`.

## Prerequisites

- `bun`
- `vhs`
- `ffmpeg`
- `ttyd`

## Regenerate

```bash
bun run docs:vhs
bun run docs:vhs -- --scenario 01-existing-repo-adoption
```

Demos run against isolated fixture workspaces (`HARNESSTAP_HOME` / `HOME` wrappers), not contributor home directories. VHS is not part of `bun run preflight`.

## Walkthroughs

| # | Title | Doc |
|---|-------|-----|
| 1 | Adopt HarnessTap in an existing repository | [walkthroughs/01-existing-repo-adoption.md](walkthroughs/01-existing-repo-adoption.md) |
| 7 | Preview and apply a plugin | [walkthroughs/07-preview-apply-plugin.md](walkthroughs/07-preview-apply-plugin.md) |
| 11 | Start from a catalog baseline | [walkthroughs/11-catalog-baseline.md](walkthroughs/11-catalog-baseline.md) |
