const serviceTypes = ['standard', 'premium', 'xl'] as const;
const statuses = [
  'pending_confirmation', 'searching', 'matched', 'no_driver_found', 'cancelled', 'expired',
] as const;

type ServiceType = typeof serviceTypes[number];
type RideRequestStatus = typeof statuses[number];
type Coordinate = Readonly<{ latitude: number; longitude: number }>;
type Quote = Readonly<{
  id: string;
  fare: Readonly<{ amountMinor: number; currency: string }>;
  etaSeconds: number;
  expiresAt: string;
}>;

export type NewRideRequest = Readonly<{
  id: string;
  riderId: string;
  pickup: Coordinate;
  destination: Coordinate;
  serviceType: ServiceType;
  quote: Quote;
}>;

export type RideRequest = NewRideRequest & Readonly<{
  status: RideRequestStatus;
  createdAt: string;
  updatedAt: string;
  tripId?: string;
  revision: number;
}>;

export type RideRequestTransition =
  | Readonly<{ status: 'searching'; quoteId: string }>
  | Readonly<{ status: 'matched'; tripId?: string }>
  | Readonly<{ status: 'no_driver_found' | 'cancelled' | 'expired' }>;

const transitions: Readonly<Record<RideRequestStatus, readonly RideRequestStatus[]>> = {
  pending_confirmation: ['searching', 'cancelled', 'expired'],
  searching: ['matched', 'no_driver_found', 'cancelled'],
  matched: [],
  no_driver_found: [],
  cancelled: [],
  expired: [],
};

export class RideRequestDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RideRequestDomainError';
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RideRequestDomainError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function resourceId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new RideRequestDomainError(`${field} must be a valid resource identifier.`);
  }
  return value;
}

function boundedNumber(value: unknown, limit: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new RideRequestDomainError(`${field} must be between -${limit} and ${limit}.`);
  }
  return value;
}

function coordinate(value: unknown, field: string): Coordinate {
  const { latitude, longitude } = record(value, field);
  return {
    latitude: boundedNumber(latitude, 90, `${field}.latitude`),
    longitude: boundedNumber(longitude, 180, `${field}.longitude`),
  };
}

export function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RideRequestDomainError(`${field} must be a nonnegative safe integer.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new RideRequestDomainError(`${field} must be an ISO 8601 timestamp with a timezone.`);
  }
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day ||
      Number(value.slice(11, 13)) > 23) {
    throw new RideRequestDomainError(`${field} must represent a valid date and time.`);
  }
  return value;
}

function fromClock(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new RideRequestDomainError('The request clock must provide a valid date.');
  }
  return now.toISOString();
}

function quoteSnapshot(value: unknown): Quote {
  const quote = record(value, 'quote');
  const fare = record(quote.fare, 'quote.fare');
  if (typeof fare.currency !== 'string' || !/^[A-Z]{3}$/.test(fare.currency)) {
    throw new RideRequestDomainError('quote.fare.currency must be an uppercase three-letter currency code.');
  }

  return {
    id: resourceId(quote.id, 'quote.id'),
    fare: {
      amountMinor: nonNegativeInteger(fare.amountMinor, 'quote.fare.amountMinor'),
      currency: fare.currency,
    },
    etaSeconds: nonNegativeInteger(quote.etaSeconds, 'quote.etaSeconds'),
    expiresAt: timestamp(quote.expiresAt, 'quote.expiresAt'),
  };
}

export function restoreRideRequest(stored: unknown): RideRequest {
  const value = record(stored, 'ride request');
  const serviceType = serviceTypes.find((type) => type === value.serviceType);
  const status = statuses.find((state) => state === value.status);
  if (!serviceType) throw new RideRequestDomainError('serviceType is unsupported.');
  if (!status) throw new RideRequestDomainError('status is unsupported.');

  const createdAt = timestamp(value.createdAt, 'createdAt');
  const updatedAt = timestamp(value.updatedAt, 'updatedAt');
  const quote = quoteSnapshot(value.quote);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new RideRequestDomainError('updatedAt cannot precede createdAt.');
  }
  if (Date.parse(quote.expiresAt) <= Date.parse(createdAt)) {
    throw new RideRequestDomainError('The quote must expire after the ride request is created.');
  }
  if (value.tripId !== undefined && status !== 'matched') {
    throw new RideRequestDomainError('A trip identifier requires a matched request.');
  }

  return {
    id: resourceId(value.id, 'id'),
    riderId: resourceId(value.riderId, 'riderId'),
    pickup: coordinate(value.pickup, 'pickup'),
    destination: coordinate(value.destination, 'destination'),
    serviceType,
    quote,
    status,
    createdAt,
    updatedAt,
    revision: nonNegativeInteger(value.revision, 'revision'),
    ...(value.tripId === undefined ? {} : { tripId: resourceId(value.tripId, 'tripId') }),
  };
}

export function createRideRequest(input: NewRideRequest, now = new Date()): RideRequest {
  const createdAt = fromClock(now);
  return restoreRideRequest({
    ...input, status: 'pending_confirmation', createdAt, updatedAt: createdAt, revision: 0,
  });
}

export function transitionRideRequest(
  request: RideRequest,
  change: RideRequestTransition,
  now = new Date(),
): RideRequest {
  if (!transitions[request.status].includes(change.status)) {
    throw new RideRequestDomainError(`Cannot transition from ${request.status} to ${change.status}.`);
  }

  const updatedAt = fromClock(now);
  if (now.getTime() < Date.parse(request.updatedAt)) {
    throw new RideRequestDomainError('A transition cannot precede the last update.');
  }

  const quoteExpired = now.getTime() >= Date.parse(request.quote.expiresAt);
  if (change.status === 'searching' && (quoteExpired || change.quoteId !== request.quote.id)) {
    throw new RideRequestDomainError('Confirmation requires the current, unexpired quote.');
  }
  if (change.status === 'expired' && !quoteExpired) {
    throw new RideRequestDomainError('The quote is still valid.');
  }

  return restoreRideRequest({
    ...request,
    status: change.status,
    updatedAt,
    revision: request.revision + 1,
    ...(change.status === 'matched' ? { tripId: change.tripId } : {}),
  });
}
