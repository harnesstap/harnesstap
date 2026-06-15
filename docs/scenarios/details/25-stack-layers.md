# Scenario 25: Stack multiple layers

**Frequency: Common** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Apply layers in order; later layers override earlier ones for matching resources.

```bash
harnessdeck layer apply team-baseline my-overrides --project .
```

When the stack is already curated as a **deck**, prefer
[`deck apply`](./29-apply-deck.md):

```bash
harnessdeck deck apply team-platform --project .
harnessdeck deck apply team-platform my-overrides --project .
```
