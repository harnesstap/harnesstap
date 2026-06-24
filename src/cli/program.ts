import { Command } from "commander";
import { closeDb } from "../db/connection.js";
import { configureProgramHelp } from "./help.js";

export const program = new Command();

program.exitOverride();
program.hook("preAction", () => {
  process.exitCode = 0;
});

configureProgramHelp(program);

process.on("exit", () => closeDb());
