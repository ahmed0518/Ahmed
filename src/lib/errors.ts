/**
 * Errors that map to API responses: `{ error, code, ref }` with the HTTP status.
 * `detail` is for the server log only and never reaches a client.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown> | undefined;
  readonly detail: string | undefined;
  readonly retryAfter: number | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { extra?: Record<string, unknown>; detail?: string; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.extra = options.extra;
    this.detail = options.detail;
    this.retryAfter = options.retryAfter;
  }
}

export function badRequest(code: string, message: string, extra?: Record<string, unknown>): AppError {
  return new AppError(400, code, message, { extra });
}

export function unauthorized(code = 'unauthorized'): AppError {
  return new AppError(401, code, 'Authentication required');
}

export function forbidden(code = 'forbidden'): AppError {
  return new AppError(403, code, 'Forbidden');
}

export function notFound(code = 'not_found', message = 'Not found'): AppError {
  return new AppError(404, code, message);
}

export function conflict(): AppError {
  return new AppError(409, 'conflict', 'The order was modified concurrently, try again');
}

export function tooLarge(code: string, message: string): AppError {
  return new AppError(413, code, message);
}

export function unsupportedMediaType(): AppError {
  return new AppError(415, 'unsupported_media_type', 'Content-Type must be application/json');
}

export function tooManyRequests(retryAfter: number): AppError {
  return new AppError(429, 'rate_limited', 'Too many requests', { retryAfter });
}

/** Any Shopify failure that is not throttling. `detail` carries the GraphQL text for the log. */
export class ShopifyRequestError extends AppError {
  constructor(detail: string, options: { operation?: string; requestId?: string | null } = {}) {
    super(502, 'shopify_error', 'Shopify request failed', {
      detail: `${options.operation ?? 'unknown'}: ${detail}${options.requestId ? ` [X-Request-ID ${options.requestId}]` : ''}`,
    });
    this.name = 'ShopifyRequestError';
  }
}

export class ShopifyThrottledError extends AppError {
  constructor(retryAfter: number, operation?: string) {
    super(503, 'shopify_throttled', 'Shopify request failed', {
      retryAfter,
      detail: `${operation ?? 'unknown'}: throttled after retries`,
    });
    this.name = 'ShopifyThrottledError';
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
