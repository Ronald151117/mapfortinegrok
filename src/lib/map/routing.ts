import { type Graph } from "./decode";

export type TravelMode = "car" | "walk";

export type Step = {
  text: string;
  street: string;
  at: number;
  lat: number;
  lon: number;
};

export type RouteResult = {
  meters: number;
  seconds: number;
  line: [number, number][];
  steps: Step[];
};

const KMH = [90, 75, 58, 48, 38, 34, 28, 18, 16, 14, 5];

function allows(graph: Graph, edge: number, mode: TravelMode) {
  return mode === "car" ? (graph.flags[edge] & 1) !== 0 : (graph.flags[edge] & 2) !== 0;
}

function speedMps(graph: Graph, edge: number, mode: TravelMode) {
  if (mode === "walk") return 1.35;
  const base = (KMH[graph.cls[edge]] ?? 30) / 3.6;
  return (graph.flags[edge] & 4) !== 0 ? base * 0.35 : base;
}

function edgeSeconds(graph: Graph, edge: number, mode: TravelMode) {
  return graph.meters[edge] / speedMps(graph, edge, mode);
}

function hav(lon1: number, lat1: number, lon2: number, lat2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a1 = (lat1 * Math.PI) / 180;
  const a2 = (lat2 * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function project(lon: number, lat: number, ax: number, ay: number, bx: number, by: number) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const dx = (bx - ax) * kx;
  const dy = (by - ay) * ky;
  const l2 = dx * dx + dy * dy || 1e-3;
  let t = (((lon - ax) * kx) * dx + ((lat - ay) * ky) * dy) / l2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const x = ax + (bx - ax) * t;
  const y = ay + (by - ay) * t;
  const dist = Math.hypot((lon - x) * kx, (lat - y) * ky);
  return { t, lon: x, lat: y, dist };
}

type Snap = {
  edge: number;
  frac: number;
  dist: number;
  lat: number;
  lon: number;
};

function reachable(graph: Graph, edge: number, mode: TravelMode, limit: number) {
  const seen = new Set<number>();
  const q: number[] = [];
  const seed = (node: number) => {
    if (seen.has(node)) return;
    seen.add(node);
    q.push(node);
  };
  seed(graph.to[edge]);
  if (graph.rev[edge] >= 0) seed(graph.from[edge]);
  let qi = 0;
  while (qi < q.length && seen.size < limit) {
    const node = q[qi++];
    for (let e = graph.head[node]; e !== -1; e = graph.next[e]) {
      if (!allows(graph, e, mode)) continue;
      seed(graph.to[e]);
      if (seen.size >= limit) break;
    }
  }
  return seen.size;
}

export function snap(graph: Graph, lat: number, lon: number, mode: TravelMode): Snap | null {
  const gx = Math.floor(lon / 0.035);
  const gy = Math.floor(lat / 0.035);
  const found = new Map<number, Snap>();
  const maxD = mode === "car" ? 750 : 900;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const list = graph.grid.get((gy + dy) * 100000 + (gx + dx));
      if (!list) continue;
      for (const edge of list) {
        if (!allows(graph, edge, mode)) continue;
        const n = graph.geomCount[edge];
        const o = graph.geomOffset[edge];
        if (n < 2) continue;
        let walked = 0;
        let total = 0;
        const lens: number[] = [];
        for (let i = 0; i < n - 1; i++) {
          const d = hav(graph.geomLon[o + i], graph.geomLat[o + i], graph.geomLon[o + i + 1], graph.geomLat[o + i + 1]);
          lens.push(d);
          total += d;
        }
        if (total < 1) continue;
        let local: Snap | null = found.get(edge) ?? null;
        for (let i = 0; i < n - 1; i++) {
          const hit = project(lon, lat, graph.geomLon[o + i], graph.geomLat[o + i], graph.geomLon[o + i + 1], graph.geomLat[o + i + 1]);
          if (hit.dist > maxD) {
            walked += lens[i];
            continue;
          }
          if (!local || hit.dist < local.dist) {
            const frac = (walked + lens[i] * hit.t) / total;
            local = { edge, frac, dist: hit.dist, lat: hit.lat, lon: hit.lon };
          }
          walked += lens[i];
        }
        if (local) found.set(edge, local);
      }
    }
  }
  const ranked = [...found.values()].sort((a, b) => a.dist - b.dist).slice(0, 24);
  for (const cand of ranked) {
    if (reachable(graph, cand.edge, mode, 40) >= 40) return cand;
  }
  const near = mode === "car" ? 280 : 420;
  return ranked.find((c) => c.dist <= near) ?? null;
}

function sliceGeom(graph: Graph, edge: number, fromFrac: number, toFrac: number): [number, number][] {
  const n = graph.geomCount[edge];
  const o = graph.geomOffset[edge];
  if (n < 2) return [];
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < n - 1; i++) {
    const d = hav(graph.geomLon[o + i], graph.geomLat[o + i], graph.geomLon[o + i + 1], graph.geomLat[o + i + 1]);
    lens.push(d);
    total += d;
  }
  if (total < 1) total = 1;
  const a = Math.max(0, Math.min(1, Math.min(fromFrac, toFrac)));
  const b = Math.max(0, Math.min(1, Math.max(fromFrac, toFrac)));
  const startM = a * total;
  const endM = b * total;
  const out: [number, number][] = [];
  let walked = 0;
  const push = (lon: number, lat: number) => {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - lon) > 1e-6 || Math.abs(last[1] - lat) > 1e-6) out.push([lon, lat]);
  };
  for (let i = 0; i < n - 1; i++) {
    const seg = lens[i] || 0;
    const segStart = walked;
    const segEnd = walked + seg;
    if (segEnd >= startM && segStart <= endM && seg > 0) {
      const t0 = Math.max(0, (startM - segStart) / seg);
      const t1 = Math.min(1, (endM - segStart) / seg);
      const ax = graph.geomLon[o + i];
      const ay = graph.geomLat[o + i];
      const bx = graph.geomLon[o + i + 1];
      const by = graph.geomLat[o + i + 1];
      push(ax + (bx - ax) * t0, ay + (by - ay) * t0);
      push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
    }
    walked = segEnd;
  }
  if (fromFrac > toFrac) out.reverse();
  return out;
}

function bearing(lon1: number, lat1: number, lon2: number, lat2: number) {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(((lon2 - lon1) * Math.PI) / 180);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function turnAngle(a: number, b: number) {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

const CARD = ["el norte", "el noreste", "el este", "el sureste", "el sur", "el suroeste", "el oeste", "el noroeste"];

function cardinal(b: number) {
  const i = Math.round((((b % 360) + 360) % 360) / 45) % 8;
  return CARD[i];
}

const CLASS_NAME = [
  "la autopista",
  "la vía rápida",
  "la vía principal",
  "la calle",
  "la calle",
  "la calle",
  "la calle",
  "la residencial",
  "el pasaje",
  "el camino",
  "el sendero",
];

function streetLabel(graph: Graph, edge: number) {
  const name = graph.names[graph.nameId[edge]] || "";
  return name || CLASS_NAME[graph.cls[edge]] || "la calle";
}

function buildSteps(graph: Graph, edges: number[], partials: [number, number][][], meters: number): Step[] {
  type Piece = { edge: number; geom: [number, number][]; meters: number; at: number };
  const pieces: Piece[] = [];
  let at = 0;
  edges.forEach((edge, i) => {
    const geom = partials[i];
    const m = geom.length >= 2 ? geom.slice(1).reduce((s, p, idx) => s + hav(geom[idx][0], geom[idx][1], p[0], p[1]), 0) : graph.meters[edge];
    pieces.push({ edge, geom, meters: m, at });
    at += m;
  });
  if (!pieces.length) return [];
  const steps: Step[] = [];
  const first = pieces[0];
  const f0 = first.geom[0];
  const f1 = first.geom[Math.min(1, first.geom.length - 1)];
  const b0 = f0 && f1 ? bearing(f0[0], f0[1], f1[0], f1[1]) : 0;
  const name0 = streetLabel(graph, first.edge);
  steps.push({
    text: `Dirígete hacia ${cardinal(b0)} por ${name0}`,
    street: graph.names[graph.nameId[first.edge]] || "",
    at: 0,
    lat: f0?.[1] ?? graph.lat[graph.from[first.edge]],
    lon: f0?.[0] ?? graph.lon[graph.from[first.edge]],
  });
  let groupName = graph.names[graph.nameId[first.edge]] || "";
  let prevBear = b0;
  for (let i = 1; i < pieces.length; i++) {
    const prev = pieces[i - 1];
    const cur = pieces[i];
    const pg = prev.geom;
    const cg = cur.geom;
    const pA = pg[Math.max(0, pg.length - 2)] || pg[0];
    const pB = pg[pg.length - 1] || pA;
    const cB = cg[Math.min(1, cg.length - 1)] || cg[0];
    if (!pA || !pB || !cB) continue;
    const inB = bearing(pA[0], pA[1], pB[0], pB[1]);
    const outB = bearing(pB[0], pB[1], cB[0], cB[1]);
    const angle = turnAngle(inB, outB);
    const name = graph.names[graph.nameId[cur.edge]] || "";
    const label = streetLabel(graph, cur.edge);
    if (name === groupName && Math.abs(angle) < 28) {
      prevBear = outB;
      continue;
    }
    const side = angle >= 0 ? "derecha" : "izquierda";
    const abs = Math.abs(angle);
    let text = `Sigue por ${label}`;
    if (abs >= 150) text = `Da vuelta en U hacia ${label}`;
    else if (abs >= 55) text = `Gira a la ${side} en ${label}`;
    else if (abs >= 25) text = `Mantente a la ${side} hacia ${label}`;
    else if (name && name !== groupName) text = `Continúa por ${label}`;
    else continue;
    steps.push({ text, street: name, at: cur.at, lat: pB[1], lon: pB[0] });
    groupName = name;
    prevBear = outB;
  }
  const end = pieces[pieces.length - 1].geom.at(-1);
  steps.push({
    text: "Llegaste a tu destino",
    street: "",
    at: meters,
    lat: end?.[1] ?? 0,
    lon: end?.[0] ?? 0,
  });
  return steps;
}

class Heap {
  data: { n: number; s: number }[] = [];
  push(n: number, s: number) {
    const h = this.data;
    h.push({ n, s });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].s <= h[i].s) break;
      const tmp = h[p];
      h[p] = h[i];
      h[i] = tmp;
      i = p;
    }
  }
  pop(): { n: number; s: number } | null {
    const h = this.data;
    if (!h.length) return null;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        let m = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < h.length && h[l].s < h[m].s) m = l;
        if (r < h.length && h[r].s < h[m].s) m = r;
        if (m === i) break;
        const tmp = h[i];
        h[i] = h[m];
        h[m] = tmp;
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.data.length;
  }
}

export function route(graph: Graph, fromLat: number, fromLon: number, toLat: number, toLon: number, mode: TravelMode): RouteResult | null {
  const start = snap(graph, fromLat, fromLon, mode);
  const goal = snap(graph, toLat, toLon, mode);
  if (!start || !goal) return null;

  const direct = sameCorridor(graph, start, goal, mode);
  if (direct) return direct;

  const n = graph.lat.length;
  const gScore = new Float64Array(n);
  gScore.fill(Infinity);
  const parentNode = new Int32Array(n);
  parentNode.fill(-1);
  const parentEdge = new Int32Array(n);
  parentEdge.fill(-1);
  const closed = new Uint8Array(n);
  const fScore = new Float64Array(n);
  const heap = new Heap();

  const maxSpd = mode === "car" ? 30 : 1.6;
  const heur = (node: number) => hav(graph.lon[node], graph.lat[node], goal.lon, goal.lat) / maxSpd;

  type Seed = { node: number; g: number; edge: number; fromFrac: number };
  const seeds: Seed[] = [];
  const pushSeed = (edge: number, fromFrac: number) => {
    if (!allows(graph, edge, mode)) return;
    const node = graph.to[edge];
    const extra = edgeSeconds(graph, edge, mode) * (1 - fromFrac);
    if (extra < gScore[node]) {
      gScore[node] = extra;
      parentNode[node] = -2;
      parentEdge[node] = edge;
      fScore[node] = extra + heur(node);
      seeds.push({ node, g: extra, edge, fromFrac });
    }
  };
  pushSeed(start.edge, start.frac);
  if (graph.rev[start.edge] >= 0) pushSeed(graph.rev[start.edge], 1 - start.frac);

  for (const s of seeds) heap.push(s.node, fScore[s.node]);

  let best = Infinity;
  let bestNode = -1;
  let bestVia: "fwd" | "back" | null = null;
  const goalFrom = graph.from[goal.edge];
  const goalTo = graph.to[goal.edge];
  const goalRev = graph.rev[goal.edge];

  const consider = (node: number, g: number) => {
    if (node === goalFrom && allows(graph, goal.edge, mode)) {
      const total = g + edgeSeconds(graph, goal.edge, mode) * goal.frac;
      if (total < best) {
        best = total;
        bestNode = node;
        bestVia = "fwd";
      }
    }
    if (goalRev >= 0 && node === goalTo && allows(graph, goalRev, mode)) {
      const total = g + edgeSeconds(graph, goalRev, mode) * (1 - goal.frac);
      if (total < best) {
        best = total;
        bestNode = node;
        bestVia = "back";
      }
    }
  };
  for (const s of seeds) consider(s.node, s.g);

  let guard = 0;
  while (heap.size && guard++ < 700000) {
    const item = heap.pop();
    if (!item) break;
    const node = item.n;
    if (closed[node] || item.s > fScore[node] + 1e-6) continue;
    const g = gScore[node];
    if (g + heur(node) >= best) break;
    closed[node] = 1;
    consider(node, g);
    for (let e = graph.head[node]; e !== -1; e = graph.next[e]) {
      if (!allows(graph, e, mode)) continue;
      const nxt = graph.to[e];
      const ng = g + edgeSeconds(graph, e, mode);
      if (ng >= gScore[nxt]) continue;
      gScore[nxt] = ng;
      parentNode[nxt] = node;
      parentEdge[nxt] = e;
      fScore[nxt] = ng + heur(nxt);
      heap.push(nxt, fScore[nxt]);
    }
  }
  if (bestNode < 0 || !bestVia) return null;

  const chain: number[] = [];
  let cursor = bestNode;
  const seen = new Set<number>();
  while (cursor >= 0 && parentNode[cursor] >= 0 && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(parentEdge[cursor]);
    cursor = parentNode[cursor];
  }
  chain.reverse();
  const seedEdge = parentEdge[bestNode] !== -1 && parentNode[bestNode] === -2 ? parentEdge[bestNode] : parentNode[cursor] === -2 ? parentEdge[cursor] : -1;
  let seedFrac = 0;
  let usedSeed = -1;
  for (const s of seeds) {
    if (s.node === (parentNode[bestNode] === -2 ? bestNode : cursor) && s.edge === (parentNode[bestNode] === -2 ? parentEdge[bestNode] : parentEdge[cursor])) {
      usedSeed = s.edge;
      seedFrac = s.fromFrac;
    }
  }
  if (parentNode[bestNode] === -2) {
    usedSeed = parentEdge[bestNode];
    seedFrac = seeds.find((s) => s.edge === usedSeed && s.node === bestNode)?.fromFrac ?? seedFrac;
  }

  const edges: number[] = [];
  const partials: [number, number][][] = [];
  if (usedSeed >= 0) {
    edges.push(usedSeed);
    partials.push(sliceGeom(graph, usedSeed, seedFrac, 1));
  }
  for (const e of chain) {
    if (e < 0 || e === usedSeed) continue;
    edges.push(e);
    partials.push(sliceGeom(graph, e, 0, 1));
  }
  if (bestVia === "fwd") {
    edges.push(goal.edge);
    partials.push(sliceGeom(graph, goal.edge, 0, goal.frac));
  } else if (goalRev >= 0) {
    edges.push(goalRev);
    partials.push(sliceGeom(graph, goalRev, 0, 1 - goal.frac));
  }

  const line: [number, number][] = [];
  for (const part of partials) {
    for (const p of part) {
      const last = line[line.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) line.push(p);
    }
  }
  if (line.length < 2) return null;
  let meters = 0;
  for (let i = 1; i < line.length; i++) meters += hav(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
  const steps = buildSteps(graph, edges, partials, meters);
  return { meters, seconds: best, line, steps };
}

function sameCorridor(graph: Graph, start: Snap, goal: Snap, mode: TravelMode): RouteResult | null {
  const candidates: { edge: number; a: number; b: number }[] = [];
  if (start.edge === goal.edge) candidates.push({ edge: start.edge, a: start.frac, b: goal.frac });
  const rs = graph.rev[start.edge];
  if (rs >= 0 && rs === goal.edge) candidates.push({ edge: goal.edge, a: 1 - start.frac, b: goal.frac });
  if (start.edge === graph.rev[goal.edge]) candidates.push({ edge: start.edge, a: start.frac, b: 1 - goal.frac });
  let best: RouteResult | null = null;
  for (const c of candidates) {
    if (!allows(graph, c.edge, mode)) continue;
    if (c.b + 1e-4 < c.a) continue;
    const line = sliceGeom(graph, c.edge, c.a, c.b);
    if (line.length < 2) continue;
    let meters = 0;
    for (let i = 1; i < line.length; i++) meters += hav(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    const seconds = (meters / Math.max(1, graph.meters[c.edge])) * edgeSeconds(graph, c.edge, mode);
    const steps = buildSteps(graph, [c.edge], [line], meters);
    const result = { meters, seconds, line, steps };
    if (!best || seconds < best.seconds) best = result;
  }
  return best;
}

export function formatDistance(meters: number) {
  if (meters < 950) return `${Math.max(1, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number) {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function progressAlong(line: [number, number][], lon: number, lat: number) {
  let best = 0;
  let bestD = Infinity;
  let walked = 0;
  let at = 0;
  for (let i = 1; i < line.length; i++) {
    const hit = project(lon, lat, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    if (hit.dist < bestD) {
      bestD = hit.dist;
      const seg = hav(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
      at = walked + seg * hit.t;
      best = i;
    }
    walked += hav(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
  }
  return { at, dist: bestD, index: best };
}
