#!/usr/bin/env node
/**
 * Download every Halo Infinite CSR rank badge into public/images/ so the
 * packaged app can serve them locally (no hotlinking, no ERR_BLOCKED_BY_ORB).
 *
 * Works anywhere Node.js 18+ is installed (Windows, macOS, Linux):
 *
 *   node scripts/download-badges.mjs
 *   node scripts/download-badges.mjs --force          # overwrite existing files
 *   node scripts/download-badges.mjs --out=public/images
 *
 * The files keep their leafapp.co names so the app can find them unchanged:
 *   onyx.png
 *   {bronze,silver,gold,platinum,diamond}-{1..6}.png
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const SOURCE_BASE = 'https://leafapp.co/images/csrs/';
const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
const SUB_TIERS = [1, 2, 3, 4, 5, 6];

/** Every badge filename, in download order. */
const FILES = [
  'onyx.png',
  ...TIERS.flatMap((tier) => SUB_TIERS.map((n) => `${tier}-${n}.png`)),
];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parseArgs(argv) {
  let out = join(PROJECT_ROOT, 'public', 'images');
  let force = false;
  for (const arg of argv) {
    if (arg === '--force' || arg === '-f') force = true;
    else if (arg.startsWith('--out=')) out = resolve(arg.slice('--out='.length));
  }
  return { out, force };
}

function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_MAGIC);
}

async function downloadOne(file, { out, force }) {
  const dest = join(out, file);
  if (!force && existsSync(dest)) {
    return { file, status: 'skipped' };
  }

  const res = await fetch(SOURCE_BASE + file, {
    redirect: 'follow',
    headers: {
      // The host serves a bot challenge to bare clients; a normal browser-ish
      // request gives the best chance of receiving the real PNG.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://leafapp.co/',
    },
  });

  if (!res.ok) {
    return { file, status: 'failed', reason: `HTTP ${res.status}` };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!isPng(buffer)) {
    const type = res.headers.get('content-type') || 'unknown';
    return {
      file,
      status: 'failed',
      reason: `not a PNG (${type}) — the host likely returned a bot/HTML challenge`,
    };
  }

  await writeFile(dest, buffer);
  return { file, status: 'saved', bytes: buffer.length };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(opts.out, { recursive: true });

  console.log(`Downloading ${FILES.length} badges from ${SOURCE_BASE}`);
  console.log(`Into: ${opts.out}\n`);

  let saved = 0;
  let skipped = 0;
  const failures = [];

  for (const file of FILES) {
    try {
      const result = await downloadOne(file, opts);
      if (result.status === 'saved') {
        saved += 1;
        console.log(`  saved   ${file} (${result.bytes} bytes)`);
      } else if (result.status === 'skipped') {
        skipped += 1;
        console.log(`  skipped ${file} (already exists, use --force)`);
      } else {
        failures.push(result);
        console.log(`  FAILED  ${file}: ${result.reason}`);
      }
    } catch (err) {
      failures.push({ file, reason: err.message });
      console.log(`  FAILED  ${file}: ${err.message}`);
    }
  }

  console.log(
    `\nDone. saved=${saved} skipped=${skipped} failed=${failures.length}`
  );

  if (failures.length) {
    console.log(
      '\nSome files did not download as real PNGs. leafapp.co protects its\n' +
        'assets with a bot challenge, so a script may receive HTML instead.\n' +
        'If that happens, download the images in a browser and drop them into\n' +
        'the images folder by hand, keeping the exact filenames listed above.'
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
