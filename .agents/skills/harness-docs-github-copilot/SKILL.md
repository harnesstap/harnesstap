---
name: harness-docs-github-copilot
description: Use when checking whether HarnessTap is in sync with the official GitHub Copilot docs, changelog, or config schema, or when asked what GitHub Copilot added or changed since the last review. Produces a gap report for the `github-copilot` harness; the harness-docs-sync skill runs it as part of a full sweep.
---

# harness-docs-github-copilot

Compare the official GitHub Copilot documentation with what HarnessTap supports for the `github-copilot` harness and write a gap report. Read-only: do not change product code from this skill.

## Upstream sources

Start here. If a link is dead or moved, find the new official page, use it, and list the replacement under "Source changes" in the report so the next run can update this file.

- Docs: https://docs.github.com/en/copilot
- Changelog: https://github.blog/changelog/label/copilot/
- Repository instructions: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions
- MCP: https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/customize-copilot/extend-copilot-with-tools-and-context/extend-copilot-chat-with-mcp
- Custom agents: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/create-custom-agents
- Agent skills: https://docs.github.com/en/copilot/concepts/customizations/agent-skills

Prefer official vendor pages, the vendor's own repo, and machine-readable schemas over blog posts or third-party summaries.

## HarnessTap implementation

Integration tier: dedicated serializer.

- `src/platforms/registry.ts` (entry `github-copilot`: supported features and paths)
- `src/services/platform-serializers.ts` (serializer dispatch)
- `src/platforms/copilot.ts`
- `test/platforms/copilot.test.ts`
- `docs/supported-harnesses.md` (user-facing mirror of the registry)

The list above can go stale. Refresh it before comparing:

```sh
rg -l '"github-copilot"' src test
```

## Procedure

1. Read `.agents/skills/harness-docs-sync/state.json`. Take `harnesses["github-copilot"]` (`lastReviewed`, `lastSeenVersion`). When present, only review changelog or release entries newer than that date or version, plus any doc page that changed since. When absent, do a full baseline review.
2. Follow the shared steps in `.agents/skills/harness-docs-sync/procedure.md`: collect upstream facts, read the HarnessTap files above, and classify each feature area.
3. Write the report in the format from `.agents/skills/harness-docs-sync/report-format.md` to the report directory given there. Never write reports inside tracked repo paths.
4. Update `harnesses["github-copilot"]` in the state file with today's date, the newest upstream version or release you reviewed (or `null` if the harness publishes none), and any replaced source URLs. Skip this step when the orchestrator runs you; it updates the state file once at the end.
