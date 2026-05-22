# Scenario 5: Build a reusable preset from imported resources

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to turn a working repository setup into a named,
reusable harness baseline.

Typical commands:

```bash
harnessdeck preset create my-setup --description "Shared project assistant setup"
harnessdeck resource list --search auth        # find what to add
harnessdeck preset add my-setup <resource-name-or-id>
harnessdeck preset show my-setup
```

This is where HarnessDeck becomes useful as a setup optimizer rather than just
a scanner: you can separate reusable instructions, skills, hooks, MCP config,
and other resources from one project and re-apply them elsewhere in a
controlled way.
