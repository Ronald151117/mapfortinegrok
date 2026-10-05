// "Mapa de batalla": a flat, painted battle-royale reading of the same real
// OpenStreetMap data (coast, land cover, rivers, roads and building footprints).
// Every layer id starts with "bt-" so the screen can swap it with the regular map.

const INK = "#15171d";
const WHITE = "#ffffff";
const DEEP_SEA = "#1f6fc0";
const NEIGHBOUR = "#7f9a80";

function width(stops: number[]) {
  const expr: unknown[] = ["interpolate", ["linear"], ["zoom"]];
  for (let i = 0; i < stops.length; i += 2) expr.push(stops[i], stops[i + 1]);
  return expr;
}

function widen(stops: readonly number[], extra: number) {
  return stops.map((n, i) => (i % 2 ? n + extra : n));
}

/** 10 × 6 grid of 0.25° cells, lettered A–J west to east and numbered 1–6 north to south. */
export const GRID = { west: -90.2, north: 14.5, cell: 0.25, cols: 10, rows: 6 } as const;

export function gridColumns() {
  return Array.from({ length: GRID.cols }, (_, i) => ({
    label: String.fromCharCode(65 + i),
    lon: GRID.west + (i + 0.5) * GRID.cell,
  }));
}

export function gridRows() {
  return Array.from({ length: GRID.rows }, (_, i) => ({ label: String(i + 1), lat: GRID.north - (i + 0.5) * GRID.cell }));
}

function gridData() {
  const east = GRID.west + GRID.cols * GRID.cell;
  const south = GRID.north - GRID.rows * GRID.cell;
  const lines: number[][][] = [];
  for (let i = 0; i <= GRID.cols; i++) {
    const lon = GRID.west + i * GRID.cell;
    lines.push([[lon, GRID.north], [lon, south]]);
  }
  for (let i = 0; i <= GRID.rows; i++) {
    const lat = GRID.north - i * GRID.cell;
    lines.push([[GRID.west, lat], [east, lat]]);
  }
  return {
    type: "FeatureCollection" as const,
    features: lines.map((coordinates) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } })),
  };
}

const WATER_NAMES: { n: string; c: [number, number]; big?: boolean }[] = [
  { n: "Océano Pacífico", c: [-89.25, 13.05], big: true },
  { n: "Golfo de Fonseca", c: [-87.69, 13.19] },
  { n: "Bahía de Jiquilisco", c: [-88.55, 13.215] },
  { n: "Lago de Coatepeque", c: [-89.548, 13.866] },
  { n: "Lago de Ilopango", c: [-89.052, 13.672] },
  { n: "Lago de Güija", c: [-89.53, 14.285] },
  { n: "Cerrón Grande", c: [-88.99, 14.06] },
  { n: "Laguna de Olomega", c: [-88.05, 13.31] },
];

function waterNameData() {
  return {
    type: "FeatureCollection" as const,
    features: WATER_NAMES.map((w) => ({
      type: "Feature" as const,
      properties: { n: w.n, big: w.big ? 1 : 0 },
      geometry: { type: "Point" as const, coordinates: w.c },
    })),
  };
}

export function battleSources() {
  return {
    "bt-grid": { type: "geojson" as const, data: gridData() },
    "bt-water-names": { type: "geojson" as const, data: waterNameData() },
  };
}

const LANDUSE_PATTERN: Record<number, string> = {
  0: "bt-urban",
  3: "bt-farm",
  4: "bt-forest",
  5: "bt-park",
  6: "bt-park",
  7: "bt-sand",
  8: "bt-wetland",
  14: "bt-scrub",
};

const LANDUSE_COLOR: Record<number, string> = {
  1: "#e9c6a2",
  2: "#c9c4bb",
  9: "#dcb987",
  10: "#a9c99a",
  11: "#5fd486",
  12: "#b9b38c",
  13: "#cdb497",
};

// Beach and wetland classes: drawn above the bathymetry; the rest stays under it.
const COASTAL_PATTERN = [7, 8];
const INLAND_PATTERN = Object.keys(LANDUSE_PATTERN).map(Number).filter((k) => !COASTAL_PATTERN.includes(k));

function seaRamp(land: unknown[]) {
  return [
    "interpolate",
    ["linear"],
    ["elevation"],
    -600, DEEP_SEA,
    -120, "#2a86d6",
    -30, "#3aa2e4",
    -6, "#55bdec",
    // Some sea pixels are stored as exactly 0 m, so sea level stays a plain shallow blue.
    0, "#62c6ef",
    ...land,
  ];
}

function matchOn(key: string, table: Record<number, string>, fallback: string) {
  const expr: unknown[] = ["match", ["get", key]];
  for (const [k, v] of Object.entries(table)) expr.push(Number(k), v);
  expr.push(fallback);
  return expr;
}

const ROADS = [
  { id: "arterial", minzoom: 6, filter: ["<=", ["get", "c"], 2], color: "#4b515b", casing: "#f3ead0", w: [6, 1.1, 9, 2.4, 12, 5, 14, 10, 16, 20] },
  { id: "mid", minzoom: 9, filter: ["all", [">=", ["get", "c"], 3], ["<=", ["get", "c"], 4]], color: "#5c626b", casing: "#ebe2c8", w: [9, 0.9, 12, 3, 14, 7, 16, 14] },
  { id: "local", minzoom: 11.5, filter: ["all", [">=", ["get", "c"], 5], ["<=", ["get", "c"], 7]], color: "#757a83", casing: "#e2dac4", w: [11.5, 0.8, 14, 4, 16, 9] },
  { id: "service", minzoom: 13.5, filter: ["==", ["get", "c"], 8], color: "#8b8e94", casing: "#dad3be", w: [13.5, 0.8, 16, 4.5] },
] as const;

function roadLayers() {
  const layers: Record<string, unknown>[] = [];
  const line = { "line-cap": "round", "line-join": "round", "line-sort-key": ["coalesce", ["get", "ly"], 0] };
  layers.push({
    id: "bt-track",
    type: "line",
    source: "roads",
    "source-layer": "roads",
    minzoom: 12,
    filter: ["all", ["==", ["get", "c"], 9], ["!", ["has", "k"]]],
    layout: line,
    paint: { "line-color": "#c49a62", "line-width": width([12, 1, 16, 3.6]), "line-dasharray": [2, 1] },
  });
  layers.push({
    id: "bt-path",
    type: "line",
    source: "roads",
    "source-layer": "roads",
    minzoom: 14.5,
    filter: ["all", ["==", ["get", "c"], 10], ["!", ["has", "k"]]],
    layout: line,
    paint: { "line-color": "#f1e5c4", "line-width": width([14.5, 0.8, 17, 2.2]), "line-dasharray": [1, 1.2] },
  });
  for (const r of [...ROADS].reverse()) {
    const filter = ["all", r.filter, ["!", ["has", "k"]]];
    layers.push({
      id: `bt-case-${r.id}`,
      type: "line",
      source: "roads",
      "source-layer": "roads",
      minzoom: r.minzoom,
      filter,
      layout: line,
      paint: { "line-color": r.casing, "line-width": width(widen(r.w, r.id === "arterial" ? 2.2 : 1.6)) },
    });
  }
  for (const r of [...ROADS].reverse()) {
    layers.push({
      id: `bt-road-${r.id}`,
      type: "line",
      source: "roads",
      "source-layer": "roads",
      minzoom: r.minzoom,
      filter: ["all", r.filter, ["!", ["has", "k"]]],
      layout: line,
      paint: { "line-color": r.color, "line-width": width([...r.w]) },
    });
  }
  layers.push({
    id: "bt-road-center",
    type: "line",
    source: "roads",
    "source-layer": "roads",
    minzoom: 13,
    filter: ["all", ["<=", ["get", "c"], 3], ["!", ["has", "k"]]],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": "#ffd84a", "line-width": width([13, 0.7, 16, 1.8]), "line-dasharray": [3, 3] },
  });
  layers.push({
    id: "bt-road-works",
    type: "line",
    source: "roads",
    "source-layer": "roads",
    minzoom: 12,
    filter: ["==", ["get", "k"], 1],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": "#ff8a3a", "line-width": width([12, 1.4, 16, 5]), "line-dasharray": [1.4, 1] },
  });
  return layers;
}

/** Layers drawn under the roads: sea, land cover, relief and water. */
function groundLayers() {
  return [
    { id: "bt-ocean", type: "background", paint: { "background-color": DEEP_SEA } },
    // Fallback outline for neighbours if the elevation tiles cannot load.
    { id: "bt-context-land", type: "fill", source: "context-land", paint: { "fill-color": NEIGHBOUR } },
    {
      // Bathymetry and relief from the elevation tiles give the real coast of the whole region.
      id: "bt-region",
      type: "color-relief",
      source: "hill",
      paint: { "color-relief-color": seaRamp([0.6, NEIGHBOUR, 1500, "#8fa48c", 3000, "#aab39a"]) },
    },
    { id: "bt-land", type: "fill", source: "land", paint: { "fill-pattern": "bt-grass" } },
    {
      id: "bt-landuse-texture",
      type: "fill",
      source: "cover",
      "source-layer": "landuse",
      filter: ["in", ["get", "a"], ["literal", INLAND_PATTERN]],
      paint: {
        "fill-pattern": matchOn("a", LANDUSE_PATTERN, "bt-grass"),
        "fill-opacity": width([6, 0.8, 10, 1]),
      },
    },
    {
      // Same sea again, above the country outline, which is coarser than the real coast.
      id: "bt-sea",
      type: "color-relief",
      source: "hill",
      paint: { "color-relief-color": seaRamp([0.6, "rgba(98, 198, 239, 0)"]) },
    },
    {
      // Beaches and mangroves sit at sea level, so they are painted over the sea.
      id: "bt-landuse-coastal",
      type: "fill",
      source: "cover",
      "source-layer": "landuse",
      filter: ["in", ["get", "a"], ["literal", COASTAL_PATTERN]],
      paint: {
        "fill-pattern": matchOn("a", LANDUSE_PATTERN, "bt-sand"),
        "fill-opacity": width([6, 0.8, 10, 1]),
      },
    },
    {
      id: "bt-landuse-color",
      type: "fill",
      source: "cover",
      "source-layer": "landuse",
      filter: ["in", ["get", "a"], ["literal", Object.keys(LANDUSE_COLOR).map(Number)]],
      paint: { "fill-color": matchOn("a", LANDUSE_COLOR, "#c9c4bb"), "fill-opacity": width([6, 0.8, 10, 1]) },
    },
    {
      id: "bt-hillshade",
      type: "hillshade",
      source: "hill",
      paint: {
        "hillshade-exaggeration": 0.55,
        "hillshade-shadow-color": "rgba(36, 70, 40, 0.75)",
        "hillshade-highlight-color": "rgba(255, 248, 214, 0.55)",
        "hillshade-accent-color": "rgba(70, 104, 54, 0.6)",
        "hillshade-illumination-direction": 315,
      },
    },
    {
      id: "bt-water",
      type: "fill",
      source: "cover",
      "source-layer": "water",
      paint: { "fill-color": "#3db4ea" },
    },
    {
      id: "bt-water-rim",
      type: "line",
      source: "cover",
      "source-layer": "water",
      paint: { "line-color": "#a9ecff", "line-width": width([8, 0.6, 12, 2, 15, 4]) },
    },
    {
      id: "bt-waterway-case",
      type: "line",
      source: "cover",
      "source-layer": "waterway",
      minzoom: 10,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#a9ecff", "line-width": width([10, 2.6, 13, 5, 16, 13]) },
    },
    {
      id: "bt-waterway",
      type: "line",
      source: "cover",
      "source-layer": "waterway",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#3db4ea", "line-width": width([7, 0.7, 10, 1.4, 13, 3, 16, 9]) },
    },
    {
      id: "bt-aero-fill",
      type: "fill",
      source: "cover",
      "source-layer": "aero",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#cfcbc3" },
    },
    {
      id: "bt-runway",
      type: "line",
      source: "cover",
      "source-layer": "aero",
      filter: ["==", ["geometry-type"], "LineString"],
      minzoom: 10,
      paint: { "line-color": "#4b515b", "line-width": width([10, 1.6, 13, 6, 16, 30]) },
    },
    {
      id: "bt-pier",
      type: "line",
      source: "cover",
      "source-layer": "pier",
      minzoom: 12,
      paint: { "line-color": "#b98a5a", "line-width": width([12, 1.5, 16, 5]) },
    },
    {
      id: "bt-rail",
      type: "line",
      source: "cover",
      "source-layer": "rail",
      minzoom: 10,
      paint: { "line-color": "#7a6c76", "line-width": width([10, 1, 15, 2.6]), "line-dasharray": [2, 1.4] },
    },
  ];
}

/** Trees, grid and every name: painted above the roads and building footprints. */
function topLayers() {
  return [
    {
      id: "bt-tree-shadow",
      type: "circle",
      source: "trees",
      minzoom: 12,
      paint: {
        "circle-color": "#1f5a28",
        "circle-radius": width([12, 1.6, 14, 3.4, 16, 7.5, 17.5, 11]),
        "circle-translate": [1.5, 1.5],
        "circle-opacity": 0.85,
      },
    },
    {
      id: "bt-tree",
      type: "circle",
      source: "trees",
      minzoom: 12,
      paint: {
        "circle-color": ["match", ["get", "k"], 2, "#4fbf5a", 1, "#2f8f46", "#3fa34a"],
        "circle-radius": width([12, 1.4, 14, 3, 16, 6.6, 17.5, 10]),
        "circle-stroke-color": "#1f5a28",
        "circle-stroke-width": width([13, 0, 15, 1]),
      },
    },
    {
      id: "bt-dept-line",
      type: "line",
      source: "departments",
      maxzoom: 10.5,
      paint: { "line-color": WHITE, "line-opacity": 0.35, "line-width": 1.1, "line-dasharray": [3, 2] },
    },
    {
      id: "bt-grid",
      type: "line",
      source: "bt-grid",
      paint: { "line-color": WHITE, "line-opacity": width([6, 0.32, 12, 0.2]), "line-width": width([6, 1, 12, 1.6]) },
    },
    {
      id: "bt-water-names",
      type: "symbol",
      source: "bt-water-names",
      minzoom: 7.2,
      layout: {
        "text-field": ["upcase", ["get", "n"]],
        "text-font": ["Nunito Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 7, ["case", ["==", ["get", "big"], 1], 14, 9], 10, ["case", ["==", ["get", "big"], 1], 22, 12], 13, 16],
        "text-letter-spacing": ["case", ["==", ["get", "big"], 1], 0.6, 0.12],
        "text-max-width": 8,
        "text-padding": 4,
      },
      paint: { "text-color": "#e8fbff", "text-halo-color": "#1d6aa4", "text-halo-width": 1.4 },
    },
    {
      id: "bt-road-label",
      type: "symbol",
      source: "roads",
      "source-layer": "roads",
      minzoom: 12.5,
      filter: ["all", ["has", "n"], ["<=", ["get", "c"], 4]],
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "n"],
        "text-font": ["Nunito Bold"],
        "text-size": width([12.5, 10, 16, 13]),
        "symbol-spacing": 340,
        "text-max-angle": 28,
      },
      paint: { "text-color": WHITE, "text-halo-color": "#3a3f48", "text-halo-width": 1.3 },
    },
    {
      id: "bt-peak",
      type: "symbol",
      source: "pois",
      minzoom: 9.5,
      filter: ["==", ["get", "k"], "peak"],
      layout: {
        "icon-image": "bt-peak",
        "icon-size": width([9.5, 0.32, 13, 0.55]),
        "icon-anchor": "bottom",
        "text-field": ["step", ["zoom"], "", 11.5, ["get", "n"]],
        "text-font": ["Nunito Bold"],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.2],
        "text-optional": true,
      },
      paint: { "text-color": WHITE, "text-halo-color": INK, "text-halo-width": 1.4 },
    },
    {
      id: "bt-volcano",
      type: "symbol",
      source: "pois",
      filter: ["==", ["get", "k"], "volcano"],
      layout: {
        "icon-image": "bt-volcano",
        "icon-size": width([6.5, 0.3, 8, 0.42, 10, 0.6, 13, 0.9]),
        "icon-anchor": "bottom",
        "icon-allow-overlap": false,
        "icon-padding": 0,
        "symbol-sort-key": ["case", ["in", "Volcán", ["get", "n"]], 0, 1],
        "text-field": ["step", ["zoom"], "", 8.8, ["upcase", ["get", "n"]]],
        "text-font": ["Lilita One"],
        "text-size": width([8.8, 10, 13, 15]),
        "text-anchor": "top",
        "text-offset": [0, 0.25],
        "text-letter-spacing": 0.04,
        "text-max-width": 9,
        "text-optional": true,
      },
      paint: { "text-color": "#ffe7c2", "text-halo-color": "#3b1d10", "text-halo-width": 1.8 },
    },
    {
      id: "bt-landmarks",
      type: "symbol",
      source: "pois",
      filter: [
        "any",
        ["all", ["==", ["get", "k"], "airport"], [">=", ["zoom"], 11.5]],
        ["all", ["in", ["get", "k"], ["literal", ["stadium", "university", "sight", "hospital"]]], [">=", ["zoom"], 14]],
        ["all", ["in", ["get", "k"], ["literal", ["market", "civic", "bus_station", "worship", "school", "hotel"]]], [">=", ["zoom"], 15.5]],
      ],
      layout: {
        "text-field": ["upcase", ["get", "n"]],
        "text-font": ["Nunito Bold"],
        "text-size": width([9.5, 10, 16, 12]),
        "text-max-width": 8,
        "text-padding": 3,
        "text-letter-spacing": 0.04,
      },
      paint: { "text-color": "#fff8e8", "text-halo-color": "#20242c", "text-halo-width": 1.6 },
    },
    {
      id: "bt-places",
      type: "symbol",
      source: "places",
      layout: {
        "text-field": [
          "step",
          ["zoom"],
          ["case", ["==", ["get", "k"], 0], ["upcase", ["get", "n"]], ""],
          8.6,
          ["case", ["<=", ["get", "k"], 1], ["upcase", ["get", "n"]], ""],
          11,
          ["case", ["<=", ["get", "k"], 2], ["upcase", ["get", "n"]], ""],
          13,
          ["case", ["<=", ["get", "k"], 4], ["upcase", ["get", "n"]], ""],
          14.5,
          ["upcase", ["get", "n"]],
        ],
        "text-font": ["Lilita One"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          ["match", ["get", "k"], 0, 13, 1, 10, 9],
          10,
          ["match", ["get", "k"], 0, 24, 1, 16, 2, 13, 12],
          14,
          ["match", ["get", "k"], 0, 34, 1, 26, 2, 19, 4, 16, 13],
        ],
        "text-letter-spacing": 0.03,
        "text-max-width": 9,
        "text-padding": 6,
        "symbol-sort-key": ["get", "k"],
      },
      paint: { "text-color": WHITE, "text-halo-color": INK, "text-halo-width": 2.2, "text-halo-blur": 0.4 },
    },
  ];
}

/** All always-present battle layers; building layers are inserted later before `BATTLE_BUILDINGS_BEFORE`. */
export function battleLayers() {
  return [...groundLayers(), ...roadLayers(), ...topLayers()];
}

export const BATTLE_BUILDINGS_BEFORE = "bt-tree-shadow";

/** Building footprints drawn flat, with a painted drop shadow standing in for height. */
export function battleBuildingLayers() {
  return [
    {
      id: "bt-building-shadow",
      type: "fill",
      source: "buildings",
      "source-layer": "buildings",
      minzoom: 13,
      paint: {
        "fill-color": "#1f2a22",
        "fill-opacity": 0.38,
        "fill-translate": ["interpolate", ["linear"], ["zoom"], 13, ["literal", [0.8, 0.8]], 15, ["literal", [2, 2]], 17, ["literal", [5, 5]]],
        "fill-translate-anchor": "viewport",
      },
    },
    {
      id: "bt-building",
      type: "fill",
      source: "buildings",
      "source-layer": "buildings",
      minzoom: 13,
      paint: {
        "fill-color": [
          "match",
          ["get", "t"],
          1, "#f08f7f",
          2, "#b7c4d4",
          3, "#b3b6bb",
          4, "#eed7a6",
          5, "#f7f1e2",
          8, "#f5b44e",
          ["match", ["%", ["to-number", ["get", "h"], 7], 6], 0, "#f6a9bb", 1, "#ffd76a", 2, "#9fdcc0", 3, "#c6b6ee", 4, "#f8b87e", "#a7d3f4"],
        ],
      },
    },
    {
      id: "bt-building-line",
      type: "line",
      source: "buildings",
      "source-layer": "buildings",
      minzoom: 14,
      paint: { "line-color": "#3a3340", "line-opacity": 0.8, "line-width": width([14, 0.3, 16, 0.9, 17.5, 1.5]) },
    },
  ];
}
