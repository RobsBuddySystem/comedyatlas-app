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
 *     Wires the given `<input>` — the topbar search box built by
 *     experience.js's SHELL_HTML, OR (2026-08-16, globe-first hero bugfix)
 *     ANY other real search input, e.g. the homepage hero's own `#atlas-q` —
 *     to a debounced, grouped, keyboard accessible results dropdown.
 *     `globe-chrome.css` is frozen for this checkpoint (Opus-validated, not
 *     in this agent's touch list), so — exactly like panel.js's own
 *     injectStylesOnce() — this module injects one small idempotent <style>
 *     block into <head>, scoped to its own class names and reading only
 *     existing `--atlas-globe-*` tokens. `opts.dropdownEl` (new, backward
 *     compatible — omitted keeps the original behaviour of creating and
 *     owning a fresh <div>) lets a caller reuse an existing, already
 *     correctly-positioned container instead of a second one being created;
 *     see index.html's `#atlas-q-suggest`, present in that markup since the
 *     work order's original global-search pass but never actually wired
 *     until this fix.
 *   HERO_SEARCH_BREAKPOINT_PX / resolveGlobeSearchOwner(viewportWidth)
 *     The single source of truth for "which of the two coexisting search
 *     inputs (globe topbar vs. homepage hero) is the live, globe-driving one
 *     at a given width" — see resolveGlobeSearchOwner's own header comment.
 */

const DEBOUNCE_MS = 150;

/**
 * The exact width, in CSS pixels, at which index.html's own
 * `@media(min-width:761px){html.atlas-ghero .atlas-hero-globe-stage
 * .atlas-globe-topbar{display:none}}` rule (site/comedy-atlas/index.html,
 * ~line 212) hides the globe's topbar search. Exported so index.html's
 * `window.matchMedia` check and this decision can never drift apart —
 * before this fix the CSS rule and the (nonexistent) JS behaviour already
 * disagreed once, which is exactly how the hero search stopped driving the
 * globe at this width in the first place.
 */
export const HERO_SEARCH_BREAKPOINT_PX = 761;

/**
 * Decides which single search input is the live, globe-driving one at a
 * given viewport width. Pure and deterministic on purpose: the invariant
 * this whole fix exists to guarantee — "at every viewport width there is
 * exactly one visible search that can drive the globe" (FABLE contract,
 * "Search result selection and globe marker selection are two views of the
 * same record") — must hold for every width, not just be eyeballed in a
 * browser. `'hero'` below `HERO_SEARCH_BREAKPOINT_PX` never happens: on
 * mobile the hero-figure globe renders ABOVE the hero-copy search column
 * (`.atlas-hero{flex-direction:column-reverse}`), so the globe's own topbar
 * search is the one already in the first fold — see index.html's own
 * "on mobile the globe is the first visual and its topbar search IS the
 * in-fold search" comment, ~line 210.
 *
 * @param {number} viewportWidth
 * @returns {'hero'|'topbar'}
 */
export function resolveGlobeSearchOwner(viewportWidth) {
  return Number.isFinite(viewportWidth) && viewportWidth >= HERO_SEARCH_BREAKPOINT_PX
    ? 'hero'
    : 'topbar';
}

/**
 * Resolves a city result chosen from the hero search into either a live
 * globe fly-to or an honest navigation fallback — and, critically, NEVER a
 * silent no-op (2026-08-16 follow-up: "if the globe fails to mount,
 * selecting a city from the hero search silently does nothing" — the same
 * bug Robert reported, wearing a different hat: a path that quietly does
 * nothing is worse than one that fails loudly, because nobody ever finds
 * out).
 *
 * Provider-agnostic and DOM-free on purpose — the caller (index.html's own
 * "HERO SEARCH -> GLOBE BRIDGE") injects the live handle, the current
 * provider name, how to derive a city's own page href, and how to
 * navigate — so this is pure enough to unit test without a fake DOM, and
 * so it never caches "was the globe ready when I first mounted": every
 * call re-reads whatever `globeHandle` the caller hands in AT THAT MOMENT,
 * which is what makes a late-mounting globe still get flown to instead of
 * navigated away from on a later selection (see the "NOT a race" test).
 *
 * Falls back to navigation for every reason the globe might not be able to
 * take the selection — never mounted (`globeHandle` is null/undefined),
 * mount failed/threw earlier (same as above — no handle was ever set), or
 * `selectCity` itself throwing mid-call (caught here) — not just one of
 * them. Only stays silent when there is genuinely nothing honest left to
 * do: a matched city with no real page to send anyone to (`cityHrefFor`
 * returns null/empty, e.g. no slug) is the one case this module will not
 * invent a link for, matching this codebase's "never guess" discipline
 * elsewhere (findCityForRecord, data-adapter.js's parseCity).
 *
 * @param {{
 *   id: string,
 *   city: object|null,
 *   globeHandle: {selectCity: (idOrSlug: string) => void}|null,
 *   provider: 'three'|'maplibre'|null,
 *   cityHrefFor: (city: object|null) => string|null,
 *   navigate: (href: string) => void,
 * }} args
 * @returns {void}
 */
export function selectCityWithFallback(args) {
  const opts = args || {};
  const city = opts.city || null;
  const globeHandle = opts.globeHandle || null;
  const provider = opts.provider;
  const cityHrefFor = typeof opts.cityHrefFor === 'function' ? opts.cityHrefFor : () => null;
  const navigate = typeof opts.navigate === 'function' ? opts.navigate : () => {};

  function fallbackToCityPage() {
    const href = cityHrefFor(city);
    if (href) navigate(href);
  }

  if (!globeHandle) {
    fallbackToCityPage();
    return;
  }

  try {
    // The two globe providers key a city by different fields -- see
    // mountGlobeSearch's own onSelectCity(id, city) header comment for why.
    if (provider === 'maplibre') {
      if (city && city.slug) {
        globeHandle.selectCity(city.slug);
      } else {
        fallbackToCityPage();
      }
    } else if (opts.id) {
      globeHandle.selectCity(opts.id);
    } else {
      fallbackToCityPage();
    }
  } catch (e) {
    // A handle that EXISTS but cannot actually take the selection (mount
    // left it in a half-built state, a provider-internal error, etc.) must
    // reach the same honest fallback as no handle at all -- never a
    // swallowed error and never a stuck page.
    fallbackToCityPage();
  }
}

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
 * @param {HTMLInputElement} inputEl  A real search `<input>` — the globe
 *   topbar's own, or (2026-08-16) any other input this module doesn't own,
 *   e.g. the homepage hero's `#atlas-q`.
 * @param {{
 *   fetchImpl?: (url: string) => Promise<Response>,
 *   indexUrl?: string,
 *   getCities?: () => object[],
 *   onSelectCity?: (id: string, city: object) => void,
 *   onSelectRecord?: (record: object, city: object|null) => void,
 *   dropdownEl?: HTMLElement,
 * }} options
 * @returns {{destroy: () => void, isLoading: () => boolean, hasFailed: () => boolean}}
 */
export function mountGlobeSearch(inputEl, options) {
  const opts = options || {};
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : (...args) => fetch(...args);
  const indexUrl = opts.indexUrl || '../data/comedy-atlas/search_index.json';
  const getCities = typeof opts.getCities === 'function' ? opts.getCities : () => [];
  // 2nd arg (the matched GlobeCity, when the search_index.json record
  // resolved to one) is additive — every existing caller that only reads
  // the first (`id`) argument keeps working unchanged. Added so a caller
  // driving more than one globe provider (see index.html's maplibre vs.
  // three.js providers, which key a city by different fields — slug vs.
  // id) can pick the field ITS provider actually needs without this module
  // having to know which provider is live.
  const onSelectCity = typeof opts.onSelectCity === 'function' ? opts.onSelectCity : () => {};
  const onSelectRecord = typeof opts.onSelectRecord === 'function' ? opts.onSelectRecord : () => {};
  // Reuse an existing, already-positioned dropdown element when the caller
  // hands one in (index.html's `#atlas-q-suggest`, present in that markup
  // since the original global-search pass but never wired to anything real
  // until this fix) instead of always creating a second one. `ownsDropdown`
  // gates destroy() below: this module must never delete DOM it did not
  // create.
  const ownsDropdown = !opts.dropdownEl;

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

  const dropdown = opts.dropdownEl || document.createElement('div');
  // classList.add rather than overwriting className outright: a reused
  // dropdownEl (e.g. index.html's `#atlas-q-suggest`) may already carry its
  // own page-specific class (`atlas-suggest`) that other CSS on that page
  // still targets; this module only ever ADDS the class its own injected
  // styles are scoped to.
  dropdown.classList.add('atlas-globe-search-dropdown');
  if (!dropdown.id) dropdown.id = 'atlas-globe-search-results-' + Math.random().toString(36).slice(2);
  dropdown.setAttribute('role', 'listbox');
  if (!dropdown.hasAttribute('aria-label')) dropdown.setAttribute('aria-label', 'Search results');
  dropdown.hidden = true;
  if (ownsDropdown) container.appendChild(dropdown);

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
      if (city) onSelectCity(city.id, city);
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
      // Only remove/clear DOM this instance actually created — a reused
      // dropdownEl belongs to the caller (index.html keeps `#atlas-q-suggest`
      // around as the plain-fallback form's own markup even after this
      // module stops driving it, e.g. when the viewport crosses
      // HERO_SEARCH_BREAKPOINT_PX and ownership hands back to the topbar).
      if (ownsDropdown) {
        dropdown.remove();
      } else {
        dropdown.hidden = true;
        dropdown.innerHTML = '';
      }
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
