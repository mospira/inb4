import type { RuntimeErrorCode } from "./types";

export class RuntimeCommandError extends Error {
  constructor(
    message: string,
    readonly code: RuntimeErrorCode = "unknown"
  ) {
    super(message);
    this.name = "RuntimeCommandError";
  }
}

export function getRuntimeErrorCode(error: unknown): RuntimeErrorCode {
  return error instanceof RuntimeCommandError ? error.code : "unknown";
}

export function getRuntimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected extension error.";
}
