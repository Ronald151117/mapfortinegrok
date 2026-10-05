/**
 * Shrinks the first view of the map:
 * low zooms keep only the roads that are actually drawn,
 * and the routing/search files are stored gzipped.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

const require = createRequire(import.meta.url);
const vtpbf = require("vt-pbf");

function maxClass(z) {
  if (z <= 9) return 2;
  if (z <= 11) return 4;
  return 100;
}

function slimTile(buf, z) {
  const cap = maxClass(z);
  if (cap >= 100) return buf;
  const tile = new VectorTile(new PbfReader(buf));
  const layer = tile.layers.roads;
  if (!layer) return null;
  const kept = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const cls = Number(feature.properties.c);
    if (Number.isFinite(cls) && cls <= cap) kept.push(feature);
  }
  if (!kept.length) return null;
  if (kept.length === layer.length) return buf;
  const wrapped = {
    name: "roads",
    version: 2,
    extent: layer.extent || 4096,
    length: kept.length,
    feature: (i) => kept[i],
  };
  const raw = vtpbf.fromVectorTileJs({ layers: { roads: wrapped } });
  return Buffer.from(raw);
}

function readArchive(path) {
  const data = readFileSync(path);
  if (data.subarray(0, 4).toString() !== "SVT1") throw new Error(path);
  const count = data.readUInt32LE(8);
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 16;
    const z = data.readUInt8(o);
    const x = data.readUInt16LE(o + 2);
    const y = data.readUInt16LE(o + 4);
    const off = data.readUInt32LE(o + 8);
    const len = data.readUInt32LE(o + 12);
    tiles.push({ z, x, y, buf: data.subarray(off, off + len) });
  }
  return tiles;
}

function writeArchive(tiles, path) {
  tiles.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  let payload = 0;
  for (const t of tiles) payload += t.buf.length;
  const header = 12;
  const out = Buffer.allocUnsafe(header + tiles.length * 16 + payload);
  out.write("SVT1", 0);
  out.writeUInt16LE(1, 4);
  out.writeUInt8(0, 6);
  out.writeUInt8(14, 7);
  out.writeUInt32LE(tiles.length, 8);
  let cursor = header + tiles.length * 16;
  tiles.forEach((t, i) => {
    const o = header + i * 16;
    out.writeUInt8(t.z, o);
    out.writeUInt8(0, o + 1);
    out.writeUInt16LE(t.x, o + 2);
    out.writeUInt16LE(t.y, o + 4);
    out.writeUInt16LE(0, o + 6);
    out.writeUInt32LE(cursor, o + 8);
    out.writeUInt32LE(t.buf.length, o + 12);
    t.buf.copy(out, cursor);
    cursor += t.buf.length;
  });
  writeFileSync(path, out);
  return out.length;
}

const src = readArchive("public/data/roads.svt");
const before = new Map();
const slim = [];
for (const tile of src) {
  before.set(tile.z, (before.get(tile.z) || 0) + tile.buf.length);
  const next = slimTile(tile.buf, tile.z);
  if (next && next.length) slim.push({ z: tile.z, x: tile.x, y: tile.y, buf: next });
}
const after = new Map();
for (const tile of slim) after.set(tile.z, (after.get(tile.z) || 0) + tile.buf.length);
const bytes = writeArchive(slim, "public/data/roads.svt");
console.log("roads tiles", src.length, "->", slim.length, "MB", (bytes / 1e6).toFixed(2));
for (const z of [...before.keys()].sort((a, b) => a - b)) {
  console.log(`  z${z} ${(before.get(z) / 1e6).toFixed(2)} -> ${((after.get(z) || 0) / 1e6).toFixed(2)} MB`);
}

function gzipFile(srcPath, destPath) {
  const raw = readFileSync(srcPath);
  const packed = gzipSync(raw, { level: 9 });
  writeFileSync(destPath, packed);
  console.log(destPath, (raw.length / 1e6).toFixed(2), "->", (packed.length / 1e6).toFixed(2), "MB");
}

gzipFile("public/data/graph.bin", "public/data/graph.bin.gz");
gzipFile("public/data/search.json", "public/data/search.json.gz");
unlinkSync("public/data/graph.bin");
unlinkSync("public/data/search.json");
