import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../src/server.js';

/** Start the real app server on an ephemeral port for HTTP-level checks. */
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

test('GET /api/health reports ok', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('GET /api/ranks returns a cache-shaped payload', async () => {
  const res = await fetch(`${base}/api/ranks`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.accounts));
  assert.ok(Array.isArray(body.playlists));
  assert.equal(typeof body.fresh, 'boolean');
});

test('GET / serves the HTML page and static assets have correct MIME', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  assert.match(await page.text(), /Halo Infinite Rank Tracker/);

  const js = await fetch(`${base}/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type') || '', /javascript/);

  const css = await fetch(`${base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /text\/css/);
});

test('unknown paths and traversal attempts do not leak project files', async () => {
  assert.equal((await fetch(`${base}/nope.html`)).status, 404);
  const trav = await fetch(`${base}/../package.json`);
  assert.equal(trav.status, 404);
});

test('GET on /api/refresh is not allowed to mutate (only POST)', async () => {
  const res = await fetch(`${base}/api/refresh`);
  // Falls through to static handling; must not return cached JSON.
  assert.equal(res.status, 404);
});
