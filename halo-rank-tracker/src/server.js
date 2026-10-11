import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { PUBLIC_DIR, config } from './config.js';
import { readCache } from './cache.js';
import { updateCache } from './update.js';
import { isFresh } from './cache.js';
import { addAccount, removeAccount, listAccountEntries, mergeAccountList } from './accounts.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

/** Read and parse a small JSON request body. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

export function createAppServer({ onRefresh } = {}) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    try {
      if (path === '/api/ranks') {
        const cache = readCache();
        sendJson(res, 200, { ...mergeAccountList(cache), fresh: isFresh(cache) });
        return;
      }

      if (path === '/api/accounts') {
        if (req.method === 'GET') {
          sendJson(res, 200, { accounts: listAccountEntries() });
          return;
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req);
          try {
            const account = addAccount({ gamertag: body.gamertag, email: body.email });
            sendJson(res, 200, { ok: true, account, accounts: listAccountEntries() });
          } catch (err) {
            sendJson(res, 400, { error: err.message });
          }
          return;
        }
        if (req.method === 'DELETE') {
          const body = await readJsonBody(req);
          try {
            const result = removeAccount(body.gamertag);
            sendJson(res, 200, { ok: true, ...result, accounts: listAccountEntries() });
          } catch (err) {
            sendJson(res, 400, { error: err.message });
          }
          return;
        }
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      if (path === '/api/health') {
        sendJson(res, 200, { ok: true, provider: config.provider });
        return;
      }

      if (path === '/api/refresh' && req.method === 'POST') {
        const force = url.searchParams.get('force') === '1';
        const result = await updateCache({ force });
        sendJson(res, 200, { ...result.cache, updated: result.updated, reason: result.reason });
        if (onRefresh) onRefresh(result);
        return;
      }

      await serveStatic(res, path);
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: err.message });
    }
  });
}

export function startServer({ port = config.port, onRefresh } = {}) {
  const server = createAppServer({ onRefresh });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}
