import { randomUUID } from 'node:crypto';
import { json, Router } from 'express';
import type { NextFunction, Request } from 'express';
import type { RideRequestRepository } from '../domain/ride-request-repository.js';
import { resourceId, RideRequestDomainError } from '../domain/ride-request.js';
import type { NewRideRequest, RideRequest } from '../domain/ride-request.js';
import { addRideTrace, RideHttpError, sendRideError } from './ride-request-errors.js';
import type { RideResponse } from './ride-request-errors.js';
import { readRideId, readRideInput } from './ride-request-input.js';
import type { RideInput } from './ride-request-input.js';

export const rideRequestsPath = '/v1/ride-requests';

type VerifiedPrincipal = Readonly<{ subject: string; role: string }>;

export type RideRoutesDependencies = Readonly<{
  repository: Pick<RideRequestRepository, 'create' | 'findById'>;
  verifyBearerToken?: (token: string) => Promise<VerifiedPrincipal | null>;
  getQuote?: (input: RideInput, correlationId: string) => Promise<NewRideRequest['quote']>;
}>;

function serialize(request: RideRequest) {
  const { id, pickup, destination, serviceType, quote, status, createdAt, updatedAt, tripId } = request;
  return {
    id, pickup, destination, serviceType, quote, status, createdAt, updatedAt,
    ...(tripId === undefined ? {} : { tripId }),
  };
}

export function createRideRequestRouter({ repository, verifyBearerToken, getQuote }: RideRoutesDependencies): Router {
  const router = Router();
  const parseJson = json({ limit: '16kb', strict: false });

  async function requireRider(request: Request, response: RideResponse, next: NextFunction): Promise<void> {
    const token = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(request.get('Authorization') ?? '')?.[1];
    const principal = token && verifyBearerToken ? await verifyBearerToken(token) : null;
    if (!principal) throw new RideHttpError(401);
    if (principal.role !== 'rider') throw new RideHttpError(403);
    response.locals.riderId = resourceId(principal.subject, 'riderId');
    next();
  }

  router.use(addRideTrace);
  router.post('/', requireRider, parseJson, async (request: Request, response: RideResponse) => {
    if (!request.is('application/json')) throw new RideHttpError(400);

    const input = readRideInput(request.body);
    if (!getQuote) throw new RideHttpError(503);

    let quote: NewRideRequest['quote'];
    try {
      quote = await getQuote(input, response.locals.trace.correlationId);
    } catch {
      throw new RideHttpError(503);
    }

    let stored: RideRequest;
    try {
      stored = await repository.create({ ...input, id: randomUUID(), riderId: response.locals.riderId, quote });
    } catch (error) {
      // The request body and rider ID were validated before sourcing the quote.
      if (error instanceof RideRequestDomainError) throw new RideHttpError(503);
      throw error;
    }

    response.location(`${rideRequestsPath}/${stored.id}`).status(201).json(serialize(stored));
  });

  router.get('/:id', requireRider, async (request: Request<{ id: string }>, response: RideResponse) => {
    const stored = await repository.findById(readRideId(request.params.id));
    if (!stored || stored.riderId !== response.locals.riderId) throw new RideHttpError(404);
    response.status(200).json(serialize(stored));
  });

  router.use(sendRideError);
  return router;
}
