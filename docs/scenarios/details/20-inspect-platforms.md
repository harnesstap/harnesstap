# Scenario 20: Inspect supported platforms before targeting

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when planning which harnesses to use as main and aliases, or when
an unfamiliar harness ID appears in someone else's layer.

Typical commands:

```bash
harnessdeck platform list
harnessdeck platform list --format json | jq '.[] | {id, supports}'
```

The registry is the source of truth for the 30+ harness IDs that HarnessDeck
understands today, and tells you which feature surfaces (instructions,
skills, rules, MCP, hooks, agents, commands, …) each harness supports.

---

## Rare

These matter when requirements are strict, when something went wrong, or
when maintaining the local DB after a lot of activity.
