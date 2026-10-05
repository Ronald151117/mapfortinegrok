export type Archive = {
  z: Uint8Array;
  x: Uint16Array;
  y: Uint16Array;
  off: Uint32Array;
  len: Uint32Array;
  data: Uint8Array;
};

export function decodeArchive(buffer: ArrayBuffer): Archive {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "SVT1") throw new Error("archivo de calles inválido");
  const count = view.getUint32(8, true);
  const z = new Uint8Array(count);
  const x = new Uint16Array(count);
  const y = new Uint16Array(count);
  const off = new Uint32Array(count);
  const len = new Uint32Array(count);
  let p = 12;
  for (let i = 0; i < count; i++) {
    z[i] = view.getUint8(p);
    x[i] = view.getUint16(p + 2, true);
    y[i] = view.getUint16(p + 4, true);
    off[i] = view.getUint32(p + 8, true);
    len[i] = view.getUint32(p + 12, true);
    p += 16;
  }
  return { z, x, y, off, len, data: new Uint8Array(buffer) };
}

export type ArchiveIndex = {
  z: Uint8Array;
  x: Uint16Array;
  y: Uint16Array;
  off: Uint32Array;
  len: Uint32Array;
};

export function decodeIndex(buffer: ArrayBuffer): ArchiveIndex {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "SVT1") throw new Error("archivo de calles inválido");
  const count = view.getUint32(8, true);
  const z = new Uint8Array(count);
  const x = new Uint16Array(count);
  const y = new Uint16Array(count);
  const off = new Uint32Array(count);
  const len = new Uint32Array(count);
  let p = 12;
  for (let i = 0; i < count; i++) {
    z[i] = view.getUint8(p);
    x[i] = view.getUint16(p + 2, true);
    y[i] = view.getUint16(p + 4, true);
    off[i] = view.getUint32(p + 8, true);
    len[i] = view.getUint32(p + 12, true);
    p += 16;
  }
  return { z, x, y, off, len };
}

export function lookupTile(index: ArchiveIndex, z: number, x: number, y: number): { off: number; len: number } | null {
  let lo = 0;
  let hi = index.z.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const dz = index.z[mid] - z;
    const dx = dz === 0 ? index.x[mid] - x : 0;
    const dy = dz === 0 && dx === 0 ? index.y[mid] - y : 0;
    const cmp = dz || dx || dy;
    if (cmp === 0) return { off: index.off[mid], len: index.len[mid] };
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export function readTile(archive: Archive, z: number, x: number, y: number): Uint8Array | null {
  const hit = lookupTile(archive, z, x, y);
  if (!hit) return null;
  return archive.data.subarray(hit.off, hit.off + hit.len);
}

export type Graph = {
  lat: Float32Array;
  lon: Float32Array;
  from: Uint32Array;
  to: Uint32Array;
  meters: Uint16Array;
  cls: Uint8Array;
  flags: Uint8Array;
  nameId: Uint16Array;
  geomCount: Uint16Array;
  rev: Int32Array;
  geomOffset: Uint32Array;
  geomLon: Float32Array;
  geomLat: Float32Array;
  names: string[];
  head: Int32Array;
  next: Int32Array;
  grid: Map<number, number[]>;
};

const CELL = 0.035;

export function cellKey(lon: number, lat: number) {
  const gx = Math.floor(lon / CELL);
  const gy = Math.floor(lat / CELL);
  return gy * 100000 + gx;
}

export function decodeGraph(buffer: ArrayBuffer): Graph {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "SVGR") throw new Error("red de calles inválida");
  const nodeCount = view.getUint32(8, true);
  const edgeCount = view.getUint32(12, true);
  const nameCount = view.getUint32(16, true);
  const coordCount = view.getUint32(20, true);
  const names: string[] = [];
  let p = 24;
  const dec = new TextDecoder();
  for (let i = 0; i < nameCount; i++) {
    const len = view.getUint16(p, true);
    p += 2;
    names.push(dec.decode(new Uint8Array(buffer, p, len)));
    p += len;
  }
  const lat = new Float32Array(nodeCount);
  const lon = new Float32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    lat[i] = view.getFloat32(p, true);
    lon[i] = view.getFloat32(p + 4, true);
    p += 8;
  }
  const from = new Uint32Array(edgeCount);
  const to = new Uint32Array(edgeCount);
  const meters = new Uint16Array(edgeCount);
  const cls = new Uint8Array(edgeCount);
  const flags = new Uint8Array(edgeCount);
  const nameId = new Uint16Array(edgeCount);
  const geomCount = new Uint16Array(edgeCount);
  const rev = new Int32Array(edgeCount);
  const geomOffset = new Uint32Array(edgeCount);
  for (let i = 0; i < edgeCount; i++) {
    from[i] = view.getUint32(p, true);
    to[i] = view.getUint32(p + 4, true);
    meters[i] = view.getUint16(p + 8, true);
    cls[i] = view.getUint8(p + 10);
    flags[i] = view.getUint8(p + 11);
    nameId[i] = view.getUint16(p + 12, true);
    geomCount[i] = view.getUint16(p + 14, true);
    rev[i] = view.getInt32(p + 16, true);
    geomOffset[i] = view.getUint32(p + 20, true);
    p += 24;
  }
  const geomLon = new Float32Array(coordCount);
  const geomLat = new Float32Array(coordCount);
  for (let i = 0; i < coordCount; i++) {
    geomLon[i] = view.getFloat32(p, true);
    geomLat[i] = view.getFloat32(p + 4, true);
    p += 8;
  }
  const head = new Int32Array(nodeCount).fill(-1);
  const next = new Int32Array(edgeCount);
  for (let i = 0; i < edgeCount; i++) {
    next[i] = head[from[i]];
    head[from[i]] = i;
  }
  const grid = new Map<number, number[]>();
  for (let i = 0; i < edgeCount; i++) {
    const n = geomCount[i];
    const o = geomOffset[i];
    if (!n) continue;
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = geomLon[o + k];
      const y = geomLat[o + k];
      if (x < minLon) minLon = x;
      if (x > maxLon) maxLon = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    const x0 = Math.floor(minLon / CELL);
    const x1 = Math.floor(maxLon / CELL);
    const y0 = Math.floor(minLat / CELL);
    const y1 = Math.floor(maxLat / CELL);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const key = gy * 100000 + gx;
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push(i);
      }
    }
  }
  return {
    lat,
    lon,
    from,
    to,
    meters,
    cls,
    flags,
    nameId,
    geomCount,
    rev,
    geomOffset,
    geomLon,
    geomLat,
    names,
    head,
    next,
    grid,
  };
}
