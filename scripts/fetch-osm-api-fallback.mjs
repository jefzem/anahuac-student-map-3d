import fs from 'node:fs/promises';
import path from 'node:path';

const CENTER = { lat: 19.404145, lon: -99.260732 };
const HALF_SPAN_METERS = 4000;
const GRID = 8;
const dataDir = path.resolve('data');
const tileDir = path.join(dataDir, 'osm-api-tiles');
const latDelta = HALF_SPAN_METERS / 110540;
const lonDelta = HALF_SPAN_METERS / (111320 * Math.cos(CENTER.lat * Math.PI / 180));
const bounds = { south: CENTER.lat - latDelta, north: CENTER.lat + latDelta, west: CENTER.lon - lonDelta, east: CENTER.lon + lonDelta };

const project = (lat, lon) => [Math.round((lon - CENTER.lon) * 111320 * Math.cos(CENTER.lat * Math.PI / 180) * 10) / 10, Math.round((lat - CENTER.lat) * 110540 * 10) / 10];
const decode = value => value.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const attrs = text => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
const tagsOf = body => Object.fromEntries([...body.matchAll(/<tag\s+k="([^"]+)"\s+v="([^"]*)"\s*\/>/g)].map(m => [decode(m[1]), decode(m[2])]));
const heightOf = tags => {
  const direct = Number.parseFloat(tags.height); if (Number.isFinite(direct)) return Math.min(180, Math.max(2.8, direct));
  const levels = Number.parseFloat(tags['building:levels']); if (Number.isFinite(levels)) return Math.min(150, Math.max(3, levels * 3.15));
  if (tags.building === 'apartments') return 15;
  if (tags.building === 'commercial' || tags.building === 'office') return 12;
  if (tags.building === 'university') return 11;
  if (tags.building === 'house' || tags.building === 'residential') return 7;
  return 6;
};
const publicAmenities = new Set(['school','university','college','kindergarten','hospital','clinic','library','police','fire_station','townhall','courthouse','community_centre','post_office','social_facility','government']);
const categoryOf = tags => {
  if (tags.shop || ['commercial','retail','supermarket','mall'].includes(tags.building)) return 'commerce';
  if (publicAmenities.has(tags.amenity) || tags.office === 'government' || ['civic','public','government','hospital','school','university'].includes(tags.building)) return 'public';
  if (['restaurant','cafe','bar','pub','fast_food','pharmacy','bank','atm','marketplace'].includes(tags.amenity)) return 'commerce';
  return '';
};

async function fetchTile(index, bbox) {
  const file = path.join(tileDir, `tile-${String(index + 1).padStart(2, '0')}.xml`);
  try { const cached = await fs.readFile(file, 'utf8'); if (cached.includes('<osm')) return cached; } catch { /* no cache */ }
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${bbox.join(',')}`;
  const response = await fetch(url, { headers: { 'user-agent': 'AnahuacStudentMap/1.0' } });
  if (!response.ok) throw new Error(`OSM API ${response.status} pour la tuile ${index + 1}`);
  const xml = await response.text(); await fs.writeFile(file, xml);
  console.log(`Tuile ${index + 1}/${GRID * GRID} enregistrée.`); return xml;
}

async function main() {
  await fs.mkdir(tileDir, { recursive: true });
  const boxes = [];
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    const w = bounds.west + (bounds.east - bounds.west) * c / GRID, e = bounds.west + (bounds.east - bounds.west) * (c + 1) / GRID;
    const s = bounds.south + (bounds.north - bounds.south) * r / GRID, n = bounds.south + (bounds.north - bounds.south) * (r + 1) / GRID;
    boxes.push([w, s, e, n]);
  }
  const xmls = [];
  for (let i = 0; i < boxes.length; i += 2) xmls.push(...await Promise.all(boxes.slice(i, i + 2).map((box, j) => fetchTile(i + j, box))));

  const nodes = new Map(), ways = new Map();
  for (const xml of xmls) {
    for (const m of xml.matchAll(/<node\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) { const a = attrs(m[1]); nodes.set(a.id, { lat: Number(a.lat), lon: Number(a.lon), tags: tagsOf(m[2] || '') }); }
    for (const m of xml.matchAll(/<way\s+([^>]*)>([\s\S]*?)<\/way>/g)) { const a = attrs(m[1]), body = m[2]; ways.set(a.id, { refs: [...body.matchAll(/<nd\s+ref="(\d+)"\s*\/>/g)].map(x => x[1]), tags: tagsOf(body) }); }
  }
  const buildings = [], roads = [], places = [], placeSeen = new Set();
  for (const [id, way] of ways) {
    const points = way.refs.map(ref => nodes.get(ref)).filter(Boolean).map(n => project(n.lat, n.lon));
    if (way.tags.building && points.length >= 4) buildings.push({ id: Number(id), h: Math.round(heightOf(way.tags) * 10) / 10, n: way.tags.name || '', c: categoryOf(way.tags), p: points });
    if (way.tags.highway && way.tags.highway !== 'service' && points.length >= 2) roads.push({ id: Number(id), k: way.tags.highway, p: points });
    const center = points[Math.floor(points.length / 2)];
    if (center && (way.tags.amenity || way.tags.shop || way.tags.public_transport) && way.tags.name) { const key = way.tags.name.toLowerCase(); if (!placeSeen.has(key)) { places.push({ id: `way/${id}`, n: way.tags.name, k: way.tags.shop || way.tags.amenity || way.tags.public_transport, c: categoryOf(way.tags), x: center[0], z: center[1] }); placeSeen.add(key); } }
  }
  for (const [id, node] of nodes) {
    if (!(node.tags.amenity || node.tags.shop || node.tags.public_transport) || !node.tags.name) continue;
    const key = node.tags.name.toLowerCase(); if (placeSeen.has(key)) continue;
    const [x, z] = project(node.lat, node.lon); places.push({ id: `node/${id}`, n: node.tags.name, k: node.tags.shop || node.tags.amenity || node.tags.public_transport, c: categoryOf(node.tags), x, z }); placeSeen.add(key);
  }
  buildings.sort((a,b) => Math.hypot(...a.p[0]) - Math.hypot(...b.p[0]));
  const cache = { meta: { source: 'OpenStreetMap contributors', endpoint: 'https://api.openstreetmap.org/api/0.6/map', fetchedAt: new Date().toISOString(), center: CENTER, radius: 10000, detailedCoverageMeters: HALF_SPAN_METERS, query: 'Primary Overpass query is stored in scripts/fetch-osm.mjs; official OSM API fallback used during outage.', buildingCount: buildings.length, roadCount: roads.length, placeCount: places.length }, buildings, roads, places };
  await fs.writeFile(path.join(dataDir, 'osm-cache.json'), JSON.stringify(cache));
  console.log(`Cache prêt : ${buildings.length} bâtiments, ${roads.length} routes, ${places.length} lieux.`);
}

main().catch(error => { console.error(error); process.exit(1); });
