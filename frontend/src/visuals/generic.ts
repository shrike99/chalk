/**
 * State and ops for the "scene" kinds. Each kind is a title plus a few collections of
 * items with ids. Every kind supports the same ops:
 *   add    {"op":"add", "into"?: collection, "item": {...}, "after"?: id, "index"?: n}
 *   update {"op":"update", "id": ..., any fields to change}
 *   remove {"op":"remove", "ids": [...]}
 *   mark   {"op":"mark", "ids": [...], "state": "current"|"visited"|"done"|"error"|"none"}
 *   set    {"op":"set", "field": ..., "value": ...}   (top-level fields, e.g. a chart's unit)
 * plus a few kind-specific ones handled in `special` below.
 */
import type { Op } from "./state";

export const SCENE_KINDS = [
  "tree", "linkedlist", "hashtable", "memory", "code", "bits",
  "bar", "line", "pie", "numberline", "timeline", "quadrant", "fraction",
  "venn", "mindmap", "cycle", "layers", "pyramid", "compare", "steps", "geometry",
] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];
export interface SceneState { kind: SceneKind; title: string; [k: string]: any }

type Item = Record<string, any> & { id: string };
interface Desc {
  colls: string[];
  infer?: (item: any) => string | undefined;     // which collection an added item belongs to
  defaults?: Record<string, any>;               // top-level fields
  prep?: (s: SceneState) => void;               // tidy after normalising
  special?: (s: SceneState, op: Op) => boolean; // kind-specific ops; true if handled
}

const str = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));
const num = (v: unknown, d = 0) => { const n = Number(v); return v !== "" && v !== null && v !== undefined && Number.isFinite(n) ? n : d; };
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const MARKS = ["current", "visited", "done", "error", "none"];

function findItem(s: SceneState, id: string): Item | undefined {
  for (const c of DESCS[s.kind].colls) { const it = arr(s[c]).find((x) => x.id === id); if (it) return it; }
}

const DESCS: Record<SceneKind, Desc> = {
  tree: {
    colls: ["nodes"],
    special: (s, op) => {
      if (op.op === "swap") { // swap two nodes' labels (heapify, rotations, …)
        const a = findItem(s, str(op.a)), b = findItem(s, str(op.b));
        if (a && b) { [a.label, b.label] = [b.label, a.label]; [a.mark, b.mark] = [b.mark, a.mark]; }
        return true;
      }
      return false;
    },
  },
  linkedlist: {
    colls: ["nodes"], defaults: { pointers: {}, doubly: false },
    special: (s, op) => {
      if (op.op === "pointer") { if (op.to === null || op.to === undefined) delete s.pointers[str(op.name)]; else s.pointers[str(op.name)] = str(op.to); return true; }
      return false;
    },
  },
  hashtable: {
    colls: ["entries"], defaults: { buckets: 8 },
    prep: (s) => { s.buckets = Math.max(1, Math.min(32, num(s.buckets, 8))); for (const e of s.entries) { e.key = str(e.key ?? e.id); e.id = str(e.id ?? e.key); } },
    special: (s, op) => {
      if (op.op === "put") {
        const key = str(op.key); const e = s.entries.find((x: Item) => x.key === key);
        if (e) { e.value = str(op.value); if (op.bucket !== undefined) e.bucket = num(op.bucket); }
        else s.entries.push({ id: key, key, value: str(op.value), ...(op.bucket !== undefined ? { bucket: num(op.bucket) } : {}) });
        return true;
      }
      if (op.op === "delete") { s.entries = s.entries.filter((x: Item) => x.key !== str(op.key)); return true; }
      return false;
    },
  },
  memory: {
    colls: ["frames", "heap"],
    infer: (it) => (it.fields || it.label !== undefined ? "heap" : "frames"),
    prep: (s) => { for (const f of s.frames) { f.name = str(f.name ?? f.id); f.vars = arr(f.vars).map((v) => ({ name: str(v.name), value: str(v.value) })); } for (const h of s.heap) { h.label = str(h.label ?? h.id); h.fields = arr(h.fields).map((v) => ({ name: str(v.name), value: str(v.value) })); } },
    special: (s, op) => {
      if (op.op === "push_frame") { s.frames.push({ id: str(op.id, `f${s.frames.length + 1}`), name: str(op.name ?? op.id), vars: arr(op.vars).map((v) => ({ name: str(v.name), value: str(v.value) })) }); return true; }
      if (op.op === "pop_frame") { s.frames.pop(); return true; }
      if (op.op === "setvar") {
        const f = op.frame ? s.frames.find((x: Item) => x.id === str(op.frame)) : s.frames[s.frames.length - 1];
        if (f) { const v = f.vars.find((x: any) => x.name === str(op.name)); if (v) v.value = str(op.value); else f.vars.push({ name: str(op.name), value: str(op.value) }); }
        return true;
      }
      if (op.op === "setfield") {
        const h = s.heap.find((x: Item) => x.id === str(op.obj ?? op.id));
        if (h) { const v = h.fields.find((x: any) => x.name === str(op.name)); if (v) v.value = str(op.value); else h.fields.push({ name: str(op.name), value: str(op.value) }); }
        return true;
      }
      return false;
    },
  },
  code: {
    colls: ["vars"], defaults: { lines: [], current: 0, output: [], lang: "", marks: {} },
    prep: (s) => {
      if (typeof s.code === "string") s.lines = s.code.replace(/\t/g, "    ").split("\n");
      delete s.code;
      s.lines = arr(s.lines).map((l) => str(l));
      s.output = arr(s.output).map((l) => str(l));
      s.current = num(s.current, 0);
      for (const v of s.vars) { v.name = str(v.name ?? v.id); v.id = v.name; v.value = str(v.value); }
    },
    special: (s, op) => {
      if (op.op === "line") { if (s.current) s.marks[s.current] = s.marks[s.current] ?? "visited"; s.current = num(op.n ?? op.line, 0); return true; }
      if (op.op === "setvar") { const v = s.vars.find((x: Item) => x.name === str(op.name)); if (v) v.value = str(op.value); else s.vars.push({ id: str(op.name), name: str(op.name), value: str(op.value) }); return true; }
      if (op.op === "print") { s.output.push(str(op.text)); return true; }
      if (op.op === "mark" && arr(op.ids ?? op.lines).some((x) => /^L?\d+$/.test(String(x)))) {
        for (const x of arr(op.ids ?? op.lines)) { const n = num(String(x).replace(/^L/, ""), 0); if (n) s.marks[n] = MARKS.includes(op.state) ? op.state : "none"; }
        return true;
      }
      return false;
    },
  },
  bits: {
    colls: [], defaults: { bits: [], labels: [], show_value: true },
    prep: (s) => { s.bits = toBits(s.bits ?? s.value, s.width); delete s.value; delete s.width; s.marks = s.marks ?? {}; },
    special: (s, op) => {
      if (op.op === "set_bits") { s.bits = toBits(op.value ?? op.bits, op.width ?? s.bits.length); return true; }
      if (op.op === "flip") { const i = num(op.i, -1); if (i >= 0 && i < s.bits.length) s.bits[i] = s.bits[i] === "1" ? "0" : "1"; return true; }
      if (op.op === "set" && op.i !== undefined) { const i = num(op.i, -1); if (i >= 0 && i < s.bits.length) s.bits[i] = str(op.value) === "1" ? "1" : "0"; return true; }
      if (op.op === "shift") {
        const n = num(op.n, 1);
        for (let k = 0; k < n; k++) { if (op.dir === "right") { s.bits.pop(); s.bits.unshift("0"); } else { s.bits.shift(); s.bits.push("0"); } }
        return true;
      }
      if (op.op === "mark") { for (const x of arr(op.ids ?? op.indices)) s.marks[String(x).replace(/^b/, "")] = op.state; return true; }
      return false;
    },
  },
  bar: {
    colls: ["bars"], defaults: { unit: "" },
    prep: (s) => { for (const b of s.bars) { b.value = num(b.value); b.label = str(b.label ?? b.id); } },
    special: (s, op) => {
      if (op.op === "swap") { const i = s.bars.findIndex((b: Item) => b.id === str(op.a)), j = s.bars.findIndex((b: Item) => b.id === str(op.b)); if (i >= 0 && j >= 0) [s.bars[i], s.bars[j]] = [s.bars[j], s.bars[i]]; return true; }
      if (op.op === "sort") { s.bars.sort((a: Item, b: Item) => (op.order === "desc" ? b.value - a.value : a.value - b.value)); return true; }
      return false;
    },
  },
  line: {
    colls: ["series"], defaults: { x_label: "", y_label: "" },
    prep: (s) => { for (const se of s.series) { se.label = str(se.label ?? se.id); se.points = arr(se.points).map((p) => [num(p?.[0] ?? p?.x), num(p?.[1] ?? p?.y)]); } },
    special: (s, op) => {
      if (op.op === "add_point") { const se = s.series.find((x: Item) => x.id === str(op.series)) ?? s.series[0]; if (se) se.points.push([num(op.x), num(op.y)]); return true; }
      return false;
    },
  },
  pie: { colls: ["slices"], prep: (s) => { for (const p of s.slices) { p.value = Math.max(0, num(p.value)); p.label = str(p.label ?? p.id); } } },
  numberline: {
    colls: ["points", "intervals", "jumps"], defaults: { min: -5, max: 5, step: 1 },
    infer: (it) => (it.type === "jump" ? "jumps" : it.type === "interval" ? "intervals" : it.x !== undefined ? "points" : "intervals"),
    prep: (s) => { s.min = num(s.min, -5); s.max = num(s.max, 5); if (s.max <= s.min) s.max = s.min + 10; s.step = num(s.step, 0) > 0 ? num(s.step) : 0; },
  },
  timeline: { colls: ["events"] },
  quadrant: { colls: ["items"], defaults: { x_axis: ["low", "high"], y_axis: ["low", "high"], quadrants: ["", "", "", ""] } },
  fraction: { colls: ["wholes"], prep: (s) => { for (const w of s.wholes) { w.parts = Math.max(1, Math.min(24, num(w.parts, 4))); w.shaded = Math.max(0, Math.min(w.parts, num(w.shaded, 0))); } } },
  venn: { colls: ["sets", "items"], infer: (it) => (it.in !== undefined ? "items" : "sets"), prep: (s) => { s.sets = s.sets.slice(0, 3); for (const it of s.items) it.in = arr(it.in).map((x) => str(x)); } },
  mindmap: { colls: ["nodes"] },
  cycle: { colls: ["stages"] },
  layers: { colls: ["layers"] },
  pyramid: { colls: ["levels"] },
  compare: { colls: ["columns", "items"], infer: (it) => (it.column !== undefined ? "items" : "columns") },
  steps: { colls: ["steps"], defaults: { direction: "LR" } },
  geometry: {
    colls: ["points", "segments", "vectors", "circles", "polygons", "angles"], defaults: { x: [-1, 10], y: [-1, 7], grid: true },
    infer: (it) => it.type === "vector" ? "vectors" : it.x !== undefined && it.y !== undefined ? "points" : it.r !== undefined ? "circles" : Array.isArray(it.points) ? "polygons" : it.at !== undefined ? "angles" : "segments",
  },
};

function toBits(v: unknown, width?: unknown): string[] {
  if (Array.isArray(v)) return v.map((b) => (String(b) === "1" ? "1" : "0"));
  const sv = str(v);
  if (/^[01\s_]+$/.test(sv) && sv.trim()) return sv.replace(/[\s_]/g, "").split("");
  const n = Math.max(0, Math.floor(num(v, 0)));
  const w = Math.max(1, Math.min(32, num(width, 8)));
  return n.toString(2).padStart(w, "0").slice(-w).split("");
}

export function normalizeScene(spec: any): SceneState | null {
  const d = DESCS[spec.kind as SceneKind];
  if (!d) return null;
  const s: SceneState = { ...JSON.parse(JSON.stringify(d.defaults ?? {})), ...JSON.parse(JSON.stringify(spec)), kind: spec.kind, title: str(spec.title) };
  for (const c of d.colls) {
    s[c] = arr(s[c]).filter((x) => x !== null && x !== undefined).map((x, i) => {
      const it = typeof x === "object" ? { ...x } : { label: str(x), value: str(x) };
      it.id = str(it.id ?? it.key ?? it.name ?? `${c.slice(0, 1)}${i + 1}`);
      if (it.mark !== undefined && !MARKS.includes(it.mark)) it.mark = "none";
      return it;
    });
  }
  d.prep?.(s);
  return s;
}

export function applySceneOp(state: SceneState, op: Op): SceneState {
  const s: SceneState = JSON.parse(JSON.stringify(state));
  const d = DESCS[s.kind];
  if (d.special?.(s, op)) { d.prep?.(s); return s; }
  switch (op.op) {
    case "add": {
      const raw = op.item ?? Object.fromEntries(Object.entries(op).filter(([k]) => !["op", "into", "after", "index"].includes(k)));
      const coll = (op.into && d.colls.includes(op.into) ? op.into : undefined) ?? d.infer?.(raw) ?? d.colls[0];
      if (!coll) break;
      const list: Item[] = s[coll];
      const item = { ...raw, id: str(raw.id ?? raw.key ?? raw.name ?? `${coll.slice(0, 1)}${list.length + 1}`) };
      const existing = list.findIndex((x) => x.id === item.id);
      if (existing >= 0) { Object.assign(list[existing], item); break; }
      let at = list.length;
      if (op.after !== undefined) { const i = list.findIndex((x) => x.id === str(op.after)); at = i >= 0 ? i + 1 : list.length; }
      else if (op.index !== undefined) at = Math.max(0, Math.min(list.length, num(op.index, list.length)));
      list.splice(at, 0, item);
      break;
    }
    case "update": {
      const it = findItem(s, str(op.id));
      if (it) for (const [k, v] of Object.entries(op.fields ?? op)) if (!["op", "id", "fields"].includes(k)) it[k] = v;
      break;
    }
    case "remove": {
      const ids = new Set(arr(op.ids ?? (op.id !== undefined ? [op.id] : [])).map((x) => str(x)));
      // trees and mind maps: removing a node removes its descendants too
      let grew = true;
      while (grew) {
        grew = false;
        for (const c of d.colls) for (const x of arr(s[c])) if (x.parent !== undefined && ids.has(str(x.parent)) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
      }
      for (const c of d.colls) s[c] = arr(s[c]).filter((x) => !ids.has(x.id));
      break;
    }
    case "mark": {
      for (const id of arr(op.ids ?? (op.id !== undefined ? [op.id] : []))) { const it = findItem(s, str(id)); if (it) it.mark = MARKS.includes(op.state) ? op.state : "none"; }
      break;
    }
    case "set": {
      if (op.field && !["kind", ...d.colls].includes(op.field)) s[op.field] = op.value;
      break;
    }
  }
  d.prep?.(s);
  return s;
}
