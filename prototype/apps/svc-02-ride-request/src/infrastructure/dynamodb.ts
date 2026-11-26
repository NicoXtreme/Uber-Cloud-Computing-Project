import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const localHosts = ['localhost', '127.0.0.1', '[::1]', 'd4-dynamodb', 'dynamodb-local'];

export function createRideRequestDocumentClient(
  endpoint = process.env.SVC_02_DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000',
): DynamoDBDocumentClient {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !localHosts.includes(url.hostname) || url.username ||
      url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SVC_02_DYNAMODB_ENDPOINT must be a local DynamoDB HTTP origin.');
  }

  const client = new DynamoDBClient({
    endpoint: url.origin,
    region: 'us-east-1',
    credentials: { accessKeyId: 'LocalOnly', secretAccessKey: 'LocalOnlySecret' },
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: 1000,
      requestTimeout: 3000,
      throwOnRequestTimeout: true,
    },
  });
  return DynamoDBDocumentClient.from(client);
}
