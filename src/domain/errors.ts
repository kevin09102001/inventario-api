export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string, id: string) =>
  new AppError(404, "NOT_FOUND", `${what} '${id}' no existe`);

export const conflict = (code: string, message: string, details?: unknown) =>
  new AppError(409, code, message, details);

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, details);
