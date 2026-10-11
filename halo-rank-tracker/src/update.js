import { readAccountEntries, emptyCache } from './accounts.js';
import { PLAYLISTS, config } from './config.js';
import { readCache, writeCache, isFresh, todayKey } from './cache.js';
import { fetchRanks } from './providers/index.js';

/**
 * Refresh the cache if it is stale (or `force` is set) and return the cache.
 *
 * A run is "daily": if the cache was already generated today for the same
 * account list, the network fetch is skipped entirely.
 *
 * @returns {Promise<{cache:object, updated:boolean, reason:string, provider?:string}>}
 */
export async function updateCache({ force = false, provider = config.provider, onProgress } = {}) {
  const entries = readAccountEntries();
  const accounts = entries.map((e) => e.gamertag);
  const existing = readCache();

  const sameAccounts =
    Array.isArray(existing.accounts) &&
    existing.accounts.length === accounts.length &&
    existing.accounts.every((a, i) => a.input === accounts[i]);

  if (!force && isFresh(existing) && sameAccounts) {
    return { cache: existing, updated: false, reason: 'fresh' };
  }

  if (!accounts.length) {
    return {
      cache: { ...emptyCache(), date: todayKey(), generatedAt: new Date().toISOString(), provider },
      updated: false,
      reason: 'no-accounts',
    };
  }

  const { provider: used, results, seasonId, playlists, attempts } = await fetchRanks(accounts, {
    provider,
    onProgress,
  });

  // Attach the optional sign-in email from accounts.txt to each account so the
  // page can copy it on click. Matched case-insensitively by gamertag.
  const emailByTag = new Map(
    entries.map((e) => [e.gamertag.toLowerCase(), e.email])
  );
  const accountsOut = results.map((r) => ({
    ...r,
    email: emailByTag.get(String(r.input || r.gamertag || '').toLowerCase()) || null,
  }));

  const cache = {
    date: todayKey(),
    generatedAt: new Date().toISOString(),
    provider: used,
    requestedProvider: provider,
    season: seasonId || config.season || null,
    playlists: (playlists && playlists.length ? playlists : PLAYLISTS).map((p) => ({
      key: p.key,
      label: p.label,
      id: p.id,
      count: p.count,
      error: p.error,
    })),
    attempts,
    accounts: accountsOut,
  };

  writeCache(cache);
  return { cache, updated: true, reason: 'fetched', provider: used };
}
