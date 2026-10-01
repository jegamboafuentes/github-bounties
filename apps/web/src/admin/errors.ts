export class AdminError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AdminError";
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

export function isAdminError(err: unknown): err is AdminError {
  return err instanceof AdminError;
}
