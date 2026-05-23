import { status } from "../ui/status.js";

export const log = {
  info: (message: string) => status.info(message),
  success: (message: string) => status.success(message),
  warn: (message: string) => status.warn(message),
  error: (message: string) => status.danger(message),
  dim: (message: string) => status.dim(message),
  table: (data: Record<string, string>[]) => console.table(data),
};
