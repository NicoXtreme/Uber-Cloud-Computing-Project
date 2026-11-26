import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export const notificationTable = 'svc-08-notifications';
export const notificationHistoryIndex = 'recipient-history';

const localHosts = ['localhost', '127.0.0.1', '[::1]', 'd4-dynamodb', 'dynamodb-local'];

export function createNotificationDocumentClient(
  endpoint = process.env.SVC_08_DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8000',
): DynamoDBDocumentClient {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !localHosts.includes(url.hostname) || url.username ||
      url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SVC_08_DYNAMODB_ENDPOINT must be a local DynamoDB HTTP origin.');
  }

  return DynamoDBDocumentClient.from(new DynamoDBClient({
    endpoint: url.origin,
    region: 'us-east-1',
    credentials: { accessKeyId: 'LocalOnly', secretAccessKey: 'LocalOnlySecret' },
    maxAttempts: 1,
    requestHandler: {
      connectionTimeout: 1000,
      requestTimeout: 3000,
      throwOnRequestTimeout: true,
    },
  }));
}
