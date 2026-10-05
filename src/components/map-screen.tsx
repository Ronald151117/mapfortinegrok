import { useEffect, useRef, useState } from "react";
import type { StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { decodeArchive, readTile, type Archive } from "@/lib/map/decode";
import { deptData, landData } from "@/lib/map/country";
import { buildIcons } from "@/lib/map/icons";
import { baseStyle, buildingLayer, coverLayers, labelLayers, reliefLayer, roadLayers } from "@/lib/map/style";

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
  if (rewritten === workerSrc) throw new Error("worker import");
  maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([rewritten], { type: "text/javascript" })));
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

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let map: MLMap | null = null;

    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (dead || !host.current) return;
      try {
        await installWorker(maplibregl);
      } catch (err) {
        console.warn(err);
        maplibregl.setWorkerUrl(maplibreWorkerUrl);
      }
      if (dead || !host.current) return;
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
        center: [-88.92, 13.62],
        zoom: 7.65,
        pitch: 50,
        bearing: -16,
        maxPitch: 75,
        minZoom: 6.2,
        maxZoom: 17.5,
        attributionControl: false,
        fadeDuration: 0,
        dragRotate: true,
        pitchWithRotate: true,
        touchPitch: true,
        cooperativeGestures: false,
      });
      mapRef.current = map;
      map.scrollZoom.enable();
      map.dragPan.enable();
      map.dragRotate.enable();
      map.touchZoomRotate.enable();
      map.doubleClickZoom.enable();
      map.keyboard.enable();
      map.boxZoom.enable();
      map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), "top-right");
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
          const before = map.getLayer("dept-line") ? "dept-line" : undefined;
          map.addLayer(reliefLayer() as never, before);
          map.setTerrain({ source: "dem", exaggeration: 1.45 });
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
            }
          };
          map.on("moveend", loadNearby);
          map.on("zoomend", loadNearby);
          loadNearby();
        } catch (err) {
          console.error(err);
        }
      });
    })();

    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => {
      dead = true;
      ro.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <main className="map-shell relative h-dvh w-full overflow-hidden bg-ocean">
      <div ref={host} className="map-host absolute inset-0 h-full w-full" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <button
        type="button"
        className="map-view"
        aria-label={pitched ? "Ver en 2D" : "Ver en 3D"}
        onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          const next = map.getPitch() < 6;
          setPitched(next);
          map.easeTo({ pitch: next ? 55 : 0, duration: 450 });
        }}
      >
        {pitched ? "2D" : "3D"}
      </button>
    </main>
  );
}
