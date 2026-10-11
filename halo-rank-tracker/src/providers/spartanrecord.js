import { PLAYLISTS, config } from '../config.js';

/**
 * SpartanRecord / HaloDotAPI provider (NO login required).
 *
 * SpartanRecord's Next.js front end reads player data through its own
 * server-side proxy, which injects the HaloDotAPI key before forwarding. The
 * proxy accepts an arbitrary HaloDotAPI path:
 *
 *   GET https://sr-nextjs.vercel.app/api/halodotapi?path=<encoded-path>
 *
 * That lets this app read per-gamertag CSR *and placement progress* for every
 * ranked playlist without tokens, Azure app registration, or a browser session.
 *
 * Caveats:
 *   - It is a third-party endpoint (SpartanRecord -> HaloDotAPI), not an
 *     official 343/Halo API. It can change or disappear without notice.
 *   - It is unauthenticated on our side, but SpartanRecord/HaloDotAPI define
 *     their own acceptable-use terms; use it for personal, low-volume lookups.
 *   - Only use it if you are comfortable relying on a third-party proxy. The
 *     `official` provider remains the supported, first-party route.
 *
 * The CSR response shape (one entry per playlist) is:
 *   { data: [ { id, name, response: { current, season, all_time } } ] }
 * where each rank object has value, tier, sub_tier, tier_start,
 * measurement_matches_remaining and initial_measurement_matches. A negative
 * value means the playlist is still in placements.
 */

const DEFAULT_PROXY = 'https://sr-nextjs.vercel.app/api/halodotapi';
const PROXY = process.env.HALO_HALODOTAPI_PROXY || DEFAULT_PROXY;

// Optional first-party mode: if you have a dotapi.gg (HaloDotAPI) key, set
// HALO_DOTAPI_KEY and the provider talks to the API directly with Leaf's own
// documented headers. Without it the provider uses the credential-free
// SpartanRecord proxy, which injects the key server-side.
const DIRECT_KEY = process.env.HALO_DOTAPI_KEY || '';
const DIRECT_DOMAIN =
  process.env.HALO_DOTAPI_DOMAIN || 'https://grunt.api.dotapi.gg';
const API_VERSION = process.env.HALO_DOTAPI_VERSION || '2023-06-24';

/** Human label for whichever transport is in use. */
const SOURCE = DIRECT_KEY ? 'dotapi' : 'spartanrecord';
const UA =
  'Mozilla/5.0 (compatible; HaloRankTracker/1.0; +https://github.com/)';
const MAX_ATTEMPTS = Number(process.env.HALO_HALODOTAPI_RETRIES) || 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Map HaloDotAPI playlist display names to this app's playlist keys. */
const NAME_TO_KEY = new Map(
  PLAYLISTS.map((p) => [p.label.toLowerCase(), p.key])
);

/** Build a proxied HaloDotAPI URL. The path is encoded once for the proxy. */
export function proxyUrl(apiPath) {
  return `${PROXY}?path=${encodeURIComponent(apiPath)}`;
}

/** Build the per-gamertag CSR path (gamertag encoded for the forwarded URL). */
export function csrsPath(gamertag, season = '') {
  const tag = encodeURIComponent(gamertag);
  const base = `/games/halo-infinite/stats/multiplayer/players/${tag}/csrs`;
  return season ? `${base}?season_csr=${encodeURIComponent(season)}` : base;
}

/** Fetch JSON through the proxy, retrying transient 5xx/network failures. */
async function proxyGet(apiPath) {
  const url = DIRECT_KEY ? `${DIRECT_DOMAIN}${apiPath}` : proxyUrl(apiPath);
  const headers = DIRECT_KEY
    ? {
        Authorization: `Bearer ${DIRECT_KEY}`,
        'API-Version': API_VERSION,
        Accept: 'application/json',
        'User-Agent': UA,
      }
    : {
        'User-Agent': UA,
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      };
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, { headers });
      if (resp.ok) return await resp.json();
      const err = new Error(`HTTP ${resp.status}`);
      err.status = resp.status;
      // 4xx is a permanent answer (usually "player not found"); do not retry.
      if (resp.status < 500) throw err;
      lastErr = err;
    } catch (err) {
      if (err && err.status && err.status < 500) throw err;
      lastErr = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(300 * attempt);
  }
  throw lastErr;
}

/**
 * Convert one HaloDotAPI rank object into this app's rank shape.
 * A negative/absent value becomes a Placements entry that carries the number
 * of placement matches already played out of the required total.
 */
export function normalizeCsr(node, source = 'spartanrecord') {
  if (!node) return null;
  const value = node.value;
  const remaining = Number(node.measurement_matches_remaining ?? 0) || 0;
  const total = Number(node.initial_measurement_matches ?? 0) || 0;
  const placement = value === null || value === undefined || value < 0;

  return {
    tier: placement ? 'Placements' : node.tier || null,
    subTier: placement ? 0 : node.sub_tier ?? 0,
    csr: placement ? null : value,
    placementsRemaining: placement ? remaining : 0,
    placementsTotal: total || undefined,
    placementsPlayed:
      placement && total ? Math.max(0, total - remaining) : 0,
    tierStart: placement ? null : node.tier_start ?? null,
    source,
  };
}

/** Fetch one gamertag's CSR set, tolerating a stale season id. */
async function fetchPlayerCsrs(gamertag, season) {
  let data = await proxyGet(csrsPath(gamertag, season));
  // A wrong/rolled-over season returns an empty list. Fall back to the API
  // default (current season) so every account does not look unranked.
  if (season && !(data?.data || []).length) {
    data = await proxyGet(csrsPath(gamertag, ''));
  }
  return data;
}

/**
 * Look up the supplied gamertags via SpartanRecord's HaloDotAPI proxy.
 * Returns the same shape as the official provider.
 */
export async function fetchRanksSpartanRecord(
  gamertags,
  { season = config.season || '', onProgress } = {}
) {
  const results = [];
  const playlists = PLAYLISTS.map((p) => ({ ...p, count: 0 }));

  for (const input of gamertags) {
    const ranks = {};
    for (const p of PLAYLISTS) {
      ranks[p.key] = { current: null, unlisted: true, source: SOURCE };
    }

    try {
      const data = await fetchPlayerCsrs(input, season);
      const canonical = data?.additional?.params?.gamertag || input;
      const entries = data?.data || [];
      let matched = false;

      for (const entry of entries) {
        const key = NAME_TO_KEY.get(String(entry.name || '').toLowerCase());
        if (!key) continue; // ignore playlists this app does not track
        matched = true;
        const r = entry.response || {};
        ranks[key] = {
          current: normalizeCsr(r.current),
          seasonMax: normalizeCsr(r.season),
          allTimeMax: normalizeCsr(r.all_time),
          source: SOURCE,
        };
      }

      if (onProgress)
        onProgress(`SpartanRecord: ${canonical} (${matched ? 'ok' : 'no ranked data'})`);
      results.push({
        input,
        gamertag: canonical,
        found: matched,
        xuid: null,
        gamerpic: null,
        source: SOURCE,
        error: matched ? null : 'No ranked data returned for this gamertag',
        ranks,
      });
    } catch (err) {
      const notFound = err.status === 400 || err.status === 404;
      if (onProgress)
        onProgress(`SpartanRecord: ${input} failed (${err.message})`);
      results.push({
        input,
        gamertag: input,
        found: false,
        xuid: null,
        gamerpic: null,
        source: SOURCE,
        error: notFound ? 'Gamertag not found' : `Request failed: ${err.message}`,
        ranks,
      });
    }
  }

  for (const p of playlists) {
    p.count = results.filter((r) => r.ranks[p.key]?.current).length;
  }

  return { results, seasonId: season || null, playlists };
}
