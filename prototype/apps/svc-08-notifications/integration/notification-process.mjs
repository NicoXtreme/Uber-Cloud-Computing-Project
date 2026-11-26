import process from 'node:process';
import { createNotificationDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbMessageLogRepository } from '../dist/infrastructure/message-log-repository.js';
import { DynamoDbNotificationPreferencesRepository } from '../dist/infrastructure/notification-preferences-repository.js';
import { createdAt, emailOnly, notificationInput } from '../test-support/fixtures.mjs';

const [action, recipientId, id] = process.argv.slice(2);
const client = createNotificationDocumentClient();
const logs = new DynamoDbMessageLogRepository(client);
const preferences = new DynamoDbNotificationPreferencesRepository(client);
const access = { recipientId };

try {
  const now = new Date(createdAt);
  const result = action === 'create'
    ? [await logs.create(access, notificationInput(id), now), await preferences.save(access, emailOnly, null, now)]
    : [await logs.findById(access, id), await preferences.get(access)];
  process.stdout.write(JSON.stringify(result));
} finally {
  client.destroy();
}
