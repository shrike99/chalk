/** Layouts for charts and quantities: bar, line, pie, number line, timeline, quadrant, fractions. */
import { textWidth } from "./common";
import { type SItem, type SLink, type SDecor, type Scene, curve, P, wrap } from "./scene";

const PALETTE = [
  ["#4f46e5", "#b9bcf3", "#f4f4ff"], ["#e8590c", "#f7c09d", "#fff6ef"], ["#2f9e44", "#a9dca5", "#f3fbf2"],
  ["#c2255c", "#f1a7c3", "#fff3f8"], ["#1971c2", "#a5cdf2", "#f1f8ff"], ["#9c36b5", "#dcb1e8", "#fbf3fe"],
  ["#e67700", "#f5cf8e", "#fffaf0"], ["#0c8599", "#9fd8e2", "#effbfd"],
];
export const colourVars = (i: number) => {
  const [stroke, hatch, bg] = PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
  return { "--sk-stroke": stroke, "--sk-hatch": hatch, "--sk-bg": bg, "--series": stroke };
};
const niceStep = (range: number, target = 6) => {
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
};
const fmt = (v: number) => (Math.abs(v) < 1e-9 ? "0" : Number(v.toPrecision(4)).toString());

// ---------------------------------------------------------------- bar chart
export function barLayout(s: any): Scene {
  const bars: any[] = s.bars;
  const H = 260, W = 58, GAP = 26;
  const max = Math.max(Number(s.max) || 0, ...bars.map((b) => b.value), 1);
  const items: SItem[] = [], decor: SDecor[] = [];
  bars.forEach((b, i) => {
    const x = i * (W + GAP), h = Math.max(2, (b.value / max) * H);
    items.push({ key: b.id, hid: b.id, x, y: 0, mark: b.mark, grow: true, vars: colourVars(b.colour ?? 0),
      shape: { type: "path", d: `M ${-W / 2} 0 L ${-W / 2} ${-h + 4} Q ${-W / 2} ${-h} ${-W / 2 + 4} ${-h} L ${W / 2 - 4} ${-h} Q ${W / 2} ${-h} ${W / 2} ${-h + 4} L ${W / 2} 0 Z`, w: W, h },
      label: `${b.label}: ${b.value}${s.unit ?? ""}` });
    items.push({ key: `${b.id}:v`, hid: b.id, x, y: -h - 14, texts: [{ text: `${fmt(b.value)}${s.unit ?? ""}`, cls: "small-strong" }] });
    items.push({ key: `${b.id}:l`, hid: b.id, x, y: 18, texts: [{ text: String(b.label), cls: "small" }] });
  });
  const w = Math.max(1, bars.length) * (W + GAP) - GAP;
  decor.push({ key: "base", d: `M ${-W / 2 - 14} 0 L ${w - W / 2 + 14} 0`, cls: "axis-line" });
  return { items, decor, bounds: [-W / 2 - 14, -H - 30, w + 28, H + 60], minW: 460, minH: 320 };
}

// ---------------------------------------------------------------- line chart
export function lineLayout(s: any): Scene {
  const pts = s.series.flatMap((se: any) => se.points) as [number, number][];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  let [x0, x1] = [Math.min(...xs, 0), Math.max(...xs, 1)], [y0, y1] = [Math.min(...ys, 0), Math.max(...ys, 1)];
  if (Array.isArray(s.x) && s.x.length === 2) [x0, x1] = s.x.map(Number);
  if (Array.isArray(s.y) && s.y.length === 2) [y0, y1] = s.y.map(Number);
  const ypad = (y1 - y0) * 0.08; y1 += ypad; if (y0 < 0) y0 -= ypad;
  const W = 500, H = 280;
  const sx = (x: number) => ((x - x0) / (x1 - x0 || 1)) * W, sy = (y: number) => -((y - y0) / (y1 - y0 || 1)) * H;
  const items: SItem[] = [], links: SLink[] = [], decor: SDecor[] = [];
  const xstep = niceStep(x1 - x0), ystep = niceStep(y1 - y0, 5);
  for (let v = Math.ceil(x0 / xstep) * xstep; v <= x1 + 1e-9; v += xstep) decor.push({ key: `xt${fmt(v)}`, text: fmt(v), x: sx(v), y: 16, cls: "decor-text tick-text" });
  for (let v = Math.ceil(y0 / ystep) * ystep; v <= y1 + 1e-9; v += ystep) {
    decor.push({ key: `yt${fmt(v)}`, text: fmt(v), x: -10, y: sy(v), anchor: "end", cls: "decor-text tick-text" });
    decor.push({ key: `yg${fmt(v)}`, d: `M 0 ${P(sy(v))} L ${W} ${P(sy(v))}`, cls: "grid-line", wobble: false });
  }
  decor.push({ key: "xaxis", d: `M 0 ${P(sy(Math.max(y0, Math.min(0, y1))))} L ${W} ${P(sy(Math.max(y0, Math.min(0, y1))))}`, cls: "axis-line" });
  decor.push({ key: "yaxis", d: `M 0 0 L 0 ${-H}`, cls: "axis-line" });
  if (s.x_label) decor.push({ key: "xl", text: s.x_label, x: W / 2, y: 38, cls: "decor-text axis-label" });
  if (s.y_label) decor.push({ key: "yl", text: s.y_label, x: 0, y: -H - 18, anchor: "start", cls: "decor-text axis-label" });
  s.series.forEach((se: any, si: number) => {
    const vars = colourVars(si);
    se.points.forEach((p: [number, number], i: number) => {
      items.push({ key: `${se.id}:p${i}`, hid: se.id, x: sx(p[0]), y: sy(p[1]), vars, shape: { type: "circle", w: 11, h: 11 }, label: `${se.label} at (${fmt(p[0])}, ${fmt(p[1])})` });
      const q = se.points[i + 1];
      if (q) links.push({ key: `${se.id}:s${i}`, hid: se.id, d: `M ${P(sx(p[0]))} ${P(sy(p[1]))} L ${P(sx(q[0]))} ${P(sy(q[1]))}`, arrow: "none", cls: `series s${si % 8}` });
    });
    const last = se.points[se.points.length - 1];
    if (last) items.push({ key: `${se.id}:label`, hid: se.id, x: sx(last[0]) + 10, y: sy(last[1]) - 14, vars, texts: [{ text: se.label, anchor: "start", cls: "series-label" }] });
  });
  return { items, links, decor, bounds: [-40, -H - 30, W + 120, H + 70], minW: 520, minH: 340 };
}

// ---------------------------------------------------------------- pie chart
const wedge = (r: number, a0: number, a1: number) => {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) return `M ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 Z`;
  const p = (a: number) => `${P(Math.cos(a) * r)} ${P(Math.sin(a) * r)}`;
  return `M 0 0 L ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`;
};
export function pieLayout(s: any): Scene {
  const total = s.slices.reduce((t: number, p: any) => t + p.value, 0) || 1;
  const R = 130;
  const items: SItem[] = [];
  let a = -Math.PI / 2;
  s.slices.forEach((p: any, i: number) => {
    const span = (p.value / total) * Math.PI * 2;
    const mid = a + span / 2;
    const vars = { ...colourVars(i), "--ex": `${P(Math.cos(mid) * 12)}px`, "--ey": `${P(Math.sin(mid) * 12)}px` };
    items.push({ key: p.id, hid: p.id, x: 0, y: 0, noMove: true, mark: p.mark, vars, cls: "slice", shape: { type: "path", d: wedge(R, a, a + span), w: 2 * R, h: 2 * R }, label: p.label });
    const lr = R + 34;
    const pct = Math.round((p.value / total) * 100);
    items.push({ key: `${p.id}:l`, hid: p.id, x: Math.cos(mid) * lr, y: Math.sin(mid) * lr, vars,
      texts: [{ text: p.label, anchor: Math.cos(mid) < -0.2 ? "end" : Math.cos(mid) > 0.2 ? "start" : "middle", cls: "small-strong", dy: -8 },
        { text: `${pct}%`, anchor: Math.cos(mid) < -0.2 ? "end" : Math.cos(mid) > 0.2 ? "start" : "middle", cls: "small", dy: 9 }] });
    a += span;
  });
  return { items, bounds: [-R - 120, -R - 50, 2 * R + 240, 2 * R + 100], minW: 460, minH: 360 };
}

// ---------------------------------------------------------------- number line
export function numberLineLayout(s: any): Scene {
  const W = 600, min = s.min, max = s.max;
  const X = (v: number) => ((Number(v) - min) / (max - min)) * W - W / 2;
  const step = s.step || niceStep(max - min, 10);
  const items: SItem[] = [], links: SLink[] = [], decor: SDecor[] = [];
  decor.push({ key: "axis", d: `M ${-W / 2 - 20} 0 L ${W / 2 + 20} 0`, cls: "axis-line" });
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    decor.push({ key: `t${fmt(v)}`, d: `M ${P(X(v))} -6 L ${P(X(v))} 6`, cls: "axis-line" });
    decor.push({ key: `tl${fmt(v)}`, text: fmt(v), x: X(v), y: 22, cls: "decor-text tick-text" });
  }
  for (const iv of s.intervals) {
    const a = X(Math.max(min, Math.min(max, Number(iv.from ?? min)))), b = X(Math.max(min, Math.min(max, Number(iv.to ?? max))));
    links.push({ key: `iv:${iv.id}`, hid: iv.id, d: `M ${P(a)} 0 L ${P(b)} 0`, arrow: "none", cls: "interval", wobble: false });
    const closed = Array.isArray(iv.closed) ? iv.closed : [iv.closed !== false, iv.closed !== false];
    if (iv.from !== undefined) items.push({ key: `${iv.id}:a`, hid: iv.id, x: a, y: 0, cls: closed[0] ? "endpoint closed" : "endpoint open", shape: { type: "circle", w: 14, h: 14 }, hatch: false });
    if (iv.to !== undefined) items.push({ key: `${iv.id}:b`, hid: iv.id, x: b, y: 0, cls: closed[1] ? "endpoint closed" : "endpoint open", shape: { type: "circle", w: 14, h: 14 }, hatch: false });
    if (iv.label) items.push({ key: `${iv.id}:l`, hid: iv.id, x: (a + b) / 2, y: 46, texts: [{ text: iv.label, cls: "small-strong accent-text" }] });
  }
  for (const j of s.jumps) {
    const a = X(j.from), b = X(j.to), bend = Math.min(90, Math.abs(b - a) * 0.45 + 18);
    links.push({ key: `j:${j.id}`, hid: j.id, d: curve(a, -10, b, -10, b > a ? -bend : bend), cls: "accent" });
    if (j.label) items.push({ key: `${j.id}:l`, hid: j.id, x: (a + b) / 2, y: -10 - bend * 0.8 - 12, texts: [{ text: j.label, cls: "small-strong accent-text" }] });
  }
  for (const p of s.points) {
    items.push({ key: p.id, hid: p.id, x: X(p.x), y: 0, mark: p.mark, cls: "nl-point", shape: { type: "circle", w: 16, h: 16 },
      texts: p.label ? [{ text: String(p.label), dy: -24, cls: "small-strong" }] : [], label: String(p.label ?? p.x) });
  }
  return { items, links, decor, bounds: [-W / 2 - 30, -120, W + 60, 180], minW: 640, minH: 240 };
}

// ---------------------------------------------------------------- timeline
export function timelineLayout(s: any): Scene {
  const ev: any[] = s.events;
  const nums = ev.map((e) => Number(String(e.date ?? "").replace(/[^\d.-]/g, "")));
  const numeric = ev.length > 1 && nums.every((n) => Number.isFinite(n)) && Math.max(...nums) > Math.min(...nums);
  const SP = 190;
  const span = numeric ? Math.max(SP * (ev.length - 1), 500) : SP * Math.max(ev.length - 1, 1);
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const xOf = (i: number) => (numeric ? ((nums[i] - lo) / (hi - lo)) * span : i * SP);
  const items: SItem[] = [], links: SLink[] = [], decor: SDecor[] = [];
  decor.push({ key: "axis", d: `M -40 0 L ${P(Math.max(span, 0) + 40)} 0`, cls: "axis-line" });
  ev.forEach((e, i) => {
    const x = xOf(i), up = i % 2 === 0;
    const lines = wrap(String(e.label ?? ""), 20);
    const det = e.detail ? wrap(String(e.detail), 24) : [];
    const h = 30 + lines.length * 18 + det.length * 16;
    const cy = up ? -40 - h / 2 : 40 + h / 2;
    items.push({ key: `${e.id}:dot`, hid: e.id, x, y: 0, mark: e.mark, shape: { type: "circle", w: 16, h: 16 }, cls: "tl-dot" });
    links.push({ key: `${e.id}:stem`, hid: e.id, d: `M ${P(x)} ${up ? -9 : 9} L ${P(x)} ${P(up ? cy + h / 2 : cy - h / 2)}`, arrow: "none", cls: "faint" });
    items.push({ key: e.id, hid: e.id, x, y: cy, mark: e.mark, shape: { type: "rect", w: 168, h, r: 8 }, hatch: false, label: String(e.label ?? e.date),
      texts: [{ text: String(e.date ?? ""), dy: -h / 2 + 16, cls: "small-strong accent-text" },
        ...lines.map((l, k) => ({ text: l, dy: -h / 2 + 36 + k * 18, cls: "label" })),
        ...det.map((l, k) => ({ text: l, dy: -h / 2 + 38 + lines.length * 18 + k * 16, cls: "small" }))] });
  });
  return { items, links, decor, bounds: [-100, -200, span + 200, 400], minW: 560, minH: 360 };
}

// ---------------------------------------------------------------- 2x2 quadrant
export function quadrantLayout(s: any): Scene {
  const S = 400, h = S / 2;
  const items: SItem[] = [], decor: SDecor[] = [];
  decor.push({ key: "box", d: `M ${-h} ${-h} L ${h} ${-h} L ${h} ${h} L ${-h} ${h} Z`, cls: "axis-line faint-line" });
  decor.push({ key: "vx", d: `M 0 ${-h} L 0 ${h}`, cls: "axis-line" });
  decor.push({ key: "hx", d: `M ${-h} 0 L ${h} 0`, cls: "axis-line" });
  const q = s.quadrants ?? [];
  [[-h / 2, -h / 2], [h / 2, -h / 2], [-h / 2, h / 2], [h / 2, h / 2]].forEach(([x, y], i) => {
    if (q[i]) items.push({ key: `q${i}`, hid: `q${i}`, x, y, cls: "quad-label", texts: wrap(String(q[i]), 18).map((t, k, all) => ({ text: t, dy: (k - (all.length - 1) / 2) * 18, cls: "quad-text" })), label: String(q[i]) });
  });
  const [xl, xh] = s.x_axis ?? ["", ""], [yl, yh] = s.y_axis ?? ["", ""];
  decor.push({ key: "xl", text: String(xl), x: -h, y: h + 20, anchor: "start", cls: "decor-text axis-label" });
  decor.push({ key: "xh", text: `${xh} →`, x: h, y: h + 20, anchor: "end", cls: "decor-text axis-label" });
  decor.push({ key: "yl", text: String(yl), x: -h - 10, y: h, anchor: "end", cls: "decor-text axis-label" });
  decor.push({ key: "yh", text: `↑ ${yh}`, x: -h - 10, y: -h, anchor: "end", cls: "decor-text axis-label" });
  for (const it of s.items) {
    const x = (Math.max(0, Math.min(1, Number(it.x ?? 0.5))) - 0.5) * S, y = -(Math.max(0, Math.min(1, Number(it.y ?? 0.5))) - 0.5) * S;
    items.push({ key: it.id, hid: it.id, x, y, mark: it.mark, shape: { type: "circle", w: 16, h: 16 }, cls: "q-dot", texts: [{ text: String(it.label ?? it.id), dx: 13, anchor: "start", cls: "small-strong" }], label: String(it.label ?? it.id) });
  }
  return { items, decor, bounds: [-h - 90, -h - 20, S + 120, S + 60], minW: 520, minH: 460 };
}

// ---------------------------------------------------------------- fractions (area models)
export function fractionLayout(s: any): Scene {
  const items: SItem[] = [], decor: SDecor[] = [];
  const BW = 360, BH = 54, R = 70;
  let y = 0, maxW = BW;
  s.wholes.forEach((w: any, wi: number) => {
    const vars = colourVars(w.colour ?? wi);
    const frac = `${w.shaded}/${w.parts}`;
    if (w.shape === "circle") {
      const cy = y + R;
      for (let k = 0; k < w.parts; k++) {
        const a0 = -Math.PI / 2 + (k / w.parts) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / w.parts;
        items.push({ key: `${w.id}:${k}`, hid: `${w.id}:${k}`, ends: `${w.id} ${w.id}`, x: 0, y: cy, noMove: true, vars, cls: k < w.shaded ? "part shaded" : "part", hatch: k < w.shaded,
          shape: { type: "path", d: wedge(R, a0, a1), w: 2 * R, h: 2 * R }, label: `part ${k + 1} of ${frac}` });
      }
      items.push({ key: `${w.id}:label`, hid: w.id, x: R + 30, y: cy, texts: [{ text: frac, anchor: "start", cls: "big-value", dy: -8 }, ...(w.label ? [{ text: String(w.label), anchor: "start" as const, cls: "small", dy: 18 }] : [])] });
      y += 2 * R + 34;
    } else {
      const pw = BW / w.parts, cy = y + BH / 2;
      for (let k = 0; k < w.parts; k++) {
        items.push({ key: `${w.id}:${k}`, hid: `${w.id}:${k}`, ends: `${w.id} ${w.id}`, x: -BW / 2 + pw * (k + 0.5), y: cy, noMove: true, vars, cls: k < w.shaded ? "part shaded" : "part", hatch: k < w.shaded,
          shape: { type: "rect", w: pw, h: BH }, label: `part ${k + 1} of ${frac}` });
      }
      items.push({ key: `${w.id}:label`, hid: w.id, x: BW / 2 + 24, y: cy, texts: [{ text: frac, anchor: "start", cls: "big-value", dy: w.label ? -8 : 0 }, ...(w.label ? [{ text: String(w.label), anchor: "start" as const, cls: "small", dy: 16 }] : [])] });
      y += BH + 30;
    }
    maxW = Math.max(maxW, BW);
  });
  return { items, decor, bounds: [-maxW / 2 - 10, -10, maxW + 140, Math.max(y, 60)], minW: 520, minH: 240 };
}
