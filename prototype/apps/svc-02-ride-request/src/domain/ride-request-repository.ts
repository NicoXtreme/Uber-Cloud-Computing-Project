import type { NewRideRequest, RideRequest, RideRequestTransition } from './ride-request.js';

export interface RideRequestRepository {
  create(input: NewRideRequest, now?: Date): Promise<RideRequest>;
  findById(id: string): Promise<RideRequest | null>;
  transition(id: string, expectedRevision: number, change: RideRequestTransition, now?: Date): Promise<RideRequest>;
}

type RepositoryErrorCode = 'already_exists' | 'not_found' | 'conflict' | 'storage_failure';

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
