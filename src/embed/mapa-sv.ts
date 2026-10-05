// El Salvador flat battle map, packaged for other apps (Visual GPS app and Visual web) that already run MapLibre.
// Built with `npm run build:embed` into dist-embed/mapa-sv.js: no dependencies, the caller passes what it has.
//
//   // reading this site's tile packs in the browser (needs the caller's maplibregl for the svt:// protocol)
//   const sv = crearMapaSv({ base: "https://<this site>", maplibregl });
//   // or plain z/x/y tiles from a server that cuts them out of the packs (no protocol needed)
//   const sv = crearMapaSv({ base: "/mapa-sv/a", teselas: (capa) => `${origin}/mapa-sv/t/${capa}/{z}/{x}/{y}.pbf` });
//
//   const map = new maplibregl.Map({ container, style: sv.style });   // or L.maplibreGL({ style: sv.style })
//   sv.instalar(map);
//   // or underneath the layers of a map that already has its own style (e.g. a 3D tracking map):
//   sv.ponerEn(otherMap, { antesDe: "first-layer-of-that-map", fuentes: { titulo: ["Noto Sans Bold"], texto: ["Noto Sans Bold"] } });

import { BATTLE_BUILDINGS_BEFORE, battleBuildingLayers, battleLayers, battleSources } from "../lib/map/battle.ts";
import { buildBattleArt } from "../lib/map/battle-art.ts";
import { neonLayers } from "../lib/map/neon.ts";
import { createPackReader, fetchMaybeGz, svtHandler } from "../lib/map/packs.ts";

// The public Terrarium tiles allow cross-origin requests, so embeds skip this site's /api/dem proxy.
export const DEM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const DEM_BOUNDS = [-91.3, 12.2, -86.7, 15.4];
const ATTRIBUTION = "© OpenStreetMap · relieve SRTM";
const CAPAS = ["roads", "cover", "buildings"] as const;
const GEOJSON = ["land", "context-land", "departments", "places", "pois", "trees"] as const;
/** Prefix of the sources added by ponerEn, so they never collide with the other map's own sources. */
const PREFIJO = "sv-";

type Collection = { type: "FeatureCollection"; features: unknown[] };
type Names = {
  places: { n: string; k: number; lat: number; lon: number }[];
  pois: { n: string; k: string; lat: number; lon: number }[];
};
type Layer = Record<string, unknown> & { id: string; source?: string; layout?: Record<string, unknown> };

type Maplibre = {
  addProtocol: (name: string, handler: (request: { url: string }) => Promise<{ data: ArrayBuffer }>) => void;
  removeProtocol?: (name: string) => void;
};

type GLMap = {
  on: (event: string, fn: (event: { id?: string }) => void) => unknown;
  off: (event: string, fn: (event: { id?: string }) => void) => unknown;
  getZoom: () => number;
  once: (event: string, fn: () => void) => unknown;
  isStyleLoaded: () => boolean | void;
  getSource: (id: string) => unknown;
  addSource: (id: string, source: unknown) => void;
  removeSource: (id: string) => void;
  getLayer: (id: string) => unknown;
  addLayer: (layer: unknown, before?: string) => void;
  removeLayer: (id: string) => void;
  hasImage: (id: string) => boolean;
  addImage: (id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options?: { pixelRatio?: number }) => void;
};

/** The trees (a 2.4 MB file) are drawn from zoom 12: they are only fetched once the map gets close to that. */
const ARBOLES_DESDE = 11;

/** Font stacks for the labels: `titulo` for place names, `texto` for the rest. */
export type Fuentes = { titulo: string[]; texto: string[] };

const empty = (): Collection => ({ type: "FeatureCollection", features: [] });

function points<T extends { lat: number; lon: number }>(rows: T[], props: (row: T) => Record<string, unknown>): Collection {
  return {
    type: "FeatureCollection",
    features: rows.map((row) => ({ type: "Feature", properties: props(row), geometry: { type: "Point", coordinates: [row.lon, row.lat] } })),
  };
}

export type OpcionesMapaSv = {
  /** Address that serves /data and /fonts (this site, or a server that relays them), without a trailing slash. */
  base: string;
  /** The caller's maplibregl: reads the tile packs in the browser through an svt:// protocol. */
  maplibregl?: Maplibre;
  /** Plain z/x/y vector tile URL for each pack ("roads", "cover", "buildings"): no protocol is registered. */
  teselas?: (capa: (typeof CAPAS)[number]) => string;
  /** Glyph server for maps whose MapLibre cannot load the bundled .ttf fonts (needs `fuentes` it can serve). */
  glyphs?: string;
  fuentes?: Fuentes;
  /** Lettered A–J / 1–6 battle grid lines. Off by default: tracking apps draw their own markers on top. */
  cuadricula?: boolean;
  /** Highest zoom of the relief tiles (hillshade and sea depth), overzoomed past it. Lower = far fewer downloads
   *  (12 instead of 14 asks for 16 times fewer tiles up close): what phones want. Default 14. */
  relieveMax?: number;
  /** "batalla" (default): the painted battle map. "neon": the same map repainted for the night (Neón nocturno). */
  tema?: "batalla" | "neon";
};

function conFuentes(layers: Layer[], fuentes?: Fuentes) {
  if (!fuentes) return layers;
  return layers.map((layer) => {
    const font = layer.layout?.["text-font"] as string[] | undefined;
    if (!font) return layer;
    return { ...layer, layout: { ...layer.layout, "text-font": font[0] === "Lilita One" ? fuentes.titulo : fuentes.texto } };
  });
}

export function crearMapaSv({ base, maplibregl, teselas, glyphs, fuentes, cuadricula = false, relieveMax = 14, tema = "batalla" }: OpcionesMapaSv) {
  const root = base.replace(/\/+$/, "");
  if (!teselas) {
    if (!maplibregl) throw new Error("crearMapaSv: hace falta maplibregl o teselas");
    try {
      maplibregl.removeProtocol?.("svt");
    } catch {
      /* not registered yet */
    }
    maplibregl.addProtocol("svt", svtHandler(createPackReader(root)));
  }
  const tiles = (capa: (typeof CAPAS)[number]) => (teselas ? teselas(capa) : `svt://${capa}/{z}/{x}/{y}`);

  let baseLayers: Layer[] = battleLayers().filter((layer) => cuadricula || layer.id !== "bt-grid") as Layer[];
  baseLayers.splice(baseLayers.findIndex((layer) => layer.id === BATTLE_BUILDINGS_BEFORE), 0, ...(battleBuildingLayers() as Layer[]));
  if (tema === "neon") baseLayers = neonLayers(baseLayers) as Layer[];

  const sources = (): Record<string, unknown> => ({
    roads: { type: "vector", tiles: [tiles("roads")], minzoom: 6, maxzoom: 14, attribution: ATTRIBUTION },
    cover: { type: "vector", tiles: [tiles("cover")], minzoom: 6, maxzoom: 14 },
    buildings: { type: "vector", tiles: [tiles("buildings")], minzoom: 13, maxzoom: 14 },
    hill: { type: "raster-dem", tiles: [DEM_TILES], encoding: "terrarium", tileSize: 256, minzoom: 5, maxzoom: relieveMax, bounds: DEM_BOUNDS },
    ...Object.fromEntries(GEOJSON.map((id) => [id, { type: "geojson", data: empty() }])),
    ...battleSources(),
  });

  const style = {
    version: 8 as const,
    name: tema === "neon" ? "El Salvador · neón nocturno" : "El Salvador · mapa plano",
    glyphs: glyphs ?? `${root}/fonts/{fontstack}/{range}.pbf`,
    ...(glyphs
      ? {}
      : {
          "font-faces": {
            "Lilita One": `${root}/fonts/LilitaOne-Regular.ttf`,
            "Nunito Bold": `${root}/fonts/Nunito-Bold.ttf`,
          },
        }),
    sources: sources(),
    layers: conFuentes(baseLayers, fuentes),
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
  const files: Record<(typeof GEOJSON)[number], () => Promise<Collection>> = {
    land: () => json("/data/land.geojson"),
    "context-land": () => json("/data/context-land.geojson"),
    departments: () => json("/data/departments.geojson"),
    places: () => loadNames().then((n) => points(n.places, (p) => ({ n: p.n, k: p.k }))),
    pois: () => loadNames().then((n) => points(n.pois, (p) => ({ n: p.n, k: p.k }))),
    trees: () => json("/data/trees.geojson"),
  };

  /** Adds the painted textures (now, and again whenever the map asks for one it lost). */
  function ponerArte(map: GLMap) {
    const addArt = (id?: string) => {
      art ??= buildBattleArt();
      for (const [name, img] of Object.entries(art)) {
        if ((!id || id === name) && !map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
      }
    };
    map.on("styleimagemissing", (event) => {
      if (event.id?.startsWith("bt-")) addArt(event.id);
    });
    addArt();
  }

  /** Every source is filled as soon as its own file arrives: the land outline does not wait for the trees. */
  function llenar(map: GLMap, prefijo: string) {
    const cargar = (id: (typeof GEOJSON)[number]) =>
      once(id, files[id])
        .then((value) => {
          const source = map.getSource(prefijo + id) as { setData?: (value: Collection) => void } | undefined;
          source?.setData?.(value);
        })
        .catch((err) => console.error(`Mapa de El Salvador: no se pudo cargar ${id}`, err));
    for (const id of GEOJSON) {
      if (id !== "trees" || map.getZoom() >= ARBOLES_DESDE) {
        cargar(id);
        continue;
      }
      const alAcercar = () => {
        if (map.getZoom() < ARBOLES_DESDE) return;
        map.off("zoomend", alAcercar);
        cargar(id);
      };
      map.on("zoomend", alAcercar);
    }
  }

  /** Adds the painted textures and loads the country data into a map created with `style`. */
  function instalar(map: GLMap) {
    const fill = () => {
      ponerArte(map);
      llenar(map, "");
    };
    // "style.load" comes as soon as the style is parsed; "load" would also wait for slow relief tiles.
    if (map.isStyleLoaded()) fill();
    else map.once("style.load", fill);
  }

  const ajenas = new WeakSet<object>();   // maps that already have the textures listener

  /** Adds the whole flat map underneath `antesDe` in a map that has its own style. Safe to call again. */
  function ponerEn(map: GLMap, { antesDe, fuentes: otras }: { antesDe?: string; fuentes?: Fuentes } = {}) {
    if (map.getLayer("bt-land")) return;
    for (const [id, source] of Object.entries(sources())) if (!map.getSource(PREFIJO + id)) map.addSource(PREFIJO + id, source);
    if (!ajenas.has(map)) {
      ajenas.add(map);
      ponerArte(map);
    } else {
      art ??= buildBattleArt();
      for (const [name, img] of Object.entries(art)) if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
    }
    for (const layer of conFuentes(baseLayers, otras ?? fuentes)) {
      map.addLayer(layer.source ? { ...layer, source: PREFIJO + layer.source } : layer, antesDe);
    }
    llenar(map, PREFIJO);
  }

  /** Removes what ponerEn added. */
  function quitarDe(map: GLMap) {
    for (const layer of baseLayers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    for (const id of Object.keys(sources())) if (map.getSource(PREFIJO + id)) map.removeSource(PREFIJO + id);
  }

  return { style, instalar, ponerEn, quitarDe };
}
