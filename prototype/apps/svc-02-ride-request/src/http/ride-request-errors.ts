import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RideRequestRepositoryError } from '../domain/ride-request-repository.js';

type Trace = Readonly<{ requestId: string; correlationId: string }>;
export type RideResponse = Response<unknown, { trace: Trace; riderId: string; storageFailureStatus?: 503 }>;

type ErrorDetail = Readonly<{
  path: string;
  location: 'body' | 'path' | 'header';
  code: string;
  message: string;
}>;

const errors = {
  400: ['BAD_REQUEST', 'The request is malformed or a parameter is invalid.'],
  401: ['UNAUTHENTICATED', 'A valid access token is required.'],
  403: ['FORBIDDEN', 'The caller lacks permission for this operation.'],
  404: ['NOT_FOUND', 'The requested resource was not found.'],
  409: ['CONFLICT', 'The request conflicts with the current resource state.'],
  422: ['VALIDATION_FAILED', 'The request body failed validation.'],
  500: ['INTERNAL_ERROR', 'An unexpected error occurred.'],
  503: ['SERVICE_UNAVAILABLE', 'A required service is temporarily unavailable.'],
} as const;

const confirmationConflicts = {
  QUOTE_CHANGED: 'The quote changed or expired. Look up the current request before confirming again.',
  IDEMPOTENCY_KEY_REUSED: 'The idempotency key was already used with a different request.',
} as const;

export class RideHttpError extends Error {
  constructor(
    readonly status: keyof typeof errors,
    readonly details?: readonly ErrorDetail[],
    readonly confirmationConflict?: keyof typeof confirmationConflicts,
  ) {
    super(confirmationConflict ? confirmationConflicts[confirmationConflict] : errors[status][1]);
    this.name = 'RideHttpError';
  }
}

export function isTraceId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

export function addRideTrace(request: Request, response: RideResponse, next: NextFunction): void {
  const requestId = randomUUID();
  const supplied = request.get('X-Correlation-ID');
  const invalid = supplied !== undefined && !isTraceId(supplied);
  const correlationId = invalid ? randomUUID() : (supplied ?? randomUUID());
  response.locals.trace = { requestId, correlationId };
  response.set({
    'X-Request-ID': requestId,
    'X-Correlation-ID': correlationId,
    'Cache-Control': 'no-store',
  });

  if (invalid) {
    next(new RideHttpError(400, [{
      path: 'X-Correlation-ID', location: 'header', code: 'INVALID_VALUE',
      message: 'The correlation identifier must contain 1 to 64 allowed characters.',
    }]));
    return;
  }
  next();
}

const jsonErrorTypes = new Set([
  'entity.parse.failed', 'entity.too.large', 'request.aborted', 'request.size.invalid',
  'encoding.unsupported', 'charset.unsupported',
]);

function classify(error: unknown, storageFailureStatus: 500 | 503): RideHttpError {
  if (error instanceof RideHttpError) return error;
  if ((error instanceof URIError && 'status' in error && error.status === 400) ||
      (error instanceof Error && 'type' in error && typeof error.type === 'string' && jsonErrorTypes.has(error.type))) {
    return new RideHttpError(400);
  }
  if (error instanceof RideRequestRepositoryError) {
    switch (error.code) {
      case 'not_found': return new RideHttpError(404);
      case 'conflict': return new RideHttpError(409);
      case 'quote_changed': return new RideHttpError(409, undefined, 'QUOTE_CHANGED');
      case 'idempotency_key_reused': return new RideHttpError(409, undefined, 'IDEMPOTENCY_KEY_REUSED');
      case 'storage_failure': return new RideHttpError(storageFailureStatus);
    }
  }
  return new RideHttpError(500);
}

export function sendRideError(error: unknown, _request: Request, response: RideResponse, next: NextFunction): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  const { status, details, message, confirmationConflict } = classify(error, response.locals.storageFailureStatus ?? 500);
  const code = confirmationConflict ?? errors[status][0];
  if (status === 401) response.set('WWW-Authenticate', 'Bearer');
  response.status(status).json({
    error: { status, code, message, ...response.locals.trace, ...(details ? { details } : {}) },
  });
}
