import { useEffect, useRef, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { ArrowLeft, ArrowUpRight, Box, Check, ChevronDown, Compass, Globe2, Layers, LoaderCircle, MapPin, Mountain, Sun, Sunset, Swords, Trees, X } from "lucide-react";
import { COUNTRY_VIEW, DESTINATIONS, countryView, type Destination } from "@/lib/map/destinations";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { createPackReader, fetchMaybeGz, svtHandler } from "@/lib/map/packs";
import { contextData, deptData, landData } from "@/lib/map/country";
import { buildIcons } from "@/lib/map/icons";
import { buildBattleArt } from "@/lib/map/battle-art";
import { BATTLE_BUILDINGS_BEFORE, battleBuildingLayers, battleLayers, battleSources, gridColumns, gridRows } from "@/lib/map/battle";
import { baseStyle, buildingLayer, buildingRoofLayer, coverLayers, destinationLayers, labelLayers, reliefLayer, roadLayers } from "@/lib/map/style";

type MLMap = import("maplibre-gl").Map;

const tileBytes = createPackReader();

async function installWorker(maplibregl: typeof import("maplibre-gl")) {
  const [workerRes, sharedRes] = await Promise.all([
    fetch("/vendor/maplibre-gl-worker.mjs"),
    fetch("/vendor/maplibre-gl-shared.mjs"),
  ]);
  if (!workerRes.ok || !sharedRes.ok) throw new Error("worker");
  const [workerSrc, sharedSrc] = await Promise.all([workerRes.text(), sharedRes.text()]);
  const sharedUrl = URL.createObjectURL(new Blob([sharedSrc], { type: "text/javascript" }));
  const rewritten = workerSrc.replace(/from\s*["']\.\/maplibre-gl-shared\.mjs["']/, `from${JSON.stringify(sharedUrl)}`);
  if (rewritten === workerSrc) {
    URL.revokeObjectURL(sharedUrl);
    throw new Error("worker import");
  }
  const workerUrl = URL.createObjectURL(new Blob([rewritten], { type: "text/javascript" }));
  maplibregl.setWorkerUrl(workerUrl);
  return () => {
    URL.revokeObjectURL(workerUrl);
    URL.revokeObjectURL(sharedUrl);
  };
}

type ViewMode = "3d" | "2d" | "battle";

const VIEW_OPTIONS: { mode: ViewMode; label: string; detail: string }[] = [
  { mode: "3d", label: "3D", detail: "Relieve inclinado" },
  { mode: "2d", label: "2D", detail: "Vista desde arriba" },
  { mode: "battle", label: "Mapa de batalla", detail: "Estilo Fortnite · solo plano" },
];

const TREE_LAYERS = ["trees", "trees-close"];
const COUNTRY_BOUNDS: [[number, number], [number, number]] = [[-90.13, 13.15], [-87.68, 14.45]];
const MAP_BOUNDS: [[number, number], [number, number]] = [[-91.3, 12.2], [-86.7, 15.4]];
// Wider limits so a portrait phone can still see the whole country on the flat map.
const BATTLE_BOUNDS: [[number, number], [number, number]] = [[-93, 9.5], [-85, 18]];
const TERRAIN = { source: "dem", exaggeration: 1.25 };
const FLAT_ONLY = "No disponible en el mapa de batalla: es solo plano";

type GridTicks = { cols: { label: string; x: number }[]; rows: { label: string; y: number }[] };

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Like a battle-royale overview: the whole country, flat and north up.
function fitCountryFlat(map: MLMap, duration: number) {
  const narrow = map.getContainer().clientWidth < 700;
  map.fitBounds(COUNTRY_BOUNDS, {
    pitch: 0,
    bearing: 0,
    duration,
    maxZoom: 9,
    padding: narrow ? { top: 90, bottom: 190, left: 26, right: 70 } : { top: 110, bottom: 150, left: 60, right: 110 },
  });
}

function showLayers(map: MLMap, battle: boolean, trees: boolean) {
  for (const layer of map.getStyle().layers) {
    const isBattle = layer.id.startsWith("bt-");
    const visible = battle ? isBattle : !isBattle && (trees || !TREE_LAYERS.includes(layer.id));
    map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
  }
}

function hidden<T extends Record<string, unknown>>(layer: T) {
  return { ...layer, layout: { ...((layer.layout as Record<string, unknown>) ?? {}), visibility: "none" } };
}

export function MapScreen() {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const modeRef = useRef<ViewMode>("3d");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Destination | null>(null);
  const [relief, setRelief] = useState(true);
  const reliefRef = useRef(true);
  const [trees, setTrees] = useState(true);
  const treesRef = useRef(true);
  const [sunset, setSunset] = useState(false);
  const [ticks, setTicks] = useState<GridTicks | null>(null);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const markerFactory = useRef<((place: Destination) => void) | null>(null);
  const battle = viewMode === "battle";

  const flyToPlace = (map: MLMap, place: Destination) => {
    const mode = modeRef.current;
    map.flyTo({
      center: place.coordinates,
      zoom: place.zoom,
      pitch: mode === "3d" ? place.pitch : 0,
      bearing: mode === "battle" ? 0 : place.bearing,
      duration: reducedMotion() ? 0 : 1800,
    });
  };

  const visit = (place: Destination) => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSelected(place);
    markerFactory.current?.(place);
    flyToPlace(map, place);
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSelected(null);
    markerRef.current?.remove();
    markerRef.current = null;
    const mode = modeRef.current;
    if (mode === "battle") {
      fitCountryFlat(map, reducedMotion() ? 0 : 1400);
      return;
    }
    map.flyTo({
      ...countryView(map.getContainer().clientWidth),
      pitch: mode === "3d" ? COUNTRY_VIEW.pitch : 0,
      bearing: COUNTRY_VIEW.bearing,
      duration: reducedMotion() ? 0 : 1400,
    });
  };

  const applyMode = (next: ViewMode) => {
    const map = mapRef.current;
    setViewMenuOpen(false);
    if (!map || !ready) return;
    const wasBattle = modeRef.current === "battle";
    modeRef.current = next;
    setViewMode(next);
    const duration = reducedMotion() ? 0 : 500;
    if (next === "battle") {
      // The battle map is flat only: no terrain, tilt or rotation.
      showLayers(map, true, treesRef.current);
      map.setTerrain(null);
      map.dragRotate.disable();
      map.touchZoomRotate.disableRotation();
      map.touchPitch.disable();
      map.keyboard.disableRotation();
      map.setMaxBounds(BATTLE_BOUNDS);
      if (selected) map.easeTo({ pitch: 0, bearing: 0, duration });
      else fitCountryFlat(map, duration);
      map.once("moveend", () => {
        if (modeRef.current === "battle") map.setMaxPitch(0);
      });
      return;
    }
    if (wasBattle) {
      showLayers(map, false, treesRef.current);
      map.setMaxPitch(75);
      map.setMaxBounds(MAP_BOUNDS);
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.touchPitch.enable();
      map.keyboard.enableRotation();
      map.setTerrain(reliefRef.current ? TERRAIN : null);
      setTicks(null);
    }
    map.easeTo({ pitch: next === "3d" ? 55 : 0, duration });
  };

  useEffect(() => {
    if (!viewMenuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!viewMenuRef.current?.contains(event.target as Node)) setViewMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [viewMenuOpen]);

  // Grid letters and numbers follow the map along the screen edges, like a battle-royale map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !battle) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const mid = map.getCenter();
      setTicks({
        cols: gridColumns()
          .map((c) => ({ label: c.label, x: map.project([c.lon, mid.lat]).x }))
          .filter((c) => c.x > 12 && c.x < w - 12),
        rows: gridRows()
          .map((r) => ({ label: r.label, y: map.project([mid.lng, r.lat]).y }))
          .filter((r) => r.y > 30 && r.y < h - 12),
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    map.on("move", schedule);
    map.on("resize", schedule);
    return () => {
      map.off("move", schedule);
      map.off("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [battle]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let map: MLMap | null = null;
    let releaseWorker: (() => void) | undefined;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (dead || !host.current) return;
      try {
        releaseWorker = await installWorker(maplibregl);
      } catch (err) {
        console.warn(err);
        maplibregl.setWorkerUrl(maplibreWorkerUrl);
      }
      if (dead || !host.current) {
        releaseWorker?.();
        return;
      }
      try {
        maplibregl.removeProtocol("svt");
      } catch {
        /* not registered yet */
      }
      maplibregl.addProtocol("svt", svtHandler(tileBytes));

      map = new maplibregl.Map({
        container: host.current,
        style: baseStyle(window.location.origin, landData, deptData, contextData) as unknown as StyleSpecification,
        ...countryView(host.current.clientWidth),
        maxPitch: 75,
        minZoom: 6.2,
        maxZoom: 17.5,
        maxBounds: MAP_BOUNDS,
        attributionControl: false,
        fadeDuration: 0,
        dragRotate: true,
        pitchWithRotate: true,
        touchPitch: true,
        cooperativeGestures: false,
      });
      mapRef.current = map;
      markerFactory.current = (place) => {
        markerRef.current?.remove();
        const pin = document.createElement("div");
        pin.className = "destination-pin";
        pin.setAttribute("aria-label", place.name);
        markerRef.current = new maplibregl.Marker({ element: pin, anchor: "bottom" }).setLngLat(place.coordinates).addTo(map!);
      };
      map.on("error", (event) => {
        if (dead) return;
        console.warn("No se pudo cargar un recurso del mapa", event.error);
        setNotice("Algunos datos no se pudieron cargar. Puedes seguir explorando o recargar.");
      });
      map.scrollZoom.enable();
      map.dragPan.enable();
      map.dragRotate.enable();
      map.touchZoomRotate.enable();
      map.doubleClickZoom.enable();
      map.keyboard.enable();
      map.boxZoom.enable();
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: "metric" }), "bottom-right");
      map.addControl(
        new maplibregl.AttributionControl({ compact: true, customAttribution: "© OpenStreetMap · SRTM" }),
        "bottom-right",
      );
      map.on("pitchend", () => {
        if (dead || !map || modeRef.current === "battle") return;
        const next = map.getPitch() > 6 ? "3d" : "2d";
        modeRef.current = next;
        setViewMode(next);
      });

      const paintNames = (target: MLMap, search: {
        places: { n: string; k: number; lat: number; lon: number }[];
        pois: { n: string; k: string; lat: number; lon: number }[];
      }) => {
        if (!target.getSource("places")) return;
        (target.getSource("places") as import("maplibre-gl").GeoJSONSource).setData({
          type: "FeatureCollection",
          features: search.places.map((p) => ({
            type: "Feature" as const,
            properties: { n: p.n, k: p.k },
            geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
          })),
        });
        (target.getSource("pois") as import("maplibre-gl").GeoJSONSource).setData({
          type: "FeatureCollection",
          features: search.pois.map((p) => ({
            type: "Feature" as const,
            properties: { n: p.n, k: p.k },
            geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
          })),
        });
      };

      const names = fetchMaybeGz("/data/search.json.gz")
        .then((buf) => JSON.parse(new TextDecoder().decode(buf)) as {
          places: { n: string; k: number; lat: number; lon: number }[];
          pois: { n: string; k: string; lat: number; lon: number }[];
        })
        .catch((err) => {
          console.error(err);
          return null;
        });

      map.on("load", () => {
        if (dead || !map) return;
        try {
          for (const [name, img] of Object.entries(buildIcons())) map.addImage(name, img, { pixelRatio: 2 });
          for (const [name, img] of Object.entries(buildBattleArt())) map.addImage(name, img, { pixelRatio: 2 });
          map.addSource("roads", { type: "vector", tiles: ["svt://roads/{z}/{x}/{y}"], minzoom: 6, maxzoom: 14 });
          for (const layer of roadLayers()) map.addLayer(layer as never);
          map.addSource("cover", { type: "vector", tiles: ["svt://cover/{z}/{x}/{y}"], minzoom: 6, maxzoom: 14 });
          for (const layer of coverLayers()) {
            const under = layer.id === "landuse" || layer.id === "water" || layer.id === "waterway" || layer.id === "coast";
            const before = under && map.getLayer("case-arterial") ? "case-arterial" : undefined;
            map.addLayer(layer as never, before);
          }
          for (const layer of labelLayers()) map.addLayer(layer as never);
          map.moveLayer("dept-line");
          map.moveLayer("dept-label");
          // Relief belongs above land cover, so forests do not hide its shading.
          map.addLayer(reliefLayer() as never, "water");
          map.setTerrain(TERRAIN);
          map.addSource("destinations", {
            type: "geojson",
            data: { type: "FeatureCollection", features: DESTINATIONS.map((place) => ({
              type: "Feature" as const, properties: { id: place.id, name: place.name, kind: place.kind },
              geometry: { type: "Point" as const, coordinates: place.coordinates },
            })) },
          });
          for (const layer of destinationLayers()) map.addLayer(layer as never);
          // The battle map reuses the same real sources and stays hidden until chosen.
          for (const [id, source] of Object.entries(battleSources())) map.addSource(id, source as never);
          for (const layer of battleLayers()) map.addLayer(hidden(layer) as never);
          map.on("click", "destination-points", (event) => {
            const id = event.features?.[0]?.properties?.id;
            const place = DESTINATIONS.find((item) => item.id === id);
            if (!place || !map) return;
            setSelected(place);
            markerFactory.current?.(place);
            flyToPlace(map, place);
          });
          map.on("mouseenter", "destination-points", () => { if (map) map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "destination-points", () => { if (map) map.getCanvas().style.cursor = ""; });
          setReady(true);
          map.resize();
          void names.then((search) => {
            if (!dead && map && search) paintNames(map, search);
          });
          fetch("/data/trees.geojson")
            .then((r) => r.json())
            .then((data) => {
              if (dead || !map?.getSource("trees")) return;
              (map.getSource("trees") as import("maplibre-gl").GeoJSONSource).setData(data);
            })
            .catch((err) => console.error(err));
          const loadNearby = () => {
            if (dead || !map) return;
            if (map.getZoom() >= 12.3 && !map.getSource("buildings")) {
              map.addSource("buildings", {
                type: "vector",
                tiles: ["svt://buildings/{z}/{x}/{y}"],
                minzoom: 13,
                maxzoom: 14,
              });
              const beforeTrees = map.getLayer("trees") ? "trees" : undefined;
              const isBattle = modeRef.current === "battle";
              const regular = [buildingLayer(), buildingRoofLayer()];
              for (const layer of regular) map.addLayer((isBattle ? hidden(layer) : layer) as never, beforeTrees);
              for (const layer of battleBuildingLayers()) map.addLayer((isBattle ? layer : hidden(layer)) as never, BATTLE_BUILDINGS_BEFORE);
            }
          };
          map.on("moveend", loadNearby);
          map.on("zoomend", loadNearby);
          loadNearby();
        } catch (err) {
          console.error(err);
          if (!dead) setFailure("No se pudo preparar el mapa. Recarga para volver a intentarlo.");
        }
      });
    })().catch((error: unknown) => {
      console.error(error);
      if (!dead) setFailure("No se pudo iniciar el mapa 3D. Comprueba que tu navegador permita gráficos WebGL.");
    });

    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => {
      dead = true;
      ro.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      markerFactory.current = null;
      map?.remove();
      releaseWorker?.();
      mapRef.current = null;
    };
  }, []);

  const current = VIEW_OPTIONS.find((option) => option.mode === viewMode) ?? VIEW_OPTIONS[0];

  return (
    <main className={`map-shell relative h-dvh w-full overflow-hidden bg-ocean ${battle ? "is-battle" : ""}`}>
      <div ref={host} className="map-host absolute inset-0 h-full w-full" aria-label="Mapa interactivo de El Salvador" />

      {battle && ticks && <div className="battle-grid" aria-hidden="true">
        <div className="battle-ruler battle-ruler-top">{ticks.cols.map((c) => <span key={c.label} style={{ left: c.x }}>{c.label}</span>)}</div>
        <div className="battle-ruler battle-ruler-left">{ticks.rows.map((r) => <span key={r.label} style={{ top: r.y }}>{r.label}</span>)}</div>
      </div>}

      <header className="atlas-heading">
        <div className="atlas-logo" aria-hidden="true">{battle ? <Swords size={24} strokeWidth={2.5} /> : <Mountain size={26} strokeWidth={2.5} />}</div>
        <div><span className="atlas-kicker">{battle ? "MAPA DE BATALLA · PLANO" : "MAPA INTERACTIVO"}</span><h1>El Salvador<span className="atlas-dot">.</span></h1></div>
      </header>

      {selected && <div className="explore-controls">
        <button className="country-button" onClick={resetView} disabled={!ready} title="Ver todo El Salvador"><Globe2 size={18} /><span>Todo el país</span></button>
      </div>}

      <aside className="scene-controls" aria-label="Controles de la vista">
        <div className="view-picker" ref={viewMenuRef}>
          <button
            disabled={!ready}
            aria-haspopup="menu"
            aria-expanded={viewMenuOpen}
            aria-pressed={viewMode !== "2d"}
            className="scene-button"
            title="Elegir vista: 3D, 2D o mapa de batalla"
            onClick={() => setViewMenuOpen((open) => !open)}
          >
            {battle ? <Swords size={18} /> : <Layers size={18} />}
            <span className="view-current">{battle ? "Batalla" : current.label}<ChevronDown size={11} className={viewMenuOpen ? "turned" : ""} /></span>
          </button>
          {viewMenuOpen && <div className="view-menu" role="menu" aria-label="Vista del mapa">
            {VIEW_OPTIONS.map((option) => <button
              key={option.mode}
              role="menuitemradio"
              aria-checked={viewMode === option.mode}
              className="view-option"
              onClick={() => applyMode(option.mode)}
            >
              <span className={`view-option-icon ${option.mode}`} aria-hidden="true">{option.mode === "battle" ? <Swords size={18} /> : option.mode === "3d" ? <Box size={18} /> : <Layers size={18} />}</span>
              <span className="view-option-copy"><strong>{option.label}</strong><small>{option.detail}</small></span>
              {viewMode === option.mode && <Check size={16} aria-hidden="true" />}
            </button>)}
          </div>}
        </div>
        <button disabled={!ready || battle} aria-pressed={relief && !battle} className="scene-button" title={battle ? FLAT_ONLY : "Activar o desactivar el relieve"} onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          const next = !relief;
          map.setTerrain(next ? TERRAIN : null);
          reliefRef.current = next;
          setRelief(next);
        }}><Mountain size={18} /><span>Relieve</span></button>
        <button disabled={!ready || battle} aria-pressed={trees && !battle} className="scene-button" title={battle ? FLAT_ONLY : "Mostrar u ocultar árboles"} onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          const next = !trees;
          for (const id of TREE_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
          treesRef.current = next;
          setTrees(next);
        }}><Trees size={18} /><span>Árboles</span></button>
        <button disabled={!ready || battle} aria-pressed={sunset && !battle} className="scene-button" title={battle ? FLAT_ONLY : sunset ? "Cambiar a luz de día" : "Cambiar a atardecer"} onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          const next = !sunset;
          map.setLight({ anchor: "viewport", color: next ? "#ffd19a" : "#fff4e0", intensity: next ? 0.55 : 0.42, position: [1.15, next ? 245 : 210, next ? 65 : 38] });
          map.setSky({ "sky-color": next ? "#bda6e2" : "#88d6ee", "horizon-color": next ? "#ffd5a1" : "#fff2d4", "fog-color": next ? "#ecd2c2" : "#c5e6f8", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.62, "fog-ground-blend": 0.22, "atmosphere-blend": 0.45 });
          map.setPaintProperty("ocean", "background-color", next ? "#367f9f" : "#228dbd");
          map.setPaintProperty("water", "fill-color", next ? "#78b6be" : "#43c5dc");
          map.setPaintProperty("hillshade", "hillshade-highlight-color", next ? "#ffe0b0" : "#fff6d4");
          map.setPaintProperty("hillshade", "hillshade-shadow-color", next ? "#665874" : "#315c50");
          map.setPaintProperty("hillshade", "hillshade-accent-color", next ? "#786d5b" : "#608b47");
          setSunset(next);
        }}>{sunset ? <Sunset size={18} /> : <Sun size={18} />}<span>{sunset ? "Tarde" : "Día"}</span></button>
      </aside>

      {selected ? <section className="place-card" aria-label="Destino seleccionado">
        <button className="place-back" onClick={resetView}><ArrowLeft size={15} /> Volver al país</button>
        <div className="place-card-heading"><div><span className="atlas-kicker">{selected.region}</span><h2>{selected.name}</h2></div><span className={`destination-icon ${selected.kind}`} aria-hidden="true"><MapPin size={22} /></span></div>
        <p className="place-tagline">{selected.description}</p><p className="place-detail">{selected.detail}</p>
      </section> : battle ? <div className="map-intro battle-intro"><span className="atlas-kicker">MAPA DE BATALLA · DATOS REALES</span><p>¿Dónde aterrizas?</p><button disabled={!ready} onClick={() => visit(DESTINATIONS[0])}>Aterriza en San Salvador <ArrowUpRight size={16} /></button></div>
        : <div className="map-intro"><span className="atlas-kicker">UN PAÍS. MIL HISTORIAS.</span><p>De los volcanes al Pacífico.</p><button disabled={!ready} onClick={() => visit(DESTINATIONS[2])}>Descubre Coatepeque <ArrowUpRight size={16} /></button></div>}

      <div className="map-hints"><Compass size={15} />{battle
        ? <><span>Arrastra para explorar · Rueda para acercar · Mapa plano, sin giro</span><span className="touch-hint">Arrastra para explorar · Dos dedos para acercar</span></>
        : <><span>Arrastra para explorar · Rueda para acercar · Botón derecho para girar</span><span className="touch-hint">Arrastra para explorar · Dos dedos para acercar y girar</span></>}</div>
      {(!ready || failure) && <div className={`map-status ${failure ? "map-status-error" : ""}`} role="status">
        {failure ? <><MapPin size={22} /><p>{failure}</p><button onClick={() => window.location.reload()}>Reintentar</button></> : <><LoaderCircle className="loading-spin" size={22} /><p>Preparando El Salvador…</p></>}
      </div>}
      {notice && !failure && <div className="map-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={16} /></button></div>}
    </main>
  );
}
