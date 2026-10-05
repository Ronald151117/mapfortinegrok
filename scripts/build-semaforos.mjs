/**
 * Traffic signals of El Salvador from OpenStreetMap, for the 3D maps (Visual GPS app and web).
 * Output: public/data/semaforos.json
 *   { fecha, fuente, n, s: [[lon, lat, rumbo, cruce], ...] }
 *   rumbo: direction of travel the signal controls (degrees, 0 = north), taken from the road it sits on;
 *          null when it cannot be known. cruce: 1 = pedestrian crossing signal (crossing=traffic_signals).
 *
 * Two passes over the PBF: signal nodes and the roads through them, then the coordinates of their neighbours.
 * Run: node scripts/build-semaforos.mjs <el-salvador.osm.pbf> [out.json]
 */
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createOsmParser = require("osm-pbf-parser");

const PBF = process.argv[2] || "/tmp/svmap/el-salvador.osm.pbf";
const OUT = process.argv[3] || new URL("../public/data/semaforos.json", import.meta.url).pathname;

// main roads first: the signal faces the biggest road through it
const RANGO = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 6,
  motorway_link: 1, trunk_link: 2, primary_link: 3, secondary_link: 4, tertiary_link: 5, living_street: 7, service: 8, road: 6 };

function leer(onItem) {
  return new Promise((resolve, reject) => {
    const parser = createOsmParser();
    parser.on("data", (items) => { for (const item of items) onItem(item); });
    parser.on("end", resolve);
    parser.on("error", reject);
    createReadStream(PBF).pipe(parser);
  });
}

const rumboEntre = (a, b) => {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};

// ---------- pass 1: signal nodes, and for each the best road through it with its neighbours ----------
const senales = new Map();   // id → { lon, lat, dir, cruce, via: { rango, antes, despues, oneway } }
const faltan = new Set();    // neighbour node ids whose coordinates we need
await leer((item) => {
  if (item.type === "node") {
    const t = item.tags || {};
    const esSemaforo = t.highway === "traffic_signals" || t.crossing === "traffic_signals" || t["crossing:signals"] === "yes";
    if (esSemaforo) {
      senales.set(Number(item.id), {
        lon: +item.lon, lat: +item.lat,
        dir: t["traffic_signals:direction"] || t.direction || null,
        cruce: t.highway !== "traffic_signals" ? 1 : 0, via: null,
      });
    }
    return;
  }
  if (item.type !== "way") return;
  const t = item.tags || {};
  const rango = RANGO[t.highway];
  if (rango == null) return;
  const refs = item.refs.map(Number);   // ids may come as strings
  for (let i = 0; i < refs.length; i++) {
    const s = senales.get(refs[i]);
    if (!s || (s.via && s.via.rango <= rango)) continue;
    s.via = { rango, antes: refs[i - 1] ?? null, despues: refs[i + 1] ?? null, oneway: t.oneway === "yes" || t.oneway === "-1" ? t.oneway : null };
  }
});
for (const s of senales.values()) {
  if (s.via?.antes != null) faltan.add(s.via.antes);
  if (s.via?.despues != null) faltan.add(s.via.despues);
}

// ---------- pass 2: neighbour coordinates ----------
const coords = new Map();
await leer((item) => {
  if (item.type === "node" && faltan.has(Number(item.id))) coords.set(Number(item.id), { lon: +item.lon, lat: +item.lat });
});

// ---------- direction each signal controls ----------
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const salida = [];
for (const s of senales.values()) {
  let rumbo = null;
  const v = s.via;
  if (v) {
    const a = v.antes != null ? coords.get(v.antes) : null, b = v.despues != null ? coords.get(v.despues) : null;
    // forward along the way: from the previous node to the next one (or what exists)
    const adelante = a && b ? rumboEntre(a, b) : a ? rumboEntre(a, s) : b ? rumboEntre(s, b) : null;
    if (adelante != null) {
      const atras = (adelante + 180) % 360;
      if (s.dir === "backward" || v.oneway === "-1") rumbo = atras;
      else if (s.dir === "forward" || v.oneway === "yes") rumbo = adelante;
      else if (/^\d+(\.\d+)?$/.test(s.dir || "")) rumbo = Number(s.dir) % 360;
      else rumbo = adelante;
    }
  }
  salida.push([r6(s.lon), r6(s.lat), rumbo == null ? null : Math.round(rumbo), s.cruce]);
}
salida.sort((p, q) => p[1] - q[1] || p[0] - q[0]);

const fecha = new Date().toISOString().slice(0, 10);
await writeFile(OUT, JSON.stringify({ fecha, fuente: "OpenStreetMap (Geofabrik el-salvador-latest)", n: salida.length, s: salida }));
const conRumbo = salida.filter((s) => s[2] != null).length;
console.log(`semáforos: ${salida.length} (con rumbo ${conRumbo}, de cruce peatonal ${salida.filter((s) => s[3]).length}) → ${OUT}`);
