import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { CACHE_FILE } from './config.js';
import { emptyCache } from './accounts.js';

/** Local calendar day (YYYY-MM-DD) as seen by the machine running the app. */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function readCache() {
  if (!existsSync(CACHE_FILE)) return emptyCache();
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch (err) {
    console.warn(`cache.json is unreadable (${err.message}); starting fresh.`);
    return emptyCache();
  }
}

/** Atomic write so a crash mid-write cannot corrupt the cache. */
export function writeCache(cache) {
  const tmp = `${CACHE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2));
  renameSync(tmp, CACHE_FILE);
}

/** True when the cache was generated today and has real accounts. */
export function isFresh(cache, date = new Date()) {
  return Boolean(cache?.date) && cache.date === todayKey(date) && (cache.accounts?.length ?? 0) > 0;
}

export function cacheAge(cache) {
  return cache?.generatedAt ? Date.now() - new Date(cache.generatedAt).getTime() : null;
}
