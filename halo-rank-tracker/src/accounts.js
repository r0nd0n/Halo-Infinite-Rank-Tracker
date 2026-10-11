import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { ACCOUNTS_FILE, ACCOUNTS_TEMPLATE } from './config.js';
import { PLAYLISTS } from './config.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Invisible "format" characters that can sneak in from a copy-paste (bidi
// isolates/overrides, zero-width spaces, BOM, soft hyphen). They are never part
// of a real gamertag, and leaving one in makes the lookup 404.
const INVISIBLE_RE =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g;

/** Remove invisible/format characters from a line or field. */
export function stripInvisible(text) {
  return String(text ?? '').replace(INVISIBLE_RE, '');
}

/**
 * Parse one account line into { gamertag, email }.
 *
 * Accepted forms:
 *   Gamertag
 *   Gamertag-player@example.com   (an optional email after the last "-")
 *
 * When no valid email is present the whole line is treated as the gamertag, so
 * gamertag-only files keep working. A gamertag may itself contain a dash; the
 * separator is taken as the last "-" before the "@", which is unambiguous
 * whenever the email's local part has no dash.
 */
export function parseAccountLine(rawLine) {
  const line = stripInvisible(rawLine).trim();
  const at = line.lastIndexOf('@');
  if (at !== -1) {
    const dash = line.lastIndexOf('-', at);
    if (dash > 0) {
      const gamertag = line.slice(0, dash).trim();
      const email = line.slice(dash + 1).trim();
      if (gamertag && EMAIL_RE.test(email)) return { gamertag, email };
    }
  }
  return { gamertag: line, email: null };
}

function accountLines(file) {
  if (!existsSync(file)) {
    throw new Error(`Accounts file not found: ${file}`);
  }
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => stripInvisible(l).trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Read the plaintext account list as { gamertag, email } entries. Duplicates
 * are removed case-insensitively by gamertag, preserving first-seen order.
 */
export function readAccountEntries(file = ACCOUNTS_FILE) {
  const seen = new Set();
  const entries = [];
  for (const line of accountLines(file)) {
    const entry = parseAccountLine(line);
    if (!entry.gamertag) continue;
    const key = entry.gamertag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

/** Convenience wrapper returning just the gamertags (the provider input). */
export function readAccounts(file = ACCOUNTS_FILE) {
  return readAccountEntries(file).map((e) => e.gamertag);
}

/**
 * Normalize a gamertag typed into the Add Account form.
 *
 * Invisible/format characters are dropped, runs of whitespace collapse to a
 * single space, and the ends are trimmed. Internal spaces are preserved
 * because Xbox gamertags may contain them, and punctuation such as apostrophes
 * or dashes is left untouched.
 */
export function sanitizeGamertag(raw) {
  return stripInvisible(raw).replace(/\s+/g, ' ').trim();
}

/**
 * Normalize an email typed into the Add Account form. Invisible characters and
 * every whitespace character are removed (a real address never contains
 * spaces); everything else, including "+", "." and "_" in the local part, is
 * preserved.
 */
export function sanitizeEmail(raw) {
  return stripInvisible(raw).replace(/\s+/g, '');
}

/** True when `email` is a plausible address. */
export function isValidEmail(email) {
  return EMAIL_RE.test(String(email ?? ''));
}

/** Render one entry as a single accounts.txt line. */
export function formatAccountLine({ gamertag, email }) {
  return email ? `${gamertag}-${email}` : gamertag;
}

/** Read entries, tolerating a not-yet-created accounts file. */
export function listAccountEntries(file = ACCOUNTS_FILE) {
  return existsSync(file) ? readAccountEntries(file) : [];
}

/** The leading comment/blank block of an existing accounts file. */
function leadingHeader(text) {
  const header = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = stripInvisible(line).trim();
    if (!trimmed || trimmed.startsWith('#')) {
      header.push(line);
      continue;
    }
    break;
  }
  while (header.length && !header[header.length - 1].trim()) header.pop();
  return header;
}

/**
 * Persist the full account list, preserving the existing comment header (or
 * seeding the default template when the file is new).
 */
export function writeAccountEntries(entries, file = ACCOUNTS_FILE) {
  const header = existsSync(file)
    ? leadingHeader(readFileSync(file, 'utf8'))
    : ACCOUNTS_TEMPLATE.trimEnd().split(/\r?\n/);
  const body = entries.map(formatAccountLine).filter((line) => line.length);
  const out = `${[...header, '', ...body, ''].join('\n')}`;
  writeFileSync(file, out, 'utf8');
}

/**
 * Add one account from the dashboard form. Throws a friendly Error when the
 * gamertag is empty, the email is malformed, or the gamertag already exists.
 */
export function addAccount({ gamertag, email } = {}, file = ACCOUNTS_FILE) {
  const tag = sanitizeGamertag(gamertag);
  if (!tag) throw new Error('Enter a gamertag.');

  const cleanEmail = sanitizeEmail(email);
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    throw new Error('That email address looks invalid.');
  }

  const entries = listAccountEntries(file);
  if (entries.some((e) => e.gamertag.toLowerCase() === tag.toLowerCase())) {
    throw new Error(`${tag} is already being tracked.`);
  }

  const entry = { gamertag: tag, email: cleanEmail || null };
  entries.push(entry);
  writeAccountEntries(entries, file);
  return entry;
}

/** Remove an account by gamertag (case-insensitive). Throws when not found. */
export function removeAccount(gamertag, file = ACCOUNTS_FILE) {
  const tag = sanitizeGamertag(gamertag);
  if (!tag) throw new Error('Missing gamertag.');

  const entries = listAccountEntries(file);
  const next = entries.filter((e) => e.gamertag.toLowerCase() !== tag.toLowerCase());
  if (next.length === entries.length) {
    throw new Error(`${tag} is not in the list.`);
  }

  writeAccountEntries(next, file);
  return { removed: entries.length - next.length };
}

/**
 * Merge the on-disk account list into a cached payload so freshly added
 * accounts render immediately (as pending) before the next refresh.
 */
export function mergeAccountList(cache, file = ACCOUNTS_FILE) {
  const entries = listAccountEntries(file);
  const previous = new Map(
    (cache.accounts || []).map((a) => [String(a.input || a.gamertag || '').toLowerCase(), a])
  );
  const accounts = entries.map((entry) => {
    const prev = previous.get(entry.gamertag.toLowerCase());
    if (prev) return { ...prev, email: entry.email || null, input: prev.input || entry.gamertag };
    return {
      input: entry.gamertag,
      gamertag: entry.gamertag,
      email: entry.email || null,
      found: false,
      pending: true,
      source: null,
      ranks: {},
    };
  });
  return { ...cache, accounts };
}

export { PLAYLISTS };

/** Wrapper that keeps the exact query string used for CSR requests. */
export function buildCsrUrl(playlistId, xuids, season) {
  const params = new URLSearchParams();
  for (const xuid of xuids) params.append('players', `xuid(${xuid})`);
  if (season) params.set('season', season);
  return `/hi/playlist/${playlistId}/csrs?${params.toString()}`;
}

export function emptyCache() {
  return {
    date: null,
    generatedAt: null,
    provider: null,
    season: null,
    playlists: PLAYLISTS.map((p) => ({ key: p.key, label: p.label, id: p.id })),
    accounts: [],
  };
}
