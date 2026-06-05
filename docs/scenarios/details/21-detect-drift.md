# Scenario 21: Detect drift between project files and the last applied layer

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

```bash
harnessdeck project drift --project .
harnessdeck project drift --project . --format json   # exit 1 when drift exists
```
