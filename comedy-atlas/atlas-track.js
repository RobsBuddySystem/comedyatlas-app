// COMEDY ATLAS analytics beacon -- same payload shape + endpoint as
// pariscomedy.com's own /assets/track.js (see
// /Users/chuck/pariscomedy-push-20260526-095907/assets/track.js) so ATLAS
// page views land in the SAME analytics as the rest of the site. Copied
// (not reused via <script src> across origins) because ATLAS is served
// from atlas-api.pariscomedy.com, a different host than pariscomedy.com --
// the API base is hardcoded absolute here instead of resolved from
// /api-config.json (that file lives on the pariscomedy.com origin, not
// this one). One POST per page load; best-effort, never blocks or breaks
// the page (every step is try/catch or a swallowed fetch rejection).
//
// P0-6 (2026-08-02, launch-readiness worklist sec 3.5, Robert's decision =
// Option B): Google Analytics previously started unconditionally the
// instant this file ran, which directly contradicted the live privacy
// page's "no third-party analytics scripts" / "no cookie banner needed"
// claims. This file is the single loader referenced by every public page
// (both the hand-authored <script src="atlas-track.js"> pages and every
// DB-driven generator via seo_common.ANALYTICS_INCLUDE_HTML) -- so gating
// GA HERE, once, gates it everywhere this file is included, with no
// per-generator or per-page change required.
//
// Rule: NO request to googletagmanager.com/google-analytics.com of any
// kind fires until the visitor has affirmatively clicked "Accept" on the
// banner below (or already has a stored 'granted' choice from a previous
// visit). "Reject" is exactly as easy as "Accept" -- same size, same
// click count, no pre-ticked box, no follow-up nag. The choice persists in
// localStorage and is changeable at any time via window.AtlasConsent or
// the "change your choice" control on privacy.html.
//
// The first-party beacon below (POST /api/track, plus the leave/scroll
// beacon) is UNCHANGED and NOT gated: it carries no name/email/account id,
// sets no cross-site cookie, and privacy.html describes it as the
// strictly-necessary traffic count the site needs to operate -- so it
// keeps firing on every visit exactly as it always has.
(function () {
  if (window.__pcTracked) return;
  window.__pcTracked = true;
  var GA_MEASUREMENT_ID = 'G-1Q74JY864H';
  var CONSENT_KEY = 'atlas_analytics_consent'; // localStorage: 'granted' | 'denied'
  var API_BASE = 'https://api.pariscomedy.com';

  function readConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
  }
  function writeConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (_) { /* storage unavailable */ }
  }

  // ---- Google Analytics: consent-gated, never loaded any other way ------
  var gaLoaded = false;
  function loadGA() {
    if (gaLoaded) return;
    gaLoaded = true;
    try {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      // Cross-domain linking: comedyatlas.app and pariscomedy.com share this
      // ONE GA4 property (docs/atlas-ops/GOOGLE_ANALYTICS_SETUP_2026-07-25.md).
      // Without this, a visitor moving between the two domains (a go.html
      // ticket redirect, the shared /comedy-atlas/ subtree) reads as a
      // self-referral -- two disconnected sessions instead of one -- which
      // pollutes both properties' traffic-source/attribution reports.
      // KNOWN GAP: pariscomedy.com's own assets/track.js lives in a
      // separate deploy checkout, not this repo, and does not yet carry the
      // matching linker config -- this only closes the loop from the ATLAS
      // side until that file is updated too (see the P0-6 report).
      window.gtag('set', 'linker', {
        domains: ['comedyatlas.app', 'pariscomedy.com'],
        accept_incoming: true,
      });
      window.gtag('js', new Date());
      window.gtag('config', GA_MEASUREMENT_ID, { anonymize_ip: true });

      var googleTag = document.createElement('script');
      googleTag.async = true;
      googleTag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
      document.head.appendChild(googleTag);
    } catch (_) {
      // Google Analytics is optional; keep the first-party tracker reliable.
    }
  }

  // ---- Consent banner -----------------------------------------------------
  // Fixed to the viewport bottom (position:fixed is out of normal flow, so
  // injecting it never reflows/shifts anything already on the page -- no
  // Core Web Vitals CLS hit). flex-wrap + box-sizing:border-box keep it
  // inside 390px with no horizontal overflow. Both controls are real
  // <button> elements (native keyboard/tab reachable) of equal size and
  // weight -- no dark pattern, no listener captures Tab or blocks
  // interaction with the rest of the page (no focus trap).
  var BANNER_ID = 'atlas-consent-banner';

  function removeBanner() {
    var el = document.getElementById(BANNER_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function injectBannerCSS() {
    if (document.getElementById('atlas-consent-style')) return;
    var style = document.createElement('style');
    style.id = 'atlas-consent-style';
    // P1-2 (2026-08-02, WCAG 2.1 AA): the light-mode media query below now
    // also overrides the privacy-link color and the button border color,
    // not just background/text/border-top -- #c9a84c (this file's own
    // literal gold, not a shared CSS var) measured 2.29:1 against white,
    // under both the 4.5:1 text-contrast minimum (the link) and the 3:1
    // non-text/UI-component minimum (the button borders, WCAG 1.4.11).
    // #766024 is the same darkened gold used for this exact bug in every
    // Python-generated page's CSS (generate_entity_pages.py's CSS
    // constant) and every hand-authored page (about/login/shows/homepage)
    // -- verified >=5.5:1 against both #ffffff and the page's --bg
    // #f7f5f0. Placed AFTER the base (always-applies) rules below so it
    // wins the cascade in light mode (CSS: equal-specificity, later source
    // order wins; a media-query rule appearing BEFORE an unconditional
    // rule of the same specificity would otherwise lose to it).
    style.textContent =
      '#' + BANNER_ID + '{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;' +
      'background:#111827;color:#f0f0f0;border-top:1px solid #1e2a3a;' +
      'padding:14px 16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;' +
      'box-sizing:border-box;max-width:100vw}' +
      '#' + BANNER_ID + ' .atlas-consent-text{flex:1 1 240px;min-width:0;font-size:13.5px;color:inherit}' +
      '#' + BANNER_ID + ' .atlas-consent-text a{color:#c9a84c;text-decoration:underline}' +
      '#' + BANNER_ID + ' .atlas-consent-actions{display:flex;gap:8px;flex-wrap:wrap;flex:0 0 auto}' +
      '#' + BANNER_ID + ' button{font:inherit;font-size:13.5px;font-weight:700;padding:10px 18px;' +
      'border-radius:8px;cursor:pointer;border:1px solid #c9a84c;min-height:40px;box-sizing:border-box}' +
      '#' + BANNER_ID + ' .atlas-consent-accept{background:#c9a84c;color:#0a0e1a}' +
      '#' + BANNER_ID + ' .atlas-consent-reject{background:transparent;color:inherit}' +
      '@media (prefers-color-scheme: light){' +
      '#' + BANNER_ID + '{background:#ffffff;color:#171512;border-top-color:#e2ddd2}' +
      '#' + BANNER_ID + ' .atlas-consent-text a{color:#766024}' +
      '#' + BANNER_ID + ' button{border-color:#766024}}' +
      '@media(max-width:420px){#' + BANNER_ID + '{padding:12px}' +
      '#' + BANNER_ID + ' .atlas-consent-actions{width:100%;justify-content:stretch}' +
      '#' + BANNER_ID + ' button{flex:1 1 0}}';
    document.head.appendChild(style);
  }

  function showBanner() {
    if (document.getElementById(BANNER_ID) || !document.body) return;
    injectBannerCSS();
    var el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Analytics consent');
    el.innerHTML =
      '<div class="atlas-consent-text">We use Google Analytics to understand site ' +
      'traffic. Accept or reject &mdash; either choice works exactly the same ' +
      'everywhere else on the site, and you can change it any time. ' +
      '<a href="/comedy-atlas/privacy.html">Privacy details</a></div>' +
      '<div class="atlas-consent-actions">' +
      '<button type="button" class="atlas-consent-reject">Reject</button>' +
      '<button type="button" class="atlas-consent-accept">Accept</button>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('.atlas-consent-accept').addEventListener('click', function () {
      writeConsent('granted');
      loadGA();
      removeBanner();
    });
    el.querySelector('.atlas-consent-reject').addEventListener('click', function () {
      writeConsent('denied');
      removeBanner();
    });
  }

  function initConsent() {
    var consent = readConsent();
    if (consent === 'granted') {
      loadGA();
    } else if (consent === 'denied') {
      // Decision already made -- no GA, no banner.
    } else {
      showBanner();
    }
  }

  // Public, small API so the choice is changeable later (privacy.html's
  // "change your choice" control, or any future settings surface) without
  // needing to know this file's internals.
  window.AtlasConsent = {
    getStatus: readConsent,
    grant: function () { writeConsent('granted'); loadGA(); removeBanner(); },
    deny: function () { writeConsent('denied'); removeBanner(); },
    showBanner: function () { showBanner(); },
  };

  if (document.body) {
    initConsent();
  } else {
    document.addEventListener('DOMContentLoaded', initConsent);
  }

  // ---- First-party beacon: always fires, not gated by the GA choice -----
  var sid = '';
  try {
    sid = sessionStorage.getItem('pc_sid') || '';
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('pc_sid', sid);
    }
  } catch (_) {
    // Storage unavailable; ship without session id.
  }
  var params = new URLSearchParams(location.search);
  var path = location.pathname + location.search;
  var payload = {
    path: path,
    referrer: (document.referrer || '').slice(0, 300),
    session_id: sid,
    screen: (screen && screen.width && screen.height) ? (screen.width + 'x' + screen.height) : '',
    lang: (navigator.language || '').slice(0, 20),
    utm_source: (params.get('utm_source') || '').slice(0, 100),
    utm_campaign: (params.get('utm_campaign') || '').slice(0, 100),
  };
  var startedAt = Date.now();
  var maxScroll = 0;
  var trackScroll = function () {
    try {
      var doc = document.documentElement;
      var scrollable = Math.max(1, doc.scrollHeight - doc.clientHeight);
      var pct = Math.round(100 * Math.min(1, (window.scrollY || 0) / scrollable));
      if (pct > maxScroll) maxScroll = pct;
    } catch (_) { /* ignore */ }
  };
  window.addEventListener('scroll', trackScroll, {passive: true});

  var sendLeave = function () {
    try {
      var durationS = Math.round((Date.now() - startedAt) / 1000);
      var leavePayload = JSON.stringify({
        session_id: sid, path: path, duration_s: durationS, scroll_pct: maxScroll,
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_BASE + '/api/track/leave',
          new Blob([leavePayload], {type: 'application/json'}));
      }
    } catch (_) { /* best-effort only */ }
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendLeave();
  });
  window.addEventListener('pagehide', sendLeave);

  fetch(API_BASE + '/api/track', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(function () {});
})();
