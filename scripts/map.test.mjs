import test from "node:test";
import assert from "node:assert/strict";
import { DESTINATIONS, countryView, filterDestinations } from "../src/lib/map/destinations.ts";
import { parseElevationTile } from "../src/lib/map/elevation.ts";
import { baseStyle, buildingLayer, buildingRoofLayer, coverLayers, destinationLayers, labelLayers, reliefLayer, roadLayers } from "../src/lib/map/style.ts";

test("destination search combines accents, departments and categories", () => {
  assert.deepEqual(filterDestinations("boqueron").map((place) => place.id), ["el-boqueron"]);
  assert.deepEqual(filterDestinations("  COATEPEQUE  ").map((place) => place.id), ["coatepeque"]);
  assert.deepEqual(filterDestinations("Santa Ana", "lake").map((place) => place.id), ["coatepeque"]);
  assert.equal(filterDestinations("Santa Ana", "coast").length, 0);
  assert.equal(new Set(DESTINATIONS.map((place) => place.id)).size, DESTINATIONS.length);
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
  style.layers.push(...coverLayers(), reliefLayer(), ...roadLayers(), buildingLayer(), buildingRoofLayer(), ...labelLayers(), ...destinationLayers());
  assert.deepEqual(validateStyleMin(style).map((error) => error.message), []);
});
