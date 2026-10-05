import test from "node:test";
import assert from "node:assert/strict";
import { DESTINATIONS, countryView } from "../src/lib/map/destinations.ts";
import { GRID, battleBuildingLayers, battleLayers, battleSources, gridColumns, gridRows } from "../src/lib/map/battle.ts";
import { parseElevationTile } from "../src/lib/map/elevation.ts";
import { baseStyle, buildingLayer, buildingRoofLayer, coverLayers, destinationLayers, labelLayers, reliefLayer, roadLayers } from "../src/lib/map/style.ts";

test("destinations have unique ids and sit inside the battle grid", () => {
  assert.equal(new Set(DESTINATIONS.map((place) => place.id)).size, DESTINATIONS.length);
  const east = GRID.west + GRID.cols * GRID.cell;
  const south = GRID.north - GRID.rows * GRID.cell;
  for (const place of DESTINATIONS) {
    const [lon, lat] = place.coordinates;
    assert.ok(lon > GRID.west && lon < east && lat < GRID.north && lat > south, place.id);
  }
  assert.deepEqual(gridColumns().map((c) => c.label).join(""), "ABCDEFGHIJ");
  assert.deepEqual(gridRows().map((r) => r.label).join(""), "123456");
});

test("every battle layer is prefixed so the screen can swap map modes", () => {
  const ids = [...battleLayers(), ...battleBuildingLayers()].map((layer) => layer.id);
  assert.ok(ids.every((id) => id.startsWith("bt-")));
  assert.equal(new Set(ids).size, ids.length);
});

test("terrain requests accept Salvadoran tiles and reject malformed or foreign tiles", () => {
  assert.deepEqual(parseElevationTile("12/1033/1890"), { z: 12, x: 1033, y: 1890 });
  for (const invalid of ["12/0/0", "15/1033/1890", "12/4096/1890", "12/1033/4096", "12//1890", "12/-1/1890", "12/1.5/1890", "NaN/1/1", "12/1033/1890/extra"]) {
    assert.equal(parseElevationTile(invalid), null, invalid);
  }
});

test("the country overview fits narrow screens within the supported zoom range", () => {
  assert.equal(countryView(1280).zoom, 7.65);
  assert.ok(countryView(390).zoom < countryView(1280).zoom);
  assert.ok(countryView(320).zoom >= 6.2);
});

test("assembled style passes MapLibre's expression and source validation", async (context) => {
  let validateStyleMin;
  try {
    ({ validateStyleMin } = await import("@maplibre/maplibre-gl-style-spec"));
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    context.skip("Install the project's dependencies to run MapLibre validation");
    return;
  }
  const style = baseStyle("https://example.org");
  for (const source of ["roads", "cover", "buildings"]) style.sources[source] = { type: "vector", tiles: [`https://example.org/${source}/{z}/{x}/{y}`] };
  style.sources.destinations = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
  Object.assign(style.sources, battleSources());
  style.layers.push(...coverLayers(), reliefLayer(), ...roadLayers(), buildingLayer(), buildingRoofLayer(), ...labelLayers(), ...destinationLayers());
  style.layers.push(...battleLayers(), ...battleBuildingLayers());
  assert.deepEqual(validateStyleMin(style).map((error) => error.message), []);
});

test("the embeddable El Salvador map builds a valid flat style for other apps", async (context) => {
  let validateStyleMin;
  try {
    ({ validateStyleMin } = await import("@maplibre/maplibre-gl-style-spec"));
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    context.skip("Install the project's dependencies to run MapLibre validation");
    return;
  }
  const { crearMapaSv } = await import("../src/embed/mapa-sv.ts");
  const protocols = [];
  const { style } = crearMapaSv({ base: "https://example.org/", maplibregl: { addProtocol: (name) => protocols.push(name) } });
  assert.deepEqual(protocols, ["svt"]);
  assert.equal(style.glyphs, "https://example.org/fonts/{fontstack}/{range}.pbf");
  assert.ok(style.layers.some((layer) => layer.id === "bt-building"));
  assert.ok(!style.layers.some((layer) => layer.id === "bt-grid"));
  assert.deepEqual(validateStyleMin(style).map((error) => error.message), []);
});

test("Visual web can use plain z/x/y tiles, its own glyphs and add the map under another style", async (context) => {
  let validateStyleMin;
  try {
    ({ validateStyleMin } = await import("@maplibre/maplibre-gl-style-spec"));
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    context.skip("Install the project's dependencies to run MapLibre validation");
    return;
  }
  const { crearMapaSv } = await import("../src/embed/mapa-sv.ts");
  const fuentes = { titulo: ["Noto Sans Bold"], texto: ["Noto Sans Regular"] };
  const sv = crearMapaSv({
    base: "https://visual.example/mapa-sv/a",
    teselas: (capa) => `https://visual.example/mapa-sv/t/${capa}/{z}/{x}/{y}.pbf`,
    glyphs: "https://fonts.example/{fontstack}/{range}.pbf",
    fuentes,
  });
  assert.equal(sv.style["font-faces"], undefined);
  assert.equal(sv.style.sources.roads.tiles[0], "https://visual.example/mapa-sv/t/roads/{z}/{x}/{y}.pbf");
  const fonts = new Set(sv.style.layers.flatMap((layer) => layer.layout?.["text-font"] ?? []));
  assert.deepEqual([...fonts].sort(), ["Noto Sans Bold", "Noto Sans Regular"]);
  assert.deepEqual(validateStyleMin(sv.style).map((error) => error.message), []);

  // a fake map with its own style: everything goes under its first layer, with prefixed sources
  const sources = { basemap: { type: "vector", tiles: ["https://x/{z}/{x}/{y}.pbf"] } };
  const layers = [{ id: "background", type: "background" }, { id: "own", type: "line", source: "basemap", "source-layer": "roads" }];
  const map = {
    on() {}, once() {}, isStyleLoaded: () => true, hasImage: () => true, addImage() {},
    getSource: (id) => sources[id], addSource: (id, s) => { sources[id] = s; }, removeSource: (id) => { delete sources[id]; },
    getLayer: (id) => layers.find((l) => l.id === id), removeLayer: (id) => layers.splice(layers.findIndex((l) => l.id === id), 1),
    addLayer: (layer, before) => layers.splice(before ? layers.findIndex((l) => l.id === before) : layers.length, 0, layer),
  };
  sv.ponerEn(map, { antesDe: "own", fuentes: { titulo: ["Noto Sans Bold"], texto: ["Noto Sans Bold"] } });
  sv.ponerEn(map, { antesDe: "own" });
  assert.equal(layers.at(-1).id, "own");
  assert.equal(layers.filter((l) => l.id === "bt-land").length, 1);
  assert.ok(layers.filter((l) => l.source && l.id !== "own").every((l) => l.source.startsWith("sv-")));
  assert.deepEqual(validateStyleMin({ version: 8, glyphs: "https://x/{fontstack}/{range}.pbf", sources, layers }).map((e) => e.message), []);
  sv.quitarDe(map);
  assert.deepEqual(layers.map((l) => l.id), ["background", "own"]);
  assert.deepEqual(Object.keys(sources), ["basemap"]);
});
