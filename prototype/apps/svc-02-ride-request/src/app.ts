import express from 'express';
import { createRideRequestRouter, rideRequestsPath } from './http/ride-request-routes.js';
import type { RideRoutesDependencies } from './http/ride-request-routes.js';
import { createRideRequestDocumentClient } from './infrastructure/dynamodb.js';
import { DynamoDbRideRequestRepository } from './infrastructure/dynamodb-ride-request-repository.js';

const health = { service: 'svc-02', status: 'ok' };

export function createApp(dependencies: RideRoutesDependencies) {
  const app = express();
  app.get(['/health/live', '/health/ready'], (_request, response) => {
    response.json(health);
  });
  app.use(rideRequestsPath, createRideRequestRouter(dependencies));
  return app;
}

export const app = createApp({
  repository: new DynamoDbRideRequestRepository(createRideRequestDocumentClient()),
});
