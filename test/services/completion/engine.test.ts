import { Command } from "commander";
import { describe, expect, it } from "bun:test";
import {
  parseCompletionContext,
  resolveCompletions,
} from "../../../src/services/completion/engine.js";

function buildProgram(): Command {
  const program = new Command();
  program
    .option("-v, --verbose", "verbose")
    .option("--no-color", "no color")
    .option("--no-interactive", "no interactive")
    .option("--format <mode>", "format");

  const layer = program.command("layer").description("layer");
  layer.command("show").argument("[name]", "name").description("show");
  layer.command("delete").argument("[name]", "name").description("delete");
  layer
    .command("apply")
    .argument("[layers...]", "layers")
    .option("--project <path>", "project")
    .option("--harness <slugs>", "harness")
    .description("apply");
  layer
    .command("pull")
    .argument("[selector]", "selector")
    .option("--account <name>", "account")
    .description("pull");

  const environment = program.command("environment").description("environment");
  environment.command("show").argument("[name]", "name").description("show");

  program
    .command("init")
    .option("--main <slug>", "main harness")
    .option("--aliases <slugs>", "aliases")
    .description("init");

  return program;
}

describe("completion engine", () => {
  const program = buildProgram();

  it("resolves subcommand slot for partial top-level command", async () => {
    const ctx = parseCompletionContext(program, "ht lay");
    expect(ctx.slot).toBe("subcommand");
    expect(ctx.commandPath).toEqual([]);
    expect(ctx.prefix).toBe("lay");

    const candidates = await resolveCompletions(program, ctx);
    expect(candidates.map((entry) => entry.value)).toContain("layer");
  });

  it("resolves positional slot for layer show", async () => {
    const ctx = parseCompletionContext(program, "ht layer show eng");
    expect(ctx.slot).toBe("positional");
    expect(ctx.commandPath).toEqual(["layer", "show"]);
    expect(ctx.positionalIndex).toBe(0);
    expect(ctx.prefix).toBe("eng");
  });

  it("resolves flag slot for partial global flag", async () => {
    const ctx = parseCompletionContext(program, "ht --ver");
    expect(ctx.slot).toBe("flag");
    expect(ctx.prefix).toBe("--ver");

    const candidates = await resolveCompletions(program, ctx);
    expect(candidates.map((entry) => entry.value)).toContain("--verbose");
  });

  it("resolves flag-value slot for init --main", async () => {
    const ctx = parseCompletionContext(program, "ht init --main cur");
    expect(ctx.slot).toBe("flag-value");
    expect(ctx.commandPath).toEqual(["init"]);
    expect(ctx.flag).toBe("main");
    expect(ctx.prefix).toBe("cur");
  });

  it("resolves environment show positional slot", async () => {
    const ctx = parseCompletionContext(program, "ht environment show my");
    expect(ctx.slot).toBe("positional");
    expect(ctx.commandPath).toEqual(["environment", "show"]);
    expect(ctx.positionalIndex).toBe(0);
  });

  it("resolves layer apply positional slot", async () => {
    const ctx = parseCompletionContext(program, "ht layer apply eng");
    expect(ctx.slot).toBe("positional");
    expect(ctx.commandPath).toEqual(["layer", "apply"]);
    expect(ctx.positionalIndex).toBe(0);
  });

  it("resolves positional slot after inline --account=value", async () => {
    const ctx = parseCompletionContext(program, "ht layer pull --account=work eng");
    expect(ctx.slot).toBe("positional");
    expect(ctx.commandPath).toEqual(["layer", "pull"]);
    expect(ctx.positionalIndex).toBe(0);
    expect(ctx.prefix).toBe("eng");
    expect(ctx.account).toBe("work");
  });

  it("resolves flag-value slot for inline --account=partial", async () => {
    const ctx = parseCompletionContext(program, "ht layer pull --account=wo");
    expect(ctx.slot).toBe("flag-value");
    expect(ctx.flag).toBe("account");
    expect(ctx.prefix).toBe("wo");
  });

  it("extracts --account from separate tokens", async () => {
    const ctx = parseCompletionContext(program, "ht layer pull --account work eng");
    expect(ctx.account).toBe("work");
    expect(ctx.slot).toBe("positional");
    expect(ctx.prefix).toBe("eng");
  });
});
