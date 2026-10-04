/** Structured logs: one JSON object per line, never containing page URLs or personal data. */
type Level = "debug" | "info" | "warn" | "error";

export function createLogger(scope: string) {
  const write = (level: Level, event: string, data: Record<string, unknown> = {}) => {
    const entry = { ts: new Date().toISOString(), level, scope, event, ...data };
    // eslint-disable-next-line no-console
    (level === "debug" ? console.debug : console[level])(JSON.stringify(entry));
  };
  return {
    debug: (event: string, data?: Record<string, unknown>) => write("debug", event, data),
    info: (event: string, data?: Record<string, unknown>) => write("info", event, data),
    warn: (event: string, data?: Record<string, unknown>) => write("warn", event, data),
    error: (event: string, data?: Record<string, unknown>) => write("error", event, data)
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
