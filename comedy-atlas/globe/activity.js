/**
 * activity.js — CHECKPOINT 3 (pure-JS logic modules)
 *
 * Marker scale, tier and color-token mapping — the visual counterpart of the
 * Python `activityScore` formula documented in
 * docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md ("The
 * activity-score formula"). This module does NOT recompute the score: it
 * only maps the already-computed `activityScore` in [0, 1] onto pixels,
 * a discrete tier name, and a CSS custom-property token name.
 *
 * PURE: no DOM, no `window`/`document`, no WebGL render-layer import.
 */

/** Marker radius (px) at activityScore === 0. Named constant, not a magic number. */
export const MARKER_SCALE_MIN_PX = 4;

/** Marker radius (px) at activityScore === 1. Named constant, not a magic number. */
export const MARKER_SCALE_MAX_PX = 16;

/**
 * Tier boundaries on the [0, 1] activityScore axis. Chosen so that a
 * "hub" reads as the clear top third of activity and "emerging" covers
 * cities with little-to-no measured activity yet (including 0, which is
 * common for newly-scraped cities before their first verified show).
 * These are the exact, documented boundaries `markerTier` uses — inclusive
 * on the lower edge of each tier.
 */
export const MARKER_TIER_HUB_MIN = 0.66;
export const MARKER_TIER_ACTIVE_MIN = 0.33;

/** CSS custom-property tokens (scoped `--atlas-globe-*`, defined in globe-tokens.css, CP4). */
const TOKEN_GOLD = '--atlas-globe-gold';
const TOKEN_AMBER = '--atlas-globe-amber';
const TOKEN_EMBER = '--atlas-globe-ember';
const TOKEN_MUTED = '--atlas-globe-muted';

/** Verification states that always render muted, regardless of activity tier. */
const MUTED_VERIFICATION_STATES = new Set(['partial', 'community']);

/**
 * Map an activityScore in [0, 1] to a marker radius in pixels, linearly
 * interpolating between MARKER_SCALE_MIN_PX and MARKER_SCALE_MAX_PX.
 * Out-of-range or non-numeric input is clamped, never thrown.
 *
 * @param {number} activityScore
 * @returns {number}
 */
export function markerScale(activityScore) {
  const score = Number.isFinite(activityScore) ? activityScore : 0;
  const clamped = Math.min(Math.max(score, 0), 1);
  return MARKER_SCALE_MIN_PX + (MARKER_SCALE_MAX_PX - MARKER_SCALE_MIN_PX) * clamped;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function safeScore(value) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

/**
 * Classify a city into a discrete activity tier from its activityScore.
 * Tolerates a missing/garbage `city.activityScore` (treated as 0).
 *
 * @param {{activityScore?: unknown}} city
 * @returns {"hub"|"active"|"emerging"}
 */
export function markerTier(city) {
  const score = safeScore(city && city.activityScore);
  if (score >= MARKER_TIER_HUB_MIN) return 'hub';
  if (score >= MARKER_TIER_ACTIVE_MIN) return 'active';
  return 'emerging';
}

const TIER_TOKENS = {
  hub: TOKEN_GOLD,
  active: TOKEN_AMBER,
  emerging: TOKEN_EMBER,
};

/**
 * Map a city to the `--atlas-globe-*` color token name its marker should use.
 * Cities that are only "partial" or "community" verified always render
 * muted, regardless of how active they otherwise look — an unverified city
 * must never visually compete with a verified hub.
 *
 * @param {{activityScore?: unknown, verificationState?: unknown}} city
 * @returns {string}
 */
export function markerColorToken(city) {
  const verificationState = city && typeof city.verificationState === 'string' ? city.verificationState : 'unknown';
  if (MUTED_VERIFICATION_STATES.has(verificationState)) {
    return TOKEN_MUTED;
  }
  return TIER_TOKENS[markerTier(city)];
}
