import { describe, expect, it } from "bun:test";
import {
  formatHookInventoryLabel,
  formatHookInventoryTooltipLines,
  hookCommandShortToken,
  hookInventoryWireFromResource,
  normalizeHookEventName,
} from "../../src/ui/hook-display.ts";

describe("normalizeHookEventName", () => {
  it("PascalCases camelCase and lowercase Claude events", () => {
    expect(normalizeHookEventName("sessionStart")).toBe("SessionStart");
    expect(normalizeHookEventName("preToolUse")).toBe("PreToolUse");
    expect(normalizeHookEventName("UserPromptSubmit")).toBe("UserPromptSubmit");
    expect(normalizeHookEventName("SessionStart")).toBe("SessionStart");
  });

  it("maps separator forms onto known events", () => {
    expect(normalizeHookEventName("session_start")).toBe("SessionStart");
    expect(normalizeHookEventName("pre-tool-use")).toBe("PreToolUse");
    expect(normalizeHookEventName("user prompt submit")).toBe("UserPromptSubmit");
  });
});

describe("hookCommandShortToken", () => {
  it("uses the basename of a script path", () => {
    expect(
      hookCommandShortToken(
        "/Users/christophe/.claude/hooks/ponytail-activate.js",
      ),
    ).toBe("ponytail-activate.js");
    expect(
      hookCommandShortToken(
        "C:\\\\Users\\\\me\\\\.claude\\\\hooks\\\\ripwire-nudge.sh",
      ),
    ).toBe("ripwire-nudge.sh");
    expect(
      hookCommandShortToken("${CLAUDE_PLUGIN_ROOT}/scripts/ripwire-claude-route.sh"),
    ).toBe("ripwire-claude-route.sh");
  });

  it("uses the first argv token for a short command", () => {
    expect(hookCommandShortToken("rtk hook claude")).toBe("rtk");
  });

  it("skips interpreters and uses the script basename", () => {
    expect(
      hookCommandShortToken('node ".claude/skills/impeccable/scripts/hook.mjs"'),
    ).toBe("hook.mjs");
    expect(hookCommandShortToken("bash /opt/hooks/ripwire-nudge.sh --quiet")).toBe(
      "ripwire-nudge.sh",
    );
  });
});

describe("formatHookInventoryLabel", () => {
  it("formats Christophe's settings.json examples", () => {
    expect(
      formatHookInventoryLabel({
        event: "SessionStart",
        script: "~/.claude/hooks/ponytail-activate.js",
      }),
    ).toBe("SessionStart: ponytail-activate.js");
    expect(
      formatHookInventoryLabel({
        event: "PreToolUse",
        script: "/opt/ripwire/ripwire-nudge.sh",
      }),
    ).toBe("PreToolUse: ripwire-nudge.sh");
    expect(
      formatHookInventoryLabel({
        event: "userPromptSubmit",
        script: "hooks/ripwire-claude-route.sh",
      }),
    ).toBe("UserPromptSubmit: ripwire-claude-route.sh");
    expect(
      formatHookInventoryLabel({
        event: "PreToolUse",
        script: "rtk hook claude",
        matcher: "Bash",
        hookType: "command",
      }),
    ).toBe("PreToolUse: rtk");
  });

  it("reads the event from a stored name when metadata event is missing", () => {
    expect(
      formatHookInventoryLabel({
        name: "sessionStart-1",
        script: "ponytail-activate.js",
      }),
    ).toBe("SessionStart: ponytail-activate.js");
  });

  it("keeps the stored name when there is no command to shorten", () => {
    expect(formatHookInventoryLabel({ name: "SessionStart-1" })).toBe(
      "SessionStart-1",
    );
  });
});

describe("formatHookInventoryTooltipLines", () => {
  it("puts matcher, type, and the full command in the tooltip, not the badge", () => {
    const input = {
      event: "PreToolUse",
      script: "rtk hook claude",
      matcher: "Bash",
      hookType: "command",
    };
    expect(formatHookInventoryLabel(input)).toBe("PreToolUse: rtk");
    expect(formatHookInventoryTooltipLines(input)).toEqual([
      "matcher: Bash",
      "type: command",
      "rtk hook claude",
    ]);
  });

  it("omits empty matcher/type and a command that already is the badge token", () => {
    expect(
      formatHookInventoryTooltipLines({
        event: "SessionStart",
        script: "ponytail-activate.js",
      }),
    ).toEqual([]);
  });
});

describe("hookInventoryWireFromResource", () => {
  it("extracts event, script, matcher, and hook_entry type", () => {
    expect(
      hookInventoryWireFromResource({
        type: "hook",
        content: "echo unused",
        metadata: {
          event: "sessionStart",
          script: "~/.claude/hooks/ponytail-activate.js",
          matcher: "Bash",
          hook_entry: { type: "command", command: "echo unused" },
        },
      }),
    ).toEqual({
      event: "sessionStart",
      script: "~/.claude/hooks/ponytail-activate.js",
      matcher: "Bash",
      type: "command",
    });
  });

  it("returns undefined for non-hooks", () => {
    expect(
      hookInventoryWireFromResource({ type: "skill", metadata: {}, content: "" }),
    ).toBeUndefined();
  });
});
