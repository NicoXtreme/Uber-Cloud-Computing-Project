import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { app, createApp } from '../dist/app.js';
import { createRideRequestDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbRideRequestRepository } from '../dist/infrastructure/dynamodb-ride-request-repository.js';
import {
  assertContractResponse, cancellation, confirmation, listen, post, rideRequestsPath, verifyTestBearer,
} from '../test-support/http.mjs';

const confirmPath = `${rideRequestsPath}/ride_001/confirm`;
const cancelPath = `${rideRequestsPath}/ride_001/cancel`;
const keyHeader = { 'Idempotency-Key': 'confirm-001' };
const confirmBody = { quoteId: 'quote_001' };

test('transition routes reject unverified caller identities', async (t) => {
  const origin = await listen(t, app);
  await assertContractResponse(await post(origin, confirmBody, keyHeader, confirmPath), confirmation, 401);
  await assertContractResponse(await post(origin, {}, {}, cancelPath), cancellation, 401);
});

test('transition input and rider role validation reject requests before storage', async (t) => {
  const reject = () => assert.fail('Invalid requests must not access storage');
  const origin = await listen(t, createApp({
    repository: { create: reject, findById: reject, confirm: reject, cancel: reject },
    verifyBearerToken: verifyTestBearer,
  }));
  const denied = await post(origin, {}, { Authorization: 'Bearer driver-test-token' }, cancelPath);
  await assertContractResponse(denied, cancellation, 403);
  for (const headers of [{}, { 'Idempotency-Key': 'invalid/key' }]) {
    await assertContractResponse(await post(origin, confirmBody, headers, confirmPath), confirmation, 400);
  }
  for (const body of [{}, { quoteId: 'bad.id' }, { ...confirmBody, riderId: 'rider-002' }]) {
    await assertContractResponse(await post(origin, body, keyHeader, confirmPath), confirmation, 422);
  }
  for (const body of [{ reason: '' }, { reason: '🚕'.repeat(251) }, { reason: null }, { status: 'cancelled' }]) {
    await assertContractResponse(await post(origin, body, {}, cancelPath), cancellation, 422);
  }
  await assertContractResponse(await post(origin, {}, {}, `${rideRequestsPath}/bad.id/cancel`), cancellation, 400);
});

test('DynamoDB transport failures on confirmation and cancellation produce contract errors', async (t) => {
  const unavailable = createServer((socket) => socket.destroy());
  unavailable.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => unavailable.close(resolve)));
  await once(unavailable, 'listening');
  const client = createRideRequestDocumentClient(`http://127.0.0.1:${unavailable.address().port}`);
  t.after(() => client.destroy());
  const origin = await listen(t, createApp({
    repository: new DynamoDbRideRequestRepository(client),
    verifyBearerToken: verifyTestBearer,
  }));
  await assertContractResponse(await post(origin, confirmBody, keyHeader, confirmPath), confirmation, 503);
  await assertContractResponse(await post(origin, {}, {}, cancelPath), cancellation, 500);
});
