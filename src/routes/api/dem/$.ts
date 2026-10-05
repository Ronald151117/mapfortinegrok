import { createFileRoute } from "@tanstack/react-router";

const SV = { minLon: -91.3, maxLon: -86.7, minLat: 12.2, maxLat: 15.4 };

function latOf(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function tileHitsCountry(z: number, x: number, y: number) {
  const n = 2 ** z;
  const lon1 = (x / n) * 360 - 180;
  const lon2 = ((x + 1) / n) * 360 - 180;
  const latNorth = latOf(y, z);
  const latSouth = latOf(y + 1, z);
  return !(lon2 < SV.minLon || lon1 > SV.maxLon || latNorth < SV.minLat || latSouth > SV.maxLat);
}

export const Route = createFileRoute("/api/dem/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const raw = String(params._splat ?? "");
        const parts = raw.split("/").filter(Boolean);
        if (parts.length !== 3) return new Response("bad tile", { status: 400 });
        const z = Number(parts[0]);
        const x = Number(parts[1]);
        const y = Number(parts[2]);
        if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0)) {
          return new Response("bad tile", { status: 400 });
        }
        if (z < 5 || z > 14 || !tileHitsCountry(z, x, y)) {
          return new Response("out of range", { status: 404 });
        }
        const upstream = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
        const res = await fetch(upstream);
        if (!res.ok) return new Response("no elevation", { status: 404 });
        const buf = await res.arrayBuffer();
        return new Response(buf, {
          headers: {
            "content-type": "image/png",
            "cache-control": "public, max-age=604800",
          },
        });
      },
    },
  },
});
