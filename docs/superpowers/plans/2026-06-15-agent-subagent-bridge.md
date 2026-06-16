# Agent / subagent cross-harness bridge implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize agent resources into a canonical model and emit valid native subagent files for Codex (TOML), Claude Code, Cursor, OpenCode, and Copilot.

**Architecture:** Add pure `agent-bridge.ts` parse/emit helpers; wire Codex, Claude, Cursor, Copilot, OpenCode, generic serializers and plugin import to normalize on scan and emit on serialize. Preserve unknown host keys in `metadata.extra`.

**Tech Stack:** TypeScript, Bun test, `smol-toml`, `gray-matter` (via existing `BaseSerializer` frontmatter helpers)

**Spec:** [2026-06-15-agent-subagent-bridge-design.md](../specs/2026-06-15-agent-subagent-bridge-design.md)

---

## File map

| File | Responsibility |
| ---- | -------------- |
| `src/types.ts` | Extend `AgentMetadata` |
| `src/services/agent-bridge.ts` | **New** — canonical parse/emit |
| `test/services/agent-bridge.test.ts` | **New** — unit tests |
| `src/platforms/codex.ts` | Scan/serialize via bridge |
| `src/platforms/claude-code.ts` | Scan via bridge; serialize already partial |
| `src/platforms/cursor.ts` | Add agent scan + serialize |
| `src/platforms/copilot.ts` | Add agent scan + serialize |
| `src/platforms/opencode.ts` | Normalize agents on scan/serialize |
| `src/platforms/generic-agents.ts` | Normalize agents on scan/serialize |
| `src/services/plugin-source-import.ts` | Import `agents/*.toml` |
| `test/platforms/codex.test.ts` | Structured + cross-format cases |
| `test/platforms/cursor.test.ts` | **New or extend** agent cases |
| `test/platforms/copilot.test.ts` | Agent scan/serialize |
| `test/services/plugin-source-import.test.ts` | `.toml` agent import |
| `test/integration/agent-portability.test.ts` | **New** cross-harness apply |
| `docs/supported-harnesses.md` | Agent bridging notes |
| `docs/portability-limits.md` | Fidelity matrix row for agents |

---

### Task 1: Extend AgentMetadata

**Files:**
- Modify: `src/types.ts`
- Test: `test/services/agent-bridge.test.ts` (types compile via usage)

- [ ] **Step 1: Extend interface**

```typescript
export interface AgentMetadata {
  model?: string;
  reasoning_effort?: string;
  sandbox_mode?: string;
  readonly?: boolean;
  is_background?: boolean;
  extra?: Record<string, unknown>;
  wire_format?: "codex-toml" | "markdown-frontmatter" | "markdown-body";
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun run check` or `bun test test/services/agent-bridge.test.ts` (after Task 2 creates file)

---

### Task 2: agent-bridge core (TDD)

**Files:**
- Create: `src/services/agent-bridge.ts`
- Create: `test/services/agent-bridge.test.ts`

- [ ] **Step 1: Write failing tests for Codex TOML**

```typescript
import { describe, expect, it } from "bun:test";
import { parseCodexAgentToml, emitCodexAgentToml } from "../../src/services/agent-bridge.ts";

const API_DESIGNER = `name = "api-designer"
description = "Use when a task needs API contract design."
model = "gpt-5.4"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
Design APIs as long-lived contracts.
"""
`;

describe("parseCodexAgentToml", () => {
  it("extracts canonical fields", () => {
    const agent = parseCodexAgentToml(API_DESIGNER);
    expect(agent).toEqual({
      name: "api-designer",
      description: "Use when a task needs API contract design.",
      instructions: "Design APIs as long-lived contracts.\n",
      metadata: {
        model: "gpt-5.4",
        reasoning_effort: "high",
        sandbox_mode: "read-only",
        wire_format: "codex-toml",
      },
    });
  });
});

describe("emitCodexAgentToml", () => {
  it("round-trips api-designer shape", () => {
    const parsed = parseCodexAgentToml(API_DESIGNER);
    if (!parsed) throw new Error("parse failed");
    const emitted = emitCodexAgentToml(parsed);
    const again = parseCodexAgentToml(emitted);
    expect(again).toEqual(parsed);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test test/services/agent-bridge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parseCodexAgentToml / emitCodexAgentToml**

Use `smol-toml` `parse` / `stringify`. Known keys: `name`, `description`, `model`, `model_reasoning_effort`, `sandbox_mode`, `developer_instructions`. Remaining keys → `metadata.extra`.

```typescript
import { parse, stringify } from "smol-toml";
import type { AgentMetadata } from "../types.js";

export interface CanonicalAgent {
  name: string;
  description: string;
  instructions: string;
  metadata: AgentMetadata;
}

const CODEX_KNOWN = new Set([
  "name", "description", "model", "model_reasoning_effort",
  "sandbox_mode", "developer_instructions",
]);

export function parseCodexAgentToml(raw: string): CanonicalAgent | undefined {
  let doc: Record<string, unknown>;
  try {
    const parsed = parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    doc = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const name = typeof doc.name === "string" ? doc.name : "";
  if (!name) return undefined;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!CODEX_KNOWN.has(key)) extra[key] = value;
  }
  return {
    name,
    description: typeof doc.description === "string" ? doc.description : "",
    instructions: typeof doc.developer_instructions === "string" ? doc.developer_instructions : "",
    metadata: {
      model: typeof doc.model === "string" ? doc.model : undefined,
      reasoning_effort: typeof doc.model_reasoning_effort === "string" ? doc.model_reasoning_effort : undefined,
      sandbox_mode: typeof doc.sandbox_mode === "string" ? doc.sandbox_mode : undefined,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
      wire_format: "codex-toml",
    },
  };
}

export function emitCodexAgentToml(agent: CanonicalAgent): string {
  const doc: Record<string, unknown> = {
    name: agent.name,
    description: agent.description || `Agent ${agent.name}`,
    ...(agent.metadata.model ? { model: agent.metadata.model } : {}),
    ...(agent.metadata.reasoning_effort ? { model_reasoning_effort: agent.metadata.reasoning_effort } : {}),
    ...(agent.metadata.sandbox_mode ? { sandbox_mode: agent.metadata.sandbox_mode } : {}),
    developer_instructions: agent.instructions,
    ...agent.metadata.extra,
  };
  return stringify(doc);
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bun test test/services/agent-bridge.test.ts`

---

### Task 3: Markdown agent parse/emit

**Files:**
- Modify: `src/services/agent-bridge.ts`
- Modify: `test/services/agent-bridge.test.ts`

- [ ] **Step 1: Add failing tests for markdown**

```typescript
import { parseMarkdownAgent, emitMarkdownAgent } from "../../src/services/agent-bridge.ts";

const CLAUDE_AGENT = `---
name: release-reviewer
description: Release review specialist
model: claude-sonnet-4-5
reasoning_effort: high
sandbox_mode: workspace-write
---
# Release Reviewer
`;

it("parseMarkdownAgent splits frontmatter and body", () => {
  const agent = parseMarkdownAgent(CLAUDE_AGENT, "ignored.md");
  expect(agent?.name).toBe("release-reviewer");
  expect(agent?.instructions.trim()).toBe("# Release Reviewer");
  expect(agent?.metadata.reasoning_effort).toBe("high");
});

it("emitMarkdownAgent cursor flavor maps sandbox to readonly", () => {
  const agent = parseCodexAgentToml(`name = "x"
description = "d"
sandbox_mode = "read-only"
developer_instructions = "body"
`);
  if (!agent) throw new Error("parse failed");
  const md = emitMarkdownAgent(agent, "cursor");
  expect(md).toContain("readonly: true");
  expect(md).toContain("body");
});
```

- [ ] **Step 2: Implement parseMarkdownAgent / emitMarkdownAgent**

Reuse `gray-matter` directly in `agent-bridge.ts` (top-level import). Map `effort` → `reasoning_effort` on read. Flavors:
- `claude` — emit `reasoning_effort`, `sandbox_mode` if set
- `cursor` — emit `readonly` from `metadata.readonly ?? (sandbox_mode === "read-only")`, `is_background`
- `generic` — `name`, `description` only

- [ ] **Step 3: Add canonicalAgentFromResource / canonicalAgentToResource helpers**

```typescript
export function canonicalAgentFromResource(r: {
  name: string;
  description: string;
  content: string;
  metadata: AgentMetadata;
}): CanonicalAgent {
  return {
    name: r.name,
    description: r.description,
    instructions: r.content,
    metadata: r.metadata,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/services/agent-bridge.test.ts`

---

### Task 4: Codex serializer integration

**Files:**
- Modify: `src/platforms/codex.ts`
- Modify: `test/platforms/codex.test.ts`

- [ ] **Step 1: Failing test — structured scan**

```typescript
it("scans Codex agent TOML into structured resource", async () => {
  const projectDir = createTempDir("codex-agent-structured");
  try {
    writeTextFile(join(projectDir, ".codex", "agents", "api-designer.toml"), API_DESIGNER_SNIPPET);
    const resources = await new CodexSerializer().scan(projectDir);
    const agent = resources.find((r) => r.name === "api-designer");
    expect(agent?.description).toContain("API contract design");
    expect(agent?.content).toContain("long-lived contracts");
    expect((agent?.metadata as AgentMetadata).reasoning_effort).toBe("high");
  } finally {
    cleanupDir(projectDir);
  }
});
```

- [ ] **Step 2: Failing test — emit from markdown-shaped resource**

```typescript
it("serializes canonical agent as valid TOML", async () => {
  const files = await new CodexSerializer().serialize([
    makeResource({
      type: "agent",
      name: "api-designer",
      description: "API specialist",
      content: "Design contracts.",
      metadata: { model: "gpt-5.4", reasoning_effort: "high", sandbox_mode: "read-only" },
    }),
  ], ".");
  const file = files.find((f) => f.path.endsWith("api-designer.toml"));
  expect(file?.content).toContain('developer_instructions = """');
  expect(file?.content).toContain("model_reasoning_effort");
});
```

- [ ] **Step 3: Update codex.ts scan loop**

After reading TOML content, call `parseCodexAgentToml`. On success, push resource with split fields. On failure, keep opaque fallback (backward compat).

- [ ] **Step 4: Update codex.ts serialize loop**

Replace `content: r.content` with `emitCodexAgentToml(canonicalAgentFromResource(r))`.

- [ ] **Step 5: Run tests**

Run: `bun test test/platforms/codex.test.ts`

---

### Task 5: Claude Code scan normalization

**Files:**
- Modify: `src/platforms/claude-code.ts`
- Modify: `test/platforms/claude-code.test.ts`

- [ ] **Step 1: Test scan extracts frontmatter**

- [ ] **Step 2: In scan loop, `parseMarkdownAgent` when `---` present; else opaque**

- [ ] **Step 3: Update serialize to use `emitMarkdownAgent(..., "claude")` instead of inline frontmatter build**

- [ ] **Step 4: Run** `bun test test/platforms/claude-code.test.ts`

---

### Task 6: Cursor agent scan + serialize

**Files:**
- Modify: `src/platforms/cursor.ts`
- Create or modify: `test/platforms/cursor.test.ts`

- [ ] **Step 1: Add scan for `.cursor/agents/*.md`**

- [ ] **Step 2: Add `case "agent"` in serialize switch — `emitMarkdownAgent(..., "cursor")`**

- [ ] **Step 3: Tests for scan + serialize + readonly mapping**

Run: `bun test test/platforms/cursor.test.ts`

---

### Task 7: Copilot agent scan + serialize

**Files:**
- Modify: `src/platforms/copilot.ts`
- Modify: `test/platforms/copilot.test.ts` (create if missing)

- [ ] **Step 1: Scan `.github/agents/*.md` for both copilot platform IDs**

- [ ] **Step 2: Serialize agents to `.github/agents/{name}.md`**

- [ ] **Step 3: Tests**

Run: `bun test test/platforms/copilot.test.ts`

---

### Task 8: OpenCode + generic agents

**Files:**
- Modify: `src/platforms/opencode.ts`
- Modify: `src/platforms/generic-agents.ts`
- Modify: `test/platforms/generic-agents.test.ts`

- [ ] **Step 1: scanAgentsAt — parse frontmatter when present**

- [ ] **Step 2: serialize — `emitMarkdownAgent(..., "generic")` when metadata non-empty**

- [ ] **Step 3: OpenCode agent serialize mirrors generic with body-only fallback**

Run: `bun test test/platforms/generic-agents.test.ts test/platforms/opencode.test.ts`

---

### Task 9: Plugin import `agents/*.toml`

**Files:**
- Modify: `src/services/plugin-source-import.ts`
- Modify: `test/services/plugin-source-import.test.ts`

- [ ] **Step 1: Add fixture `test/fixtures/plugin-import/codex-agents/agents/api-designer.toml`**

- [ ] **Step 2: Extend `scanAgents` to accept `.toml` via `parseCodexAgentToml`**

- [ ] **Step 3: Test plugin scan finds structured agent**

Run: `bun test test/services/plugin-source-import.test.ts`

---

### Task 10: Cross-harness integration test

**Files:**
- Create: `test/integration/agent-portability.test.ts`

- [ ] **Step 1: One canonical agent resource applied via `generateFiles` to codex, claude-code, cursor**

```typescript
it("applies the same agent resource to Codex, Claude, and Cursor", async () => {
  const agent = makeResource({
    type: "agent",
    name: "api-designer",
    description: "API contract design",
    content: "Design long-lived contracts.",
    metadata: {
      model: "gpt-5.4",
      reasoning_effort: "high",
      sandbox_mode: "read-only",
    },
  });
  const codex = await generateFiles([agent], ["codex"], projectDir);
  expect(codex[0].files.find((f) => f.path.endsWith(".toml"))?.content).toContain("developer_instructions");
  const claude = await generateFiles([agent], ["claude-code"], projectDir);
  expect(claude[0].files.find((f) => f.path.includes(".claude/agents/"))?.content).toContain("description:");
  const cursor = await generateFiles([agent], ["cursor"], projectDir);
  expect(cursor[0].files.find((f) => f.path.includes(".cursor/agents/"))?.content).toContain("readonly: true");
});
```

- [ ] **Step 2: Run** `bun test test/integration/agent-portability.test.ts`

---

### Task 11: Documentation

**Files:**
- Modify: `docs/supported-harnesses.md`
- Modify: `docs/portability-limits.md`

- [ ] **Step 1: Add "Agent / subagent bridging" subsection under skill emission or new section**

Note: Codex TOML, Claude/Cursor markdown, cross-harness field mapping, Claude-only fields in `extra`.

- [ ] **Step 2: Update portability matrix — agents row with partial fidelity for `tools`, `mcpServers`**

---

### Task 12: Full verification

- [ ] **Step 1: Run full test suite**

Run: `bun test`

- [ ] **Step 2: Manual smoke (optional)**

```bash
cp /path/to/api-designer.toml .codex/agents/
hd project scan . --dry-run
```

Expected: agent listed with description and structured metadata in DB after real scan.

---

## Execution order

```
Task 1 → 2 → 3 → 4 (Codex) → 5 (Claude) → 6 (Cursor) → 7 (Copilot) → 8 (Generic) → 9 (Plugin) → 10 (Integration) → 11 (Docs) → 12 (Verify)
```

Tasks 6 and 7 can run in parallel after Task 3. Task 4 is the critical path for awesome-codex-subagents adoption.

## Plan self-review (spec coverage)

| Spec requirement | Task |
| ---------------- | ---- |
| Canonical model | 1, 3 |
| Codex TOML parse/emit | 2, 4 |
| Cross-harness apply | 4–8, 10 |
| Plugin `.toml` import | 9 |
| Cursor gap | 6 |
| Copilot gap | 7 |
| Backward compat opaque fallback | 4 Step 3 |
| Docs | 11 |
| Success criteria 1–5 | 4, 6, 9, 10, 12 |
