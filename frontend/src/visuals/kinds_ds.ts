/** Layouts for programming / data-structure kinds: tree, linked list, hash table, memory, code tracer, bits. */
import { textWidth } from "./common";
import { type SItem, type SLink, type SDecor, type Scene, boxEdge, curve, P } from "./scene";

const tw = (t: string, font?: string) => textWidth(String(t), font);
const LABEL_FONT = "500 14px Inter, system-ui";
const bounds = (pts: [number, number, number, number][]): [number, number, number, number] => {
  if (!pts.length) return [0, 0, 100, 100];
  const x0 = Math.min(...pts.map((p) => p[0] - p[2] / 2)), x1 = Math.max(...pts.map((p) => p[0] + p[2] / 2));
  const y0 = Math.min(...pts.map((p) => p[1] - p[3] / 2)), y1 = Math.max(...pts.map((p) => p[1] + p[3] / 2));
  return [x0, y0, x1 - x0, y1 - y0];
};

// ---------------------------------------------------------------- tree
export function treeLayout(s: any): Scene {
  const nodes: any[] = s.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, any[]>();
  for (const n of nodes) if (n.parent !== undefined && byId.has(String(n.parent))) {
    const p = String(n.parent);
    kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  const roots = nodes.filter((n) => n.parent === undefined || !byId.has(String(n.parent)));
  const binary = nodes.some((n) => n.side === "left" || n.side === "right");
  const size = (n: any) => {
    const label = String(n.label ?? n.id);
    return label.length <= 3 ? { w: 46, h: 46, circle: true } : { w: Math.max(56, tw(label, LABEL_FONT) + 26), h: 42, circle: false };
  };
  const unit = Math.max(56, ...nodes.map((n) => size(n).w + 14));
  const pos = new Map<string, { x: number; y: number }>();
  let cursor = 0;

  const place = (n: any, depth: number, seen: Set<string>) => {
    if (seen.has(n.id)) return; seen.add(n.id);
    const ch = kids.get(n.id) ?? [];
    if (binary) {
      let left = ch.find((c) => c.side === "left"), right = ch.find((c) => c.side === "right");
      for (const c of ch) if (c !== left && c !== right) { if (!left) left = c; else if (!right) right = c; }
      if (left) place(left, depth + 1, seen); else if (right) cursor += 0.5;
      pos.set(n.id, { x: cursor++ * unit, y: depth * 86 });
      if (right) place(right, depth + 1, seen); else if (left) cursor += 0.5;
    } else if (!ch.length) {
      pos.set(n.id, { x: cursor++ * unit, y: depth * 86 });
    } else {
      ch.forEach((c) => place(c, depth + 1, seen));
      const xs = ch.map((c) => pos.get(c.id)?.x ?? 0);
      pos.set(n.id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: depth * 86 });
    }
  };
  const seen = new Set<string>();
  roots.forEach((r) => { place(r, 0, seen); cursor += 0.6; });

  const items: SItem[] = [], links: SLink[] = [], boxes: [number, number, number, number][] = [];
  for (const n of nodes) {
    const p = pos.get(n.id); if (!p) continue;
    const z = size(n);
    items.push({ key: n.id, hid: n.id, x: p.x, y: p.y, mark: n.mark,
      shape: z.circle ? { type: "circle", w: z.w, h: z.h } : { type: "rect", w: z.w, h: z.h, r: z.h / 2 },
      texts: [{ text: String(n.label ?? n.id), cls: "label" }] });
    boxes.push([p.x, p.y, z.w, z.h]);
    const par = n.parent !== undefined ? pos.get(String(n.parent)) : undefined;
    if (par) {
      const pz = size(byId.get(String(n.parent)));
      const [x1, y1] = boxEdge(par.x, par.y, pz.w, pz.h, p.x, p.y);
      const [x2, y2] = boxEdge(p.x, p.y, z.w, z.h, par.x, par.y);
      links.push({ key: `${n.parent}->${n.id}`, hid: `${n.parent}->${n.id}`, ends: `${n.parent} ${n.id}`, d: `M ${P(x1)} ${P(y1)} L ${P(x2)} ${P(y2)}`, arrow: "none" });
    }
  }
  return { items, links, bounds: bounds(boxes), minW: 420, minH: 280 };
}

// ---------------------------------------------------------------- linked list
export function linkedListLayout(s: any): Scene {
  const nodes: any[] = s.nodes;
  const H = 48;
  const W = Math.max(64, ...nodes.map((n) => tw(String(n.value ?? n.label ?? ""), "600 17px Inter") + 34));
  const GAP = 54;
  const items: SItem[] = [], links: SLink[] = [], decor: SDecor[] = [];
  nodes.forEach((n, i) => {
    const x = i * (W + GAP);
    items.push({ key: n.id, hid: n.id, x, y: 0, mark: n.mark, shape: { type: "rect", w: W, h: H, r: 7 },
      texts: [{ text: String(n.value ?? n.label ?? ""), cls: "value" }], label: `node ${n.value ?? n.id}` });
    const next = nodes[i + 1];
    if (next) {
      links.push({ key: `${n.id}->${next.id}`, ends: `${n.id} ${next.id}`, d: curve(x + W / 2 + 2, s.doubly ? -8 : 0, x + W + GAP - W / 2 - 4, s.doubly ? -8 : 0) });
      if (s.doubly) links.push({ key: `${next.id}->${n.id}`, ends: `${next.id} ${n.id}`, d: curve(x + W + GAP - W / 2 - 2, 8, x + W / 2 + 4, 8) });
    }
  });
  const endX = nodes.length ? (nodes.length - 1) * (W + GAP) + W / 2 : -W / 2;
  links.push({ key: "null-link", d: curve(endX + 2, 0, endX + GAP - 14, 0), cls: "faint" });
  decor.push({ key: "null", text: "null", x: endX + GAP + 8, y: 0, cls: "decor-text muted-text", anchor: "start" });
  // pointers (head, tail, cur, prev …) above their node
  const stack = new Map<string, number>();
  for (const [name, id] of Object.entries(s.pointers ?? {})) {
    const i = nodes.findIndex((n) => n.id === String(id));
    if (i < 0) continue;
    const lvl = stack.get(String(id)) ?? 0; stack.set(String(id), lvl + 1);
    const x = i * (W + GAP), y = -H / 2 - 46 - lvl * 26;
    items.push({ key: `ptr:${name}`, hid: `ptr:${name}`, x, y, texts: [{ text: name, cls: "ptr-label" }] });
    if (lvl === 0) links.push({ key: `ptrline:${name}`, hid: `ptr:${name}`, d: curve(x, y + 10, x, -H / 2 - 4), cls: "accent" });
  }
  const n = Math.max(nodes.length, 1);
  return { items, links, decor, bounds: [-W / 2, -H / 2 - 50 - stack.size * 8, n * (W + GAP) + 40, H + 60], minW: 460, minH: 220 };
}

// ---------------------------------------------------------------- hash table
export function hashTableLayout(s: any): Scene {
  const B: number = s.buckets;
  const hash = (k: string) => { let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % B; };
  const chains: any[][] = Array.from({ length: B }, () => []);
  for (const e of s.entries) {
    const b = e.bucket !== undefined && Number.isFinite(Number(e.bucket)) ? ((Number(e.bucket) % B) + B) % B : hash(String(e.key));
    chains[b].push(e);
  }
  const items: SItem[] = [], links: SLink[] = [], decor: SDecor[] = [];
  const BH = 40, BW = 46, ROW = 52, GAP = 40;
  const text = (e: any) => (e.value !== undefined && e.value !== "" ? `${e.key}: ${e.value}` : String(e.key));
  const EW = Math.max(90, ...s.entries.map((e: any) => tw(text(e), LABEL_FONT) + 28));
  let maxLen = 0;
  for (let b = 0; b < B; b++) {
    const y = b * ROW;
    items.push({ key: `b:${b}`, hid: `b:${b}`, x: 0, y, shape: { type: "rect", w: BW, h: BH, r: 4 }, hatch: false, cls: "bucket", texts: [{ text: String(b), cls: "small-strong" }], label: `bucket ${b}` });
    let prevX = BW / 2, prevKey = `b:${b}`;
    chains[b].forEach((e, k) => {
      const x = BW / 2 + GAP + EW / 2 + k * (EW + GAP);
      items.push({ key: `e:${e.id}`, hid: e.id, x, y, mark: e.mark, shape: { type: "rect", w: EW, h: BH, r: 7 }, texts: [{ text: text(e), cls: "label" }] });
      links.push({ key: `${prevKey}->${e.id}`, ends: `${prevKey} ${e.id}`, d: curve(prevX + 2, y, x - EW / 2 - 4, y) });
      prevX = x + EW / 2; prevKey = e.id;
    });
    if (!chains[b].length) decor.push({ key: `empty${b}`, text: "–", x: BW / 2 + 18, y, cls: "decor-text muted-text" });
    maxLen = Math.max(maxLen, chains[b].length);
  }
  return { items, links, decor, bounds: [-BW / 2, -BH / 2, BW + maxLen * (EW + GAP) + 10, (B - 1) * ROW + BH], minW: 440, minH: 260 };
}

// ---------------------------------------------------------------- memory (call stack + heap)
export function memoryLayout(s: any): Scene {
  const items: SItem[] = [], links: SLink[] = [], decor: SDecor[] = [];
  const FW = 230, ROW = 30, HEADER = 34;
  const frames: any[] = [...s.frames].reverse(); // newest on top
  let y = 0;
  const varPos = new Map<string, { x: number; y: number }>();
  decor.push({ key: "stack-title", text: "Call stack", x: 0, y: -26, cls: "decor-title" });
  for (const f of frames) {
    const h = HEADER + Math.max(1, f.vars.length) * ROW + 8;
    items.push({ key: `f:${f.id}`, hid: f.id, x: 0, y: y + h / 2, mark: f.mark, shape: { type: "rect", w: FW, h, r: 8 }, hatch: f === frames[0], cls: "frame",
      texts: [{ text: `${f.name}()`, dx: -FW / 2 + 14, dy: -h / 2 + 18, anchor: "start", cls: "frame-name" }], noMove: false });
    f.vars.forEach((v: any, i: number) => {
      const vy = y + HEADER + i * ROW + ROW / 2;
      const ref = String(v.value).startsWith("@") ? String(v.value).slice(1) : null;
      items.push({ key: `v:${f.id}.${v.name}`, hid: `${f.id}.${v.name}`, x: 0, y: vy, label: `${v.name} in ${f.name}()`,
        texts: [{ text: v.name, dx: -FW / 2 + 16, anchor: "start", cls: "mono-muted" }, { text: ref ? "●" : String(v.value), dx: FW / 2 - 16, anchor: "end", cls: ref ? "ptr-dot" : "mono" }] });
      if (ref) varPos.set(`${f.id}.${v.name}`, { x: FW / 2 - 18, y: vy });
    });
    y += h + 12;
  }
  const HX = FW / 2 + 150;
  decor.push({ key: "heap-title", text: "Heap", x: HX + 80, y: -26, cls: "decor-title" });
  let hy = 0;
  const heapPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const o of s.heap) {
    const lines = o.fields.length;
    const w = Math.max(150, tw(o.label, LABEL_FONT) + 30, ...o.fields.map((f: any) => tw(`${f.name}: ${f.value}`, "13px monospace") + 30));
    const h = 34 + lines * 24 + 6;
    const cx = HX + w / 2, cy = hy + h / 2;
    heapPos.set(o.id, { x: cx, y: cy, w, h });
    items.push({ key: `h:${o.id}`, hid: o.id, x: cx, y: cy, mark: o.mark, shape: { type: "rect", w, h, r: 8 }, cls: "heapobj",
      texts: [{ text: o.label, dy: -h / 2 + 18, cls: "label" },
        ...o.fields.map((f: any, i: number) => ({ text: `${f.name}: ${String(f.value).startsWith("@") ? "●" : f.value}`, dx: -w / 2 + 14, dy: -h / 2 + 44 + i * 24, anchor: "start" as const, cls: "mono" }))] });
    hy += h + 18;
  }
  for (const [key, p] of varPos) {
    const f = frames.find((fr) => key.startsWith(fr.id + "."));
    const v = f?.vars.find((vv: any) => `${f.id}.${vv.name}` === key);
    const target = heapPos.get(String(v?.value).slice(1));
    if (!target) continue;
    links.push({ key: `${key}->${String(v.value).slice(1)}`, ends: `${key} ${String(v.value).slice(1)}`, d: curve(p.x + 6, p.y, target.x - target.w / 2 - 4, target.y, -20), cls: "accent" });
  }
  for (const o of s.heap) o.fields.forEach((f: any, i: number) => {
    if (!String(f.value).startsWith("@")) return;
    const a = heapPos.get(o.id), b = heapPos.get(String(f.value).slice(1));
    if (!a || !b) return;
    const fy = a.y - a.h / 2 + 44 + i * 24;
    links.push({ key: `${o.id}.${f.name}->${String(f.value).slice(1)}`, ends: `${o.id} ${String(f.value).slice(1)}`, d: curve(a.x + a.w / 2, fy, b.x + b.w / 2 + 4, b.y, -60), cls: "accent" });
  });
  const totalH = Math.max(y, hy, 60);
  const maxW = Math.max(150, ...[...heapPos.values()].map((p) => p.w));
  return { items, links, decor, bounds: [-FW / 2, -40, FW / 2 + 150 + maxW + FW / 2, totalH + 40], minW: 520, minH: 300 };
}

// ---------------------------------------------------------------- code tracer
export function codeLayout(s: any, env?: { aspect: number }): Scene {
  const items: SItem[] = [], decor: SDecor[] = [];
  const lines: string[] = s.lines;
  const LH = 24;
  const CW = Math.max(300, ...lines.map((l) => l.length * 8 + 40));
  const x0 = -CW / 2;
  // In a tall, narrow panel (e.g. the left column of a board) stack the variables under the code.
  const stacked = (env?.aspect ?? 1.6) < 1.15;
  decor.push({ key: "code-title", text: s.lang ? `Code (${s.lang})` : "Code", x: x0, y: -30, anchor: "start", cls: "decor-title" });
  items.push({ key: "panel", x: 0, y: (lines.length * LH) / 2 - LH / 2, shape: { type: "rect", w: CW + 20, h: lines.length * LH + 16, r: 8 }, hatch: false, layer: "back", cls: "code-panel" });
  if (s.current > 0 && s.current <= lines.length) {
    items.push({ key: "cursor", x: 0, y: (s.current - 1) * LH, shape: { type: "rect", w: CW + 8, h: LH, r: 4 }, layer: "back", cls: "code-cursor" });
    items.push({ key: "cursor-arrow", x: x0 - 44, y: (s.current - 1) * LH, texts: [{ text: "➜", cls: "cursor-arrow" }] });
  }
  lines.forEach((l, i) => {
    const n = i + 1;
    items.push({ key: `ln${n}`, x: x0 - 16, y: i * LH, noMove: true, texts: [{ text: String(n), anchor: "end", cls: "decor-text lineno" }] });
    items.push({ key: `L${n}`, hid: `L${n}`, x: 0, y: i * LH, mark: s.marks?.[n], cls: `codeline${n === s.current ? " current" : ""}`, noMove: true,
      shape: { type: "rect", w: CW, h: LH - 2, r: 3 }, hatch: false, label: `line ${n}: ${l.trim()}`,
      texts: [{ text: l || " ", dx: -CW / 2 + 10, anchor: "start", cls: "mono" }] });
  });
  let y = lines.length * LH + 22;
  // variables: to the right of the code, or underneath it in a narrow panel
  const VW = Math.max(150, ...s.vars.map((v: any) => tw(`${v.name}  ${v.value}`, "13px monospace") + 40));
  let VX = CW / 2 + 40, VY = 0, right = CW / 2 + 10;
  if (s.vars.length) {
    if (stacked) {
      VX = x0; VY = y + 16;
      decor.push({ key: "vars-title", text: "Variables", x: VX, y: y, anchor: "start", cls: "decor-title" });
      const per = Math.max(1, Math.floor((CW + 20) / (VW + 10)));
      s.vars.forEach((v: any, i: number) => {
        items.push({ key: `v:${v.name}`, hid: `v:${v.name}`, x: VX + VW / 2 + (i % per) * (VW + 10), y: VY + 20 + Math.floor(i / per) * 46, mark: v.mark, shape: { type: "rect", w: VW, h: 38, r: 6 },
          texts: [{ text: v.name, dx: -VW / 2 + 12, anchor: "start", cls: "mono-muted" }, { text: String(v.value), dx: VW / 2 - 12, anchor: "end", cls: "mono-strong" }] });
      });
      y = VY + 20 + Math.ceil(s.vars.length / per) * 46 + 10;
    } else {
      decor.push({ key: "vars-title", text: "Variables", x: VX, y: -30, anchor: "start", cls: "decor-title" });
      s.vars.forEach((v: any, i: number) => {
        items.push({ key: `v:${v.name}`, hid: `v:${v.name}`, x: VX + VW / 2, y: i * 46, mark: v.mark, shape: { type: "rect", w: VW, h: 38, r: 6 },
          texts: [{ text: v.name, dx: -VW / 2 + 12, anchor: "start", cls: "mono-muted" }, { text: String(v.value), dx: VW / 2 - 12, anchor: "end", cls: "mono-strong" }] });
      });
      right = VX + VW;
      y = Math.max(y, s.vars.length * 46 + 10);
    }
  }
  // output console
  const outY = y + 8;
  if (s.output.length) {
    decor.push({ key: "out-title", text: "Output", x: x0, y: outY, anchor: "start", cls: "decor-title" });
    items.push({ key: "console", hid: "output", x: 0, y: outY + 20 + (s.output.length * 22) / 2, shape: { type: "rect", w: CW + 20, h: s.output.length * 22 + 14, r: 6 }, hatch: false, layer: "back", cls: "console", label: "the output" });
    s.output.forEach((o: string, i: number) => items.push({ key: `out${i}`, x: 0, y: outY + 27 + i * 22, noMove: true, texts: [{ text: o, dx: -CW / 2 + 6, anchor: "start", cls: "mono" }] }));
  }
  const h = outY + (s.output.length ? 34 + s.output.length * 22 : 0);
  return { items, decor, bounds: [x0 - 50, -46, right - x0 + 50, h + 46], minW: stacked ? 300 : 480, minH: 240 };
}

// ---------------------------------------------------------------- bits
export function bitsLayout(s: any): Scene {
  const bits: string[] = s.bits;
  const n = bits.length;
  const W = 46, H = 54, GAP = 6;
  const items: SItem[] = [], decor: SDecor[] = [];
  bits.forEach((b, i) => {
    const x = i * (W + GAP) + Math.floor(i / 4) * 8; // a little gap every 4 bits
    items.push({ key: `b${i}`, hid: `b${i}`, x, y: 0, mark: s.marks?.[i], cls: b === "1" ? "bit one" : "bit", hatch: b === "1",
      shape: { type: "rect", w: W, h: H, r: 6 }, texts: [{ text: b, cls: "value" }], label: `bit ${i} (worth ${2 ** (n - 1 - i)})` });
    decor.push({ key: `pv${i}`, text: String(2 ** (n - 1 - i)), x, y: H / 2 + 16, cls: "decor-text placevalue" });
  });
  const value = parseInt(bits.join("") || "0", 2);
  const right = (n - 1) * (W + GAP) + Math.floor((n - 1) / 4) * 8 + W / 2;
  if (s.show_value !== false) items.push({ key: "value", hid: "value", x: right + 30, y: 0, texts: [{ text: `= ${value}`, anchor: "start", cls: "big-value" }], label: `the value ${value}` });
  (s.labels ?? []).forEach((l: string, i: number) => decor.push({ key: `lab${i}`, text: String(l), x: right / 2, y: -H / 2 - 18 - i * 18, cls: "decor-text" }));
  return { items, decor, bounds: [-W / 2, -H / 2 - 20, right + W / 2 + 110, H + 50], minW: 460, minH: 200 };
}
