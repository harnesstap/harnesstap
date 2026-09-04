# Anonymous usage telemetry

HarnessTap CLI and Desktop send a small set of anonymous product analytics events to the HarnessTap EU PostHog project so install → Cloud connect → plugin apply can be joined with Cloud web usage.

Capture is **non-blocking**: events are fire-and-forget with a short timeout. Failures are swallowed and never change command or UI results.

## Opt out

Telemetry is on by default (same stance as public catalog lookups). To disable:

```bash
export HARNESSTAP_TELEMETRY=0
```

Or in `~/.harnesstap/config.jsonc`:

```jsonc
{
  "telemetry": { "enabled": false }
}
```

No secrets, tokens, file contents, or email addresses are included in event properties.

## Identity

A stable anonymous `distinct_id` is stored in `~/.harnesstap/telemetry-state.json`. After a successful Cloud login, the client calls PostHog `$identify` and `$create_alias` with the Cloud user id (never email) so pre-auth CLI/Desktop events can join the Cloud person.

Every event sets `product` (`cli` or `desktop`), `app_version`, and `os`.

## Event names

Do not rename these without Analytics. Exact names:

| Event | When |
| --- | --- |
| `cli_installed` | First CLI invoke. Props: `install_method` (`brew` / `npm` / `bun` / `npx` / `curl` / `unknown`), `version` |
| `cli_first_run` | First CLI invoke. Props: `version` |
| `desktop_installed` | First Desktop sidecar start. Props: `version`, `os` |
| `desktop_opened` | Each Desktop sidecar start. Props: `version` |
| `desktop_first_open` | First Desktop sidecar start. Props: `version` |
| `cloud_connect_started` | Device login begins |
| `cloud_connected` | Device login succeeds. Props: `org_id` when known |
| `cloud_connect_failed` | Device login fails. Props: `error_code` and/or short `reason` |
| `signed_in` | Same success as `cloud_connected` (web spelling) |
| `plugin_installed` | Local/catalog install (not Cloud `plugin_created`). Props: `plugin_slug`, `source` (`catalog` \| `local` \| `url`), `org_id` when known |
| `plugin_applied` | Successful non-dry-run apply. Props: `plugin_slug`, `harness` when known, `org_id` when known |
| `plugin_used` | CLI `plugin show` or Desktop plugin detail. Props: `plugin_slug`, `harness` when known, `org_id` when known |

`signed_up` is a Cloud web event. CLI/Desktop device login does not emit it.

## Environment

| Variable | Purpose |
| --- | --- |
| `HARNESSTAP_TELEMETRY` | `0` / `false` / `no` / `off` disables capture |
| `HARNESSTAP_POSTHOG_PROJECT_API_KEY` | Public PostHog project API key. Defaults to the EU project 190845 `phc_` client key. Empty value disables capture |
| `HARNESSTAP_POSTHOG_HOST` | Capture host. Default `https://eu.i.posthog.com` |
| `HARNESSTAP_INSTALL_METHOD` | Optional override for `cli_installed.install_method` |
| `HARNESSTAP_PRODUCT` | Optional `cli` or `desktop` override |

The default project API key is the **public** client key for [EU project 190845](https://eu.posthog.com/project/190845/dashboard/933620). Do not use a personal API key.
