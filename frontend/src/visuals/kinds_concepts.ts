/** Layouts for concept kinds: venn, mind map, cycle, layers, pyramid, compare, steps, geometry. */
import { textWidth } from "./common";
import { type SItem, type SLink, type SDecor, type Scene, boxEdge, curve, P, wrap } from "./scene";
import { colourVars } from "./kinds_charts";

const LABEL_FONT = "500 14px Inter, system-ui";
const textBlock = (label: string, detail: string | undefined, maxChars: number, width: number) => {
  const l = wrap(label, maxChars), d = detail ? wrap(detail, Math.round(maxChars * 1.15)) : [];
  const h = 22 + l.length * 18 + d.length * 16 + (d.length ? 4 : 0);
  const texts = [
    ...l.map((t, k) => ({ text: t, dy: -h / 2 + 20 + k * 18, cls: "label" })),
    ...d.map((t, k) => ({ text: t, dy: -h / 2 + 24 + l.length * 18 + k * 16, cls: "small" })),
  ];
  return { h, texts, w: width };
};

// ---------------------------------------------------------------- venn
export function vennLayout(s: any): Scene {
  const sets: any[] = s.sets;
  const n = sets.length;
  const R = n === 3 ? 125 : 135;
  const centres: [number, number][] = n === 1 ? [[0, 0]] : n === 2 ? [[-85, 0], [85, 0]] : [[-78, -48], [78, -48], [0, 84]];
  const items: SItem[] = [];
  sets.forEach((st, i) => {
    const [cx, cy] = centres[i];
    items.push({ key: `set:${st.id}`, hid: st.id, x: cx, y: cy, layer: "back", noMove: true, vars: colourVars(i), cls: `vset hatch${i}`, mark: st.mark,
      shape: { type: "circle", w: 2 * R, h: 2 * R }, label: st.label });
    const ly = n === 3 && i === 2 ? cy + R + 18 : cy - R - 18;
    items.push({ key: `setlabel:${st.id}`, hid: st.id, x: cx + (n >= 2 && i < 2 ? (i === 0 ? -40 : 40) : 0), y: ly, vars: colourVars(i), texts: [{ text: String(st.label ?? st.id), cls: "set-label" }] });
  });
  // where an item goes: the middle of the region for its combination of sets
  const anchor = (inn: string[]): [number, number] => {
    const idx = sets.map((st, i) => (inn.includes(st.id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return [0, n === 3 ? R + 120 : R + 50];
    const inc = idx.map((i) => centres[i]);
    let [x, y] = [inc.reduce((t, c) => t + c[0], 0) / inc.length, inc.reduce((t, c) => t + c[1], 0) / inc.length];
    const out = centres.filter((_, i) => !idx.includes(i));
    if (out.length) {
      const [ox, oy] = [out.reduce((t, c) => t + c[0], 0) / out.length, out.reduce((t, c) => t + c[1], 0) / out.length];
      const dx = x - ox, dy = y - oy, len = Math.hypot(dx, dy) || 1;
      const push = idx.length === 1 ? R * 0.55 : 22;
      x += (dx / len) * push; y += (dy / len) * push;
    }
    return [x, y];
  };
  const groups = new Map<string, any[]>();
  for (const it of s.items) { const k = [...it.in].sort().join("&"); groups.set(k, [...(groups.get(k) ?? []), it]); }
  for (const [, list] of groups) list.forEach((it, k) => {
    const [ax, ay] = anchor(it.in);
    const w = Math.max(40, textWidth(String(it.label ?? it.id), "500 13px Inter") + 18);
    items.push({ key: it.id, hid: it.id, x: ax, y: ay + (k - (list.length - 1) / 2) * 28, mark: it.mark, cls: "chip", hatch: false,
      shape: { type: "rect", w, h: 24, r: 12 }, texts: [{ text: String(it.label ?? it.id), cls: "chip-text" }] });
  });
  return { items, bounds: [-R - 100, -R - 90, 2 * R + 200, 2 * R + (n === 3 ? 250 : 170)], minW: 520, minH: 400 };
}

// ---------------------------------------------------------------- mind map (radial)
export function mindmapLayout(s: any): Scene {
  const nodes: any[] = s.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, any[]>();
  for (const n of nodes) if (n.parent !== undefined && byId.has(String(n.parent))) kids.set(String(n.parent), [...(kids.get(String(n.parent)) ?? []), n]);
  const root = nodes.find((n) => n.parent === undefined || !byId.has(String(n.parent)));
  const items: SItem[] = [], links: SLink[] = [];
  if (!root) return { items, bounds: [0, 0, 100, 100] };
  const leaves = (n: any): number => { const c = kids.get(n.id) ?? []; return c.length ? c.reduce((t, k) => t + leaves(k), 0) : 1; };
  const size = (n: any, depth: number) => {
    const lines = wrap(String(n.label ?? n.id), depth === 0 ? 16 : 18);
    const w = Math.max(70, ...lines.map((l) => textWidth(l, LABEL_FONT))) + (depth === 0 ? 40 : 26);
    return { w, h: 20 + lines.length * 18 + (depth === 0 ? 14 : 0), lines };
  };
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  const placeNode = (n: any, depth: number, a0: number, a1: number, ci: number) => {
    const z = size(n, depth);
    const a = (a0 + a1) / 2, r = depth * 175;
    const x = Math.cos(a) * r * 1.25, y = Math.sin(a) * r * 0.85;
    pos.set(n.id, { x, y, w: z.w, h: z.h });
    items.push({ key: n.id, hid: n.id, x, y, mark: n.mark, vars: depth === 0 ? {} : colourVars(ci), cls: depth === 0 ? "mm-root" : "mm-node",
      shape: { type: "rect", w: z.w, h: z.h, r: Math.min(z.h / 2, 18) }, hatch: depth <= 1,
      texts: z.lines.map((t, k) => ({ text: t, dy: (k - (z.lines.length - 1) / 2) * 18, cls: depth === 0 ? "label strong" : "label" })) });
    const c = kids.get(n.id) ?? [];
    const total = c.reduce((t, k) => t + leaves(k), 0);
    let start = a0;
    c.forEach((k, i) => {
      const span = ((a1 - a0) * leaves(k)) / (total || 1);
      placeNode(k, depth + 1, start, start + span, depth === 0 ? i : ci);
      start += span;
      const p = pos.get(n.id)!, q = pos.get(k.id)!;
      const [x1, y1] = boxEdge(p.x, p.y, p.w, p.h, q.x, q.y), [x2, y2] = boxEdge(q.x, q.y, q.w, q.h, p.x, p.y);
      links.push({ key: `${n.id}->${k.id}`, hid: `${n.id}->${k.id}`, ends: `${n.id} ${k.id}`, d: curve(x1, y1, x2, y2, 14), arrow: "none", cls: "mm-link", });
    });
  };
  placeNode(root, 0, -Math.PI / 2, (Math.PI * 3) / 2, 0);
  const all = [...pos.values()];
  const x0 = Math.min(...all.map((p) => p.x - p.w / 2)), x1 = Math.max(...all.map((p) => p.x + p.w / 2));
  const y0 = Math.min(...all.map((p) => p.y - p.h / 2)), y1 = Math.max(...all.map((p) => p.y + p.h / 2));
  return { items, links, bounds: [x0, y0, x1 - x0, y1 - y0], minW: 520, minH: 380 };
}

// ---------------------------------------------------------------- cycle
export function cycleLayout(s: any): Scene {
  const st: any[] = s.stages;
  const n = Math.max(st.length, 1);
  const R = Math.max(150, n * 36);
  const items: SItem[] = [], links: SLink[] = [];
  const ang = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  st.forEach((x, i) => {
    const b = textBlock(String(x.label ?? x.id), x.detail, 16, 150);
    const w = Math.max(110, ...wrap(String(x.label ?? x.id), 16).map((l) => textWidth(l, LABEL_FONT) + 30));
    items.push({ key: x.id, hid: x.id, x: Math.cos(ang(i)) * R, y: Math.sin(ang(i)) * R, mark: x.mark, vars: colourVars(i), shape: { type: "rect", w, h: b.h, r: 12 }, texts: b.texts });
  });
  if (st.length > 1) st.forEach((x, i) => {
    const y = st[(i + 1) % st.length];
    const gap = Math.min(0.42, (Math.PI / n) * 0.55);
    const a0 = ang(i) + gap, a1 = ang(i + 1) - gap;
    const p = (a: number) => [Math.cos(a) * R, Math.sin(a) * R] as const;
    const [x1, y1] = p(a0), [x2, y2] = p(a1);
    const bend = R * (1 - Math.cos((a1 - a0) / 2)) * 1.3 + 6;
    links.push({ key: `${x.id}->${y.id}`, hid: `${x.id}->${y.id}`, ends: `${x.id} ${y.id}`, d: curve(x1, y1, x2, y2, -bend), cls: "accent" });
  });
  return { items, links, bounds: [-R - 90, -R - 60, 2 * R + 180, 2 * R + 120], minW: 480, minH: 420 };
}

// ---------------------------------------------------------------- layers (stack of bands)
export function layersLayout(s: any): Scene {
  const items: SItem[] = [];
  const W = 440;
  let y = 0;
  s.layers.forEach((l: any, i: number) => {
    const b = textBlock(String(l.label ?? l.id), l.detail, 40, W);
    const h = Math.max(50, b.h);
    items.push({ key: l.id, hid: l.id, x: 0, y: y + h / 2, mark: l.mark, vars: colourVars(i), shape: { type: "rect", w: W, h, r: 8 }, texts: b.texts.map((t) => ({ ...t, dy: t.dy + (h - b.h) / 2 * 0 })) });
    y += h + 8;
  });
  return { items, bounds: [-W / 2, 0, W, Math.max(y - 8, 60)], minW: 520, minH: 300 };
}

// ---------------------------------------------------------------- pyramid
export function pyramidLayout(s: any): Scene {
  const items: SItem[] = [];
  const lv: any[] = s.levels;
  const n = Math.max(lv.length, 1), H = 66, W = 480;
  lv.forEach((l, i) => {
    const tw = (W * i) / n, bw = (W * (i + 1)) / n, cy = i * (H + 4) + H / 2;
    const d = `M ${P(-tw / 2)} ${-H / 2} L ${P(tw / 2)} ${-H / 2} L ${P(bw / 2)} ${H / 2} L ${P(-bw / 2)} ${H / 2} Z`;
    const label = String(l.label ?? l.id);
    const fits = textWidth(label, LABEL_FONT) + 24 < (tw + bw) / 2;
    const side = bw / 2 - (bw - tw) / 4 + 14; // just right of the slanted edge, at mid-height
    const texts = fits
      ? [{ text: label, dy: l.detail ? 0 : 6, cls: "label" }, ...(l.detail ? [{ text: String(l.detail), dx: side, anchor: "start" as const, cls: "small" }] : [])]
      : [{ text: label, dx: side, dy: l.detail ? -8 : 0, anchor: "start" as const, cls: "label" }, ...(l.detail ? [{ text: String(l.detail), dx: side, dy: 10, anchor: "start" as const, cls: "small" }] : [])];
    items.push({ key: l.id, hid: l.id, x: 0, y: cy, mark: l.mark, vars: colourVars(i), shape: { type: "path", d, w: bw, h: H }, texts, label });
  });
  return { items, bounds: [-W / 2, 0, W + 200, n * (H + 4)], minW: 560, minH: 320 };
}

// ---------------------------------------------------------------- compare (columns of cards)
export function compareLayout(s: any): Scene {
  const items: SItem[] = [];
  const CW = 230, GAP = 34;
  const cols: any[] = s.columns;
  let maxY = 60;
  cols.forEach((c, ci) => {
    const x = ci * (CW + GAP);
    items.push({ key: `col:${c.id}`, hid: c.id, x, y: 0, vars: colourVars(ci === 0 ? 2 : ci === 1 ? 3 : ci + 2), mark: c.mark, cls: "col-head",
      shape: { type: "rect", w: CW, h: 44, r: 8 }, texts: [{ text: String(c.title ?? c.label ?? c.id), cls: "label strong" }] });
    let y = 40;
    for (const it of s.items.filter((x: any) => String(x.column) === c.id)) {
      const lines = wrap(String(it.text ?? it.label ?? it.id), 26);
      const h = 18 + lines.length * 18;
      items.push({ key: it.id, hid: it.id, x, y: y + h / 2, mark: it.mark, hatch: false, shape: { type: "rect", w: CW - 12, h, r: 7 },
        texts: lines.map((t, k) => ({ text: t, dy: (k - (lines.length - 1) / 2) * 18, cls: "label" })) });
      y += h + 10;
    }
    maxY = Math.max(maxY, y);
  });
  const w = Math.max(cols.length, 1) * (CW + GAP) - GAP;
  return { items, bounds: [-CW / 2, -22, w, maxY + 22], minW: 520, minH: 320 };
}

// ---------------------------------------------------------------- steps (numbered process)
export function stepsLayout(s: any): Scene {
  const items: SItem[] = [], links: SLink[] = [];
  const st: any[] = s.steps;
  const vertical = s.direction === "TB";
  const CW = 180, GAPX = 54, GAPY = 46, PER = vertical ? 1 : 4;
  const blocks = st.map((x) => textBlock(String(x.label ?? x.id), x.detail, 18, CW));
  const rowH = Math.max(70, ...blocks.map((b) => b.h));
  const pos = st.map((_, i) => {
    const r = Math.floor(i / PER), c = i % PER;
    return { x: c * (CW + GAPX), y: r * (rowH + GAPY) };
  });
  st.forEach((x, i) => {
    const { x: px, y: py } = pos[i];
    items.push({ key: x.id, hid: x.id, x: px, y: py, mark: x.mark, shape: { type: "rect", w: CW, h: rowH, r: 10 }, hatch: false,
      texts: blocks[i].texts.map((t: any) => ({ ...t, dy: t.dy + 6 })) });
    items.push({ key: `${x.id}:n`, hid: x.id, x: px - CW / 2 + 4, y: py - rowH / 2 + 4, vars: colourVars(0), cls: "step-num", shape: { type: "circle", w: 28, h: 28 }, texts: [{ text: String(i + 1), cls: "step-num-text" }] });
    const nx = st[i + 1];
    if (nx) {
      const q = pos[i + 1];
      const d = q.y === py ? curve(px + CW / 2 + 4, py, q.x - CW / 2 - 6, q.y)
        : vertical ? curve(px, py + rowH / 2 + 4, q.x, q.y - rowH / 2 - 6) : curve(px, py + rowH / 2 + 4, q.x, q.y - rowH / 2 - 6, 60);
      links.push({ key: `${x.id}->${nx.id}`, hid: `${x.id}->${nx.id}`, ends: `${x.id} ${nx.id}`, d, cls: "accent" });
    }
  });
  const cols = Math.min(PER, Math.max(st.length, 1)), rows = Math.ceil(Math.max(st.length, 1) / PER);
  return { items, links, bounds: [-CW / 2 - 16, -rowH / 2 - 16, cols * (CW + GAPX) - GAPX + 32, rows * (rowH + GAPY) - GAPY + 32], minW: 480, minH: 260 };
}

// ---------------------------------------------------------------- geometry (coordinate plane)
export function geometryLayout(s: any): Scene {
  const [x0, x1] = Array.isArray(s.x) ? s.x.map(Number) : [-1, 10];
  const [y0, y1] = Array.isArray(s.y) ? s.y.map(Number) : [-1, 7];
  const U = Math.min(560 / (x1 - x0 || 1), 400 / (y1 - y0 || 1));
  const X = (x: number) => (x - x0) * U, Y = (y: number) => -(y - y0) * U;
  const items: SItem[] = [], links: SLink[] = [], decor: SDecor[] = [];
  const pts = new Map<string, [number, number]>(s.points.map((p: any) => [p.id, [Number(p.x), Number(p.y)]]));
  const at = (ref: any): [number, number] | null => Array.isArray(ref) ? [Number(ref[0]), Number(ref[1])] : pts.get(String(ref)) ?? null;
  if (s.grid !== false) {
    for (let x = Math.ceil(x0); x <= x1; x++) decor.push({ key: `gx${x}`, d: `M ${P(X(x))} ${P(Y(y0))} L ${P(X(x))} ${P(Y(y1))}`, cls: x === 0 ? "axis-line" : "grid-line", wobble: x === 0 });
    for (let y = Math.ceil(y0); y <= y1; y++) decor.push({ key: `gy${y}`, d: `M ${P(X(x0))} ${P(Y(y))} L ${P(X(x1))} ${P(Y(y))}`, cls: y === 0 ? "axis-line" : "grid-line", wobble: y === 0 });
    for (let x = Math.ceil(x0); x <= x1; x++) if (x !== 0) decor.push({ key: `lx${x}`, text: String(x), x: X(x), y: Y(Math.max(y0, Math.min(0, y1))) + 14, cls: "decor-text tick-text" });
    for (let y = Math.ceil(y0); y <= y1; y++) if (y !== 0) decor.push({ key: `ly${y}`, text: String(y), x: X(Math.max(x0, Math.min(0, x1))) - 10, y: Y(y), anchor: "end", cls: "decor-text tick-text" });
  }
  s.polygons.forEach((pg: any, i: number) => {
    const ps = (pg.points ?? []).map(at).filter(Boolean) as [number, number][];
    if (ps.length < 3) return;
    const d = ps.map((p, k) => `${k ? "L" : "M"} ${P(X(p[0]))} ${P(Y(p[1]))}`).join(" ") + " Z";
    items.push({ key: `pg:${pg.id}`, hid: pg.id, x: 0, y: 0, noMove: true, layer: "back", mark: pg.mark, vars: colourVars(i + 1), cls: "geo-shape", shape: { type: "path", d, w: 1, h: 1 }, label: pg.label ?? pg.id });
    if (pg.label) {
      const cx = ps.reduce((t, p) => t + p[0], 0) / ps.length, cy = ps.reduce((t, p) => t + p[1], 0) / ps.length;
      items.push({ key: `pgl:${pg.id}`, hid: pg.id, x: X(cx), y: Y(cy), texts: [{ text: String(pg.label), cls: "small-strong" }] });
    }
  });
  s.circles.forEach((c: any, i: number) => {
    const ctr = at(c.center ?? [c.cx, c.cy]); if (!ctr) return;
    const r = Number(c.r) * U;
    items.push({ key: `c:${c.id}`, hid: c.id, x: X(ctr[0]), y: Y(ctr[1]), layer: "back", mark: c.mark, vars: colourVars(i + 3), cls: "geo-shape", hatch: false, shape: { type: "circle", w: 2 * r, h: 2 * r },
      texts: c.label ? [{ text: String(c.label), dy: -r - 12, cls: "small-strong" }] : [], label: c.label ?? c.id });
  });
  for (const [coll, arrow] of [["segments", "none"], ["vectors", "end"]] as const) for (const sg of s[coll]) {
    const a = at(sg.from), b = at(sg.to); if (!a || !b) continue;
    links.push({ key: `${coll}:${sg.id}`, hid: sg.id, ends: typeof sg.from === "string" && typeof sg.to === "string" ? undefined : undefined, d: `M ${P(X(a[0]))} ${P(Y(a[1]))} L ${P(X(b[0]))} ${P(Y(b[1]))}`, arrow, cls: coll === "vectors" ? "accent vector" : "segment",
      label: sg.label ? String(sg.label) : "", lx: (X(a[0]) + X(b[0])) / 2 + 12, ly: (Y(a[1]) + Y(b[1])) / 2 - 12 });
  }
  for (const an of s.angles) {
    const v = at(an.at), a = at(an.from), b = at(an.to); if (!v || !a || !b) continue;
    const r = 26;
    const a0 = Math.atan2(-(a[1] - v[1]), a[0] - v[0]), a1 = Math.atan2(-(b[1] - v[1]), b[0] - v[0]);
    let da = a1 - a0; while (da <= -Math.PI) da += 2 * Math.PI; while (da > Math.PI) da -= 2 * Math.PI;
    const p0 = [X(v[0]) + Math.cos(a0) * r, Y(v[1]) + Math.sin(a0) * r], p1 = [X(v[0]) + Math.cos(a0 + da) * r, Y(v[1]) + Math.sin(a0 + da) * r];
    links.push({ key: `ang:${an.id}`, hid: an.id, d: `M ${P(p0[0])} ${P(p0[1])} A ${r} ${r} 0 0 ${da > 0 ? 1 : 0} ${P(p1[0])} ${P(p1[1])}`, arrow: "none", cls: "accent angle",
      label: an.label ? String(an.label) : "", lx: X(v[0]) + Math.cos(a0 + da / 2) * (r + 16), ly: Y(v[1]) + Math.sin(a0 + da / 2) * (r + 16) });
  }
  for (const p of s.points) {
    items.push({ key: `p:${p.id}`, hid: p.id, x: X(Number(p.x)), y: Y(Number(p.y)), mark: p.mark, cls: "geo-point", shape: { type: "circle", w: 12, h: 12 },
      texts: [{ text: String(p.label ?? p.id), dx: 10, dy: -12, anchor: "start", cls: "small-strong" }], label: `${p.label ?? p.id} (${p.x}, ${p.y})` });
  }
  return { items, links, decor, bounds: [X(x0), Y(y1), X(x1) - X(x0), Y(y0) - Y(y1)], minW: 520, minH: 380 };
}
