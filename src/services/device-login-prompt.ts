import { DEVICE_LOGIN_WAITING } from "../copy/cli.js";
import { createProgress, type ProgressHandle } from "../ui/progress.js";
import { isTty } from "../ui/theme.js";

export { DEVICE_LOGIN_WAITING };

export function printDeviceLoginInstructions(input: {
  verificationUri: string;
  userCode: string;
}): ProgressHandle {
  console.log(`Visit: ${input.verificationUri}`);
  console.log(`Code:  ${input.userCode}`);
  if (isTty() && process.env.NODE_ENV !== "test") {
    return createProgress(DEVICE_LOGIN_WAITING);
  }
  console.log(DEVICE_LOGIN_WAITING);
  return {
    succeed() {},
    fail() {},
    stop() {},
    update() {},
  };
}
