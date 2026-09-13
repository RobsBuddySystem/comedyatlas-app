/*
 * COMEDY ATLAS — "your browser is blocking location" help panel
 * (site/comedy-atlas/atlas-location-help.js)
 *
 * Robert, 13/09: "the geolocation still doesnt work, but it doesnt even ask
 * it can use the location. shouldnt that pop up?" Root cause: once a
 * browser/OS has stored a denial for this site (or iOS Location Services is
 * off for Safari entirely), NO website can make the permission prompt
 * reappear -- only the visitor can flip it back in their own settings. The
 * fix is not a fake prompt (browsers penalise page-load location prompts
 * and most visitors refuse them anyway) -- it's telling people exactly how
 * to turn it back on for THEIR device, then offering a real retry.
 *
 * Shared by both call sites so there is one definition of "how to fix this"
 * instead of two that can drift:
 *   - near.js (hero "Shows near me" button, classic script -- consumes this
 *     via a dynamic import() since it isn't a module itself)
 *   - globe/legend.js (the globe's "Near Me" pill, already an ES module --
 *     consumes this via a static import)
 *
 * Self-contained: no external calls, no dependencies, everything user-
 * supplied (there isn't any here -- `ua` is the browser's own, read-only
 * navigator.userAgent) is escaped before landing in HTML.
 */

export function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Coarse, best-effort platform detection from a User-Agent string. Only
 * used to decide which set of "how to enable location" steps to put FIRST
 * (every platform's steps are always present, just behind a "Other
 * devices" toggle for the rest) -- a wrong guess never hides an answer,
 * it only picks a worse default order.
 * @param {string} ua
 * @returns {string} one of PLATFORM_ORDER's keys
 */
export function detectPlatform(ua) {
  var s = String(ua || "");
  var isIOS = /iPhone|iPad|iPod/.test(s);
  var isAndroid = /Android/.test(s);
  var isFirefox = /Firefox/.test(s);
  // Edge (Chromium-based, "Edg/") and Chrome both use the same "icon left of
  // the address bar -> Site settings" flow, so they share one entry.
  var isChromeFamily = /Chrome|CriOS|Edg\//.test(s) && !isFirefox;
  var isMac = /Macintosh/.test(s) && !isIOS;

  if (isIOS) return "ios-safari";
  if (isAndroid && isChromeFamily) return "android-chrome";
  if (isFirefox) return "firefox";
  if (isMac && !isChromeFamily) return "macos-safari";
  if (isChromeFamily) return "desktop-chrome";
  return "other";
}

/** Ordered so the "Other devices" toggle lists every platform NOT already
 * shown as the primary guess, in a stable, predictable order. */
export var PLATFORM_ORDER = [
  "ios-safari", "android-chrome", "desktop-chrome", "firefox", "macos-safari",
];

export var PLATFORM_INFO = {
  "ios-safari": {
    label: "iPhone / iPad (Safari)",
    steps: [
      'Tap the "aA" icon in the address bar → Website Settings → Location → Allow.',
      "If Location is off for every site: Settings → Privacy & Security → " +
        "Location Services → Safari Websites → While Using the App.",
    ],
  },
  "android-chrome": {
    label: "Android (Chrome)",
    steps: [
      "Tap the icon left of the address bar → Permissions → Location → Allow.",
    ],
  },
  "desktop-chrome": {
    label: "Desktop Chrome / Edge",
    steps: [
      "Click the icon left of the address bar → Site settings → Location → Allow.",
    ],
  },
  firefox: {
    label: "Firefox",
    steps: [
      "Click the permissions icon in the address bar → Location → Allow.",
    ],
  },
  "macos-safari": {
    label: "macOS Safari",
    steps: [
      "Safari → Settings → Websites → Location → Allow.",
    ],
  },
};

export var RETRY_SELECTOR = ".atlas-location-help-retry";
export var RETRY_CLASS = "atlas-location-help-retry";

function stepsListHtml(steps) {
  var html = "<ul>";
  for (var i = 0; i < steps.length; i++) {
    html += "<li>" + escapeHtml(steps[i]) + "</li>";
  }
  return html + "</ul>";
}

/**
 * Builds the full "how to enable location" panel as an HTML string --
 * plain markup, no inline event handlers (the retry button is wired by the
 * caller via `RETRY_SELECTOR`/`RETRY_CLASS` after insertion, since only the
 * caller knows how to re-trigger ITS OWN geolocation request).
 * @param {{ua?: string, retryLabel?: string}} [opts]
 */
export function renderLocationHelpHtml(opts) {
  var options = opts || {};
  var ua = options.ua || "";
  var retryLabel = options.retryLabel || "Try again";
  var primary = detectPlatform(ua);
  var primaryInfo = PLATFORM_INFO[primary] || null;

  var html = '<div class="atlas-location-help">' +
    '<p class="atlas-location-help-lede">Your browser is blocking location ' +
    "for comedyatlas.app.</p>";

  if (primaryInfo) {
    html += '<div class="atlas-location-help-primary">' +
      '<p class="atlas-location-help-platform">' + escapeHtml(primaryInfo.label) + "</p>" +
      stepsListHtml(primaryInfo.steps) +
      "</div>";
  }

  var others = PLATFORM_ORDER.filter(function (key) { return key !== primary; });
  if (others.length) {
    html += '<details class="atlas-location-help-other">' +
      "<summary>Other devices</summary>";
    others.forEach(function (key) {
      var info = PLATFORM_INFO[key];
      html += '<div class="atlas-location-help-platform-block">' +
        '<p class="atlas-location-help-platform">' + escapeHtml(info.label) + "</p>" +
        stepsListHtml(info.steps) +
        "</div>";
    });
    html += "</details>";
  }

  html += '<button type="button" class="' + RETRY_CLASS + '">' +
    escapeHtml(retryLabel) + "</button>" +
    "</div>";

  return html;
}
