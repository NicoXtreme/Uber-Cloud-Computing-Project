import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { clockTimestamp, defaultPreferences, notificationChannels, NotificationError, resourceId, revision, timestamp } from '../domain/notifications.js';
import type { NotificationChannels, NotificationPreferences, RecipientAccess } from '../domain/notifications.js';
import { notificationTable } from './dynamodb.js';

function preferencesKey(userId: string): string {
  return `preferences#${userId}`;
}

export class DynamoDbNotificationPreferencesRepository {
  constructor(private readonly client: DynamoDBDocumentClient) {}

  async get(access: RecipientAccess): Promise<NotificationPreferences> {
    const defaults = defaultPreferences(access);
    try {
      const { Item } = await this.client.send(new GetCommand({
        TableName: notificationTable, Key: { notification_id: preferencesKey(defaults.userId) }, ConsistentRead: true,
      }));
      if (!Item) return defaults;
      if (Item.recordType !== 'preferences' || Item.user_id !== defaults.userId) {
        throw new Error('The stored notification preferences contain an invalid owner or record type.');
      }
      return {
        userId: defaults.userId, ...notificationChannels(Item),
        revision: revision(Item.revision), updatedAt: timestamp(Item.updatedAt),
      };
    } catch (cause) {
      throw new NotificationError('storage_failure', 'Could not load notification preferences.', { cause });
    }
  }

  async save(
    access: RecipientAccess, channels: NotificationChannels, expectedRevision: number | null, now = new Date(),
  ): Promise<NotificationPreferences> {
    const userId = resourceId(access.recipientId);
    if (expectedRevision !== null) revision(expectedRevision);
    const next = {
      ...notificationChannels(channels),
      revision: expectedRevision === null ? 0 : revision(expectedRevision + 1),
      updatedAt: clockTimestamp(now),
    };
    try {
      await this.client.send(new PutCommand({
        TableName: notificationTable,
        Item: { notification_id: preferencesKey(userId), recordType: 'preferences', user_id: userId, ...next },
        ...(expectedRevision === null
          ? { ConditionExpression: 'attribute_not_exists(notification_id)' }
          : {
              ConditionExpression: 'recordType = :kind AND user_id = :owner AND revision = :expected',
              ExpressionAttributeValues: { ':kind': 'preferences', ':owner': userId, ':expected': expectedRevision },
            }),
      }));
      return { userId, ...next };
    } catch (cause) {
      if (cause instanceof ConditionalCheckFailedException) {
        throw new NotificationError('conflict', 'The notification preferences have changed.');
      }
      throw new NotificationError('storage_failure', 'Could not store notification preferences.', { cause });
    }
  }
}
