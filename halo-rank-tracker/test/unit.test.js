import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  readAccounts,
  readAccountEntries,
  parseAccountLine,
  stripInvisible,
  sanitizeGamertag,
  sanitizeEmail,
  isValidEmail,
  formatAccountLine,
  listAccountEntries,
  addAccount,
  removeAccount,
  mergeAccountList,
} from '../src/accounts.js';
import { csrToTier } from '../src/config.js';
import { todayKey, isFresh } from '../src/cache.js';
import { msUntil } from '../src/scheduler.js';
import { parseLeaderboardHtml } from '../src/providers/waypoint.js';
import { fetchRanksWaypoint } from '../src/providers/waypoint.js';
import { PLAYLISTS } from '../src/config.js';
import { fetchRanksMock } from '../src/providers/mock.js';
import {
  normalizeCsr,
  csrsPath,
  proxyUrl,
  fetchRanksSpartanRecord,
} from '../src/providers/spartanrecord.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('csrToTier bands CSR values into tiers', () => {
  assert.equal(csrToTier(0).tier, 'Bronze');
  assert.equal(csrToTier(160).tier, 'Silver');
  assert.equal(csrToTier(320).tier, 'Gold');
  assert.equal(csrToTier(500).tier, 'Platinum');
  assert.equal(csrToTier(1000).tier, 'Diamond');
  assert.equal(csrToTier(1600).tier, 'Onyx');
  assert.equal(csrToTier(1700).subTier, 0);
  assert.equal(csrToTier(null).tier, 'Unranked');
});

test('todayKey is a local YYYY-MM-DD string', () => {
  assert.match(todayKey(new Date(2026, 9, 10)), /^2026-10-10$/);
});

test('isFresh only accepts today with accounts', () => {
  const today = todayKey();
  assert.equal(isFresh({ date: today, accounts: [1] }), true);
  assert.equal(isFresh({ date: '2000-01-01', accounts: [1] }), false);
  assert.equal(isFresh({ date: today, accounts: [] }), false);
  assert.equal(isFresh(null), false);
});

test('msUntil returns a positive delay within 24h', () => {
  const from = new Date(2026, 9, 10, 5, 0, 0);
  const d = msUntil(6, 0, from);
  assert.equal(d, 60 * 60 * 1000);
  const wrap = msUntil(5, 0, from); // already passed -> next day
  assert.equal(wrap, 24 * 60 * 60 * 1000);
});

test('readAccounts parses fixture and skips comments/blanks/dupes', () => {
  const file = join(__dirname, 'fixtures', 'accounts-sample.txt');
  const accounts = readAccounts(file);
  assert.deepEqual(accounts, ['MasterChief', 'Arbiter', 'Cortana']);
});

test('parseAccountLine splits a gamertag and optional email', () => {
  assert.deepEqual(parseAccountLine('MasterChief'), {
    gamertag: 'MasterChief',
    email: null,
  });
  assert.deepEqual(parseAccountLine('MasterChief-chief@example.com'), {
    gamertag: 'MasterChief',
    email: 'chief@example.com',
  });
  // Spaces in the gamertag are fine.
  assert.deepEqual(parseAccountLine('r0nd0n x-r0nd0n@example.com'), {
    gamertag: 'r0nd0n x',
    email: 'r0nd0n@example.com',
  });
  // A dash that belongs to the gamertag is preserved.
  assert.deepEqual(parseAccountLine('my-tag-me@example.com'), {
    gamertag: 'my-tag',
    email: 'me@example.com',
  });
  // Anything that is not a valid email stays part of the gamertag.
  assert.deepEqual(parseAccountLine('NotAnEmail@'), {
    gamertag: 'NotAnEmail@',
    email: null,
  });
});

test('parseAccountLine strips invisible bidi/format characters', () => {
  // U+2069 (pop directional isolate) pasted after the gamertag used to be
  // kept, producing an invisible character that made the lookup 404.
  assert.deepEqual(parseAccountLine('Call Me r0n\u2069-halo.noob420@outlook.com'), {
    gamertag: 'Call Me r0n',
    email: 'halo.noob420@outlook.com',
  });
  assert.deepEqual(parseAccountLine('\uFEFFMasterChief\u200B'), {
    gamertag: 'MasterChief',
    email: null,
  });
  assert.deepEqual(parseAccountLine('\u2066Arbiter\u2069-the.arbiter@example.com'), {
    gamertag: 'Arbiter',
    email: 'the.arbiter@example.com',
  });
});

test('readAccountEntries keeps emails and gamertag-only lines', () => {
  const file = join(__dirname, 'fixtures', 'accounts-email.txt');
  const entries = readAccountEntries(file);
  assert.deepEqual(entries[0], {
    gamertag: 'MasterChief',
    email: 'chief@example.com',
  });
  assert.deepEqual(entries[1], { gamertag: 'Arbiter', email: null });
  // Duplicate gamertag keeps the first-seen email only.
  assert.equal(entries.filter((e) => e.gamertag === 'MasterChief').length, 1);
  assert.deepEqual(readAccounts(file), [
    'MasterChief',
    'Arbiter',
    'Cortana',
    'OnyxGrinder',
  ]);
});

test('parseLeaderboardHtml extracts entries and season from a real page', () => {
  const html = readFileSync(join(__dirname, 'fixtures', 'waypoint-lb-index.html'), 'utf8');
  const parsed = parseLeaderboardHtml(html);
  assert.equal(parsed.seasonId, 'csrseason13-3');
  assert.ok(parsed.entries.length > 0);
  const first = parsed.entries[0];
  assert.ok(first.player.gamertag);
  assert.ok(first.player.gamerpic.small.startsWith('https://'));
  assert.ok(first.player.xuid);
  assert.equal(typeof first.score, 'number');
});

test('parseLeaderboardHtml works for the arena fixture too', () => {
  const html = readFileSync(join(__dirname, 'fixtures', 'waypoint-lb-arena.html'), 'utf8');
  const parsed = parseLeaderboardHtml(html);
  assert.equal(parsed.page, 1);
  assert.equal(parsed.entries[0].rank, 1);
  assert.ok(parsed.playlists.some((p) => p.displayName === 'Ranked Arena'));
});

/** Build a minimal Waypoint __NEXT_DATA__ page for the fetch stub. */
function nextDataPage({ seasonId = 'csrseason13-3', page = 1, entries = [] } = {}) {
  const payload = {
    props: {
      pageProps: {
        season: { seasonId },
        page,
        pageSize: 100,
        playlists: [],
        leaderboard: entries,
      },
    },
  };
  return `<!doctype html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`;
}

test('fetchRanksWaypoint finds one gamertag listed on all four playlists', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/leaderboards') && !href.includes('/leaderboards/')) {
      return { ok: true, text: async () => nextDataPage() };
    }
    const playlist = PLAYLISTS.find((p) => href.includes(p.id));
    const rank = PLAYLISTS.indexOf(playlist) + 1;
    const entries = [
      {
        rank,
        score: 2000 + rank,
        player: {
          xuid: '100',
          gamertag: 'CrossPlayOnyx',
          gamerpic: { small: 'https://example.test/pic.png' },
        },
      },
    ];
    return { ok: true, text: async () => nextDataPage({ entries }) };
  };

  try {
    const { results } = await fetchRanksWaypoint(['CrossPlayOnyx']);
    const account = results[0];
    assert.equal(account.found, true);
    for (const playlist of PLAYLISTS) {
      const rank = account.ranks[playlist.key];
      assert.equal(rank.current.tier, 'Onyx', `${playlist.key} should be Onyx`);
      assert.equal(
        rank.unlisted,
        undefined,
        `${playlist.key} must not be reported unlisted`
      );
      assert.equal(rank.current.leaderboardRank, PLAYLISTS.indexOf(playlist) + 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchRanksWaypoint retries a cached HTTP 500 and still finds the player', async () => {
  const originalFetch = globalThis.fetch;
  let firstPageOne = 0;
  globalThis.fetch = async (url) => {
    const href = String(url);
    assert.ok(href.includes('_='), 'request must carry a cache-busting param');
    if (href.includes('/leaderboards') && !href.includes('/leaderboards/')) {
      return { ok: true, text: async () => nextDataPage() };
    }
    const playlist = PLAYLISTS.find((p) => href.includes(p.id));
    if (playlist === PLAYLISTS[0] && href.includes('page=1') && firstPageOne++ === 0) {
      return { ok: false, status: 500, text: async () => '' };
    }
    const rank = PLAYLISTS.indexOf(playlist) + 1;
    const entries = [
      {
        rank,
        score: 2000,
        player: {
          xuid: '9',
          gamertag: 'RetryOnyx',
          gamerpic: { small: 'https://example.test/pic.png' },
        },
      },
    ];
    return { ok: true, text: async () => nextDataPage({ entries }) };
  };
  try {
    const { results } = await fetchRanksWaypoint(['RetryOnyx']);
    assert.equal(results[0].found, true);
    assert.equal(results[0].ranks['ranked-arena'].current.tier, 'Onyx');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchRanksWaypoint dedupes repeated pages and stops paging early', async () => {
  const originalFetch = globalThis.fetch;
  let pageCalls = 0;
  const fullPage = () =>
    Array.from({ length: 100 }, (_, i) => ({
      rank: i + 1,
      score: 2000,
      player: {
        xuid: `x${i}`,
        gamertag: i === 0 ? 'DupOnyx' : `Tag${i}`,
        gamerpic: { small: 'https://example.test/pic.png' },
      },
    }));
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('/leaderboards') && !href.includes('/leaderboards/')) {
      return { ok: true, text: async () => nextDataPage() };
    }
    pageCalls++;
    return { ok: true, text: async () => nextDataPage({ entries: fullPage() }) };
  };
  try {
    const { results, playlists } = await fetchRanksWaypoint(['DupOnyx']);
    assert.equal(results[0].found, true);
    // Page 1 adds 100 rows; page 2 repeats them, so paging stops (2 per playlist).
    assert.equal(pageCalls, PLAYLISTS.length * 2);
    for (const p of playlists) assert.equal(p.count, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizeCsr maps Onyx CSR and placement progress', () => {
  const onyx = normalizeCsr({
    value: 1716,
    tier: 'Onyx',
    sub_tier: 0,
    tier_start: 1500,
    measurement_matches_remaining: 0,
    initial_measurement_matches: 0,
  });
  assert.equal(onyx.tier, 'Onyx');
  assert.equal(onyx.csr, 1716);
  assert.equal(onyx.placementsRemaining, 0);

  const placement = normalizeCsr({
    value: -1,
    tier: '',
    sub_tier: 0,
    tier_start: null,
    measurement_matches_remaining: 2,
    initial_measurement_matches: 5,
  });
  assert.equal(placement.tier, 'Placements');
  assert.equal(placement.csr, null);
  assert.equal(placement.placementsRemaining, 2);
  assert.equal(placement.placementsTotal, 5);
  assert.equal(placement.placementsPlayed, 3);

  assert.equal(normalizeCsr(null), null);
});

test('csrsPath and proxyUrl encode the gamertag and season', () => {
  assert.equal(
    csrsPath('n0dn0r'),
    '/games/halo-infinite/stats/multiplayer/players/n0dn0r/csrs'
  );
  const withSeason = csrsPath('r0nd0n x', 'CsrSeason13-3');
  assert.ok(withSeason.includes('r0nd0n%20x'));
  assert.ok(withSeason.includes('season_csr=CsrSeason13-3'));
  assert.ok(proxyUrl('/games/halo-infinite/x').includes('?path='));
});

/** Build one HaloDotAPI csrs entry. */
function csrEntry(name, current) {
  return { id: name, name, response: { current } };
}

test('fetchRanksSpartanRecord maps playlists, placements and untracked modes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: [
        csrEntry('Ranked Slayer', {
          value: -1,
          tier: '',
          measurement_matches_remaining: 2,
          initial_measurement_matches: 5,
        }),
        csrEntry('Ranked Arena', {
          value: 1716,
          tier: 'Onyx',
          sub_tier: 0,
          tier_start: 1500,
        }),
        csrEntry('Quick Play', { value: 1200, tier: 'Diamond' }),
      ],
      additional: { params: { gamertag: 'n0dn0r' } },
    }),
  });

  try {
    const { results, playlists } = await fetchRanksSpartanRecord(['n0dn0r']);
    const account = results[0];
    assert.equal(account.found, true);
    assert.equal(account.gamertag, 'n0dn0r');
    assert.equal(account.ranks['ranked-slayer'].current.tier, 'Placements');
    assert.equal(account.ranks['ranked-slayer'].current.placementsPlayed, 3);
    assert.equal(account.ranks['ranked-slayer'].current.placementsTotal, 5);
    assert.equal(account.ranks['ranked-arena'].current.tier, 'Onyx');
    assert.equal(account.ranks['ranked-arena'].current.csr, 1716);
    // Untracked playlist is ignored; the two missing playlists stay unlisted.
    assert.equal(account.ranks['quick-play'], undefined);
    assert.equal(account.ranks['ranked-doubles'].unlisted, true);
    assert.equal(playlists.find((p) => p.key === 'ranked-arena').count, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchRanksSpartanRecord retries without a stale season id', async () => {
  const originalFetch = globalThis.fetch;
  let seasonCalls = 0;
  let defaultCalls = 0;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.includes('season_csr')) {
      seasonCalls++;
      return { ok: true, json: async () => ({ data: [] }) };
    }
    defaultCalls++;
    return {
      ok: true,
      json: async () => ({
        data: [csrEntry('Ranked Arena', { value: 1600, tier: 'Onyx' })],
        additional: { params: { gamertag: 'StaleSeason' } },
      }),
    };
  };
  try {
    const { results } = await fetchRanksSpartanRecord(['StaleSeason'], {
      season: 'CsrSeason00-0',
    });
    assert.equal(seasonCalls, 1);
    assert.equal(defaultCalls, 1);
    assert.equal(results[0].ranks['ranked-arena'].current.tier, 'Onyx');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchRanksSpartanRecord reports a gamertag lookup failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  try {
    const { results } = await fetchRanksSpartanRecord(['GhostTown']);
    assert.equal(results[0].found, false);
    assert.equal(results[0].error, 'Gamertag not found');
    assert.equal(results[0].ranks['ranked-arena'].unlisted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('mock provider returns one rank set per playlist per account', async () => {
  const { results } = await fetchRanksMock(['ExamplePlayer', 'OnyxGrinder']);
  assert.equal(results.length, 2);
  for (const r of results) {
    assert.equal(Object.keys(r.ranks).length, 4);
    assert.ok(r.ranks['ranked-arena'].current.tier);
  }
  assert.equal(results[1].ranks['ranked-arena'].current.tier, 'Onyx');
});

test('stripInvisible removes zero-width and bidi formatting characters', () => {
  assert.equal(stripInvisible('Mas\u200bter\u00adChief'), 'MasterChief');
  assert.equal(stripInvisible('\uFEFFArbiter\u202E'), 'Arbiter');
});

test('sanitizeGamertag trims, collapses spaces, keeps punctuation', () => {
  assert.equal(sanitizeGamertag('  Master\u200b   Chief  '), 'Master Chief');
  assert.equal(sanitizeGamertag("O'Brien-117"), "O'Brien-117");
  assert.equal(sanitizeGamertag('\tArbiter\n'), 'Arbiter');
});

test('sanitizeEmail drops all whitespace but keeps address characters', () => {
  assert.equal(sanitizeEmail('  player.name+tag@example.com '), 'player.name+tag@example.com');
  assert.equal(sanitizeEmail('a\u200bb@example.com'), 'ab@example.com');
  assert.equal(sanitizeEmail('user_1-x@sub.example.co'), 'user_1-x@sub.example.co');
});

test('isValidEmail accepts plausible addresses and rejects junk', () => {
  assert.equal(isValidEmail('player@example.com'), true);
  assert.equal(isValidEmail('first.last+tag@sub.example.co'), true);
  assert.equal(isValidEmail('no-at-sign'), false);
  assert.equal(isValidEmail('two@@example.com'), false);
  assert.equal(isValidEmail('trailing@example.'), false);
  assert.equal(isValidEmail(null), false);
});

test('formatAccountLine joins email with a dash and omits it when absent', () => {
  assert.equal(formatAccountLine({ gamertag: 'MasterChief', email: 'm@x.com' }), 'MasterChief-m@x.com');
  assert.equal(formatAccountLine({ gamertag: 'Arbiter', email: null }), 'Arbiter');
});

test('addAccount sanitizes, persists, and rejects duplicates/invalid email', () => {
  const dir = mkdtempSync(join(tmpdir(), 'halo-add-'));
  const file = join(dir, 'accounts.txt');
  const entry = addAccount({ gamertag: '  Master\u200b Chief ', email: ' m@x.com ' }, file);
  assert.deepEqual(entry, { gamertag: 'Master Chief', email: 'm@x.com' });
  assert.deepEqual(listAccountEntries(file), [{ gamertag: 'Master Chief', email: 'm@x.com' }]);

  assert.throws(
    () => addAccount({ gamertag: 'master chief' }, file),
    /already being tracked/
  );
  assert.throws(() => addAccount({ gamertag: '   ' }, file), /Enter a gamertag/);
  assert.throws(() => addAccount({ gamertag: 'Arbiter', email: 'bad@' }, file), /invalid/);
  assert.equal(listAccountEntries(file).length, 1);
});

test('removeAccount drops the matching entry case-insensitively', () => {
  const dir = mkdtempSync(join(tmpdir(), 'halo-rm-'));
  const file = join(dir, 'accounts.txt');
  addAccount({ gamertag: 'MasterChief' }, file);
  addAccount({ gamertag: 'Arbiter', email: 'a@x.com' }, file);
  assert.deepEqual(removeAccount('masterchief', file), { removed: 1 });
  assert.deepEqual(listAccountEntries(file), [{ gamertag: 'Arbiter', email: 'a@x.com' }]);
  assert.throws(() => removeAccount('Ghost', file), /not in the list/);
});

test('mergeAccountList marks new accounts pending and keeps cached ranks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'halo-merge-'));
  const file = join(dir, 'accounts.txt');
  addAccount({ gamertag: 'Known', email: 'k@x.com' }, file);
  addAccount({ gamertag: 'Fresh' }, file);
  const cache = {
    accounts: [
      { input: 'Known', gamertag: 'Known', found: true, ranks: { 'ranked-arena': { current: { tier: 'Onyx' } } } },
    ],
  };
  const merged = mergeAccountList(cache, file);
  assert.equal(merged.accounts.length, 2);
  const known = merged.accounts.find((a) => a.gamertag === 'Known');
  assert.equal(known.found, true);
  assert.equal(known.email, 'k@x.com');
  assert.equal(known.ranks['ranked-arena'].current.tier, 'Onyx');
  const fresh = merged.accounts.find((a) => a.gamertag === 'Fresh');
  assert.equal(fresh.pending, true);
  assert.equal(fresh.found, false);
  assert.deepEqual(fresh.ranks, {});
});

test('config honors HALO_USER_DIR and seeds a writable accounts file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'halo-cfg-'));
  process.env.HALO_USER_DIR = dir;
  try {
    const cfg = await import(`../src/config.js?userdir=${Date.now()}`);
    assert.equal(cfg.ACCOUNTS_FILE, join(dir, 'accounts.txt'));
    assert.equal(cfg.CACHE_FILE, join(dir, 'data', 'cache.json'));

    const first = cfg.ensureUserFiles();
    assert.equal(first.created, true);
    assert.ok(existsSync(join(dir, 'accounts.txt')));
    assert.equal(cfg.ensureUserFiles().created, false);
  } finally {
    delete process.env.HALO_USER_DIR;
  }
});
