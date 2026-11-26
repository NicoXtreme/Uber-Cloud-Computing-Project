import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { createRideRequestDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbRideRequestRepository } from '../dist/infrastructure/dynamodb-ride-request-repository.js';
import { RideRequestRepositoryError } from '../dist/domain/ride-request-repository.js';

test('the DynamoDB client rejects cloud endpoints and URLs with embedded credentials', () => {
  for (const endpoint of ['https://dynamodb.us-east-1.amazonaws.com', 'http://user:password@127.0.0.1:8000']) {
    assert.throws(() => createRideRequestDocumentClient(endpoint), /local DynamoDB HTTP origin/);
  }
});

test('a failed TCP connection surfaces as a repository storage error', async (t) => {
  const server = createServer((socket) => socket.destroy());
  server.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const client = createRideRequestDocumentClient(`http://127.0.0.1:${server.address().port}`);
  t.after(() => client.destroy());
  const repository = new DynamoDbRideRequestRepository(client);

  await assert.rejects(repository.findById('any-request'), (error) => {
    assert.ok(error instanceof RideRequestRepositoryError);
    assert.equal(error.code, 'storage_failure');
    assert.equal(error.cause.code, 'ECONNRESET');
    return true;
  });
});
