/**
 * The director: runs Claude's animation script in a background worker and records what it does.
 *
 * Scripts run instantly here: `await` on an animation doesn't really wait, it moves a
 * timeline cursor to when that animation ends. The result is a timeline of commands, split
 * into beats at each say(...). The player then plays it back for real, in sync with the voice.
 *
 * Running in a worker keeps Claude's code away from the page (no access to the DOM, your
 * account or the backend), and lets a runaway loop be stopped by terminating the worker.
 */
import { Graph, layout } from "@dagrejs/dagre";
import type { Beat, Cmd, Endpoint, FromWorker, Mark, Prim, Program, ShapePrim, ShapeSpec, TextSpec, ToWorker } from "./protocol";

// ---- keep scripts off the network ----
for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "Request", "BroadcastChannel"]) {
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch { /* not present */ }
}

// ---------------------------------------------------------------- measuring text
const mctx = new OffscreenCanvas(4, 4).getContext("2d")!;
const FONT: Record<string, string> = {
  label: "500 15px Inter, system-ui, sans-serif", value: "600 18px Inter, system-ui, sans-serif",
  mono: "14px Consolas, 'Cascadia Code', monospace", small: "13px Inter, system-ui, sans-serif",
  title: "700 22px Inter, system-ui, sans-serif", big: "700 28px Inter, system-ui, sans-serif",
};
function tw(text: unknown, font = "label"): number {
  mctx.font = FONT[font] ?? font;
  return Math.max(0, ...String(text ?? "").split("\n").map((l) => mctx.measureText(l).width));
}
const lines = (s: unknown) => String(s ?? "").split("\n");
const centredTexts = (label: unknown, cls = "label", lh = 19): TextSpec[] => {
  const ls = lines(label);
  return ls.map((t, i) => ({ text: t, dy: (i - (ls.length - 1) / 2) * lh, cls }));
};

// ---------------------------------------------------------------- timing
const D = { pop: 450, move: 650, fly: 750, draw: 450, fade: 320, flash: 650, camera: 800, swap: 750, packet: 900, stagger: 110 };
let T = 0;                  // timeline cursor within the current beat (ms)
let beats: Beat[] = [];
let cur: Beat;
let cmdCount = 0;
const MAX_CMDS = 8000, MAX_OBJECTS = 800;

/** Returned by every animation. `await` moves the timeline to when it ends; without await, things run in parallel. */
class Anim {
  constructor(readonly end: number) {}
  then(resolve?: (v: undefined) => void) { if (this.end > T) T = this.end; resolve?.(undefined); }
}
const after = (dur: number) => new Anim(T + dur);
/** A value taken out of something (e.g. queue.shift()): remembers where it was, so it can fly somewhere. */
class TakenValue {
  constructor(readonly value: any, readonly x: number, readonly y: number) {}
  toString() { return String(this.value); }
  valueOf() { return this.value; }
}
class Taken extends TakenValue {
  constructor(value: any, x: number, y: number, readonly end: number) { super(value, x, y); }
  then(resolve?: (v: TakenValue) => void) { if (this.end > T) T = this.end; resolve?.(new TakenValue(this.value, this.x, this.y)); }
}

function emit(cmd: Record<string, any>) {
  if (++cmdCount > MAX_CMDS) throw new Error("The animation has too many steps (over 8000). Simplify it, e.g. animate fewer items.");
  (cur.cmds as any[]).push({ ...cmd, t: cmd.t ?? T });
}

// ---------------------------------------------------------------- scene state (persists across turns)
interface PrimRec { id: string; prim: Prim; owner?: string }
interface State { seq: number; prims: Record<string, PrimRec>; macros: Record<string, any>; names: Record<string, { type: string; id: string }>; focused: boolean }
let S: State = { seq: 0, prims: {}, macros: {}, names: {}, focused: false };
const newId = (p: string) => `${p}${++S.seq}`;

function addPrim(prim: Prim, opts: { owner?: string; anim?: "pop" | "fade" | "draw" | "fly" | "none"; dur?: number; from?: { x: number; y: number } | null; t?: number } = {}): string {
  if (Object.keys(S.prims).length > MAX_OBJECTS) throw new Error("Too many objects on screen (over 800). Clear some with scene.clear() or .remove().");
  const id = newId(prim.kind === "arrow" ? "a" : "p");
  S.prims[id] = { id, prim, owner: opts.owner };
  const anim = opts.from ? "fly" : opts.anim ?? (prim.kind === "arrow" ? "draw" : "pop");
  emit({ op: "create", id, prim: JSON.parse(JSON.stringify(prim)), anim, dur: opts.dur ?? (anim === "fly" ? D.fly : anim === "draw" ? D.draw : anim === "fade" ? D.fade : D.pop), from: opts.from ?? undefined, t: opts.t });
  return id;
}
function movePrim(id: string, x: number, y: number, dur = D.move, arc = 0, t?: number) {
  const r = S.prims[id]; if (!r) return;
  if (Math.abs(r.prim.x - x) < 0.01 && Math.abs(r.prim.y - y) < 0.01) return;
  r.prim.x = x; r.prim.y = y;
  emit({ op: "move", id, x, y, dur, arc: arc || undefined, t });
}
function updatePrim(id: string, props: Record<string, any>, effect: "pop" | "flash" | "none" = "none", t?: number) {
  const r = S.prims[id]; if (!r) return;
  Object.assign(r.prim, props);
  emit({ op: "update", id, props, effect, t });
}
function removePrim(id: string, dur = D.fade, anim: "fade" | "shrink" | "up" = "fade", t?: number) {
  if (!S.prims[id]) return;
  delete S.prims[id];
  // arrows attached to it go too
  for (const r of Object.values(S.prims)) if (r.prim.kind === "arrow" && [r.prim.from, r.prim.to].some((e) => "id" in e && e.id === id)) removePrim(r.id, dur, "fade", t);
  emit({ op: "remove", id, dur, anim, t });
}

// ---------------------------------------------------------------- geometry & placement
type Box = { x0: number; y0: number; x1: number; y1: number };
let W = 1000, H = 600; // the world: 1000 wide, as tall as the screen's shape makes it
function primBox(id: string): Box | null {
  const p = S.prims[id]?.prim; if (!p) return null;
  if (p.kind === "arrow") { const a = endPos(p.from), b = endPos(p.to); return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }; }
  return { x0: p.x - p.w / 2, y0: p.y - p.h / 2, x1: p.x + p.w / 2, y1: p.y + p.h / 2 };
}
function endPos(e: Endpoint): { x: number; y: number } { return "id" in e ? (S.prims[e.id]?.prim ?? { x: 0, y: 0 }) : e; }
function union(boxes: (Box | null)[]): Box | null {
  const bs = boxes.filter(Boolean) as Box[];
  if (!bs.length) return null;
  return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
}
const contentBox = () => union(Object.values(S.prims).filter((r) => r.prim.kind !== "arrow").map((r) => primBox(r.id)));

const regions = (): Record<string, [number, number]> => ({
  center: [W / 2, H / 2], left: [W * 0.26, H / 2], right: [W * 0.74, H / 2], top: [W / 2, H * 0.2], bottom: [W / 2, H * 0.8],
  topLeft: [W * 0.26, H * 0.22], topRight: [W * 0.74, H * 0.22], bottomLeft: [W * 0.26, H * 0.78], bottomRight: [W * 0.74, H * 0.78],
});
/** Where to put something w×h: at:[x,y], a region (left/right/top…), next to another object, or below everything. */
function place(o: any = {}, w: number, h: number): [number, number] {
  let x: number, y: number;
  const gap = o.gap ?? 40;
  const rel = (k: string) => (o[k] ? boxOf(o[k]) : null);
  if (Array.isArray(o.at)) [x, y] = [Number(o.at[0]), Number(o.at[1])];
  else if (rel("below")) { const b = rel("below")!; [x, y] = [(b.x0 + b.x1) / 2, b.y1 + gap + h / 2]; }
  else if (rel("above")) { const b = rel("above")!; [x, y] = [(b.x0 + b.x1) / 2, b.y0 - gap - h / 2]; }
  else if (rel("rightOf")) { const b = rel("rightOf")!; [x, y] = [b.x1 + gap + w / 2, (b.y0 + b.y1) / 2]; }
  else if (rel("leftOf")) { const b = rel("leftOf")!; [x, y] = [b.x0 - gap - w / 2, (b.y0 + b.y1) / 2]; }
  else {
    const R = regions();
    const region = Object.keys(R).find((k) => o[k] === true || o.region === k);
    if (region) [x, y] = R[region];
    else {
      const c = contentBox();
      [x, y] = c ? [(c.x0 + c.x1) / 2, c.y1 + gap + h / 2] : [W / 2, H / 2];
    }
  }
  return [x + (o.dx ?? 0), y + (o.dy ?? 0)];
}

// ---------------------------------------------------------------- handles
/** Anything on screen. All animations return something you can `await`. */
class Obj {
  constructor(readonly id: string) {}
  /** prim ids this object is made of (for camera, spotlight, moving) */
  _ids(): string[] { return S.prims[this.id] ? [this.id] : []; }
  _main(): string { return this.id; }
  get alive() { return this._ids().length > 0; }
  get box(): Box { return union(this._ids().map(primBox)) ?? { x0: 0, y0: 0, x1: 0, y1: 0 }; }
  get x() { const b = this.box; return (b.x0 + b.x1) / 2; }
  get y() { const b = this.box; return (b.y0 + b.y1) / 2; }
  get w() { const b = this.box; return b.x1 - b.x0; }
  get h() { const b = this.box; return b.y1 - b.y0; }
  get label(): string { const p = S.prims[this._main()]?.prim as ShapePrim; return p?.texts?.map((t) => t.text).join(" ") ?? ""; }
  toString() { return this.label; }

  moveTo(target: any, o: any = {}) {
    const [tx, ty] = Array.isArray(target) ? target.map(Number) : [posOf(target).x, posOf(target).y];
    return this.shift(tx - this.x, ty - this.y, o);
  }
  shift(dx: number, dy: number, o: any = {}) {
    const dur = o.dur ?? D.move;
    for (const id of this._ids()) { const p = S.prims[id].prim; if (p.kind !== "arrow") movePrim(id, p.x + dx, p.y + dy, dur, o.arc ?? 0); }
    this._moved(dx, dy);
    return after(dur);
  }
  _moved(_dx: number, _dy: number) { /* macros update their origin */ }
  mark(state: Mark) { for (const id of this._markIds()) updatePrim(id, { mark: state }); return after(300); }
  _markIds() { return [this._main()]; }
  flash() { emit({ op: "flash", id: this._main(), dur: D.flash }); return after(D.flash); }
  pulse() { return this.flash(); }
  highlight(on = true) { for (const id of this._markIds()) updatePrim(id, { highlight: !!on }); return after(200); }
  color(name: string) { for (const id of this._markIds()) updatePrim(id, { color: name }); return after(300); }
  setLabel(text: unknown) {
    const id = this._main(); const p = S.prims[id]?.prim as ShapePrim;
    if (!p || p.kind !== "shape") return after(0);
    const newW = p.shape ? Math.max(p.w, tw(text) + 30) : tw(text, (p.texts[0]?.cls as string) ?? "label");
    updatePrim(id, { texts: centredTexts(text, p.texts[0]?.cls ?? "label"), w: newW }, "pop");
    return after(D.pop);
  }
  remove(o: any = {}) { const dur = o.dur ?? D.fade; for (const id of this._ids()) removePrim(id, dur, o.anim ?? "fade"); this._removed(); return after(dur); }
  fadeOut(o: any = {}) { return this.remove(o); }
  _removed() { /* macros drop their data */ }
  /** A copy of this object's main shape, at the same place (e.g. to fly it somewhere). */
  copy() {
    const p = S.prims[this._main()]?.prim;
    if (!p || p.kind !== "shape") throw new Error("Only shapes can be copied.");
    const id = addPrim({ ...JSON.parse(JSON.stringify(p)), highlight: false, mark: "none" }, { anim: "none" });
    return new Obj(id);
  }
}

function posOf(x: any): { x: number; y: number } {
  if (x instanceof TakenValue) return { x: x.x, y: x.y };
  if (x instanceof Obj) return { x: x.x, y: x.y };
  if (Array.isArray(x)) return { x: Number(x[0]), y: Number(x[1]) };
  if (x && typeof x === "object" && "x" in x) return { x: Number(x.x), y: Number(x.y) };
  throw new Error(`Expected an object or [x, y], got ${JSON.stringify(x)}`);
}
function boxOf(x: any): Box {
  if (x instanceof Obj) return x.box;
  const p = posOf(x); return { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
}
const valueOf = (v: any) => (v instanceof TakenValue ? v.value : v instanceof Obj ? v.label : v);
/** Where something should fly in from, if anywhere: an explicit {from}, or the value itself if it came out of something. */
function sourceOf(v: any, o: any): { x: number; y: number } | null {
  const src = o?.from ?? (v instanceof TakenValue || v instanceof Obj ? v : null);
  return src ? posOf(src) : null;
}
const fmt = (v: any) => (typeof v === "number" && !Number.isInteger(v) ? String(Number(v.toPrecision(4))) : String(v ?? ""));

// ---------------------------------------------------------------- simple objects
function shapeSize(label: unknown, shape: string, o: any) {
  const ls = lines(label);
  let w = o.w ?? Math.max(o.minW ?? 64, tw(label) + 34), h = o.h ?? Math.max(44, 24 + ls.length * 19);
  if (shape === "circle") { w = h = o.r ? o.r * 2 : Math.max(w, h, 50); }
  if (shape === "diamond") { w = o.w ?? tw(label) + 70; h = o.h ?? Math.max(64, h + 24); }
  return { w, h };
}
function shapeSpec(shape: string, w: number, h: number): ShapeSpec {
  if (shape === "circle") return { type: "circle", w, h };
  if (shape === "diamond") return { type: "diamond", w, h };
  return { type: "rect", w, h, r: shape === "round" || shape === "pill" ? h / 2 : 8 };
}
function nameIt(o: any, type: string, id: string) {
  if (o?.name) S.names[String(o.name)] = { type, id };
}

const scene = {
  /** The world's size: 1000 wide, and as tall as the screen's shape (e.g. 600 on a wide screen, 950 on a squarish one). */
  get width() { return W; },
  get height() { return H; },
  box(label: unknown, o: any = {}) {
    const shape = o.shape ?? "rect";
    const { w, h } = shapeSize(label, shape, o);
    const [x, y] = place(o, w, h);
    const id = addPrim({ kind: "shape", x, y, w, h, shape: shapeSpec(shape, w, h), hatch: o.hatch ?? true, texts: centredTexts(label, o.bold ? "label strong" : "label"),
      color: o.color, mark: o.mark, layer: o.layer, label: String(label) }, { from: o.from ? posOf(o.from) : null });
    nameIt(o, "obj", id); return new Obj(id);
  },
  circle(label: unknown, o: any = {}) { return scene.box(label, { ...o, shape: "circle" }); },
  text(text: unknown, o: any = {}) {
    const cls = ({ title: "title", big: "big", small: "small", label: "label", muted: "small muted" } as any)[o.size ?? "label"] ?? "label";
    const font = o.size === "title" ? "title" : o.size === "big" ? "big" : o.size === "small" || o.size === "muted" ? "small" : "label";
    const ls = lines(text);
    const w = tw(text, font), lh = font === "title" ? 28 : font === "big" ? 34 : font === "small" ? 17 : 20;
    const h = ls.length * lh;
    const [x, y] = place(o, w, h);
    const id = addPrim({ kind: "shape", x, y, w, h, shape: null, texts: centredTexts(text, cls + (o.color ? ` c-${o.color}` : ""), lh), color: o.color, label: String(text), layer: o.layer },
      { anim: o.anim ?? "fade", from: o.from ? posOf(o.from) : null });
    nameIt(o, "obj", id); return new Obj(id);
  },
  math(tex: string, o: any = {}) {
    const size = o.size === "big" ? 1.5 : o.size === "small" ? 0.95 : 1.2;
    const plain = String(tex).replace(/\\[a-zA-Z]+/g, "x").replace(/[{}^_]/g, "");
    const w = Math.max(40, plain.length * 11 * size), h = 44 * size;
    const [x, y] = place(o, w, h);
    const id = addPrim({ kind: "math", x, y, w, h, tex: String(tex), size, label: String(tex) }, { anim: "fade", dur: 450 });
    nameIt(o, "obj", id); return new Obj(id);
  },
  arrow(a: any, b: any, o: any = {}) {
    const end = (v: any): Endpoint => (v instanceof Obj && S.prims[v._main()] ? { id: v._main() } : posOf(v));
    const from = end(a), to = end(b);
    const pa = endPos(from), pb = endPos(to);
    const id = addPrim({ kind: "arrow", x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, w: 0, h: 0, from, to, text: o.label ? String(o.label) : undefined,
      bend: o.bend ?? 0, head: o.head ?? "end", dashed: !!o.dashed, color: o.color, label: o.label ? String(o.label) : "arrow" }, { anim: "draw", dur: o.dur ?? D.draw });
    nameIt(o, "obj", id); return new Obj(id);
  },
  /** A small note beside something, with a dashed pointer to it. */
  note(text: unknown, o: any = {}) {
    const target = o.near ?? o.on;
    const w = Math.min(260, tw(text, "small") + 16), ls = lines(text), h = ls.length * 17 + 6;
    let at: [number, number] | undefined;
    if (target) {
      const b = boxOf(target), side = o.side ?? "right", g = o.gap ?? 40;
      at = side === "left" ? [b.x0 - g - w / 2, (b.y0 + b.y1) / 2] : side === "top" ? [(b.x0 + b.x1) / 2, b.y0 - g - h / 2]
        : side === "bottom" ? [(b.x0 + b.x1) / 2, b.y1 + g + h / 2] : [b.x1 + g + w / 2, (b.y0 + b.y1) / 2];
    }
    const [x, y] = at ?? place(o, w, h);
    const id = addPrim({ kind: "shape", x, y, w, h, shape: null, texts: centredTexts(text, "note", 17), label: String(text) }, { anim: "fade" });
    const ids = [id];
    if (target instanceof Obj && S.prims[target._main()]) ids.push(addPrim({ kind: "arrow", x, y, w: 0, h: 0, from: { id }, to: { id: target._main() }, dashed: true, head: "end", cls: "note-arrow" }, { anim: "draw", owner: id }));
    nameIt(o, "obj", id);
    return new Obj(id);
  },
  /** A dot that travels from one thing to another (a message, a packet, data flowing). */
  packet(from: any, to: any, o: any = {}) {
    const dur = o.dur ?? D.packet;
    emit({ op: "packet", from: posOf(from), to: posOf(to), dur, text: o.label ? String(o.label) : undefined });
    return after(dur);
  },
  /** Dim everything except these (call with nothing to clear). */
  spotlight(...objs: any[]) {
    const ids = objs.flat().filter(Boolean).flatMap((o: any) => (o instanceof Obj ? o._ids() : []));
    emit({ op: "spotlight", ids: ids.length ? ids : null });
    return after(250);
  },
  clear(o: any = {}) {
    const dur = o.dur ?? D.fade;
    for (const id of Object.keys(S.prims)) removePrim(id, dur);
    S.macros = {}; S.names = {};
    emit({ op: "spotlight", ids: null });
    return after(dur);
  },
  get(name: string): any {
    const n = S.names[name];
    if (!n) throw new Error(`Nothing on screen is called "${name}". Named objects: ${Object.keys(S.names).join(", ") || "none"}.`);
    return handleFor(n.type, n.id);
  },
  array: (values: any[] = [], o: any = {}) => ArrayObj.create(values, o),
  tree: (spec: any, o: any = {}) => TreeObj.create(spec, o),
  graph: (nodes: any[], edges: any[] = [], o: any = {}) => GraphObj.create(nodes, edges, o),
  code: (src: string, o: any = {}) => CodeObj.create(src, o),
};

const camera = {
  focus(...args: any[]) {
    const o = args.length && !(args[args.length - 1] instanceof Obj) && !Array.isArray(args[args.length - 1]) && typeof args[args.length - 1] === "object" ? args.pop() : {};
    const b = union(args.flat().map((a: any) => boxOf(a)));
    if (!b) return after(0);
    const pad = o.pad ?? 60, dur = o.dur ?? D.camera;
    S.focused = true;
    emit({ op: "camera", box: [b.x0 - pad, b.y0 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad], dur });
    return after(dur);
  },
  reset(o: any = {}) { const dur = o.dur ?? D.camera; S.focused = false; emit({ op: "camera", box: null, dur }); return after(dur); },
};

// ---------------------------------------------------------------- array
const CELL_H = 52, CELL_GAP = 8;
class ArrayObj extends Obj {
  get d() { const d = S.macros[this.id]; if (!d) throw new Error("This array was removed."); return d; }
  static create(values: any[], o: any) {
    const id = newId("arr");
    const vals = Array.from(values ?? []);
    const cw = Math.max(52, ...vals.map((v) => tw(fmt(valueOf(v)), "value") + 26));
    const n = Math.max(vals.length, 3);
    const totalW = n * (cw + CELL_GAP) - CELL_GAP;
    const [cx, cy] = place(o, totalW, CELL_H + 70);
    const d = { type: "array", id, name: o.name ?? null, cells: [] as any[], ptrs: {} as Record<string, any>, x0: cx - totalW / 2 + cw / 2, y: cy, cw, title: null as string | null, label: o.label ?? o.name ?? null };
    S.macros[id] = d;
    nameIt(o, "array", id);
    const a = new ArrayObj(id);
    // the label sits to the left, so pointers above the cells have room
    if (d.label) { const lw = tw(String(d.label).toUpperCase(), "600 11px Inter, system-ui, sans-serif") + 6; d.title = addPrim({ kind: "shape", x: d.x0 - cw / 2 - 16 - lw / 2, y: cy, w: lw, h: 16, shape: null, texts: centredTexts(d.label, "small muted caps", 16) }, { owner: id, anim: "fade" }); }
    vals.forEach((v, i) => a._addCell(i, v, null, T + i * D.stagger * 0.6));
    if (!vals.length) a._placeholder(true);
    a._relayout(0); // index labels
    for (const [name, i] of Object.entries(o.pointers ?? {})) a.pointer(name, Number(i));
    return a;
  }
  _ids() { const d = S.macros[this.id]; if (!d) return []; return Object.values(S.prims).filter((r) => r.owner === this.id).map((r) => r.id); }
  _main() { return this.d.cells[0]?.pid ?? this._ids()[0]; }
  _markIds() { return this.d.cells.map((c: any) => c.pid); }
  _moved(dx: number, dy: number) { this.d.x0 += dx; this.d.y += dy; }
  _removed() { delete S.macros[this.id]; }
  _slot(i: number) { return { x: this.d.x0 + i * (this.d.cw + CELL_GAP), y: this.d.y }; }
  _placeholder(on: boolean, t?: number) {
    const d = this.d;
    if (on && !d.empty) d.empty = addPrim({ kind: "shape", x: d.x0, y: d.y, w: d.cw, h: CELL_H, shape: { type: "rect", w: d.cw, h: CELL_H, r: 8 }, hatch: false, cls: "placeholder", texts: centredTexts("empty", "small muted") }, { owner: this.id, anim: "fade" });
    if (!on && d.empty) { removePrim(d.empty, 200, "fade", t); d.empty = null; }
  }
  _addCell(i: number, v: any, from: { x: number; y: number } | null, t?: number) {
    const d = this.d;
    const label = fmt(valueOf(v));
    this._fitWidth([...d.cells.map((c: any) => c.label), label]);
    const p = this._slot(i);
    const pid = addPrim({ kind: "shape", x: p.x, y: p.y, w: d.cw, h: CELL_H, shape: { type: "rect", w: d.cw, h: CELL_H, r: 8 }, hatch: true, texts: centredTexts(label, "value"), label: `${label} (index ${i})`, cls: "cell" },
      { owner: this.id, from, t });
    d.cells.splice(i, 0, { pid, value: valueOf(v), label });
    this._placeholder(false, from ? T + D.fly * 0.8 : t);
  }
  _fitWidth(labels: string[]) {
    const d = this.d;
    const need = Math.max(52, ...labels.map((l) => tw(l, "value") + 26));
    if (need > d.cw + 0.5) {
      d.x0 += (need - d.cw) / 2 * 0; d.cw = need;
      for (const c of d.cells) updatePrim(c.pid, { w: need, shape: { type: "rect", w: need, h: CELL_H, r: 8 } });
    }
  }
  /** Re-position cells, index labels and pointers after a change. */
  _relayout(dur = D.move) {
    const d = this.d;
    d.cells.forEach((c: any, i: number) => { const p = this._slot(i); movePrim(c.pid, p.x, p.y, dur); });
    // index labels: one per slot
    d.idx = d.idx ?? [];
    while (d.idx.length > d.cells.length) removePrim(d.idx.pop(), 200);
    for (let i = 0; i < d.cells.length; i++) {
      const p = this._slot(i);
      if (!d.idx[i]) d.idx[i] = addPrim({ kind: "shape", x: p.x, y: p.y + CELL_H / 2 + 16, w: 14, h: 14, shape: null, texts: centredTexts(String(i), "index", 14) }, { owner: this.id, anim: "fade" });
      else movePrim(d.idx[i], p.x, p.y + CELL_H / 2 + 16, dur);
    }
    for (const name of Object.keys(d.ptrs)) this._placePointer(name, dur);
    if (!d.cells.length) this._placeholder(true);
  }
  _placePointer(name: string, dur = D.move) {
    const d = this.d, ptr = d.ptrs[name];
    const same = Object.entries(d.ptrs).filter(([, p]: any) => p.index === ptr.index).map(([k]) => k);
    const level = same.indexOf(name);
    const p = this._slot(ptr.index);
    movePrim(ptr.tid, p.x, p.y - CELL_H / 2 - 40 - level * 24, dur);
  }

  get length() { return this.d.cells.length; }
  get values() { return this.d.cells.map((c: any) => c.value); }
  get(i: number) { return this.d.cells[this._idx(i)]?.value; }
  indexOf(v: any) { return this.values.findIndex((x: any) => x === valueOf(v) || String(x) === String(valueOf(v))); }
  includes(v: any) { return this.indexOf(v) >= 0; }
  cell(i: number) { const c = this.d.cells[this._idx(i)]; if (!c) throw new Error(`No cell at index ${i} (length ${this.length}).`); return new Obj(c.pid); }
  _idx(i: number) { return i < 0 ? this.d.cells.length + i : i; }

  push(v: any, o: any = {}) { const from = sourceOf(v, o); this._addCell(this.length, v, from); this._relayout(); return after(from ? D.fly : D.pop); }
  unshift(v: any, o: any = {}) { return this.insert(0, v, o); }
  insert(i: number, v: any, o: any = {}) { const from = sourceOf(v, o); this._addCell(Math.max(0, Math.min(this.length, i)), v, from); this._relayout(); return after(from ? D.fly : D.move); }
  _take(i: number, anim: "up" | "shrink") {
    const d = this.d;
    if (!d.cells.length) throw new Error("Can't take from an empty array.");
    const c = d.cells.splice(i, 1)[0];
    const p = S.prims[c.pid].prim;
    const pos = { x: p.x, y: p.y };
    removePrim(c.pid, D.move, anim);
    this._relayout();
    return new Taken(c.value, pos.x, pos.y, T + D.move);
  }
  pop() { return this._take(this.length - 1, "shrink"); }
  /** Take the front value (a queue). With numbers, moves the whole array like any object. */
  shift(dx?: any, dy?: any, o?: any): any { if (typeof dx === "number") return super.shift(dx, dy ?? 0, o); return this._take(0, "up"); }
  removeAt(i: number) { return this._take(this._idx(i), "shrink"); }
  set(i: number, v: any, o: any = {}) {
    const c = this.d.cells[this._idx(i)]; if (!c) throw new Error(`No cell at index ${i}.`);
    const from = sourceOf(v, o);
    c.value = valueOf(v); c.label = fmt(c.value);
    this._fitWidth(this.d.cells.map((x: any) => x.label));
    if (from) { flyGhost(from, c.pid, c.label); updatePrim(c.pid, { texts: centredTexts(c.label, "value") }, "pop", T + D.fly); return after(D.fly + 200); }
    updatePrim(c.pid, { texts: centredTexts(c.label, "value") }, "pop");
    return after(D.pop);
  }
  swap(i: number, j: number, o: any = {}) {
    const d = this.d; i = this._idx(i); j = this._idx(j);
    if (i === j || !d.cells[i] || !d.cells[j]) return after(0);
    [d.cells[i], d.cells[j]] = [d.cells[j], d.cells[i]];
    const dur = o.dur ?? D.swap;
    const pi = this._slot(i), pj = this._slot(j);
    movePrim(d.cells[i].pid, pi.x, pi.y, dur, d.cw * 0.9 + 20);
    movePrim(d.cells[j].pid, pj.x, pj.y, dur, -(d.cw * 0.9 + 20));
    return after(dur);
  }
  pointer(name: string, i: number | null, o: any = {}) {
    const d = this.d;
    if (i === null || i === undefined) {
      const p = d.ptrs[name]; if (p) { removePrim(p.tid, 250); delete d.ptrs[name]; }
      return after(250);
    }
    if (!d.ptrs[name]) {
      const p = this._slot(i);
      const tid = addPrim({ kind: "shape", x: p.x, y: p.y - CELL_H / 2 - 40, w: Math.max(14, tw(name, "label")), h: 18, shape: null, texts: centredTexts(name, "pointer", 18), label: `pointer ${name}` }, { owner: this.id, anim: "pop" });
      d.ptrs[name] = { tid, index: i };
      // the arrow follows the label wherever it moves
      const target = d.cells[Math.max(0, Math.min(d.cells.length - 1, i))];
      d.ptrs[name].aid = addPrim({ kind: "arrow", x: p.x, y: p.y, w: 0, h: 0, from: { id: tid }, to: target && i >= 0 && i < d.cells.length ? { id: target.pid } : { x: p.x, y: p.y - CELL_H / 2 - 6 }, head: "end", cls: "pointer-arrow" }, { owner: this.id, anim: "draw" });
      this._placePointer(name, 0);
      return after(D.pop);
    }
    d.ptrs[name].index = i;
    const dur = o.dur ?? D.move;
    // re-aim the arrow at the new cell
    const target = d.cells[i];
    const p = this._slot(i);
    updatePrim(d.ptrs[name].aid, { to: target ? { id: target.pid } : { x: p.x, y: p.y - CELL_H / 2 - 6 } });
    for (const k of Object.keys(d.ptrs)) this._placePointer(k, dur);
    return after(dur);
  }
  mark(i: any, state?: Mark) {
    if (state === undefined) { for (const c of this.d.cells) updatePrim(c.pid, { mark: i }); return after(300); }
    for (const k of [i].flat()) { const c = this.d.cells[this._idx(Number(k))]; if (c) updatePrim(c.pid, { mark: state }); }
    return after(300);
  }
  describe() { const d = this.d; return `array${d.name ? ` "${d.name}"` : ""}: [${d.cells.map((c: any) => c.label).join(", ")}]${Object.keys(d.ptrs).length ? `, pointers ${Object.entries(d.ptrs).map(([k, p]: any) => `${k}=${p.index}`).join(" ")}` : ""}`; }
}

/** A copy of a value that flies from `from` to a target object, then disappears (the target updates). */
function flyGhost(from: { x: number; y: number }, targetId: string, label: string) {
  const t = S.prims[targetId]?.prim; if (!t) return;
  const g = addPrim({ kind: "shape", x: t.x, y: t.y, w: Math.max(40, tw(label, "value") + 20), h: 40, shape: { type: "rect", w: Math.max(40, tw(label, "value") + 20), h: 40, r: 8 }, hatch: true, cls: "ghost", texts: centredTexts(label, "value") }, { from });
  removePrim(g, 150, "fade", T + D.fly);
}

// ---------------------------------------------------------------- tree
const LEVEL_GAP = 92;
class TreeObj extends Obj {
  get d() { const d = S.macros[this.id]; if (!d) throw new Error("This tree was removed."); return d; }
  static create(spec: any, o: any) {
    const id = newId("tree");
    const d: any = { type: "tree", id, name: o.name ?? null, nodes: {}, order: [], root: null, binary: !!o.binary, cx: 0, top: 0 };
    S.macros[id] = d;
    nameIt(o, "tree", id);
    const t = new TreeObj(id);
    // accept ["A", ["B", ["D"], ["E"]], ["C"]]  or  {A: {B: {}, C: {}}}  or  {A: ["B", "C"], B: [...]}
    const addRec = (name: any, parent: string | null, side?: string) => { const k = String(name); d.nodes[k] = { name: k, label: k, parent, children: [], side }; d.order.push(k); if (parent) d.nodes[parent].children.push(k); else d.root = d.root ?? k; return k; };
    const fromArray = (a: any, parent: string | null, side?: string) => {
      if (a === null || a === undefined) return;
      if (!Array.isArray(a)) { addRec(a, parent, side); return; }
      const k = addRec(a[0], parent, side);
      a.slice(1).forEach((c: any, i: number) => {
        if (c === null) { if (d.binary || a.length === 3) d.binary = true; return; }
        fromArray(c, k, d.binary || a.length === 3 ? (i === 0 ? "left" : "right") : undefined);
      });
    };
    if (Array.isArray(spec)) fromArray(spec, null);
    else if (spec && typeof spec === "object") {
      const vals = Object.values(spec);
      if (vals.some((v) => Array.isArray(v))) { // adjacency: {A: ["B","C"], B: ["D"]}
        const kids = new Set(vals.flat().map(String));
        const roots = Object.keys(spec).filter((k) => !kids.has(k));
        const walk = (k: string, p: string | null) => { if (d.nodes[k]) return; addRec(k, p); for (const c of spec[k] ?? []) if (c !== null) walk(String(c), k); };
        (roots.length ? roots : [Object.keys(spec)[0]]).forEach((r) => walk(r, null));
      } else {
        const walk = (obj: any, p: string | null) => { for (const [k, v] of Object.entries(obj)) { addRec(k, p); if (v && typeof v === "object") walk(v, k); } };
        walk(spec, null);
      }
    } else if (spec !== undefined && spec !== null) addRec(spec, null);
    for (const [k, lab] of Object.entries(o.labels ?? {})) if (d.nodes[k]) d.nodes[k].label = String(lab);
    const lay = t._layout();
    const [cx, top] = place(o, lay.w, lay.h);
    d.cx = cx; d.top = top - lay.h / 2 + 24;
    // build in reading order (breadth-first), so it grows from the root
    const bfs = t._bfsNames();
    bfs.forEach((k, i) => {
      const n = d.nodes[k]; const p = t._pos(lay, k); const z = t._size(n.label);
      n.pid = addPrim({ kind: "shape", x: p.x, y: p.y, w: z.w, h: z.h, shape: z.circle ? { type: "circle", w: z.w, h: z.h } : { type: "rect", w: z.w, h: z.h, r: z.h / 2 }, hatch: true, texts: centredTexts(n.label, "label"), label: `node ${n.label}` },
        { owner: id, t: T + i * D.stagger });
      if (n.parent) n.eid = addPrim({ kind: "arrow", x: p.x, y: p.y, w: 0, h: 0, from: { id: d.nodes[n.parent].pid }, to: { id: n.pid }, head: o.arrows ? "end" : "none", label: `edge ${n.parent}–${k}` }, { owner: id, anim: "draw", t: T + i * D.stagger });
    });
    return t;
  }
  _size(label: string) { return String(label).length <= 3 ? { w: 50, h: 50, circle: true } : { w: Math.max(60, tw(label) + 28), h: 44, circle: false }; }
  _bfsNames(): string[] {
    const d = this.d; const out: string[] = [];
    const roots = d.order.filter((k: string) => !d.nodes[k].parent);
    const q = [...roots];
    while (q.length) { const k = q.shift()!; out.push(k); q.push(...this._kids(k).filter(Boolean)); }
    return out;
  }
  _kids(k: string): string[] {
    const n = this.d.nodes[k];
    if (!this.d.binary) return n.children;
    const l = n.children.find((c: string) => this.d.nodes[c].side === "left") ?? null;
    const r = n.children.find((c: string) => this.d.nodes[c].side === "right") ?? null;
    return [l, r].filter(Boolean) as string[];
  }
  /** Tidy layout: leaves get consecutive slots; parents sit over their children (binary: in-order). */
  _layout() {
    const d = this.d;
    const unit = Math.max(64, ...Object.values(d.nodes).map((n: any) => this._size(n.label).w + 16));
    const pos: Record<string, { x: number; depth: number }> = {};
    let slot = 0, maxDepth = 0;
    const place2 = (k: string, depth: number) => {
      maxDepth = Math.max(maxDepth, depth);
      const n = d.nodes[k];
      if (d.binary) {
        const l = n.children.find((c: string) => d.nodes[c].side === "left"), r = n.children.find((c: string) => d.nodes[c].side === "right");
        if (l) place2(l, depth + 1); else if (r) slot += 0.5;
        pos[k] = { x: slot++ * unit, depth };
        if (r) place2(r, depth + 1); else if (l) slot += 0.5;
      } else if (!n.children.length) pos[k] = { x: slot++ * unit, depth };
      else { n.children.forEach((c: string) => place2(c, depth + 1)); const xs = n.children.map((c: string) => pos[c].x); pos[k] = { x: (Math.min(...xs) + Math.max(...xs)) / 2, depth }; }
    };
    d.order.filter((k: string) => !d.nodes[k].parent).forEach((r: string) => { place2(r, 0); slot += 0.6; });
    const xs = Object.values(pos).map((p) => p.x);
    const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    return { pos, mid, w: (xs.length ? Math.max(...xs) - Math.min(...xs) : 0) + unit, h: maxDepth * LEVEL_GAP + 60 };
  }
  _pos(lay: any, k: string) { const p = lay.pos[k]; return { x: this.d.cx + (p.x - lay.mid), y: this.d.top + p.depth * LEVEL_GAP }; }
  _relayout(dur = D.move) {
    const lay = this._layout();
    for (const k of Object.keys(this.d.nodes)) { const n = this.d.nodes[k], p = this._pos(lay, k); if (n.pid) movePrim(n.pid, p.x, p.y, dur); }
  }
  _ids() { if (!S.macros[this.id]) return []; return Object.values(S.prims).filter((r) => r.owner === this.id).map((r) => r.id); }
  _main() { return this.d.nodes[this.d.root]?.pid ?? this._ids()[0]; }
  _markIds() { return Object.values(this.d.nodes).map((n: any) => n.pid); }
  _moved(dx: number, dy: number) { this.d.cx += dx; this.d.top += dy; }
  _removed() { delete S.macros[this.id]; }

  node(name: any) { const k = String(name); if (!this.d.nodes[k]) throw new Error(`No node "${k}" in the tree. Nodes: ${Object.keys(this.d.nodes).join(", ")}`); return new TreeNode(this.id, k); }
  get root() { return this.d.root ? this.node(this.d.root) : null; }
  get nodes() { return Object.keys(this.d.nodes).map((k) => this.node(k)); }
  has(name: any) { return !!this.d.nodes[String(name)]; }
  edge(parent: any, child: any) { const n = this.d.nodes[String(child)]; if (!n?.eid || n.parent !== String(parent)) throw new Error(`No edge ${parent}–${child}.`); return new Obj(n.eid); }
  bfs() { return this._bfsNames().map((k) => this.node(k)); }
  dfs() { const out: TreeNode[] = []; const go = (k: string) => { out.push(this.node(k)); this._kids(k).forEach(go); }; if (this.d.root) go(this.d.root); return out; }
  preorder() { return this.dfs(); }
  inorder() { const out: TreeNode[] = []; const go = (k: string | undefined) => { if (!k) return; const n = this.d.nodes[k]; const l = n.children.find((c: string) => this.d.nodes[c].side === "left") ?? (this.d.binary ? undefined : n.children[0]); const r = n.children.find((c: string) => this.d.nodes[c].side === "right") ?? (this.d.binary ? undefined : n.children[1]); go(l); out.push(this.node(k)); go(r); }; go(this.d.root); return out; }
  postorder() { const out: TreeNode[] = []; const go = (k: string) => { this._kids(k).forEach(go); out.push(this.node(k)); }; if (this.d.root) go(this.d.root); return out; }
  add(parent: any, name: any, o: any = {}) {
    const d = this.d, k = String(name), p = parent === null || parent === undefined ? null : String(parent);
    if (d.nodes[k]) throw new Error(`The tree already has a node "${k}".`);
    if (p && !d.nodes[p]) throw new Error(`No parent node "${p}".`);
    const side = o.side ?? (d.binary && p ? (d.nodes[p].children.some((c: string) => d.nodes[c].side === "left") ? "right" : "left") : undefined);
    if (side) d.binary = true;
    d.nodes[k] = { name: k, label: String(o.label ?? k), parent: p, children: [], side };
    d.order.push(k);
    if (p) d.nodes[p].children.push(k); else d.root = d.root ?? k;
    const lay = this._layout();
    const pos = this._pos(lay, k), z = this._size(d.nodes[k].label);
    this._relayout();
    const from = sourceOf(null, o);
    d.nodes[k].pid = addPrim({ kind: "shape", x: pos.x, y: pos.y, w: z.w, h: z.h, shape: z.circle ? { type: "circle", w: z.w, h: z.h } : { type: "rect", w: z.w, h: z.h, r: z.h / 2 }, hatch: true, texts: centredTexts(d.nodes[k].label, "label"), label: `node ${d.nodes[k].label}` },
      { owner: this.id, from, t: T + 150 });
    if (p) d.nodes[k].eid = addPrim({ kind: "arrow", x: pos.x, y: pos.y, w: 0, h: 0, from: { id: d.nodes[p].pid }, to: { id: d.nodes[k].pid }, head: "none" }, { owner: this.id, anim: "draw", t: T + 150 });
    return after(D.move + 150);
  }
  remove(name?: any, o: any = {}) {
    if (name === undefined) return super.remove(o);
    const d = this.d, k = String(name);
    if (!d.nodes[k]) return after(0);
    const gone: string[] = [];
    const collect = (x: string) => { gone.push(x); d.nodes[x].children.forEach(collect); };
    collect(k);
    const p = d.nodes[k].parent;
    if (p) d.nodes[p].children = d.nodes[p].children.filter((c: string) => c !== k);
    for (const x of gone) { if (d.nodes[x].pid) removePrim(d.nodes[x].pid, D.fade, "shrink"); delete d.nodes[x]; }
    d.order = d.order.filter((x: string) => !gone.includes(x));
    if (d.root === k) d.root = null;
    this._relayout();
    return after(D.move);
  }
  /** Swap two nodes' values (heaps, rotations): the labels fly past each other. */
  swap(a: any, b: any) {
    const na = this.d.nodes[String(a)], nb = this.d.nodes[String(b)];
    if (!na || !nb) throw new Error(`Can't swap ${a} and ${b}: both must be nodes.`);
    const pa = S.prims[na.pid].prim, pb = S.prims[nb.pid].prim;
    flyGhost({ x: pa.x, y: pa.y }, nb.pid, na.label);
    flyGhost({ x: pb.x, y: pb.y }, na.pid, nb.label);
    [na.label, nb.label] = [nb.label, na.label];
    updatePrim(na.pid, { texts: centredTexts(na.label, "label") }, "pop", T + D.fly);
    updatePrim(nb.pid, { texts: centredTexts(nb.label, "label") }, "pop", T + D.fly);
    return after(D.fly + 200);
  }
  describe() {
    const d = this.d;
    const show = (k: string): string => {
      const n = d.nodes[k];
      if (d.binary) { // keep left/right visible: 10(_,14)
        const l = n.children.find((c: string) => d.nodes[c].side === "left"), r = n.children.find((c: string) => d.nodes[c].side === "right");
        return `${n.label}${l || r ? `(${l ? show(l) : "_"},${r ? show(r) : "_"})` : ""}`;
      }
      const kids = this._kids(k); return `${n.label}${kids.length ? `(${kids.map(show).join(",")})` : ""}`;
    };
    return `tree${d.name ? ` "${d.name}"` : ""}${d.binary ? " (binary)" : ""}: ${d.root ? show(d.root) : "empty"}`;
  }
}
class TreeNode extends Obj {
  constructor(readonly treeId: string, readonly name: string) { super(S.macros[treeId].nodes[name].pid); }
  get n() { return S.macros[this.treeId].nodes[this.name]; }
  get value() { const v = this.n.label; return v !== "" && !isNaN(Number(v)) ? Number(v) : v; }
  get children(): TreeNode[] { return new TreeObj(this.treeId)._kids(this.name).map((k) => new TreeNode(this.treeId, k)); }
  get parent(): TreeNode | null { return this.n.parent ? new TreeNode(this.treeId, this.n.parent) : null; }
  get left(): TreeNode | null { const k = this.n.children.find((c: string) => S.macros[this.treeId].nodes[c].side === "left"); return k ? new TreeNode(this.treeId, k) : null; }
  get right(): TreeNode | null { const k = this.n.children.find((c: string) => S.macros[this.treeId].nodes[c].side === "right"); return k ? new TreeNode(this.treeId, k) : null; }
  get isLeaf() { return this.n.children.length === 0; }
  get edge() { return this.n.eid ? new Obj(this.n.eid) : null; }
  setLabel(text: unknown) { this.n.label = String(text); return super.setLabel(text); }
  toString() { return String(this.n.label); }
}

// ---------------------------------------------------------------- graph
class GraphObj extends Obj {
  get d() { const d = S.macros[this.id]; if (!d) throw new Error("This graph was removed."); return d; }
  static create(nodes: any[], edges: any[], o: any) {
    const id = newId("graph");
    const d: any = { type: "graph", id, name: o.name ?? null, nodes: {}, edges: [], directed: o.directed !== false, dir: o.direction === "LR" || o.direction === "TB" ? o.direction : H > 760 ? "TB" : "LR", layout: o.layout ?? "auto", cx: 0, cy: 0 };
    S.macros[id] = d;
    nameIt(o, "graph", id);
    for (const n of nodes ?? []) { const k = String(typeof n === "object" ? n.name ?? n.id : n); d.nodes[k] = { name: k, label: String(typeof n === "object" ? n.label ?? k : k), shape: typeof n === "object" ? n.shape : undefined }; }
    for (const e of edges ?? []) { const [a, b, extra] = Array.isArray(e) ? e : [e.from, e.to, e]; for (const k of [a, b]) if (!d.nodes[String(k)]) d.nodes[String(k)] = { name: String(k), label: String(k) }; d.edges.push({ a: String(a), b: String(b), label: extra?.label !== undefined ? String(extra.label) : extra && typeof extra !== "object" ? String(extra) : "" }); }
    const g = new GraphObj(id);
    const lay = g._layout();
    const [cx, cy] = place(o, lay.w, lay.h);
    d.cx = cx; d.cy = cy;
    Object.keys(d.nodes).forEach((k, i) => g._makeNode(k, lay, T + i * D.stagger));
    d.edges.forEach((e: any, i: number) => g._makeEdge(e, T + (Object.keys(d.nodes).length + i) * D.stagger * 0.5));
    return g;
  }
  _size(n: any) { const s = n.shape ?? (String(n.label).length <= 3 ? "circle" : "round"); const z = shapeSize(n.label, s, {}); return { ...z, shape: s }; }
  _layout() {
    const d = this.d; const keys = Object.keys(d.nodes);
    const pos: Record<string, { x: number; y: number }> = {};
    if (d.layout === "circle") {
      const r = Math.max(120, keys.length * 34);
      keys.forEach((k, i) => { const a = -Math.PI / 2 + (i / keys.length) * Math.PI * 2; pos[k] = { x: Math.cos(a) * r, y: Math.sin(a) * r }; });
      return { pos, w: 2 * r + 100, h: 2 * r + 80 };
    }
    const g = new Graph({ multigraph: true });
    g.setGraph({ rankdir: d.dir, nodesep: 50, ranksep: 70 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const k of keys) { const z = this._size(d.nodes[k]); g.setNode(k, { width: z.w, height: z.h }); }
    d.edges.forEach((e: any, i: number) => g.setEdge(e.a, e.b, {}, `e${i}`));
    layout(g);
    const gr = g.graph() as any;
    for (const k of keys) { const n = g.node(k); pos[k] = { x: n.x - (gr.width ?? 0) / 2, y: n.y - (gr.height ?? 0) / 2 }; }
    return { pos, w: gr.width ?? 100, h: gr.height ?? 100 };
  }
  _makeNode(k: string, lay: any, t?: number, from?: { x: number; y: number } | null) {
    const d = this.d, n = d.nodes[k], z = this._size(n), p = lay.pos[k];
    n.pid = addPrim({ kind: "shape", x: d.cx + p.x, y: d.cy + p.y, w: z.w, h: z.h, shape: shapeSpec(z.shape, z.w, z.h), hatch: true, texts: centredTexts(n.label, "label"), label: `node ${n.label}` }, { owner: this.id, t, from });
  }
  _makeEdge(e: any, t?: number) {
    const d = this.d;
    const back = d.edges.some((x: any) => x !== e && x.a === e.b && x.b === e.a);
    e.pid = addPrim({ kind: "arrow", x: 0, y: 0, w: 0, h: 0, from: { id: d.nodes[e.a].pid }, to: { id: d.nodes[e.b].pid }, head: d.directed ? "end" : "none", text: e.label || undefined, bend: back ? 18 : 0, label: `edge ${e.a}→${e.b}` }, { owner: this.id, anim: "draw", t });
  }
  _relayout(dur = D.move) { const lay = this._layout(); for (const k of Object.keys(this.d.nodes)) { const n = this.d.nodes[k]; if (n.pid) movePrim(n.pid, this.d.cx + lay.pos[k].x, this.d.cy + lay.pos[k].y, dur); } }
  _ids() { if (!S.macros[this.id]) return []; return Object.values(S.prims).filter((r) => r.owner === this.id).map((r) => r.id); }
  _main() { return Object.values(this.d.nodes as Record<string, any>)[0]?.pid; }
  _markIds() { return Object.values(this.d.nodes).map((n: any) => n.pid); }
  _moved(dx: number, dy: number) { this.d.cx += dx; this.d.cy += dy; }
  _removed() { delete S.macros[this.id]; }
  node(name: any) { const n = this.d.nodes[String(name)]; if (!n) throw new Error(`No node "${name}". Nodes: ${Object.keys(this.d.nodes).join(", ")}`); return Object.assign(new Obj(n.pid), { name: n.name, toString: () => n.label }); }
  edge(a: any, b: any) {
    const e = this.d.edges.find((x: any) => (x.a === String(a) && x.b === String(b)) || (!this.d.directed && x.a === String(b) && x.b === String(a)));
    if (!e) throw new Error(`No edge ${a}–${b}.`);
    return new Obj(e.pid);
  }
  get nodes() { return Object.keys(this.d.nodes).map((k) => this.node(k)); }
  neighbors(name: any) {
    const k = String(name);
    return this.d.edges.filter((e: any) => e.a === k || (!this.d.directed && e.b === k)).map((e: any) => this.node(e.a === k ? e.b : e.a));
  }
  addNode(name: any, o: any = {}) {
    const k = String(name); if (this.d.nodes[k]) return after(0);
    this.d.nodes[k] = { name: k, label: String(o.label ?? k) };
    this._relayout();
    this._makeNode(k, this._layout(), T + 150, sourceOf(null, o));
    return after(D.move + 150);
  }
  addEdge(a: any, b: any, o: any = {}) {
    for (const k of [a, b]) if (!this.d.nodes[String(k)]) this.addNode(k);
    const e = { a: String(a), b: String(b), label: o.label !== undefined ? String(o.label) : "" };
    this.d.edges.push(e);
    this._makeEdge(e);
    return after(D.draw);
  }
  removeNode(name: any) {
    const k = String(name), n = this.d.nodes[k]; if (!n) return after(0);
    removePrim(n.pid, D.fade, "shrink");
    delete this.d.nodes[k];
    this.d.edges = this.d.edges.filter((e: any) => e.a !== k && e.b !== k);
    this._relayout();
    return after(D.move);
  }
  removeEdge(a: any, b: any) { const e = this.d.edges.find((x: any) => x.a === String(a) && x.b === String(b)); if (e) { removePrim(e.pid); this.d.edges = this.d.edges.filter((x: any) => x !== e); } return after(D.fade); }
  describe() { const d = this.d; return `graph${d.name ? ` "${d.name}"` : ""}: nodes ${Object.keys(d.nodes).join(", ")}; edges ${d.edges.map((e: any) => `${e.a}${d.directed ? "→" : "–"}${e.b}${e.label ? `(${e.label})` : ""}`).join(", ")}`; }
}

// ---------------------------------------------------------------- code tracer
const LH = 25;
class CodeObj extends Obj {
  get d() { const d = S.macros[this.id]; if (!d) throw new Error("This code block was removed."); return d; }
  static create(src: string, o: any) {
    const id = newId("code");
    const ls = String(src ?? "").replace(/\t/g, "    ").replace(/\n+$/, "").split("\n");
    const pw = Math.max(320, ...ls.map((l) => tw(l, "mono") + 40));
    const ph = ls.length * LH + 18;
    const varsBelow = o.varsBelow ?? false;
    const totalW = pw + (varsBelow ? 0 : 200), totalH = ph + 60;
    const [cx, cy] = place(o, totalW, totalH);
    const left = cx - totalW / 2, top = cy - totalH / 2 + 30;
    const d: any = { type: "code", id, name: o.name ?? null, lang: o.lang ?? "", lines: [], left, top, pw, ph, current: 0, vars: {}, varOrder: [], out: [], varsBelow };
    S.macros[id] = d;
    nameIt(o, "code", id);
    if (o.title !== false) d.title = addPrim({ kind: "shape", x: left + tw(o.title ?? (o.lang ? `Code · ${o.lang}` : "Code"), "small") / 2, y: top - 22, w: tw(o.title ?? "Code", "small"), h: 16, shape: null, texts: centredTexts(o.title ?? (o.lang ? `Code · ${o.lang}` : "Code"), "small muted caps", 16) }, { owner: id, anim: "fade" });
    d.panel = addPrim({ kind: "shape", x: left + pw / 2, y: top + ph / 2 - 9, w: pw, h: ph, shape: { type: "rect", w: pw, h: ph, r: 10 }, hatch: false, cls: "code-panel", layer: "back", texts: [] }, { owner: id, anim: "fade" });
    ls.forEach((l, i) => {
      const w = Math.max(4, tw(l, "mono"));
      const pid = addPrim({ kind: "shape", x: left + 44 + w / 2, y: top + i * LH, w, h: LH - 4, shape: null, texts: [{ text: l || " ", dx: -w / 2, anchor: "start", cls: "mono" }], label: `line ${i + 1}: ${l.trim()}`, cls: "codeline" },
        { owner: id, anim: "fade", t: T + i * 40 });
      const nid = addPrim({ kind: "shape", x: left + 20, y: top + i * LH, w: 16, h: 14, shape: null, texts: centredTexts(String(i + 1), "lineno", 14) }, { owner: id, anim: "fade", t: T + i * 40 });
      d.lines.push({ pid, nid, text: l });
    });
    const c = new CodeObj(id);
    if (o.line ?? o.current) c.line(Number(o.line ?? o.current));
    for (const [k, v] of Object.entries(o.vars ?? {})) c.var(k, v);
    return c;
  }
  _ids() { if (!S.macros[this.id]) return []; return Object.values(S.prims).filter((r) => r.owner === this.id).map((r) => r.id); }
  _main() { return this.d.panel; }
  _moved(dx: number, dy: number) { this.d.left += dx; this.d.top += dy; }
  _removed() { delete S.macros[this.id]; }
  _lineY(n: number) { return this.d.top + (n - 1) * LH; }
  /** Move the "current line" marker to line n (1-based). */
  line(n: number, o: any = {}) {
    const d = this.d; n = Math.max(1, Math.min(d.lines.length, Math.round(n)));
    const dur = o.dur ?? 450;
    const y = this._lineY(n);
    if (d.current && d.lines[d.current - 1]) updatePrim(d.lines[d.current - 1].pid, { cls: "codeline" });
    updatePrim(d.lines[n - 1].pid, { cls: "codeline current" });
    if (!d.cursor) {
      d.cursor = addPrim({ kind: "shape", x: d.left + d.pw / 2, y, w: d.pw - 10, h: LH, shape: { type: "rect", w: d.pw - 10, h: LH, r: 5 }, hatch: true, cls: "code-cursor", layer: "back", texts: [] }, { owner: this.id, anim: "fade" });
      d.arrow = addPrim({ kind: "shape", x: d.left - 18, y, w: 18, h: 18, shape: null, texts: centredTexts("➜", "cursor-arrow", 18) }, { owner: this.id, anim: "pop" });
    } else { movePrim(d.cursor, d.left + d.pw / 2, y, dur); movePrim(d.arrow, d.left - 18, y, dur); }
    d.current = n;
    return after(dur);
  }
  get currentLine() { return this.d.current; }
  /** The object for line n, e.g. to spotlight or note it. */
  at(n: number) { const l = this.d.lines[n - 1]; if (!l) throw new Error(`The code has no line ${n}.`); return Object.assign(new Obj(l.pid), { toString: () => l.text }); }
  _varPos(i: number) {
    const d = this.d;
    return d.varsBelow ? { x: d.left, y: d.top + d.ph + 26 + i * 46 } : { x: d.left + d.pw + 34, y: d.top + 8 + i * 46 };
  }
  /** Set a variable shown beside the code. Pass something taken from elsewhere (or {from}) and the value flies in. */
  var(name: string, value: any, o: any = {}) {
    const d = this.d; const k = String(name);
    const label = fmt(valueOf(value));
    const from = sourceOf(value, o);
    const w = Math.max(130, tw(k, "mono") + tw(label, "mono") + 54), h = 38;
    const texts = (w2: number): TextSpec[] => [{ text: k, dx: -w2 / 2 + 12, anchor: "start", cls: "mono-muted" }, { text: label, dx: w2 / 2 - 12, anchor: "end", cls: "mono-strong" }];
    if (!d.vars[k]) {
      d.varOrder.push(k);
      if (!d.varsTitle) { const p0 = this._varPos(0); d.varsTitle = addPrim({ kind: "shape", x: p0.x + tw("Variables", "small") / 2, y: p0.y - 30, w: tw("Variables", "small"), h: 16, shape: null, texts: centredTexts("Variables", "small muted caps", 16) }, { owner: this.id, anim: "fade" }); }
      const p = this._varPos(d.varOrder.length - 1);
      const pid = addPrim({ kind: "shape", x: p.x + w / 2, y: p.y, w, h, shape: { type: "rect", w, h, r: 7 }, hatch: false, cls: "var", texts: texts(w), label: `variable ${k}` }, { owner: this.id });
      d.vars[k] = { pid, value: valueOf(value), w };
      if (from) flyGhost(from, pid, label);
      this._layoutOutput();
      return after(from ? D.fly : D.pop);
    }
    const v = d.vars[k];
    v.value = valueOf(value);
    const nw = Math.max(v.w, w);
    const p = this._varPos(d.varOrder.indexOf(k));
    if (from) { flyGhost(from, v.pid, label); updatePrim(v.pid, { texts: texts(nw), w: nw, shape: { type: "rect", w: nw, h, r: 7 } }, "pop", T + D.fly); }
    else updatePrim(v.pid, { texts: texts(nw), w: nw, shape: { type: "rect", w: nw, h, r: 7 } }, "pop");
    if (nw !== v.w) { v.w = nw; movePrim(v.pid, p.x + nw / 2, p.y, 200); }
    return after(from ? D.fly + 200 : D.pop);
  }
  get vars() { return Object.fromEntries(Object.entries(this.d.vars).map(([k, v]: any) => [k, v.value])); }
  variable(name: string) { const v = this.d.vars[String(name)]; if (!v) throw new Error(`No variable "${name}" yet: set it with code.var("${name}", value).`); return new Obj(v.pid); }
  _outTop() {
    const d = this.d;
    const varsH = d.varsBelow ? d.varOrder.length * 46 + (d.varOrder.length ? 30 : 0) : 0;
    return d.top + d.ph + 24 + varsH;
  }
  _layoutOutput(dur = 300) {
    const d = this.d; if (!d.console) return;
    const top = this._outTop();
    const h = d.out.length * 22 + 16;
    movePrim(d.outTitle, d.left + tw("Output", "small") / 2, top, dur);
    updatePrim(d.console, { h, shape: { type: "rect", w: d.pw, h, r: 8 } });
    movePrim(d.console, d.left + d.pw / 2, top + 16 + h / 2, dur);
    d.out.forEach((o: any, i: number) => movePrim(o.pid, d.left + 14 + o.w / 2, top + 16 + 18 + i * 22, dur));
  }
  /** Add a line to the output console under the code. */
  print(text: unknown) {
    const d = this.d; const s = String(valueOf(text));
    const top = this._outTop();
    if (!d.console) {
      d.outTitle = addPrim({ kind: "shape", x: d.left + tw("Output", "small") / 2, y: top, w: tw("Output", "small"), h: 16, shape: null, texts: centredTexts("Output", "small muted caps", 16) }, { owner: this.id, anim: "fade" });
      d.console = addPrim({ kind: "shape", x: d.left + d.pw / 2, y: top + 16 + 19, w: d.pw, h: 38, shape: { type: "rect", w: d.pw, h: 38, r: 8 }, hatch: false, cls: "console", layer: "back", texts: [], label: "the output" }, { owner: this.id, anim: "fade" });
    }
    const w = Math.max(4, tw(s, "mono"));
    const pid = addPrim({ kind: "shape", x: d.left + 14 + w / 2, y: top + 16 + 18 + d.out.length * 22, w, h: 20, shape: null, texts: [{ text: s, dx: -w / 2, anchor: "start", cls: "mono out" }] }, { owner: this.id, anim: "fade" });
    d.out.push({ pid, w, text: s });
    this._layoutOutput(0);
    return after(D.pop);
  }
  mark(lines: any, state?: Mark) {
    if (state === undefined) return super.mark(lines);
    for (const n of [lines].flat()) { const l = this.d.lines[Number(n) - 1]; if (l) updatePrim(l.pid, { mark: state }); }
    return after(300);
  }
  describe() { const d = this.d; return `code${d.name ? ` "${d.name}"` : ""}${d.lang ? ` (${d.lang})` : ""}: ${d.lines.length} lines, current line ${d.current || "none"}${d.varOrder.length ? `; variables ${d.varOrder.map((k: string) => `${k}=${fmt(d.vars[k].value)}`).join(", ")}` : ""}${d.out.length ? `; output: ${d.out.map((o: any) => o.text).join(" | ")}` : ""}`; }
}

function handleFor(type: string, id: string): any {
  if (type === "array") return new ArrayObj(id);
  if (type === "tree") return new TreeObj(id);
  if (type === "graph") return new GraphObj(id);
  if (type === "code") return new CodeObj(id);
  return new Obj(id);
}

// ---------------------------------------------------------------- narration & timing helpers
function newBeat(text: string) { cur = { text, cmds: [], animDur: 0 }; beats.push(cur); T = 0; }
let spotOn = false;
/** Start a new spoken step. Everything after it (until the next say) animates while it's spoken. */
function say(text: unknown, o: any = {}) {
  const s = String(text ?? "").trim();
  if (!cur.text && beats.length === 1) cur.text = s; // the setup before the first say() plays with it
  else newBeat(s);
  if (o.focus) { scene.spotlight(...[o.focus].flat()); spotOn = true; }
  else if (spotOn) { emit({ op: "spotlight", ids: null }); spotOn = false; }
  return new Anim(T);
}
/**
 * Ask the student to predict the next step. The question is spoken as its own beat; playback then
 * pauses until they answer, and the beats after it show what really happens.
 */
function predict(question: unknown, o: any = {}) {
  const q = String(question ?? "").trim();
  if (!q) throw new Error("predict() needs a question");
  const choices = (Array.isArray(o.choices) ? o.choices : []).map((c: unknown) => String(c ?? "").trim()).filter(Boolean).slice(0, 5);
  if (choices.length < 2) throw new Error("predict() needs 2 to 5 choices, e.g. predict(\"Which node is next?\", {choices: [\"B\", \"C\"], answer: 0})");
  const answer = typeof o.answer === "number" ? o.answer : choices.indexOf(String(o.answer ?? "").trim());
  if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) throw new Error("predict()'s answer must be the index (from 0) or the text of one of its choices");
  if (!cur.text && beats.length === 1 && !cur.cmds.length) cur.text = q;
  else newBeat(q);
  cur.predict = { question: q, choices, answer, explain: String(o.explain ?? "").trim() };
  return new Anim(T);
}
const wait = (ms = 400) => new Anim(T + Number(ms));
const all = (...anims: any[]) => new Anim(Math.max(T, ...anims.flat().map((a: any) => (a && typeof a.end === "number" ? a.end : T))));
const sequence = all;

function describeScene(): string {
  const out: string[] = [];
  const named = new Map(Object.entries(S.names).map(([k, v]) => [v.id, k]));
  for (const [id, m] of Object.entries(S.macros)) {
    const h: any = handleFor(m.type, id);
    out.push(`- ${named.has(id) ? `scene.get("${named.get(id)}") → ` : ""}${h.describe()}`);
  }
  const loose = Object.values(S.prims).filter((r) => !r.owner && r.prim.kind !== "arrow");
  for (const r of loose.slice(0, 25)) {
    const p = r.prim as any;
    const what = p.kind === "math" ? `math ${p.tex}` : p.shape ? `${p.shape.type === "circle" ? "circle" : "box"} "${p.label}"` : `text "${p.label}"`;
    out.push(`- ${named.has(r.id) ? `scene.get("${named.get(r.id)}") → ` : ""}${what}`);
  }
  if (loose.length > 25) out.push(`- …and ${loose.length - 25} more shapes/texts`);
  return out.length ? out.join("\n") : "(the canvas is empty)";
}

// ---------------------------------------------------------------- running a script
const AsyncFunction = Object.getPrototypeOf(async function () { /* */ }).constructor;

async function run(script: string): Promise<{ program: Program; before: string; after: string }> {
  const before = JSON.stringify(S);
  beats = []; cmdCount = 0; spotOn = false;
  newBeat("");
  let error: string | undefined, errorLine: number | undefined;
  try {
    if (/\bimport\s*\(/.test(script)) throw new Error("import() isn't available in animation scripts.");
    const fn = new AsyncFunction("scene", "say", "predict", "wait", "all", "sequence", "camera", "Math", script);
    await fn(scene, say, predict, wait, all, sequence, camera, Math);
  } catch (e: any) {
    error = String(e?.message ?? e);
    const m = String(e?.stack ?? "").match(/<anonymous>:(\d+):(\d+)/);
    if (m) errorLine = Math.max(1, Number(m[1]) - 2);
  }
  for (const b of beats) b.animDur = Math.max(0, ...b.cmds.map((c: any) => c.t + (c.dur ?? 0)));
  const program: Program = { beats: beats.filter((b, i) => b.cmds.length || b.text || i === 0), describe: describeScene(), error, errorLine };
  // After an error, what ran so far stays (the player shows the same), and `before` lets a fixed script start over.
  return { program, before, after: JSON.stringify(S) };
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === "reset") S = { seq: 0, prims: {}, macros: {}, names: {}, focused: false };
  else if (msg.type === "restore") S = JSON.parse(msg.snapshot);
  else if (msg.type === "run") {
    if (msg.aspect && isFinite(msg.aspect)) H = Math.round(Math.max(420, Math.min(1400, 1000 / msg.aspect)));
    const { program, before, after } = await run(msg.script);
    (self as any).postMessage({ type: "done", runId: msg.runId, program, before, after } satisfies FromWorker);
    return;
  }
  (self as any).postMessage({ type: "ready" } satisfies FromWorker);
};
