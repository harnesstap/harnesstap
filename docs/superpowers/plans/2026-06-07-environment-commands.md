# Environment Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `environment` and layer-environment bridge CLI surface (Phase 1 + Phase 2), including capture/refresh, active pointer workflows, import/export, and project/layer visibility updates.

**Architecture:** Add focused environment services for selector resolution, CRUD mutation orchestration, capture/refresh requirement collection, and import/export serialization. Keep CLI wiring in `src/index.ts` small by delegating behavior to service functions that return structured payloads consumed by existing UI/JSON output patterns. Extend model helpers where needed for reverse references and configured-layer environment bindings while preserving SQLite as canonical mutation store.

**Tech Stack:** TypeScript, Bun, Commander, sqlite, existing HarnessDeck UI primitives.

---

## File Structure

- Modify: `src/index.ts` (register `environment` noun + alias, layer bridge commands, project/layer output enhancements)
- Create: `src/services/environment-selectors.ts` (resolve environment by name/ULID, ambiguity-safe helpers)
- Create: `src/services/environment-command-service.ts` (Phase 1 CRUD + secret refs + bridge operations)
- Create: `src/services/environment-capture.ts` (Phase 2 capture/refresh requirement collection + value resolution)
- Create: `src/services/environment-io.ts` (`environment import|export` transport serializer/parser)
- Modify: `src/models/environment.ts` (reverse-reference helpers, update/remove helpers as needed)
- Modify: `src/models/configured-layer.ts` (set/unset default environment helper)
- Modify: `src/models/deck.ts` (find by root path helper for `environment use --project`)
- Modify: `src/services/environment-cascade.ts` (helpers for `active|resolve` output where needed)
- Test: `test/models/environment.test.ts`
- Create: `test/services/environment-capture.test.ts`
- Create: `test/services/environment-io.test.ts`
- Create: `test/cli/environment.test.ts`
- Modify: `test/cli/layer.test.ts`
- Modify: `test/cli/platforms-status-builtins.test.ts`

### Task 1: Model and selector foundations

**Files:**
- Modify: `src/models/environment.ts`
- Modify: `src/models/configured-layer.ts`
- Modify: `src/models/deck.ts`
- Create: `src/services/environment-selectors.ts`
- Test: `test/models/environment.test.ts`

- [ ] **Step 1: Write failing model tests for environment references and mutation helpers**

```ts
it("lists configured layers referencing an environment", async () => {
  // create env + configured layer bound to it
  // expect listEnvironmentConfiguredLayerRefs(env.id) to include layer name/version
});

it("updates existing env var resource by key in-place", async () => {
  // seed env_var in environment
  // call upsertEnvironmentEnvVar(env.id, "PD_REGION", "us")
  // expect single env_var with updated value
});
```

- [ ] **Step 2: Run targeted model tests and confirm failure**

Run: `bun test test/models/environment.test.ts`
Expected: FAIL with missing helper exports.

- [ ] **Step 3: Implement model helpers and selector service**

```ts
export function listEnvironmentConfiguredLayerRefs(environmentId: string): Array<{
  configured_layer_id: string;
  name: string;
  version: string;
}> { /* SQL join configured_layers */ }

export function setConfiguredLayerDefaultEnvironment(
  configuredLayerId: string,
  environmentId: string | null,
): void { /* UPDATE configured_layers */ }
```

- [ ] **Step 4: Re-run targeted model tests**

Run: `bun test test/models/environment.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/models/environment.ts src/models/configured-layer.ts src/models/deck.ts src/services/environment-selectors.ts test/models/environment.test.ts
git commit -m "feat: add environment reference and selector model helpers"
```

### Task 2: Phase 1 environment and layer bridge services

**Files:**
- Create: `src/services/environment-command-service.ts`
- Modify: `src/models/environment.ts`
- Modify: `src/models/configured-layer.ts`
- Test: `test/cli/environment.test.ts`
- Test: `test/cli/layer.test.ts`

- [ ] **Step 1: Write failing CLI tests for Phase 1 commands**

```ts
it("creates, lists, shows, and deletes environments", async () => {
  const created = await runCli(["environment", "create", "staging"]);
  expect(created.stdout).toContain("Created environment");
});

it("sets and unsets layer default environment", async () => {
  await runCli(["layer", "set-environment", "team-layer", "staging"]);
  const show = await runCli(["layer", "show", "team-layer"]);
  expect(show.stdout).toContain("Default environment");
});
```

- [ ] **Step 2: Run targeted CLI tests and confirm failure**

Run: `bun test test/cli/environment.test.ts test/cli/layer.test.ts`
Expected: FAIL (unknown commands or missing output fields).

- [ ] **Step 3: Implement Phase 1 service operations**

```ts
export function createEnvironmentRecord(input: { name: string; description?: string }) { /* ... */ }
export function setEnvironmentValue(input: { nameOrId: string; vars: string[]; model?: string; permission?: string[] }) { /* ... */ }
export function setLayerDefaultEnvironment(input: { layerSelector: string; environmentSelector: string }) { /* ... */ }
```

- [ ] **Step 4: Wire commands in `src/index.ts`**

```ts
const environmentCmd = configureCommandGroup(
  program.command("environment").alias("e").description("Manage environments"),
);
environmentCmd.command("create").argument("<name>").action(handleEnvironmentCreateCommand);
// ... list/show/delete/set/unset/secret set/secret unset
```

- [ ] **Step 5: Re-run targeted CLI tests**

Run: `bun test test/cli/environment.test.ts test/cli/layer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/services/environment-command-service.ts src/models/environment.ts src/models/configured-layer.ts test/cli/environment.test.ts test/cli/layer.test.ts
git commit -m "feat: implement phase 1 environment and layer bridge commands"
```

### Task 3: Capture/refresh requirement collection and resolution (Phase 2 core)

**Files:**
- Create: `src/services/environment-capture.ts`
- Modify: `src/services/environment-command-service.ts`
- Modify: `src/index.ts`
- Test: `test/services/environment-capture.test.ts`
- Test: `test/cli/environment.test.ts`

- [ ] **Step 1: Write failing unit tests for requirement collection and value resolution priority**

```ts
it("collects required keys from plugin needs and mcp env metadata", () => {
  expect(result.requiredKeys).toEqual(["PD_REGION", "PD_TOKEN"]);
});

it("resolves values in priority order: harness files -> library -> process.env", () => {
  expect(result.values.PD_REGION.source).toBe("harness");
});

it("classifies likely secret process env values as secret refs", () => {
  expect(result.secretRefs.PD_TOKEN).toEqual({ provider: "env", ref: "PD_TOKEN" });
});
```

- [ ] **Step 2: Run service tests and confirm failure**

Run: `bun test test/services/environment-capture.test.ts`
Expected: FAIL with missing capture service.

- [ ] **Step 3: Implement capture/refresh planning + apply functions**

```ts
export function buildEnvironmentCapturePlan(input: {
  projectRoot: string;
  layerSelectors?: string[];
  strict?: boolean;
  includePermissions?: boolean;
}) { /* returns required_keys, values, secret_refs, missing_keys, warnings */ }

export function applyEnvironmentCapture(input: {
  environmentSelector: string;
  mode: "capture" | "refresh";
  plan: EnvironmentCapturePlan;
}) { /* writes env resources + secret refs */ }
```

- [ ] **Step 4: Add CLI commands `environment capture|refresh` with `--dry-run`, `--strict`, `--layers`, `--include-permissions`**

```ts
environmentCmd.command("capture")
  .argument("<name>")
  .requiredOption("--project <path>")
  .option("--strict")
  .option("--dry-run")
  .action(handleEnvironmentCaptureCommand);
```

- [ ] **Step 5: Re-run service + CLI capture tests**

Run: `bun test test/services/environment-capture.test.ts test/cli/environment.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/environment-capture.ts src/services/environment-command-service.ts src/index.ts test/services/environment-capture.test.ts test/cli/environment.test.ts
git commit -m "feat: add scoped environment capture and refresh"
```

### Task 4: Active/use/resolve/import/export workflows (Phase 2 remaining)

**Files:**
- Create: `src/services/environment-io.ts`
- Modify: `src/services/environment-cascade.ts`
- Modify: `src/services/environment-command-service.ts`
- Modify: `src/index.ts`
- Test: `test/services/environment-io.test.ts`
- Test: `test/cli/environment.test.ts`

- [ ] **Step 1: Write failing tests for use/active/resolve/import/export**

```ts
it("sets home active environment and reports cascade in active", async () => {
  await runCli(["environment", "use", "staging"]);
  const active = await runCli(["environment", "active", "--format", "json"]);
  expect(JSON.parse(active.stdout).home.active_environment).toBe("staging");
});

it("exports and imports deck environment JSONC", async () => {
  await runCli(["environment", "export", "staging", "staging.jsonc"]);
  await runCli(["environment", "import", "staging.jsonc"]);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `bun test test/services/environment-io.test.ts test/cli/environment.test.ts`
Expected: FAIL with unimplemented commands/services.

- [ ] **Step 3: Implement environment transport service and use/active/resolve behavior**

```ts
export function exportEnvironmentToJsonc(environmentSelector: string): string { /* values + secret_refs */ }
export function importEnvironmentFromJsonc(filePath: string): { environment: Environment; counts: {...} } { /* upsert */ }
export function setActiveEnvironmentPointer(input: { name: string; projectRoot?: string; reapply?: boolean }) { /* home/deck */ }
```

- [ ] **Step 4: Wire CLI commands and `--reapply` opt-in**

```ts
environmentCmd.command("use").argument("<name>").option("--project <path>").option("--reapply");
environmentCmd.command("active").option("--project <path>").option("--format <mode>", "Output format: human or json", "human");
environmentCmd.command("resolve").option("--layers <layers...>").option("--project <path>");
environmentCmd.command("import").argument("<file>");
environmentCmd.command("export").argument("<name>").argument("[file]");
```

- [ ] **Step 5: Re-run targeted tests**

Run: `bun test test/services/environment-io.test.ts test/cli/environment.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/environment-io.ts src/services/environment-cascade.ts src/services/environment-command-service.ts src/index.ts test/services/environment-io.test.ts test/cli/environment.test.ts
git commit -m "feat: add environment use, resolve, and transport commands"
```

### Task 5: Project/layer status output enhancements

**Files:**
- Modify: `src/index.ts`
- Test: `test/cli/platforms-status-builtins.test.ts`
- Test: `test/cli/layer.test.ts`

- [ ] **Step 1: Write failing tests for output enhancements**

```ts
it("project status shows environment cascade tiers", async () => {
  const status = await runCli(["project", "status", projectDir]);
  expect(status.stdout).toContain("Environment cascade");
});

it("layer show prints default environment when set", async () => {
  expect(show.stdout).toContain("Default environment");
});
```

- [ ] **Step 2: Run targeted output tests and confirm failure**

Run: `bun test test/cli/platforms-status-builtins.test.ts test/cli/layer.test.ts`
Expected: FAIL because new rows/sections absent.

- [ ] **Step 3: Add status/show enhancements**

```ts
rows.push(["Default environment", configuredLayerEnvironmentName ?? "—"]);
rows.push(["Environment cascade", "home ◂ layer default ◂ deck active"]);
```

- [ ] **Step 4: Re-run targeted output tests**

Run: `bun test test/cli/platforms-status-builtins.test.ts test/cli/layer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/cli/platforms-status-builtins.test.ts test/cli/layer.test.ts
git commit -m "feat: surface environment cascade in layer and project status"
```

### Task 6: Full verification and polish

**Files:**
- Modify: any touched files for fixes discovered by lint/type/test/build.

- [ ] **Step 1: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run tests**

Run: `bun run test:run`
Expected: PASS

- [ ] **Step 4: Run build**

Run: `bun run build`
Expected: PASS

- [ ] **Step 5: Commit any final mechanical fixes**

```bash
git add -A
git commit -m "chore: finalize environment command implementation checks"
```

## Self-review

### Spec coverage
- Phase 1 commands covered in Task 2 and layer bridge/output in Tasks 2 + 5.
- Phase 2 capture/refresh scoping, strict mode, source priority, and secret heuristic covered in Task 3.
- Phase 2 use/active/resolve/import/export and `--reapply` covered in Task 4.
- Project status cascade display covered in Task 5.
- Phase 3 (`environment doctor`, full `deck` noun, apply override) intentionally excluded.

### Placeholder scan
- No `TODO` placeholders remain; all tasks include concrete files and commands.

### Type consistency
- Uses existing terms consistently: `environment`, `configured layer`, `default_environment_id`, `active_environment`.
