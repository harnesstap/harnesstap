import { ClaudeCodeSerializer } from "../platforms/claude-code.js";
import { CursorSerializer } from "../platforms/cursor.js";
import { CodexSerializer } from "../platforms/codex.js";
import { GooseSerializer } from "../platforms/goose.js";
import { OpenCodeSerializer } from "../platforms/opencode.js";
import { CopilotSerializer } from "../platforms/copilot.js";
import { GeminiCliSerializer } from "../platforms/gemini-cli.js";
import { GrokBuildSerializer } from "../platforms/grok-build.js";
import { DeepSeekHarnessSerializer } from "../platforms/deepseek-harness.js";
import { MuseCodeSerializer } from "../platforms/muse-code.js";
import { GenericAgentsSerializer } from "../platforms/generic-agents.js";
import type { PlatformSerializer } from "../types.js";

export const DEDICATED_SERIALIZER_PLATFORM_IDS = [
  "claude-code",
  "cursor",
  "codex",
  "goose",
  "opencode",
  "github-copilot",
  "copilot-cli",
  "gemini-cli",
  "grok-build",
  "deepseek-harness",
  "muse-code",
] as const;

const dedicatedSerializerPlatformIds = new Set<string>(
  DEDICATED_SERIALIZER_PLATFORM_IDS,
);

export function getDedicatedSerializerPlatformIds(): string[] {
  return [...DEDICATED_SERIALIZER_PLATFORM_IDS];
}

export function getPlatformSerializer(platformId: string): PlatformSerializer {
  switch (platformId) {
    case "claude-code":
      return new ClaudeCodeSerializer();
    case "cursor":
      return new CursorSerializer();
    case "codex":
      return new CodexSerializer();
    case "goose":
      return new GooseSerializer();
    case "opencode":
      return new OpenCodeSerializer();
    case "github-copilot":
      return new CopilotSerializer("github-copilot");
    case "copilot-cli":
      return new CopilotSerializer("copilot-cli");
    case "gemini-cli":
      return new GeminiCliSerializer();
    case "grok-build":
      return new GrokBuildSerializer();
    case "deepseek-harness":
      return new DeepSeekHarnessSerializer();
    case "muse-code":
      return new MuseCodeSerializer();
    default:
      return new GenericAgentsSerializer(platformId);
  }
}

export function hasDedicatedPlatformSerializer(platformId: string): boolean {
  return dedicatedSerializerPlatformIds.has(platformId);
}
