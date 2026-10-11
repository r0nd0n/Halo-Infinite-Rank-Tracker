import { PLAYLISTS, SERVICE_HOSTS, config } from '../config.js';

/**
 * Public Halo Waypoint leaderboard provider (NO login required).
 *
 * Waypoint server-renders the leaderboard into a Next.js `__NEXT_DATA__` JSON
 * blob. Each page exposes up to 100 ranked players per playlist:
 *
 *   props.pageProps.leaderboard = [
 *     { player: { xuid, gamertag, gamerpic:{small,medium,large,xlarge} },
 *       rank: 1, score: 3173 }, ...
 *   ]
 *   props.pageProps.playlists   = [ { playlistId, displayName, timestamp } ]
 *   props.pageProps.season      = { seasonId, displayName }
 *
 * IMPORTANT LIMITATION: the public leaderboard only lists Onyx players
 * (CSR >= 1500). Gamertags not present cannot have their (lower) rank
 * determined from this source; they are reported as "not listed".
 *
 * The leaderboard is paged ~100 rows at a time and ends when a page comes
 * back short/empty, so the fetch walks every page up to WAYPOINT_MAX_PAGES
 * (default 50) rather than stopping at the first few hundred players.
 */

const UA =
  'Mozilla/5.0 (compatible; HaloRankTracker/1.0; +https://github.com/)';
const MAX_PAGES = Number(process.env.WAYPOINT_MAX_PAGES) || 50;
const PAGE_DELAY_MS = Number(process.env.WAYPOINT_PAGE_DELAY_MS) || 250;

/** Extract and parse the __NEXT_DATA__ JSON blob from a Waypoint HTML page. */
export function extractNextData(html) {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error('Could not find __NEXT_DATA__ in Waypoint page');
  return JSON.parse(m[1]);
}

export function parseLeaderboardHtml(html) {
  const data = extractNextData(html);
  const pp = data?.props?.pageProps || {};
  return {
    seasonId: pp.season?.seasonId || null,
    playlists: pp.playlists || [],
    page: pp.page || 1,
    pageSize: pp.pageSize || 100,
    entries: pp.leaderboard || [],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

/**
 * Fetch a Waypoint page.
 *
 * Waypoint's CDN has been observed caching HTTP 500 responses for the exact
 * leaderboard URLs (so every playlist looks empty) and serving stale,
 * inconsistent slices for a cached `?page=` URL. A unique cache-busting query
 * param plus a small retry loop avoids the poisoned/stale edge-cache entry.
 */
async function fetchHtml(url) {
  const bust =
    `${url.includes('?') ? '&' : '?'}_=${Date.now()}_` +
    Math.random().toString(36).slice(2, 8);
  const target = url + bust;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(target, { headers: HEADERS });
      if (resp.ok) return resp.text();
      const err = new Error(`Waypoint returned HTTP ${resp.status} for ${url}`);
      err.status = resp.status;
      if (resp.status < 500) throw err; // 4xx will not fix itself
      lastErr = err;
    } catch (err) {
      if (err && err.status && err.status < 500) throw err;
      lastErr = err;
    }
    if (attempt < 3) await sleep(250 * attempt);
  }
  throw lastErr;
}

/** Case-insensitive lookup key scoped to one playlist. */
function tagKey(playlistKey, gamertag) {
  return `${playlistKey}\u0000${String(gamertag).toLowerCase()}`;
}

/** Resolve the current CSR season id (config override wins). */
async function resolveSeasonId() {
  if (config.season) return config.season.toLowerCase();
  const html = await fetchHtml(`${SERVICE_HOSTS.waypoint}/halo-infinite/leaderboards`);
  const { seasonId } = parseLeaderboardHtml(html);
  if (!seasonId) throw new Error('Could not determine current CSR season from Waypoint');
  return seasonId;
}

/** Collect every leaderboard page for one playlist. */
async function fetchPlaylistLeaderboard(seasonId, playlistId, onProgress) {
  const entries = [];
  const seen = new Set(); // dedupe overlapping/cached pages by xuid or tag
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${SERVICE_HOSTS.waypoint}/halo-infinite/leaderboards/${seasonId}/${playlistId}` +
      `?page=${page}`;
    const { entries: pageEntries, pageSize } = parseLeaderboardHtml(await fetchHtml(url));
    let added = 0;
    for (const entry of pageEntries) {
      const player = entry.player || {};
      const key = player.xuid
        ? String(player.xuid)
        : String(player.gamertag || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
      added++;
    }
    if (onProgress)
      onProgress(`${playlistId} page ${page}: +${added} new (${pageEntries.length} rows)`);
    // Stop on a short page, or when a cached page just repeats earlier rows.
    if (pageEntries.length < (pageSize || 100) || added === 0) break;
    if (page < MAX_PAGES) await sleep(PAGE_DELAY_MS);
  }
  return entries;
}

/**
 * Look up the supplied gamertags on the public Waypoint leaderboards.
 * Returns the same shape as the official provider.
 */
export async function fetchRanksWaypoint(gamertags, { onProgress } = {}) {
  const seasonId = await resolveSeasonId();

  // Build a case-insensitive lookup index keyed by gamertag and by xuid.
  const byTag = new Map();
  const byXuid = new Map();
  const playlistSummaries = [];

  for (const playlist of PLAYLISTS) {
    let entries = [];
    try {
      entries = await fetchPlaylistLeaderboard(seasonId, playlist.id, onProgress);
    } catch (err) {
      playlistSummaries.push({ ...playlist, error: err.message, count: 0 });
      continue;
    }
    playlistSummaries.push({ ...playlist, count: entries.length });
    for (const entry of entries) {
      const player = entry.player || {};
      const record = {
        rank: entry.rank ?? null,
        csr: entry.score ?? null,
        gamerpic: player.gamerpic || null,
        xuid: player.xuid ? String(player.xuid) : null,
        gamertag: player.gamertag || '',
      };
      // Key by playlist too: a gamertag often appears on several playlists'
      // leaderboards, and a tag-only key would overwrite the earlier entry.
      if (record.gamertag) {
        byTag.set(tagKey(playlist.key, record.gamertag), { playlist, ...record });
      }
      if (record.xuid) byXuid.set(record.xuid, { playlist, ...record });
    }
  }

  const results = gamertags.map((input) => {
    const ranks = {};
    let gamerpic = null;
    let xuid = null;
    let matchedTag = null;

    for (const playlist of PLAYLISTS) {
      // A tag may appear in some playlists but not others.
      const hit = byTag.get(tagKey(playlist.key, input));
      if (hit) {
        matchedTag = hit.gamertag;
        gamerpic = gamerpic || hit.gamerpic;
        xuid = xuid || hit.xuid;
        ranks[playlist.key] = {
          current: {
            tier: 'Onyx',
            subTier: 0,
            csr: hit.csr,
            placementsRemaining: 0,
            leaderboardRank: hit.rank,
          },
          seasonMax: null,
          allTimeMax: null,
          source: 'waypoint',
        };
      } else {
        ranks[playlist.key] = {
          current: null,
          unlisted: true,
          source: 'waypoint',
        };
      }
    }

    return {
      input,
      gamertag: matchedTag || input,
      found: Boolean(matchedTag),
      listedInLeaderboard: Boolean(matchedTag),
      xuid,
      gamerpic,
      source: 'waypoint',
      error: matchedTag
        ? null
        : 'Not on the public leaderboard (public lists show Onyx/CSR 1500+ only)',
      ranks,
    };
  });

  return { results, seasonId, playlists: playlistSummaries };
}
