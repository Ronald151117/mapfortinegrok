import deptRaw from "../../../public/data/departments.geojson?raw";
import landRaw from "../../../public/data/land.geojson?raw";
import contextRaw from "../../../public/data/context-land.geojson?raw";

export type LandCollection = {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[];
};

export type DeptCollection = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { n: string; lat: number; lon: number }; geometry: { type: string; coordinates: number[][][] } }[];
};

export const landData = JSON.parse(landRaw) as LandCollection;
export const deptData = JSON.parse(deptRaw) as DeptCollection;
export const contextData = JSON.parse(contextRaw) as LandCollection;
