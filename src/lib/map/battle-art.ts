import { blank, dot, fillCircle, fillTri, type Img } from "./icons.ts";

type RGB = [number, number, number];

const INK: RGB = [27, 30, 38];

// Small deterministic PRNG so every texture tile looks the same on each load.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function solid(size: number, rgb: RGB) {
  const data = blank(size);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return data;
}

// Pattern tiles repeat, so anything drawn near an edge wraps to the other side.
function wrapDot(data: Uint8ClampedArray, size: number, x: number, y: number, rgb: RGB, a = 255) {
  const ix = ((Math.round(x) % size) + size) % size;
  const iy = ((Math.round(y) % size) + size) % size;
  dot(data, size, ix, iy, rgb[0], rgb[1], rgb[2], a);
}

function wrapCircle(data: Uint8ClampedArray, size: number, cx: number, cy: number, r: number, rgb: RGB, a = 255) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) wrapDot(data, size, x, y, rgb, a);
    }
  }
}

function speckle(data: Uint8ClampedArray, size: number, seed: number, count: number, colors: RGB[], alpha = 255) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const c = colors[Math.floor(rand() * colors.length)];
    wrapDot(data, size, rand() * size, rand() * size, c, alpha);
  }
}

function grass(): Img {
  const s = 64;
  const data = solid(s, [124, 207, 74]);
  speckle(data, s, 11, 260, [[108, 191, 62], [140, 220, 90], [116, 200, 70]]);
  const rand = rng(12);
  for (let i = 0; i < 14; i++) {
    const x = rand() * s;
    const y = rand() * s;
    for (let k = 0; k < 4; k++) {
      wrapDot(data, s, x - k * 0.6, y - k, [86, 168, 52]);
      wrapDot(data, s, x + k * 0.6, y - k, [86, 168, 52]);
    }
  }
  return { width: s, height: s, data };
}

function forest(): Img {
  const s = 64;
  const data = solid(s, [44, 120, 52]);
  const rand = rng(21);
  const crowns: [number, number, number][] = [];
  for (let i = 0; i < 26; i++) crowns.push([rand() * s, rand() * s, 5 + rand() * 4]);
  for (const [x, y, r] of crowns) wrapCircle(data, s, x + 1.6, y + 2, r, [30, 88, 40]);
  for (const [x, y, r] of crowns) wrapCircle(data, s, x, y, r, [62, 150, 62]);
  for (const [x, y, r] of crowns) wrapCircle(data, s, x - r * 0.3, y - r * 0.32, r * 0.45, [104, 188, 80]);
  return { width: s, height: s, data };
}

function scrub(): Img {
  const s = 64;
  const data = solid(s, [150, 196, 92]);
  const rand = rng(31);
  for (let i = 0; i < 18; i++) {
    const x = rand() * s;
    const y = rand() * s;
    const r = 2 + rand() * 2.5;
    wrapCircle(data, s, x + 1, y + 1, r, [92, 140, 62]);
    wrapCircle(data, s, x, y, r, [112, 168, 70]);
  }
  speckle(data, s, 32, 90, [[170, 206, 110], [138, 184, 84]]);
  return { width: s, height: s, data };
}

function farm(): Img {
  const s = 32;
  const data = solid(s, [196, 214, 112]);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if ((x + y) % 8 < 2) dot(data, s, x, y, 168, 192, 88);
    }
  }
  speckle(data, s, 41, 30, [[214, 226, 132]]);
  return { width: s, height: s, data };
}

function park(): Img {
  const s = 32;
  const data = solid(s, [134, 214, 92]);
  for (let y = 0; y < s; y++) {
    if (Math.floor(y / 8) % 2 === 0) for (let x = 0; x < s; x++) dot(data, s, x, y, 150, 226, 104);
  }
  return { width: s, height: s, data };
}

function sand(): Img {
  const s = 32;
  const data = solid(s, [244, 222, 156]);
  speckle(data, s, 51, 70, [[226, 196, 124], [252, 236, 186]]);
  return { width: s, height: s, data };
}

function wetland(): Img {
  const s = 32;
  const data = solid(s, [112, 190, 150]);
  const rand = rng(61);
  for (let i = 0; i < 12; i++) {
    const x = rand() * s;
    const y = rand() * s;
    for (let k = 0; k < 5; k++) wrapDot(data, s, x + k, y, [70, 150, 116]);
  }
  for (let i = 0; i < 6; i++) {
    const x = rand() * s;
    const y = rand() * s;
    for (let k = 0; k < 4; k++) wrapDot(data, s, x + k, y, [96, 186, 214]);
  }
  return { width: s, height: s, data };
}

function urban(): Img {
  const s = 32;
  const data = solid(s, [220, 214, 200]);
  for (let i = 0; i < s; i++) {
    dot(data, s, i, 0, 204, 197, 182);
    dot(data, s, 0, i, 204, 197, 182);
    dot(data, s, i, 16, 210, 203, 188);
    dot(data, s, 16, i, 210, 203, 188);
  }
  speckle(data, s, 71, 24, [[230, 224, 212]]);
  return { width: s, height: s, data };
}

function fillPoly(data: Uint8ClampedArray, size: number, pts: [number, number][], rgb: RGB) {
  for (let i = 1; i + 1 < pts.length; i++) {
    fillTri(data, size, pts[0][0], pts[0][1], pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], rgb);
  }
}

function fillEllipse(data: Uint8ClampedArray, size: number, cx: number, cy: number, rx: number, ry: number, rgb: RGB) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) dot(data, size, x, y, rgb[0], rgb[1], rgb[2]);
    }
  }
}

// A painted cone seen from a three-quarter angle, like the landmarks on a battle-royale map.
function volcano(): Img {
  const s = 96;
  const data = blank(s);
  fillEllipse(data, s, 48, 80, 44, 12, INK);
  fillEllipse(data, s, 48, 79, 41, 10, [70, 150, 62]);
  fillPoly(data, s, [[30, 22], [66, 22], [92, 80], [4, 80]], INK);
  fillPoly(data, s, [[32, 25], [64, 25], [88, 78], [8, 78]], [150, 104, 70]);
  fillPoly(data, s, [[48, 25], [64, 25], [88, 78], [48, 78]], [118, 80, 56]);
  fillPoly(data, s, [[36, 25], [44, 25], [30, 56], [20, 60]], [186, 140, 96]);
  fillPoly(data, s, [[54, 26], [58, 26], [52, 46], [46, 50]], [255, 132, 52]);
  fillEllipse(data, s, 48, 76, 40, 6, [86, 164, 70]);
  fillEllipse(data, s, 48, 24, 18, 6, INK);
  fillEllipse(data, s, 48, 24, 15.5, 4.2, [84, 52, 40]);
  fillEllipse(data, s, 48, 25, 9, 2.4, [255, 150, 60]);
  fillCircle(data, s, 40, 12, 5, [236, 236, 240]);
  fillCircle(data, s, 49, 8, 6, [246, 246, 250]);
  fillCircle(data, s, 58, 11, 4.5, [228, 228, 234]);
  return { width: s, height: s, data };
}

function peak(): Img {
  const s = 64;
  const data = blank(s);
  fillPoly(data, s, [[32, 10], [60, 54], [4, 54]], INK);
  fillPoly(data, s, [[32, 14], [56, 52], [8, 52]], [112, 150, 86]);
  fillPoly(data, s, [[32, 14], [56, 52], [32, 52]], [84, 120, 66]);
  fillPoly(data, s, [[32, 14], [40, 27], [32, 30], [25, 26]], [214, 204, 176]);
  return { width: s, height: s, data };
}

export const BATTLE_PATTERNS = {
  "bt-grass": grass,
  "bt-forest": forest,
  "bt-scrub": scrub,
  "bt-farm": farm,
  "bt-park": park,
  "bt-sand": sand,
  "bt-wetland": wetland,
  "bt-urban": urban,
} as const;

export function buildBattleArt(): Record<string, Img> {
  const art: Record<string, Img> = {};
  for (const [name, draw] of Object.entries(BATTLE_PATTERNS)) art[name] = draw();
  art["bt-volcano"] = volcano();
  art["bt-peak"] = peak();
  return art;
}
