import { describe, expect, it } from "bun:test";
import { isResourceDefinitionEmpty } from "../../../src/services/plugin-doctor/resource-definition.ts";
import { makeResource } from "../../helpers/resources.ts";

describe("isResourceDefinitionEmpty", () => {
  it("treats whitespace-only content as empty for content-bearing types", () => {
    expect(
      isResourceDefinitionEmpty(makeResource({ type: "instruction", content: "  \n" })),
    ).toBe(true);
    expect(
      isResourceDefinitionEmpty(makeResource({ type: "skill", content: "# Skill\n" })),
    ).toBe(false);
  });

  it("does not treat healthy mcp_server as empty when content is blank", () => {
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "mcp_server",
          content: "",
          metadata: { transport: "stdio", command: "npx" },
        }),
      ),
    ).toBe(false);
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "mcp_server",
          content: "",
          metadata: { transport: "http", url: "https://example.com/mcp" },
        }),
      ),
    ).toBe(false);
  });

  it("treats mcp_server without command or url as empty", () => {
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "mcp_server",
          content: "",
          metadata: { transport: "stdio" },
        }),
      ),
    ).toBe(true);
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "mcp_server",
          content: "",
          metadata: { transport: "stdio", command: "  " },
        }),
      ),
    ).toBe(true);
  });

  it("does not treat permission with action and pattern as empty", () => {
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "permission",
          name: "allow-Bash(jk:*)",
          content: "",
          metadata: { action: "allow", pattern: "Bash(jk:*)" },
        }),
      ),
    ).toBe(false);
  });

  it("treats permission missing action or pattern as empty", () => {
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "permission",
          content: "",
          metadata: { action: "allow", pattern: "" },
        }),
      ),
    ).toBe(true);
  });

  it("requires env_var key and string value (empty string value is complete)", () => {
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "env_var",
          content: "",
          metadata: { key: "TOKEN", value: "" },
        }),
      ),
    ).toBe(false);
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "env_var",
          content: "",
          metadata: { key: "", value: "x" },
        }),
      ),
    ).toBe(true);
  });

  it("requires model_config model", () => {
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "model_config",
          content: "",
          metadata: { model: "gpt-4.1" },
        }),
      ),
    ).toBe(false);
    expect(
      isResourceDefinitionEmpty(
        makeResource({
          type: "model_config",
          content: "",
          metadata: {},
        }),
      ),
    ).toBe(true);
  });
});
