/**
 * COMEDY ATLAS — Interactive Globe: Earth surface + atmosphere
 * (site/comedy-atlas/globe/earth.js)
 *
 * CHECKPOINT 5 of docs/superpowers/plans/2026-07-30-comedy-atlas-globe.md.
 *
 * Builds directly on vendored plain three.js (site/comedy-atlas/vendor/three/
 * three.module.js). No three-globe dependency — see CP2's Deviation D5 in
 * PROVENANCE.md: three-globe's ESM has 14+ hard external package imports
 * that cannot resolve in a build-step-free static page. The sphere,
 * texture layering and atmosphere shell below are implemented directly,
 * using the same public-domain NASA imagery CP2 vendored.
 *
 * Visual target (Robert's approved mockup, 2026-07-30): a photoreal NASA
 * Blue Marble Earth on a near-black field. Deep blue-black oceans. Warm
 * brown/tan landmasses, subtly lit. Warm golden-white city lights on the
 * night side. A soft, thin pale-blue atmospheric rim hugging the limb —
 * restrained, not a fat glow. Low-contrast cloud-free color composite (the
 * vendored earth-day texture has no separate cloud layer — see
 * vendor/three/PROVENANCE.md — so no cloud shell is faked here). No bloom
 * stack, no lens flare, no fog, no neon. Colours are driven by
 * globe-tokens.css custom properties, read at call time via
 * getComputedStyle — never hard-coded hex.
 *
 * IMPORTANT — `earth-bump.webp` is NOT elevation data (CP2 correction,
 * post-CP2-completion). PROVENANCE.md documents it plainly: NASA does not
 * publish a stable public-domain elevation raster alongside the 73909 Blue
 * Marble record, so CP2 derived this file as a grayscale LUMINANCE
 * conversion of the same day composite. Luminance tracks albedo, not
 * height — the Sahara is bright (would render as falsely raised), oceans
 * and forests are dark (would render as falsely sunken), and real
 * mountain ranges barely register in it. Wiring it as a `bumpMap` /
 * `displacementMap` at meaningful strength would therefore produce
 * confident, wrong-looking relief — exactly the "plausible but false
 * detail" this build must avoid.
 *
 * A `roughnessMap` use was tried and rejected during this checkpoint: the
 * ocean is near-black in the luminance map, which three.js reads as very
 * LOW roughness (near-mirror), and produced a blown-out white specular
 * glint over open ocean whenever the sun and camera roughly aligned —
 * itself a false, distracting artifact, and physically backwards besides
 * (a dark luminance value doesn't reliably mean "smoother" once you cross
 * from land into water). This module therefore does NOT load or attach
 * `earth-bump.webp` at all (the coordinator's Option 1) — the day +
 * night-lights + atmosphere combination already carries the cinematic
 * look the mockup shows, which has no pronounced relief shading anyway.
 * The file stays vendored (CP2's provenance record is unaffected) in case
 * a future checkpoint finds a genuine, defensible, subtle use for it —
 * but nothing downstream should treat it as terrain.
 *
 * Radius convention (shared with camera.js and CP3's cluster.js): the
 * Earth mesh has radius 1 world unit. Camera "altitude" is expressed in
 * globe-radii ABOVE the surface, i.e. altitude = distanceFromCenter - 1.
 * This is the exact unit cluster.js's LOD_WORLD_MIN_ALTITUDE (1.5),
 * LOD_REGIONAL_MIN_ALTITUDE (0.6) and LOD_CITY_MIN_ALTITUDE (0.15) are
 * documented against.
 *
 * Exports:
 *   EARTH_RADIUS -> 1 (world units; the shared radius contract)
 *   createEarth(scene, {quality}) -> {mesh, atmosphere, dispose}
 */

import * as THREE from '../vendor/three/three.module.js';

export const EARTH_RADIUS = 1;

const DEG2RAD = Math.PI / 180;

/**
 * Converts a (lat, lng) in degrees to a Vector3 at the given radius,
 * aligned with the equirectangular UV mapping three.js's default
 * `SphereGeometry` applies — the same mapping the vendored earth-day /
 * earth-lights textures use. This is the single source of truth for
 * lat/lng <-> 3D position in the globe render layer: camera.js's
 * `focusOnLatLng` uses it, and CP6's markers.js MUST reuse it (imported
 * from here, not re-derived) so city pins land on the correct point of
 * the textured sphere rather than an independently-guessed projection.
 *
 * @param {number} lat degrees, -90..90
 * @param {number} lng degrees, -180..180
 * @param {number} [radius] world units (defaults to EARTH_RADIUS)
 * @returns {import('../vendor/three/three.module.js').Vector3}
 */
export function latLngToVector3(lat, lng, radius) {
  const r = typeof radius === 'number' ? radius : EARTH_RADIUS;
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lng + 180) * DEG2RAD;
  const x = -r * Math.sin(phi) * Math.cos(theta);
  const z = r * Math.sin(phi) * Math.sin(theta);
  const y = r * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

// Default matches every CP5-CP8 test harness's own placement (one
// directory level below site/comedy-atlas/, same convention documented in
// experience.js's defaultCityHref/DEFAULT_SEARCH_INDEX_URL). CP9's
// homepage mount is one level shallower and MUST override this via
// createEarth's `assetBase` option -- see that function's own doc comment.
// (Root-cause note, added post-CP9 integration: this constant previously
// had NO override hook at all, so index.html's textures 404'd against
// `site/assets/globe/` -- which does not exist -- instead of the real
// `site/comedy-atlas/assets/globe/`, and the Earth rendered black. Fixed
// by threading `assetBase` through createEarth -> resolveAssetBase, with
// this literal preserved as the default so every existing caller that
// does not pass the option keeps working unchanged.)
const ASSET_BASE = '../assets/globe/';

function resolveAssetBase(assetBase) {
  return typeof assetBase === 'string' && assetBase ? assetBase : ASSET_BASE;
}

function textureUrls(assetBase) {
  const base = resolveAssetBase(assetBase);
  return {
    day: `${base}earth-day.webp`,
    lights: `${base}earth-lights.webp`,
    bump: `${base}earth-bump.webp`,
  };
}

/**
 * Read a `--atlas-globe-*` custom property from `.atlas-globe-root` (or the
 * document root as a fallback) so every colour in this module traces back
 * to globe-tokens.css. Never returns a bare literal hex unless the token is
 * genuinely absent, in which case a token-matching fallback (identical to
 * the one baked into globe-tokens.css itself) is used so rendering never
 * silently breaks.
 *
 * Exported so camera.js (the only other CP5 file, and the one that owns
 * the renderer instance) can drive its clear colour from the same tokens
 * rather than re-implementing this lookup or hard-coding a hex.
 *
 * @param {string} name e.g. "--atlas-globe-ocean-lo"
 * @param {string} fallback
 * @returns {string}
 */
export function readToken(name, fallback) {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return fallback;
  }
  const scopedEl = document.querySelector('.atlas-globe-root');
  const source = scopedEl || document.documentElement;
  const value = getComputedStyle(source).getPropertyValue(name);
  const trimmed = value && value.trim();
  return trimmed || fallback;
}

/**
 * Quality presets: geometry segment counts and texture anisotropy. "low"
 * is used for reduced-motion / low-power contexts (CP10 wires this up
 * fully; CP5 only needs the switch to exist and be honoured).
 */
const QUALITY_PRESETS = {
  high: { widthSegments: 96, heightSegments: 96, atmosphereSegments: 64 },
  medium: { widthSegments: 64, heightSegments: 64, atmosphereSegments: 48 },
  low: { widthSegments: 32, heightSegments: 32, atmosphereSegments: 24 },
};

function resolveQuality(quality) {
  return QUALITY_PRESETS[quality] || QUALITY_PRESETS.high;
}

/**
 * Loads a texture, resolving even on failure (with `null`) rather than
 * rejecting, so one bad/slow asset never blocks the whole Earth from
 * mounting. dispose() below still knows to release whatever DID load.
 *
 * @param {THREE.TextureLoader} loader
 * @param {string} url
 * @returns {Promise<THREE.Texture|null>}
 */
function loadTextureSafe(loader, url) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (texture) => resolve(texture),
      undefined,
      () => resolve(null),
    );
  });
}

/**
 * Builds the Earth sphere (day/night blended surface via emissive night
 * lights + a subtle bump-mapped specular) and a soft atmospheric rim
 * shell, adds both to `scene`, and returns a handle with a real
 * `dispose()` that releases every geometry/material/texture it created
 * and detaches the meshes from the scene graph. This is the CP5 Step 4
 * memory-leak gate.
 *
 * Texture loads are asynchronous (fetching real .webp files); the
 * returned `mesh`/`atmosphere` exist and are added to the scene
 * synchronously with a neutral placeholder material so the caller can
 * start its render loop immediately, and textures are swapped in when
 * they resolve. `dispose()` is safe to call at any point, including
 * before textures finish loading (in-flight loads are simply ignored
 * when they resolve after disposal).
 *
 * @param {THREE.Scene} scene
 * @param {{quality?: "high"|"medium"|"low", assetBase?: string}} [options]
 *   `assetBase` overrides the directory the three texture files are
 *   fetched from, relative to the page that imports this module. Defaults
 *   to `'../assets/globe/'` (the existing CP5-CP8 harness convention) so
 *   every caller that omits it keeps working unchanged. index.html mounts
 *   one directory level shallower than that convention and MUST pass
 *   `'assets/globe/'` here (wired via experience.js's own `assetBase`
 *   passthrough) -- see the module-level comment above `ASSET_BASE`.
 * @returns {{mesh: THREE.Mesh, atmosphere: THREE.Mesh, dispose: () => void}}
 */
export function createEarth(scene, options) {
  const opts = options || {};
  const preset = resolveQuality(opts.quality);
  const TEXTURE_URLS = textureUrls(opts.assetBase);

  let disposed = false;
  const ownedTextures = [];
  const ownedGeometries = [];
  const ownedMaterials = [];

  // --- Earth surface -----------------------------------------------------
  const surfaceGeometry = new THREE.SphereGeometry(
    EARTH_RADIUS,
    preset.widthSegments,
    preset.heightSegments,
  );
  ownedGeometries.push(surfaceGeometry);

  // Neutral placeholder while textures stream in: deep blue-black ocean
  // token so there is never a flash of a default-grey three.js sphere.
  const oceanLo = readToken('--atlas-globe-ocean-lo', '#05070d');
  const surfaceMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(oceanLo),
    roughness: 0.85,
    metalness: 0.0,
    emissive: new THREE.Color(0x000000),
    emissiveIntensity: 0.0,
  });
  ownedMaterials.push(surfaceMaterial);

  const mesh = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  mesh.name = 'atlas-globe-earth';
  scene.add(mesh);

  // Sub-solar point, computed once and shared by the atmosphere shader
  // (day/night rim modulation) and the DirectionalLight below — see the
  // lighting comment for why this specific lat/lng was chosen.
  const sunDirection = latLngToVector3(8, 25, 1);

  // --- Atmosphere rim ------------------------------------------------------
  // CORRECTED post-first-pass (Opus gate, CP5): the original shell was
  // technically in the scene, visible, correctly BackSide, correctly
  // larger-radius and correctly transparent — confirmed by direct
  // instrumentation (scene.children.includes(atmosphere) === true,
  // atmosphere.visible === true, radius 1.015 vs earth's 1). It was still
  // invisible on screen because THREE compounding under-tuning issues, not
  // one bug: (1) its colour was `--atlas-globe-ocean-hi`, a dark navy
  // (#182338) — not remotely pale blue; (2) NormalBlending composites
  // `color*alpha + background*(1-alpha)`, so even a correct colour at a
  // 0.35 alpha ceiling against near-black landed within single-digit RGB
  // units of black; (3) a 1.5%-larger radius is only ~2-3 screen pixels
  // wide at typical world-view camera distance, thinner than the
  // composited result had any hope of reading at. Fixed by: a real
  // pale-blue token (globe-tokens.css's new `--atlas-globe-atmosphere`),
  // AdditiveBlending (glows are additive light, not alpha compositing),
  // a thicker-but-still-thin 5% shell, and day/night modulation via
  // `sunDirection` so the rim is dimmer (not absent) on the night limb.
  const atmosphereGeometry = new THREE.SphereGeometry(
    EARTH_RADIUS * 1.022,
    preset.atmosphereSegments,
    preset.atmosphereSegments,
  );
  ownedGeometries.push(atmosphereGeometry);

  const rimColor = readToken('--atlas-globe-atmosphere', '#9fd0ff');
  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(rimColor) },
      sunDirection: { value: sunDirection.clone().normalize() },
    },
    vertexShader: `
      varying float vFresnel;
      varying vec3 vWorldNormal;
      void main() {
        vec3 viewDir = normalize(-(modelViewMatrix * vec4(position, 1.0)).xyz);
        vec3 n = normalize(normalMatrix * normal);
        vFresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.4);
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vFresnel;
      varying vec3 vWorldNormal;
      uniform vec3 glowColor;
      uniform vec3 sunDirection;
      void main() {
        // Restrained rim: brightest exactly at the grazing limb, falling
        // off quickly both inward (toward the disc) and outward (into
        // black) — a thin hug, not a fat bloom halo (visual target /
        // Global Constraint #10).
        float rim = smoothstep(0.6, 1.0, vFresnel);

        // Day/night modulation: still visible on the unlit limb, just
        // dimmer there, per the plan's explicit requirement.
        float dayFactor = smoothstep(-0.5, 0.35, dot(vWorldNormal, sunDirection));
        float nightFloor = 0.28;
        float lightFactor = mix(nightFloor, 1.0, dayFactor);

        float intensity = rim * lightFactor * 0.55;
        gl_FragColor = vec4(glowColor * intensity, intensity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  ownedMaterials.push(atmosphereMaterial);

  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  atmosphere.name = 'atlas-globe-atmosphere';
  scene.add(atmosphere);

  // --- Lighting (subtle, no bloom stack) -----------------------------------
  // A single soft directional "sun" plus a dim ambient fill. The sun's
  // sub-solar point is deliberately placed near (lat 8, lng 25) — roughly
  // 50 degrees east of camera.js's default world-view center (lat 15,
  // lng -25) — so the DEFAULT view shows a real day/night terminator
  // crossing the disc (Europe/Africa warmly lit, the Americas fading into
  // night with city lights), matching the visual target's "soft,
  // cinematic terminator." A sun placed directly behind the default
  // camera (as an earlier version of this file did) leaves the entire
  // visible hemisphere in shadow, which read as an all-night globe with
  // no day-side color at all — wrong per the mockup. As the user rotates
  // the camera the terminator naturally moves across the fixed sun, which
  // is correct behaviour (the sun does not track the camera).
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.copy(sunDirection).multiplyScalar(5);
  sun.name = 'atlas-globe-sun';
  scene.add(sun);

  // Ambient fill kept low but high enough that the day hemisphere's warm
  // brown/tan landmass colour reads clearly rather than crushing to near-
  // black off the direct sun angle (the visual target calls for
  // "landmasses warm brown/tan and subtly lit", not silhouettes).
  const ambient = new THREE.AmbientLight(0xffffff, 0.16);
  ambient.name = 'atlas-globe-ambient';
  scene.add(ambient);

  // --- Async texture load ---------------------------------------------------
  // NOTE: `earth-bump.webp` is deliberately not fetched here — see the
  // header comment on why it is not wired as bump/roughness/displacement.
  const loader = new THREE.TextureLoader();
  Promise.all([
    loadTextureSafe(loader, TEXTURE_URLS.day),
    loadTextureSafe(loader, TEXTURE_URLS.lights),
  ]).then(([dayTex, lightsTex]) => {
    if (disposed) {
      // dispose() already ran (e.g. the caller navigated away before the
      // network resolved) — release anything that DID load instead of
      // attaching it to a mesh that no longer exists in the scene.
      [dayTex, lightsTex].forEach((tex) => tex && tex.dispose());
      return;
    }
    if (dayTex) {
      dayTex.colorSpace = THREE.SRGBColorSpace;
      surfaceMaterial.map = dayTex;
      // The placeholder `color` set above (near-black, so there's never a
      // flash of default three.js grey before the network resolves) would
      // otherwise keep MULTIPLYING the day texture down to near-black
      // forever — MeshStandardMaterial's diffuse term is `color * map`.
      // Reset to white now that a real texture is driving colour, so the
      // day texture's own warm brown/tan landmass and deep-ocean colours
      // render undimmed.
      surfaceMaterial.color.set(0xffffff);
      ownedTextures.push(dayTex);
    }
    if (lightsTex) {
      lightsTex.colorSpace = THREE.SRGBColorSpace;
      // Night lights are additive emissive detail, not a second diffuse
      // layer — this is what makes cities glow warm gold on the night
      // side without washing out the day-side colour composite.
      surfaceMaterial.emissiveMap = lightsTex;
      surfaceMaterial.emissive = new THREE.Color(0xffffff);
      surfaceMaterial.emissiveIntensity = 1.15;
      ownedTextures.push(lightsTex);
    }
    surfaceMaterial.roughness = 0.92;
    surfaceMaterial.metalness = 0.02;
    surfaceMaterial.needsUpdate = true;
  });

  /**
   * Releases every geometry, material and texture this call created, and
   * removes the meshes/lights from the scene. Safe to call more than once.
   */
  function dispose() {
    if (disposed) return;
    disposed = true;

    scene.remove(mesh);
    scene.remove(atmosphere);
    scene.remove(sun);
    scene.remove(ambient);

    ownedGeometries.forEach((g) => g.dispose());
    ownedMaterials.forEach((m) => m.dispose());
    ownedTextures.forEach((t) => t.dispose());
    ownedTextures.length = 0;
  }

  return { mesh, atmosphere, dispose };
}
