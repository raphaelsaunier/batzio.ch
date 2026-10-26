import { interpolate, type TFunction, type Vars } from "@batzio/i18n";

export type ErrorCode =
  | "validation"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "conflict"
  | "locked"
  | "rate_limited"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  validation: 422,
  not_found: 404,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
  locked: 409,
  rate_limited: 429,
  internal: 500,
};

/**
 * Error with a stable code, HTTP status and optional per-field messages. The
 * message is an English template (`{name}` placeholders) so the UI can show
 * it in the user's language; the API returns the interpolated English text.
 */
export class AppError extends Error {
  readonly template: string;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly vars?: Vars,
  ) {
    super(interpolate(message, vars));
    this.template = message;
    this.name = "AppError";
  }

  get status(): number {
    return STATUS[this.code];
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}) } };
  }
}

export function notFound(what = "Record"): AppError {
  return new AppError("not_found", "{what} not found.", undefined, { what });
}

/** The error in the user's language; string variables (labels) are translated too. */
export function errorText(error: AppError, t: TFunction): string {
  const vars = error.vars && Object.fromEntries(Object.entries(error.vars).map(([k, v]) => [k, typeof v === "string" ? t(v) : v]));
  return t(error.template, vars);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) {
    const column = /UNIQUE constraint failed: \w+\.(\w+)/i.exec(message)?.[1];
    return column
      ? new AppError("conflict", "The value for “{column}” is already in use.", { [column]: "Already in use" }, { column })
      : new AppError("conflict", "This record already exists.");
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return new AppError("conflict", "This record is referenced by other records or references a missing record.");
  }
  console.error(error);
  return new AppError("internal", "An unexpected error occurred.");
}
