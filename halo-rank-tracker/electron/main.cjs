'use strict';

/**
 * Electron entry point.
 *
 * Runs the Halo Rank Tracker HTTP server in the background and controls it from
 * a system-tray icon. There is no application window; "Open dashboard" launches
 * the local page in the user's normal browser.
 *
 * Before importing the app's ESM modules this sets HALO_USER_DIR to Electron's
 * per-user data folder, so accounts.txt, the cache and any .env live outside the
 * read-only application archive and survive upgrades.
 */
const { app, Tray, Menu, shell, nativeImage, dialog } = require('electron');
const path = require('node:path');

// Only one tray instance. A second launch just opens the dashboard.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let tray = null;
let httpServer = null;
let baseUrl = null;
let stopScheduler = null;
let mods = null;
let refreshing = false;

async function openDashboard() {
  if (baseUrl) await shell.openExternal(baseUrl);
}

function setTooltip(text) {
  if (tray) tray.setToolTip(text);
}

async function refreshNow(force) {
  if (refreshing || !mods) return;
  refreshing = true;
  setTooltip('Halo Rank Tracker - refreshing...');
  try {
    const result = await mods.update.updateCache({ force });
    const n = result.cache.accounts.length;
    setTooltip(`Halo Rank Tracker - ${n} account${n === 1 ? '' : 's'} (${result.reason})`);
  } catch (err) {
    console.error('Refresh failed:', err);
    setTooltip('Halo Rank Tracker - refresh failed (see console)');
  } finally {
    refreshing = false;
  }
}

function buildTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const img = nativeImage.createFromPath(iconPath);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Halo Rank Tracker');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open dashboard', click: openDashboard },
      { label: 'Refresh now', click: () => refreshNow(true) },
      { type: 'separator' },
      { label: 'Quit', click: shutdown },
    ])
  );
  tray.on('click', openDashboard);
  tray.on('double-click', openDashboard);
}

function shutdown() {
  try {
    if (stopScheduler) stopScheduler();
  } catch {}
  try {
    if (httpServer) httpServer.close();
  } catch {}
  app.quit();
}

async function startHttpServer() {
  const { server, config } = mods;
  const wanted = config.config.port;
  try {
    return await server.startServer({ port: wanted });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`Port ${wanted} is in use; falling back to a free port.`);
      return await server.startServer({ port: 0 });
    }
    throw err;
  }
}

async function main() {
  process.env.HALO_USER_DIR = app.getPath('userData');

  const config = await import('../src/config.js');
  config.ensureUserFiles();
  const server = await import('../src/server.js');
  const update = await import('../src/update.js');
  const scheduler = await import('../src/scheduler.js');
  mods = { config, server, update, scheduler };

  httpServer = await startHttpServer();
  const { port } = httpServer.address();
  baseUrl = `http://localhost:${port}`;
  console.log(`Halo Rank Tracker listening at ${baseUrl}`);

  buildTray();

  // Populate on first launch; the cache layer skips a same-day refetch.
  refreshNow(false).then(() => {
    stopScheduler = scheduler.startScheduler({
      hour: 6,
      minute: 0,
      onRun: (r) => setTooltip(`Halo Rank Tracker - refreshed (${r.reason})`),
    });
  });
}

app.on('second-instance', openDashboard);

app
  .whenReady()
  .then(main)
  .catch((err) => {
    dialog.showErrorBox('Halo Rank Tracker failed to start', String((err && err.stack) || err));
    app.quit();
  });

app.on('before-quit', () => {
  try {
    if (httpServer) httpServer.close();
  } catch {}
});
