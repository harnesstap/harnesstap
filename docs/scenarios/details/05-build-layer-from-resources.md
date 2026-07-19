# Scenario 5: Build a reusable layer from imported resources

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to turn a working repository setup into a named,
reusable harness baseline.

Typical commands:

```bash
harnesstap layer create my-setup --description "Shared project assistant setup"
harnesstap resource list --search auth        # find what to add
harnesstap layer edit my-setup --add auth-helper --type skill
harnesstap layer show my-setup
```

`layer edit` is for local resources and plugin pins. `layer pull` installs a
layer from the remote catalog instead — do not confuse the two.

This is where HarnessTap becomes useful as a setup optimizer rather than just
a scanner: you can separate reusable instructions, skills, hooks, MCP config,
and other resources from one project and re-apply them elsewhere in a
controlled way.
