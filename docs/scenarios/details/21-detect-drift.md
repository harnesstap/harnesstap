# Scenario 21: Detect drift between project files and the last applied plugin

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

```bash
harnesstap status . --check
harnesstap status . --check --format json   # exit 1 when drift exists
```
