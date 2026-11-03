---
name: harness-docs-claude-code
description: Use when checking whether HarnessTap is in sync with the official Claude Code docs, changelog, or config schema, or when asked what Claude Code added or changed since the last review. Produces a gap report for the `claude-code` harness; the harness-docs-sync skill runs it as part of a full sweep.
---

# harness-docs-claude-code

Compare the official Claude Code documentation with what HarnessTap supports for the `claude-code` harness and write a gap report. Read-only: do not change product code from this skill.

## Upstream sources

Start here. If a link is dead or moved, find the new official page, use it, and list the replacement under "Source changes" in the report so the next run can update this file.

- Docs: https://code.claude.com/docs/en/overview
- Changelog: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Settings reference: https://code.claude.com/docs/en/settings
- Settings JSON schema: https://www.schemastore.org/claude-code-settings.json
- MCP: https://code.claude.com/docs/en/mcp
- Hooks: https://code.claude.com/docs/en/hooks
- Memory / CLAUDE.md / rules: https://code.claude.com/docs/en/memory
- Skills: https://code.claude.com/docs/en/skills
- Subagents: https://code.claude.com/docs/en/sub-agents
- Slash commands: https://code.claude.com/docs/en/slash-commands
- Plugins reference: https://code.claude.com/docs/en/plugins-reference

Prefer official vendor pages, the vendor's own repo, and machine-readable schemas over blog posts or third-party summaries.

## HarnessTap implementation

Integration tier: dedicated serializer.

- `src/platforms/registry.ts` (entry `claude-code`: supported features and paths)
- `src/services/platform-serializers.ts` (serializer dispatch)
- `src/platforms/claude-code.ts`
- `src/platforms/claude-plugin-extensions.ts`
- `src/services/claude-local-mcp.ts`
- `src/services/claude-marketplace-bootstrap.ts`
- `src/services/hook-serialization.ts`
- `src/services/host-native-mcp.ts`
- `test/platforms/claude-code.test.ts`
- `test/platforms/claude-plugin-extensions.test.ts`
- `docs/supported-harnesses.md` (user-facing mirror of the registry)

The list above can go stale. Refresh it before comparing:

```sh
rg -l '"claude-code"' src test
```

## Procedure

1. Read `.agents/skills/harness-docs-sync/state.json`. Take `harnesses["claude-code"]` (`lastReviewed`, `lastSeenVersion`). When present, only review changelog or release entries newer than that date or version, plus any doc page that changed since. When absent, do a full baseline review.
2. Follow the shared steps in `.agents/skills/harness-docs-sync/procedure.md`: collect upstream facts, read the HarnessTap files above, and classify each feature area.
3. Write the report in the format from `.agents/skills/harness-docs-sync/report-format.md` to the report directory given there. Never write reports inside tracked repo paths.
4. Update `harnesses["claude-code"]` in the state file with today's date, the newest upstream version or release you reviewed (or `null` if the harness publishes none), and any replaced source URLs. Skip this step when the orchestrator runs you; it updates the state file once at the end.
