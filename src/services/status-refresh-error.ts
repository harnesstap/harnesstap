/** Why a status refresh produced no value. Carried to the caller and the log. */
export interface StatusRefreshError {
  message: string;
  stack?: string;
}

export function describeStatusRefreshError(error: unknown): StatusRefreshError {
  if (error instanceof Error) {
    return { message: error.message || error.name || "Error", ...(error.stack ? { stack: error.stack } : {}) };
  }
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    const shaped = error as { message: string; stack?: unknown };
    return { message: shaped.message, ...(typeof shaped.stack === "string" ? { stack: shaped.stack } : {}) };
  }
  return { message: String(error) };
}
