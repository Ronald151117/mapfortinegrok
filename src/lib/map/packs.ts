import { decodeArchive, readTile, type Archive } from "./decode.ts";

// Vector tiles ship in a few large pack files (public/data/packs); this reads single tiles out of them.
// `base` is "" on this site, or this site's address when another app embeds the map.

const EMPTY_TILE = Uint8Array.from([
  0x1a, 0x0c, 0x0a, 0x05, 0x65, 0x6d, 0x70, 0x74, 0x79, 0x28, 0x02, 0x78, 0x80, 0x20,
]);

type PackPart = { url: string; x0?: number; x1?: number };
type PackIndex = Record<string, Record<string, PackPart[]>>;

// Leaving the page aborts tile downloads still in flight; those are not errors worth reporting.
let leaving = false;
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    leaving = true;
  });
  window.addEventListener("pageshow", () => {
    leaving = false;
  });
}

function reportTileError(err: unknown) {
  if (!leaving) console.error(err);
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

export function emptyTile() {
  return copyBytes(EMPTY_TILE);
}

export function createPackReader(base = "") {
  const packLoads = new Map<string, Promise<Archive | null>>();
  let packIndexPromise: Promise<PackIndex> | null = null;

  function packIndex() {
    if (!packIndexPromise) {
      const task = fetch(`${base}/data/packs/index.json`).then(async (r) => {
        if (!r.ok) throw new Error("indice");
        return (await r.json()) as PackIndex;
      });
      task.catch(() => {
        if (packIndexPromise === task) packIndexPromise = null;
      });
      packIndexPromise = task;
    }
    return packIndexPromise;
  }

  function loadPack(url: string) {
    const hit = packLoads.get(url);
    if (hit) return hit;
    const task = fetch(base + url)
      .then(async (r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(url);
        return decodeArchive(await r.arrayBuffer());
      })
      .catch((err) => {
        packLoads.delete(url);
        reportTileError(err);
        return null;
      });
    packLoads.set(url, task);
    return task;
  }

  return async function tileBytes(name: string, z: number, x: number, y: number) {
    try {
      const index = await packIndex();
      const parts = index[name]?.[String(z)];
      if (!parts?.length) return emptyTile();
      const part = parts.find((p) => p.x0 == null || (p.x1 != null && x >= p.x0 && x <= p.x1));
      if (!part) return emptyTile();
      const archive = await loadPack(part.url);
      if (!archive) return emptyTile();
      const bytes = readTile(archive, z, x, y);
      return bytes ? copyBytes(bytes) : emptyTile();
    } catch (err) {
      reportTileError(err);
      return emptyTile();
    }
  };
}

export async function fetchMaybeGz(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return buf;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/** `svt://<pack>/<z>/<x>/<y>` URLs, as used by the map styles' vector sources. */
export function svtHandler(tileBytes: ReturnType<typeof createPackReader>) {
  return async (request: { url: string }) => {
    const m = request.url.match(/svt:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) return { data: emptyTile() };
    return { data: await tileBytes(m[1], Number(m[2]), Number(m[3]), Number(m[4])) };
  };
}
