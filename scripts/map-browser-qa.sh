#!/usr/bin/env bash
set -euo pipefail

MAP_QA_BROWSER=$(node --input-type=module -e 'import { chromium } from "playwright"; console.log(chromium.executablePath())')
mkdir -p /workspace/screenshots

qa() {
  agent-browser --executable-path "$MAP_QA_BROWSER" --args '--no-sandbox,--use-gl=angle,--use-angle=swiftshader,--enable-unsafe-swiftshader' "$@"
}

for MAP_QA_MODE in dev built; do
  if [ "$MAP_QA_MODE" = dev ]; then MAP_QA_PORT=8080; else MAP_QA_PORT=8081; fi
  export AGENT_BROWSER_SESSION="map-qa-$MAP_QA_MODE"
  qa open "http://127.0.0.1:$MAP_QA_PORT/"
  qa set viewport 1280 800
  qa wait --fn 'document.querySelector(".scene-button") && !document.querySelector(".scene-button").disabled'
  qa wait 2500
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-desktop.png"
  qa find role button click --name 'Explorar lugares'
  qa find label 'Buscar destino' fill 'coatepeque'
  qa eval 'if (document.querySelectorAll(".destination-item").length !== 1) throw new Error("Search did not narrow the destinations"); true'
  qa find role button click --name 'Lago de Coatepeque'
  qa wait --text 'Agua entre montañas'
  qa wait 2500
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-coatepeque.png"
  qa find title 'Cambiar a atardecer' click
  qa eval 'if (document.querySelector(".scene-controls button:last-child").getAttribute("aria-pressed") !== "true") throw new Error("Sunset did not activate"); true'
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-sunset.png"
  qa find title 'Cambiar a luz de día' click
  qa find title 'Cambiar a vista 2D' click
  qa wait --fn 'document.querySelector(".scene-controls button").getAttribute("aria-pressed") === "false"'
  qa find title 'Cambiar a vista 3D' click
  qa wait --fn 'document.querySelector(".scene-controls button").getAttribute("aria-pressed") === "true"'
  qa find title 'Activar o desactivar el relieve' click
  qa find title 'Activar o desactivar el relieve' click
  qa find title 'Mostrar u ocultar árboles' click
  qa find title 'Mostrar u ocultar árboles' click
  qa find role button click --name 'Volver al país'
  qa find role button click --name 'Explorar lugares'
  qa find label 'Buscar destino' fill 'san salvador'
  qa find first '.destination-item' click
  qa wait --text 'El corazón de la capital'
  qa wait 4000
  qa eval '(() => { const el = document.querySelector(".map-host"); let fiber = el[Object.keys(el).find(key => key.startsWith("__reactFiber$"))]; while (fiber) { let hook = fiber.memoizedState; while (hook) { const map = hook.memoizedState?.current; if (typeof map?.getSource === "function") return { zoom: map.getZoom(), source: !!map.getSource("buildings"), layer: !!map.getLayer("buildings"), loaded: map.getSource("buildings") ? map.isSourceLoaded("buildings") : false, sourceCount: map.getSource("buildings") ? map.querySourceFeatures("buildings", { sourceLayer: "buildings" }).length : 0, rendered: map.getLayer("buildings") ? map.queryRenderedFeatures({ layers: ["buildings"] }).length : 0 }; hook = hook.next; } fiber = fiber.return; } return null; })()' > "/workspace/screenshots/$MAP_QA_MODE-building-diagnostic.json"
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-san-salvador.png"
  qa find role button click --name 'Volver al país'
  qa set viewport 390 844
  qa open "http://127.0.0.1:$MAP_QA_PORT/"
  qa wait --fn 'document.querySelector(".scene-button") && !document.querySelector(".scene-button").disabled'
  qa wait 2000
  qa eval 'if (document.documentElement.scrollWidth > window.innerWidth + 1) throw new Error("Horizontal overflow on mobile"); true'
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-mobile.png"
  qa find role button click --name 'Explorar lugares'
  qa find label 'Buscar destino' fill ''
  qa screenshot "/workspace/screenshots/$MAP_QA_MODE-mobile-explorer.png"
  qa find role button click --name 'Cerrar explorador'
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
