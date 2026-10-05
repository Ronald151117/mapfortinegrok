// "Neón nocturno": the same El Salvador battle map (same sources, same layer ids) repainted for the night — near-black
// land and sea, roads that glow by class (magenta highways, cyan main roads, blue streets), buildings outlined in violet
// light, rivers in electric cyan and every name with a soft neon halo. Nothing extra is downloaded: only paint changes,
// plus one blurred "glow" line per road class drawn under the roads.

type Layer = Record<string, unknown> & { id: string; paint?: Record<string, unknown>; layout?: Record<string, unknown> };

const zoomRamp = (stops: number[]) => {
  const expr: unknown[] = ["interpolate", ["linear"], ["zoom"]];
  for (let i = 0; i < stops.length; i += 2) expr.push(stops[i], stops[i + 1]);
  return expr;
};
const matchA = (table: Record<number, string>, fallback: string) => {
  const expr: unknown[] = ["match", ["get", "a"]];
  for (const [k, v] of Object.entries(table)) expr.push(Number(k), v);
  expr.push(fallback);
  return expr;
};

const NOCHE = "#04060f";
const TIERRA = "#0a0e1d";
const VECINOS = "#070a16";

// road classes of battle.ts (c: 0–2 arterial, 3–4 mid, 5–7 local, 8 service) and their neon
export const NEON_ROADS = {
  arterial: { color: "#ff3df2", glow: "#ff3df2" },
  mid: { color: "#22e6ff", glow: "#00b7ff" },
  local: { color: "#6f86ff", glow: "#4058ff" },
  service: { color: "#3f4f9e", glow: "#3f4f9e" },
} as const;

function seaRamp(land: unknown[]) {
  return ["interpolate", ["linear"], ["elevation"], -600, "#01040c", -120, "#03091d", -30, "#051331", -6, "#071b44", 0, "#08204f", ...land];
}

const PAINT: Record<string, Record<string, unknown>> = {
  "bt-ocean": { "background-color": "#01040c" },
  "bt-context-land": { "fill-color": VECINOS },
  "bt-region": { "color-relief-color": seaRamp([0.6, VECINOS, 1500, "#0b0f22", 3000, "#10142c"]) },
  "bt-land": { "fill-color": TIERRA },
  "bt-landuse-texture": {
    "fill-color": matchA({ 0: "#11163a", 3: "#0a1a1f", 4: "#052a28", 5: "#063528", 6: "#063528", 7: "#211d14", 8: "#06283a", 14: "#08201f" }, TIERRA),
    "fill-opacity": 0.9,
  },
  "bt-sea": { "color-relief-color": seaRamp([0.6, "rgba(8, 32, 79, 0)"]) },
  "bt-landuse-coastal": { "fill-color": matchA({ 7: "#2a2212", 8: "#06303e" }, TIERRA), "fill-opacity": 0.9 },
  "bt-landuse-color": {
    "fill-color": matchA({ 1: "#1d1435", 2: "#13172c", 9: "#221a14", 10: "#082a22", 11: "#0a3b2b", 12: "#19190f", 13: "#1c1428" }, TIERRA),
    "fill-opacity": 0.9,
  },
  "bt-hillshade": {
    "hillshade-exaggeration": 0.5,
    "hillshade-shadow-color": "rgba(0, 0, 0, 0.65)",
    "hillshade-highlight-color": "rgba(110, 120, 255, 0.16)",
    "hillshade-accent-color": "rgba(60, 0, 110, 0.25)",
    "hillshade-illumination-direction": 315,
  },
  "bt-water": { "fill-color": "#03122e" },
  "bt-water-rim": { "line-color": "#19d3ff", "line-opacity": 0.85, "line-blur": 1.2, "line-width": zoomRamp([8, 0.6, 12, 1.6, 15, 3]) },
  "bt-waterway-case": { "line-color": "#00b4ff", "line-opacity": 0.28, "line-blur": 4, "line-width": zoomRamp([10, 4, 13, 8, 16, 18]) },
  "bt-waterway": { "line-color": "#19d3ff", "line-width": zoomRamp([7, 0.6, 10, 1.1, 13, 2.2, 16, 6]) },
  "bt-aero-fill": { "fill-color": "#11152d" },
  "bt-runway": { "line-color": "#2a3266", "line-width": zoomRamp([10, 1.6, 13, 6, 16, 30]) },
  "bt-pier": { "line-color": "#2c3d82", "line-width": zoomRamp([12, 1.5, 16, 5]) },
  "bt-rail": { "line-color": "#b14dff", "line-width": zoomRamp([10, 1, 15, 2.4]), "line-dasharray": [2, 1.4] },
  "bt-track": { "line-color": "#6b4bb3", "line-width": zoomRamp([12, 0.8, 16, 2.6]), "line-dasharray": [2, 1] },
  "bt-path": { "line-color": "#3b3a74", "line-width": zoomRamp([14.5, 0.8, 17, 2]), "line-dasharray": [1, 1.2] },
  "bt-road-center": { "line-color": "#ffffff", "line-opacity": 0.55, "line-width": zoomRamp([13, 0.5, 16, 1.2]), "line-dasharray": [3, 3] },
  "bt-road-works": { "line-color": "#ff8a3a", "line-width": zoomRamp([12, 1.4, 16, 5]), "line-dasharray": [1.4, 1] },
  "bt-tree-shadow": { "circle-opacity": 0 },
  "bt-tree": {
    "circle-color": ["match", ["get", "k"], 2, "#2bffb0", 1, "#14d38a", "#1ee89b"],
    "circle-opacity": 0.32,
    "circle-blur": 0.7,
    "circle-radius": zoomRamp([12, 1.4, 14, 2.6, 16, 5.5, 17.5, 8]),
    "circle-stroke-width": 0,
  },
  "bt-dept-line": { "line-color": "#b14dff", "line-opacity": 0.55, "line-width": 1.1, "line-dasharray": [3, 2] },
  "bt-grid": { "line-color": "#7c4dff", "line-opacity": zoomRamp([6, 0.35, 12, 0.2]), "line-width": zoomRamp([6, 1, 12, 1.6]) },
  "bt-water-names": { "text-color": "#9ff6ff", "text-halo-color": "#00304f", "text-halo-width": 1.6, "text-halo-blur": 0.8 },
  "bt-road-label": { "text-color": "#d9f6ff", "text-halo-color": "#05060f", "text-halo-width": 1.4 },
  "bt-peak": { "text-color": "#e9e3ff", "text-halo-color": "#1b0b33", "text-halo-width": 1.4, "icon-opacity": 0.75 },
  "bt-volcano": { "text-color": "#ffd6f6", "text-halo-color": "#3a0040", "text-halo-width": 1.8, "text-halo-blur": 0.6, "icon-opacity": 0.85 },
  "bt-landmarks": { "text-color": "#eef0ff", "text-halo-color": "#05060f", "text-halo-width": 1.6 },
  "bt-places": { "text-color": "#ffffff", "text-halo-color": "#ff2bd6", "text-halo-width": 1.4, "text-halo-blur": 1.2 },
  "bt-building-shadow": { "fill-color": "#000000", "fill-opacity": 0.55 },
  "bt-building": {
    "fill-color": ["match", ["get", "t"], 1, "#2a0f2e", 2, "#0f1c3c", 3, "#141833", 4, "#1f1830", 5, "#151a3a", 8, "#2a1a10", "#12173a"],
  },
  "bt-building-line": { "line-color": "#8a6bff", "line-opacity": 0.95, "line-width": zoomRamp([14, 0.4, 16, 1, 17.5, 1.6]) },
};

/** A zoom ramp (["interpolate", …, ["zoom"], z, v, …]) with every value times k; zoom expressions cannot be nested. */
function scaled(expr: unknown, k: number, plus = 0): unknown {
  if (typeof expr === "number") return expr * k + plus;
  if (!Array.isArray(expr) || expr[0] !== "interpolate") return expr;
  return expr.map((v, i) => (i >= 3 && i % 2 === 0 && typeof v === "number" ? v * k + plus : v));
}

const roadId = (id: string) => /^bt-(?:road|case)-(arterial|mid|local|service)$/.exec(id)?.[1] as keyof typeof NEON_ROADS | undefined;

/** The battle layers repainted as "Neón nocturno", with a glow line per road class under the roads. */
export function neonLayers(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  let glowsAdded = false;
  for (const layer of layers) {
    const clase = roadId(layer.id);
    if (clase && layer.id.startsWith("bt-case-") && !glowsAdded) {
      // the glows: one wide blurred line per class, all under the casings
      for (const base of layers) {
        const c = roadId(base.id);
        if (!c || !base.id.startsWith("bt-road-")) continue;
        const width = base.paint?.["line-width"] ?? 2;
        out.push({
          ...base,
          id: `bt-neon-glow-${c}`,
          paint: {
            "line-color": NEON_ROADS[c].glow,
            "line-opacity": c === "service" ? 0.18 : 0.38,
            "line-blur": scaled(width, 0.9),
            "line-width": scaled(width, 3.2),
          },
        });
      }
      glowsAdded = true;
    }
    const paint = PAINT[layer.id];
    if (clase) {
      const isCase = layer.id.startsWith("bt-case-");
      out.push({
        ...layer,
        paint: isCase
          ? { "line-color": NOCHE, "line-width": layer.paint?.["line-width"], "line-opacity": 0.9 }
          : { "line-color": NEON_ROADS[clase].color, "line-width": scaled(layer.paint?.["line-width"] ?? 1, 0.55) },
      });
    } else if (paint) {
      // fills drawn with art in the battle map turn into plain night colours
      const base = { ...(layer.paint || {}) };
      delete base["fill-pattern"];
      out.push({ ...layer, paint: { ...base, ...paint } });
    } else {
      out.push(layer);
    }
  }
  return out;
}
