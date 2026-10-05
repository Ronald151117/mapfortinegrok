/**
 * Sidewalk, park and palm trees for San Salvador and Puerto de La Libertad.
 * Streets stay the real OSM lines. Points are spread across each city, not
 * dumped on the first tiles.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

const index = JSON.parse(readFileSync("public/data/packs/index.json", "utf8"));
const CITIES = [
  { name: "ss", minLon: -89.36, maxLon: -89.05, minLat: 13.6, maxLat: 13.82, palm: false, cap: 11000, street: 7200 },
  { name: "lib", minLon: -89.55, maxLon: -89.15, minLat: 13.28, maxLat: 13.56, palm: true, cap: 5200, street: 2400 },
];

function tileLonLat(z, x, y, px, py, extent) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const t = Math.PI * (1 - (2 * (y + py / extent)) / n);
  const lat = (Math.atan(Math.sinh(t)) * 180) / Math.PI;
  return [lon, lat];
}

function tilesTouch(z, x, y) {
  const n = 2 ** z;
  const lon0 = (x / n) * 360 - 180;
  const lon1 = ((x + 1) / n) * 360 - 180;
  const lat0 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return CITIES.some((c) => !(lon1 < c.minLon || lon0 > c.maxLon || lat1 < c.minLat || lat0 > c.maxLat));
}

function packHits(part, z) {
  if (part.x0 == null || part.x1 == null) return true;
  const n = 2 ** z;
  return CITIES.some((c) => {
    const x0 = Math.floor(((c.minLon + 180) / 360) * n) - 1;
    const x1 = Math.floor(((c.maxLon + 180) / 360) * n) + 1;
    return part.x1 >= x0 && part.x0 <= x1;
  });
}

function inCity(lon, lat) {
  return CITIES.find((c) => lon >= c.minLon && lon <= c.maxLon && lat >= c.minLat && lat <= c.maxLat) || null;
}

function meters(a, b) {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
}

function pip(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function readArchive(file) {
  const data = readFileSync(file.startsWith("/") ? `public${file}` : file);
  if (data.subarray(0, 4).toString() !== "SVT1") throw new Error(file);
  const count = data.readUInt32LE(8);
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 16;
    const off = data.readUInt32LE(o + 8);
    const len = data.readUInt32LE(o + 12);
    tiles.push({
      z: data.readUInt8(o),
      x: data.readUInt16LE(o + 2),
      y: data.readUInt16LE(o + 4),
      buf: data.subarray(off, off + len),
    });
  }
  return tiles;
}

const seen = new Set();
const trees = [];
const counts = { ss: 0, lib: 0 };

function add(lon, lat, k) {
  const city = inCity(lon, lat);
  if (!city || counts[city.name] >= city.cap) return false;
  const key = `${Math.round(lon * 6500)}:${Math.round(lat * 6500)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  counts[city.name]++;
  trees.push({
    type: "Feature",
    properties: { k: city.palm && k !== 1 ? 2 : k },
    geometry: { type: "Point", coordinates: [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] },
  });
  return true;
}

function spread(list, city, cap, k) {
  if (!list.length || cap <= 0) return 0;
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const room = Math.min(cap, city.cap - counts[city.name]);
  const step = Math.max(1, Math.ceil(list.length / room));
  let n = 0;
  for (let i = 0; i < list.length && n < room; i += step) {
    if (add(list[i][0], list[i][1], k)) n++;
  }
  return n;
}

const existing = JSON.parse(readFileSync("public/data/trees.geojson", "utf8"));
let outside = 0;
for (const feature of existing.features) {
  const [lon, lat] = feature.geometry.coordinates;
  if (inCity(lon, lat)) continue;
  trees.push(feature);
  seen.add(`${Math.round(lon * 6500)}:${Math.round(lat * 6500)}`);
  outside++;
}

const streetPts = { ss: [], lib: [] };
const streetSeen = new Set();
function considerStreet(lon, lat) {
  const city = inCity(lon, lat);
  if (!city) return;
  const key = `${city.name}:${Math.round(lon * 5500)}:${Math.round(lat * 5500)}`;
  if (streetSeen.has(key)) return;
  streetSeen.add(key);
  streetPts[city.name].push([lon, lat]);
}

for (const part of index.roads["14"]) {
  if (!packHits(part, 14)) continue;
  for (const tile of readArchive(part.url)) {
    if (tile.z !== 14 || !tilesTouch(tile.z, tile.x, tile.y)) continue;
    const vt = new VectorTile(new PbfReader(tile.buf));
    const layer = vt.layers.roads;
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const cls = Number(feature.properties.c);
      if (!Number.isFinite(cls) || cls > 7) continue;
      const spacing = cls <= 2 ? 70 : cls <= 4 ? 55 : 48;
      const offset = cls <= 2 ? 16 : 11;
      for (const line of feature.loadGeometry()) {
        let acc = spacing * 0.35;
        for (let p = 1; p < line.length; p++) {
          const a = tileLonLat(tile.z, tile.x, tile.y, line[p - 1].x, line[p - 1].y, layer.extent);
          const b = tileLonLat(tile.z, tile.x, tile.y, line[p].x, line[p].y, layer.extent);
          const seg = meters(a, b);
          if (seg < 8 || seg > 500) continue;
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len = Math.hypot(dx, dy) || 1;
          const cos = Math.cos((a[1] * Math.PI) / 180);
          while (acc < seg) {
            const t = acc / seg;
            const lon = a[0] + dx * t;
            const lat = a[1] + dy * t;
            for (const side of [-1, 1]) {
              const ox = ((-dy / len) * offset * side) / (111320 * cos);
              const oy = ((dx / len) * offset * side) / 110540;
              considerStreet(lon + ox, lat + oy);
            }
            acc += spacing;
          }
          acc -= seg;
          if (acc < 0) acc = 0;
        }
      }
    }
  }
}

let street = 0;
for (const city of CITIES) street += spread(streetPts[city.name], city, city.street, 0);

let palms = 0;
const land = JSON.parse(readFileSync("public/data/land.geojson", "utf8"));
const coast = land.features[0].geometry.coordinates[0];
const lib = CITIES[1];
for (let i = 1; i < coast.length; i++) {
  const a = coast[i - 1];
  const b = coast[i];
  const seg = meters(a, b);
  if (seg < 30 || seg > 80000) continue;
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (mid[0] < lib.minLon - 0.05 || mid[0] > lib.maxLon + 0.05) continue;
  if (mid[1] > lib.maxLat + 0.02) continue;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const left = [mid[0] + px * 0.0012, mid[1] + py * 0.0012];
  const inland = pip(left, coast) ? 1 : -1;
  const step = 42;
  let acc = 20;
  while (acc < seg) {
    const t = acc / seg;
    const lon = a[0] + dx * t;
    const lat = a[1] + dy * t;
    for (const dist of [0.00115, 0.00205]) {
      const qLon = lon + px * dist * inland;
      const qLat = lat + py * dist * inland;
      if (add(qLon, qLat, 2)) palms++;
    }
    acc += step;
  }
}

const parkPts = { ss: [], lib: [] };
const parkSeen = new Set();
function considerPark(lon, lat, k) {
  const city = inCity(lon, lat);
  if (!city) return;
  const key = `${city.name}:${Math.round(lon * 4200)}:${Math.round(lat * 4200)}`;
  if (parkSeen.has(key)) return;
  parkSeen.add(key);
  parkPts[city.name].push([lon, lat, k]);
}

for (const part of index.cover["13"]) {
  if (!packHits(part, 13)) continue;
  for (const tile of readArchive(part.url)) {
    if (tile.z !== 13 || !tilesTouch(tile.z, tile.x, tile.y)) continue;
    const vt = new VectorTile(new PbfReader(tile.buf));
    const layer = vt.layers.landuse;
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      const kind = Number(feature.properties.a);
      if (kind !== 4 && kind !== 5 && kind !== 6) continue;
      const step = kind === 6 ? 0.00034 : kind === 4 ? 0.0005 : 0.00062;
      const capPoly = kind === 6 ? 48 : 16;
      const k = kind === 4 ? 1 : 0;
      for (const ringPx of feature.loadGeometry()) {
        if (ringPx.length < 3) continue;
        const ring = ringPx.map((p) => tileLonLat(tile.z, tile.x, tile.y, p.x, p.y, layer.extent));
        let minLon = Infinity;
        let minLat = Infinity;
        let maxLon = -Infinity;
        let maxLat = -Infinity;
        for (const p of ring) {
          if (p[0] < minLon) minLon = p[0];
          if (p[1] < minLat) minLat = p[1];
          if (p[0] > maxLon) maxLon = p[0];
          if (p[1] > maxLat) maxLat = p[1];
        }
        if (maxLon - minLon > 0.08 || maxLat - minLat > 0.08) continue;
        if (!CITIES.some((c) => !(maxLon < c.minLon || minLon > c.maxLon || maxLat < c.minLat || minLat > c.maxLat))) continue;
        let n = 0;
        for (let lat = minLat; lat <= maxLat && n < capPoly; lat += step) {
          for (let lon = minLon; lon <= maxLon && n < capPoly; lon += step) {
            const jx = lon + Math.sin(lat * 910 + lon * 40) * step * 0.28;
            const jy = lat + Math.cos(lon * 730) * step * 0.28;
            if (!pip([jx, jy], ring)) continue;
            considerPark(jx, jy, k);
            n++;
          }
        }
      }
    }
  }
}

let parks = 0;
for (const city of CITIES) {
  const room = city.cap - counts[city.name];
  const list = parkPts[city.name];
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const stepN = Math.max(1, Math.ceil(list.length / Math.max(1, room)));
  for (let i = 0; i < list.length && counts[city.name] < city.cap; i += stepN) {
    if (add(list[i][0], list[i][1], list[i][2])) parks++;
  }
}

const out = { type: "FeatureCollection", features: trees };
const raw = JSON.stringify(out);
writeFileSync("public/data/trees.geojson", raw);
console.log({
  total: trees.length,
  outside,
  parks,
  palms,
  street,
  ss: counts.ss,
  lib: counts.lib,
  streetPool: { ss: streetPts.ss.length, lib: streetPts.lib.length },
  parkPool: { ss: parkPts.ss.length, lib: parkPts.lib.length },
  mb: (Buffer.byteLength(raw) / 1e6).toFixed(2),
});
