import { config } from '../config.js';
import { fetchRanksOfficial } from './official.js';
import { fetchRanksWaypoint } from './waypoint.js';
import { fetchRanksSpartanRecord } from './spartanrecord.js';
import { fetchRanksMock } from './mock.js';

/**
 * Provider selection.
 *
 *   mock         - built-in sample data, never fails
 *   waypoint     - public leaderboards, no login (Onyx-only coverage)
 *   spartanrecord- SpartanRecord's HaloDotAPI proxy, no login (full coverage)
 *   official     - official API, needs credentials
 *   auto         - official, then spartanrecord, then waypoint, then mock
 */

function normalizeProviderResult(result, gamertags) {
  // Providers return either { results, ... } or a bare array. Normalize.
  if (Array.isArray(result)) return { results: result, seasonId: null, playlists: [] };
  return result;
}

async function runOfficial(gamertags, opts) {
  const results = await fetchRanksOfficial(gamertags, opts);
  return { results, seasonId: config.season || null, playlists: [] };
}

const PROVIDERS = {
  official: (gamertags, opts) => runOfficial(gamertags, opts),
  spartanrecord: (gamertags, opts) => fetchRanksSpartanRecord(gamertags, opts),
  waypoint: (gamertags, opts) => fetchRanksWaypoint(gamertags, opts),
  mock: (gamertags, opts) => fetchRanksMock(gamertags, opts),
};

/**
 * Fetch ranks using the configured provider (or the auto chain).
 * Resolves to { provider, results, seasonId, playlists, attempts }.
 */
export async function fetchRanks(gamertags, { provider = config.provider, onProgress } = {}) {
  if (!gamertags.length) {
    return { provider: provider === 'auto' ? 'mock' : provider, results: [], seasonId: null, playlists: [], attempts: [] };
  }

  const order =
    provider === 'auto'
      ? ['official', 'spartanrecord', 'waypoint', 'mock']
      : [provider];

  const attempts = [];
  for (const name of order) {
    const fn = PROVIDERS[name];
    if (!fn) throw new Error(`Unknown provider: ${name}`);
    try {
      const raw = await fn(gamertags, { onProgress });
      const { results, seasonId, playlists } = normalizeProviderResult(raw, gamertags);
      return { provider: name, results, seasonId, playlists, attempts };
    } catch (err) {
      attempts.push({ provider: name, error: err.message });
      if (provider !== 'auto') throw err;
      if (onProgress) onProgress(`Provider ${name} failed: ${err.message}; trying next`);
    }
  }

  throw new Error(
    `All providers failed: ${attempts.map((a) => `${a.provider} (${a.error})`).join('; ')}`
  );
}
