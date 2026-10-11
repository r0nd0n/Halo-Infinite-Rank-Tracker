import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const ROOT = resolve(__dirname, '..');
export const PUBLIC_DIR = join(ROOT, 'public');

// Writable files live in USER_DIR. The packaged Electron app runs from a
// read-only asar archive, so its main process sets HALO_USER_DIR to Electron's
// per-user data folder before importing this module. Plain CLI use leaves it
// unset and keeps the original project-root layout.
export const USER_DIR = process.env.HALO_USER_DIR ? resolve(process.env.HALO_USER_DIR) : ROOT;
export const DATA_DIR = join(USER_DIR, 'data');
export const ACCOUNTS_FILE = join(USER_DIR, 'accounts.txt');
export const CACHE_FILE = join(DATA_DIR, 'cache.json');
export const AUTH_FILE = join(DATA_DIR, 'auth.json');
export const ENV_FILE = join(USER_DIR, '.env');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const ACCOUNTS_TEMPLATE = `# One Halo Infinite gamertag per line. Blank lines and lines starting with # are ignored.
#
# Optionally append the sign-in email after a dash; clicking the gamertag on the
# page then copies that email. The address is never shown on the page.
#
#   MasterChief
#   MasterChief-chief@example.com
#
# You can also manage this list from the dashboard (+ Add Account) and refresh there.
`;

/**
 * Create the editable accounts file on first run. The packaged app cannot ship
 * a writable copy, so it seeds one in the per-user data folder.
 * @returns {{created:boolean, file:string}}
 */
export function ensureUserFiles() {
  if (!existsSync(ACCOUNTS_FILE)) {
    writeFileSync(ACCOUNTS_FILE, ACCOUNTS_TEMPLATE, 'utf8');
    return { created: true, file: ACCOUNTS_FILE };
  }
  return { created: false, file: ACCOUNTS_FILE };
}

/**
 * Minimal .env loader (no dependency). Real environment variables always win,
 * so `PORT=3000 node src/index.js` overrides a value in the file.
 */
function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return;
  const text = readFileSync(ENV_FILE, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

/** The four ranked playlists this app tracks. */
export const PLAYLISTS = [
  { key: 'ranked-arena', label: 'Ranked Arena', id: 'edfef3ac-9cbe-4fa2-b949-8f29deafd483' },
  { key: 'ranked-doubles', label: 'Ranked Doubles', id: 'fa5aa2a3-2428-4912-a023-e1eeea7b877c' },
  { key: 'ranked-slayer', label: 'Ranked Slayer', id: 'dcb2e24e-05fb-4390-8076-32a0cdb4326e' },
  { key: 'ranked-snipers', label: 'Ranked Snipers', id: '6233381c-fc96-40b9-b1ff-f6a4de72dd7a' },
];

export const SERVICE_HOSTS = {
  profile: 'https://profile.svc.halowaypoint.com',
  skill: 'https://skill.svc.halowaypoint.com',
  waypoint: 'https://www.halowaypoint.com',
};

export const config = {
  provider: (process.env.PROVIDER || 'auto').toLowerCase(),
  port: Number(process.env.PORT) || 5173,
  season: process.env.HALO_SEASON || '',
  spartanToken: process.env.HALO_SPARTAN_TOKEN || '',
  clearanceToken: process.env.HALO_CLEARANCE_TOKEN || '',
  refreshToken: process.env.HALO_REFRESH_TOKEN || '',
  clientId: process.env.HALO_AZURE_CLIENT_ID || '',
  clientSecret: process.env.HALO_AZURE_CLIENT_SECRET || '',
  redirectUri: process.env.HALO_AZURE_REDIRECT_URI || 'http://localhost',
};

/** Halo Infinite CSR tiers. Onyx starts at 1500; everything else is banded. */
export const TIERS = [
  { name: 'Bronze', min: 0, max: 149, division: 25 },
  { name: 'Silver', min: 150, max: 299, division: 25 },
  { name: 'Gold', min: 300, max: 449, division: 25 },
  { name: 'Platinum', min: 450, max: 599, division: 25 },
  { name: 'Diamond', min: 600, max: 1499, division: 150 },
  { name: 'Onyx', min: 1500, max: Infinity, division: Infinity },
];

/** Map a raw CSR number to { tier, subTier } (used as a fallback). */
export function csrToTier(value) {
  if (value === null || value === undefined || value < 0) {
    return { tier: 'Unranked', subTier: 0 };
  }
  for (const band of TIERS) {
    if (value <= band.max) {
      if (band.name === 'Onyx') return { tier: 'Onyx', subTier: 0 };
      const subTier = Math.min(6, Math.max(1, Math.floor((value - band.min) / band.division) + 1));
      return { tier: band.name, subTier };
    }
  }
  return { tier: 'Onyx', subTier: 0 };
}
