const BOUNDS = { minLon: -91.3, maxLon: -86.7, minLat: 12.2, maxLat: 15.4 };

function latitudeAt(y: number, z: number) {
  return (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / 2 ** z));
}

export function parseElevationTile(raw: string) {
  const match = /^(\d+)\/(\d+)\/(\d+)$/.exec(raw);
  if (!match) return null;
  const [z, x, y] = match.slice(1).map(Number);
  if (![z, x, y].every(Number.isSafeInteger) || z < 5 || z > 14 || x >= 2 ** z || y >= 2 ** z) return null;
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = latitudeAt(y, z);
  const south = latitudeAt(y + 1, z);
  if (east < BOUNDS.minLon || west > BOUNDS.maxLon || north < BOUNDS.minLat || south > BOUNDS.maxLat) return null;
  return { z, x, y };
}
