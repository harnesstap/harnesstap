import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type PluginVarTarget,
  translateMcpMetadata,
  translatePluginVars,
} from "../../../src/services/agent-plugins/plugin-vars.ts";
import type { McpServerMetadata } from "../../../src/types.ts";

const CORE = join(
  import.meta.dirname,
  "../../fixtures/agent-plugins-spec/conformance/agent-plugins-conformance-core/mcp.json",
);

const CONTEXT = {
  root: "/opt/plugins/core",
  dataDir: "/home/me/.harnesstap/plugin-data/core",
};

function walkStrings(value: unknown, visit: (text: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) walkStrings(entry, visit);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) walkStrings(entry, visit);
  }
}

describe("translatePluginVars", () => {
  it("replaces only exact placeholders, once, for each target", () => {
    const document = JSON.parse(readFileSync(CORE, "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const targets: PluginVarTarget[] = ["cursor", "claude-code", "absolute"];
    for (const target of targets) {
      walkStrings(document, (text) => {
        const translated = translatePluginVars(text, target, CONTEXT);
        if (text.includes("${APC_UNKNOWN}")) expect(translated).toContain("${APC_UNKNOWN}");
        if (text.includes("$APC_VALUE")) expect(translated).toContain("$APC_VALUE");
        if (text.includes("${PLUGIN_ROOT_SUFFIX}")) {
          expect(translated).toContain("${PLUGIN_ROOT_SUFFIX}");
        }
        expect(translated).not.toContain("${PLUGIN_ROOT}");
        expect(translated).not.toContain("${PLUGIN_DATA}");
      });
    }

    const sample = "${PLUGIN_ROOT}|${PLUGIN_DATA}|${PLUGIN_ROOT}|${PLUGIN_ROOT_SUFFIX}";
    expect(translatePluginVars(sample, "cursor", CONTEXT)).toBe(
      "${CURSOR_PLUGIN_ROOT}|/home/me/.harnesstap/plugin-data/core|${CURSOR_PLUGIN_ROOT}|${PLUGIN_ROOT_SUFFIX}",
    );
    expect(translatePluginVars(sample, "claude-code", CONTEXT)).toBe(
      "${CLAUDE_PLUGIN_ROOT}|${CLAUDE_PLUGIN_DATA}|${CLAUDE_PLUGIN_ROOT}|${PLUGIN_ROOT_SUFFIX}",
    );
    expect(translatePluginVars(sample, "absolute", CONTEXT)).toBe(
      "/opt/plugins/core|/home/me/.harnesstap/plugin-data/core|/opt/plugins/core|${PLUGIN_ROOT_SUFFIX}",
    );
  });

  it("does not expand a placeholder that appears inside the replacement", () => {
    const translated = translatePluginVars("${PLUGIN_ROOT}", "absolute", {
      root: "${PLUGIN_ROOT}",
      dataDir: "/data",
    });
    expect(translated).toBe("${PLUGIN_ROOT}");
  });

  it("translates conformance server fields and leaves literal args", () => {
    const document = JSON.parse(readFileSync(CORE, "utf8")) as {
      mcpServers: Record<string, {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        headers?: Record<string, string>;
        url?: string;
      }>;
    };
    const meta: McpServerMetadata = {
      transport: "stdio",
      command: document.mcpServers.default?.command,
      args: document.mcpServers.default?.args,
      env: document.mcpServers.default?.env,
      cwd: document.mcpServers.root?.cwd,
    };
    const cursor = translateMcpMetadata(meta, "cursor", CONTEXT);
    expect(cursor.args?.[0]).toBe("${CURSOR_PLUGIN_ROOT}/dist/probe.mjs");
    expect(cursor.args).toContain("${APC_UNKNOWN}");
    expect(cursor.args).toContain("$APC_VALUE");
    expect(cursor.args).toContain("${PLUGIN_ROOT_SUFFIX}");
    expect(cursor.env?.APC_LITERAL).toBe("${APC_UNKNOWN}|$APC_VALUE|${PLUGIN_ROOT_SUFFIX}");
    expect(cursor.env?.APC_EXPANSION).toBe(
      "${CURSOR_PLUGIN_ROOT}|/home/me/.harnesstap/plugin-data/core|${CURSOR_PLUGIN_ROOT}",
    );
    expect(cursor.cwd).toBe("${CURSOR_PLUGIN_ROOT}/probe-workdir");
    expect(meta.cwd).toBe("${PLUGIN_ROOT}/probe-workdir");
  });
});
