# Scenario 5: Build a reusable plugin from imported resources

**Frequency: Occasional** · **Status: Shipped**

[← Back to scenarios index](../scenarios.md)

Use this when you want to turn a working repository setup into a named,
reusable harness baseline.

Typical commands:

```bash
harnesstap plugin create my-setup --description "Shared project assistant setup"
harnesstap resource list --search auth        # find what to add
harnesstap plugin edit my-setup --add auth-helper --type skill
harnesstap plugin show my-setup
```

`plugin edit` is for local resources and plugin pins. `plugin pull` installs a
plugin from the remote catalog instead — do not confuse the two.

This is where HarnessTap becomes useful as a setup optimizer rather than just
a scanner: you can separate reusable instructions, skills, hooks, MCP config,
and other resources from one project and re-apply them elsewhere in a
controlled way.
