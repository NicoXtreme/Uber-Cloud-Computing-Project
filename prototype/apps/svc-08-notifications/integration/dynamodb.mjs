import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { defaultPreferences } from '../dist/domain/notifications.js';
import { createNotificationDocumentClient, notificationTable } from '../dist/infrastructure/dynamodb.js';
import { DynamoDbMessageLogRepository } from '../dist/infrastructure/message-log-repository.js';
import { DynamoDbNotificationPreferencesRepository } from '../dist/infrastructure/notification-preferences-repository.js';
import { createdAt, deliveredAt, emailOnly, notificationInput } from '../test-support/fixtures.mjs';

const worker = fileURLToPath(new URL('./notification-process.mjs', import.meta.url));
const run = promisify(execFile);
const hasCode = (code) => (error) => error.code === code;

function setup(t) {
  const suffix = randomUUID();
  const owner = { recipientId: `own-${suffix}` };
  const other = { recipientId: `other-${suffix}` };
  const client = createNotificationDocumentClient();
  const keys = [`preferences#${owner.recipientId}`, `preferences#${other.recipientId}`];
  t.after(async () => {
    try {
      await Promise.all(keys.map((notification_id) => client.send(new DeleteCommand({
        TableName: notificationTable, Key: { notification_id },
      }))));
    } finally {
      client.destroy();
    }
  });

  function id(name) {
    const key = `message-${suffix}-${name}`;
    keys.push(key);
    return key;
  }
  return {
    owner, other, id,
    logs: new DynamoDbMessageLogRepository(client),
    preferences: new DynamoDbNotificationPreferencesRepository(client),
  };
}

test('a second SVC-08 process reads the log and preferences after the writer exits', { timeout: 15000 }, async (t) => {
  const { owner, id } = setup(t);
  const messageId = id('restart');
  const written = JSON.parse((await run(process.execPath, [worker, 'create', owner.recipientId, messageId], { timeout: 6000 })).stdout);
  const read = JSON.parse((await run(process.execPath, [worker, 'read', owner.recipientId, messageId], { timeout: 6000 })).stdout);
  assert.deepEqual(read, written);
  assert.deepEqual(read[0], {
    ...notificationInput(messageId), recipientId: owner.recipientId, status: 'pending',
    createdAt, updatedAt: createdAt, attemptCount: 0, revision: 0,
  });
  assert.deepEqual(read[1], { ...emailOnly, userId: owner.recipientId, revision: 0, updatedAt: createdAt });
});

test('history paginates only the scoped recipient with stable timestamp ties', async (t) => {
  const { owner, other, id, logs, preferences } = setup(t);
  const [first, second, third, foreign] = ['a', 'b', 'c', 'other'].map(id);
  await logs.create(owner, notificationInput(first), new Date(createdAt));
  for (const key of [second, third]) await logs.create(owner, notificationInput(key), new Date(deliveredAt));
  await logs.create(other, notificationInput(foreign), new Date(deliveredAt));
  await preferences.save(owner, emailOnly, null);

  const page = await logs.list(owner, { limit: 2 });
  assert.deepEqual(page.items.map((item) => item.id), [third, second]);
  assert.ok(page.nextCursor);
  await assert.rejects(logs.list(other, { cursor: page.nextCursor }), hasCode('invalid'));
  const last = await logs.list(owner, { limit: 2, cursor: page.nextCursor });
  assert.deepEqual(last.items.map((item) => item.id), [first]);
  assert.equal(last.nextCursor, null);
  assert.deepEqual((await logs.list(other)).items.map((item) => item.id), [foreign]);
  await assert.rejects(logs.list(owner, { cursor: 'invalid' }), hasCode('invalid'));
  for (const limit of [0, 101, 1.5]) await assert.rejects(logs.list(owner, { limit }), hasCode('invalid'));
});

test('missing and foreign messages cannot be read or changed, and terminal updates are conditional', async (t) => {
  const { owner, other, id, logs } = setup(t);
  const key = id('audit');
  assert.equal(await logs.findById(owner, key), null);
  await assert.rejects(logs.recordResult(owner, key, 0, 'failed'), hasCode('not_found'));

  const created = await logs.create(owner, notificationInput(key), new Date(createdAt));
  assert.equal(await logs.findById(other, key), null);
  await assert.rejects(logs.recordResult(other, key, 0, 'delivered'), hasCode('not_found'));
  await assert.rejects(logs.create(other, notificationInput(key)), hasCode('conflict'));
  assert.deepEqual(await logs.findById(owner, key), created);

  const results = await Promise.allSettled(['delivered', 'failed'].map(
    (status) => logs.recordResult(owner, key, 0, status, new Date(deliveredAt)),
  ));
  const [winner] = results.filter((result) => result.status === 'fulfilled');
  const [loser] = results.filter((result) => result.status === 'rejected');
  assert.equal(loser.reason.code, 'conflict');
  assert.deepEqual(await logs.findById(owner, key), {
    ...created, status: winner.value.status, updatedAt: deliveredAt, lastAttemptAt: deliveredAt,
    revision: 1, attemptCount: 1,
  });
});

test('preference defaults are owner-scoped and competing replacements preserve one winning revision', async (t) => {
  const { owner, other, preferences } = setup(t);
  assert.deepEqual(await preferences.get(owner), defaultPreferences(owner));
  const initial = await preferences.save(owner, emailOnly, null, new Date(createdAt));
  assert.equal(initial.revision, 0);
  assert.deepEqual(await preferences.get(other), defaultPreferences(other));

  await assert.rejects(preferences.save(owner, emailOnly, null), hasCode('conflict'));
  await assert.rejects(preferences.save(other, emailOnly, initial.revision), hasCode('conflict'));
  const candidates = [{ ...emailOnly, push: true }, { ...emailOnly, sms: true }];
  const results = await Promise.allSettled(candidates.map(
    (candidate) => preferences.save(owner, candidate, initial.revision, new Date(deliveredAt)),
  ));
  const [winner] = results.filter((result) => result.status === 'fulfilled');
  const [loser] = results.filter((result) => result.status === 'rejected');
  assert.equal(loser.reason.code, 'conflict');
  assert.equal(winner.value.revision, 1);
  assert.deepEqual(await preferences.get(owner), winner.value);
  assert.deepEqual(await preferences.get(other), defaultPreferences(other));
});
