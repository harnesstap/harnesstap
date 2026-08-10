# Connect HarnessTap CLI to HarnessTap Cloud

Authenticate with your cloud account, switch organizations, search and install shared plugin bundles, and publish your own plugins to your team's organization. Remote catalog commands live on **`plugin`**; use **`auth`** for authentication and org context.

## Prerequisites

### Current HarnessTap CLI installation

Install the latest HarnessTap CLI before connecting it to Cloud.

```bash
npx harnesstap@latest init
```

### HarnessTap Cloud account

Sign in with an existing HarnessTap Cloud account or [create one](/signup) before using private org catalogs.

### Organization access

Join or create at least one organization so you can search, install, and publish shared plugins beyond the public catalog.

## Authenticate and switch organizations

### Sign in from the terminal

Start the device flow, sign in with your cloud account, and save a named local account.

```bash
harnesstap auth login [account] [--base-url <url>]
```

Default account name: `default`. Default base URL: `https://harnesstap.com`.

### Confirm the active identity

Check which user and organization the CLI will use before you install or publish plugins.

```bash
harnesstap auth status [--account <name>] [--format human|json]
```

### List and switch organizations

Review the orgs your account can access and switch the active organization for the current account.

```bash
harnesstap auth orgs [--account <name>] [--switch <slug>]
```

### Clear a local session

Remove a saved local account when you need to re-authenticate or switch accounts.

```bash
harnesstap auth logout [--account <name>]
```

Cloud accounts are stored in `~/.harnesstap/cloud-accounts.json` (or under `HARNESSTAP_HOME` when set).

## Search, install, and publish plugins

### Search the cloud catalog

Search the shared plugin catalog in your active cloud organization to find reusable plugins before you install them locally.

```bash
harnesstap plugin list --search <query> --remote-only [--account <name>] [--format human|json]
```

### Pull a shared plugin locally

Download a published `urn:harnesstap:layer:v1` export (schema id still says `layer`) from your organization and import it into the local HarnessTap database under the original or aliased name.

```bash
harnesstap plugin pull <org>/<plugin>[@version] [--as <name>] [--account <name>]
```

`plugin pull` is distinct from `plugin import` (local file). `plugin pull` fails on local name conflict instead of overwriting.

### Apply without a prior pull

For public catalog baselines, you can apply by bare name and let the CLI fetch on demand:

```bash
harnesstap apply engineering-foundation --project . --harness codex
```

Use `plugin pull` when you want the bundle cached locally before working offline.

### Publish a local plugin

Export a local plugin as plugin v1 and upload it to your organization's catalog.

```bash
harnesstap plugin catalog register <org>/<catalog>
harnesstap plugin publish <plugin> [<org>/<catalog>] [--account <name>]
harnesstap plugin publish plan <plugin>
```

Publishes to all registered catalogs by default. Pass `org/catalog` or use `plugin catalog bindings` to restrict targets.

## Suggested team workflow

Stay inside the implemented command set: authenticate, inspect or switch organizations, search plugins, pull or apply shared plugins, and publish local plugins when they are ready for teammates.

### 1. Authenticate with Cloud

Start the device flow and save an account for the cloud organization you want to use.

```bash
harnesstap auth login
```

### 2. Inspect your active identity

Check the authenticated user and current organization before you work with shared plugins.

```bash
harnesstap auth status
```

### 3. Switch organizations when needed

List the organizations your account can reach and switch to the correct one before installing or publishing.

```bash
harnesstap auth orgs --switch org-slug
```

### 4. Search shared plugins

Browse the plugin catalog for stacks and workflows your team already maintains.

```bash
harnesstap plugin list --search react --remote-only
```

### 5. Apply or pull a shared plugin

Apply directly by bare name or org/catalog selector, or pull into the local library first.

```bash
harnesstap apply org/catalog/plugin-name --project .
harnesstap plugin pull org/plugin-name
```

### 6. Publish a local plugin

Share a plugin you maintain back to the active organization so teammates can discover it.

```bash
harnesstap plugin publish local-plugin
```

## Troubleshooting

### CLI command not found after install

Use `npx harnesstap@latest <command>` or ensure your global npm bin directory is on `PATH`.

### Authentication fails in headless environment

Use the device-code flow by running `harnesstap auth login` and following the browser prompt.

### Organization not found

Check your active organization with `harnesstap auth status` and switch using `harnesstap auth orgs --switch org-slug`.

### Plugin install fails with version conflict

Use the `--as` flag to install the plugin under a different local name to avoid conflicts.

## Next steps

- [Compare plans](/pricing)
- [Get started free](/signup)
- [Command reference](/docs/cli/command-reference) — full CLI surface
- [Scenario guides](/docs/cli/scenarios) — workflow walkthroughs
