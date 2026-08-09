import type { E2EIsolation } from "./helpers/isolation.ts";

declare global {
  namespace WebdriverIO {
    interface Browser {
      e2eIsolation: E2EIsolation;
    }
  }
}

export {};
