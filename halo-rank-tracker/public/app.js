// Client for the local Halo Rank Tracker page. Reads /api/ranks (served from
// data/cache.json) and renders one card per account with its four ranks.

const state = { playlists: [], data: null };

const $ = (sel) => document.querySelector(sel);

function tierClass(rank) {
  const tier = rank?.tier || 'Unranked';
  return `tier-${tier}`;
}

function emblemText(rank) {
  if (!rank) return '—';
  if (rank.tier === 'Onyx') return 'ONX';
  if (rank.tier === 'Placements' || rank.tier === 'Unranked') return '·';
  return rank.subTier ? String(rank.subTier) : '·';
}

/**
 * Tier crest. Banded tiers share a shield; Diamond is a rhombus and Onyx a
 * faceted gem, so each rank reads as an icon rather than a plain circle. The
 * shape is coloured by the tier-* CSS class; the sub-tier sits on top.
 */
function crestShape(tier) {
  switch (tier) {
    case 'Diamond':
      return '<path d="M24 3 L45 24 L24 45 L3 24 Z"/>';
    case 'Onyx':
      return '<path d="M24 2 L43 13 L43 35 L24 46 L5 35 L5 13 Z"/>';
    case 'Placements':
    case 'Unranked':
      return '<circle class="ring" cx="24" cy="24" r="19" fill="none" stroke-width="3" stroke-dasharray="5 5"/>';
    default:
      return '<path d="M24 3 L42 10 L42 24 C42 35 34 43 24 46 C14 43 6 35 6 24 L6 10 Z"/>';
  }
}

// Badges are looked up locally first (public/images, shipped inside the app so
// they work offline and are not blocked by ORB), then from leafapp.co, then the
// built-in SVG crest.
const LOCAL_BADGE_BASE = 'images/';
const REMOTE_BADGE_BASE = 'https://leafapp.co/images/csrs/';
const BADGE_SLUG = {
  Bronze: 'bronze',
  Silver: 'silver',
  Gold: 'gold',
  Platinum: 'platinum',
  Diamond: 'diamond',
};

/**
 * Map a rank to its badge filename. Onyx is a single image; the five banded
 * tiers use <tier>-<subTier>.png for sub-tiers 1-6. Placements, Unranked and
 * anything unexpected return null and use the built-in SVG crest.
 */
function badgeFile(rank) {
  if (!rank) return null;
  if (rank.tier === 'Onyx') return 'onyx.png';
  const slug = BADGE_SLUG[rank.tier];
  if (slug && rank.subTier >= 1 && rank.subTier <= 6) {
    return `${slug}-${rank.subTier}.png`;
  }
  return null;
}

/** Candidate URLs for a rank, in load order: local bundle, then remote host. */
function badgeUrls(rank) {
  const file = badgeFile(rank);
  if (!file) return [];
  return [`${LOCAL_BADGE_BASE}${file}`, `${REMOTE_BADGE_BASE}${file}`];
}

function crestMarkup(rank) {
  const tier = rank?.tier || 'Unranked';
  return (
    `<svg class="crest" viewBox="0 0 48 48" aria-hidden="true">${crestShape(tier)}</svg>` +
    `<span class="crest-label">${emblemText(rank)}</span>`
  );
}

/** Build the emblem node, preferring the leafapp badge and falling back to SVG. */
function emblemEl(rank) {
  const wrap = document.createElement('div');
  wrap.className = `emblem ${tierClass(rank)}`;
  const urls = badgeUrls(rank);
  if (!urls.length) {
    wrap.innerHTML = crestMarkup(rank);
    return wrap;
  }
  const img = document.createElement('img');
  img.className = 'crest-img';
  img.alt = rank.tier === 'Onyx' ? 'Onyx' : `${rank.tier} ${rank.subTier}`;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  let attempt = 0;
  img.addEventListener('error', () => {
    attempt += 1;
    if (attempt < urls.length) {
      img.src = urls[attempt];
      return;
    }
    wrap.classList.add('crest-fallback');
    wrap.innerHTML = crestMarkup(rank);
  });
  img.src = urls[0];
  wrap.appendChild(img);
  return wrap;
}

function rankTile(playlist, rank) {
  const current = rank?.current || null;
  const tile = document.createElement('div');
  tile.className = 'tile';

  const unlisted = !current;
  if (unlisted && rank?.unlisted) tile.classList.add('unlisted');

  const name = current
    ? current.tier === 'Onyx'
      ? 'Onyx'
      : current.tier === 'Placements'
        ? 'Placements'
        : `${current.tier} ${current.subTier}`
    : rank?.unlisted
      ? 'Not listed'
      : 'No data';

  const csrLine = current?.csr != null
    ? `CSR <b>${current.csr}</b>`
    : current?.tier === 'Placements'
      ? current.placementsTotal
        ? `${current.placementsPlayed} of ${current.placementsTotal} played`
        : 'Placements'
      : rank?.error
        ? '—'
        : '';

  const maxLine = rank?.seasonMax?.csr != null
    ? `<div class="tier-csr">Season best <b>${rank.seasonMax.csr}</b></div>`
    : '';

  tile.appendChild(Object.assign(document.createElement('div'), {
    className: 'label', title: playlist.label, textContent: playlist.label,
  }));
  tile.appendChild(emblemEl(current));
  tile.appendChild(Object.assign(document.createElement('div'), {
    className: 'tier-name', textContent: name,
  }));
  if (csrLine) {
    const csr = document.createElement('div');
    csr.className = 'tier-csr';
    csr.innerHTML = csrLine;
    tile.appendChild(csr);
  }
  if (maxLine) tile.insertAdjacentHTML('beforeend', maxLine);
  return tile;
}

function monogram(name) {
  const el = document.createElement('div');
  el.className = 'avatar monogram';
  el.textContent = (name || '?').trim().charAt(0).toUpperCase();
  return el;
}

function avatarEl(account) {
  if (account.gamerpic) {
    const img = document.createElement('img');
    img.className = 'avatar';
    img.src = account.gamerpic;
    img.alt = `${account.gamertag} gamerpic`;
    img.loading = 'lazy';
    img.onerror = () => img.replaceWith(monogram(account.gamertag));
    return img;
  }
  return monogram(account.gamertag);
}

function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function copyEmail(el, email) {
  let ok = false;
  try {
    await navigator.clipboard.writeText(email);
    ok = true;
  } catch {
    ok = legacyCopy(email);
  }
  const original = el.dataset.label || el.textContent;
  el.dataset.label = original;
  el.classList.toggle('copied', ok);
  el.textContent = ok ? 'Copied email \u2713' : 'Copy failed';
  setTimeout(() => {
    el.textContent = original;
    el.classList.remove('copied');
  }, 1500);
}

/**
 * Three-dot overflow menu for one account card. Currently holds "Remove
 * account", which deletes the gamertag from accounts.txt through the API.
 */
function accountMenu(account) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-wrap';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'menu-btn';
  trigger.textContent = '\u22ef';
  trigger.title = 'Account options';
  trigger.setAttribute('aria-label', `Options for ${account.gamertag || account.input || 'account'}`);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'menu-item danger';
  remove.setAttribute('role', 'menuitem');
  remove.textContent = 'Remove account';
  remove.addEventListener('click', async () => {
    const tag = account.gamertag || account.input;
    if (!confirm(`Remove ${tag || 'this account'} from the tracker?`)) return;
    remove.disabled = true;
    try {
      const resp = await fetch('/api/accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gamertag: tag }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      await load();
    } catch (err) {
      remove.disabled = false;
      alert(`Could not remove account: ${err.message}`);
    }
  });
  menu.appendChild(remove);

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  });

  wrap.append(trigger, menu);
  return wrap;
}

/** Close every open overflow menu. */
function closeMenus() {
  document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
  document.querySelectorAll('.menu-btn[aria-expanded="true"]').forEach((b) => {
    b.setAttribute('aria-expanded', 'false');
  });
}

function accountCard(account) {
  const card = document.createElement('article');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';
  head.appendChild(avatarEl(account));

  const who = document.createElement('div');
  who.className = 'who';

  const name = document.createElement('button');
  name.type = 'button';
  name.className = 'name';
  name.textContent = account.gamertag || account.input || '(unknown)';
  if (account.email) {
    name.classList.add('copyable');
    // Never render the address; the tooltip only says an email is on file.
    name.title = 'Sign-in email on file - click to copy';
    name.addEventListener('click', () => copyEmail(name, account.email));
  } else {
    name.classList.add('no-email');
    name.title = 'No email on file - use the account menu to remove and re-add with an email';
  }

  // The name and its email-on-file marker sit on one row; the marker conveys
  // that an address exists without ever printing it.
  const nameRow = document.createElement('div');
  nameRow.className = 'name-row';
  nameRow.appendChild(name);
  if (account.email) {
    const flag = document.createElement('span');
    flag.className = 'email-flag';
    flag.textContent = '\u2709';
    flag.setAttribute('role', 'img');
    flag.setAttribute('aria-label', 'Sign-in email on file');
    flag.title = 'Sign-in email on file';
    nameRow.appendChild(flag);
  }

  const sub = document.createElement('div');
  sub.className = 'sub';
  if (account.pending) {
    sub.innerHTML = '<span class="pending">Added - refresh to fetch ranks</span>';
  } else if (!account.found) {
    sub.innerHTML = '<span class="err">Not found on this data source</span>';
  } else {
    const bits = [];
    if (account.xuid) bits.push(`XUID ${account.xuid}`);
    sub.innerHTML = bits.length ? bits.join(' \u00b7 ') : 'Listed';
  }

  who.append(nameRow, sub);
  head.appendChild(who);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = account.source || 'data';
  head.appendChild(badge);
  head.appendChild(accountMenu(account));

  card.appendChild(head);

  const ranks = document.createElement('div');
  ranks.className = 'ranks';
  for (const playlist of state.playlists) {
    ranks.appendChild(rankTile(playlist, account.ranks?.[playlist.key]));
  }
  card.appendChild(ranks);
  return card;
}

function renderLegend(playlists) {
  const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Onyx'];
  const colors = {
    Bronze: 'var(--bronze)', Silver: 'var(--silver)', Gold: 'var(--gold)',
    Platinum: 'var(--platinum)', Diamond: 'var(--diamond)', Onyx: 'var(--onyx)',
  };
  $('#legend').innerHTML = tiers
    .map((t) => `<span><i class="dot" style="background:${colors[t]}"></i>${t}</span>`)
    .join('');
}

function render(data) {
  state.data = data;
  state.playlists = data.playlists || [];

  const generated = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'never';
  const freshness = data.fresh ? '' : ' <span class="stale">(stale)</span>';
  $('#meta').innerHTML =
    `Source: <b>${data.provider || '—'}</b> · ${data.accounts?.length || 0} accounts<br>` +
    `Updated ${generated}${freshness}`;

  const container = $('#accounts');
  container.innerHTML = '';
  if (!data.accounts || !data.accounts.length) {
    container.innerHTML = '<p class="empty">No accounts yet. Use + Add Account to track a gamertag.</p>';
    return;
  }
  for (const account of data.accounts) container.appendChild(accountCard(account));
  renderLegend(state.playlists);
}

async function load() {
  try {
    const resp = await fetch('/api/ranks', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    render(await resp.json());
  } catch (err) {
    $('#accounts').innerHTML = `<p class="empty">Could not load ranks: ${err.message}</p>`;
  }
}

$('#refresh').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const resp = await fetch('/api/refresh?force=1', { method: 'POST' });
    const data = await resp.json();
    render(data);
  } catch (err) {
    alert(`Refresh failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
});

load();

document.addEventListener('click', closeMenus);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus();
});

// --- Add Account dialog ---------------------------------------------------

const accountDialog = $('#account-dialog');
const accountForm = $('#account-form');
const accountError = $('#account-error');

$('#add-account').addEventListener('click', () => {
  accountError.hidden = true;
  accountForm.reset();
  accountDialog.showModal();
  $('#account-gamertag').focus();
});

$('#account-cancel').addEventListener('click', () => accountDialog.close());

accountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = $('#account-submit');
  accountError.hidden = true;
  submit.disabled = true;
  submit.textContent = 'Adding\u2026';
  try {
    const resp = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gamertag: $('#account-gamertag').value,
        email: $('#account-email').value,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    accountDialog.close();
    await load();
  } catch (err) {
    accountError.textContent = err.message;
    accountError.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Add account';
  }
});
