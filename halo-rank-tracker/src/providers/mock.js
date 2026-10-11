import { PLAYLISTS } from '../config.js';

/**
 * Mock provider — deterministic sample data with no network access. Useful for
 * trying the UI, and for the automated tests.
 */

const SAMPLE = [
  { gamertag: 'ExamplePlayer', xuid: '2533274800000001', csr: [1650, 1520, 1230, null] },
  { gamertag: 'OnyxGrinder', xuid: '2533274800000002', csr: [1783, 1601, 1550, 1499] },
  { gamertag: 'PlacementKid', xuid: '2533274800000003', csr: [null, null, null, null] },
];

function rankFor(csr, placement = false) {
  if (placement || csr === null || csr === undefined) {
    return {
      tier: 'Placements',
      subTier: 0,
      csr: null,
      placementsRemaining: 8,
      placementsTotal: 8,
      placementsPlayed: 0,
      tierStart: null,
    };
  }
  if (csr >= 1500) {
    return { tier: 'Onyx', subTier: 0, csr, placementsRemaining: 0, tierStart: 1500 };
  }
  return { tier: 'Diamond', subTier: Math.min(6, Math.floor((csr - 600) / 150) + 1), csr, placementsRemaining: 0, tierStart: 600 };
}

export async function fetchRanksMock(gamertags, { onProgress } = {}) {
  const results = gamertags.map((input, i) => {
    const sample = SAMPLE.find((s) => s.gamertag.toLowerCase() === input.toLowerCase());
    const csr = sample?.csr || SAMPLE[i % SAMPLE.length].csr;
    const ranks = {};
    PLAYLISTS.forEach((playlist, idx) => {
      ranks[playlist.key] = {
        current: rankFor(csr[idx]),
        seasonMax: rankFor(csr[idx] === null ? null : csr[idx] + 40),
        allTimeMax: rankFor(csr[idx] === null ? null : csr[idx] + 90),
        source: 'mock',
      };
    });
    if (onProgress) onProgress(`Mock rank for ${input}`);
    return {
      input,
      gamertag: sample?.gamertag || input,
      found: true,
      listedInLeaderboard: true,
      xuid: sample?.xuid || `25332748000000${String(i).padStart(2, '0')}`,
      gamerpic: null,
      source: 'mock',
      error: null,
      ranks,
    };
  });
  return { results, seasonId: 'csrseason13-3', playlists: PLAYLISTS.map((p) => ({ ...p })) };
}
