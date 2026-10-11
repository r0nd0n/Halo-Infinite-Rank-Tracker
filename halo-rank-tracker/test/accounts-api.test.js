import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the app at a throwaway user dir before the config module is loaded so
// these API tests never touch a real accounts file.
const dir = mkdtempSync(join(tmpdir(), 'halo-api-'));
process.env.HALO_USER_DIR = dir;

const { createAppServer } = await import('../src/server.js');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const server = createAppServer();
const port = await listen(server);
const base = `http://127.0.0.1:${port}`;

after(() => server.close());

function postJson(path, body, method = 'POST') {
  return fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('GET /api/accounts starts empty', async () => {
  const res = await fetch(`${base}/api/accounts`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { accounts: [] });
});

test('POST /api/accounts sanitizes and persists a new account', async () => {
  const res = await postJson('/api/accounts', {
    gamertag: '  Master\u200b Chief ',
    email: ' m@x.com ',
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.account, { gamertag: 'Master Chief', email: 'm@x.com' });
  assert.deepEqual(body.accounts, [{ gamertag: 'Master Chief', email: 'm@x.com' }]);
});

test('POST /api/accounts rejects a duplicate gamertag', async () => {
  const res = await postJson('/api/accounts', { gamertag: 'master chief' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /already being tracked/);
});

test('POST /api/accounts rejects an invalid email', async () => {
  const res = await postJson('/api/accounts', { gamertag: 'Arbiter', email: 'bad@' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /invalid/);
});

test('DELETE /api/accounts removes a tracked account', async () => {
  await postJson('/api/accounts', { gamertag: 'Arbiter' });
  const res = await postJson('/api/accounts', { gamertag: 'arbiter' }, 'DELETE');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.removed, 1);
  assert.deepEqual(body.accounts, [{ gamertag: 'Master Chief', email: 'm@x.com' }]);
});

test('DELETE /api/accounts on a missing account returns 400', async () => {
  const res = await postJson('/api/accounts', { gamertag: 'Ghost' }, 'DELETE');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not in the list/);
});

test('GET /api/ranks merges a freshly added account as pending', async () => {
  await postJson('/api/accounts', { gamertag: 'Fresh' });
  const res = await fetch(`${base}/api/ranks`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const fresh = body.accounts.find((a) => a.gamertag === 'Fresh');
  assert.ok(fresh, 'fresh account should be present');
  assert.equal(fresh.pending, true);
  assert.equal(fresh.found, false);
});

test('unsupported method on /api/accounts returns 405', async () => {
  const res = await fetch(`${base}/api/accounts`, { method: 'PUT' });
  assert.equal(res.status, 405);
});
