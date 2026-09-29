import fs from 'node:fs/promises';
import path from 'node:path';

const CENTER = { lat: 19.404145, lon: -99.260732 };
const HALF_SPAN_METERS = 10000;
const SIZE = 23;
const BATCH_SIZE = 100;
const endpoint = 'https://api.open-meteo.com/v1/elevation';
const output = path.resolve('data', 'elevation.json');
const latDelta = HALF_SPAN_METERS / 110540;
const lonDelta = HALF_SPAN_METERS / (111320 * Math.cos(CENTER.lat * Math.PI / 180));

const points = [];
for (let row = 0; row < SIZE; row++) {
  const lat = CENTER.lat + latDelta - (2 * latDelta * row / (SIZE - 1));
  for (let col = 0; col < SIZE; col++) {
    const lon = CENTER.lon - lonDelta + (2 * lonDelta * col / (SIZE - 1));
    points.push({ lat, lon });
  }
}

const values = [];
for (let start = 0; start < points.length; start += BATCH_SIZE) {
  const batch = points.slice(start, start + BATCH_SIZE);
  const url = new URL(endpoint);
  url.searchParams.set('latitude', batch.map(p => p.lat.toFixed(6)).join(','));
  url.searchParams.set('longitude', batch.map(p => p.lon.toFixed(6)).join(','));
  const response = await fetch(url, { headers: { 'user-agent': 'AnahuacStudentMap/1.1' } });
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}: ${await response.text()}`);
  const data = await response.json();
  values.push(...data.elevation);
  console.log(`${Math.min(start + batch.length, points.length)}/${points.length} altitudes`);
}

const centerIndex = Math.floor(SIZE / 2) * SIZE + Math.floor(SIZE / 2);
const cache = {
  meta: {
    source: 'Copernicus DEM GLO-90 via Open-Meteo Elevation API',
    sourceUrl: 'https://open-meteo.com/en/docs/elevation-api',
    fetchedAt: new Date().toISOString(),
    center: CENTER,
    halfSpanMeters: HALF_SPAN_METERS,
    size: SIZE,
    min: Math.min(...values),
    max: Math.max(...values),
    centerElevation: values[centerIndex]
  },
  values
};

await fs.writeFile(output, JSON.stringify(cache));
console.log(`Relief prêt : ${cache.meta.min}–${cache.meta.max} m, centre ${cache.meta.centerElevation} m.`);
