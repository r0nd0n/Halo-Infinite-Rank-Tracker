import { SERVICE_HOSTS, PLAYLISTS, csrToTier } from '../config.js';
import { ensureTokens } from '../auth/tokens.js';

/** Wrap a raw XUID for the 343 APIs. */
export function wrapXuid(xuid) {
  return `xuid(${String(xuid).trim()})`;
}

/** Pull a numeric XUID out of "xuid(123...)" (or return the digits as-is). */
export function unwrapXuid(id) {
  const m = /xuid\((\d+)\)/i.exec(String(id));
  return m ? m[1] : String(id);
}

/** Normalize one CsrContainer into the app's rank shape. */
function normalizeContainer(container) {
  if (!container) return null;
  const value = Number(container.Value ?? container.value ?? -1);
  const tierName = container.Tier ?? container.tier ?? '';
  const subTier = Number(container.SubTier ?? container.subTier ?? 0);
  const remaining = Number(
    container.MeasurementMatchesRemaining ?? container.measurementMatchesRemaining ?? 0
  );

  if (!tierName || value < 0) {
    // Still in placement matches.
    return {
      tier: 'Placements',
      subTier: 0,
      csr: null,
      placementsRemaining: remaining,
      tierStart: null,
    };
  }

  return {
    tier: tierName || csrToTier(value).tier,
    subTier: subTier || csrToTier(value).subTier,
    csr: value,
    placementsRemaining: remaining,
    tierStart: Number(container.TierStart ?? container.tierStart ?? 0),
  };
}

function normalizeRank(entry) {
  const result = entry.Result || entry.result || {};
  return {
    current: normalizeContainer(result.Current || result.current),
    seasonMax: normalizeContainer(result.SeasonMax || result.seasonMax),
    allTimeMax: normalizeContainer(result.AllTimeMax || result.allTimeMax),
  };
}

function pickGamerpic(user) {
  if (!user) return null;
  return (
    user.Gamerpic?.Small ??
    user.Gamerpic?.Medium ??
    user.Gamerpic?.Large ??
    user.gamerpic?.small ??
    user.gamerpic ??
    null
  );
}

async function apiGet(url, tokens, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'x-343-authorization-spartan': tokens.spartan,
          '343-clearance': tokens.clearance,
          Accept: 'application/json',
        },
      });
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(`Unauthorized (${resp.status}). Tokens may be expired.`);
      }
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
      return await resp.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Resolve a gamertag to a profile (xuid + gamerpic) via the profile service. */
async function resolveUser(gamertag, tokens) {
  const url = `${SERVICE_HOSTS.profile}/users/gt(${encodeURIComponent(gamertag)})`;
  const data = await apiGet(url, tokens);
  if (!data) return null;
  return {
    xuid: String(data.Xuid ?? data.xuid ?? ''),
    gamertag: data.Gamertag ?? data.gamertag ?? gamertag,
    gamerpic: pickGamerpic(data),
  };
}

/**
 * Official 343 provider. Requires Spartan + clearance tokens (see auth/tokens.js).
 * Returns one result per input gamertag with ranks for every tracked playlist.
 */
export async function fetchRanksOfficial(gamertags, { season = '', onProgress } = {}) {
  const tokens = await ensureTokens();

  // 1) Resolve each gamertag to a profile.
  const resolved = [];
  for (const gamertag of gamertags) {
    try {
      const user = await resolveUser(gamertag, tokens);
      if (!user || !user.xuid) {
        resolved.push({ input: gamertag, found: false, error: 'Gamertag not found' });
      } else {
        resolved.push({ input: gamertag, found: true, ...user });
      }
    } catch (err) {
      resolved.push({ input: gamertag, found: false, error: err.message });
    }
    if (onProgress) onProgress(`Resolved ${gamertag}`);
  }

  const xuids = resolved.filter((r) => r.found).map((r) => r.xuid);

  // 2) Fetch CSR for all found players, one batch per playlist.
  const byXuid = new Map();
  if (xuids.length) {
    for (const playlist of PLAYLISTS) {
      const params = new URLSearchParams();
      for (const xuid of xuids) params.append('players', wrapXuid(xuid));
      if (season) params.set('season', season);
      const url = `${SERVICE_HOSTS.skill}/hi/playlist/${playlist.id}/csrs?${params.toString()}`;
      try {
        const data = await apiGet(url, tokens);
        const values = data?.Value ?? data?.value ?? [];
        for (const entry of values) {
          const id = unwrapXuid(entry.Id ?? entry.id ?? '');
          if (!byXuid.has(id)) byXuid.set(id, {});
          byXuid.get(id)[playlist.key] = {
            ...normalizeRank(entry),
            source: 'official',
          };
        }
      } catch (err) {
        for (const xuid of xuids) {
          if (!byXuid.has(xuid)) byXuid.set(xuid, {});
          byXuid.get(xuid)[playlist.key] = { error: err.message };
        }
      }
      if (onProgress) onProgress(`Fetched ${playlist.label}`);
    }
  }

  // 3) Merge back onto the input order.
  return gamertags.map((input) => {
    const r = resolved.find((x) => x.input === input);
    if (!r || !r.found) {
      return {
        input,
        gamertag: input,
        found: false,
        xuid: null,
        gamerpic: null,
        source: 'official',
        error: r?.error || 'Not found',
        ranks: {},
      };
    }
    const ranks = byXuid.get(r.xuid) || {};
    return {
      input,
      gamertag: r.gamertag || input,
      found: true,
      xuid: r.xuid,
      gamerpic: r.gamerpic,
      source: 'official',
      error: null,
      ranks,
    };
  });
}
