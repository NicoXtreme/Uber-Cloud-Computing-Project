import process from 'node:process';
import { createRideRequestDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbRideRequestRepository } from '../dist/infrastructure/dynamodb-ride-request-repository.js';
import { creationTime, newRideRequest } from '../test-support/ride-request.mjs';

const [action, id] = process.argv.slice(2);
const client = createRideRequestDocumentClient();
const repository = new DynamoDbRideRequestRepository(client);

try {
  const request = action === 'create'
    ? await repository.create(newRideRequest(id), new Date(creationTime))
    : await repository.findById(id);
  process.stdout.write(JSON.stringify(request));
} finally {
  client.destroy();
}
