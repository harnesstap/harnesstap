# Scenario 21: Detect drift between project files and the last applied layer

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

```bash
harnessdeck status . --check
harnessdeck status . --check --format json   # exit 1 when drift exists
```
