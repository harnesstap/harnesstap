import type { TelemetryProduct } from "./types.js";

let productOverride: TelemetryProduct | undefined;

export function setTelemetryProduct(product: TelemetryProduct): void {
  productOverride = product;
}

export function resetTelemetryProductForTests(): void {
  productOverride = undefined;
}

export function resolveTelemetryProduct(): TelemetryProduct {
  if (productOverride) {
    return productOverride;
  }
  const env = process.env.HARNESSTAP_PRODUCT?.trim().toLowerCase();
  if (env === "cli" || env === "desktop") {
    return env;
  }
  const exe = `${process.argv[1] ?? ""} ${process.execPath}`;
  if (exe.includes("ht-agent")) {
    return "desktop";
  }
  return "cli";
}
