import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { AUTH_FILE, SERVICE_HOSTS, config } from '../config.js';
import { getXboxTokens } from './oauth.js';

const SKEW_MS = 5 * 60 * 1000; // renew 5 minutes early

function readAuthFile() {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeAuthFile(data) {
  writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
}

/**
 * Exchange an Xbox user hash + XSTS token for a Halo "Spartan" token.
 * The Spartan token is what authorizes calls to 343's game services.
 */
async function getSpartanToken(userHash, xstsToken) {
  const resp = await fetch(
    'https://settings.svc.halowaypoint.com/spartan-token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Audience: 'urn:343:s3:services',
        MinVersion: '4',
        Proof: [
          {
            Prefix: 'v1',
            UserHash: userHash,
            Input: xstsToken,
          },
        ],
      }),
    }
  );
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    throw new Error(`Spartan token request failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  return data;
}

/**
 * Exchange an Xbox XSTS token for a Halo "clearance" token, returned in the
 * `343-Clearance` response header.
 */
async function getClearanceToken(xstsToken) {
  const resp = await fetch(`${SERVICE_HOSTS.profile}/hi/profiles/me/clearance`, {
    headers: {
      'x-xbl-contract-version': '3',
      'Accept': 'application/json',
      'Authorization': `XBL3.0 x=${config.xuid || ''};${xstsToken}`,
    },
  });
  const clearance = resp.headers.get('343-clearance');
  if (!resp.ok || !clearance) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Clearance request failed (${resp.status}): ${body.slice(0, 200)}`);
  }
  return clearance;
}

/** True if a stored Spartan token is still usable. */
function isSpartanValid(data) {
  if (!data?.spartan) return false;
  const exp = data.spartanExpiry || 0;
  return Date.now() + SKEW_MS < exp;
}

/**
 * Return usable { spartan, clearance } tokens, refreshing if necessary.
 *
 * Resolution order:
 *   1. A cached, unexpired token pair in data/auth.json
 *   2. Direct env tokens (HALO_SPARTAN_TOKEN / HALO_CLEARANCE_TOKEN)
 *   3. Automatic refresh via HALO_REFRESH_TOKEN (+ Azure app credentials)
 */
export async function ensureTokens({ force = false } = {}) {
  const cached = readAuthFile();
  if (!force && cached && isSpartanValid(cached) && cached.clearance) {
    return { spartan: cached.spartan, clearance: cached.clearance, source: 'cache' };
  }

  if (!force && config.spartanToken && config.clearanceToken) {
    return { spartan: config.spartanToken, clearance: config.clearanceToken, source: 'env' };
  }

  if (!config.refreshToken || !config.clientId) {
    throw new Error(
      'No usable official credentials. Set HALO_SPARTAN_TOKEN and ' +
        'HALO_CLEARANCE_TOKEN in .env, or run `npm run login` to enable ' +
        'automatic refresh. See README.md.'
    );
  }

  const xbox = await getXboxTokens();
  config.xuid = xbox.xuid;
  const spartanData = await getSpartanToken(xbox.userHash, xbox.xstsToken);
  const clearance = await getClearanceToken(xbox.xstsToken);

  const stored = {
    xuid: xbox.xuid,
    spartan: spartanData.SpartanToken,
    spartanExpiry: new Date(spartanData.Expiration).getTime(),
    clearance,
    refreshToken: xbox.refreshToken,
    savedAt: new Date().toISOString(),
  };
  writeAuthFile(stored);

  if (xbox.refreshToken && xbox.refreshToken !== config.refreshToken) {
    // Keep the newest refresh token for the next run.
    config.refreshToken = xbox.refreshToken;
  }

  return { spartan: stored.spartan, clearance: stored.clearance, source: 'refresh' };
}

export function clearTokenCache() {
  if (existsSync(AUTH_FILE)) unlinkSync(AUTH_FILE);
}

export { readAuthFile };
