// El Salvador flat battle map, packaged for other apps (e.g. Visual GPS) that already run MapLibre.
// Built with `npm run build:embed` into dist-embed/mapa-sv.js: no dependencies, the caller passes its maplibregl.
//
//   const sv = crearMapaSv({ base: "https://<this site>", maplibregl });
//   const map = new maplibregl.Map({ container, style: sv.style });   // or L.maplibreGL({ style: sv.style })
//   sv.instalar(map);

import { BATTLE_BUILDINGS_BEFORE, battleBuildingLayers, battleLayers, battleSources } from "../lib/map/battle.ts";
import { buildBattleArt } from "../lib/map/battle-art.ts";
import { createPackReader, fetchMaybeGz, svtHandler } from "../lib/map/packs.ts";

// The public Terrarium tiles allow cross-origin requests, so embeds skip this site's /api/dem proxy.
export const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const DEM_BOUNDS = [-91.3, 12.2, -86.7, 15.4];
const ATTRIBUTION = "© OpenStreetMap · relieve SRTM";

type Collection = { type: "FeatureCollection"; features: unknown[] };
type Names = {
  places: { n: string; k: number; lat: number; lon: number }[];
  pois: { n: string; k: string; lat: number; lon: number }[];
};

type Maplibre = {
  addProtocol: (name: string, handler: (request: { url: string }) => Promise<{ data: ArrayBuffer }>) => void;
  removeProtocol?: (name: string) => void;
};

type GLMap = {
  on: (event: string, fn: (event: { id?: string }) => void) => unknown;
  once: (event: string, fn: () => void) => unknown;
  isStyleLoaded: () => boolean | void;
  getSource: (id: string) => unknown;
  hasImage: (id: string) => boolean;
  addImage: (id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options?: { pixelRatio?: number }) => void;
};

const empty = (): Collection => ({ type: "FeatureCollection", features: [] });

function points<T extends { lat: number; lon: number }>(rows: T[], props: (row: T) => Record<string, unknown>): Collection {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({ type: "Feature", properties: props(row), geometry: { type: "Point", coordinates: [row.lon, row.lat] } })),
  };
}

export type OpcionesMapaSv = {
  /** Address of the site that serves /data and /fonts, without a trailing slash. */
  base: string;
  maplibregl: Maplibre;
  /** Lettered A–J / 1–6 battle grid lines. Off by default: tracking apps draw their own markers on top. */
  cuadricula?: boolean;
};

export function crearMapaSv({ base, maplibregl, cuadricula = false }: OpcionesMapaSv) {
  const root = base.replace(/\/+$/, "");
  try {
    maplibregl.removeProtocol?.("svt");
  } catch {
    /* not registered yet */
  }
  maplibregl.addProtocol("svt", svtHandler(createPackReader(root)));

  const layers: Record<string, unknown>[] = battleLayers().filter((layer) => cuadricula || layer.id !== "bt-grid");
  layers.splice(layers.findIndex((layer) => layer.id === BATTLE_BUILDINGS_BEFORE), 0, ...battleBuildingLayers());

  const style = {
    version: 8 as const,
    name: "El Salvador · mapa plano",
    glyphs: `${root}/fonts/{fontstack}/{range}.pbf`,
    "font-faces": {
      "Lilita One": `${root}/fonts/LilitaOne-Regular.ttf`,
      "Nunito Bold": `${root}/fonts/Nunito-Bold.ttf`,
    },
    sources: {
      roads: { type: "vector", tiles: ["svt://roads/{z}/{x}/{y}"], minzoom: 6, maxzoom: 14, attribution: ATTRIBUTION },
      cover: { type: "vector", tiles: ["svt://cover/{z}/{x}/{y}"], minzoom: 6, maxzoom: 14 },
      buildings: { type: "vector", tiles: ["svt://buildings/{z}/{x}/{y}"], minzoom: 13, maxzoom: 14 },
      hill: { type: "raster-dem", tiles: [DEM_TILES], encoding: "terrarium", tileSize: 256, minzoom: 5, maxzoom: 14, bounds: DEM_BOUNDS },
      land: { type: "geojson", data: empty() },
      "context-land": { type: "geojson", data: empty() },
      departments: { type: "geojson", data: empty() },
      places: { type: "geojson", data: empty() },
      pois: { type: "geojson", data: empty() },
      trees: { type: "geojson", data: empty() },
      ...battleSources(),
    },
    layers,
  };

  let art: ReturnType<typeof buildBattleArt> | null = null;
  const json = (path: string) =>
    fetch(root + path).then((r) => {
      if (!r.ok) throw new Error(path);
      return r.json() as Promise<Collection>;
    });
  // Each file is fetched once, on the first map installed, and shared by every map that uses this instance.
  const cache = new Map<string, Promise<Collection>>();
  const once = (id: string, load: () => Promise<Collection>) => {
    if (!cache.has(id)) cache.set(id, load());
    return cache.get(id)!;
  };
  let names: Promise<Names> | null = null;
  const loadNames = () =>
    (names ??= fetchMaybeGz(`${root}/data/search.json.gz`).then((buf) => JSON.parse(new TextDecoder().decode(buf)) as Names));
  const files: [string, () => Promise<Collection>][] = [
    ["land", () => json("/data/land.geojson")],
    ["context-land", () => json("/data/context-land.geojson")],
    ["departments", () => json("/data/departments.geojson")],
    ["places", () => loadNames().then((n) => points(n.places, (p) => ({ n: p.n, k: p.k })))],
    ["pois", () => loadNames().then((n) => points(n.pois, (p) => ({ n: p.n, k: p.k })))],
    ["trees", () => json("/data/trees.geojson")],
  ];

  /** Adds the painted textures and loads the country data into a map created with `style`. */
  function instalar(map: GLMap) {
    const addArt = (id?: string) => {
      art ??= buildBattleArt();
      for (const [name, img] of Object.entries(art)) {
        if ((!id || id === name) && !map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
      }
    };
    map.on("styleimagemissing", (event) => addArt(event.id));
    const fill = () => {
      addArt();
      // Every layer is filled as soon as its own file arrives: the land outline does not wait for the trees.
      for (const [id, load] of files) {
        once(id, load)
          .then((value) => {
            const source = map.getSource(id) as { setData?: (value: Collection) => void } | undefined;
            source?.setData?.(value);
          })
          .catch((err) => console.error(`Mapa de El Salvador: no se pudo cargar ${id}`, err));
      }
    };
    // "style.load" comes as soon as the style is parsed; "load" would also wait for slow relief tiles.
    if (map.isStyleLoaded()) fill();
    else map.once("style.load", fill);
  }

  return { style, instalar };
}
