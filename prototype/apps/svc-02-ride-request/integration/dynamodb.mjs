import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RideRequestDomainError } from '../dist/domain/ride-request.js';
import { RideRequestRepositoryError } from '../dist/domain/ride-request-repository.js';
import { createRideRequestDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbRideRequestRepository, rideRequestTable } from '../dist/infrastructure/dynamodb-ride-request-repository.js';
import { creationTime, newRideRequest, transitionTime } from '../test-support/ride-request.mjs';

const worker = fileURLToPath(new URL('./ride-request-process.mjs', import.meta.url));
const run = promisify(execFile);
const now = new Date(creationTime);
const later = new Date(transitionTime);

function setup(t) {
  const id = `issue8-${randomUUID()}`;
  const client = createRideRequestDocumentClient();
  t.after(async () => {
    try {
      await client.send(new DeleteCommand({
        TableName: rideRequestTable,
        Key: { request_id: id },
      }));
    } finally {
      client.destroy();
    }
  });
  return { id, client, repository: new DynamoDbRideRequestRepository(client) };
}

function repositoryError(code) {
  return (error) => error instanceof RideRequestRepositoryError && error.code === code;
}

test('a new SVC-02 process reads the request after the writer process exits', { timeout: 15000 }, async (t) => {
  const { id, repository } = setup(t);
  const written = JSON.parse((await run(process.execPath, [worker, 'create', id], { timeout: 6000 })).stdout);
  const read = JSON.parse((await run(process.execPath, [worker, 'read', id], { timeout: 6000 })).stdout);
  assert.deepEqual(read, written);
  assert.deepEqual(read, {
    ...newRideRequest(id),
    status: 'pending_confirmation', createdAt: creationTime, updatedAt: creationTime, revision: 0,
  });

  await assert.rejects(repository.create({ ...newRideRequest(id), riderId: 'another-rider' }, now), repositoryError('already_exists'));
  await assert.rejects(repository.transition(id, 0, { status: 'matched' }, later), RideRequestDomainError);
  assert.deepEqual(await repository.findById(id), written);
});

test('missing lookups return null and transitions cannot create a record', { timeout: 10000 }, async (t) => {
  const { id, repository } = setup(t);
  assert.equal(await repository.findById(id), null);
  await assert.rejects(repository.transition(id, 0, { status: 'cancelled' }, later), repositoryError('not_found'));
  assert.equal(await repository.findById(id), null);
});

test('only one of two writes from the same revision can commit', { timeout: 10000 }, async (t) => {
  const { id, client, repository } = setup(t);
  const input = newRideRequest(id);
  const created = await repository.create(input, now);
  const gate = Promise.withResolvers();
  let waiting = 0;

  const secondClient = createRideRequestDocumentClient();
  t.after(() => secondClient.destroy());
  function beforeUpdate(backend) {
    return {
      async send(command) {
        if (command instanceof UpdateCommand) {
          waiting += 1;
          if (waiting === 2) gate.resolve();
          await gate.promise;
        }
        return backend.send(command);
      },
    };
  }

  const first = new DynamoDbRideRequestRepository(beforeUpdate(client));
  const second = new DynamoDbRideRequestRepository(beforeUpdate(secondClient));
  const results = await Promise.allSettled([
    first.transition(id, created.revision, { status: 'searching', quoteId: input.quote.id }, later),
    second.transition(id, created.revision, { status: 'cancelled' }, later),
  ]);
  assert.equal(waiting, 2);

  const successes = results.filter((result) => result.status === 'fulfilled');
  const failures = results.filter((result) => result.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.ok(repositoryError('conflict')(failures[0].reason));
  assert.equal(failures[0].reason.cause.name, 'ConditionalCheckFailedException');
  assert.equal(successes[0].value.revision, 1);
  assert.deepEqual(await repository.findById(id), successes[0].value);
  await assert.rejects(repository.transition(id, 0, { status: 'cancelled' }, later), repositoryError('conflict'));
});

test('matching persists the transition timestamp and optional trip identifier', { timeout: 10000 }, async (t) => {
  const { id, repository } = setup(t);
  const input = newRideRequest(id);
  await repository.create(input, now);
  await repository.transition(id, 0, { status: 'searching', quoteId: input.quote.id }, later);
  const matched = await repository.transition(id, 1, { status: 'matched', tripId: 'trip-001' }, later);
  assert.equal(matched.revision, 2);
  assert.equal(matched.updatedAt, transitionTime);
  assert.equal(matched.tripId, 'trip-001');
  assert.deepEqual(await repository.findById(id), matched);
});
