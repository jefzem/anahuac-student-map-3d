import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import './style.css';

const CENTER = { lat: 19.404145, lon: -99.260732 };
const MAX_RENDERED_BUILDINGS = 22000;
const canvas = document.querySelector('#map');
const loading = document.querySelector('#loading');
const loadingDetail = document.querySelector('#loadingDetail');
const listingsEl = document.querySelector('#listings');
const resultCount = document.querySelector('#resultCount');
const detailEl = document.querySelector('#detail');
const tooltip = document.querySelector('#tooltip');
const refreshButton = document.querySelector('#refreshListings');
const refreshStatus = document.querySelector('#refreshStatus');
const updatedDate = document.querySelector('#updatedDate');
const addressForm = document.querySelector('#addressForm');
const addressInput = document.querySelector('#addressInput');
const addressSubmit = document.querySelector('#addressSubmit');
const addressStatus = document.querySelector('#addressStatus');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1b1c, 0.000085);
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 1, 42000);
camera.position.set(1750, 1500, 2200);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = .055;
controls.maxPolarAngle = Math.PI * .47;
controls.minDistance = 180;
controls.maxDistance = 9200;
controls.target.set(0, 0, 0);

const hemi = new THREE.HemisphereLight(0x9ad8ff, 0x193431, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1c0, 3.1);
sun.position.set(-2400, 3600, -1200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3000; sun.shadow.camera.right = 3000;
sun.shadow.camera.top = 3000; sun.shadow.camera.bottom = -3000;
sun.shadow.camera.far = 9000;
scene.add(sun);

const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x102b2b, roughness: .96, metalness: .02 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000, 96, 96), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const rings = new THREE.Group();
scene.add(rings);

const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x8ea39c, roughness: .78, metalness: .08, emissive: 0x071311, emissiveIntensity: .15 });
const campusMaterial = new THREE.MeshStandardMaterial({ color: 0xe97958, roughness: .64, emissive: 0x42130c, emissiveIntensity: .2 });
const commerceMaterial = new THREE.MeshStandardMaterial({ color: 0xe3b956, roughness: .66, metalness: .06, emissive: 0x382405, emissiveIntensity: .18 });
const publicMaterial = new THREE.MeshStandardMaterial({ color: 0x6f9ddd, roughness: .65, metalness: .08, emissive: 0x0b1c3a, emissiveIntensity: .2 });
const roadMaterial = new THREE.LineBasicMaterial({ color: 0x85aaa3, transparent: true, opacity: .3 });
const windowMaterial = new THREE.PointsMaterial({ color: 0xffe095, size: 3.2, transparent: true, opacity: 0, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending });
let windowPoints;
const interactive = [];
const listingMarkers = new Map();
const addressMarkers = new Map();
const ADDRESS_STORAGE_KEY = 'anahuac-map-addresses-v1';
let listings = [];
let activeType = 'all';
let maxBudget = 30000;
let selectedId = null;
let elevationData = null;
const TERRAIN_EXAGGERATION = .82;

const project = (lat, lon) => ({
  x: (lon - CENTER.lon) * 111320 * Math.cos(CENTER.lat * Math.PI / 180),
  z: (lat - CENTER.lat) * 110540
});

function terrainHeight(x, z) {
  if (!elevationData) return 0;
  const { size, halfSpanMeters, centerElevation } = elevationData.meta;
  const col = THREE.MathUtils.clamp((x + halfSpanMeters) / (halfSpanMeters * 2) * (size - 1), 0, size - 1);
  const row = THREE.MathUtils.clamp((halfSpanMeters - z) / (halfSpanMeters * 2) * (size - 1), 0, size - 1);
  const c0 = Math.floor(col), c1 = Math.min(size - 1, c0 + 1), r0 = Math.floor(row), r1 = Math.min(size - 1, r0 + 1);
  const tx = col - c0, tz = row - r0;
  const top = THREE.MathUtils.lerp(elevationData.values[r0 * size + c0], elevationData.values[r0 * size + c1], tx);
  const bottom = THREE.MathUtils.lerp(elevationData.values[r1 * size + c0], elevationData.values[r1 * size + c1], tx);
  return (THREE.MathUtils.lerp(top, bottom, tz) - centerElevation) * TERRAIN_EXAGGERATION;
}

function applyTerrain(data) {
  elevationData = data;
  const position = ground.geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), localY = position.getY(i);
    position.setZ(i, terrainHeight(x, -localY));
  }
  position.needsUpdate = true;
  ground.geometry.computeVertexNormals();
  rings.clear();
  for (const radius of [1000, 3000, 5000, 10000]) {
    const points = [];
    for (let i = 0; i <= 180; i++) {
      const angle = i / 180 * Math.PI * 2, x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      points.push(new THREE.Vector3(x, terrainHeight(x, z) + 3, z));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: radius === 5000 ? 0xc9f36a : 0x6c8f88, transparent: true, opacity: radius === 5000 ? .4 : .2 }));
    rings.add(line);
  }
}

function createBuildingGeometry(building) {
  const shape = new THREE.Shape();
  building.p.forEach(([x, z], i) => i ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: building.h, bevelEnabled: false, curveSegments: 1 });
  geometry.rotateX(-Math.PI / 2);
  const [anchorX, anchorZ] = building.p[0];
  geometry.translate(0, terrainHeight(anchorX, anchorZ) + 1.2, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function addBuildings(data) {
  const source = data.buildings.slice(0, MAX_RENDERED_BUILDINGS);
  const windowPositions = [];
  for (let start = 0; start < source.length; start += 280) {
    const geometries = [];
    const campusGeometries = [];
    const commerceGeometries = [];
    const publicGeometries = [];
    for (const building of source.slice(start, start + 280)) {
      try {
        const geometry = createBuildingGeometry(building);
        const isCampus = building.n && /anáhuac|anahuac/i.test(building.n);
        const target = isCampus ? campusGeometries : building.c === 'public' ? publicGeometries : building.c === 'commerce' ? commerceGeometries : geometries;
        target.push(geometry);
        if (building.h >= 9 && windowPositions.length < 15000) {
          const [x, z] = building.p[0];
          const baseY = terrainHeight(x, z) + 1.2;
          const floors = Math.min(10, Math.max(1, Math.floor(building.h / 3.1)));
          for (let f = 1; f <= floors; f += 2) windowPositions.push(x, baseY + f * 3, z);
        }
      } catch { /* skip invalid OSM polygon */ }
    }
    const addMerged = (items, material, shadows = false, kind = '') => {
      if (!items.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(items), material);
      mesh.receiveShadow = true;
      mesh.castShadow = shadows;
      if (kind) {
        const names = { campus: 'Campus Norte', commerce: 'Bâtiment commercial', public: 'Bâtiment public' };
        mesh.userData = { kind, name: names[kind], place: { n: names[kind], k: kind, c: kind } };
        interactive.push(mesh);
      }
      scene.add(mesh);
      items.forEach(g => g.dispose());
    };
    addMerged(geometries, buildingMaterial, start < 1800);
    addMerged(campusGeometries, campusMaterial, true, 'campus');
    addMerged(commerceGeometries, commerceMaterial, true, 'commerce');
    addMerged(publicGeometries, publicMaterial, true, 'public');
  }
  const winGeometry = new THREE.BufferGeometry();
  winGeometry.setAttribute('position', new THREE.Float32BufferAttribute(windowPositions, 3));
  windowPoints = new THREE.Points(winGeometry, windowMaterial);
  scene.add(windowPoints);
}

function addRoads(roads) {
  const positions = [];
  for (const road of roads) {
    for (let i = 1; i < road.p.length; i++) {
      const [ax, az] = road.p[i - 1], [bx, bz] = road.p[i];
      positions.push(ax, terrainHeight(ax, az) + 2.1, az, bx, terrainHeight(bx, bz) + 2.1, bz);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  scene.add(new THREE.LineSegments(geometry, roadMaterial));
}

function markerTexture(label, color, glyph) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(7,21,22,.9)'; ctx.beginPath(); ctx.roundRect(4, 4, 248, 76, 20); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(34, 42, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#071516'; ctx.font = '700 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(glyph, 34, 42);
  ctx.fillStyle = '#f4f2e9'; ctx.font = '600 16px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(label.slice(0, 22), 64, 47);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addSprite(x, z, name, kind, color, glyph, scale = 220) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(name, color, glyph), transparent: true, depthTest: false }));
  sprite.position.set(x, terrainHeight(x, z) + 58, z); sprite.scale.set(scale, scale * .375, 1); sprite.renderOrder = 20;
  sprite.userData = { kind, name };
  interactive.push(sprite); scene.add(sprite); return sprite;
}

function addPlaces(places) {
  const seen = new Set(), counts = { commerce: 0, public: 0 };
  const limits = { commerce: 44, public: 34 };
  for (const p of places.sort((a,b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))) {
    if (!['commerce','public'].includes(p.c) || counts[p.c] >= limits[p.c] || seen.has(p.n.toLowerCase()) || Math.hypot(p.x, p.z) > 6000) continue;
    seen.add(p.n.toLowerCase());
    const isPublic = p.c === 'public';
    const glyph = isPublic ? (/hospital|clinic/.test(p.k) ? '+' : 'P') : 'C';
    const s = addSprite(p.x, p.z, p.n, p.c, isPublic ? '#79a7ff' : '#ffd36a', glyph, 170);
    s.userData.place = p;
    s.material.opacity = .86; counts[p.c]++;
  }
}

function addCampus() {
  const campus = addSprite(0, 0, 'Campus Norte', 'campus', '#ff7b62', 'A', 260);
  campus.userData.place = { n: 'Universidad Anáhuac México — Campus Norte', k: 'university', c: 'campus', x: 0, z: 0 };
  const ring = new THREE.Mesh(new THREE.RingGeometry(110, 145, 64), new THREE.MeshBasicMaterial({ color: 0xff7b62, transparent: true, opacity: .5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = terrainHeight(0, 0) + 2; scene.add(ring);
}

function addListings() {
  listings.forEach((item, index) => {
    const { x, z } = project(item.lat, item.lon);
    const marker = addSprite(x, z, item.name, 'rental', '#c9f36a', String(index + 1), 210);
    marker.userData.item = item;
    listingMarkers.set(item.id, marker);
  });
}

function readSavedAddresses() {
  try {
    const saved = JSON.parse(localStorage.getItem(ADDRESS_STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon) && Number.isFinite(item.distanceKm)) : [];
  } catch (error) {
    return [];
  }
}

function persistAddresses() {
  const addresses = Array.from(addressMarkers.values()).map(marker => marker.userData.item);
  localStorage.setItem(ADDRESS_STORAGE_KEY, JSON.stringify(addresses));
}

function addAddressMarker(item, persist = false) {
  if (addressMarkers.has(item.id)) return addressMarkers.get(item.id);
  const { x, z } = project(item.lat, item.lon);
  const marker = addSprite(x, z, item.name, 'address', '#4de0cf', '⌖', 220);
  marker.userData.item = item;
  addressMarkers.set(item.id, marker);
  if (persist) persistAddresses();
  return marker;
}

function removeAddressMarker(id) {
  const marker = addressMarkers.get(id);
  if (!marker) return;
  const interactiveIndex = interactive.indexOf(marker);
  if (interactiveIndex >= 0) interactive.splice(interactiveIndex, 1);
  scene.remove(marker);
  marker.material.map?.dispose();
  marker.material.dispose();
  addressMarkers.delete(id);
  persistAddresses();
  detailEl.className = 'detail-card glass';
  addressStatus.className = 'success';
  addressStatus.textContent = 'Adresse retirée de la carte';
}

function formatPrice(value) { return new Intl.NumberFormat('fr-FR').format(value); }
function formatUpdateDate(value) {
  if (!value) return 'mise à jour locale';
  const date = new Date(`${value}T12:00:00`);
  return `mis à jour ${new Intl.DateTimeFormat('fr-FR').format(date)}`;
}

function summarizeAvailability(items) {
  return items.reduce((summary, item) => {
    if (item.availability === 'active') summary.active += 1;
    else if (item.availability === 'inactive') summary.inactive += 1;
    else summary.unknown += 1;
    return summary;
  }, { active: 0, inactive: 0, unknown: 0 });
}

function showRefreshSummary(summary) {
  refreshStatus.textContent = `${summary.active} actives · ${summary.inactive} retirées · ${summary.unknown} à confirmer`;
}

function visibleListings() { return listings.filter(x => x.price <= maxBudget && (activeType === 'all' || x.type === activeType)); }

function renderListings() {
  const visible = visibleListings();
  resultCount.textContent = `${visible.length} logement${visible.length > 1 ? 's' : ''}`;
  listingsEl.innerHTML = visible.map((item) => {
    const rank = listings.indexOf(item) + 1;
    return `<button class="listing-card ${selectedId === item.id ? 'active' : ''}" data-id="${item.id}">
      <span class="listing-rank ${item.type}">${rank < 10 ? '0' + rank : rank}</span>
      <span><h2>${item.name}</h2><p>${item.area} · ${item.distance} · ${item.furnished ? 'meublé' : 'non meublé'}</p></span>
      <span class="price">${formatPrice(item.price)} $<small>/ mois</small></span>
    </button>`;
  }).join('');
  listingMarkers.forEach((marker, id) => marker.visible = visible.some(x => x.id === id));
  listingsEl.querySelectorAll('.listing-card').forEach(button => button.addEventListener('click', () => selectListing(button.dataset.id, true)));
}

function selectListing(id, focus = false) {
  const item = listings.find(x => x.id === id); const marker = listingMarkers.get(id);
  if (!item || !marker) return;
  selectedId = id; renderListings();
  detailEl.className = 'detail-card glass visible';
  detailEl.innerHTML = `<button class="close-detail" aria-label="Fermer">×</button>
    <span class="detail-tag">Logement étudiant · ${item.distance}</span>
    <h3>${item.name}</h3><div class="detail-price">${formatPrice(item.price)} MXN / mois</div>
    <div class="detail-grid"><div><strong>${item.area}</strong><span>surface</span></div><div><strong>${item.bedrooms}</strong><span>chambre</span></div><div><strong>${item.bathrooms}</strong><span>salle de bain</span></div></div>
    <p class="detail-note">${item.note}</p>
    <div class="detail-actions"><a href="${item.source}" target="_blank" rel="noopener">Voir l’annonce</a><button id="focusRental">Voir sur la carte</button></div>`;
  detailEl.querySelector('.close-detail').onclick = () => { detailEl.className = 'detail-card glass'; selectedId = null; renderListings(); };
  detailEl.querySelector('#focusRental').onclick = () => focusMarker(marker);
  if (focus) focusMarker(marker);
}

const kindLabels = {
  school: 'École', university: 'Université', college: 'Établissement supérieur', kindergarten: 'École maternelle',
  hospital: 'Hôpital', clinic: 'Clinique', library: 'Bibliothèque', police: 'Police', fire_station: 'Caserne de pompiers',
  townhall: 'Administration', courthouse: 'Tribunal', community_centre: 'Centre communautaire', post_office: 'Bureau de poste',
  supermarket: 'Supermarché', convenience: 'Épicerie', bakery: 'Boulangerie', pharmacy: 'Pharmacie', mall: 'Centre commercial',
  restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Pub', fast_food: 'Restauration rapide', bank: 'Banque', atm: 'Distributeur'
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function showPlaceDetail(marker, hitPoint = null) {
  const place = marker.userData.place;
  if (!place) return;
  selectedId = null; renderListings();
  const kind = marker.userData.kind;
  const isCampus = kind === 'campus';
  const isPublic = kind === 'public';
  const pointX = hitPoint?.x ?? place.x ?? marker.position.x;
  const pointZ = hitPoint?.z ?? place.z ?? marker.position.z;
  const distanceKm = Math.hypot(pointX, pointZ) / 1000;
  const label = isCampus ? 'Campus universitaire' : (kindLabels[place.k] || (isPublic ? 'Équipement public' : 'Commerce'));
  const comment = isCampus
    ? 'Le cœur de la carte : campus principal d’Anáhuac México à Huixquilucan, entouré des logements et services utiles à la vie étudiante.'
    : isPublic
      ? `${label} répertorié dans OpenStreetMap. Ce repère permet d’identifier rapidement les services collectifs accessibles autour du campus.`
      : `${label} répertorié dans OpenStreetMap. Une adresse pratique à proximité du campus ; horaires et services sont à confirmer sur place.`;
  const osmUrl = !isCampus && place.id ? `https://www.openstreetmap.org/${place.id}` : 'https://www.anahuac.mx/mexico/';
  detailEl.className = `detail-card glass context-card ${kind} visible`;
  detailEl.innerHTML = `<button class="close-detail" aria-label="Fermer">×</button>
    <span class="detail-tag">${escapeHtml(label)} · ${isCampus ? 'point central' : `${distanceKm.toFixed(1).replace('.', ',')} km du campus`}</span>
    <h3>${escapeHtml(place.n)}</h3>
    <p class="detail-note">${escapeHtml(comment)}</p>
    <div class="detail-actions"><a href="${osmUrl}" target="_blank" rel="noopener">${isCampus ? 'Site du campus' : 'Voir dans OSM'}</a><button id="focusPlace">Centrer</button></div>`;
  detailEl.querySelector('.close-detail').onclick = () => { detailEl.className = 'detail-card glass'; };
  detailEl.querySelector('#focusPlace').onclick = () => focusMarker(hitPoint ? { position: hitPoint } : marker);
}

function showAddressDetail(marker) {
  const item = marker.userData.item;
  if (!item) return;
  selectedId = null; renderListings();
  detailEl.className = 'detail-card glass context-card address visible';
  detailEl.innerHTML = `<button class="close-detail" aria-label="Fermer">×</button>
    <span class="detail-tag">Adresse ajoutée · ${item.distanceKm.toFixed(1).replace('.', ',')} km du campus</span>
    <h3>${escapeHtml(item.name)}</h3>
    <p class="detail-note">Repère personnel enregistré dans ce navigateur. La position provient de la recherche OpenStreetMap.</p>
    <div class="detail-actions"><button id="removeAddress">Retirer</button><button id="focusAddress">Centrer</button></div>`;
  detailEl.querySelector('.close-detail').onclick = () => { detailEl.className = 'detail-card glass'; };
  detailEl.querySelector('#removeAddress').onclick = () => removeAddressMarker(item.id);
  detailEl.querySelector('#focusAddress').onclick = () => focusMarker(marker);
}

function focusMarker(marker) {
  const startTarget = controls.target.clone(); const endTarget = new THREE.Vector3(marker.position.x, terrainHeight(marker.position.x, marker.position.z), marker.position.z);
  const offset = camera.position.clone().sub(startTarget).setLength(850); offset.y = 620;
  const startCamera = camera.position.clone(); const endCamera = endTarget.clone().add(offset);
  const started = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 3);
  function tick(now) {
    const t = Math.min(1, (now - started) / 650), e = ease(t);
    controls.target.lerpVectors(startTarget, endTarget, e); camera.position.lerpVectors(startCamera, endCamera, e);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const skyStops = [
  { h: 0, sky: 0x03080f, fog: 0x071013, ground: 0x0a1c1d },
  { h: 6, sky: 0x6a5a62, fog: 0x3f4c4b, ground: 0x17302e },
  { h: 12, sky: 0x7fb6c2, fog: 0x6b8e91, ground: 0x294842 },
  { h: 18, sky: 0xbf6855, fog: 0x69524c, ground: 0x213b37 },
  { h: 24, sky: 0x03080f, fog: 0x071013, ground: 0x0a1c1d }
];
function mixColor(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }
function setTime(hour) {
  let a = skyStops[0], b = skyStops[1];
  for (let i = 0; i < skyStops.length - 1; i++) if (hour >= skyStops[i].h && hour <= skyStops[i + 1].h) { a = skyStops[i]; b = skyStops[i + 1]; break; }
  const t = (hour - a.h) / (b.h - a.h || 1);
  const daylight = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
  renderer.setClearColor(mixColor(a.sky, b.sky, t));
  scene.fog.color.copy(mixColor(a.fog, b.fog, t));
  groundMaterial.color.copy(mixColor(a.ground, b.ground, t));
  hemi.intensity = .18 + daylight * 1.6; sun.intensity = .08 + daylight * 3.1;
  sun.color.set(hour < 9 || hour > 17 ? 0xffa069 : 0xfff1c0);
  const angle = ((hour - 6) / 24) * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 3600, Math.max(80, Math.sin(angle) * 4200), Math.sin(angle) * 2100);
  buildingMaterial.emissiveIntensity = .12 + (1 - daylight) * .36;
  commerceMaterial.emissiveIntensity = .16 + (1 - daylight) * .5;
  publicMaterial.emissiveIntensity = .16 + (1 - daylight) * .42;
  windowMaterial.opacity = Math.pow(1 - daylight, 2) * .85;
  renderer.toneMappingExposure = .72 + daylight * .48;
  const period = hour < 5 ? 'Nuit' : hour < 8 ? 'Aube' : hour < 17 ? 'Jour' : hour < 20 ? 'Crépuscule' : 'Nuit';
  document.querySelector('#timeText').textContent = `${String(Math.floor(hour)).padStart(2,'0')}:${String(Math.round(hour % 1 * 60)).padStart(2,'0')} · ${period}`;
  document.querySelector('#timeIcon').textContent = daylight > .65 ? '☀' : daylight > .15 ? '◐' : '✦';
}

document.querySelector('#timeSlider').addEventListener('input', e => setTime(Number(e.target.value)));
document.querySelector('#budget').addEventListener('input', e => { maxBudget = Number(e.target.value); document.querySelector('#budgetValue').textContent = `${formatPrice(maxBudget)} MXN`; renderListings(); });
document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => { document.querySelectorAll('.chip').forEach(x => x.classList.remove('active')); chip.classList.add('active'); activeType = chip.dataset.type; renderListings(); }));
document.querySelector('#resetView').onclick = () => { controls.target.set(0,0,0); camera.position.set(1750,1500,2200); };
document.querySelector('#togglePanel').onclick = () => document.querySelector('#sidebar').classList.add('open');
document.querySelector('#closePanel').onclick = () => document.querySelector('#sidebar').classList.remove('open');
refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true; refreshButton.classList.add('loading');
  refreshStatus.textContent = 'Vérification en cours…';
  try {
    const response = await fetch('/api/refresh-listings', { method: 'POST' });
    if (!response.ok) throw new Error('Mise à jour indisponible');
    const result = await response.json();
    const listingResponse = await fetch(`/listings.json?refresh=${Date.now()}`, { cache: 'no-store' });
    const listingData = await listingResponse.json();
    listings = listingData.listings.filter(item => item.studentOnly && item.availability !== 'inactive');
    updatedDate.textContent = formatUpdateDate(listingData.updated);
    showRefreshSummary(result);
    selectedId = null; detailEl.className = 'detail-card glass'; renderListings();
  } catch (error) {
    refreshStatus.textContent = 'Échec de la vérification — réessayez';
  } finally {
    refreshButton.disabled = false; refreshButton.classList.remove('loading');
  }
});

addressForm.addEventListener('submit', async event => {
  event.preventDefault();
  const address = addressInput.value.trim();
  if (address.length < 3) return;
  addressSubmit.disabled = true;
  addressStatus.className = '';
  addressStatus.textContent = 'Recherche de l’adresse…';
  try {
    const response = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Adresse introuvable');
    const id = `address-${Number(result.lat).toFixed(6)}-${Number(result.lon).toFixed(6)}`;
    const item = { id, name: result.label, query: address, lat: Number(result.lat), lon: Number(result.lon), distanceKm: Number(result.distanceKm) };
    const existing = addressMarkers.get(id);
    const marker = existing || addAddressMarker(item, true);
    addressStatus.className = 'success';
    addressStatus.textContent = existing ? 'Cette adresse est déjà sur la carte' : 'Adresse ajoutée à la carte';
    showAddressDetail(marker); focusMarker(marker); addressInput.value = '';
  } catch (error) {
    addressStatus.className = 'error';
    addressStatus.textContent = error.message;
  } finally {
    addressSubmit.disabled = false;
  }
});

const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
function raycast(event, click = false) {
  pointer.x = event.clientX / innerWidth * 2 - 1; pointer.y = -(event.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(interactive, false)[0];
  if (hit) {
    tooltip.textContent = hit.object.userData.name; tooltip.style.left = `${event.clientX}px`; tooltip.style.top = `${event.clientY}px`; tooltip.classList.add('visible');
    canvas.style.cursor = 'pointer';
    if (click && hit.object.userData.kind === 'rental') selectListing(hit.object.userData.item.id);
    else if (click && ['campus','commerce','public'].includes(hit.object.userData.kind)) showPlaceDetail(hit.object, hit.point);
    else if (click && hit.object.userData.kind === 'address') showAddressDetail(hit.object);
  } else { tooltip.classList.remove('visible'); canvas.style.cursor = 'grab'; }
}
canvas.addEventListener('pointermove', e => raycast(e)); canvas.addEventListener('click', e => raycast(e, true));

async function boot() {
  try {
    loadingDetail.textContent = 'Lecture du cache OpenStreetMap…';
    const [osmRes, listingRes, elevationRes] = await Promise.all([fetch('/osm-cache.json'), fetch('/listings.json'), fetch('/elevation.json')]);
    if (!osmRes.ok) throw new Error('Cache OpenStreetMap manquant');
    if (!elevationRes.ok) throw new Error('Cache du relief manquant');
    const [osm, listingData, elevation] = await Promise.all([osmRes.json(), listingRes.json(), elevationRes.json()]);
    listings = listingData.listings.filter(x => x.studentOnly && x.availability !== 'inactive');
    updatedDate.textContent = formatUpdateDate(listingData.updated);
    if (listingData.lastChecked) showRefreshSummary(summarizeAvailability(listingData.listings));
    loadingDetail.textContent = `${osm.meta.buildingCount.toLocaleString('fr-FR')} bâtiments · relief ${elevation.meta.min}–${elevation.meta.max} m…`;
    await new Promise(resolve => requestAnimationFrame(resolve));
    applyTerrain(elevation); addRoads(osm.roads); addBuildings(osm); addPlaces(osm.places); addCampus(); addListings();
    readSavedAddresses().forEach(item => addAddressMarker(item));
    renderListings(); setTime(12);
    loading.classList.add('hidden');
  } catch (error) {
    console.error(error); loadingDetail.textContent = `${error.message}. Lancez « pnpm fetch:osm » puis rechargez.`;
  }
}

function animate() { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }
animate(); boot();

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
