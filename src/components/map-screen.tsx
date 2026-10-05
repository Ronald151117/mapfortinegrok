import { useEffect, useRef, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import { ArrowLeft, ArrowUpRight, Building2, ChevronDown, Compass, Globe2, Layers, LoaderCircle, MapPin, Mountain, Search, Sun, Sunset, Trees, Waves, X } from "lucide-react";
import { COUNTRY_VIEW, DESTINATIONS, KIND_LABEL, filterDestinations, type Destination, type DestinationKind } from "@/lib/map/destinations";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { decodeArchive, readTile, type Archive } from "@/lib/map/decode";
import { deptData, landData } from "@/lib/map/country";
import { buildIcons } from "@/lib/map/icons";
import { baseStyle, buildingLayer, buildingRoofLayer, coverLayers, destinationLayers, labelLayers, reliefLayer, roadLayers } from "@/lib/map/style";

type MLMap = import("maplibre-gl").Map;

const EMPTY_TILE = Uint8Array.from([
  0x1a, 0x0c, 0x0a, 0x05, 0x65, 0x6d, 0x70, 0x74, 0x79, 0x28, 0x02, 0x78, 0x80, 0x20,
]);

type PackPart = { url: string; x0?: number; x1?: number };
type PackIndex = Record<string, Record<string, PackPart[]>>;

const packLoads = new Map<string, Promise<Archive | null>>();
let packIndexPromise: Promise<PackIndex> | null = null;

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function emptyTile() {
  return copyBytes(EMPTY_TILE);
}

function packIndex() {
  if (!packIndexPromise) {
    const task = fetch("/data/packs/index.json").then(async (r) => {
      if (!r.ok) throw new Error("indice");
      return (await r.json()) as PackIndex;
    });
    task.catch(() => {
      if (packIndexPromise === task) packIndexPromise = null;
    });
    packIndexPromise = task;
  }
  return packIndexPromise;
}

function loadPack(url: string) {
  const hit = packLoads.get(url);
  if (hit) return hit;
  const task = fetch(url)
    .then(async (r) => {
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(url);
      return decodeArchive(await r.arrayBuffer());
    })
    .catch((err) => {
      packLoads.delete(url);
      console.error(err);
      return null;
    });
  packLoads.set(url, task);
  return task;
}

async function tileBytes(name: string, z: number, x: number, y: number) {
  try {
    const index = await packIndex();
    const parts = index[name]?.[String(z)];
    if (!parts?.length) return emptyTile();
    const part = parts.find((p) => p.x0 == null || (p.x1 != null && x >= p.x0 && x <= p.x1));
    if (!part) return emptyTile();
    const archive = await loadPack(part.url);
    if (!archive) return emptyTile();
    const bytes = readTile(archive, z, x, y);
    return bytes ? copyBytes(bytes) : emptyTile();
  } catch (err) {
    console.error(err);
    return emptyTile();
  }
}

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

async function fetchMaybeGz(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return buf;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export function MapScreen() {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [pitched, setPitched] = useState(true);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<DestinationKind | "all">("all");
  const [selected, setSelected] = useState<Destination | null>(null);
  const [relief, setRelief] = useState(true);
  const [trees, setTrees] = useState(true);
  const [sunset, setSunset] = useState(false);
  const markerRef = useRef<import("maplibre-gl").Marker | null>(null);
  const markerFactory = useRef<((place: Destination) => void) | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const results = filterDestinations(query, kind);

  const visit = (place: Destination) => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSelected(place);
    setPanelOpen(false);
    markerFactory.current?.(place);
    map.flyTo({ center: place.coordinates, zoom: place.zoom, pitch: pitched ? place.pitch : 0, bearing: place.bearing, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1800 });
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSelected(null);
    markerRef.current?.remove();
    markerRef.current = null;
    map.flyTo({ ...COUNTRY_VIEW, pitch: pitched ? COUNTRY_VIEW.pitch : 0, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400 });
  };

  useEffect(() => {
    if (panelOpen) searchRef.current?.focus();
  }, [panelOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      maplibregl.addProtocol("svt", async (request) => {
        const m = request.url.match(/svt:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
        if (!m) return { data: emptyTile() };
        return { data: await tileBytes(m[1], Number(m[2]), Number(m[3]), Number(m[4])) };
      });

      map = new maplibregl.Map({
        container: host.current,
        style: baseStyle(window.location.origin, landData, deptData) as unknown as StyleSpecification,
        ...COUNTRY_VIEW,
        maxPitch: 75,
        minZoom: 6.2,
        maxZoom: 17.5,
        maxBounds: [[-91.3, 12.2], [-86.7, 15.4]],
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
      map.on("pitch", () => {
        if (!dead && map) setPitched(map.getPitch() > 6);
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
          map.setTerrain({ source: "dem", exaggeration: 1.25 });
          map.addSource("destinations", {
            type: "geojson",
            data: { type: "FeatureCollection", features: DESTINATIONS.map((place) => ({
              type: "Feature" as const, properties: { id: place.id, name: place.name, kind: place.kind },
              geometry: { type: "Point" as const, coordinates: place.coordinates },
            })) },
          });
          for (const layer of destinationLayers()) map.addLayer(layer as never);
          map.on("click", "destination-points", (event) => {
            const id = event.features?.[0]?.properties?.id;
            const place = DESTINATIONS.find((item) => item.id === id);
            if (!place || !map) return;
            setSelected(place);
            setPanelOpen(false);
            markerFactory.current?.(place);
            map.flyTo({ center: place.coordinates, zoom: place.zoom, bearing: place.bearing, pitch: map.getPitch() > 6 ? place.pitch : 0, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1800 });
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
              map.addLayer(buildingLayer() as never, beforeTrees);
              map.addLayer(buildingRoofLayer() as never, beforeTrees);
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

  return (
    <main className="map-shell relative h-dvh w-full overflow-hidden bg-ocean">
      <div ref={host} className="map-host absolute inset-0 h-full w-full" aria-label="Mapa interactivo de El Salvador" />
      <header className="atlas-heading">
        <div className="atlas-logo" aria-hidden="true"><Mountain size={26} strokeWidth={2.5} /></div>
        <div><span className="atlas-kicker">EL SALVADOR · MUNDO ABIERTO</span><h1>Cuzcatlán<span className="atlas-dot">.</span></h1></div>
      </header>

      <div className="explore-controls">
        <button className="explore-button" aria-expanded={panelOpen} aria-controls="destination-panel" onClick={() => setPanelOpen((value) => !value)}>
          <Search size={18} /><span>Explorar lugares</span><ChevronDown size={16} className={panelOpen ? "turned" : ""} />
        </button>
        {selected && <button className="country-button" onClick={resetView} disabled={!ready} title="Ver todo El Salvador"><Globe2 size={18} /><span>Todo el país</span></button>}
      </div>

      {panelOpen && <section className="destination-panel" id="destination-panel" aria-label="Explorar lugares de El Salvador">
        <div className="panel-top"><span>ELIGE TU PRÓXIMA PARADA</span><button className="icon-button" aria-label="Cerrar explorador" onClick={() => setPanelOpen(false)}><X size={18} /></button></div>
        <label className="destination-search"><Search size={17} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca un lugar o departamento" aria-label="Buscar destino" />{query && <button className="icon-button" aria-label="Limpiar búsqueda" onClick={() => setQuery("")}><X size={15} /></button>}</label>
        <div className="destination-filters" aria-label="Filtrar destinos">
          <button aria-pressed={kind === "all"} onClick={() => setKind("all")}>Todos</button>
          {(Object.entries(KIND_LABEL) as [DestinationKind, string][]).map(([value, label]) => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}
        </div>
        <div className="destination-list">
          {results.map((place) => <button key={place.id} className="destination-item" disabled={!ready} onClick={() => visit(place)}>
            <span className={`destination-icon ${place.kind}`} aria-hidden="true">{place.kind === "volcano" ? <Mountain size={20} /> : place.kind === "lake" || place.kind === "coast" ? <Waves size={20} /> : place.kind === "city" ? <Building2 size={20} /> : <MapPin size={20} />}</span>
            <span className="destination-copy"><strong>{place.name}</strong><small>{place.region}</small></span><ArrowUpRight size={16} />
          </button>)}
          {!results.length && <p className="empty-search">No encontramos ese destino. Prueba con un departamento o cambia el filtro.</p>}
        </div>
        <p className="panel-foot">12 lugares para descubrir · Geografía real</p>
      </section>}

      <aside className="scene-controls" aria-label="Controles de la vista">
        <button disabled={!ready} aria-pressed={pitched} className="scene-button" title={pitched ? "Cambiar a vista 2D" : "Cambiar a vista 3D"} onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          const next = map.getPitch() < 6;
          map.easeTo({ pitch: next ? 55 : 0, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500 });
        }}><Layers size={18} /><span>{pitched ? "3D" : "2D"}</span></button>
        <button disabled={!ready} aria-pressed={relief} className="scene-button" title="Activar o desactivar el relieve" onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          const next = !relief;
          map.setTerrain(next ? { source: "dem", exaggeration: 1.25 } : null);
          setRelief(next);
        }}><Mountain size={18} /><span>Relieve</span></button>
        <button disabled={!ready} aria-pressed={trees} className="scene-button" title="Mostrar u ocultar árboles" onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          const next = !trees;
          for (const id of ["trees", "trees-close"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", next ? "visible" : "none");
          setTrees(next);
        }}><Trees size={18} /><span>Árboles</span></button>
        <button disabled={!ready} aria-pressed={sunset} className="scene-button" title={sunset ? "Cambiar a luz de día" : "Cambiar a atardecer"} onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          const next = !sunset;
          map.setLight({ anchor: "viewport", color: next ? "#ffd19a" : "#fff4e0", intensity: next ? 0.55 : 0.42, position: [1.15, next ? 245 : 210, next ? 65 : 38] });
          map.setSky({ "sky-color": next ? "#bda6e2" : "#88d6ee", "horizon-color": next ? "#ffd5a1" : "#fff2d4", "fog-color": next ? "#ecd2c2" : "#c5e6f8", "sky-horizon-blend": 0.55, "horizon-fog-blend": 0.62, "fog-ground-blend": 0.22, "atmosphere-blend": 0.45 });
          setSunset(next);
        }}>{sunset ? <Sunset size={18} /> : <Sun size={18} />}<span>{sunset ? "Tarde" : "Día"}</span></button>
      </aside>

      {selected ? <section className="place-card" aria-label="Destino seleccionado">
        <button className="place-back" onClick={resetView}><ArrowLeft size={15} /> Volver al país</button>
        <div className="place-card-heading"><div><span className="atlas-kicker">{selected.region}</span><h2>{selected.name}</h2></div><span className={`destination-icon ${selected.kind}`} aria-hidden="true"><MapPin size={22} /></span></div>
        <p className="place-tagline">{selected.description}</p><p className="place-detail">{selected.detail}</p>
      </section> : <div className="map-intro"><span className="atlas-kicker">UN PAÍS. MIL HISTORIAS.</span><p>De los volcanes al Pacífico.</p><button disabled={!ready} onClick={() => visit(DESTINATIONS[2])}>Descubre Coatepeque <ArrowUpRight size={16} /></button></div>}

      <div className="map-hints"><Compass size={15} /><span>Arrastra para explorar · Rueda para acercar · Botón derecho para girar</span><span className="touch-hint">Arrastra para explorar · Dos dedos para acercar y girar</span></div>
      {(!ready || failure) && <div className={`map-status ${failure ? "map-status-error" : ""}`} role="status">
        {failure ? <><MapPin size={22} /><p>{failure}</p><button onClick={() => window.location.reload()}>Reintentar</button></> : <><LoaderCircle className="loading-spin" size={22} /><p>Preparando El Salvador…</p></>}
      </div>}
      {notice && !failure && <div className="map-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={16} /></button></div>}
    </main>
  );
}
