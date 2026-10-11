# Pending README text

## Catalog and Cloud

<!-- append -->

`plugin list` and `profile list` read the local library by default. Pass `--remote` to include catalog results (local plus catalog). `--remote-only` still lists catalog only. `plugin search` is unchanged.

## docs/cli/command-reference.md > plugin (`l`)

<!-- append -->

`plugin list` lists local plugins by default. Pass `--remote` to include streamed catalog plugins (local plus catalog). `--search` filters the listed sources.

## docs/cli/command-reference.md > profile (`p`)

<!-- append -->

`profile list` lists local profile plugins by default. Pass `--remote` to include catalog profiles with tag=profile.

## docs/cli/interactive-ux.md > `install` — plugin / profile list browser

<!-- append -->

`plugin list` and `profile list` interactive browse lists local plugins. `--remote` adds catalog sections.
