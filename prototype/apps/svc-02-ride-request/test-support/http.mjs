import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { loadContract, validatePayload } from '../../../packages/contracts/scripts/openapi.mjs';
import { newRideRequest } from './ride-request.mjs';

export const rideRequestsPath = '/v1/ride-requests';
const contract = await loadContract('svc-02');
export const creation = contract.paths[rideRequestsPath].post;
export const lookup = contract.paths[`${rideRequestsPath}/{id}`].get;
export const rideInput = creation.requestBody.content['application/json'].examples.sample.value;

export const riderHeaders = Object.freeze({ Authorization: 'Bearer rider-one-test-token' });

const testPrincipals = new Map([
  ['rider-one-test-token', { subject: 'rider-001', role: 'rider' }],
  ['rider-two-test-token', { subject: 'rider-002', role: 'rider' }],
  ['driver-test-token', { subject: 'driver-001', role: 'driver' }],
]);

export async function verifyTestBearer(token) {
  return testPrincipals.get(token) ?? null;
}

export async function getTestQuote() {
  return { ...newRideRequest().quote, id: randomUUID(), expiresAt: new Date(Date.now() + 300_000).toISOString() };
}

export async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

export function post(origin, body = rideInput, headers = {}) {
  return globalThis.fetch(`${origin}${rideRequestsPath}`, {
    method: 'POST',
    headers: { ...riderHeaders, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'error',
  });
}

export async function assertContractResponse(response, operation, status) {
  assert.equal(response.status, status);
  const contractResponse = operation.responses[status];
  assert.ok(contractResponse, `Expected an OpenAPI response for status ${status}`);
  assert.match(response.headers.get('content-type'), /^application\/json\b/);

  for (const [name, header] of Object.entries(contractResponse.headers ?? {})) {
    const value = response.headers.get(name);
    if (header.required) assert.notEqual(value, null, name);
    if (value !== null) {
      // OpenAPI's singular example is an annotation outside JSON Schema validation.
      const schema = { ...header.schema };
      delete schema.example;
      const { valid, errors } = validatePayload(schema, value);
      assert.ok(valid, `${name}: ${JSON.stringify(errors)}`);
    }
  }

  if (status !== 201) assert.equal(response.headers.get('location'), null);
  const body = await response.json();
  const { valid, errors } = validatePayload(contractResponse.content['application/json'].schema, body);
  assert.ok(valid, JSON.stringify(errors));
  if (status >= 400) {
    assert.equal(body.error.requestId, response.headers.get('X-Request-ID'));
    assert.equal(body.error.correlationId, response.headers.get('X-Correlation-ID'));
  }
  return body;
}
