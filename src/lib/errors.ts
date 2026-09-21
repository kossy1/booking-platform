export class AppError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
    super(message);
  }
}
export class NotFoundError extends AppError {
  constructor(m: string) { super(404, m, 'NOT_FOUND'); }
}
export class ConflictError extends AppError {
  constructor(m: string) { super(409, m, 'CONFLICT'); }
}