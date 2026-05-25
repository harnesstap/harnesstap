import { homedir } from "node:os";

export function resolveHomeRoot(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}
