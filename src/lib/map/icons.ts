export type Img = { width: number; height: number; data: Uint8ClampedArray };

export function blank(size = 48): Uint8ClampedArray {
  return new Uint8ClampedArray(size * size * 4);
}

export function dot(data: Uint8ClampedArray, size: number, x: number, y: number, r: number, g: number, b: number, a = 255) {
  const ix = x | 0;
  const iy = y | 0;
  if (ix < 0 || iy < 0 || ix >= size || iy >= size) return;
  const i = (iy * size + ix) * 4;
  const sa = a / 255;
  const da = data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  data[i] = (r * sa + data[i] * da * (1 - sa)) / oa;
  data[i + 1] = (g * sa + data[i + 1] * da * (1 - sa)) / oa;
  data[i + 2] = (b * sa + data[i + 2] * da * (1 - sa)) / oa;
  data[i + 3] = oa * 255;
}

export function fillCircle(data: Uint8ClampedArray, size: number, cx: number, cy: number, rad: number, rgb: [number, number, number]) {
  const r2 = rad * rad;
  for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
    for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d <= r2) dot(data, size, x, y, rgb[0], rgb[1], rgb[2]);
    }
  }
}

export function fillRect(data: Uint8ClampedArray, size: number, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) dot(data, size, x, y, rgb[0], rgb[1], rgb[2]);
}

export function fillTri(
  data: Uint8ClampedArray,
  size: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  rgb: [number, number, number],
) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
  const sign = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) =>
    (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d0 = sign(x, y, ax, ay, bx, by);
      const d1 = sign(x, y, bx, by, cx, cy);
      const d2 = sign(x, y, cx, cy, ax, ay);
      const neg = d0 < 0 || d1 < 0 || d2 < 0;
      const pos = d0 > 0 || d1 > 0 || d2 > 0;
      if (!(neg && pos)) dot(data, size, x, y, rgb[0], rgb[1], rgb[2]);
    }
  }
}

function canopy(
  data: Uint8ClampedArray,
  s: number,
  cx: number,
  cy: number,
  r: number,
  rgb: [number, number, number],
  hi: [number, number, number],
) {
  fillCircle(data, s, cx, cy, r + 2.2, INK);
  fillCircle(data, s, cx, cy, r, rgb);
  fillCircle(data, s, cx - r * 0.28, cy - r * 0.32, r * 0.42, hi);
}

const INK: [number, number, number] = [27, 36, 48];
const CREAM: [number, number, number] = [255, 246, 228];
const OCEAN: [number, number, number] = [47, 143, 224];
const GRASS: [number, number, number] = [111, 191, 74];
const ACCENT: [number, number, number] = [255, 122, 50];

function badge(rgb: [number, number, number], draw: (d: Uint8ClampedArray, s: number) => void): Img {
  const s = 48;
  const data = blank(s);
  fillCircle(data, s, 24, 24, 21, INK);
  fillCircle(data, s, 24, 24, 17, rgb);
  draw(data, s);
  return { width: s, height: s, data };
}

export function buildIcons(): Record<string, Img> {
  const icons: Record<string, Img> = {};
  icons.tree = (() => {
    const s = 64;
    const data = blank(s);
    fillRect(data, s, 28, 40, 36, 58, [92, 58, 32]);
    fillRect(data, s, 26, 54, 38, 60, [62, 42, 26]);
    canopy(data, s, 32, 34, 16, [58, 168, 62], [168, 220, 96]);
    canopy(data, s, 20, 28, 12, [46, 150, 58], [150, 210, 88]);
    canopy(data, s, 44, 27, 11, [72, 186, 70], [186, 230, 110]);
    return { width: s, height: s, data };
  })();
  icons.pine = (() => {
    const s = 64;
    const data = blank(s);
    fillRect(data, s, 29, 46, 35, 60, [92, 58, 32]);
    const layers: [number, number, number, [number, number, number]][] = [
      [50, 24, 18, [36, 122, 48]],
      [36, 18, 18, [52, 158, 58]],
      [22, 12, 16, [132, 204, 78]],
    ];
    for (const [tip, w, h, rgb] of layers) {
      fillTri(data, s, 32, tip - 2, 32 - w - 2, tip + h + 2, 32 + w + 2, tip + h + 2, INK);
      fillTri(data, s, 32, tip, 32 - w, tip + h, 32 + w, tip + h, rgb);
    }
    return { width: s, height: s, data };
  })();
  icons.palm = (() => {
    const s = 64;
    const data = blank(s);
    fillRect(data, s, 30, 28, 35, 60, [122, 78, 36]);
    fillRect(data, s, 28, 56, 38, 61, [92, 58, 32]);
    const fronds: [number, number, number, number][] = [
      [18, 16, 10, 22],
      [46, 16, 10, 22],
      [32, 10, 9, 18],
      [14, 26, 9, 16],
      [50, 26, 9, 16],
      [32, 24, 8, 14],
    ];
    for (const [cx, cy, rx, ry] of fronds) {
      for (let y = cy - ry; y <= cy + ry; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const nx = (x - cx) / rx;
          const ny = (y - cy) / ry;
          if (nx * nx + ny * ny <= 1) dot(data, s, x, y, 27, 36, 48);
        }
      }
    }
    for (const [cx, cy, rx, ry] of fronds) {
      for (let y = cy - ry + 2; y <= cy + ry - 2; y++) {
        for (let x = cx - rx + 2; x <= cx + rx - 2; x++) {
          const nx = (x - cx) / (rx - 2);
          const ny = (y - cy) / (ry - 2);
          if (nx * nx + ny * ny <= 1) dot(data, s, x, y, 62, 176, 72);
        }
      }
    }
    fillCircle(data, s, 32, 22, 5, [186, 214, 86]);
    return { width: s, height: s, data };
  })();
  icons.hospital = badge(ACCENT, (d, s) => {
    fillRect(d, s, 21, 12, 27, 36, CREAM);
    fillRect(d, s, 14, 20, 34, 28, CREAM);
  });
  icons.clinic = icons.hospital;
  icons.pharmacy = badge(OCEAN, (d, s) => {
    fillRect(d, s, 21, 14, 27, 34, CREAM);
    fillRect(d, s, 16, 20, 32, 26, CREAM);
  });
  icons.fuel = badge(INK, (d, s) => {
    fillCircle(d, s, 24, 20, 8, ACCENT);
    fillRect(d, s, 21, 24, 27, 34, ACCENT);
  });
  icons.police = badge(OCEAN, (d, s) => {
    fillCircle(d, s, 24, 24, 6, CREAM);
  });
  icons.fire = badge(ACCENT, (d, s) => {
    fillCircle(d, s, 24, 26, 8, CREAM);
    fillCircle(d, s, 24, 20, 5, [255, 196, 92]);
  });
  icons.school = badge(OCEAN, (d, s) => {
    fillRect(d, s, 14, 22, 34, 32, CREAM);
    fillRect(d, s, 22, 14, 26, 22, CREAM);
  });
  icons.university = icons.school;
  icons.bus_station = badge(ACCENT, (d, s) => {
    fillRect(d, s, 12, 20, 36, 32, CREAM);
    fillCircle(d, s, 18, 33, 3, INK);
    fillCircle(d, s, 30, 33, 3, INK);
  });
  icons.bus = icons.bus_station;
  icons.ferry = badge(OCEAN, (d, s) => {
    fillRect(d, s, 12, 26, 36, 32, CREAM);
    fillRect(d, s, 22, 14, 26, 26, CREAM);
  });
  icons.market = badge(GRASS, (d, s) => {
    fillRect(d, s, 14, 22, 34, 34, CREAM);
  });
  icons.civic = badge(OCEAN, (d, s) => {
    fillRect(d, s, 16, 20, 32, 34, CREAM);
    fillRect(d, s, 20, 14, 28, 20, INK);
  });
  icons.bank = icons.civic;
  icons.worship = badge(CREAM, (d, s) => {
    fillRect(d, s, 18, 24, 30, 36, INK);
    fillCircle(d, s, 24, 18, 6, INK);
  });
  icons.parking = badge(OCEAN, (d, s) => {
    fillRect(d, s, 18, 12, 24, 34, CREAM);
    fillRect(d, s, 24, 12, 32, 18, CREAM);
    fillRect(d, s, 24, 20, 30, 26, CREAM);
  });
  icons.hotel = badge(ACCENT, (d, s) => {
    fillRect(d, s, 16, 16, 32, 34, CREAM);
  });
  icons.sight = badge(GRASS, (d, s) => {
    fillCircle(d, s, 24, 24, 6, CREAM);
  });
  icons.food = badge(ACCENT, (d, s) => {
    fillCircle(d, s, 24, 26, 8, CREAM);
    fillRect(d, s, 22, 14, 26, 22, CREAM);
  });
  icons.stadium = badge(GRASS, (d, s) => {
    fillCircle(d, s, 24, 24, 10, CREAM);
    fillCircle(d, s, 24, 24, 5, GRASS);
  });
  icons.post = badge(OCEAN, (d, s) => {
    fillRect(d, s, 14, 18, 34, 32, CREAM);
  });
  icons.library = icons.post;
  icons.airport = badge(OCEAN, (d, s) => {
    fillRect(d, s, 10, 22, 38, 26, CREAM);
    fillRect(d, s, 22, 16, 26, 34, CREAM);
  });
  icons.volcano = badge(ACCENT, (d, s) => {
    fillCircle(d, s, 24, 16, 4, [255, 214, 80]);
    fillRect(d, s, 16, 28, 32, 34, INK);
  });
  icons.peak = badge(CREAM, (d, s) => {
    fillRect(d, s, 22, 12, 26, 34, INK);
  });
  return icons;
}

export const POI_LABEL: Record<string, string> = {
  hospital: "Hospital",
  clinic: "Clínica",
  pharmacy: "Farmacia",
  fuel: "Gasolinera",
  police: "Policía",
  fire: "Bomberos",
  school: "Escuela",
  university: "Universidad",
  bus_station: "Terminal",
  bus: "Parada",
  ferry: "Ferry",
  market: "Mercado",
  civic: "Alcaldía",
  bank: "Banco",
  worship: "Templo",
  parking: "Parqueo",
  hotel: "Hotel",
  sight: "Lugar",
  food: "Comida",
  stadium: "Estadio",
  post: "Correo",
  library: "Biblioteca",
  airport: "Aeropuerto",
  volcano: "Volcán",
  peak: "Cerro",
};
