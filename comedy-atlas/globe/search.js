/**
 * COMEDY ATLAS — Interactive Globe: search
 * (site/comedy-atlas/globe/search.js)
 *
 * CHECKPOINT 7 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * REUSES the existing, already-published `data/comedy-atlas/search_index.json`
 * (see `scripts/generate_search_index.py` and the real consumer,
 * `site/comedy-atlas/search/index.html`) — this module builds NO second
 * index. Every record shape, field name and type value below
 * (`type`/`name`/`aliases`/`city`/`country`/`date`/`status`/`url`, types
 * `event`/`comic`/`venue`/`festival`/`city`/`organizer`) is read verbatim
 * from that existing generator's `ALLOWED_KEYS`/`VALID_TYPES` and from the
 * real fetch/render logic in `search/index.html`'s inline script — nothing
 * here is invented.
 *
 * Pure data functions (`groupAndFilterRecords`, `findCityForRecord`) are
 * exported separately from the DOM controller (`mountGlobeSearch`) so the
 * matching/grouping logic is independently testable without a browser.
 *
 * Exports:
 *   loadSearchIndex({url, fetchImpl}) -> Promise<object[]>
 *     Never throws — network failure or malformed JSON both resolve to `[]`,
 *     mirroring data-adapter.js's `loadGlobeCities` discipline.
 *   groupAndFilterRecords(records, query, {limit}) -> {groups, total}
 *     groups: [{type, label, items}] in a fixed, documented order; empty
 *     groups are omitted. Ranking within a group: exact name match, then
 *     name-starts-with, then any other substring hit — same tiering as the
 *     existing search/index.html page, for consistent behaviour app-wide.
 *   findCityForRecord(record, cities) -> GlobeCity|null
 *     Matches a search_index.json record to a loaded GlobeCity by city
 *     name (+ country code when present) — the only fields the two data
 *     sources share. Never invents a match: returns null rather than
 *     guessing when no real city lines up.
 *   mountGlobeSearch(inputEl, options) -> {destroy, isLoading, hasFailed}
 *     Wires the given `<input>` (the existing topbar search box built by
 *     experience.js's SHELL_HTML) to a debounced, grouped, keyboard
 *     accessible results dropdown. `globe-chrome.css` is frozen for this
 *     checkpoint (Opus-validated, not in this agent's touch list), so —
 *     exactly like panel.js's own injectStylesOnce() — this module injects
 *     one small idempotent <style> block into <head>, scoped to its own
 *     class names and reading only existing `--atlas-globe-*` tokens.
 */

const DEBOUNCE_MS = 150;

/** Fixed, documented group order + label — mirrors search/index.html's own
 * TYPES list (event/comic/venue/festival/city/organizer), reordered so the
 * plan's own phrasing ("grouped by type — cities / shows / venues /
 * festivals / comics") appears first, with organizer last since it is not
 * named in the plan's group list but is real, un-fabricated data the
 * existing index already carries. */
const GROUP_ORDER = [
  { type: 'city', label: 'Cities' },
  { type: 'event', label: 'Shows' },
  { type: 'venue', label: 'Venues' },
  { type: 'festival', label: 'Festivals' },
  { type: 'comic', label: 'Comics' },
  { type: 'organizer', label: 'Organizers' },
];

const DEFAULT_LIMIT_PER_GROUP = 8;

/**
 * Load and parse `search_index.json`. Never throws — any failure (network,
 * non-ok response, malformed JSON, non-array payload) resolves to `[]`,
 * exactly like `data-adapter.js`'s `loadGlobeCities` never crashes its
 * caller on bad input.
 *
 * @param {{url: string, fetchImpl: (url: string) => Promise<{ok: boolean, json: () => Promise<unknown>}>}} options
 * @returns {Promise<object[]>}
 */
export async function loadSearchIndex({ url, fetchImpl }) {
  try {
    const response = await fetchImpl(url);
    if (!response || !response.ok) return [];
    const raw = await response.json();
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function haystackFor(record) {
  const parts = [record && record.name];
  if (record && Array.isArray(record.aliases)) parts.push(...record.aliases);
  if (record && record.city) parts.push(record.city);
  return parts.filter(Boolean).join(' ␟ ').toLowerCase();
}

function rankWithinGroup(query) {
  const q = query.toLowerCase();
  return (record) => {
    const name = (record && record.name ? record.name : '').toLowerCase();
    if (name === q) return 0;
    if (name.indexOf(q) === 0) return 1;
    return 2;
  };
}

/**
 * Filters `records` (the raw search_index.json array) by a free-text query
 * against name/aliases/city, and groups the matches by type in the fixed
 * `GROUP_ORDER`. An empty/whitespace query returns no groups at all (the
 * "explicit empty state before typing" case is the caller's concern, not
 * this pure function's) rather than the entire index, since the plan calls
 * for debounced *search*, not a full directory browse.
 *
 * Never throws: garbage `records` (non-array, null entries, missing
 * fields) degrades to empty groups, matching every other pure module in
 * this codebase's "one malformed record cannot crash" discipline.
 *
 * @param {unknown} records
 * @param {string} query
 * @param {{limit?: number}} [opts]
 * @returns {{groups: {type: string, label: string, items: object[]}[], total: number}}
 */
export function groupAndFilterRecords(records, query, opts) {
  const options = opts || {};
  const limit = Number.isFinite(options.limit) ? options.limit : DEFAULT_LIMIT_PER_GROUP;
  const list = Array.isArray(records) ? records.filter((r) => r && typeof r === 'object') : [];
  const q = isNonEmptyString(query) ? query.trim() : '';

  if (!q) return { groups: [], total: 0 };

  const qLower = q.toLowerCase();
  const matches = list.filter((r) => haystackFor(r).indexOf(qLower) !== -1);

  const rank = rankWithinGroup(q);
  const groups = [];
  let total = 0;

  GROUP_ORDER.forEach(({ type, label }) => {
    const forType = matches
      .filter((r) => r.type === type)
      .sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        return (a.name || '').localeCompare(b.name || '');
      });
    if (forType.length === 0) return;
    total += forType.length;
    groups.push({ type, label, items: forType.slice(0, limit) });
  });

  return { groups, total };
}

function normalizeForMatch(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Matches one search_index.json record to a loaded GlobeCity by the only
 * fields the two sources genuinely share: city display name (and country
 * code, when the record has one, to disambiguate same-named cities in
 * different countries). Returns `null` — never a guess — when no city in
 * `cities` really corresponds, e.g. the record's city hasn't made the
 * globe's own scope-gated publish list yet (see the plan's "63 of 140
 * cities are currently published").
 *
 * @param {{city?: unknown, country?: unknown, type?: unknown, name?: unknown}} record
 * @param {object[]} cities
 * @returns {object|null}
 */
export function findCityForRecord(record, cities) {
  if (!record) return null;
  const list = Array.isArray(cities) ? cities : [];
  const cityName = normalizeForMatch(record.type === 'city' ? record.name : record.city);
  if (!cityName) return null;
  const country = normalizeForMatch(record.country);

  const candidates = list.filter((c) => normalizeForMatch(c && c.name) === cityName);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  if (!country) return candidates[0];
  const byCountry = candidates.find((c) => normalizeForMatch(c && c.countryCode) === country);
  return byCountry || candidates[0];
}

/* ------------------------------------------------------------------ */
/* DOM controller                                                      */
/* ------------------------------------------------------------------ */

const STYLE_ID = 'atlas-globe-search-styles';

function injectSearchStylesOnce() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.atlas-globe-search-dropdown{
  position:absolute;left:0;right:0;top:100%;margin-top:6px;z-index:40;
  max-height:min(60vh,420px);overflow-y:auto;
  background:var(--atlas-globe-panel-bg,#111827);
  border:1px solid var(--atlas-globe-panel-border,#1e2a3a);
  border-radius:var(--atlas-globe-radius,10px);
  box-shadow:0 12px 32px rgba(0,0,0,.45);
  color:var(--atlas-globe-cream,#f0f0f0);
  font-size:13px;
}
.atlas-globe-search-dropdown[hidden]{display:none}
.atlas-globe-search-status{padding:10px 14px;color:var(--atlas-globe-muted,#8899aa);font-size:12.5px}
.atlas-globe-search-group-label{padding:8px 14px 2px;font-size:10.5px;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;color:var(--atlas-globe-muted,#8899aa)}
.atlas-globe-search-item{display:flex;flex-direction:column;gap:1px;padding:8px 14px;cursor:pointer}
.atlas-globe-search-item[data-active="true"],.atlas-globe-search-item:hover{background:rgba(255,255,255,.06)}
.atlas-globe-search-item-name{font-weight:600;color:var(--atlas-globe-cream,#f0f0f0)}
.atlas-globe-search-item-meta{font-size:11.5px;color:var(--atlas-globe-muted,#8899aa)}
`;
  document.head.appendChild(style);
}

/**
 * @param {HTMLInputElement} inputEl  The existing topbar search `<input>`.
 * @param {{
 *   fetchImpl?: (url: string) => Promise<Response>,
 *   indexUrl?: string,
 *   getCities?: () => object[],
 *   onSelectCity?: (id: string) => void,
 *   onSelectRecord?: (record: object, city: object|null) => void,
 * }} options
 * @returns {{destroy: () => void, isLoading: () => boolean, hasFailed: () => boolean}}
 */
export function mountGlobeSearch(inputEl, options) {
  const opts = options || {};
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : (...args) => fetch(...args);
  const indexUrl = opts.indexUrl || '../data/comedy-atlas/search_index.json';
  const getCities = typeof opts.getCities === 'function' ? opts.getCities : () => [];
  const onSelectCity = typeof opts.onSelectCity === 'function' ? opts.onSelectCity : () => {};
  const onSelectRecord = typeof opts.onSelectRecord === 'function' ? opts.onSelectRecord : () => {};

  injectSearchStylesOnce();

  let destroyed = false;
  let records = null; // null === still loading
  let failed = false;
  let flatItems = []; // {record, el}[], in on-screen order, for keyboard nav
  let activeIndex = -1;
  let debounceTimer = null;

  const container = inputEl.parentElement || inputEl;
  if (container && typeof window !== 'undefined') {
    const position = window.getComputedStyle(container).position;
    if (position === 'static' || !position) container.style.position = 'relative';
  }

  const dropdown = document.createElement('div');
  dropdown.className = 'atlas-globe-search-dropdown';
  dropdown.id = 'atlas-globe-search-results-' + Math.random().toString(36).slice(2);
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Search results');
  dropdown.hidden = true;
  container.appendChild(dropdown);

  inputEl.setAttribute('role', 'combobox');
  inputEl.setAttribute('aria-expanded', 'false');
  inputEl.setAttribute('aria-autocomplete', 'list');
  inputEl.setAttribute('aria-controls', dropdown.id);

  function setActive(index) {
    flatItems.forEach((entry, i) => {
      entry.el.setAttribute('data-active', String(i === index));
      entry.el.setAttribute('aria-selected', String(i === index));
    });
    activeIndex = index;
    if (index >= 0 && flatItems[index]) {
      flatItems[index].el.scrollIntoView({ block: 'nearest' });
      inputEl.setAttribute('aria-activedescendant', flatItems[index].el.id);
    } else {
      inputEl.removeAttribute('aria-activedescendant');
    }
  }

  function open() {
    dropdown.hidden = false;
    inputEl.setAttribute('aria-expanded', 'true');
  }

  function close() {
    dropdown.hidden = true;
    inputEl.setAttribute('aria-expanded', 'false');
    setActive(-1);
  }

  function metaLine(record) {
    const bits = [];
    if (record.city) bits.push(record.country ? record.city + ', ' + record.country : record.city);
    if (record.status) bits.push(record.status);
    return bits.join(' · ');
  }

  function selectRecord(record) {
    const city = findCityForRecord(record, getCities());
    if (record.type === 'city') {
      if (city) onSelectCity(city.id);
    } else {
      onSelectRecord(record, city);
    }
    close();
  }

  function render() {
    dropdown.innerHTML = '';
    flatItems = [];

    const query = inputEl.value;
    if (!query || !query.trim()) {
      close();
      return;
    }

    if (records === null) {
      const status = document.createElement('div');
      status.className = 'atlas-globe-search-status';
      status.setAttribute('role', 'status');
      status.textContent = 'Loading search index…';
      dropdown.appendChild(status);
      open();
      return;
    }

    if (failed) {
      const status = document.createElement('div');
      status.className = 'atlas-globe-search-status';
      status.setAttribute('role', 'alert');
      status.textContent = 'Search is temporarily unavailable — the search index failed to load.';
      dropdown.appendChild(status);
      open();
      return;
    }

    const { groups, total } = groupAndFilterRecords(records, query);

    if (total === 0) {
      const status = document.createElement('div');
      status.className = 'atlas-globe-search-status';
      status.setAttribute('role', 'status');
      status.textContent = 'No results for “' + query.trim() + '”.';
      dropdown.appendChild(status);
      open();
      return;
    }

    groups.forEach((group) => {
      const label = document.createElement('div');
      label.className = 'atlas-globe-search-group-label';
      label.textContent = group.label + ' (' + group.items.length + ')';
      dropdown.appendChild(label);

      group.items.forEach((record) => {
        const item = document.createElement('div');
        item.className = 'atlas-globe-search-item';
        item.id = dropdown.id + '-item-' + flatItems.length;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.setAttribute('data-active', 'false');

        const name = document.createElement('div');
        name.className = 'atlas-globe-search-item-name';
        name.textContent = record.name || '';
        item.appendChild(name);

        const meta = metaLine(record);
        if (meta) {
          const metaEl = document.createElement('div');
          metaEl.className = 'atlas-globe-search-item-meta';
          metaEl.textContent = meta;
          item.appendChild(metaEl);
        }

        item.addEventListener('mousedown', (ev) => {
          // mousedown (not click) so this fires before the input's blur.
          ev.preventDefault();
          selectRecord(record);
        });

        dropdown.appendChild(item);
        flatItems.push({ record, el: item });
      });
    });

    open();
  }

  function onInput() {
    startLoadingIndex();
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(render, DEBOUNCE_MS);
  }

  function onKeydown(ev) {
    if (dropdown.hidden && ev.key !== 'Enter') return;
    if (ev.key === 'ArrowDown') {
      if (flatItems.length === 0) return;
      ev.preventDefault();
      setActive(Math.min(activeIndex + 1, flatItems.length - 1));
    } else if (ev.key === 'ArrowUp') {
      if (flatItems.length === 0) return;
      ev.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (ev.key === 'Enter') {
      const idx = activeIndex >= 0 ? activeIndex : 0;
      const entry = flatItems[idx];
      if (entry) {
        ev.preventDefault();
        selectRecord(entry.record);
      }
    } else if (ev.key === 'Escape') {
      if (!dropdown.hidden) {
        ev.preventDefault();
        close();
      }
    }
  }

  function onBlur() {
    // Delay so a mousedown-selected item's handler still runs first.
    window.setTimeout(() => {
      if (!destroyed) close();
    }, 120);
  }

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onKeydown);
  inputEl.addEventListener('blur', onBlur);

  // CP10 perf: `search_index.json` is 1.0 MB — by far the largest payload
  // the globe touches after the vendored three.js bundle (measured; see
  // docs/COMEDY_ATLAS_GLOBE_IMPLEMENTATION.md's Performance section). Every
  // earlier checkpoint fetched it unconditionally the instant the globe
  // mounted, whether or not the visitor ever used search. Loaded here
  // instead of the initial fetch: this function is invoked lazily, the
  // first time the input is focused OR receives a keystroke — whichever
  // happens first — and only once (`loadStarted` guards re-entry). A
  // visitor who never touches search never pays this 1.0 MB.
  //
  // Loads directly (rather than delegating to loadSearchIndex, which
  // deliberately collapses every failure mode to an empty array) so this
  // controller can tell "loaded, genuinely empty index" apart from "failed
  // to load" and render the correct one of the two explicit states.
  let loadStarted = false;
  function startLoadingIndex() {
    if (loadStarted) return;
    loadStarted = true;
    fetchImpl(indexUrl)
      .then((response) => {
        if (!response || !response.ok) throw new Error('HTTP ' + (response && response.status));
        return response.json();
      })
      .then((raw) => {
        if (destroyed) return;
        if (!Array.isArray(raw)) throw new Error('malformed search index');
        records = raw;
        failed = false;
        render();
      })
      .catch(() => {
        if (destroyed) return;
        failed = true;
        records = [];
        render();
      });
  }
  inputEl.addEventListener('focus', startLoadingIndex);

  return {
    destroy() {
      destroyed = true;
      if (debounceTimer) window.clearTimeout(debounceTimer);
      inputEl.removeEventListener('input', onInput);
      inputEl.removeEventListener('keydown', onKeydown);
      inputEl.removeEventListener('blur', onBlur);
      inputEl.removeEventListener('focus', startLoadingIndex);
      dropdown.remove();
    },
    isLoading() {
      return records === null;
    },
    hasFailed() {
      return failed;
    },
  };
}

export const __internal = { GROUP_ORDER, haystackFor, normalizeForMatch };
