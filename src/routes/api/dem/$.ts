import { createFileRoute } from "@tanstack/react-router";
import { parseElevationTile } from "@/lib/map/elevation";

export const Route = createFileRoute("/api/dem/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const tile = parseElevationTile(String(params._splat ?? ""));
        if (!tile) return new Response("invalid elevation tile", { status: 404 });
        const { z, x, y } = tile;
        try {
          const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, {
            signal: AbortSignal.timeout(12000),
          });
          if (!response.ok) return new Response("elevation unavailable", { status: response.status === 404 ? 404 : 502 });
          const bytes = await response.arrayBuffer();
          return new Response(bytes, {
            headers: { "content-type": "image/png", "cache-control": "public, max-age=604800, stale-while-revalidate=86400" },
          });
        } catch {
          return new Response("elevation temporarily unavailable", { status: 503, headers: { "retry-after": "30" } });
        }
      },
    },
  },
});
