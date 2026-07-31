/**
 * cluster.js — CHECKPOINT 3 (pure-JS logic modules)
 *
 * LOD (level-of-detail) tiers, screen-space clustering, and label suppression.
 * PURE: no DOM, no `window`/`document`, no WebGL render-layer import. `project` is
 * injected by the caller (CP6's markers.js will pass the real WebGL
 * screen-space projection); here it is just `(city) => {x, y}`.
 */

/**
 * Altitude breakpoints for `lodTier`, expressed in the globe render-layer's camera
 * "altitude" units (globe radii above the surface — roughly 0 at the
 * surface, ~2.5 at a full world view). Named constants, not magic numbers,
 * so CP5's camera controller and CP6's marker layer read the same values
 * this module tests against.
 *
 * Tiers are inclusive on their lower bound:
 *   altitude >= LOD_WORLD_MIN_ALTITUDE                                -> "world"
 *   LOD_REGIONAL_MIN_ALTITUDE <= altitude < LOD_WORLD_MIN_ALTITUDE    -> "regional"
 *   LOD_CITY_MIN_ALTITUDE     <= altitude < LOD_REGIONAL_MIN_ALTITUDE -> "city"
 *   altitude < LOD_CITY_MIN_ALTITUDE                                  -> "close"
 */
export const LOD_WORLD_MIN_ALTITUDE = 1.5;
export const LOD_REGIONAL_MIN_ALTITUDE = 0.6;
export const LOD_CITY_MIN_ALTITUDE = 0.15;

/**
 * Classify a camera altitude into a discrete LOD tier. Monotonic: as
 * altitude decreases, the tier only ever moves world -> regional -> city
 * -> close, never backwards.
 *
 * @param {number} cameraAltitude
 * @returns {"world"|"regional"|"city"|"close"}
 */
export function lodTier(cameraAltitude) {
  const altitude = Number.isFinite(cameraAltitude) ? cameraAltitude : 0;
  if (altitude >= LOD_WORLD_MIN_ALTITUDE) return 'world';
  if (altitude >= LOD_REGIONAL_MIN_ALTITUDE) return 'regional';
  if (altitude >= LOD_CITY_MIN_ALTITUDE) return 'city';
  return 'close';
}

/**
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
function pixelDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Union-find (disjoint-set) helper, local to this module. Keeps
 * `clusterCities` free of any external clustering dependency.
 */
class DisjointSet {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i) {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }
}

/**
 * Group cities into screen-space clusters when their projected positions
 * fall within `minPixelSeparation` of one another (transitively — a chain
 * of near neighbors merges into one cluster). At the "close" LOD tier,
 * clustering is always skipped: once the camera is this near, every city
 * marker is expected to stand on its own.
 *
 * @param {object[]} cities
 * @param {{tier: "world"|"regional"|"city"|"close", project: (city: object) => {x: number, y: number}, minPixelSeparation: number}} options
 * @returns {{clusters: {id: string, cities: object[], x: number, y: number}[], singles: object[]}}
 */
export function clusterCities(cities, { tier, project, minPixelSeparation }) {
  if (!Array.isArray(cities) || cities.length === 0) {
    return { clusters: [], singles: [] };
  }

  if (tier === 'close') {
    return { clusters: [], singles: [...cities] };
  }

  const points = cities.map((city) => project(city));
  const ds = new DisjointSet(cities.length);

  for (let i = 0; i < cities.length; i += 1) {
    for (let j = i + 1; j < cities.length; j += 1) {
      if (pixelDistance(points[i], points[j]) < minPixelSeparation) {
        ds.union(i, j);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < cities.length; i += 1) {
    const root = ds.find(i);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root).push(i);
  }

  const clusters = [];
  const singles = [];

  for (const indices of groups.values()) {
    if (indices.length === 1) {
      singles.push(cities[indices[0]]);
      continue;
    }
    const memberCities = indices.map((i) => cities[i]);
    const memberPoints = indices.map((i) => points[i]);
    const centroidX = memberPoints.reduce((sum, p) => sum + p.x, 0) / memberPoints.length;
    const centroidY = memberPoints.reduce((sum, p) => sum + p.y, 0) / memberPoints.length;
    clusters.push({
      id: `cluster-${clusters.length}`,
      cities: memberCities,
      x: centroidX,
      y: centroidY,
    });
  }

  return { clusters, singles };
}

/**
 * Choose which entries get a visible text label, capping the count at
 * `maxLabels` while ALWAYS including the currently hovered and selected
 * entries (even if that pushes the total above `maxLabels`, up to the
 * documented `maxLabels + 2` ceiling). Priority for the remaining slots is
 * each entry's `score` (descending); entries without a `score` keep their
 * original relative order.
 *
 * @param {{id: string, score?: number}[]} entries
 * @param {{maxLabels: number, hoveredId: string|null|undefined, selectedId: string|null|undefined, project: (entry: object) => {x: number, y: number}}} options
 * @returns {Set<string>}
 */
export function selectLabels(entries, { maxLabels, hoveredId, selectedId }) {
  const list = Array.isArray(entries) ? entries : [];
  const indexed = list.map((entry, index) => ({ entry, index }));

  indexed.sort((a, b) => {
    const scoreA = Number.isFinite(a.entry.score) ? a.entry.score : Number.NEGATIVE_INFINITY;
    const scoreB = Number.isFinite(b.entry.score) ? b.entry.score : Number.NEGATIVE_INFINITY;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.index - b.index;
  });

  const selected = new Set();
  for (const { entry } of indexed) {
    if (selected.size >= maxLabels) break;
    selected.add(entry.id);
  }

  if (hoveredId) selected.add(hoveredId);
  if (selectedId) selected.add(selectedId);

  return selected;
}
