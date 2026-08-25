import type { ProfileContents } from "./types";

export type ProfileResourceStackKind = "live" | "profile" | "loading";

export interface ResolveProfileResourceStackInput {
  selectedProfile: string | null;
  activeProfile: string | null;
  relativeToActive: boolean;
  previewMatchesSelection: boolean;
  liveContents: ProfileContents | null | undefined;
  targetContents: ProfileContents | null | undefined;
}

export interface ProfileResourceStack {
  kind: ProfileResourceStackKind;
  contents: ProfileContents | null;
}

export function profileStackHasList(
  contents: ProfileContents | null | undefined,
): boolean {
  if (!contents) {
    return false;
  }
  return (
    contents.plugins.length > 0
    || contents.plugin_pins.length > 0
    || contents.resources.length > 0
  );
}

export function resolveProfileResourceStack(
  input: ResolveProfileResourceStackInput,
): ProfileResourceStack {
  if (!input.selectedProfile) {
    return {
      kind: "live",
      contents: input.liveContents ?? null,
    };
  }

  if (!input.previewMatchesSelection) {
    if (input.selectedProfile === input.activeProfile) {
      return {
        kind: "live",
        contents: input.liveContents ?? null,
      };
    }
    return { kind: "loading", contents: null };
  }

  if (input.relativeToActive) {
    return {
      kind: "live",
      contents: input.liveContents ?? null,
    };
  }

  return {
    kind: "profile",
    contents: input.targetContents ?? null,
  };
}
