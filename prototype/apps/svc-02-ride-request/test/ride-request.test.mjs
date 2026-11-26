import assert from 'node:assert/strict';
import test from 'node:test';
import { createRideRequest, restoreRideRequest, RideRequestDomainError, transitionRideRequest } from '../dist/domain/ride-request.js';
import { creationTime, expiryTime, newRideRequest, transitionTime } from '../test-support/ride-request.mjs';

const now = new Date(creationTime);
const later = new Date(transitionTime);

test('a new ride contains the rider, quote and timestamps with revision zero', () => {
  const input = newRideRequest();
  const request = createRideRequest(input, now);
  assert.deepEqual(request, {
    ...input, status: 'pending_confirmation', createdAt: creationTime, updatedAt: creationTime, revision: 0,
  });
  input.pickup.latitude = 0;
  assert.notEqual(request.pickup.latitude, input.pickup.latitude);
});

test('ride validation rejects invalid coordinates, identifiers, service types and quotes', () => {
  const input = newRideRequest();
  const invalid = [
    { pickup: { latitude: 91, longitude: 0 } },
    { destination: { latitude: 0, longitude: Number.NaN } },
    { riderId: 'invalid/rider' },
    { serviceType: 'unsupported' },
    { quote: { ...input.quote, etaSeconds: -1 } },
    { quote: { ...input.quote, fare: { amountMinor: 1.5, currency: 'COP' } } },
    { quote: { ...input.quote, fare: { amountMinor: 100, currency: 'cop' } } },
    { quote: { ...input.quote, expiresAt: creationTime } },
    { quote: { ...input.quote, expiresAt: '2026-02-30T12:00:00Z' } },
  ];
  for (const changes of invalid) {
    assert.throws(() => createRideRequest({ ...input, ...changes }, now), RideRequestDomainError);
  }
  assert.throws(() => createRideRequest(input, new Date(NaN)), RideRequestDomainError);
});

test('confirmation and matching update the revision without changing the creation date', () => {
  const pending = createRideRequest(newRideRequest(), now);
  const searching = transitionRideRequest(pending, { status: 'searching', quoteId: pending.quote.id }, later);
  const matched = transitionRideRequest(searching, { status: 'matched', tripId: 'trip-001' }, later);

  assert.equal(pending.status, 'pending_confirmation');
  assert.equal(searching.revision, 1);
  assert.equal(matched.revision, 2);
  assert.equal(matched.createdAt, creationTime);
  assert.equal(matched.updatedAt, transitionTime);
  assert.equal(matched.tripId, 'trip-001');
  assert.throws(() => transitionRideRequest(matched, { status: 'cancelled' }, later), RideRequestDomainError);
  assert.equal(transitionRideRequest(searching, { status: 'matched' }, later).tripId, undefined);
});

test('invalid transitions, stale quotes and backwards timestamps are rejected', () => {
  const pending = createRideRequest(newRideRequest(), now);
  const expiry = new Date(expiryTime);
  assert.throws(() => transitionRideRequest(pending, { status: 'matched' }, later), RideRequestDomainError);
  assert.throws(() => transitionRideRequest(pending, { status: 'expired' }, later), RideRequestDomainError);
  assert.throws(() => transitionRideRequest(pending, { status: 'searching', quoteId: 'stale' }, later), RideRequestDomainError);
  assert.throws(() => transitionRideRequest(pending, { status: 'searching', quoteId: pending.quote.id }, expiry), RideRequestDomainError);
  assert.throws(() => transitionRideRequest(pending, { status: 'cancelled' }, new Date(now.getTime() - 1)), RideRequestDomainError);
  assert.throws(() => restoreRideRequest({ ...pending, tripId: 'trip-1' }), RideRequestDomainError);
  assert.equal(transitionRideRequest(pending, { status: 'expired' }, expiry).status, 'expired');
});

test('cancellation and no-driver outcomes finish the request', () => {
  const pending = createRideRequest(newRideRequest(), now);
  const searching = transitionRideRequest(pending, { status: 'searching', quoteId: pending.quote.id }, later);
  const cancelled = transitionRideRequest(pending, { status: 'cancelled' }, later);
  const unmatched = transitionRideRequest(searching, { status: 'no_driver_found' }, later);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(unmatched.status, 'no_driver_found');
  assert.throws(() => transitionRideRequest(unmatched, { status: 'cancelled' }, later), RideRequestDomainError);
});
