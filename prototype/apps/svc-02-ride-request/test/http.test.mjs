import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { app, createApp } from '../dist/app.js';
import { createRideRequest } from '../dist/domain/ride-request.js';
import { createRideRequestDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbRideRequestRepository } from '../dist/infrastructure/dynamodb-ride-request-repository.js';
import {
  assertContractResponse, creation, getTestQuote, listen, lookup, post,
  rideInput, rideRequestsPath, riderHeaders, verifyTestBearer,
} from '../test-support/http.mjs';

const failOnUse = {
  async create() { assert.fail('Invalid or unauthenticated requests must not write'); },
  async findById() { assert.fail('Invalid or unauthenticated requests must not read'); },
};

function testApp(overrides = {}) {
  return createApp({ repository: failOnUse, verifyBearerToken: verifyTestBearer, getQuote: getTestQuote, ...overrides });
}

test('the default app rejects an unverified bearer and client-supplied identity', async (t) => {
  const origin = await listen(t, app);
  const response = await post(origin, rideInput, { 'X-Rider-ID': 'rider-001', 'X-User-ID': 'rider-001' });
  await assertContractResponse(response, creation, 401);
  assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
  await assertContractResponse(await globalThis.fetch(`${origin}${rideRequestsPath}/ride_001`, {
    headers: { 'X-Rider-ID': 'rider-001' },
  }), lookup, 401);
});

test('protected routes distinguish unknown tokens from non-rider roles', async (t) => {
  const origin = await listen(t, testApp());
  await assertContractResponse(await post(origin, rideInput, { Authorization: 'Bearer unverified' }), creation, 401);
  await assertContractResponse(await post(origin, rideInput, { Authorization: 'Bearer driver-test-token' }), creation, 403);
});

test('invalid JSON bodies produce contract errors before calling storage', async (t) => {
  const origin = await listen(t, testApp());
  const cases = [
    [{ ...rideInput, pickup: { ...rideInput.pickup, latitude: 91 } }, '/pickup/latitude'],
    [{ ...rideInput, riderId: 'rider-002' }, '/riderId'],
    [{ ...rideInput, destination: undefined }, '/destination'],
    [[], ''],
  ];
  for (const [input, path] of cases) {
    const result = await assertContractResponse(await post(origin, input), creation, 422);
    assert.equal(result.error.details[0].path, path);
  }
  await assertContractResponse(await globalThis.fetch(`${origin}${rideRequestsPath}`, {
    method: 'POST',
    headers: { ...riderHeaders, 'Content-Type': 'application/json' },
    body: '{"pickup":',
  }), creation, 400);
  await assertContractResponse(await post(origin, rideInput, { 'Content-Type': 'text/plain' }), creation, 400);
});

test('invalid identifiers and correlation headers produce traced 400 responses', async (t) => {
  const origin = await listen(t, testApp());
  for (const id of ['bad.id', '%ZZ']) {
    await assertContractResponse(await globalThis.fetch(`${origin}${rideRequestsPath}/${id}`, {
      headers: riderHeaders,
    }), lookup, 400);
  }
  const response = await post(origin, rideInput, { 'X-Correlation-ID': 'invalid/id', 'X-Request-ID': 'spoofed' });
  const result = await assertContractResponse(response, creation, 400);
  assert.notEqual(result.error.requestId, 'spoofed');
  assert.notEqual(result.error.correlationId, 'invalid/id');
});

test('a missing or failing quote provider produces a sanitized 503 before storage', async (t) => {
  for (const getQuote of [undefined, async () => { throw new Error('private provider detail'); }]) {
    const origin = await listen(t, testApp({ getQuote }));
    const result = await assertContractResponse(await post(origin), creation, 503);
    assert.equal(result.error.message, 'A required service is temporarily unavailable.');
  }
});

test('a quote rejected by the domain produces a sanitized 503', async (t) => {
  const origin = await listen(t, testApp({
    repository: { ...failOnUse, create: createRideRequest },
    getQuote: async () => ({ ...await getTestQuote(), etaSeconds: -1 }),
  }));
  const response = await assertContractResponse(await post(origin), creation, 503);
  assert.equal(response.error.message, 'A required service is temporarily unavailable.');
});

test('a DynamoDB connection failure returns the documented error for each operation', async (t) => {
  const unavailable = createServer((socket) => socket.destroy());
  unavailable.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => unavailable.close(resolve)));
  await once(unavailable, 'listening');

  const endpoint = `http://127.0.0.1:${unavailable.address().port}`;
  const client = createRideRequestDocumentClient(endpoint);
  t.after(() => client.destroy());
  const origin = await listen(t, testApp({ repository: new DynamoDbRideRequestRepository(client) }));

  const createFailure = await assertContractResponse(await post(origin), creation, 503);
  assert.equal(createFailure.error.message, 'A required service is temporarily unavailable.');
  const lookupFailure = await assertContractResponse(await globalThis.fetch(`${origin}${rideRequestsPath}/ride_001`, {
    headers: riderHeaders,
  }), lookup, 500);
  assert.equal(lookupFailure.error.message, 'An unexpected error occurred.');
});
