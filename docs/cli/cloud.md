# Connect HarnessDeck CLI to HarnessDeck Cloud

Authenticate with your cloud account, switch organizations, search and install shared layer bundles, and publish your own layers to your team's organization. Remote catalog commands live on **`layer`**; use **`auth`** for authentication and org context.

## Prerequisites

### Current HarnessDeck CLI installation

Install the latest HarnessDeck CLI before connecting it to Cloud.

```bash
npx harnessdeck@latest init
```

### HarnessDeck Cloud account

Sign in with an existing HarnessDeck Cloud account or [create one](/signup) before using private org catalogs.

### Organization access

Join or create at least one organization so you can search, install, and publish shared layers beyond the public catalog.

## Authenticate and switch organizations

### Sign in from the terminal

Start the device flow, sign in with your cloud account, and save a named local account.

```bash
harnessdeck auth login [account] [--base-url <url>]
```

Default account name: `default`. Default base URL: `https://harnessdeck.kayrnt.fr`.

### Confirm the active identity

Check which user and organization the CLI will use before you install or publish layers.

```bash
harnessdeck auth status [--account <name>] [--format human|json]
```

### List and switch organizations

Review the orgs your account can access and switch the active organization for the current account.

```bash
harnessdeck auth orgs [--account <name>] [--switch <slug>]
```

### Clear a local session

Remove a saved local account when you need to re-authenticate or switch accounts.

```bash
harnessdeck auth logout [--account <name>]
```

Cloud accounts are stored in `~/.harnessdeck/cloud-accounts.json` (or under `HARNESSDECK_HOME` when set).

## Search, install, and publish layers

### Search the cloud catalog

Search the shared layer catalog in your active cloud organization to find reusable layers before you install them locally.

```bash
harnessdeck layer search <query> [--account <name>] [--format human|json]
```

### Pull a shared layer locally

Download a published `urn:harnessdeck:layer:v1` export from your organization and import it into the local HarnessDeck database under the original or aliased name.

```bash
harnessdeck layer pull <org>/<layer>[@version] [--as <name>] [--account <name>]
```

`layer pull` is distinct from `layer import` (local file). `layer pull` fails on local name conflict instead of overwriting.

### Apply without a prior pull

For public catalog baselines, you can apply by bare name and let the CLI fetch on demand:

```bash
harnessdeck layer apply engineering-foundation --project . --harness codex
```

Use `layer pull` when you want the bundle cached locally before working offline.

### Publish a local layer

Export a local layer as layer v1 and upload it to your organization's catalog.

```bash
harnessdeck layer catalog register <org>/<catalog>
harnessdeck layer publish <layer> [<org>/<catalog>] [--account <name>]
harnessdeck layer publish plan <layer>
```

Publishes to all registered catalogs by default. Pass `org/catalog` or use `layer catalog bindings` to restrict targets.

## Suggested team workflow

Stay inside the implemented command set: authenticate, inspect or switch organizations, search layers, pull or apply shared layers, and publish local layers when they are ready for teammates.

### 1. Authenticate with Cloud

Start the device flow and save an account for the cloud organization you want to use.

```bash
harnessdeck auth login
```

### 2. Inspect your active identity

Check the authenticated user and current organization before you work with shared layers.

```bash
harnessdeck auth status
```

### 3. Switch organizations when needed

List the organizations your account can reach and switch to the correct one before installing or publishing.

```bash
harnessdeck auth orgs --switch org-slug
```

### 4. Search shared layers

Browse the layer catalog for stacks and workflows your team already maintains.

```bash
harnessdeck layer search react
```

### 5. Apply or pull a shared layer

Apply directly by bare name or org/catalog selector, or pull into the local library first.

```bash
harnessdeck layer apply org/catalog/layer-name --project .
harnessdeck layer pull org/layer-name
```

### 6. Publish a local layer

Share a layer you maintain back to the active organization so teammates can discover it.

```bash
harnessdeck layer publish local-layer
```

## Troubleshooting

### CLI command not found after install

Use `npx harnessdeck@latest <command>` or ensure your global npm bin directory is on `PATH`.

### Authentication fails in headless environment

Use the device-code flow by running `harnessdeck auth login` and following the browser prompt.

### Organization not found

Check your active organization with `harnessdeck auth status` and switch using `harnessdeck auth orgs --switch org-slug`.

### Layer install fails with version conflict

Use the `--as` flag to install the layer under a different local name to avoid conflicts.

## Next steps

- [Compare plans](/pricing)
- [Get started free](/signup)
- [Command reference](/docs/cli/command-reference) — full CLI surface
- [Scenario guides](/docs/cli/scenarios) — workflow walkthroughs
