import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createMessage, finishMessage, NotificationError, resourceId, restoreMessage, revision, timestamp } from '../domain/notifications.js';
import type { MessageLog, NewMessage, RecipientAccess } from '../domain/notifications.js';
import { notificationHistoryIndex, notificationTable } from './dynamodb.js';

type HistoryKey = { notification_id: string; recipient_id: string; history_key: string };
type Page = Readonly<{ items: readonly MessageLog[]; nextCursor: string | null }>;

function toHistoryKey(key: Record<string, unknown>, recipientId: string): HistoryKey {
  const id = resourceId(key.notification_id);
  const sort = key.history_key;
  if (key.recipient_id !== recipientId || typeof sort !== 'string' || sort.slice(24) !== `#${id}`) {
    throw new NotificationError('invalid', 'The history cursor is invalid for the recipient.');
  }
  timestamp(sort.slice(0, 24));
  return { notification_id: id, recipient_id: recipientId, history_key: sort };
}

function decodeCursor(cursor: string, recipientId: string): HistoryKey {
  try {
    if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw new Error('Malformed cursor');
    return toHistoryKey(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')), recipientId);
  } catch {
    throw new NotificationError('invalid', 'The history cursor is invalid for the recipient.');
  }
}

function fromItem(item: Record<string, unknown>): MessageLog {
  return restoreMessage({ ...item, id: item.notification_id, recipientId: item.recipient_id });
}

export class DynamoDbMessageLogRepository {
  constructor(private readonly client: DynamoDBDocumentClient) {}

  async create(access: RecipientAccess, input: NewMessage, now?: Date): Promise<MessageLog> {
    const message = createMessage(access, input, now);
    const { id, recipientId, ...attributes } = message;
    try {
      await this.client.send(new PutCommand({
        TableName: notificationTable,
        Item: {
          notification_id: id, recipient_id: recipientId, history_key: `${message.createdAt}#${id}`,
          recordType: 'message', ...attributes,
        },
        ConditionExpression: 'attribute_not_exists(notification_id)',
      }));
      return message;
    } catch (cause) {
      if (cause instanceof ConditionalCheckFailedException) {
        throw new NotificationError('conflict', 'The notification could not be created with this identifier.');
      }
      throw new NotificationError('storage_failure', 'Could not store the notification.', { cause });
    }
  }

  async findById(access: RecipientAccess, id: string): Promise<MessageLog | null> {
    const recipientId = resourceId(access.recipientId);
    const notificationId = resourceId(id);
    try {
      const { Item } = await this.client.send(new GetCommand({
        TableName: notificationTable, Key: { notification_id: notificationId }, ConsistentRead: true,
      }));
      return Item?.recordType === 'message' && Item.recipient_id === recipientId ? fromItem(Item) : null;
    } catch (cause) {
      throw new NotificationError('storage_failure', 'Could not load the notification.', { cause });
    }
  }

  async list(access: RecipientAccess, { limit = 20, cursor }: { limit?: number; cursor?: string } = {}): Promise<Page> {
    const recipientId = resourceId(access.recipientId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new NotificationError('invalid', 'The history limit must be between 1 and 100.');
    }
    const start = cursor === undefined ? undefined : decodeCursor(cursor, recipientId);
    try {
      const { Items = [], LastEvaluatedKey } = await this.client.send(new QueryCommand({
        TableName: notificationTable,
        IndexName: notificationHistoryIndex,
        KeyConditionExpression: 'recipient_id = :recipient',
        ExpressionAttributeValues: { ':recipient': recipientId },
        ScanIndexForward: false,
        Limit: limit,
        ...(start ? { ExclusiveStartKey: start } : {}),
      }));
      const items = Items.map((item) => {
        if (item.recordType !== 'message' || item.recipient_id !== recipientId) {
          throw new Error('The notification history contains an invalid record.');
        }
        return fromItem(item);
      });
      const nextCursor = LastEvaluatedKey
        ? Buffer.from(JSON.stringify(toHistoryKey(LastEvaluatedKey, recipientId))).toString('base64url')
        : null;
      return { items, nextCursor };
    } catch (cause) {
      throw new NotificationError('storage_failure', 'Could not query notification history.', { cause });
    }
  }

  async recordResult(
    access: RecipientAccess, id: string, expectedRevision: number, status: 'delivered' | 'failed', now?: Date,
  ): Promise<MessageLog> {
    revision(expectedRevision);
    const current = await this.findById(access, id);
    if (!current) throw new NotificationError('not_found', 'The notification does not exist.');
    if (current.revision !== expectedRevision) throw new NotificationError('conflict', 'The notification has changed.');
    const next = finishMessage(current, status, now);
    try {
      await this.client.send(new UpdateCommand({
        TableName: notificationTable,
        Key: { notification_id: id },
        ConditionExpression: 'recordType = :message AND recipient_id = :recipient AND revision = :expected AND #status = :pending',
        UpdateExpression: 'SET #status = :result, updatedAt = :now, lastAttemptAt = :now, attemptCount = :attempts, revision = :next',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':message': 'message', ':recipient': current.recipientId, ':expected': expectedRevision, ':pending': 'pending',
          ':result': next.status, ':now': next.updatedAt, ':attempts': next.attemptCount, ':next': next.revision,
        },
      }));
      return next;
    } catch (cause) {
      if (cause instanceof ConditionalCheckFailedException) {
        throw new NotificationError('conflict', 'The notification has changed.');
      }
      throw new NotificationError('storage_failure', 'Could not record the delivery result.', { cause });
    }
  }
}
