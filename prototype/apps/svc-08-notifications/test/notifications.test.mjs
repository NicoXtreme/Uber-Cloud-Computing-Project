import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';
import { createMessage, defaultPreferences, finishMessage, notificationChannels } from '../dist/domain/notifications.js';
import { createNotificationDocumentClient } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbMessageLogRepository } from '../dist/infrastructure/message-log-repository.js';
import { DynamoDbNotificationPreferencesRepository } from '../dist/infrastructure/notification-preferences-repository.js';
import { createdAt, deliveredAt, emailOnly, notificationInput } from '../test-support/fixtures.mjs';

const access = { recipientId: 'rider-001' };
const hasCode = (code) => (error) => error.code === code;

test('notification uses the scoped recipient and stores a template reference with a pending audit', () => {
  const input = { ...notificationInput(), recipientId: 'untrusted', otp: 'unused', renderedBody: 'unused' };
  const stored = createMessage(access, input, new Date(createdAt));
  assert.deepEqual(stored, {
    ...notificationInput(), recipientId: access.recipientId, status: 'pending',
    createdAt, updatedAt: createdAt, attemptCount: 0, revision: 0,
  });
});

test('delivery results add one audit timestamp and preserve the original message', () => {
  const pending = createMessage(access, notificationInput(), new Date(createdAt));
  for (const status of ['delivered', 'failed']) {
    const terminal = finishMessage(pending, status, new Date(deliveredAt));
    assert.deepEqual(terminal, {
      ...pending, status, updatedAt: deliveredAt, lastAttemptAt: deliveredAt, attemptCount: 1, revision: 1,
    });
    assert.throws(() => finishMessage(terminal, status), hasCode('conflict'));
  }
  assert.throws(() => finishMessage(pending, 'delivered', new Date('2025-01-01')), hasCode('invalid'));
});

test('domain validation rejects unsupported channels, identifiers and preferences', () => {
  for (const invalid of [
    { channel: 'fax' }, { type: 'Unknown' }, { correlationId: 'bad/id' }, { templateId: 'a#b' },
  ]) {
    assert.throws(() => createMessage(access, { ...notificationInput(), ...invalid }), hasCode('invalid'));
  }
  assert.throws(() => createMessage({ recipientId: '' }, notificationInput()), hasCode('invalid'));
  assert.throws(() => notificationChannels({ ...emailOnly, email: 'yes' }), hasCode('invalid'));
  assert.deepEqual(defaultPreferences(access), {
    userId: 'rider-001', email: false, sms: false, push: false, revision: null, updatedAt: null,
  });
});

test('the local client rejects cloud endpoints and embedded credentials', () => {
  for (const endpoint of ['https://dynamodb.us-east-1.amazonaws.com', 'http://user:secret@127.0.0.1:8000']) {
    assert.throws(() => createNotificationDocumentClient(endpoint), /local DynamoDB HTTP origin/);
  }
});

test('both repositories distinguish connection failures from missing records', async (t) => {
  const server = createServer((socket) => socket.destroy());
  server.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const client = createNotificationDocumentClient(`http://127.0.0.1:${server.address().port}`);
  t.after(() => client.destroy());

  const logs = new DynamoDbMessageLogRepository(client);
  const preferences = new DynamoDbNotificationPreferencesRepository(client);
  await assert.rejects(logs.findById(access, 'message-001'), hasCode('storage_failure'));
  await assert.rejects(logs.list(access), hasCode('storage_failure'));
  await assert.rejects(preferences.get(access), hasCode('storage_failure'));
});
