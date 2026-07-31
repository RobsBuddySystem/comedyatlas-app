# Vendor Provenance — three.js, three-globe, Earth textures

Recorded 2026-07-30 for CHECKPOINT 2 of `docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md`.
Everything under `site/comedy-atlas/vendor/three/` and `site/comedy-atlas/assets/globe/` is vendored
locally. No CDN reference may remain in shipped code — this file records exactly where each byte
came from so that claim is auditable.

---

## three.js — VENDORED

- **Version:** r169 (`0.169.0`), confirmed by the `REVISION = '169'` constant inside the file.
- **Source URL:** `https://unpkg.com/three@0.169.0/build/three.module.js` (unpkg mirrors the
  `three` npm package unmodified; this is the unminified ESM build published to npm, not a
  third-party rebuild).
- **Local file:** `site/comedy-atlas/vendor/three/three.module.js`
- **SHA256:** `0a3368c165eea773490aec7b77c22de70e3eac288503409256fdbf4d12578416`
- **Size:** 1,304,820 bytes
- **Licence:** MIT — full text saved at `site/comedy-atlas/vendor/three/LICENSE-three.txt`
  (`https://unpkg.com/three@0.169.0/LICENSE`), copyright 2010-2024 Three.js Authors.
- No sourcemap (`.map`) file was fetched or committed.

## three-globe — NOT VENDORED (Deviation D5)

Per plan CP2 Step 2: *"If three-globe's ESM has hard external imports that break a build-step-free
page, fall back to implementing the sphere + marker projection directly on three.js and record
that as deviation D5."* That condition is met — verified, not assumed:

- `https://unpkg.com/three-globe@2.45.2/dist/three-globe.mjs` (the published ESM build) contains
  bare-specifier `import` statements for **fourteen** separate npm packages that are not three.js:
  `kapsule`, `@tweenjs/tween.js`, `accessor-fn`, `d3-array`, `d3-color`, `d3-geo`, `d3-interpolate`,
  `d3-scale`, `d3-scale-chromatic`, `data-bind-mapper`, `frame-ticker`, `h3-js`, `index-array-by`,
  `tinycolor2` — plus `three-conic-polygon-geometry`, `three-geojson-geometry`,
  `three-slippy-map-globe`, and several `three/examples/jsm/*` addon paths, `three/tsl`, and
  `three/webgpu`. None of these resolve via a bare specifier in a browser without either a bundler
  or a large import map that itself vendors a dozen-plus additional packages (one of which, `h3-js`,
  ships a WASM binary) — precisely the "hard external imports that break a build-step-free page"
  case the plan anticipated.
- The UMD build (`dist/three-globe.min.js`, 1,277,688 bytes) *does* bundle all of the above into a
  single file and only externalizes `three` via a `window.THREE` global — but it is a non-module
  global-script artifact (`(globalThis).ThreeGlobe = factory(e.THREE)`), which does not fit the
  project's vanilla-ES-module architecture (`import` graph, no `<script>`-global coupling) and was
  rejected for that reason rather than silently adopted.
- **Resolution:** three-globe is not vendored. Later checkpoints (CP5 Earth/camera, CP6 markers)
  implement the sphere, atmosphere shell, and instanced city-marker projection directly on top of
  the vendored `three.module.js`, using the same lat/lng → Vector3 projection math three-globe uses
  internally (well documented, trivial to reproduce, no dependency on the library itself). This
  keeps the "no npm, no build step" constraint intact with zero CDN references at runtime.
- No `three-globe.module.js` file exists in this directory as a result. `tests/test_globe_registry.py`
  `test_vendor_*` functions assert against this reality, not the aspirational file list.

## Earth textures — VENDORED, public domain

All three textures are derived from real NASA imagery, downscaled to 2048×1024 and encoded as
WebP. NASA earth-observation imagery is U.S. government work and is in the public domain
(attribution is customary, not legally required, and is given below).

### `earth-day.webp`
- **Source dataset:** NASA Visible Earth, *"December, Blue Marble: Next Generation w/ Topography
  and Bathymetry"* (record 73909).
- **Source URL:** `https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg`
- **Original size:** 5400×2700 JPEG, 2,566,770 bytes.
- **Processing:** Lanczos-downsampled to 2048×1024, encoded to WebP at `cwebp -q 82`.
- **Local file:** `site/comedy-atlas/assets/globe/earth-day.webp`
- **SHA256:** `11b96861c00c729b0344a22f0855d6cb7a77ec93ea447296b39b2641491551aa`
- **Size:** 237,544 bytes (budget: < 400,000 bytes)
- **Credit:** NASA Earth Observatory, Blue Marble: Next Generation, imagery by Reto Stöckli
  (NASA GSFC), with topography/bathymetry from GEBCO (British Oceanographic Data Centre). Public
  domain (NASA government work); GEBCO's own terms apply to the underlying bathymetric dataset.

### `earth-lights.webp`
- **Source dataset:** NASA Earth Observatory / Suomi NPP VIIRS Day/Night Band, *"Black Marble"*
  2012 composite (record 79765, `dnb_land_ocean_ice.2012`).
- **Source URL:** `https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg`
- **Original size:** 3600×1800 JPEG, 794,479 bytes.
- **Processing:** Lanczos-downsampled to 2048×1024, encoded to WebP at `cwebp -q 82`.
- **Local file:** `site/comedy-atlas/assets/globe/earth-lights.webp`
- **SHA256:** `3234d0b5d04c8c0e3068f223e545271f2799f0963c3de59a7a10fb7cb631791d`
- **Size:** 109,424 bytes (budget: < 400,000 bytes)
- **Credit:** NASA Earth Observatory / NOAA, Suomi NPP VIIRS Day/Night Band "Black Marble". Public
  domain (NASA/NOAA government work).

### `earth-bump.webp`
- **Source:** derived, not a separate NASA elevation dataset. NASA does not publish a
  bare-download grayscale elevation/bump texture at a stable, directly linkable URL alongside the
  73909 record (the topography *shading* in that dataset is already baked into the color
  composite, not delivered as a separate raster). To keep this asset honestly sourced rather than
  guessing at unverifiable NASA filenames, `earth-bump.webp` is a **luminance (grayscale)
  conversion of the same public-domain `earth-day` composite** described above, produced with
  Pillow's `Image.convert("L")` before WebP encoding. It is used only as a subtle specular/bump
  input in CP5, not as a scientifically accurate elevation map, and is documented as such so no
  false claim of a separate dataset is made.
- **Processing:** same 5400×2700 → 2048×1024 Lanczos source as `earth-day`, converted to
  grayscale, encoded to WebP at `cwebp -q 82`.
- **Local file:** `site/comedy-atlas/assets/globe/earth-bump.webp`
- **SHA256:** `1764c2401733a134ee1fa04d65354872540ae88c7a8c7a27c9831d0d9444fbe7`
- **Size:** 195,812 bytes (budget: < 400,000 bytes)
- **Credit:** same as `earth-day.webp` (derived from it).

---

## Totals added by this checkpoint

| File | Bytes |
|---|---|
| `vendor/three/three.module.js` | 1,304,820 |
| `vendor/three/LICENSE-three.txt` | 1,081 |
| `assets/globe/earth-day.webp` | 237,544 |
| `assets/globe/earth-lights.webp` | 109,424 |
| `assets/globe/earth-bump.webp` | 195,812 |
| **Total** | **1,848,681 bytes (~1.76 MiB)** |

No `.map` sourcemap files were fetched or committed. No CDN URL appears in any shipped file —
`three.module.js` is a plain ESM module with no external imports of its own (verified: it is a
single self-contained file, no `import` statements inside it referencing anything outside itself).
