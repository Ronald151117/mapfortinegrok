import { createFileRoute } from "@tanstack/react-router";
import { MapScreen } from "@/components/map-screen";

export const Route = createFileRoute("/")({
  ssr: false,
  component: MapScreen,
});
