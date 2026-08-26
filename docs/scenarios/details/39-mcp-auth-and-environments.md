# Scenario 39: MCP auth, environments, and account switching

**Frequency: Occasional** · **Status: Documented**

[← Back to scenarios index](../scenarios.md)

Use this when you need to switch Slack workspaces, API tokens, or deployment
targets across profiles/plugins — or when OAuth MCP servers do not respond after
an environment switch.

## Quick decision

| You have… | HarnessTap can… |
| --- | --- |
| Bot token / PAT in MCP `env` or `headers` | Switch via `environment use` + re-apply |
| OAuth MCP (browser login in Cursor/Claude) | **Not** switch sessions — re-auth in the host app |

Full reference: **[Environments — MCP authentication limitations](../../cli/concepts/environments.md#mcp-authentication-limitations)**

## Static token workflow (supported)

```bash
# Seed from plugin MCP env keys
ht environment create work --from-plugin my-setup
ht environment edit work --secret SLACK_BOT_TOKEN:keychain:harnesstap/slack-work

ht environment create personal --from-plugin my-setup
ht environment edit personal --secret SLACK_BOT_TOKEN:keychain:harnesstap/slack-personal

# Switch and materialize
ht environment use work
ht profile use "global default" --reapply
# or: ht apply my-setup --project . --harness claude-code,cursor
```

Plugin MCP definitions should use placeholders, not literals:

```json
"env": { "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}" }
```

Verify resolved keys before apply:

```bash
ht environment show work --plugin my-setup
ht profile use "global default" --dry-run
```

## OAuth MCP (host-managed)

After apply, open the target harness and complete OAuth there (Cursor MCP panel,
`claude mcp`, Copilot `/mcp auth`, etc.). HarnessTap only writes server URL /
transport — not OAuth tokens.

## Known gaps

- **Shipped:** Cursor MCP scan/emit and HTTP `headers` round-trip (via `mcp-config-bridge`).
- **OAuth sessions:** Browser OAuth tokens remain host-managed — environment switch does not re-auth for you.

Remaining limitations: [Known gaps and fix plan](../../cli/concepts/environments.md#known-gaps-and-fix-plan).

Related: [Portability limits](../../portability-limits.md#mcp-authentication-and-environments),
[Scenario 36](./36-switch-profile.md).
