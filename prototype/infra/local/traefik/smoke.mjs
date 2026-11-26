import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

const port = Number(process.env.LOCAL_GATEWAY_PORT ?? 8080);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Set LOCAL_GATEWAY_PORT to the published port.');
const origin = `http://127.0.0.1:${port}`;
const prefix = '/v1/ride-requests';

test('the four public operations reach SVC-02 without bypassing authentication', async () => {
  const paths = [
    ['POST', prefix], ['GET', `${prefix}/ride-001`],
    ['POST', `${prefix}/ride-001/confirm`], ['POST', `${prefix}/ride-001/cancel`],
  ];
  const requestIds = new Set();
  for (const [method, path] of paths) {
    const correlationId = `gateway-smoke-${requestIds.size}`;
    const response = await globalThis.fetch(origin + path, {
      method,
      headers: {
        'X-Correlation-ID': correlationId,
        Authorization: 'Bearer unverified-gateway-fixture',
        'X-Rider-Id': 'rider-001',
        'X-Forwarded-User': 'rider-001',
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.equal(response.headers.get('x-correlation-id'), correlationId);
    const body = await response.json();
    assert.equal(body.error.code, 'UNAUTHENTICATED');
    assert.equal(body.error.correlationId, correlationId);
    assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(response.headers.get('x-request-id'), body.error.requestId);
    requestIds.add(body.error.requestId);
  }
  assert.equal(requestIds.size, paths.length);
});

test('unmatched, internal and administrative routes are blocked at the gateway', async () => {
  const paths = [
    ['GET', '/missing'], ['GET', `${prefix}/ride-001/private`], ['GET', `${prefix}/ride-001/confirm`],
    ['GET', '/v1/internal/drivers/driver-001/eligibility'],
    ['POST', '/v1/internal/notifications/otp'], ['POST', '/v1/fares/final'],
    ['GET', '/v1/agent/trips/trip-001/context'],
    ['GET', '/health/ready'], ['GET', '/ping'], ['GET', '/dashboard/'], ['GET', '/api/rawdata'],
  ];
  for (const [method, path] of paths) {
    const response = await globalThis.fetch(origin + path, { method, redirect: 'manual' });
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(response.headers.get('x-request-id'), null);
    await response.text();
  }
});

test('the edge rejects encoded separators and SVC-02 validates forwarded correlation IDs', async () => {
  const escaped = await globalThis.fetch(`${origin}${prefix}/ride%2Fprivate`);
  assert.equal(escaped.status, 400);
  assert.equal(escaped.headers.get('x-request-id'), null);
  await escaped.text();

  const malformed = await globalThis.fetch(`${origin}${prefix}/ride-001`, {
    headers: { 'X-Correlation-ID': 'bad/id' },
  });
  assert.equal(malformed.status, 400);
  const body = await malformed.json();
  assert.equal(body.error.code, 'BAD_REQUEST');
  assert.equal(body.error.details[0].path, 'X-Correlation-ID');
  assert.equal(malformed.headers.get('x-correlation-id'), body.error.correlationId);
});
