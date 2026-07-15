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
(function () {
  if (window.__pcTracked) return;
  window.__pcTracked = true;
  var API_BASE = 'https://api.pariscomedy.com';
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
