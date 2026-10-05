#!/usr/bin/env bash
set -euo pipefail

MAP_QA_BROWSER=${MAP_QA_BROWSER:-$(node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())')}
mkdir -p /workspace/screenshots

qa() {
  agent-browser --executable-path "$MAP_QA_BROWSER" --args '--no-sandbox,--use-gl=angle,--use-angle=swiftshader,--enable-unsafe-swiftshader' "$@"
}

for MAP_QA_MODE in dev built; do
  if [ "$MAP_QA_MODE" = dev ]; then MAP_QA_PORT=8080; else MAP_QA_PORT=8081; fi
  export AGENT_BROWSER_SESSION="map-qa-$MAP_QA_MODE"
  qa open "http://127.0.0.1:$MAP_QA_PORT/"
  qa set viewport 1280 800
  qa wait --fn 'document.querySelector(".view-picker .scene-button") && !document.querySelector(".view-picker .scene-button").disabled'
  qa wait 2500
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-desktop.png"
  qa find role button click --name 'Descubre Coatepeque'
  qa wait --text 'Agua entre montañas'
  qa wait 2500
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-coatepeque.png"
  qa find title 'Cambiar a atardecer' click
  qa eval 'if (document.querySelector(".scene-controls > button:last-child").getAttribute("aria-pressed") !== "true") throw new Error("Sunset did not activate"); true'
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-sunset.png"
  qa find title 'Cambiar a luz de día' click
  qa find title 'Elegir vista: 3D, 2D o mapa de batalla' click
  qa find role menuitemradio click --name '2D'
  qa wait --fn 'document.querySelector(".view-picker .scene-button").getAttribute("aria-pressed") === "false"'
  qa find title 'Elegir vista: 3D, 2D o mapa de batalla' click
  qa find role menuitemradio click --name '3D'
  qa wait --fn 'document.querySelector(".view-picker .scene-button").getAttribute("aria-pressed") === "true"'
  qa find title 'Activar o desactivar el relieve' click
  qa find title 'Activar o desactivar el relieve' click
  qa find title 'Mostrar u ocultar árboles' click
  qa find title 'Mostrar u ocultar árboles' click
  qa find role button click --name 'Volver al país'
  qa find title 'Elegir vista: 3D, 2D o mapa de batalla' click
  qa find role menuitemradio click --name 'Mapa de batalla'
  qa wait --fn 'document.querySelector(".battle-ruler-top span") !== null'
  qa eval 'if ([...document.querySelectorAll(".scene-controls > button")].some((b) => !b.disabled)) throw new Error("Relief, trees and light must be disabled on the flat battle map"); true'
  qa wait 2500
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-battle.png"
  qa find role button click --name 'Aterriza en San Salvador'
  qa wait --text 'El corazón de la capital'
  qa wait --fn '(() => { const el = document.querySelector(".map-host"); let fiber = el[Object.keys(el).find(key => key.startsWith("__reactFiber$"))]; while (fiber) { let hook = fiber.memoizedState; while (hook) { const map = hook.memoizedState?.current; if (typeof map?.getSource === "function") return !!map.getSource("buildings") && map.isSourceLoaded("buildings"); hook = hook.next; } fiber = fiber.return; } return false; })()'
  qa wait 1500
  qa eval '(() => { const el = document.querySelector(".map-host"); let fiber = el[Object.keys(el).find(key => key.startsWith("__reactFiber$"))]; while (fiber) { let hook = fiber.memoizedState; while (hook) { const map = hook.memoizedState?.current; if (typeof map?.getSource === "function") { if (map.getPitch() !== 0 || map.getBearing() !== 0) throw new Error("Battle map must stay flat"); return { zoom: map.getZoom(), source: !!map.getSource("buildings"), layer: !!map.getLayer("bt-building"), loaded: map.getSource("buildings") ? map.isSourceLoaded("buildings") : false, sourceCount: map.getSource("buildings") ? map.querySourceFeatures("buildings", { sourceLayer: "buildings" }).length : 0, rendered: map.getLayer("bt-building") ? map.queryRenderedFeatures({ layers: ["bt-building"] }).length : 0 }; } hook = hook.next; } fiber = fiber.return; } return null; })()' > "/workspace/screenshots/$MAP_QA_MODE-building-diagnostic.json"
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-battle-san-salvador.png"
  qa find title 'Elegir vista: 3D, 2D o mapa de batalla' click
  qa find role menuitemradio click --name '3D'
  qa wait --fn 'document.querySelector(".battle-ruler-top") === null && !document.querySelector(".scene-controls > button").disabled'
  qa find role button click --name 'Volver al país'
  # Let the flight and its tile requests finish so reopening the page does not abort them.
  qa wait 5000
  qa set viewport 390 844
  qa open "http://127.0.0.1:$MAP_QA_PORT/"
  qa wait --fn 'document.querySelector(".view-picker .scene-button") && !document.querySelector(".view-picker .scene-button").disabled'
  qa wait 2000
  qa eval 'if (document.documentElement.scrollWidth > window.innerWidth + 1) throw new Error("Horizontal overflow on mobile"); true'
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-mobile.png"
  qa find title 'Elegir vista: 3D, 2D o mapa de batalla' click
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-mobile-views.png"
  qa find role menuitemradio click --name 'Mapa de batalla'
  qa wait 2500
  qa eval 'if (document.documentElement.scrollWidth > window.innerWidth + 1) throw new Error("Horizontal overflow on mobile battle map"); true'
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-mobile-battle.png"
  qa errors --json > "/workspace/screenshots/$MAP_QA_MODE-errors.json"
  qa console --json > "/workspace/screenshots/$MAP_QA_MODE-console.json"
  qa close
done

node --input-type=module <<'JS'
import { readFileSync } from "node:fs";
for (const mode of ["dev", "built"]) {
  const errors = JSON.parse(readFileSync(`/workspace/screenshots/${mode}-errors.json`, "utf8"));
  const consoleLog = JSON.parse(readFileSync(`/workspace/screenshots/${mode}-console.json`, "utf8"));
  const pageErrors = errors.data?.errors ?? [];
  const messages = consoleLog.data?.messages ?? [];
  const consoleErrors = messages.filter((message) => message.type === "error" || message.level === "error");
  if (pageErrors.length || consoleErrors.length) throw new Error(JSON.stringify({ mode, pageErrors, consoleErrors }));
}
JS
