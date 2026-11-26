import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createApp } from '../dist/app.js';
import { createRideRequestDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbRideRequestRepository, rideRequestTable } from '../dist/infrastructure/dynamodb-ride-request-repository.js';
import {
  assertContractResponse, cancellation, confirmation, getTestQuote, listen, post, rideRequestsPath, verifyTestBearer,
} from '../test-support/http.mjs';
import { newRideRequest } from '../test-support/ride-request.mjs';

const keyHeader = { 'Idempotency-Key': 'confirmation-key' };

async function setup(t, expired = false) {
  const client = createRideRequestDocumentClient();
  const repository = new DynamoDbRideRequestRepository(client);
  const id = randomUUID();
  const input = { ...newRideRequest(id), quote: await getTestQuote() };
  const now = new Date();
  if (expired) {
    input.quote.expiresAt = new Date(now.getTime() - 60_000).toISOString();
    now.setTime(now.getTime() - 120_000);
  }
  t.after(async () => {
    try {
      await client.send(new DeleteCommand({ TableName: rideRequestTable, Key: { request_id: id } }));
    } finally {
      client.destroy();
    }
  });
  const initial = await repository.create(input, now);
  return {
    id, client, repository, initial, confirmBody: { quoteId: input.quote.id },
    confirmPath: `${rideRequestsPath}/${id}/confirm`, cancelPath: `${rideRequestsPath}/${id}/cancel`,
  };
}

function serve(t, repository) {
  return listen(t, createApp({ repository, verifyBearerToken: verifyTestBearer }));
}

test('a confirmation replay returns the original snapshot after cancellation and a new application instance', async (t) => {
  const fixture = await setup(t);
  const { id, repository, confirmBody, confirmPath, cancelPath, client } = fixture;
  const origin = await serve(t, repository);
  const headers = { ...keyHeader, 'X-Correlation-ID': 'transition-integration' };
  const response = await post(origin, confirmBody, headers, confirmPath);
  const confirmed = await assertContractResponse(response, confirmation, 200);
  assert.equal(response.headers.get('X-Correlation-ID'), headers['X-Correlation-ID']);
  assert.equal(confirmed.status, 'searching');
  assert.equal((await repository.findById(id)).revision, 1);
  assert.equal('confirmationReceipt' in confirmed, false);

  const secondClient = createRideRequestDocumentClient();
  t.after(() => secondClient.destroy());
  const secondOrigin = await serve(t, new DynamoDbRideRequestRepository(secondClient));
  const replayed = await post(secondOrigin, confirmBody, keyHeader, confirmPath);
  assert.deepEqual(await assertContractResponse(replayed, confirmation, 200), confirmed);
  assert.notEqual(replayed.headers.get('X-Request-ID'), response.headers.get('X-Request-ID'));
  const changed = await post(secondOrigin, { quoteId: 'another-quote' }, keyHeader, confirmPath);
  assert.equal((await assertContractResponse(changed, confirmation, 409)).error.code, 'IDEMPOTENCY_KEY_REUSED');
  const differentKey = await post(secondOrigin, confirmBody, { 'Idempotency-Key': 'other-key' }, confirmPath);
  assert.equal((await assertContractResponse(differentKey, confirmation, 409)).error.code, 'CONFLICT');
  assert.equal((await repository.findById(id)).revision, 1);

  const cancelled = await assertContractResponse(await post(secondOrigin, { reason: 'Plans changed' }, {}, cancelPath), cancellation, 200);
  assert.equal(cancelled.status, 'cancelled');
  const { Item } = await client.send(new GetCommand({
    TableName: rideRequestTable, Key: { request_id: id }, ConsistentRead: true,
  }));
  assert.equal(Item.cancellationReason, 'Plans changed');
  assert.equal(Item.revision, 2);
  assert.equal('cancellationReason' in cancelled, false);
  assert.deepEqual(await assertContractResponse(await post(secondOrigin, confirmBody, keyHeader, confirmPath), confirmation, 200), confirmed);
  await assertContractResponse(await post(secondOrigin, {}, {}, cancelPath), cancellation, 409);
  assert.equal((await repository.findById(id)).revision, 2);
});

test('invalid quotes, missing requests and other riders leave the stored state intact', async (t) => {
  const { id, initial, repository, confirmBody, confirmPath, cancelPath } = await setup(t, true);
  const origin = await serve(t, repository);
  const expired = await post(origin, confirmBody, keyHeader, confirmPath);
  assert.equal((await assertContractResponse(expired, confirmation, 409)).error.code, 'QUOTE_CHANGED');
  const other = { Authorization: 'Bearer rider-two-test-token' };
  await assertContractResponse(await post(origin, confirmBody, { ...keyHeader, ...other }, confirmPath), confirmation, 404);
  await assertContractResponse(await post(origin, {}, other, cancelPath), cancellation, 404);
  await assertContractResponse(await post(origin, confirmBody, keyHeader, `${rideRequestsPath}/absent-${id}/confirm`), confirmation, 404);
  await assertContractResponse(await post(origin, {}, {}, `${rideRequestsPath}/absent-${id}/cancel`), cancellation, 404);
  assert.deepEqual(await repository.findById(id), initial);

  const result = await assertContractResponse(await post(origin, {}, {}, cancelPath), cancellation, 200);
  assert.equal(result.status, 'cancelled');
  assert.equal((await repository.findById(id)).revision, 1);
});

test('cancellation after matching returns conflict and preserves the complete record', async (t) => {
  const { id, repository, confirmBody, cancelPath } = await setup(t);
  await repository.transition(id, 0, { status: 'searching', quoteId: confirmBody.quoteId });
  const matched = await repository.transition(id, 1, { status: 'matched', tripId: 'trip-001' });
  const origin = await serve(t, repository);
  const response = await post(origin, { reason: 'Too late' }, {}, cancelPath);
  assert.equal((await assertContractResponse(response, cancellation, 409)).error.code, 'CONFLICT');
  assert.deepEqual(await repository.findById(id), matched);
});

function gateUpdates(client) {
  const gate = Promise.withResolvers();
  let arrived = 0;
  return {
    async send(command) {
      if (command instanceof UpdateCommand) {
        arrived += 1;
        if (arrived === 2) gate.resolve();
        await gate.promise;
      }
      return client.send(command);
    },
  };
}

test('simultaneous confirmations with the same key increment the revision once', { timeout: 15000 }, async (t) => {
  const { id, client, repository, confirmBody, confirmPath } = await setup(t);
  const origin = await serve(t, new DynamoDbRideRequestRepository(gateUpdates(client)));
  const [first, second] = await Promise.all([
    post(origin, confirmBody, keyHeader, confirmPath),
    post(origin, confirmBody, keyHeader, confirmPath),
  ]);
  const original = await assertContractResponse(first, confirmation, 200);
  assert.deepEqual(await assertContractResponse(second, confirmation, 200), original);
  const persisted = await repository.findById(id);
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.updatedAt, original.updatedAt);
});

test('simultaneous confirmation and cancellation from the same revision commit only one update', { timeout: 15000 }, async (t) => {
  const { id, client, repository, confirmBody, confirmPath, cancelPath } = await setup(t);
  const origin = await serve(t, new DynamoDbRideRequestRepository(gateUpdates(client)));
  const [confirmResponse, cancelResponse] = await Promise.all([
    post(origin, confirmBody, keyHeader, confirmPath),
    post(origin, {}, {}, cancelPath),
  ]);
  assert.deepEqual([confirmResponse.status, cancelResponse.status].sort(), [200, 409]);
  const confirmed = await assertContractResponse(confirmResponse, confirmation, confirmResponse.status);
  const cancelled = await assertContractResponse(cancelResponse, cancellation, cancelResponse.status);
  const persisted = await repository.findById(id);
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.status, confirmResponse.status === 200 ? confirmed.status : cancelled.status);
});

test('a failed DynamoDB write preserves the prior record and permits retry with the same key', async (t) => {
  const { id, initial, client, repository, confirmBody, confirmPath } = await setup(t);
  const failing = new DynamoDbRideRequestRepository({
    send(command) {
      if (command instanceof UpdateCommand) throw new Error('private storage details');
      return client.send(command);
    },
  });
  const origin = await serve(t, failing);
  const error = await assertContractResponse(await post(origin, confirmBody, keyHeader, confirmPath), confirmation, 503);
  assert.equal(error.error.message, 'A required service is temporarily unavailable.');
  assert.deepEqual(await repository.findById(id), initial);

  const retryOrigin = await serve(t, repository);
  await assertContractResponse(await post(retryOrigin, confirmBody, keyHeader, confirmPath), confirmation, 200);
  assert.equal((await repository.findById(id)).revision, 1);
});
