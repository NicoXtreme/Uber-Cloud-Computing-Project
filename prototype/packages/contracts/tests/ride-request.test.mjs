import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContract, validateExamples, validatePayload } from '../scripts/openapi.mjs';

const contract = await loadContract('svc-02');
const creation = contract.paths['/v1/ride-requests'].post;
const lookup = contract.paths['/v1/ride-requests/{id}'].get;
const json = ({ content }) => content['application/json'];

test('SVC-02 documented request and response examples match their schemas', () => {
  assert.ok(validateExamples(contract) > 0);
  const payload = json(creation.requestBody).examples.sample.value;
  const created = json(creation.responses[201]).examples.sample.value;
  assert.equal(created.status, 'pending_confirmation');
  assert.deepEqual(created.pickup, payload.pickup);
  assert.equal(creation.responses[201].headers.Location.example, `/v1/ride-requests/${created.id}`);
  assert.ok(!('Location' in creation.responses[422].headers));

  const found = json(lookup.responses[200]).examples.sample.value;
  assert.equal(found.id, created.id);
  assert.equal(found.status, 'matched');
  assert.equal(json(lookup.responses[404]).examples.sample.value.error.code, 'NOT_FOUND');
  assert.equal(json(creation.responses[422]).examples.sample.value.error.details[0].path, '/pickup/latitude');
});

test('ride creation rejects out-of-range coordinates and missing destination', () => {
  const { schema, examples } = json(creation.requestBody);
  const { pickup, serviceType } = examples.sample.value;
  const invalid = { ...examples.sample.value, pickup: { ...pickup, latitude: 91 } };
  assert.equal(validatePayload(schema, invalid).valid, false);
  assert.equal(validatePayload(schema, { pickup, serviceType }).valid, false);
});

test('ride responses reject an invalid quote expiry and malformed validation errors', () => {
  const success = json(creation.responses[201]);
  const { quote, ...created } = success.examples.sample.value;
  assert.equal(validatePayload(success.schema, { ...created, quote: { ...quote, expiresAt: 'tomorrow' } }).valid, false);

  const validation = json(creation.responses[422]);
  const { error } = validation.examples.sample.value;
  assert.equal(validatePayload(validation.schema, { error: { ...error, details: [] } }).valid, false);
  assert.equal(validatePayload(validation.schema, { error: { ...error, status: 400 } }).valid, false);
});
