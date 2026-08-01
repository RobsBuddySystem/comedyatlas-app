# Vendor Provenance — maplibre-gl

Recorded 2026-08-01 for the Comedy Atlas globe replacement (three.js -> maplibre-gl, see
`docs/adr/` decision + `SPEC_atlas_maplibre_replacement_2026-08-01.md` in the vault). Mirrors the
`vendor/three/PROVENANCE.md` convention exactly: everything under
`site/comedy-atlas/vendor/maplibre-gl/` is vendored locally. No CDN reference may remain in
shipped code.

## maplibre-gl — VENDORED

- **Version:** 5.24.0, the version pinned by the replacement spec ("maplibre-gl 5.24 or newer").
- **Source:** `npm pack maplibre-gl@5.24` (official npm registry tarball, unmodified), extracted
  `package/dist/maplibre-gl.js` and `package/dist/maplibre-gl.css` — the standard (non-CSP,
  non-dev) production UMD build npm publishes, same tier as three.js's vendored build.
- **Local files:**
  - `site/comedy-atlas/vendor/maplibre-gl/maplibre-gl.js` — 1,056,837 bytes,
    sha256 `45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb`
  - `site/comedy-atlas/vendor/maplibre-gl/maplibre-gl.css` — 70,024 bytes,
    sha256 `ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732`
- **Licence:** BSD-3-Clause (maplibre-gl is a fork of the last BSD-licensed mapbox-gl-js release);
  full text saved at `LICENSE-maplibre.txt` (from the npm package's own `LICENSE.txt`).
- **Source maps NOT vendored** (matches three.js: dev/debug artefacts, not shipped-code
  dependencies) — same reasoning as `render_atlas_static_pages.py`'s `is_publishable()` exclusion
  of dev artefacts from the published site.
- **What this build talks to at runtime:** `https://tiles.openfreemap.org/styles/liberty` (a free,
  no-API-key vector tile style) for the OpenFreeMap layer, per the spec. That is a live network
  fetch from the visitor's browser at page-load time -- normal for any tile-based map, not a
  vendoring concern -- and is NOT a Google Maps/Mapbox key dependency of any kind.
