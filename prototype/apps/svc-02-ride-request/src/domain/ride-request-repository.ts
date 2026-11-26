import type { NewRideRequest, RideRequest, RideRequestTransition } from './ride-request.js';

export interface RideRequestRepository {
  create(input: NewRideRequest, now?: Date): Promise<RideRequest>;
  findById(id: string): Promise<RideRequest | null>;
  transition(id: string, expectedRevision: number, change: RideRequestTransition, now?: Date): Promise<RideRequest>;
  confirm(id: string, riderId: string, quoteId: string, key: string): Promise<RideRequest>;
  cancel(id: string, riderId: string, reason?: string): Promise<RideRequest>;
}

type RepositoryErrorCode =
  | 'already_exists' | 'not_found' | 'conflict' | 'storage_failure'
  | 'quote_changed' | 'idempotency_key_reused';

export class RideRequestRepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RideRequestRepositoryError';
  }
}
