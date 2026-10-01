export class AdminError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AdminError";
    this.status = status;
    this.code = code;
  }
}

export function isAdminError(err: unknown): err is AdminError {
  return err instanceof AdminError;
}
