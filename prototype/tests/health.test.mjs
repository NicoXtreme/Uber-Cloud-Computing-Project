import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const appsUrl = new URL('../apps/', import.meta.url);
const entries = await readdir(appsUrl, { withFileTypes: true });

for (const entry of entries.filter((entry) => entry.isDirectory())) {
  test(`${entry.name} serves both health endpoints`, async (t) => {
    const service = entry.name.slice(0, 6);
    const appUrl = new URL(`${entry.name}/dist/app.js`, appsUrl);
    const { default: { app } } = await import(appUrl.href);
    const server = app.listen(0, '127.0.0.1');
    t.after(() => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }));
    await once(server, 'listening');

    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/health/live', '/health/ready']) {
      const response = await globalThis.fetch(new URL(path, origin));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { service, status: 'ok' });
    }
  });
}
