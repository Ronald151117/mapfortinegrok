/**
 * Split monolithic SVT archives into small zoom packs the browser can GET whole.
 * No HTTP Range: each pack is one file, and fat zooms are cut on tile-x boundaries.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = "public/data/packs";
const MAX_BYTES = 800_000;
const NAMES = ["roads", "cover", "buildings"];

function readArchive(file) {
  const data = readFileSync(file);
  if (data.subarray(0, 4).toString() !== "SVT1") throw new Error(`bad archive ${file}`);
  const count = data.readUInt32LE(8);
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const o = 12 + i * 16;
    const z = data.readUInt8(o);
    const x = data.readUInt16LE(o + 2);
    const y = data.readUInt16LE(o + 4);
    const off = data.readUInt32LE(o + 8);
    const len = data.readUInt32LE(o + 12);
    tiles.push({ z, x, y, buf: Buffer.from(data.subarray(off, off + len)) });
  }
  return tiles;
}

function writeArchive(tiles, file) {
  tiles.sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  const header = 12;
  let payload = 0;
  for (const t of tiles) payload += t.buf.length;
  const out = Buffer.allocUnsafe(header + tiles.length * 16 + payload);
  out.write("SVT1", 0);
  out.writeUInt16LE(1, 4);
  out.writeUInt8(0, 6);
  out.writeUInt8(14, 7);
  out.writeUInt32LE(tiles.length, 8);
  let cursor = header + tiles.length * 16;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
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
  }
  writeFileSync(file, out);
  return out.length;
}

function shardZoom(tiles) {
  const shards = [];
  let cur = [];
  let size = 0;
  for (const t of tiles) {
    const next = size + t.buf.length;
    if (cur.length && next > MAX_BYTES && t.x !== cur[cur.length - 1].x) {
      shards.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += t.buf.length;
  }
  if (cur.length) shards.push(cur);
  return shards;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const index = {};
let files = 0;
let bytes = 0;

for (const name of NAMES) {
  const tiles = readArchive(`public/data/${name}.svt`);
  const byZ = new Map();
  for (const t of tiles) {
    const list = byZ.get(t.z) || [];
    list.push(t);
    byZ.set(t.z, list);
  }
  index[name] = {};
  let written = 0;
  for (const z of [...byZ.keys()].sort((a, b) => a - b)) {
    const group = byZ.get(z);
    const shards = shardZoom(group);
    const parts = [];
    shards.forEach((shard, i) => {
      const suffix = shards.length === 1 ? "" : `-${i}`;
      const filename = `${name}-${z}${suffix}.svt`;
      const file = path.join(OUT, filename);
      const n = writeArchive(shard, file);
      files += 1;
      bytes += n;
      written += shard.length;
      const part = { url: `/data/packs/${filename}` };
      if (shards.length > 1) {
        part.x0 = shard[0].x;
        part.x1 = shard[shard.length - 1].x;
      }
      parts.push(part);
      console.log(`${filename} tiles=${shard.length} ${(n / 1e6).toFixed(2)}MB`);
    });
    index[name][String(z)] = parts;
  }
  if (written !== tiles.length) throw new Error(`${name} lost tiles ${tiles.length} -> ${written}`);
  console.log(name, "tiles", tiles.length, "ok");
}

writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
console.log("files", files, "MB", (bytes / 1e6).toFixed(2));

const sample = JSON.parse(readFileSync(path.join(OUT, "index.json"), "utf8"));
const roads8 = sample.roads["8"]?.[0]?.url;
if (!roads8) throw new Error("missing roads z8");
const check = readFileSync(roads8.replace("/data/packs/", `${OUT}/`));
if (check.subarray(0, 4).toString() !== "SVT1") throw new Error("roundtrip");
console.log("index zooms", Object.keys(sample.roads).join(","));
