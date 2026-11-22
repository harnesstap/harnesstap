#!/usr/bin/env python3
"""Writes rust/app-inputs/cases.jsonl: workload and error-path cases for
`rust-anything app record --inputs`. Each case brings its own project files."""
import json
from pathlib import Path

TARGETS = "[claude, cursor, codex, copilot, gemini, opencode]"


def project(targets=TARGETS, extra_yaml="", skills=3, unicode=False):
    files = {
        "apm.yml": f'name: demo\nversion: "1.0.0"\ntargets: {targets}\n{extra_yaml}',
    }
    for i in range(1, skills + 1):
        body = f"# Skill {i}\nDo thing {i} with care.\n"
        if unicode:
            body += "Unicode: caf\u00e9 \u2713 \U0001F680 \u0130stanbul \u212a\n"
        files[f".apm/skills/skill-{i}/SKILL.md"] = (
            f"---\nname: skill-{i}\ndescription: Demo skill {i}\n---\n{body}"
        )
    files[".apm/instructions/style.instructions.md"] = (
        '---\ndescription: Style rule\napplyTo: "**/*.ts"\n---\nUse two spaces.\n'
    )
    files[".apm/agents/reviewer.agent.md"] = (
        "---\nname: reviewer\ndescription: Reviews diffs\n---\nYou review diffs.\n"
    )
    return files


MCP_STDIO = (
    "dependencies:\n  mcp:\n    - name: local-fs\n      registry: false\n"
    "      transport: stdio\n      command: npx\n"
    '      args: ["-y", "@modelcontextprotocol/server-filesystem", "."]\n'
)
MCP_REMOTE = (
    "dependencies:\n  mcp:\n    - name: remote-docs\n      registry: false\n"
    "      transport: http\n      url: https://mcp.example.invalid/mcp\n"
)

cases = []


def add(name, args, files=None, stdin=None):
    case = {"name": name, "args": args}
    if files is not None:
        case["files"] = files
    if stdin is not None:
        case["stdin"] = stdin
    cases.append(case)


REPLACE = ["--on-conflict", "replace"]
add("w-apply-6-targets", ["apply", *REPLACE], project(extra_yaml=MCP_STDIO))
add("w-apply-conflict-agents-md", ["apply"], project(extra_yaml=MCP_STDIO))
add("w-apply-dry-run", ["apply", "--dry-run", *REPLACE], project())
add("w-apply-update", ["apply", "--update", *REPLACE], project(extra_yaml=MCP_STDIO))
add("w-apply-force", ["apply", "--force", *REPLACE], project())
add("w-apply-target-cursor", ["apply", "--target", "cursor", *REPLACE], project())
add("w-apply-all", ["apply", "--all", *REPLACE], project())
add("w-apply-remote-mcp", ["apply", *REPLACE], project(extra_yaml=MCP_REMOTE))
add("w-apply-unicode", ["apply", *REPLACE], project(unicode=True))
add("w-apply-target-and-all", ["apply", "--target", "cursor", "--all"], project())
add("w-apply-unknown-target", ["apply", "--target", "nope", *REPLACE], project())
add("w-apply-no-targets", ["apply", *REPLACE], {"apm.yml": 'name: demo\nversion: "1.0.0"\n'})
add("w-apply-bad-yaml", ["apply", *REPLACE], {"apm.yml": "name: [unclosed\n"})
add("w-apply-no-manifest", ["apply", *REPLACE], {"README.md": "empty\n"})
add("w-install", ["install", *REPLACE], project())
add("w-install-dry-run", ["install", "--dry-run"], project())
add("w-compile-cursor-claude", ["compile", "-t", "claude,cursor", *REPLACE], project())
add("w-targets", ["targets"], project())
add("w-targets-json", ["targets", "--json"], project())
add("w-status", ["status"], project())
add("w-init-harnesses", ["init", "--harnesses", "claude-code,cursor,codex"], {})
add("w-init-json", ["init", "--format", "json", "--harnesses", "claude-code"], {})
add("w-init-bad-harness", ["init", "--harnesses", "not-a-harness"], {})
add("w-harness-list", ["harness", "list"], {})
add("w-version", ["--version"], {})
add("w-help", ["--help"], {})
add("w-apply-help", ["apply", "--help"], {})
add("w-unknown-command", ["frobnicate"], {})
add("w-unknown-flag", ["apply", "--nope"], project())
add("w-no-args", [], {})
add("w-lock-export", ["lock", "export"], project())
add("w-pack", ["pack"], project())

out = Path(__file__).with_name("cases.jsonl")
out.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cases), encoding="utf-8")
print(f"wrote {len(cases)} cases to {out}")
