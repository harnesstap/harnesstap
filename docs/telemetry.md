# Anonymous usage telemetry

HarnessTap CLI and Desktop can send a small set of anonymous product analytics events to the HarnessTap EU PostHog project so install → Cloud connect → plugin apply funnels can be counted.

Capture is **off until you opt in** (Desktop consent modal, CLI config/env, or `HARNESSTAP_TELEMETRY=1`). Events are fire-and-forget with a short timeout. Failures are swallowed and never change command or UI results.

## Consent

### Desktop

On first Desktop start, before any capture, a modal asks you to enable or disable telemetry. The choice is written to `~/.harnesstap/config.jsonc` as `"telemetry": { "enabled": true | false }`. The modal does not appear again unless that preference is removed.

Change later in **Settings → Advanced → Telemetry**.

### CLI

Until `telemetry.enabled` is set (and `HARNESSTAP_TELEMETRY` is unset), CLI does **not** capture. The first CLI invoke prints a one-time warning that explains the scope and how to opt in or out. After you enable telemetry, the first enabled invoke prints a one-time warning with disable instructions.

## Opt out / opt in

Disable (always wins):

```bash
export HARNESSTAP_TELEMETRY=0
```

Or in `~/.harnesstap/config.jsonc`:

```jsonc
{
  "telemetry": { "enabled": false }
}
```

Enable:

```bash
export HARNESSTAP_TELEMETRY=1
```

Or `"telemetry": { "enabled": true }` in `~/.harnesstap/config.jsonc`.

`HARNESSTAP_TELEMETRY=0` overrides an enabled preference. `HARNESSTAP_TELEMETRY=1` enables capture even if the config preference is unset.

## What we track

Event names (do not rename without Analytics):

| Event | When | Properties besides `product`, `app_version`, `os` |
| --- | --- | --- |
| `cli_installed` | First CLI invoke after opt-in | `install_method` (`brew` / `npm` / `bun` / `npx` / `curl` / `unknown`), `version` |
| `cli_first_run` | First CLI invoke after opt-in | `version` |
| `desktop_installed` | First Desktop sidecar start after opt-in | `version`, `os` |
| `desktop_opened` | Each Desktop sidecar start after opt-in | `version` |
| `desktop_first_open` | First Desktop sidecar start after opt-in | `version` |
| `cloud_connect_started` | Device login begins | — |
| `cloud_connected` | Device login succeeds | — |
| `cloud_connect_failed` | Device login fails | `error_code` and/or short `reason` |
| `signed_in` | Same success as `cloud_connected` (web spelling) | — |
| `plugin_installed` | Local/catalog install (not Cloud `plugin_created`) | `source` (`catalog` \| `local` \| `url`) |
| `plugin_applied` | Successful non-dry-run apply | `harness` when known |
| `plugin_used` | CLI `plugin show` or Desktop plugin detail | `harness` when known |

`signed_up` is a Cloud web event. CLI/Desktop device login does not emit it.

Every event also sets `$lib` = `harnesstap` and `$ip` = `null`. A random anonymous `distinct_id` is stored in `~/.harnesstap/telemetry-state.json`.

## What we do not track

No personal data and no resource-related information:

- No names, emails, file paths, code, secrets, tokens, or MCP configs
- No plugin names (`plugin_slug`), plugin contents, or Cloud organization ids (`org_id`)
- No `$identify` / `$create_alias` join to a Cloud user id

## Environment

| Variable | Purpose |
| --- | --- |
| `HARNESSTAP_TELEMETRY` | `0` / `false` / `no` / `off` disables capture. `1` / `true` / `yes` / `on` enables capture |
| `HARNESSTAP_POSTHOG_PROJECT_API_KEY` | Public PostHog project API key. Defaults to the EU project 190845 `phc_` client key. Empty value disables capture |
| `HARNESSTAP_POSTHOG_HOST` | Capture host. Default `https://eu.i.posthog.com` |
| `HARNESSTAP_INSTALL_METHOD` | Optional override for `cli_installed.install_method` |
| `HARNESSTAP_PRODUCT` | Optional `cli` or `desktop` override |

The default project API key is the **public** client key for [EU project 190845](https://eu.posthog.com/project/190845/dashboard/933620). Do not use a personal API key.
