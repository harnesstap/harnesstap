import { Command } from "commander";
import {
  hasKeptHostPluginViewFiles,
  setHostPluginViewForceReplace,
} from "../services/package-cache/host-plugin-view-policy.js";
import { configureProgramHelp } from "./help.js";

export const program = new Command();

program.exitOverride();
program.hook("preAction", (_root, actionCommand) => {
  process.exitCode = 0;
  // A host plugin refresh replaces files HarnessTap did not write only with
  // --force-remove (or when the user agrees after the command).
  setHostPluginViewForceReplace(actionCommand.opts().forceRemove === true);
});
program.hook("postAction", async (_root, actionCommand) => {
  if (!hasKeptHostPluginViewFiles()) return;
  const { settleKeptHostPluginViewFiles } = await import("./handlers/host-plugin-view-kept.js");
  await settleKeptHostPluginViewFiles({ json: actionCommand.opts().format === "json" });
});

configureProgramHelp(program);
