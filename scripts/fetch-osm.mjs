import fs from 'node:fs/promises';
import path from 'node:path';

const CENTER = { lat: 19.404145, lon: -99.260732 };
const RADIUS = 10000;
const endpoints = [
  process.env.OVERPASS_URL,
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
].filter(Boolean);
const dataDir = path.resolve('data');
const outputFile = path.join(dataDir, 'osm-cache.json');
const rawFile = path.join(dataDir, 'overpass-raw.json');

const latDelta = RADIUS / 110540;
const lonDelta = RADIUS / (111320 * Math.cos(CENTER.lat * Math.PI / 180));
const bounds = {
  south: CENTER.lat - latDelta, north: CENTER.lat + latDelta,
  west: CENTER.lon - lonDelta, east: CENTER.lon + lonDelta
};
const boxes = [];
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const s = bounds.south + (bounds.north - bounds.south) * row / 4;
    const n = bounds.south + (bounds.north - bounds.south) * (row + 1) / 4;
    const w = bounds.west + (bounds.east - bounds.west) * col / 4;
    const e = bounds.west + (bounds.east - bounds.west) * (col + 1) / 4;
    boxes.push([s, w, n, e]);
  }
}
const makeQuery = ([s, w, n, e]) => `[out:json][timeout:240];
(
  way["building"](${s},${w},${n},${e});
  way["highway"]["highway"!="service"](${s},${w},${n},${e});
  nwr["amenity"~"^(bar|pub|cafe|restaurant|fast_food|pharmacy|hospital|clinic|library|bus_station|school|university|college|kindergarten|police|fire_station|townhall|courthouse|community_centre|post_office|social_facility|marketplace|bank|atm)$"](${s},${w},${n},${e});
  nwr["shop"](${s},${w},${n},${e});
  nwr["public_transport"](${s},${w},${n},${e});
);
out center geom qt;`;

const project = (lat, lon) => {
  const x = (lon - CENTER.lon) * 111320 * Math.cos(CENTER.lat * Math.PI / 180);
  const z = (lat - CENTER.lat) * 110540;
  return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
};

const distanceToSegment = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const denom = dx * dx + dy * dy;
  if (!denom) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denom));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

function simplify(points, tolerance = 1.2) {
  if (points.length <= 5) return points;
  let max = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], points[0], points.at(-1));
    if (d > max) { max = d; index = i; }
  }
  if (max > tolerance) {
    const left = simplify(points.slice(0, index + 1), tolerance);
    const right = simplify(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points.at(-1)];
}

function heightOf(tags = {}) {
  const direct = Number.parseFloat(tags.height);
  if (Number.isFinite(direct)) return Math.min(180, Math.max(2.8, direct));
  const levels = Number.parseFloat(tags['building:levels']);
  if (Number.isFinite(levels)) return Math.min(150, Math.max(3, levels * 3.15));
  if (tags.building === 'apartments') return 15;
  if (tags.building === 'commercial' || tags.building === 'office') return 12;
  if (tags.building === 'university' || tags.amenity === 'university') return 11;
  if (tags.building === 'house' || tags.building === 'residential') return 7;
  return 6;
}
const publicAmenities = new Set(['school','university','college','kindergarten','hospital','clinic','library','police','fire_station','townhall','courthouse','community_centre','post_office','social_facility','government']);
function categoryOf(tags = {}) {
  if (tags.shop || ['commercial','retail','supermarket','mall'].includes(tags.building)) return 'commerce';
  if (publicAmenities.has(tags.amenity) || tags.office === 'government' || ['civic','public','government','hospital','school','university'].includes(tags.building)) return 'public';
  if (['restaurant','cafe','bar','pub','fast_food','pharmacy','bank','atm','marketplace'].includes(tags.amenity)) return 'commerce';
  return '';
}

function geometryOf(el) {
  if (!el.geometry?.length) return null;
  return el.geometry.map(p => project(p.lat, p.lon));
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  console.log(`Téléchargement Overpass en ${boxes.length} sous-tuiles avec reprise…`);
  const elements = [];
  const queries = boxes.map(makeQuery);
  let usedEndpoint = endpoints[0];
  for (let tile = 0; tile < queries.length; tile++) {
    const tileFile = path.join(dataDir, `overpass-tile-${String(tile + 1).padStart(2, '0')}.json`);
    try {
      const cached = JSON.parse(await fs.readFile(tileFile, 'utf8'));
      elements.push(...cached.elements);
      console.log(`Tuile ${tile + 1}/${queries.length} reprise du cache.`);
      continue;
    } catch { /* cache absent or invalid */ }
    let lastError;
    const rotatedEndpoints = endpoints.slice(tile % endpoints.length).concat(endpoints.slice(0, tile % endpoints.length));
    for (const endpoint of rotatedEndpoints) {
      try {
        console.log(`Tuile ${tile + 1}/${queries.length} via ${new URL(endpoint).host}…`);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'AnahuacStudentMap/1.0' },
          body: new URLSearchParams({ data: queries[tile] })
        });
        if (!response.ok) throw new Error(`Overpass ${response.status}: ${(await response.text()).slice(0, 300)}`);
        const part = await response.json();
        await fs.writeFile(tileFile, JSON.stringify(part));
        elements.push(...part.elements); usedEndpoint = endpoint; lastError = null; break;
      } catch (error) { lastError = error; }
    }
    if (lastError) throw lastError;
  }
  const raw = { version: 0.6, generator: 'Overpass API tiled cache', elements };
  await fs.writeFile(rawFile, JSON.stringify(raw));

  const buildings = [];
  const roads = [];
  const places = [];
  const seenElements = new Set();
  for (const el of raw.elements) {
    const elementKey = `${el.type}/${el.id}`;
    if (seenElements.has(elementKey)) continue;
    seenElements.add(elementKey);
    const tags = el.tags || {};
    const geom = geometryOf(el);
    if (tags.building && geom?.length >= 4) {
      let points = simplify(geom, 1.35);
      if (points.length >= 3 && (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1])) points.push(points[0]);
      if (points.length >= 4) buildings.push({ id: el.id, h: Math.round(heightOf(tags) * 10) / 10, n: tags.name || '', c: categoryOf(tags), p: points });
    } else if (tags.highway && geom?.length >= 2) {
      roads.push({ id: el.id, k: tags.highway, p: simplify(geom, 3.5) });
    }

    if (tags.amenity || tags.shop || tags.public_transport) {
      const lat = el.lat ?? el.center?.lat ?? el.geometry?.[0]?.lat;
      const lon = el.lon ?? el.center?.lon ?? el.geometry?.[0]?.lon;
      const name = tags.name || tags.brand;
      if (lat && lon && name) {
        const [x, z] = project(lat, lon);
        places.push({ id: `${el.type}/${el.id}`, n: name, k: tags.shop || tags.amenity || tags.public_transport, c: categoryOf(tags), x, z });
      }
    }
  }

  buildings.sort((a, b) => Math.hypot(...a.p[0]) - Math.hypot(...b.p[0]));
  const cache = {
    meta: { source: 'OpenStreetMap contributors / Overpass API', endpoint: usedEndpoint, fetchedAt: new Date().toISOString(), center: CENTER, radius: RADIUS, queries, buildingCount: buildings.length, roadCount: roads.length, placeCount: places.length },
    buildings,
    roads,
    places
  };
  await fs.writeFile(outputFile, JSON.stringify(cache));
  console.log(`Cache prêt : ${buildings.length} bâtiments, ${roads.length} routes, ${places.length} lieux.`);
}

main().catch(error => { console.error(error); process.exit(1); });
