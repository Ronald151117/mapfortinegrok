/**
 * Builds the Cuzcatlán map pack from the latest Geofabrik El Salvador PBF.
 * Output: public/data/*.svt (vector tiles), graph.bin, search.json, land, meta.
 *
 * Run: node --max-old-space-size=3072 scripts/build-salvador-map.mjs
 */
import { createReadStream } from "node:fs";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import path from "node:path";

import GeoJSONVT from "geojson-vt";

const require = createRequire(import.meta.url);
const createOsmParser = require("osm-pbf-parser");
const vtpbf = require("vt-pbf");
const { PNG } = require("pngjs");

const PBF = "/tmp/svmap/el-salvador.osm.pbf";
const ADM0 = "/tmp/svmap/adm0.geojson";
const ADM1 = "/tmp/svmap/adm1.geojson";
const OUT = "/workspace/public/data";
const DATA_DATE = "2026-10-03";
const DEM_Z = 11;

const ROAD_BASE = {
  motorway: 0,
  trunk: 1,
  primary: 2,
  secondary: 3,
  tertiary: 4,
  unclassified: 5,
  road: 5,
  residential: 6,
  living_street: 7,
  service: 8,
  track: 9,
  path: 10,
  footway: 10,
  cycleway: 10,
  pedestrian: 10,
  steps: 10,
  bridleway: 10,
  corridor: 10,
};

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

function parsePbf(onItem) {
  return new Promise((resolve, reject) => {
    const parser = createOsmParser();
    let n = 0;
    parser.on("data", (items) => {
      for (const item of items) {
        onItem(item);
        if ((++n & 0x3ffff) === 0) log("  parsed", n);
      }
    });
    parser.on("end", () => resolve(n));
    parser.on("error", reject);
    createReadStream(PBF).pipe(parser);
  });
}

function num(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function roadClass(tags) {
  let hw = tags.highway;
  if (!hw) return null;
  if (hw === "proposed" || hw === "abandoned" || hw === "razed" || hw === "planned" || hw === "no")
    return null;
  let construction = false;
  if (hw === "construction") {
    construction = true;
    hw = tags.construction && ROAD_BASE[tags.construction] != null ? tags.construction : "tertiary";
  }
  let link = false;
  if (hw.endsWith("_link")) {
    link = true;
    hw = hw.slice(0, -5);
  }
  if (ROAD_BASE[hw] == null) return null;
  return { c: ROAD_BASE[hw], link, construction };
}

function onewayOf(tags) {
  const ow = tags.oneway;
  if (ow === "yes" || ow === "1" || ow === "true") return 1;
  if (ow === "-1" || ow === "reverse") return -1;
  if (tags.junction === "roundabout" || tags.junction === "circular") return 1;
  return 0;
}

function buildingType(tags) {
  const b = tags.building;
  const amenity = tags.amenity || "";
  if (b === "construction" || tags.construction) return 8;
  if (
    ["church", "chapel", "cathedral", "mosque", "synagogue", "temple", "shrine"].includes(b) ||
    amenity === "place_of_worship"
  )
    return 5;
  if (["industrial", "warehouse", "hangar", "factory", "manufacture"].includes(b)) return 3;
  if (
    ["commercial", "office", "retail", "supermarket", "kiosk", "retail"].includes(b) ||
    tags.shop
  )
    return 2;
  if (["apartments", "dormitory"].includes(b)) return 1;
  if (
    ["school", "university", "college", "hospital", "public", "government", "civic", "train_station", "stadium", "transportation"].includes(b) ||
    ["school", "university", "college", "hospital", "townhall", "police", "fire_station"].includes(amenity)
  )
    return 4;
  return 0;
}

function buildingHeight(tags, type, id) {
  const raw = parseFloat(String(tags.height || tags["building:height"] || "").replace(",", "."));
  if (Number.isFinite(raw) && raw > 2 && raw < 140) return Math.round(raw);
  const levels = parseFloat(String(tags["building:levels"] || "").replace(",", "."));
  if (Number.isFinite(levels) && levels > 0 && levels < 40) return Math.round(Math.min(100, levels * 3.15 + 1.2));
  const defaults = [7, 15, 8, 9, 12, 16, 8, 8, 6];
  const base = defaults[type] ?? 7;
  const jitter = (Number(id) % 5) - 2;
  return Math.max(4, base + jitter);
}

function landClass(tags) {
  if (tags.landuse === "construction" || tags["landuse:construction"]) return 9;
  const l = tags.landuse || "";
  const n = tags.natural || "";
  const leisure = tags.leisure || "";
  if (l === "residential" || l === "garages") return 0;
  if (l === "commercial" || l === "retail") return 1;
  if (l === "quarry") return 13;
  if (l === "industrial" || l === "railway" || l === "brownfield") return 2;
  if (["farmland", "farmyard", "orchard", "vineyard", "greenhouse_horticulture", "allotments", "plant_nursery"].includes(l))
    return 3;
  if (l === "forest" || n === "wood") return 4;
  if (n === "scrub" || n === "heath" || l === "scrub" || l === "grass") {
    if (l === "grass" || leisure === "garden") return leisure === "park" ? 6 : 5;
    if (n === "scrub" || n === "heath" || l === "scrub") return 14;
  }
  if (["meadow", "grass", "grassland", "village_green", "recreation_ground"].includes(l) || n === "grassland")
    return 5;
  if (["park", "garden", "nature_reserve", "common"].includes(leisure) || l === "recreation_ground") return 6;
  if (n === "beach" || n === "sand" || n === "shoal" || l === "beach") return 7;
  if (n === "wetland" || l === "wetland" || n === "marsh") return 8;
  if (l === "cemetery" || tags.amenity === "grave_yard") return 10;
  if (["pitch", "stadium", "sports_centre", "track", "golf_course", "playground"].includes(leisure)) return 11;
  if (l === "military" || tags.military) return 12;
  return null;
}

function isWaterPoly(tags) {
  if (tags.natural === "water" || tags.natural === "bay") return tags.natural !== "bay";
  if (tags.landuse === "reservoir" || tags.landuse === "basin") return true;
  if (tags.waterway === "riverbank" || tags.waterway === "dock") return true;
  if (tags.water && tags.water !== "river") return true;
  return false;
}

function waterLine(tags) {
  const w = tags.waterway;
  if (!w) return false;
  if (w === "river" || w === "stream" || w === "canal" || w === "fairway") return true;
  if ((w === "drain" || w === "ditch") && tags.name) return true;
  return false;
}

function poiFromTags(tags) {
  const a = tags.amenity || "";
  const s = tags.shop || "";
  const t = tags.tourism || "";
  const n = tags.natural || "";
  const name = tags.name || tags["name:es"] || "";
  if (n === "volcano") return { k: "volcano", p: 1, name: name || tags.ele || "Volcán" };
  if (n === "peak" && name) return { k: "peak", p: 1, name };
  if (tags.aeroway === "aerodrome" && name) return { k: "airport", p: 1, name };
  if (a === "hospital") return { k: "hospital", p: 1, name: name || "Hospital" };
  if (a === "clinic" || a === "doctors") return name ? { k: "clinic", p: 2, name } : null;
  if (a === "pharmacy" && name) return { k: "pharmacy", p: 2, name };
  if (a === "fuel") return { k: "fuel", p: 1, name: name || "Gasolinera" };
  if (a === "police") return { k: "police", p: 1, name: name || "Policía" };
  if (a === "fire_station") return { k: "fire", p: 2, name: name || "Bomberos" };
  if ((a === "school" || a === "kindergarten") && name) return { k: "school", p: 2, name };
  if ((a === "university" || a === "college") && name) return { k: "university", p: 1, name };
  if (a === "bus_station") return { k: "bus_station", p: 1, name: name || "Terminal" };
  if (a === "ferry_terminal") return { k: "ferry", p: 1, name: name || "Ferry" };
  if (tags.highway === "bus_stop" && name) return { k: "bus", p: 3, name };
  if ((a === "marketplace" || s === "supermarket" || s === "marketplace") && name)
    return { k: "market", p: 2, name };
  if (a === "townhall" || a === "courthouse") return { k: "civic", p: 1, name: name || "Alcaldía" };
  if ((a === "bank" || a === "atm") && name) return { k: "bank", p: 3, name };
  if (a === "place_of_worship" && name) return { k: "worship", p: 3, name };
  if (a === "parking" && name) return { k: "parking", p: 4, name };
  if ((t === "hotel" || t === "guest_house" || a === "hotel") && name) return { k: "hotel", p: 2, name };
  if ((t === "attraction" || t === "viewpoint" || t === "museum") && name) return { k: "sight", p: 2, name };
  if ((a === "restaurant" || a === "cafe" || a === "fast_food") && name) return { k: "food", p: 4, name };
  if (tags.leisure === "stadium" && name) return { k: "stadium", p: 2, name };
  if (a === "post_office" && name) return { k: "post", p: 3, name };
  if (a === "library" && name) return { k: "library", p: 3, name };
  return null;
}

const PLACE_K = { city: 0, town: 1, village: 2, hamlet: 3, suburb: 4, neighbourhood: 5, quarter: 5 };

function dist2seg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function dp(points, tol) {
  const n = points.length;
  if (n <= 2) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = dist2seg(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function dpRing(ring, tol, maxPts) {
  if (!ring || ring.length < 4) return null;
  const closed =
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : ring.slice();
  if (open.length < 3) return null;
  let tol2 = tol;
  let simp = dp(open, tol2);
  let guard = 0;
  while (simp.length > maxPts && tol2 < 0.01 && guard++ < 8) {
    tol2 *= 1.7;
    simp = dp(open, tol2);
  }
  if (simp.length < 3) return null;
  if (simp.length > maxPts) simp = simp.filter((_, i) => i % Math.ceil(simp.length / maxPts) === 0);
  if (simp.length < 3) return null;
  simp.push([simp[0][0], simp[0][1]]);
  return simp;
}

function areaDeg2(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a) / 2;
}

function pip(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][1];
    const yj = ring[j][1];
    const xi = ring[i][0];
    const xj = ring[j][0];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi || 1e-12) + xi) c = !c;
  }
  return c;
}

function havMeters(a, b) {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180;
  const la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function lineLen(line) {
  let m = 0;
  for (let i = 1; i < line.length; i++) m += havMeters(line[i - 1], line[i]);
  return m;
}

function centroid(ring) {
  let x = 0;
  let y = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

function near(a, b, eps = 3e-5) {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

function stitch(segments) {
  const unused = segments.map((s) => s.slice());
  const rings = [];
  while (unused.length) {
    let ring = unused.pop();
    let guard = 0;
    const limit = unused.length + 2;
    while (guard++ <= limit) {
      const end = ring[ring.length - 1];
      if (near(ring[0], end) && ring.length >= 4) break;
      let found = -1;
      let reverse = false;
      for (let i = 0; i < unused.length; i++) {
        const s = unused[i];
        if (near(end, s[0])) {
          found = i;
          reverse = false;
          break;
        }
        if (near(end, s[s.length - 1])) {
          found = i;
          reverse = true;
          break;
        }
      }
      if (found < 0) break;
      const s = unused.splice(found, 1)[0];
      if (reverse) s.reverse();
      for (let i = 1; i < s.length; i++) ring.push(s[i]);
    }
    if (ring.length >= 4 && near(ring[0], ring[ring.length - 1])) {
      ring[ring.length - 1] = ring[0];
      rings.push(ring);
    }
  }
  return rings;
}

function lonToX(lon, z) {
  return ((lon + 180) / 360) * 2 ** z;
}
function latToY(lat, z) {
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return y * 2 ** z;
}

async function loadDem() {
  const z = DEM_Z;
  const minLon = -90.25;
  const maxLon = -87.55;
  const minLat = 12.9;
  const maxLat = 14.55;
  const x0 = Math.floor(lonToX(minLon, z));
  const x1 = Math.floor(lonToX(maxLon, z));
  const yNorth = Math.floor(latToY(maxLat, z));
  const ySouth = Math.floor(latToY(minLat, z));
  const y0 = Math.min(yNorth, ySouth);
  const y1 = Math.max(yNorth, ySouth);
  const jobs = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
  log("DEM tiles", jobs.length, "z", z);
  const tiles = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const i = cursor++;
      const [x, y] = jobs[i];
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const png = PNG.sync.read(buf);
        tiles.set(`${x}/${y}`, png);
      } catch {
        /* skip */
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  log("DEM loaded", tiles.size);

  function elev(lon, lat) {
    const gx = lonToX(lon, z);
    const gy = latToY(lat, z);
    const tx = Math.floor(gx);
    const ty = Math.floor(gy);
    const png = tiles.get(`${tx}/${ty}`);
    if (!png) return 0;
    const px = Math.max(0, Math.min(255, Math.floor((gx - tx) * 256)));
    const py = Math.max(0, Math.min(255, Math.floor((gy - ty) * 256)));
    const i = (py * png.width + px) << 2;
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    return r * 256 + g + b / 256 - 32768;
  }
  return elev;
}

function classifyCoast(ring, elev) {
  const lines = { cliff: [], beach: [], shore: [] };
  const walls = [];
  const stats = { skip: 0, cliff: 0, beach: 0, shore: 0, border: 0 };
  const pipRing = dpRing(ring, 0.00035, 2500) || ring;
  let run = null;
  const flush = () => {
    if (!run || run.pts.length < 2) {
      run = null;
      return;
    }
    lines[run.kind].push(run.pts);
    if (run.kind === "cliff" && run.inland.length >= 2) {
      const poly = run.pts.slice();
      for (let i = run.inland.length - 1; i >= 0; i--) poly.push(run.inland[i]);
      if (poly.length >= 4) {
        poly.push(poly[0]);
        const h = Math.max(12, Math.min(70, Math.round(run.hSum / run.hN)));
        walls.push({ poly, h });
      }
    }
    run = null;
  };

  const orient = (mid, east, north) => {
    for (const dist of [35, 80, 150]) {
      const mLon = 111320 * Math.cos((mid[1] * Math.PI) / 180);
      const pin = [mid[0] + (east * dist) / mLon, mid[1] + (north * dist) / 111320];
      if (pip(pin, pipRing)) return { east, north };
      const pout = [mid[0] - (east * dist) / mLon, mid[1] - (north * dist) / 111320];
      if (pip(pout, pipRing)) return { east: -east, north: -north };
    }
    return null;
  };

  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const mLon = 111320 * Math.cos((mid[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * mLon;
    const dy = (b[1] - a[1]) * 111320;
    const len = Math.hypot(dx, dy) || 1;
    const facing = orient(mid, -dy / len, dx / len);
    if (!facing) {
      stats.skip++;
      flush();
      continue;
    }
    const shift = (east, north, meters) => [
      mid[0] + (east * meters) / mLon,
      mid[1] + (north * meters) / 111320,
    ];
    const pin = shift(facing.east, facing.north, 70);
    const pout = shift(-facing.east, -facing.north, 240);
    const eOut = elev(pout[0], pout[1]);
    const eIn = elev(pin[0], pin[1]);
    if (!Number.isFinite(eOut) || (eOut > 12 && eIn > 12 && eIn - eOut < 8)) {
      stats.border++;
      flush();
      continue;
    }
    let kind = "shore";
    if (eIn >= 16 && eIn - Math.max(0, eOut) >= 10) kind = "cliff";
    else if (eIn <= 9) kind = "beach";
    stats[kind]++;
    const inland = shift(facing.east, facing.north, kind === "cliff" ? 36 : 28);
    if (!run || run.kind !== kind) {
      flush();
      run = { kind, pts: [a], inland: [inland], hSum: Math.max(0, eIn), hN: 1 };
    }
    run.pts.push(b);
    run.inland.push(inland);
    run.hSum += Math.max(0, eIn);
    run.hN++;
    if (run.pts.length > 24) {
      const last = run.pts[run.pts.length - 1];
      const lastIn = run.inland[run.inland.length - 1];
      const h = run.hSum;
      const n = run.hN;
      flush();
      run = { kind, pts: [last], inland: [lastIn], hSum: h / n, hN: 1 };
    }
  }
  flush();
  return { lines, walls, stats };
}

function writeArchive(buckets) {
  const keys = [...buckets.keys()].sort((a, b) => {
    const A = buckets.get(a);
    const B = buckets.get(b);
    return A.z - B.z || A.x - B.x || A.y - B.y;
  });
  const encoded = [];
  let payload = 0;
  for (const k of keys) {
    const b = buckets.get(k);
    const raw = vtpbf.fromGeojsonVt(b.layers, { version: 2, extent: 4096 });
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    encoded.push({ z: b.z, x: b.x, y: b.y, buf });
    payload += buf.length;
  }
  const header = 12;
  const indexBytes = encoded.length * 16;
  const out = Buffer.allocUnsafe(header + indexBytes + payload);
  out.write("SVT1", 0);
  out.writeUInt16LE(1, 4);
  out.writeUInt8(0, 6);
  out.writeUInt8(14, 7);
  out.writeUInt32LE(encoded.length, 8);
  let cursor = header + indexBytes;
  encoded.forEach((e, i) => {
    const o = header + i * 16;
    out.writeUInt8(e.z, o);
    out.writeUInt8(0, o + 1);
    out.writeUInt16LE(e.x, o + 2);
    out.writeUInt16LE(e.y, o + 4);
    out.writeUInt16LE(0, o + 6);
    out.writeUInt32LE(cursor, o + 8);
    out.writeUInt32LE(e.buf.length, o + 12);
    e.buf.copy(out, cursor);
    cursor += e.buf.length;
  });
  return out;
}

function tileFeatures(jobs) {
  const buckets = new Map();
  for (const job of jobs) {
    if (!job.features.length) continue;
    const features = job.features.map((f) => {
      const properties = {};
      const src = f.properties || {};
      for (const k of Object.keys(src)) {
        const v = src[k];
        if (typeof v === "string" || typeof v === "boolean") properties[k] = v;
        else if (typeof v === "number" && Number.isFinite(v)) properties[k] = v;
      }
      return properties === src ? f : { ...f, properties };
    });
    log("tiling", job.name, features.length);
    const index = new GeoJSONVT(
      { type: "FeatureCollection", features },
      {
        maxZoom: job.maxZoom,
        indexMaxZoom: job.maxZoom,
        indexMaxPoints: 0,
        tolerance: job.tolerance,
        extent: 4096,
        buffer: 64,
      },
    );
    let kept = 0;
    for (const c of index.tileCoords) {
      if (c.z < job.minZ || c.z > job.maxZoom) continue;
      const tile = index.getTile(c.z, c.x, c.y);
      if (!tile || !tile.features.length) continue;
      const k = `${c.z}/${c.x}/${c.y}`;
      let bucket = buckets.get(k);
      if (!bucket) {
        bucket = { z: c.z, x: c.x, y: c.y, layers: {} };
        buckets.set(k, bucket);
      }
      bucket.layers[job.name] = tile;
      kept++;
    }
    log("  tiles with", job.name, kept, "index", index.total);
    job.features.length = 0;
  }
  return writeArchive(buckets);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const demPromise = loadDem();

  /** @type {Map<number, any>} */
  const ways = new Map();
  const relations = [];
  const needExtra = new Set();
  const places = [];
  const pois = [];
  const poiKeys = new Set();

  function addPoi(lat, lon, poi) {
    if (!poi || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const key = `${poi.k}|${poi.name}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (poiKeys.has(key)) return;
    poiKeys.add(key);
    pois.push({ n: poi.name, k: poi.k, p: poi.p, lat, lon });
  }

  function considerNode(item) {
    const tags = item.tags || {};
    if (!tags || Object.keys(tags).length === 0) return;
    if (tags.place && PLACE_K[tags.place] != null && (tags.name || tags["name:es"])) {
      const pop = parseInt(tags.population || "0", 10) || 0;
      places.push({
        n: tags.name || tags["name:es"],
        k: PLACE_K[tags.place],
        lat: item.lat,
        lon: item.lon,
        pop,
      });
    }
    const poi = poiFromTags(tags);
    if (poi) addPoi(item.lat, item.lon, poi);
  }

  function absorbWay(id, refs, tags, forceMp = false) {
    if (!refs || refs.length < 2) return;
    const existing = ways.get(id);
    if (existing && !forceMp) return;

    const name = tags.name || tags["name:es"] || "";
    const rc = roadClass(tags);
    if (rc && !forceMp) {
      const noCar =
        rc.c >= 10 ||
        tags.motor_vehicle === "no" ||
        tags.motorcar === "no" ||
        tags.access === "no" ||
        tags.vehicle === "no";
      const priv =
        tags.access === "private" ||
        tags.access === "customers" ||
        tags.access === "destination" ||
        tags.motor_vehicle === "private";
      const noWalk = tags.foot === "no" || rc.c <= 1;
      ways.set(id, {
        refs,
        kind: "road",
        c: rc.c,
        name,
        ow: onewayOf(tags),
        ly: tags.tunnel && tags.tunnel !== "no" ? -1 : tags.bridge && tags.bridge !== "no" ? 1 : 0,
        priv: priv ? 1 : 0,
        noCar: noCar || rc.construction ? 1 : 0,
        noWalk: noWalk ? 1 : 0,
        con: rc.construction ? 1 : 0,
      });
      return;
    }

    const btag = tags.building && tags.building !== "no";
    if (btag && !forceMp) {
      const t = buildingType(tags);
      ways.set(id, { refs, kind: "building", a: t, h: buildingHeight(tags, t, id), name });
      return;
    }

    if (tags.railway && ["rail", "light_rail", "tram", "narrow_gauge", "disused"].includes(tags.railway) && !forceMp) {
      ways.set(id, { refs, kind: "rail", a: tags.railway === "disused" ? 1 : 0, name });
      return;
    }

    if (tags.aeroway && ["runway", "taxiway", "apron", "aerodrome", "helipad", "terminal"].includes(tags.aeroway) && !forceMp) {
      ways.set(id, { refs, kind: "aero", a: tags.aeroway, name });
      return;
    }

    if ((tags.natural === "cliff" || tags.man_made === "embankment") && !forceMp) {
      ways.set(id, { refs, kind: "cliff", name });
      return;
    }

    if ((tags.man_made === "pier" || tags.man_made === "breakwater") && !forceMp) {
      ways.set(id, { refs, kind: "pier", name });
      return;
    }

    if (waterLine(tags) && !forceMp) {
      ways.set(id, { refs, kind: "wline", name, a: tags.waterway === "river" || tags.waterway === "canal" ? 1 : 0 });
      return;
    }

    if ((tags.place === "island" || tags.place === "islet") && !forceMp) {
      ways.set(id, { refs, kind: "island", name });
      return;
    }

    if (tags.natural === "coastline" && !forceMp) {
      ways.set(id, { refs, kind: "coast", name });
      return;
    }

    const lc = landClass(tags);
    if (lc != null && !forceMp) {
      ways.set(id, { refs, kind: "land", a: lc, name });
      return;
    }

    if (isWaterPoly(tags) && !forceMp) {
      ways.set(id, { refs, kind: "wpoly", name });
      return;
    }

    if (forceMp || existing) {
      if (!existing) ways.set(id, { refs, kind: "mp" });
      return;
    }

    const poi = poiFromTags(tags);
    if (poi) ways.set(id, { refs, kind: "poi", poi });
  }

  log("pass 1 relations+ways+poi nodes");
  await parsePbf((item) => {
    if (item.type === "node") {
      if (item.tags && (item.tags.place || item.tags.amenity || item.tags.shop || item.tags.tourism || item.tags.natural === "peak" || item.tags.natural === "volcano" || item.tags.highway === "bus_stop" || item.tags.aeroway === "aerodrome"))
        considerNode(item);
      return;
    }
    if (item.type === "way") {
      const id = num(item.id);
      if (id == null) return;
      const tags = item.tags || {};
      if (Object.keys(tags).length === 0) return;
      absorbWay(id, item.refs.map(num).filter((n) => n != null), tags, false);
      return;
    }
    if (item.type === "relation") {
      const tags = item.tags || {};
      if (tags.type !== "multipolygon" && tags.type !== "boundary") return;
      const areaKind =
        (tags.building && tags.building !== "no" && "building") ||
        (isWaterPoly(tags) && "wpoly") ||
        (landClass(tags) != null && "land") ||
        ((tags.place === "island" || tags.place === "islet") && "island") ||
        (tags.aeroway && "aero") ||
        null;
      if (!areaKind) return;
      const outers = [];
      const inners = [];
      for (const m of item.members || []) {
        if (m.type !== "way") continue;
        const id = num(m.id);
        if (id == null) continue;
        if (m.role === "inner") inners.push(id);
        else outers.push(id);
        if (!ways.has(id)) needExtra.add(id);
      }
      if (!outers.length) return;
      const rel = { outers, inners, kind: areaKind, name: tags.name || tags["name:es"] || "", tags };
      if (areaKind === "building") {
        const t = buildingType(tags);
        rel.a = t;
        rel.h = buildingHeight(tags, t, item.id || 1);
      } else if (areaKind === "land") rel.a = landClass(tags);
      else if (areaKind === "aero") rel.a = tags.aeroway;
      relations.push(rel);
    }
  });
  log("ways tagged", ways.size, "relations", relations.length, "extra member ways", needExtra.size, "places", places.length, "pois", pois.length);

  if (needExtra.size) {
    log("pass 2 member ways");
    await parsePbf((item) => {
      if (item.type !== "way") return;
      const id = num(item.id);
      if (id == null || !needExtra.has(id) || ways.has(id)) return;
      absorbWay(id, item.refs.map(num).filter((n) => n != null), item.tags || {}, true);
    });
    log("ways now", ways.size);
  }

  const needNodes = new Set();
  for (const w of ways.values()) for (const r of w.refs) needNodes.add(r);
  log("need nodes", needNodes.size);

  const coords = new Map();
  log("pass 3 nodes");
  await parsePbf((item) => {
    if (item.type !== "node") return;
    const id = num(item.id);
    if (id == null || !needNodes.has(id)) return;
    coords.set(id, [item.lon, item.lat]);
    needNodes.delete(id);
  });
  log("coords", coords.size, "missing", needNodes.size);

  function lineOf(refs) {
    const out = [];
    for (const id of refs) {
      const c = coords.get(id);
      if (!c) return null;
      const last = out[out.length - 1];
      if (last && last[0] === c[0] && last[1] === c[1]) continue;
      out.push(c);
    }
    return out.length >= 2 ? out : null;
  }

  const ROAD_TOL = [0.000025, 0.00003, 0.000035, 0.000045, 0.00005, 0.00006, 0.00007, 0.00008, 0.00009, 0.0001, 0.00012];

  const roadFeats = [];
  const streetBest = new Map();
  const graphNodes = new Map();
  const graphNodeList = [];
  const edges = [];
  const names = [""];
  const nameId = new Map([["", 0]]);

  function nid(s) {
    if (!s) return 0;
    let id = nameId.get(s);
    if (id == null) {
      id = names.length;
      names.push(s);
      nameId.set(s, id);
    }
    return id;
  }

  function gnode(osmId, pt) {
    let i = graphNodes.get(osmId);
    if (i == null) {
      i = graphNodeList.length;
      graphNodes.set(osmId, i);
      graphNodeList.push(pt);
    }
    return i;
  }

  const degree = new Map();
  for (const w of ways.values()) {
    if (w.kind !== "road" || w.con) continue;
    const seen = new Set();
    for (const r of w.refs) {
      if (seen.has(r)) continue;
      seen.add(r);
      degree.set(r, (degree.get(r) || 0) + 1);
    }
  }

  const CAR_KMH = [90, 75, 58, 48, 38, 34, 28, 18, 16, 14, 5];

  let roadSkip = 0;
  for (const [id, w] of ways) {
    if (w.kind !== "road") continue;
    const line = lineOf(w.refs);
    if (!line) {
      roadSkip++;
      continue;
    }
    const simp = dp(line, ROAD_TOL[w.c] ?? 0.00008);
    if (simp.length < 2) continue;
    const len = lineLen(simp);
    if (len < 8 && !w.name && w.c >= 8) continue;
    const props = { c: w.c, ly: w.ly };
    if (w.name) props.n = w.name;
    if (w.con) props.k = 1;
    roadFeats.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: simp },
      properties: props,
    });
    if (w.name && w.name.length > 1) {
      const prev = streetBest.get(w.name);
      if (!prev || prev.len < len) {
        const g = dp(simp, 0.00015);
        const slim = (g.length > 16 ? g.filter((_, i) => i % Math.ceil(g.length / 16) === 0 || i === g.length - 1) : g).slice(0, 18);
        const mid = slim[Math.floor(slim.length / 2)] || simp[0];
        streetBest.set(w.name, { n: w.name, c: w.c, lat: mid[1], lon: mid[0], len, g: slim });
      }
    }

    if (w.con) continue;
    // graph edges split at junctions
    const refs = w.refs;
    let slice = [0];
    for (let i = 1; i < refs.length; i++) {
      const isJ = i === refs.length - 1 || (degree.get(refs[i]) || 0) >= 2;
      if (!isJ) {
        slice.push(i);
        continue;
      }
      slice.push(i);
      const pts = [];
      let ok = true;
      for (const si of slice) {
        const c = coords.get(refs[si]);
        if (!c) {
          ok = false;
          break;
        }
        pts.push(c);
      }
      if (ok && pts.length >= 2) {
        const meters = lineLen(pts);
        if (meters >= 2) {
          const a = gnode(refs[slice[0]], pts[0]);
          const b = gnode(refs[slice[slice.length - 1]], pts[pts.length - 1]);
          if (a !== b) {
            const nm = nid(w.name);
            const cls = w.c;
            const flagsBase = (w.priv ? 4 : 0) + (w.ly === 1 ? 8 : 0);
            const carOk = !w.noCar;
            const walkOk = !w.noWalk;
            const push = (from, to, geom, dir) => {
              const car = carOk && (w.ow === 0 || w.ow === dir);
              const walk = walkOk;
              if (!car && !walk) return;
              edges.push({
                from,
                to,
                meters: Math.min(65535, Math.round(meters)),
                cls,
                flags: flagsBase + (car ? 1 : 0) + (walk ? 2 : 0),
                nameId: nm,
                geom,
              });
            };
            push(a, b, pts, 1);
            push(b, a, pts.slice().reverse(), -1);
          }
        }
      }
      slice = [i];
    }
    void id;
  }
  log("roads", roadFeats.length, "skip", roadSkip, "graph nodes", graphNodeList.length, "edges", edges.length, "names", names.length);

  // link reverse edges
  const pair = new Map();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const k = e.from < e.to ? `${e.from}|${e.to}|${e.cls}|${e.nameId}` : `${e.to}|${e.from}|${e.cls}|${e.nameId}`;
    const prev = pair.get(k);
    if (prev == null) pair.set(k, i);
    else {
      edges[i].rev = prev;
      edges[prev].rev = i;
      pair.delete(k);
    }
  }
  for (const e of edges) if (e.rev == null) e.rev = -1;

  const buildingFeats = [];
  const landFeats = [];
  const waterFeats = [];
  const wlineFeats = [];
  const railFeats = [];
  const aeroFeats = [];
  const cliffFeats = [];
  const pierFeats = [];
  const islands = [];

  function pushArea(kind, ring, holes, props, poi) {
    const simp = dpRing(ring, kind === "building" ? 0.00002 : 0.00008, kind === "building" ? 12 : kind === "water" ? 80 : 120);
    if (!simp) return;
    const area = areaDeg2(simp);
    if (kind === "building" && (area < 4e-10 || area > 0.002)) return;
    if (kind !== "building" && area < 1.5e-7 && kind !== "island") return;
    const hs = [];
    if (holes) {
      for (const h of holes) {
        const hr = dpRing(h, 0.00008, 60);
        if (hr && areaDeg2(hr) > 1e-8) hs.push(hr);
      }
    }
    const feat = {
      type: "Feature",
      properties: props,
      geometry: { type: "Polygon", coordinates: [simp, ...hs] },
    };
    if (kind === "building") buildingFeats.push(feat);
    else if (kind === "water") waterFeats.push(feat);
    else if (kind === "island") islands.push(feat);
    else if (kind === "aero") aeroFeats.push(feat);
    else landFeats.push(feat);
    if (poi && simp.length) {
      const c = centroid(simp);
      addPoi(c[1], c[0], poi);
    }
  }

  function emitWayArea(w) {
    const line = lineOf(w.refs);
    if (!line || line.length < 4) return;
    const closed = near(line[0], line[line.length - 1], 1e-5) || w.refs[0] === w.refs[w.refs.length - 1];
    if (!closed) return;
    if (!near(line[0], line[line.length - 1], 1e-5)) line.push(line[0]);
    if (w.kind === "building") pushArea("building", line, null, { t: w.a, h: w.h }, null);
    else if (w.kind === "wpoly") pushArea("water", line, null, { n: w.name || undefined }, null);
    else if (w.kind === "land") pushArea("land", line, null, { a: w.a }, null);
    else if (w.kind === "island") pushArea("island", line, null, { n: w.name || "Isla" }, null);
    else if (w.kind === "aero" && (w.a === "apron" || w.a === "aerodrome" || w.a === "terminal"))
      pushArea("aero", line, null, { a: w.a === "runway" ? 1 : 0 }, null);
  }

  const memberUsed = new Set();
  for (const rel of relations) {
    for (const id of rel.outers) memberUsed.add(id);
    for (const id of rel.inners) memberUsed.add(id);
  }

  for (const w of ways.values()) {
    if (w.kind === "building" || w.kind === "wpoly" || w.kind === "land" || w.kind === "island") continue;
    if (w.kind === "aero") {
      const line = lineOf(w.refs);
      if (!line) continue;
      const closed = line.length >= 4 && (near(line[0], line[line.length - 1]) || w.refs[0] === w.refs[w.refs.length - 1]);
      if (closed && (w.a === "apron" || w.a === "aerodrome" || w.a === "terminal")) {
        if (!near(line[0], line[line.length - 1])) line.push(line[0]);
        pushArea("aero", line, null, { a: 0 }, w.name ? { k: "airport", p: 1, name: w.name } : null);
      } else if (w.a === "runway" || w.a === "taxiway") {
        const simp = dp(line, 0.00004);
        aeroFeats.push({
          type: "Feature",
          properties: { a: w.a === "runway" ? 1 : 2 },
          geometry: { type: "LineString", coordinates: simp },
        });
      }
      continue;
    }
    if (w.kind === "rail" || w.kind === "wline" || w.kind === "cliff" || w.kind === "pier" || w.kind === "coast") {
      const line = lineOf(w.refs);
      if (!line) continue;
      const simp = dp(line, 0.00006);
      const feat = {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: simp },
      };
      if (w.kind === "rail") {
        feat.properties.a = w.a;
        railFeats.push(feat);
      } else if (w.kind === "wline") {
        feat.properties.a = w.a;
        if (w.name) feat.properties.n = w.name;
        wlineFeats.push(feat);
      } else if (w.kind === "cliff") cliffFeats.push(feat);
      else if (w.kind === "pier") pierFeats.push(feat);
      else if (w.kind === "coast") {
        const closed = simp.length >= 4 && near(simp[0], simp[simp.length - 1]);
        const area = closed ? areaDeg2(simp[0] === simp[simp.length - 1] ? simp : simp.concat([simp[0]])) : 0;
        if (closed && area > 1e-7 && area < 0.04) {
          const ring = near(simp[0], simp[simp.length - 1]) ? simp : simp.concat([simp[0]]);
          pushArea("island", ring, null, { n: w.name || "Isla" }, null);
        }
      }
      continue;
    }
    if (w.kind === "poi" && w.poi) {
      const line = lineOf(w.refs);
      if (!line) continue;
      const c = centroid(line);
      addPoi(c[1], c[0], w.poi);
    }
  }

  for (const [id, w] of ways) {
    if (memberUsed.has(id) && (w.kind === "land" || w.kind === "wpoly" || w.kind === "building" || w.kind === "island"))
      continue;
    if (w.kind === "building" || w.kind === "wpoly" || w.kind === "land" || w.kind === "island") emitWayArea(w);
  }

  function ringsFrom(ids) {
    const closed = [];
    const open = [];
    for (const id of ids) {
      const w = ways.get(id);
      if (!w) continue;
      const line = lineOf(w.refs);
      if (!line) continue;
      if (line.length >= 4 && (near(line[0], line[line.length - 1]) || w.refs[0] === w.refs[w.refs.length - 1])) {
        if (!near(line[0], line[line.length - 1])) line.push(line[0]);
        closed.push(line);
      } else open.push(line);
    }
    return closed.concat(stitch(open));
  }

  let relOk = 0;
  let relFail = 0;
  for (const rel of relations) {
    const outers = ringsFrom(rel.outers);
    const inners = ringsFrom(rel.inners);
    if (!outers.length) {
      relFail++;
      continue;
    }
    relOk++;
    for (const outer of outers) {
      const holes = inners.filter((h) => h.length && pip(h[Math.floor(h.length / 2)], outer));
      if (rel.kind === "building") pushArea("building", outer, holes, { t: rel.a, h: rel.h }, null);
      else if (rel.kind === "wpoly") pushArea("water", outer, holes, {}, null);
      else if (rel.kind === "island") pushArea("island", outer, holes, { n: rel.name || "Isla" }, null);
      else if (rel.kind === "aero") pushArea("aero", outer, holes, { a: 0 }, null);
      else if (rel.kind === "land") pushArea("land", outer, holes, { a: rel.a }, null);
    }
  }
  log("rel polygons ok", relOk, "fail", relFail);
  let keptB = 0;
  for (let i = 0; i < buildingFeats.length; i++) {
    const f = buildingFeats[i];
    const area = areaDeg2(f.geometry.coordinates[0]);
    if (f.properties.t === 0 && area < 6e-9) continue;
    buildingFeats[keptB++] = f;
  }
  buildingFeats.length = keptB;
  log("buildings kept", keptB);

  // trees from parks and forests
  const trees = [];
  let treeBudget = 9000;
  const hosts = [];
  for (const f of landFeats) {
    const a = f.properties.a;
    if (a !== 4 && a !== 6) continue;
    const ring = f.geometry.coordinates[0];
    const area = areaDeg2(ring);
    if (area < 8e-7 || area > 0.03) continue;
    hosts.push({ ring, park: a === 6, area });
  }
  hosts.sort((a, b) => a.area - b.area);
  for (const h of hosts) {
    if (treeBudget <= 0) break;
    const step = h.park ? 0.00038 : 0.00095;
    const cap = Math.min(treeBudget, h.park ? 36 : 18);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of h.ring) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
    const added = [];
    for (let y = minY + step * 0.5; y < maxY && added.length < cap; y += step) {
      for (let x = minX + step * 0.5; x < maxX && added.length < cap; x += step) {
        const jx = x + Math.sin(x * 1800 + y * 900) * step * 0.28;
        const jy = y + Math.cos(y * 1600 + x * 700) * step * 0.28;
        if (pip([jx, jy], h.ring)) added.push([jx, jy]);
      }
    }
    for (const p of added) {
      trees.push({
        type: "Feature",
        properties: { k: h.park ? 0 : 1 },
        geometry: { type: "Point", coordinates: p },
      });
    }
    treeBudget -= added.length;
  }
  log("trees", trees.length);

  const elev = await demPromise;
  const adm0 = JSON.parse(await readFile(ADM0, "utf8"));
  const landRing = adm0.features[0].geometry.coordinates[0];
  log("coast ring", landRing.length, "elev sample SS", elev(-89.19, 13.7).toFixed(1));
  const coast = classifyCoast(landRing, elev);
  const coastFeats = [];
  for (const [kind, lines] of Object.entries(coast.lines)) {
    const code = kind === "cliff" ? 2 : kind === "beach" ? 1 : 0;
    for (const line of lines) {
      if (line.length < 2) continue;
      coastFeats.push({
        type: "Feature",
        properties: { k: code },
        geometry: { type: "LineString", coordinates: line },
      });
    }
  }
  const wallFeats = coast.walls.map((w) => ({
    type: "Feature",
    properties: { h: w.h },
    geometry: { type: "Polygon", coordinates: [w.poly] },
  }));
  log("coast", coastFeats.length, "walls", wallFeats.length, "osm cliffs", cliffFeats.length, coast.stats);

  // islands + mainland land mask
  const landMask = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { n: "El Salvador" },
        geometry: {
          type: "Polygon",
          coordinates: [landRing.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5])],
        },
      },
      ...islands.map((f) => ({
        type: "Feature",
        properties: { n: f.properties.n || "Isla" },
        geometry: f.geometry,
      })),
    ],
  };

  const adm1 = JSON.parse(await readFile(ADM1, "utf8"));
  const departments = {
    type: "FeatureCollection",
    features: adm1.features.map((f) => {
      const ring0 = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      const simp = dpRing(ring0, 0.0009, 400) || ring0;
      let c = centroid(simp);
      if (!pip(c, simp)) c = centroid(ring0);
      const name = String(f.properties.shapeName || "").replace(/^Departamento de /, "");
      return {
        type: "Feature",
        properties: { n: name, lat: c[1], lon: c[0] },
        geometry: {
          type: "Polygon",
          coordinates: [simp.map((p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5])],
        },
      };
    }),
  };

  ways.clear();
  coords.clear();
  const countRoads = roadFeats.length;
  const countBuildings = buildingFeats.length;
  const countLand = landFeats.length;
  const countWater = waterFeats.length;
  const onlyCover = process.env.ONLY === "cover";
  if (onlyCover) {
    roadFeats.length = 0;
    buildingFeats.length = 0;
    edges.length = 0;
  }
  log("writing vector tiles", onlyCover ? "cover-only" : "full");
  let roadsBuf = null;
  let buildingsBuf = null;
  if (!onlyCover) {
    roadsBuf = tileFeatures([{ name: "roads", features: roadFeats, maxZoom: 14, minZ: 6, tolerance: 1.4 }]);
    buildingsBuf = tileFeatures([{ name: "buildings", features: buildingFeats, maxZoom: 14, minZ: 13, tolerance: 1 }]);
  }
  const coverBuf = tileFeatures([
    { name: "landuse", features: landFeats, maxZoom: 13, minZ: 6, tolerance: 2 },
    { name: "water", features: waterFeats, maxZoom: 13, minZ: 6, tolerance: 1.5 },
    { name: "waterway", features: wlineFeats, maxZoom: 14, minZ: 8, tolerance: 1.6 },
    { name: "rail", features: railFeats, maxZoom: 14, minZ: 8, tolerance: 1.5 },
    { name: "aero", features: aeroFeats, maxZoom: 14, minZ: 8, tolerance: 1.2 },
    { name: "coast", features: coastFeats, maxZoom: 12, minZ: 7, tolerance: 1.5 },
    { name: "walls", features: wallFeats, maxZoom: 13, minZ: 8, tolerance: 1.2 },
    { name: "cliff", features: cliffFeats, maxZoom: 14, minZ: 11, tolerance: 1.5 },
    { name: "pier", features: pierFeats, maxZoom: 14, minZ: 12, tolerance: 1.2 },
  ]);

  await writeFile(path.join(OUT, "cover.svt"), coverBuf);
  log("cover MB", (coverBuf.length / 1e6).toFixed(1));
  if (onlyCover) return;
  await writeFile(path.join(OUT, "roads.svt"), roadsBuf);
  await writeFile(path.join(OUT, "buildings.svt"), buildingsBuf);
  log("svt MB", (roadsBuf.length / 1e6).toFixed(1), (buildingsBuf.length / 1e6).toFixed(1), (coverBuf.length / 1e6).toFixed(1));

  // graph binary
  const coordPairs = [];
  for (const e of edges) {
    e.geomOffset = coordPairs.length / 2;
    const g = e.geom.length > 48 ? dp(e.geom, 0.00012) : e.geom;
    e.geomCount = g.length;
    for (const p of g) coordPairs.push(p[0], p[1]);
  }
  const nameBlobParts = [];
  for (const s of names) {
    const b = Buffer.from(s, "utf8");
    const len = Buffer.alloc(2);
    len.writeUInt16LE(Math.min(65535, b.length));
    nameBlobParts.push(len, b.subarray(0, 65535));
  }
  const nameBlob = Buffer.concat(nameBlobParts);
  const nodeCount = graphNodeList.length;
  const edgeCount = edges.length;
  const coordCount = coordPairs.length / 2;
  const header = 24;
  const bodyNodes = nodeCount * 8;
  const bodyEdges = edgeCount * 24;
  const bodyCoords = coordCount * 8;
  const graph = Buffer.allocUnsafe(header + nameBlob.length + bodyNodes + bodyEdges + bodyCoords);
  graph.write("SVGR", 0);
  graph.writeUInt16LE(1, 4);
  graph.writeUInt16LE(0, 6);
  graph.writeUInt32LE(nodeCount, 8);
  graph.writeUInt32LE(edgeCount, 12);
  graph.writeUInt32LE(names.length, 16);
  graph.writeUInt32LE(coordCount, 20);
  nameBlob.copy(graph, header);
  let o = header + nameBlob.length;
  for (const p of graphNodeList) {
    graph.writeFloatLE(p[1], o);
    graph.writeFloatLE(p[0], o + 4);
    o += 8;
  }
  for (const e of edges) {
    graph.writeUInt32LE(e.from, o);
    graph.writeUInt32LE(e.to, o + 4);
    graph.writeUInt16LE(e.meters, o + 8);
    graph.writeUInt8(e.cls, o + 10);
    graph.writeUInt8(e.flags, o + 11);
    graph.writeUInt16LE(Math.min(65535, e.nameId), o + 12);
    graph.writeUInt16LE(e.geomCount, o + 14);
    graph.writeInt32LE(e.rev, o + 16);
    graph.writeUInt32LE(e.geomOffset, o + 20);
    o += 24;
  }
  for (let i = 0; i < coordPairs.length; i += 2) {
    graph.writeFloatLE(coordPairs[i], o);
    graph.writeFloatLE(coordPairs[i + 1], o + 4);
    o += 8;
  }
  await writeFile(path.join(OUT, "graph.bin"), graph);
  log("graph MB", (graph.length / 1e6).toFixed(2));

  // cap pois by priority
  const caps = { bus: 1800, food: 1600, parking: 600, bank: 700, worship: 900 };
  const grouped = new Map();
  for (const p of pois) {
    const arr = grouped.get(p.k) || [];
    arr.push(p);
    grouped.set(p.k, arr);
  }
  const poisOut = [];
  for (const [k, arr] of grouped) {
    const cap = caps[k] || 4000;
    arr.sort((a, b) => a.p - b.p || a.n.length - b.n.length);
    for (const p of arr.slice(0, cap)) poisOut.push({ n: p.n, k: p.k, lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) });
  }

  places.sort((a, b) => b.pop - a.pop || a.k - b.k);
  const placesOut = places.map((p) => ({
    n: p.n,
    k: p.k,
    lat: +p.lat.toFixed(5),
    lon: +p.lon.toFixed(5),
    pop: p.pop,
  }));

  const streets = [...streetBest.values()]
    .sort((a, b) => b.len - a.len)
    .slice(0, 20000)
    .map((s) => ({
      n: s.n,
      c: s.c,
      lat: +s.lat.toFixed(5),
      lon: +s.lon.toFixed(5),
      g: s.g.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]),
    }));

  const search = { places: placesOut, pois: poisOut, streets };
  await writeFile(path.join(OUT, "search.json"), JSON.stringify(search));
  await writeFile(
    path.join(OUT, "trees.geojson"),
    JSON.stringify({ type: "FeatureCollection", features: trees }),
  );
  await writeFile(path.join(OUT, "land.geojson"), JSON.stringify(landMask));
  await writeFile(path.join(OUT, "departments.geojson"), JSON.stringify(departments));
  try {
    const empty = vtpbf.fromGeojsonVt({ empty: { features: [] } }, { version: 2, extent: 4096 });
    await writeFile(path.join(OUT, "empty.mvt"), empty);
  } catch (err) {
    log("empty mvt failed", err);
  }

  const stats = {
    roads: countRoads,
    buildings: countBuildings,
    land: countLand,
    water: countWater,
    streetsNamed: streets.length,
    places: placesOut.length,
    pois: poisOut.length,
    graphEdges: edgeCount,
    graphNodes: nodeCount,
    trees: trees.length,
    islands: islands.length,
    coastWalls: wallFeats.length,
  };
  const meta = {
    source: "Geofabrik central-america/el-salvador-261003.osm.pbf",
    date: DATA_DATE,
    license: "ODbL © OpenStreetMap contributors",
    elevation: "AWS Terrain Tiles (Mapzen/Terrarium, SRTM)",
    bounds: "geoBoundaries ADM0/ADM1 (CC BY-SA), costa clasificada con el relieve",
    counts: stats,
  };
  await writeFile(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
  log("meta", meta.counts);

  const ss = placesOut.find((p) => p.n === "San Salvador") || { lat: 13.6929, lon: -89.2182, n: "fallback SS" };
  const sa = placesOut.find((p) => p.n === "Santa Ana") || { lat: 13.9942, lon: -89.5597, n: "fallback SA" };
  const snapped = (lat, lon) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < graphNodeList.length; i++) {
      const d = havMeters(graphNodeList[i], [lon, lat]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { i: best, d: bestD };
  };
  const A = snapped(ss.lat, ss.lon);
  const B = snapped(sa.lat, sa.lon);
  log("snap", ss.n, A.d.toFixed(0), "m", sa.n, B.d.toFixed(0), "m");
  const head = new Int32Array(nodeCount).fill(-1);
  const nextE = new Int32Array(edgeCount);
  for (let i = 0; i < edgeCount; i++) {
    nextE[i] = head[edges[i].from];
    head[edges[i].from] = i;
  }
  const KMH = [90, 75, 58, 48, 38, 34, 28, 18, 16, 14, 5];
  const heap = [];
  const pushH = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      const tmp = heap[p];
      heap[p] = heap[i];
      heap[i] = tmp;
      i = p;
    }
  };
  const popH = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        let m = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        const tmp = heap[i];
        heap[i] = heap[m];
        heap[m] = tmp;
        i = m;
      }
    }
    return top;
  };
  pushH([0, 0, A.i]);
  const seen = new Uint8Array(nodeCount);
  const dist = new Float64Array(nodeCount).fill(Infinity);
  dist[A.i] = 0;
  let found = false;
  let iters = 0;
  while (heap.length && iters++ < 800000) {
    const popped = popH();
    if (!popped) break;
    const [, g, node] = popped;
    if (seen[node]) continue;
    seen[node] = 1;
    if (node === B.i) {
      found = true;
      log("route SS→SA", (g / 60).toFixed(1), "min", "iters", iters);
      break;
    }
    for (let e = head[node]; e !== -1; e = nextE[e]) {
      const ed = edges[e];
      if ((ed.flags & 1) === 0) continue;
      const spd = ((KMH[ed.cls] || 30) / 3.6) * (ed.flags & 4 ? 0.4 : 1);
      const ng = g + ed.meters / spd;
      if (ng >= dist[ed.to]) continue;
      dist[ed.to] = ng;
      const heur = havMeters(graphNodeList[ed.to], graphNodeList[B.i]) / 30;
      pushH([ng + heur, ng, ed.to]);
    }
  }
  if (!found) log("ROUTE SMOKE FAILED");
  log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
