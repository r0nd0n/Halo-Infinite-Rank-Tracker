# Halo Infinite Rank Tracker

A small, **dependency-free** Node.js app that reads Halo Infinite gamertags from
a plaintext file, looks up their CSR for four ranked playlists, caches the
results as JSON **once per day**, and serves a sleek local web page showing each
player's gamerpic, gamertag, and ranks.

![modes](https://img.shields.io/badge/modes-Ranked_Arena_%7C_Doubles_%7C_Slayer_%7C_Snipers-00b2ff)

## What it does

- Reads one gamertag per line from `accounts.txt` (blank lines and `#` comments
  are ignored; duplicates are removed case-insensitively).
- Fetches CSR for the four ranked modes you care about:

  | Playlist | Key | ID |
  | --- | --- | --- |
  | Ranked Arena | `ranked-arena` | `edfef3ac-9cbe-4fa2-b949-8f29deafd483` |
  | Ranked Doubles | `ranked-doubles` | `fa5aa2a3-2428-4912-a023-e1eeea7b877c` |
  | Ranked Slayer | `ranked-slayer` | `dcb2e24e-05fb-4390-8076-32a0cdb4326e` |
  | Ranked Snipers | `ranked-snipers` | `6233381c-fc96-40b9-b1ff-f6a4de72dd7` |

- Caches everything to `data/cache.json`, keyed by **local calendar day**. A run
  is skipped entirely if the cache is already from today and the account list
  hasn't changed.
- Serves a local page with one card per account: gamerpic, gamertag, and a rank
  tile per playlist (tier emblem, tier/sub-tier, CSR, and season best).
- Refreshes automatically once a day (default **06:00** local time) while the
  server is running, and exposes a **Refresh** button for an on-demand force
  fetch.

## Managing accounts from the dashboard

You no longer edit `accounts.txt` by hand. On the page:

- **+ Add Account** opens a dialog with **Username** (required) and **Email
  (optional)**. Submit again for as many accounts as you like.
- Each account card has a **three-dot menu** with *Remove account* (handy for a
  typo or a changed email).
- New or removed accounts show up after a **Refresh** (the page button or the
  tray *Refresh now*); a freshly added account may briefly show as **pending**
  until the next fetch completes.

Input is sanitized before it is written: invisible/zero-width characters and
control characters are stripped and whitespace is normalized, while valid
gamertag punctuation and internal spaces, plus email characters (`@`, `.`, `+`,
`-`, `_`), are preserved. Emails are never shown on the card — a small indicator
marks that one exists, and clicking the gamertag copies the `gamertag-email`
value for sign-in.

## Rank badges

Rank tiles try the bundled badge images first (`public/images/`), then
`https://leafapp.co/images/csrs/`, and finally fall back to the built-in SVG
crest so the rank text is always readable. File names match leafapp.co:
`onyx.png` and `{bronze,silver,gold,platinum,diamond}-{1..6}.png`.

### Downloading the badge images

The host blocks hotlinking (which caused `ERR_BLOCKED_BY_ORB`), so the badges
are meant to be downloaded once and shipped inside the app. Use either script;
both write the 31 files into `public/images/` with the exact names above and
verify each file is a real PNG (a bot challenge returns HTML, which is
rejected):

```bash
# Node.js 18+ (any OS)
npm run badges
# or: node scripts/download-badges.mjs --force
```

```powershell
# Windows-native PowerShell, no Node required
powershell -ExecutionPolicy Bypass -File scripts\download-badges.ps1
# add -Force to overwrite existing files
```

If the host serves a challenge to the script, download the images in a browser
and drop them into `public/images/` by hand, keeping those exact filenames.
Anything missing simply falls back to the SVG crest.

## Requirements

- **Node.js 18 or newer** (uses built-in `fetch`, `node:http`, `node:test`).
- No `npm install` is required — there are zero dependencies.

## Quick start

```bash
# 1. Put your gamertags in accounts.txt (one per line)
#    e.g.  MasterChief

# 2. (Optional) configure the data source
cp .env.example .env

# 3. Run it — fetches if needed, then serves the page
npm start
# open http://localhost:5173
```

### Other commands

```bash
npm run fetch         # fetch if today's cache is missing, then exit
npm run fetch:force   # always fetch now, then exit
npm run serve         # serve cached data only (no fetching)
npm test              # run the test suite (Node's built-in test runner)
npm run login         # interactive OAuth helper for the official API
```

CLI flags are also accepted directly:

```bash
node src/index.js --provider=waypoint --port=8080
node src/index.js --fetch-only --force
```

## Windows app (tray icon, no Node required)

For anyone who doesn't want to install Node, the tracker can be packaged as a
Windows executable that runs headless with a **system-tray icon**. Build it on a
Windows machine — electron-builder produces Windows installers most reliably
there (see *Windows build note* below):

```bash
npm install          # installs Electron + electron-builder (dev-only)
npm run badges       # download badge PNGs into public/images/ (optional, one-time)
npm run dist         # NSIS installer + portable .exe in dist/

# or pick one:
npm run dist:nsis       # installer only
npm run dist:portable   # single-file portable .exe
npm run dist:dir        # unpacked app dir, fastest smoke test
npm run app             # run the tray app straight from source
```

`dist/` then contains:

| Artifact | Use |
| --- | --- |
| `Halo Rank Tracker-Setup-<version>.exe` | Installer (per-machine, asks for admin/elevation), Start-menu + desktop shortcuts |
| `Halo Rank Tracker-portable-<version>.exe` | Single file, no install |
| `win-unpacked/` | Unpacked app from `npm run dist:dir`, for smoke tests |

**What the installer contains.** The `Halo Rank Tracker-Setup-<version>.exe` is
self-contained: electron-builder packs the app source plus every file matched by
`build.files` (including `public/**/*`, so `public/images/` badge PNGs) into
`resources/app.asar` inside the installer, together with the Electron runtime.
You can copy that one `.exe` to another Windows PC and install it there with no
Node.js and no extra files. If you skipped the badge download, the installer is
still complete — the tiles just fall back to the SVG crest or the remote host.
The only things kept out of the binary are per-user data (`accounts.txt`,
`data/cache.json`, `.env`), which the installed app creates under
`%APPDATA%\Halo Rank Tracker\` on first run.

**Tray behavior:** left-click opens the dashboard in your default browser;
right-click offers *Open dashboard*, *Refresh now*, and *Quit*. *Quit* stops the
local server. Accounts are managed from the dashboard, not from the tray.

**Where your files live:** the packaged app writes to Electron's per-user data
folder, `%APPDATA%\Halo Rank Tracker\`:

```
accounts.txt      your gamertags (managed from the dashboard)
data/cache.json   cached ranks
.env              optional provider settings
```

That folder is created on first run and is **outside** the read-only app
archive, so your accounts and cache survive upgrades.

**Installer permissions.** The NSIS installer is built **per-machine**
(`"perMachine": true`), so Windows prompts for elevation (UAC) before it writes
to `Program Files`. The earlier *"Error opening file for writing ... Uninstall
Halo Rank Tracker.exe"* happened when the per-user installer tried to install
into `F:\Program Files\...` without admin rights. The per-machine build requests
elevation up front, which is the standard fix. This change has **not** been
verified on a Windows host in this environment — build and test it on Windows
before distributing. The `.env` is never
bundled into the executable — tokens and secrets stay on your machine. Set
`HALO_USER_DIR` to store data somewhere else. Plain `npm start` (CLI) is
unchanged and still uses the project root.

**Windows build note:** the build is unsigned, so SmartScreen may warn on first
run (*More info* → *Run anyway*). Removing that warning needs a paid code-signing
certificate. The app is built for 64-bit Windows (`x64`); add `ia32`/`arm64` to
the `build.win.target` arches if needed.

## Data sources (`PROVIDER`)

The app supports four providers, selected with `PROVIDER` in `.env` or
`--provider=` on the command line.

| Provider | Login needed | Coverage |
| --- | --- | --- |
| `mock` | No | Built-in sample data. Great for trying the UI offline. |
| `spartanrecord` | No | HaloDotAPI via a public proxy. **Full CSR + placement progress** for the tracked playlists. Third-party route (see caveats). |
| `waypoint` | No | Public Halo Waypoint leaderboards. **Onyx players only** (public lists start at CSR 1500). |
| `official` | **Yes** | Official 343 skill/profile API. Full coverage for any gamertag, including placements. |
| `auto` (default) | — | Tries `official`, falls back to `spartanrecord`, then `waypoint`, then `mock`. |

### Credential-free CSR (`spartanrecord`)

If you don't want to register an Azure app or paste tokens, use `PROVIDER=spartanrecord`.
It reads the same HaloDotAPI data that [LeafApp_Infinite](https://github.com/iBotPeaches/LeafApp_Infinite)
uses, but reaches it through SpartanRecord's server-side proxy, so **no key, token or
Azure app is needed**. The key is injected by the proxy before it forwards the request.

What it returns per account:

- **CSR** for Ranked Arena, Doubles, Slayer and Snipers (e.g. `Onyx 1716`).
- **Placement progress** when a playlist has no CSR yet, shown as `X of Y played`
  (the HaloDotAPI fields `measurement_matches_remaining` and
  `initial_measurement_matches`, where `Y = initial` and `X = initial - remaining`).
  Example verified live: `n0dn0r` shows **3 of 5 played** in Ranked Slayer while
  Ranked Arena reports **1716 Onyx**.

**How it works.** The provider encodes a HaloDotAPI path into
`https://sr-nextjs.vercel.app/api/halodotapi?path=<encoded>`. Requesting that same
path directly on `https://grunt.api.dotapi.gg/games/halo-infinite/...` (as Leaf does)
with `Authorization: Bearer <DOTAPI_KEY>` and `API-Version: 2023-06-24` also works,
and the provider uses that direct mode automatically if you set `HALO_DOTAPI_KEY`.
If a configured `HALO_SEASON` returns an empty list, the provider retries without
it so a rolled-over season never makes every account look unranked.

**Caveats (please read).** This is a **third-party proxy**, not an official
343/Halo endpoint; it can change, rate-limit or disappear without notice, and it is
only appropriate for personal, low-volume lookups under SpartanRecord/HaloDotAPI's
own terms. The `official` provider remains the supported first-party route.

```bash
PROVIDER=spartanrecord npm run fetch:force   # or set PROVIDER=spartanrecord in .env
```

### Why `waypoint` is limited

The official CSR endpoint
(`GET https://skill.svc.halowaypoint.com/hi/playlist/{playlist_id}/csrs?players=xuid(...)`)
requires authenticated Spartan + clearance tokens; unauthenticated requests are
rejected (HTTP 401/502). Without credentials, the app can only read the **public
leaderboards**, which list Onyx players. Lower-ranked and unranked accounts won't
appear there.

The scraper walks the whole Onyx list for each playlist (paged ~100 rows at a
time, stopping at the first short/empty page, capped at
`WAYPOINT_MAX_PAGES`, default 50) and matches each gamertag per playlist, so a
player who is Onyx in several playlists is found in all of them.

**Reliability caveat (verified live).** Waypoint's CDN serves cached and
inconsistent responses for these leaderboard URLs. The exact `?page=N` URL often
returns HTTP 500 (making every playlist look empty) and can return a stale slice
(the Arena `page=1` URL was observed starting at rank 200, not rank 1), while
adding a unique query parameter routes around the cache. The scraper now adds a
cache-busting param, retries 5xx responses, de-duplicates rows by
xuid/gamertag and stops when a page adds nothing new. Even so, the public
snapshot is neither complete nor reliably ordered: a **"not listed" result only
means the account was not in the pages Waypoint returned**, not that the account
has no rank. Use the official API for authoritative results.

## Using the official API (recommended for accurate data)

Full, accurate ranks for any account require credentials from a Halo Waypoint
account. There are two ways to supply them.

### Option A — paste tokens (quickest)

1. Log in at <https://www.halowaypoint.com> in your browser.
2. Open DevTools → **Network**, trigger any request to `*.svc.halowaypoint.com`,
   and copy the request headers:
   - `x-343-authorization-spartan` → `HALO_SPARTAN_TOKEN`
   - `343-clearance` → `HALO_CLEARANCE_TOKEN`
3. Put them in `.env` and set `PROVIDER=official`.

Spartan tokens last about **4 hours**; re-paste when they expire.

### Option B — OAuth (recommended, auto-renewing)

This uses the Microsoft/Xbox OAuth flow with an Azure app registration and only
needs to be done once.

1. Register an app in the Azure portal (public client, redirect URI
   `http://localhost`), then set in `.env`:
   `HALO_AZURE_CLIENT_ID`, `HALO_AZURE_CLIENT_SECRET`,
   `HALO_AZURE_REDIRECT_URI`.
2. Run `npm run login` and follow the printed URL.
3. Paste the redirect URL (or code) back into the prompt. The refresh token is
   stored in `data/auth.json`, and the app renews Spartan/clearance tokens on
   its own from then on.

Set `PROVIDER=official` (or leave `auto`) once tokens are configured.

## How the daily cache works

`data/cache.json` looks like this:

```json
{
  "date": "2026-10-10",
  "generatedAt": "2026-10-10T22:31:00.000Z",
  "provider": "official",
  "season": "csrseason13-3",
  "playlists": [{ "key": "ranked-arena", "label": "Ranked Arena", "count": 42 }],
  "accounts": [
    {
      "input": "MasterChief",
      "gamertag": "MasterChief",
      "xuid": "1234567890123456",
      "gamerpic": "https://...",
      "found": true,
      "source": "official",
      "ranks": {
        "ranked-arena": {
          "current": { "csr": 1652, "tier": "Onyx", "subTier": 0 },
          "seasonMax": { "csr": 1701, "tier": "Onyx", "subTier": 0 }
        }
      }
    }
  ]
}
```

To force a rebuild, delete `data/cache.json` or click **Refresh** / run
`npm run fetch:force`.

## Project layout

```
accounts.txt              your list of gamertags (edit this)
.env.example              configuration template -> copy to .env
src/
  index.js                CLI entry point (flags, start/serve)
  config.js               paths, playlists, service hosts, tier mapping
  accounts.js             account-list parsing + URL/cache helpers
  cache.js                daily JSON cache (atomic writes)
  update.js               refresh orchestration + daily dedupe
  scheduler.js            daily timer (default 06:00 local)
  server.js               local HTTP server + /api endpoints
  providers/
    index.js              provider selection & auto fallback
    official.js           official 343 skill/profile API
    spartanrecord.js      HaloDotAPI (CSR + placements) via public proxy / direct key
    waypoint.js           public leaderboard scraper
    mock.js               offline sample data
  auth/
    oauth.js              Microsoft/Xbox OAuth token exchange
    tokens.js             token caching/refresh
    login.js              interactive login helper
public/                   the local web page (HTML/CSS/JS, no build step)
  images/                 bundled rank badge PNGs (see Downloading the badge images)
scripts/
  download-badges.mjs     Node downloader for the badge PNGs
  download-badges.ps1     Windows-native PowerShell downloader
electron/
  main.cjs                Electron tray app (starts server, tray menu)
  assets/tray-icon.png    tray icon (32x32)
build/
  icon.png                installer/app icon (256x256, used by electron-builder)
test/                     bundled tests + saved Waypoint fixtures
data/                     generated: cache.json, auth.json
```

## Local API

The page talks to a tiny JSON API served by the same process:

- `GET /api/ranks` — the current cache, plus a `fresh` boolean.
- `GET /api/health` — `{ "ok": true, "provider": "..." }`.
- `POST /api/refresh` — refresh now; add `?force=1` to ignore today's cache.

## Notes & limitations

- **Public leaderboards only list Onyx players.** Use the official API for full
  coverage.
- Tier names derived from CSR when the source doesn't provide them
  (`csrToTier`) are an approximation; official tier/sub-tier fields are
  preferred whenever available.
- `data/` (cache and any auth token) is generated at runtime and should be kept
  private if you use the official API.
- The server binds locally only; it is intended for personal use on your machine.
