/**
 * Exam figures Chalk draws from a description, so they're exact: graphs (functions, lines, points,
 * bar charts), geometry (points, sides, angles, circles) and circuits (UK symbols, series and
 * parallel). Claude decides what to show; this decides where every line goes.
 *
 * Everything is black ink on white, like a printed paper. Each function returns an SVG string or
 * throws with a short reason (shown in place of the figure, and counted by the layout report).
 */
import { escHtml as esc } from "./md";

type Num = number;
type Pt = [Num, Num];
const FONT = `font-family="Inter, 'Segoe UI', sans-serif"`;
const SERIF = `font-family="'KaTeX_Math', 'Times New Roman', serif" font-style="italic"`;
const fmt = (n: number) => (Math.abs(n) < 1e-9 ? "0" : Number(n.toFixed(2)).toString());
const num = (v: unknown, name: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
const pair = (v: unknown, name: string): Pt => {
  if (!Array.isArray(v) || v.length !== 2) throw new Error(`${name} must be [x, y]`);
  return [num(v[0], name), num(v[1], name)];
};
/** Plain-text labels: a few maths niceties without needing KaTeX inside SVG. */
const tidy = (s: unknown) => esc(String(s ?? "").replace(/\^2/g, "²").replace(/\^3/g, "³").replace(/-(?=\d|x|\s)/g, "−").replace(/\*/g, "×").replace(/\$/g, ""));

// ------------------------------------------------------------------ expressions: "x^2 - 4x + 3", "2sin(x)", "sqrt(x+1)"
type Tok = { t: "n"; v: number } | { t: "x" } | { t: "op"; v: string } | { t: "f"; v: string } | { t: "(" } | { t: ")" } | { t: "c"; v: number };
const FUNCS: Record<string, (a: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10,
  exp: Math.exp, asin: Math.asin, acos: Math.acos, atan: Math.atan,
};
function tokenize(src: string): Tok[] {
  const s = src.replace(/\s+/g, "").replace(/×/g, "*").replace(/−/g, "-").replace(/²/g, "^2").replace(/³/g, "^3").replace(/π/g, "pi")
    .replace(/^y=/, "").replace(/\*\*/g, "^");
  const out: Tok[] = [];
  for (let i = 0; i < s.length;) {
    const rest = s.slice(i);
    const m = rest.match(/^\d*\.?\d+(e[+-]?\d+)?/i);
    if (m) { out.push({ t: "n", v: Number(m[0]) }); i += m[0].length; continue; }
    const f = rest.match(/^(asin|acos|atan|sqrt|sin|cos|tan|abs|exp|ln|log)/);
    if (f) { out.push({ t: "f", v: f[1] }); i += f[1].length; continue; }
    if (rest.startsWith("pi")) { out.push({ t: "c", v: Math.PI }); i += 2; continue; }
    const c = s[i];
    if (c === "x") out.push({ t: "x" });
    else if (c === "e") out.push({ t: "c", v: Math.E });
    else if ("+-*/^".includes(c)) out.push({ t: "op", v: c });
    else if (c === "(") out.push({ t: "(" });
    else if (c === ")") out.push({ t: ")" });
    else throw new Error(`can't read "${c}" in ${src}`);
    i++;
  }
  // Implicit multiplication: 4x, 2(x+1), x(x-1), 3sin(x), (x+1)(x-1)
  const full: Tok[] = [];
  for (const t of out) {
    const prev = full[full.length - 1];
    const prevEnds = prev && (prev.t === "n" || prev.t === "x" || prev.t === ")" || prev.t === "c");
    const starts = t.t === "n" || t.t === "x" || t.t === "(" || t.t === "f" || t.t === "c";
    if (prevEnds && starts) full.push({ t: "op", v: "*" });
    full.push(t);
  }
  return full;
}
/** Compile an expression in x to a function (recursive descent; no eval). */
export function compile(src: string): (x: number) => number {
  const toks = tokenize(String(src));
  let i = 0;
  type Node = (x: number) => number;
  const peek = () => toks[i];
  const expr = (): Node => {
    let a = term();
    while (peek()?.t === "op" && ((peek() as any).v === "+" || (peek() as any).v === "-")) {
      const op = (toks[i++] as any).v; const b = term(); const l = a;
      a = op === "+" ? (x) => l(x) + b(x) : (x) => l(x) - b(x);
    }
    return a;
  };
  const term = (): Node => {
    let a = unary();
    while (peek()?.t === "op" && ((peek() as any).v === "*" || (peek() as any).v === "/")) {
      const op = (toks[i++] as any).v; const b = unary(); const l = a;
      a = op === "*" ? (x) => l(x) * b(x) : (x) => l(x) / b(x);
    }
    return a;
  };
  const unary = (): Node => {
    if (peek()?.t === "op" && (peek() as any).v === "-") { i++; const a = unary(); return (x) => -a(x); }
    if (peek()?.t === "op" && (peek() as any).v === "+") { i++; return unary(); }
    return power();
  };
  const power = (): Node => {
    const base = atom();
    if (peek()?.t === "op" && (peek() as any).v === "^") { i++; const e = unary(); return (x) => Math.pow(base(x), e(x)); }
    return base;
  };
  const atom = (): Node => {
    const t = toks[i++];
    if (!t) throw new Error(`${src} ends too soon`);
    if (t.t === "n" || t.t === "c") { const v = t.v; return () => v; }
    if (t.t === "x") return (x) => x;
    if (t.t === "f") { const fn = FUNCS[t.v]; const a = atom(); return (x) => fn(a(x)); }
    if (t.t === "(") { const e = expr(); if (toks[i++]?.t !== ")") throw new Error(`missing ")" in ${src}`); return e; }
    throw new Error(`unexpected "${(t as any).v ?? t.t}" in ${src}`);
  };
  const f = expr();
  if (i < toks.length) throw new Error(`couldn't read all of ${src}`);
  return f;
}

function niceStep(span: number, target = 8): number {
  const raw = span / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

// ------------------------------------------------------------------ plot: axes, grid, functions, lines, points, bars
export function plot(p: any): string {
  const [x0, x1] = pair(p.x ?? [-5, 5], "x range");
  const [y0, y1] = pair(p.y ?? [-5, 5], "y range");
  if (x1 <= x0 || y1 <= y0) throw new Error("ranges must go from small to large");
  const aspect = p.aspect != null ? num(p.aspect, "aspect") : p.equal_scale ? (y1 - y0) / (x1 - x0) : 0.7;
  const W = 520, H = Math.round(W * Math.min(1.3, Math.max(0.45, aspect)));
  const L = 46, R = 22, T = 18, B = 38;
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y: number) => T + ((y1 - y) / (y1 - y0)) * (H - T - B);
  const xs = num(p.x_step ?? niceStep(x1 - x0), "x_step"), ys = num(p.y_step ?? niceStep(y1 - y0), "y_step");
  if ((x1 - x0) / xs > 60 || (y1 - y0) / ys > 60) throw new Error("too many ticks: use a bigger step");
  const parts: string[] = [];
  const ax = Math.min(Math.max(0, y0), y1), ay = Math.min(Math.max(0, x0), x1);  // where the axes cross
  // grid
  if (p.grid !== false) {
    const minor = p.grid === "fine" ? 5 : p.grid === "squared" || p.grid === true ? 2 : 1;
    const g: string[] = [];
    for (let k = Math.ceil(x0 / (xs / minor)); k * (xs / minor) <= x1 + 1e-9; k++) g.push(`<path d="M${fmt(sx(k * xs / minor))} ${sy(y0)}V${sy(y1)}"/>`);
    for (let k = Math.ceil(y0 / (ys / minor)); k * (ys / minor) <= y1 + 1e-9; k++) g.push(`<path d="M${sx(x0)} ${fmt(sy(k * ys / minor))}H${sx(x1)}"/>`);
    parts.push(`<g stroke="#cfcac0" stroke-width="0.5">${g.join("")}</g>`);
  }
  // bars sit under the axes
  if (Array.isArray(p.bars)) {
    for (const b of p.bars.slice(0, 40)) {
      const cx = num(b.x, "bar x"), h = num(b.height, "bar height"), w = num(b.width ?? xs * 0.7, "bar width");
      parts.push(`<rect x="${fmt(sx(cx - w / 2))}" y="${fmt(Math.min(sy(h), sy(ax)))}" width="${fmt(sx(cx + w / 2) - sx(cx - w / 2))}" height="${fmt(Math.abs(sy(ax) - sy(h)))}" fill="${b.shaded ? "#bdb8ae" : "#fff"}" stroke="#111" stroke-width="1.2"/>`);
      if (b.label !== undefined) parts.push(`<text x="${fmt(sx(cx))}" y="${H - 8}" font-size="12.5" text-anchor="middle" ${FONT}>${tidy(b.label)}</text>`);
    }
  }
  // axes, ticks, numbers
  const ticks: string[] = [];
  const barsLabelled = Array.isArray(p.bars) && p.bars.some((b: any) => b.label !== undefined);
  for (let k = Math.ceil(x0 / xs); k * xs <= x1 + 1e-9; k++) {
    const x = k * xs, X = sx(x);
    ticks.push(`<path d="M${fmt(X)} ${sy(ax)}v4"/>`);
    if (Math.abs(x) > 1e-9 && !barsLabelled && p.numbers !== false) ticks.push(`<text x="${fmt(X)}" y="${fmt(sy(ax) + 15)}" font-size="12" text-anchor="middle" stroke="none" fill="#111" ${FONT}>${fmt(x).replace("-", "−")}</text>`);
  }
  for (let k = Math.ceil(y0 / ys); k * ys <= y1 + 1e-9; k++) {
    const y = k * ys, Y = sy(y);
    ticks.push(`<path d="M${sx(ay) - 4} ${fmt(Y)}h4"/>`);
    if (Math.abs(y) > 1e-9 && p.numbers !== false) ticks.push(`<text x="${fmt(sx(ay) - 7)}" y="${fmt(Y + 3.5)}" font-size="12" text-anchor="end" stroke="none" fill="#111" ${FONT}>${fmt(y).replace("-", "−")}</text>`);
  }
  if (x0 <= 0 && 0 <= x1 && y0 <= 0 && 0 <= y1 && p.numbers !== false) ticks.push(`<text x="${fmt(sx(0) - 7)}" y="${fmt(sy(0) + 14)}" font-size="12" text-anchor="end" stroke="none" fill="#111" ${FONT}>0</text>`);
  parts.push(`<g stroke="#111" stroke-width="1.3" fill="none"><path d="M${sx(x0)} ${fmt(sy(ax))}H${sx(x1) + 8}"/><path d="M${fmt(sx(ay))} ${sy(y0)}V${sy(y1) - 8}"/>
    <path d="M${sx(x1) + 8} ${fmt(sy(ax))}l-6 -3.5v7z M${fmt(sx(ay))} ${sy(y1) - 8}l-3.5 6h7z" fill="#111"/>${ticks.join("")}</g>`);
  const xl = String(p.x_label ?? "x"), yl = String(p.y_label ?? "y");
  const italic = (s: string) => (/^[a-z]$/i.test(s) ? SERIF : FONT);
  parts.push(`<text x="${sx(x1) + 4}" y="${fmt(sy(ax) - 8)}" font-size="14" text-anchor="end" ${italic(xl)}>${tidy(xl)}</text>`);
  parts.push(`<text x="${fmt(sx(ay) + 8)}" y="${sy(y1) - 2}" font-size="14" ${italic(yl)}>${tidy(yl)}</text>`);
  // curves are clipped to the plotting area
  const clip = `<clipPath id="CLIPID"><rect x="${sx(x0)}" y="${sy(y1)}" width="${sx(x1) - sx(x0)}" height="${sy(y0) - sy(y1)}"/></clipPath>`;
  const curves: string[] = [];
  const labels: string[] = [];
  for (const fn of (Array.isArray(p.functions) ? p.functions : []).slice(0, 8)) {
    const f = compile(String(fn.expr ?? fn));
    const [d0, d1] = fn.domain ? pair(fn.domain, "domain") : [x0, x1];
    let d = "", pen = false, last: Pt | null = null;
    const N = 400;
    for (let k = 0; k <= N; k++) {
      const x = d0 + ((d1 - d0) * k) / N, y = f(x);
      if (!isFinite(y) || y > y1 + (y1 - y0) * 2 || y < y0 - (y1 - y0) * 2) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${fmt(sx(x))} ${fmt(sy(y))}`;
      pen = true;
      if (y >= y0 && y <= y1) last = [x, y];
    }
    if (!d) throw new Error(`${fn.expr} has no points in range`);
    curves.push(`<path d="${d}" fill="none" stroke="#111" stroke-width="1.8"${fn.dashed ? ' stroke-dasharray="6 4"' : ""}/>`);
    if (fn.label && last) labels.push(label(sx(last[0]), sy(last[1]), fn.label, W));
  }
  for (const ln of (Array.isArray(p.lines) ? p.lines : []).slice(0, 12)) {
    const pts = (ln.points ?? []).map((q: unknown) => pair(q, "line point"));
    if (pts.length < 2) throw new Error("a line needs at least two points");
    curves.push(`<path d="${pts.map((q: Pt, k: number) => `${k ? "L" : "M"}${fmt(sx(q[0]))} ${fmt(sy(q[1]))}`).join("")}" fill="none" stroke="#111" stroke-width="1.8" stroke-linejoin="round"${ln.dashed ? ' stroke-dasharray="6 4"' : ""}/>`);
    if (ln.label) { const q = pts[pts.length - 1]; labels.push(label(sx(q[0]), sy(q[1]), ln.label, W)); }
  }
  for (const pt of (Array.isArray(p.points) ? p.points : []).slice(0, 30)) {
    const [x, y] = pair(pt.at, "point");
    if (pt.dot !== false) curves.push(`<circle cx="${fmt(sx(x))}" cy="${fmt(sy(y))}" r="${pt.cross ? 0 : 3}" fill="#111"/>${pt.cross ? `<path d="M${sx(x) - 4} ${sy(y) - 4}l8 8M${sx(x) - 4} ${sy(y) + 4}l8 -8" stroke="#111" stroke-width="1.4"/>` : ""}`);
    if (pt.label) labels.push(`<text x="${fmt(sx(x) + 7)}" y="${fmt(sy(y) - 7)}" font-size="14" ${FONT} font-weight="500" paint-order="stroke" stroke="#fff" stroke-width="3">${tidy(pt.label)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${clip}${parts.join("")}<g clip-path="url(#CLIPID)">${curves.join("")}</g>${labels.join("")}</svg>`;
}

function label(X: number, Y: number, text: string, W: number): string {
  const right = X > W - 140;
  return `<text x="${fmt(right ? X - 6 : X + 6)}" y="${fmt(Y - 8)}" font-size="13.5" text-anchor="${right ? "end" : "start"}" ${FONT} paint-order="stroke" stroke="#fff" stroke-width="3">${tidy(text)}</text>`;
}

// ------------------------------------------------------------------ geometry: named points, sides, angles, circles
export function geometry(g: any): string {
  const P: Record<string, Pt> = {};
  for (const [k, v] of Object.entries(g.points ?? {})) P[k] = pair(v, `point ${k}`);
  const names = Object.keys(P);
  if (names.length < 2 && !(g.circles?.length)) throw new Error("geometry needs points");
  const get = (n: string): Pt => { const p = P[n]; if (!p) throw new Error(`no point called ${n}`); return p; };
  // bounding box including circles
  let xs = names.map((n) => P[n][0]), ys = names.map((n) => P[n][1]);
  for (const c of g.circles ?? []) {
    const [cx, cy] = typeof c.centre === "string" ? get(c.centre) : pair(c.centre, "centre"); const r = num(c.radius, "radius");
    xs.push(cx - r, cx + r); ys.push(cy - r, cy + r);
  }
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const S = 260 / span, pad = 38;  // small canvas, so labels stay legible when the figure is scaled to the page
  const W = Math.round((maxX - minX) * S + pad * 2), H = Math.round((maxY - minY) * S + pad * 2);
  const X = (x: number) => pad + (x - minX) * S, Y = (y: number) => pad + (maxY - y) * S;
  const cx = names.reduce((t, n) => t + X(P[n][0]), 0) / Math.max(1, names.length), cy = names.reduce((t, n) => t + Y(P[n][1]), 0) / Math.max(1, names.length);
  const out: string[] = [];
  const seg = (a: string, b: string, dashed = false) => `<path d="M${fmt(X(get(a)[0]))} ${fmt(Y(get(a)[1]))}L${fmt(X(get(b)[0]))} ${fmt(Y(get(b)[1]))}" stroke="#111" stroke-width="1.5"${dashed ? ' stroke-dasharray="5 4"' : ""}/>`;
  const pairs = (v: unknown): [string, string][] => (Array.isArray(v) ? v : []).map((s: any) => (typeof s === "string" ? [s[0], s.slice(1)] : [s[0], s[1]]) as [string, string]);
  for (const poly of g.polygons ?? []) {
    const ring = (typeof poly === "string" ? poly.split("") : poly) as string[];
    out.push(`<path d="${ring.map((n, k) => `${k ? "L" : "M"}${fmt(X(get(n)[0]))} ${fmt(Y(get(n)[1]))}`).join("")}Z" fill="${g.shade?.includes?.(ring.join("")) ? "#e4e0d8" : "none"}" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  for (const [a, b] of pairs(g.segments)) out.push(seg(a, b));
  for (const [a, b] of pairs(g.dashed)) out.push(seg(a, b, true));
  for (const c of g.circles ?? []) {
    const [ccx, ccy] = typeof c.centre === "string" ? get(c.centre) : pair(c.centre, "centre");
    out.push(`<circle cx="${fmt(X(ccx))}" cy="${fmt(Y(ccy))}" r="${fmt(num(c.radius, "radius") * S)}" fill="none" stroke="#111" stroke-width="1.6"/>`);
  }
  // right-angle squares and angle arcs
  const unit = (from: Pt, to: Pt) => { const dx = X(to[0]) - X(from[0]), dy = Y(to[1]) - Y(from[1]); const l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  for (const ra of g.right_angles ?? []) {
    const at = get(ra.at), u = unit(at, get(ra.from)), v = unit(at, get(ra.to)), k = 9;
    const ax = X(at[0]), ay = Y(at[1]);
    out.push(`<path d="M${fmt(ax + u[0] * k)} ${fmt(ay + u[1] * k)}L${fmt(ax + (u[0] + v[0]) * k)} ${fmt(ay + (u[1] + v[1]) * k)}L${fmt(ax + v[0] * k)} ${fmt(ay + v[1] * k)}" fill="none" stroke="#111" stroke-width="1.1"/>`);
  }
  for (const an of g.angles ?? []) {
    const at = get(an.at), u = unit(at, get(an.from)), v = unit(at, get(an.to)), r = 18;
    const ax = X(at[0]), ay = Y(at[1]);
    const a0 = Math.atan2(u[1], u[0]), a1 = Math.atan2(v[1], v[0]);
    let d = a1 - a0; while (d <= -Math.PI) d += 2 * Math.PI; while (d > Math.PI) d -= 2 * Math.PI;
    out.push(`<path d="M${fmt(ax + Math.cos(a0) * r)} ${fmt(ay + Math.sin(a0) * r)}A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${fmt(ax + Math.cos(a1) * r)} ${fmt(ay + Math.sin(a1) * r)}" fill="none" stroke="#111" stroke-width="1.1"/>`);
    if (an.label) { const m = a0 + d / 2; out.push(`<text x="${fmt(ax + Math.cos(m) * (r + 13))}" y="${fmt(ay + Math.sin(m) * (r + 13) + 4)}" font-size="15" text-anchor="middle" ${/^[a-zθαβφ]$/.test(an.label) ? SERIF : FONT}>${tidy(an.label)}</text>`); }
  }
  // side labels sit outside the shape, at each side's midpoint
  for (const [side, text] of Object.entries(g.labels ?? {})) {
    const [a, b] = side.length === 2 ? [side[0], side[1]] : side.split(/[-,]/);
    const pa = get(a), pb = get(b);
    const mx = (X(pa[0]) + X(pb[0])) / 2, my = (Y(pa[1]) + Y(pb[1])) / 2;
    let nx = -(Y(pb[1]) - Y(pa[1])), ny = X(pb[0]) - X(pa[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if ((mx + nx - cx) * nx + (my + ny - cy) * ny < 0) { nx = -nx; ny = -ny; }
    out.push(`<text x="${fmt(mx + nx * 16)}" y="${fmt(my + ny * 16 + 5)}" font-size="14.5" text-anchor="middle" ${FONT}>${tidy(text)}</text>`);
  }
  // point names, pushed away from the middle
  for (const n of names) {
    if (g.hide?.includes?.(n)) continue;
    const px = X(P[n][0]), py = Y(P[n][1]);
    let dx = px - cx, dy = py - cy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    out.push(`<text x="${fmt(px + dx * 15)}" y="${fmt(py + dy * 15 + 5)}" font-size="15" text-anchor="middle" ${FONT} font-weight="500">${esc(n)}</text>`);
    if (g.dots) out.push(`<circle cx="${fmt(px)}" cy="${fmt(py)}" r="2.3" fill="#111"/>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${out.join("")}</svg>`;
}

// ------------------------------------------------------------------ circuits (UK symbols)
const CW = 56;  // width a component takes on a wire
function symbol(type: string, x: number, y: number, vertical: boolean): string {
  // Drawn horizontally centred on (0,0), then placed (rotated for vertical wires).
  const t = type.toLowerCase().replace(/[^a-z_]/g, "");
  const box = (inner: string) => `<g transform="translate(${fmt(x)} ${fmt(y)})${vertical ? " rotate(90)" : ""}">${inner}</g>`;
  const wire = (a: number, b: number) => `<path d="M${a} 0H${b}"/>`;
  const meter = (letter: string) => `${wire(-28, -12)}${wire(12, 28)}<circle r="12" fill="#fff"/><text y="4.6" font-size="13" text-anchor="middle" stroke="none" fill="#111" ${FONT} font-weight="600" ${vertical ? 'transform="rotate(-90)"' : ""}>${letter}</text>`;
  switch (t) {
    case "cell": return box(`${wire(-28, -4)}${wire(4, 28)}<path d="M-4 -13V13" stroke-width="1.6"/><path d="M4 -7V7" stroke-width="3.2"/>`);
    case "battery": return box(`${wire(-28, -12)}${wire(12, 28)}<path d="M-12 -13V13M2 -13V13" stroke-width="1.6"/><path d="M-4 -7V7M10 -7V7" stroke-width="3.2"/><path d="M-4 0H2" stroke-dasharray="2 2"/>`);
    case "resistor": return box(`${wire(-28, -16)}${wire(16, 28)}<rect x="-16" y="-6.5" width="32" height="13" fill="#fff"/>`);
    case "variable_resistor": case "variableresistor": case "rheostat":
      return box(`${wire(-28, -16)}${wire(16, 28)}<rect x="-16" y="-6.5" width="32" height="13" fill="#fff"/><path d="M-14 12L14 -13"/><path d="M14 -13l-7 1.5 5 5z" fill="#111"/>`);
    case "lamp": case "bulb": return box(`${wire(-28, -12)}${wire(12, 28)}<circle r="12" fill="#fff"/><path d="M-8.5 -8.5L8.5 8.5M-8.5 8.5L8.5 -8.5"/>`);
    case "ammeter": return box(meter("A"));
    case "voltmeter": return box(meter("V"));
    case "motor": return box(meter("M"));
    case "switch": case "open_switch": case "switch_open": return box(`${wire(-28, -12)}${wire(12, 28)}<circle cx="-12" r="2" fill="#111"/><circle cx="12" r="2" fill="#111"/><path d="M-12 0L10 -11"/>`);
    case "closed_switch": case "switch_closed": return box(`${wire(-28, 28)}<circle cx="-12" r="2" fill="#111"/><circle cx="12" r="2" fill="#111"/>`);
    case "diode": return box(`${wire(-28, -9)}${wire(9, 28)}<path d="M-9 -9V9L9 0Z" fill="#fff"/><path d="M9 -9V9" stroke-width="1.6"/>`);
    case "led": return box(`${wire(-28, -9)}${wire(9, 28)}<path d="M-9 -9V9L9 0Z" fill="#fff"/><path d="M9 -9V9" stroke-width="1.6"/><path d="M0 -12l7 -9M6 -12l7 -9"/><path d="M7 -21l-4 1 3 2zM13 -21l-4 1 3 2z" fill="#111"/>`);
    case "ldr": return box(`${wire(-28, -16)}${wire(16, 28)}<circle r="17" fill="#fff"/><rect x="-11" y="-5" width="22" height="10" fill="#fff"/><path d="M-20 -24l9 9M-12 -27l9 9"/><path d="M-11 -15l-1 -4 -3 2zM-3 -18l-1 -4 -3 2z" fill="#111"/>`);
    case "thermistor": return box(`${wire(-28, -16)}${wire(16, 28)}<rect x="-16" y="-6.5" width="32" height="13" fill="#fff"/><path d="M-18 13L14 -13H22"/>`);
    case "fuse": return box(`${wire(-28, -16)}${wire(16, 28)}<rect x="-16" y="-6" width="32" height="12" fill="#fff"/><path d="M-16 0H16"/>`);
    case "heater": return box(`${wire(-28, -16)}${wire(16, 28)}<rect x="-16" y="-6.5" width="32" height="13" fill="#fff"/><path d="M-8 -6.5V6.5M0 -6.5V6.5M8 -6.5V6.5"/>`);
    case "wire": return box(wire(-28, 28));
    default: throw new Error(`no circuit symbol for "${type}"`);
  }
}
const parseComp = (c: any): { type: string; label?: string } => (typeof c === "string" ? { type: c.split(":")[0], label: c.split(":").slice(1).join(":") || undefined } : { type: String(c.type ?? ""), label: c.label });

export function circuit(c: any): string {
  // Ladder layout: branches are rungs from the top (one rung = a series circuit, more rungs = in
  // parallel); the source and any "main" components sit on the bottom wire, in series with all of it.
  const source = c.source ? parseComp(c.source) : { type: "cell" };
  const branches: { type: string; label?: string }[][] = (Array.isArray(c.branches) ? c.branches : [c.components ?? []]).map((b: any) => (Array.isArray(b) ? b : [b]).map(parseComp));
  const main = [source, ...(c.main ?? []).map(parseComp)];
  if (!branches.length || branches.length > 4) throw new Error("a circuit needs 1–4 branches");
  const longest = Math.max(...branches.map((b) => b.length), main.length, 1);
  const W = Math.max(240, longest * (CW + 30) + 70), rungGap = 70;
  const left = 30, right = W - 30, top = 40;
  const bottom = top + rungGap * branches.length;
  const H = bottom + 44;
  const g: string[] = [];
  const labels: string[] = [];
  // A component with a voltmeter bridged over it gets its label underneath instead.
  const metered = new Set((c.voltmeters ?? []).map((v: any) => `${Number(v.branch ?? 0)}:${Number(v.index ?? 0)}`));
  let rowNow = -1;
  const along = (items: { type: string; label?: string }[], y: number, x0: number, x1: number, below: boolean) => {
    const n = items.length;
    if (!n) { g.push(`<path d="M${x0} ${y}H${x1}"/>`); return []; }
    const xs = items.map((_, k) => x0 + ((k + 1) * (x1 - x0)) / (n + 1));
    let prev = x0;
    items.forEach((it, k) => {
      g.push(`<path d="M${fmt(prev)} ${y}H${fmt(xs[k] - 28)}"/>`);
      g.push(symbol(it.type, xs[k], y, false));
      const under = below || (rowNow === 0 && metered.has(`0:${k}`));
      if (it.label) labels.push(`<text x="${fmt(xs[k])}" y="${fmt(under ? y + 32 : y - 21)}" font-size="13" text-anchor="middle" ${FONT}>${tidy(it.label)}</text>`);
      prev = xs[k] + 28;
    });
    g.push(`<path d="M${fmt(prev)} ${y}H${x1}"/>`);
    return xs;
  };
  const rungYs = branches.map((_, k) => top + k * rungGap);
  const rungXs = branches.map((b, k) => { rowNow = k; return along(b, rungYs[k], left, right, k > 0); });
  rowNow = -1;
  g.push(`<path d="M${left} ${top}V${bottom}M${right} ${top}V${bottom}"/>`);
  if (branches.length > 1) for (const y of rungYs.slice(1)) g.push(`<circle cx="${left}" cy="${y}" r="2.8" fill="#111"/><circle cx="${right}" cy="${y}" r="2.8" fill="#111"/>`);
  along(main, bottom, left, right, true);
  // voltmeters across a component: a bridge above the top branch, or below a lower one
  for (const v of c.voltmeters ?? []) {
    const bi = Number(v.branch ?? 0), ci = Number(v.index ?? 0);
    const xs = rungXs[bi]; if (!xs || xs[ci] === undefined) throw new Error("voltmeter index is outside the circuit");
    if (bi > 0 && bi < branches.length - 1) throw new Error("voltmeters go across the top or bottom branch");
    const y = rungYs[bi], yy = y + (bi === 0 ? -34 : 30);
    const xa = xs[ci] - 34, xb = xs[ci] + 34;
    g.push(`<path d="M${fmt(xa)} ${y}V${fmt(yy)}H${fmt(xs[ci] - 12)}M${fmt(xs[ci] + 12)} ${fmt(yy)}H${fmt(xb)}V${y}"/><circle cx="${fmt(xa)}" cy="${y}" r="2.6" fill="#111"/><circle cx="${fmt(xb)}" cy="${y}" r="2.6" fill="#111"/>`);
    g.push(`<circle cx="${fmt(xs[ci])}" cy="${fmt(yy)}" r="12" fill="#fff"/>`);
    labels.push(`<text x="${fmt(xs[ci])}" y="${fmt(yy + 4.6)}" font-size="13" text-anchor="middle" fill="#111" ${FONT} font-weight="600">V</text>`);
    if (v.label) labels.push(`<text x="${fmt(xs[ci] + 18)}" y="${fmt(yy - 10)}" font-size="13" ${FONT}>${tidy(v.label)}</text>`);
  }
  const extraTop = (c.voltmeters ?? []).some((v: any) => Number(v.branch ?? 0) === 0) ? 34 : 0;
  return `<svg viewBox="0 ${-extraTop} ${W} ${H + extraTop}" xmlns="http://www.w3.org/2000/svg"><g stroke="#111" stroke-width="1.6" fill="none" stroke-linecap="round">${g.join("")}</g>${labels.join("")}</svg>`;
}

let clipSeq = 0;
/** Draw a figure description; throws with a short reason if it can't. */
export function drawFigure(f: { plot?: unknown; geometry?: unknown; circuit?: unknown }): string {
  let svg = "";
  if (f.plot) svg = plot(f.plot);
  else if (f.geometry) svg = geometry(f.geometry);
  else if (f.circuit) svg = circuit(f.circuit);
  else throw new Error("unknown figure");
  const kind = f.plot ? "plot" : f.geometry ? "geometry" : "circuit";
  return svg.replace(/CLIPID/g, `clip${++clipSeq}`).replace("<svg ", `<svg class="fig-svg drawn ${kind}" `);
}
