const INK = "#1b2430";
const CREAM = "#fff6e4";
const OCEAN = "#228dbd";
const GRASS = "#92cf64";
const ACCENT = "#ff7a32";

const empty = { type: "FeatureCollection" as const, features: [] as unknown[] };

export function baseStyle(origin: string, land: unknown = empty, departments: unknown = empty, contextLand: unknown = empty) {
  return {
    version: 8 as const,
    name: "Cuzcatlán",
    glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
    "font-faces": {
      "Lilita One": `${origin}/fonts/LilitaOne-Regular.ttf`,
      "Nunito Bold": `${origin}/fonts/Nunito-Bold.ttf`,
    },
    light: { anchor: "viewport", color: "#fff4e0", intensity: 0.42, position: [1.15, 210, 38] },
    sky: {
      "sky-color": "#88d6ee",
      "horizon-color": "#fff2d4",
      "fog-color": "#c5e6f8",
      "sky-horizon-blend": 0.55,
      "horizon-fog-blend": 0.62,
      "fog-ground-blend": 0.22,
      "atmosphere-blend": 0.45,
    },
    sources: {
      dem: {
        type: "raster-dem",
        tiles: [`${origin}/api/dem/{z}/{x}/{y}`],
        encoding: "terrarium",
        tileSize: 256,
        minzoom: 5,
        maxzoom: 14,
        bounds: [-91.3, 12.2, -86.7, 15.4],
        attribution: "Relieve: AWS Terrain Tiles / SRTM",
      },
      hill: {
        type: "raster-dem",
        tiles: [`${origin}/api/dem/{z}/{x}/{y}`],
        encoding: "terrarium",
        tileSize: 256,
        minzoom: 5,
        maxzoom: 14,
        bounds: [-91.3, 12.2, -86.7, 15.4],
      },
      land: { type: "geojson", data: land },
      "context-land": { type: "geojson", data: contextLand },
      departments: { type: "geojson", data: departments },
      places: { type: "geojson", data: empty },
      pois: { type: "geojson", data: empty },
      trees: { type: "geojson", data: empty },
      route: { type: "geojson", data: empty },
      highlight: { type: "geojson", data: empty },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": OCEAN } },
      { id: "context-land", type: "fill", source: "context-land", paint: { "fill-color": "#839e78" } },
      {
        id: "land",
        type: "fill",
        source: "land",
        paint: { "fill-color": GRASS },
      },
      {
        id: "dept-line",
        type: "line",
        source: "departments",
        maxzoom: 11,
        paint: { "line-color": INK, "line-opacity": 0.18, "line-width": 1, "line-dasharray": [2.2, 1.6] },
      },
      {
        id: "dept-label",
        type: "symbol",
        source: "departments",
        maxzoom: 10,
        layout: {
          "text-field": ["get", "n"],
          "text-font": ["Lilita One"],
          "text-size": 15,
          "text-letter-spacing": 0.04,
        },
        paint: { "text-color": CREAM, "text-halo-color": INK, "text-halo-width": 1.4 },
      },
    ],
  };
}

export function reliefLayer() {
  return {
    id: "hillshade",
    type: "hillshade",
    source: "hill",
    paint: {
      "hillshade-exaggeration": 0.38,
      "hillshade-shadow-color": "#315c50",
      "hillshade-highlight-color": "#fff6d4",
      "hillshade-accent-color": "#608b47",
      "hillshade-illumination-direction": 200,
    },
  };
}

const LANDUSE: Record<number, string> = {
  0: "#d5d9b6",
  1: "#f0d48a",
  2: "#d9c2a4",
  3: "#b9cb74",
  4: "#438957",
  5: "#94cc73",
  6: "#74b962",
  7: "#ffe08a",
  8: "#6ec4b4",
  9: "#e7a86a",
  10: "#a8c498",
  11: "#6ed09a",
  12: "#c4b88a",
  13: "#cbb8a4",
  14: "#7eb84e",
};

function matchLanduse() {
  const expr: unknown[] = ["match", ["get", "a"]];
  for (const [k, v] of Object.entries(LANDUSE)) expr.push(Number(k), v);
  expr.push("#8ed56a");
  return expr;
}

function width(stops: number[]) {
  const expr: unknown[] = ["interpolate", ["linear"], ["zoom"]];
  for (let i = 0; i < stops.length; i += 2) expr.push(stops[i], stops[i + 1]);
  return expr;
}

export function coverLayers() {
  return [
    {
      id: "landuse",
      type: "fill",
      source: "cover",
      "source-layer": "landuse",
      paint: { "fill-color": matchLanduse(), "fill-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.55, 12, 0.94] },
    },
    {
      id: "water",
      type: "fill",
      source: "cover",
      "source-layer": "water",
      paint: { "fill-color": "#43c5dc", "fill-opacity": 1 },
    },
    {
      id: "waterway",
      type: "line",
      source: "cover",
      "source-layer": "waterway",
      paint: {
        "line-color": "#49bfd4",
        "line-width": width([8, 0.6, 12, 1.4, 15, 3.2]),
      },
    },
    {
      id: "coast",
      type: "line",
      source: "cover",
      "source-layer": "coast",
      paint: {
        "line-color": ["match", ["get", "k"], 2, "#b08968", 1, "#f3d48a", "#ead9b4"],
        "line-width": width([7, 1.4, 12, 5, 15, 10]),
      },
    },
    {
      id: "cliff-wall",
      type: "fill-extrusion",
      source: "cover",
      "source-layer": "walls",
      minzoom: 9,
      paint: {
        "fill-extrusion-color": "#c4a574",
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.9,
      },
    },
    {
      id: "osm-cliff",
      type: "line",
      source: "cover",
      "source-layer": "cliff",
      minzoom: 12,
      paint: { "line-color": "#8d6b4a", "line-width": width([12, 1.5, 16, 4]), "line-gap-width": 0 },
    },
    {
      id: "rail",
      type: "line",
      source: "cover",
      "source-layer": "rail",
      minzoom: 10,
      paint: { "line-color": "#6a5a68", "line-width": width([10, 0.8, 15, 2]), "line-dasharray": [2, 1.2] },
    },
    {
      id: "aero",
      type: "line",
      source: "cover",
      "source-layer": "aero",
      filter: ["in", ["geometry-type"], ["literal", ["LineString"]]],
      minzoom: 10,
      paint: { "line-color": "#d9d3cb", "line-width": width([10, 1.2, 15, 6]) },
    },
    {
      id: "aero-fill",
      type: "fill",
      source: "cover",
      "source-layer": "aero",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#d5cec4", "fill-opacity": 0.85 },
    },
    {
      id: "pier",
      type: "line",
      source: "cover",
      "source-layer": "pier",
      minzoom: 12,
      paint: { "line-color": "#efe6d4", "line-width": width([12, 1.5, 16, 4]) },
    },
  ];
}

const GROUPS = [
  { id: "arterial", minzoom: 6, filter: ["<=", ["get", "c"], 2], color: "#63717c", w: [6, 0.8, 10, 2.5, 14, 7, 16, 13] },
  { id: "mid", minzoom: 10, filter: ["all", [">=", ["get", "c"], 3], ["<=", ["get", "c"], 4]], color: "#7c8990", w: [10, 1.4, 13, 3.5, 16, 8] },
  { id: "local", minzoom: 12, filter: ["all", [">=", ["get", "c"], 5], ["<=", ["get", "c"], 7]], color: "#dce0d0", w: [12, 1.1, 14, 2.5, 16, 5.5] },
  { id: "service", minzoom: 14, filter: ["all", [">=", ["get", "c"], 8], ["<=", ["get", "c"], 9]], color: "#e8dfc5", w: [14, 0.8, 16, 2.8] },
  { id: "path", minzoom: 15, filter: ["==", ["get", "c"], 10], color: "#e7d8bc", w: [15, 0.8, 17, 2.2], dash: [1.2, 1.1] },
] as const;

export function roadLayers() {
  const layers: Record<string, unknown>[] = [];
  for (const g of GROUPS) {
    const filter = ["all", g.filter, ["!", ["has", "k"]]];
    layers.push({
      id: `case-${g.id}`,
      type: "line",
      source: "roads",
      "source-layer": "roads",
      minzoom: g.minzoom,
      filter,
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["coalesce", ["get", "ly"], 0] },
      paint: { "line-color": "#f9edc9", "line-width": width(g.w.map((n, i) => (i % 2 ? n + 1.6 : n))) },
    });
    layers.push({
      id: `road-${g.id}`,
      type: "line",
      source: "roads",
      "source-layer": "roads",
      minzoom: g.minzoom,
      filter,
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["coalesce", ["get", "ly"], 0] },
      paint: {
        "line-color": g.color,
        "line-width": width([...g.w]),
        ...("dash" in g ? { "line-dasharray": g.dash } : {}),
      },
    });
  }
  layers.push({
    id: "road-works",
    type: "line",
    source: "roads",
    "source-layer": "roads",
    minzoom: 11,
    filter: ["==", ["get", "k"], 1],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": ACCENT, "line-width": width([11, 1.4, 14, 3, 16, 6]), "line-dasharray": [1.4, 1] },
  });
  layers.push({
    id: "road-label-major",
    type: "symbol",
    source: "roads",
    "source-layer": "roads",
    minzoom: 11,
    filter: ["all", ["has", "n"], ["<=", ["get", "c"], 3]],
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "n"],
      "text-font": ["Nunito Bold"],
      "text-size": width([11, 11, 15, 15]),
      "symbol-spacing": 320,
      "text-max-angle": 28,
    },
    paint: { "text-color": CREAM, "text-halo-color": INK, "text-halo-width": 1.3 },
  });
  layers.push({
    id: "road-label-local",
    type: "symbol",
    source: "roads",
    "source-layer": "roads",
    minzoom: 14,
    filter: ["all", ["has", "n"], [">=", ["get", "c"], 4]],
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "n"],
      "text-font": ["Nunito Bold"],
      "text-size": 13,
      "symbol-spacing": 260,
      "text-max-angle": 28,
    },
    paint: { "text-color": CREAM, "text-halo-color": INK, "text-halo-width": 1.2 },
  });
  return layers;
}

export function buildingLayer() {
  return {
    id: "buildings",
    type: "fill-extrusion",
    source: "buildings",
    "source-layer": "buildings",
    minzoom: 13,
    paint: {
      "fill-extrusion-color": [
        "match",
        ["get", "t"],
        1, "#edab93",
        2, "#e9dfc6",
        5, "#b7bfdc",
        8, "#efb850",
        ["match", ["%", ["to-number", ["coalesce", ["get", "h"], 9]], 4], 0, "#f2bd81", 1, "#fff0c2", 2, "#e9b2ad", "#bbd1c3"],
      ],
      // Keep building heights in meters: zoom changes the camera, not the city.
      "fill-extrusion-height": ["max", 3, ["to-number", ["get", "h"], 8]],
      "fill-extrusion-base": 0,
      "fill-extrusion-vertical-gradient": true,
      "fill-extrusion-opacity": 1,
    },
  };
}

export function buildingRoofLayer() {
  const height = ["max", 3, ["to-number", ["get", "h"], 8]];
  return {
    id: "building-roofs",
    type: "fill-extrusion",
    source: "buildings",
    "source-layer": "buildings",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": ["match", ["get", "t"], 2, "#c4ccd0", 5, "#ddd6bc", "#cb8060"],
      "fill-extrusion-base": height,
      "fill-extrusion-height": ["+", height, 0.7],
      "fill-extrusion-opacity": 1,
      "fill-extrusion-vertical-gradient": false,
    },
  };
}

export function destinationLayers() {
  return [
    {
      id: "destination-points",
      type: "circle",
      source: "destinations",
      paint: {
        "circle-color": ["match", ["get", "kind"], "volcano", "#f28b50", "lake", "#43c5dc", "coast", "#f7d85b", "#fff6e4"],
        "circle-radius": width([7, 3.5, 12, 6]),
        "circle-stroke-color": INK,
        "circle-stroke-width": 1.5,
      },
    },
    {
      id: "destination-labels",
      type: "symbol",
      source: "destinations",
      minzoom: 9,
      layout: {
        "text-field": ["get", "name"],
        "text-font": ["Lilita One"],
        "text-size": width([9, 13, 13, 17]),
        "text-anchor": "bottom",
        "text-offset": [0, -0.6],
        "text-optional": true,
      },
      paint: { "text-color": CREAM, "text-halo-color": INK, "text-halo-width": 1.5 },
    },
  ];
}

export function labelLayers() {
  return [
    {
      id: "trees",
      type: "symbol",
      source: "trees",
      minzoom: 12.4,
      maxzoom: 14.5,
      layout: {
        "icon-image": ["match", ["get", "k"], 2, "palm", 1, "pine", "tree"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 12.4, 0.48, 14.5, 0.92],
        "icon-allow-overlap": false,
        "icon-padding": 1,
        "icon-pitch-alignment": "viewport",
        "icon-anchor": "bottom",
      },
    },
    {
      id: "trees-close",
      type: "symbol",
      source: "trees",
      minzoom: 14.5,
      layout: {
        "icon-image": ["match", ["get", "k"], 2, "palm", 1, "pine", "tree"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 14.5, 0.95, 16.8, 1.12],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-pitch-alignment": "viewport",
        "icon-anchor": "bottom",
      },
    },
    {
      id: "pois",
      type: "symbol",
      source: "pois",
      minzoom: 13,
      layout: {
        "icon-image": ["get", "k"],
        "icon-size": 0.72,
        "icon-allow-overlap": false,
        "text-field": ["step", ["zoom"], "", 15, ["get", "n"]],
        "text-font": ["Nunito Bold"],
        "text-size": 11,
        "text-offset": [0, 1.15],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: { "text-color": INK, "text-halo-color": CREAM, "text-halo-width": 1.1 },
    },
    {
      id: "places",
      type: "symbol",
      source: "places",
      layout: {
        "text-field": ["get", "n"],
        "text-font": ["Lilita One"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6,
          ["match", ["get", "k"], 0, 18, 1, 13, 0],
          12,
          ["match", ["get", "k"], 0, 28, 1, 20, 2, 15, 4, 13, 12],
        ],
        "text-allow-overlap": false,
      },
      paint: { "text-color": CREAM, "text-halo-color": INK, "text-halo-width": 1.6 },
    },
    {
      id: "route-case",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": CREAM, "line-width": width([8, 4, 13, 8, 16, 12]) },
    },
    {
      id: "route-line",
      type: "line",
      source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ACCENT, "line-width": width([8, 2.2, 13, 4.5, 16, 7]) },
    },
    {
      id: "highlight",
      type: "line",
      source: "highlight",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff6e4", "line-width": 5, "line-opacity": 0.95 },
    },
  ];
}
