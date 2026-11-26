import { resourceId, serviceTypes } from '../domain/ride-request.js';
import type { NewRideRequest } from '../domain/ride-request.js';
import { isTraceId, RideHttpError } from './ride-request-errors.js';

export type RideInput = Pick<NewRideRequest, 'pickup' | 'destination' | 'serviceType'>;

function invalid(path: string, code: string, message: string): never {
  throw new RideHttpError(422, [{ path, location: 'body', code, message }]);
}

function object(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(path, 'INVALID_TYPE', 'An object is required.');
  }

  const unknown = Object.keys(value).find((key) => !fields.includes(key));
  if (unknown !== undefined) {
    const token = unknown.replaceAll('~', '~0').replaceAll('/', '~1');
    return invalid(`${path}/${token}`, 'UNEXPECTED_FIELD', 'This field is not accepted.');
  }
  return value as Record<string, unknown>;
}

function boundedNumber(value: unknown, path: string, limit: number): number {
  if (typeof value !== 'number') return invalid(path, 'INVALID_TYPE', 'A number is required.');
  if (!Number.isFinite(value) || Math.abs(value) > limit) {
    return invalid(path, 'OUT_OF_RANGE', `The value must be between -${limit} and ${limit}.`);
  }
  return value;
}

function coordinate(value: unknown, path: string): RideInput['pickup'] {
  const { latitude, longitude } = object(value, path, ['latitude', 'longitude']);
  return {
    latitude: boundedNumber(latitude, `${path}/latitude`, 90),
    longitude: boundedNumber(longitude, `${path}/longitude`, 180),
  };
}

export function readRideInput(body: unknown): RideInput {
  const { pickup, destination, serviceType } = object(body, '', ['pickup', 'destination', 'serviceType']);
  const tier = serviceTypes.find((candidate) => candidate === serviceType);
  if (!tier) return invalid('/serviceType', 'INVALID_VALUE', 'A supported service type is required.');
  return { pickup: coordinate(pickup, '/pickup'), destination: coordinate(destination, '/destination'), serviceType: tier };
}

export function readRideId(value: unknown): string {
  try {
    return resourceId(value, 'id');
  } catch {
    throw new RideHttpError(400, [{
      path: 'id', location: 'path', code: 'INVALID_VALUE',
      message: 'A valid ride request identifier is required.',
    }]);
  }
}

export function readConfirmation(body: unknown): string {
  const { quoteId } = object(body, '', ['quoteId']);
  try {
    return resourceId(quoteId, 'quoteId');
  } catch {
    return invalid('/quoteId', 'INVALID_VALUE', 'A valid quote identifier is required.');
  }
}

export function readIdempotencyKey(value: unknown): string {
  if (isTraceId(value)) return value;
  throw new RideHttpError(400, [{
    path: 'Idempotency-Key', location: 'header', code: 'INVALID_VALUE',
    message: 'An idempotency key of 1 to 64 allowed characters is required.',
  }]);
}

export function readCancellation(body: unknown): string | undefined {
  const { reason } = object(body, '', ['reason']);
  if (reason === undefined) return undefined;
  if (typeof reason !== 'string' || reason.length === 0 || [...reason].length > 250) {
    return invalid('/reason', 'INVALID_VALUE', 'The reason must contain 1 to 250 characters.');
  }
  return reason;
}
