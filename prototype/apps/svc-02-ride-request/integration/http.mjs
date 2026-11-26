import assert from 'node:assert/strict';
import test from 'node:test';
import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createApp } from '../dist/app.js';
import { createRideRequestDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbRideRequestRepository, rideRequestTable } from '../dist/infrastructure/dynamodb-ride-request-repository.js';
import {
  assertContractResponse, creation, getTestQuote, listen, lookup, post, rideInput,
  rideRequestsPath, riderHeaders, verifyTestBearer,
} from '../test-support/http.mjs';

test('POST persists a ride in DynamoDB Local and GET returns it only to the rider', { timeout: 15000 }, async (t) => {
  const client = createRideRequestDocumentClient();
  const reader = createRideRequestDocumentClient();
  let requestId;
  t.after(async () => {
    try {
      if (requestId) await client.send(new DeleteCommand({ TableName: rideRequestTable, Key: { request_id: requestId } }));
    } finally {
      client.destroy();
      reader.destroy();
    }
  });

  const correlationId = 'http-integration-001';
  const quote = await getTestQuote();
  const writerOrigin = await listen(t, createApp({
    repository: new DynamoDbRideRequestRepository(client),
    verifyBearerToken: verifyTestBearer,
    getQuote: async (input, correlation) => {
      assert.deepEqual(input, rideInput);
      assert.equal(correlation, correlationId);
      return quote;
    },
  }));
  const response = await post(writerOrigin, rideInput, {
    'X-Correlation-ID': correlationId,
    'X-Request-ID': 'client-attempt-id',
    'X-Rider-ID': 'rider-002',
  });
  const created = await assertContractResponse(response, creation, 201);
  requestId = created.id;
  const location = `${rideRequestsPath}/${created.id}`;
  assert.equal(response.headers.get('Location'), location);
  assert.equal(response.headers.get('X-Correlation-ID'), correlationId);
  assert.notEqual(response.headers.get('X-Request-ID'), 'client-attempt-id');
  assert.equal(created.status, 'pending_confirmation');
  assert.deepEqual(created.quote, quote);
  assert.equal('riderId' in created, false);
  assert.equal('revision' in created, false);

  const { Item } = await reader.send(new GetCommand({
    TableName: rideRequestTable, Key: { request_id: requestId }, ConsistentRead: true,
  }));
  const { request_id: id, riderId, revision, ...attributes } = Item;
  assert.equal(riderId, 'rider-001');
  assert.equal(revision, 0);
  assert.deepEqual({ id, ...attributes }, created);

  const readerOrigin = await listen(t, createApp({
    repository: new DynamoDbRideRequestRepository(reader),
    verifyBearerToken: verifyTestBearer,
  }));
  const foundResponse = await globalThis.fetch(`${readerOrigin}${location}`, { headers: riderHeaders });
  const found = await assertContractResponse(foundResponse, lookup, 200);
  assert.notEqual(foundResponse.headers.get('X-Request-ID'), response.headers.get('X-Request-ID'));
  assert.deepEqual(found, created);
  await assertContractResponse(await globalThis.fetch(`${readerOrigin}${location}`, {
    headers: { Authorization: 'Bearer rider-two-test-token' },
  }), lookup, 404);
  await assertContractResponse(await globalThis.fetch(`${readerOrigin}${rideRequestsPath}/absent-${created.id}`, {
    headers: riderHeaders,
  }), lookup, 404);
});
