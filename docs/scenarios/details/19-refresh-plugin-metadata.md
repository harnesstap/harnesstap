# Scenario 19: Refresh stale plugin metadata

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when a plugin marketplace or git source has new versions you cannot
see yet because HarnessDeck cached metadata.

Typical commands:

```bash
harnessdeck plugin refresh
harnessdeck plugin check --refresh
```

Configure refresh cadence in `~/.harnessdeck/config.json`:

```json
{
  "plugins": {
    "refreshMaxAgeHours": 24
  }
}
```

Without `--refresh`, HarnessDeck uses cached metadata unless it is older than
`refreshMaxAgeHours`.
