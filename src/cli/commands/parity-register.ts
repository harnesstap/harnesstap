import type { Command } from "commander";
import { registerOpenCommand } from "./open.js";
import { registerProfileLiveFileCommands } from "./profile-live-files.js";
import { registerProfilePreviewCommand } from "./profile-preview.js";
import { registerResourceDirectoriesCommand } from "./resource-directories.js";

export function registerParityCommands(root: Command): void {
  registerOpenCommand(root);
}

export function registerProfileParityCommands(profileCmd: Command): void {
  registerProfilePreviewCommand(profileCmd);
  registerProfileLiveFileCommands(profileCmd);
}

export function registerResourceParityCommands(resourceCmd: Command): void {
  registerResourceDirectoriesCommand(resourceCmd);
}
