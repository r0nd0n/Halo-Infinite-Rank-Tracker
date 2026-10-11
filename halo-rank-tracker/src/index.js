#!/usr/bin/env node
/**
 * Halo Rank Tracker entry point.
 *
 *   npm start                 refresh if stale, then serve
 *   npm run fetch             refresh if stale, then exit
 *   npm run fetch:force       always refresh, then exit
 *   npm run serve             serve only (no refresh)
 *
 * Flags:
 *   --fetch-only        refresh and exit
 *   --serve-only        serve without refreshing
 *   --force             ignore the daily cache and refetch
 *   --provider=<name>   mock | waypoint | official | auto
 *   --port=<number>     override PORT
 */
import { config } from './config.js';
import { updateCache } from './update.js';
import { startServer } from './server.js';
import { startScheduler } from './scheduler.js';

function parseArgs(argv) {
  const opts = { fetchOnly: false, serveOnly: false, force: false, provider: config.provider, port: config.port };
  for (const arg of argv) {
    if (arg === '--fetch-only') opts.fetchOnly = true;
    else if (arg === '--serve-only') opts.serveOnly = true;
    else if (arg === '--force') opts.force = true;
    else if (arg.startsWith('--provider=')) opts.provider = arg.slice('--provider='.length);
    else if (arg.startsWith('--port=')) opts.port = Number(arg.slice('--port='.length));
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

const HELP = `Halo Rank Tracker

Usage: node src/index.js [options]

  --fetch-only        fetch ranks and exit
  --serve-only        serve the cached data without fetching
  --force             ignore today's cache and refetch
  --provider=<name>   mock | waypoint | official | auto (default: ${config.provider})
  --port=<number>     local web server port (default: ${config.port})
  -h, --help          show this help
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  const log = (msg) => console.log(`  ${msg}`);

  let cache;
  if (!opts.serveOnly) {
    console.log(`Fetching ranks (provider: ${opts.provider}${opts.force ? ', forced' : ''})...`);
    const result = await updateCache({ force: opts.force, provider: opts.provider, onProgress: log });
    cache = result.cache;
    if (result.updated) {
      console.log(`Fetched ${cache.accounts.length} account(s) via ${cache.provider}.`);
    } else {
      console.log(`Cache is current for today (${result.reason}); no fetch needed.`);
    }
  }

  if (opts.fetchOnly) return;

  const server = await startServer({ port: opts.port });
  console.log(`\nHalo Rank Tracker running at http://localhost:${opts.port}\n`);

  if (!opts.serveOnly) {
    startScheduler({
      hour: 6,
      minute: 0,
      onProgress: log,
      onRun: (r) => console.log(`Daily refresh complete (${r.reason}).`),
    });
  }

  const shutdown = () => {
    console.log('\nShutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});
