/**
 * Visual state: plain data that Claude sends, and pure functions that apply "ops" to it.
 *
 * A walkthrough is a list of frames: frame i = the state after the ops of beats 0..i,
 * plus what beat i highlights. Because states are plain data, stepping backwards is just
 * drawing an earlier frame, and the renderers animate the difference.
 */

import { SCENE_KINDS, type SceneState, applySceneOp, normalizeScene } from "./generic";
export type Mark = "current" | "visited" | "done" | "error" | "none";
export type Op = { op: string; [k: string]: any };

export interface GraphNode { id: string; label: string; shape: "rect" | "round" | "circle" | "diamond"; mark?: Mark }
export interface GraphEdge { from: string; to: string; label?: string; mark?: Mark }
export interface GraphState { kind: "graph"; title: string; direction: "TB" | "LR"; nodes: GraphNode[]; edges: GraphEdge[] }

export interface Actor { id: string; label: string }
export interface Message { id: string; from: string; to: string; label: string; style: "solid" | "reply"; mark?: Mark }
export interface SequenceState { kind: "sequence"; title: string; actors: Actor[]; messages: Message[] }

export interface Cell { key: string; value: string; mark?: Mark }
export interface ArrayState { kind: "array"; title: string; cells: Cell[]; pointers: Record<string, number>; orientation: "row" | "stack"; nextKey: number }

export interface GridState { kind: "grid"; title: string; rows: string[][]; marks: Record<string, Mark>; rowLabels: string[]; colLabels: string[] }

export interface PlotFn { id: string; expr: string; label: string }
export interface PlotPoint { id: string; x: number; y: number; label: string }
export interface PlotState { kind: "plot"; title: string; x: [number, number]; y: [number, number]; functions: PlotFn[]; points: PlotPoint[] }

export interface MathLine { id: string; tex: string; note: string; mark?: Mark }
export interface MathState { kind: "math"; title: string; lines: MathLine[] }

export interface MermaidState { kind: "mermaid"; title: string; source: string }

/** Several visuals side by side that move together (e.g. code + the tree it walks + a queue). */
export interface Panel { id: string; title: string; state: VisualState }
export interface BoardState { kind: "board"; title: string; layout: "auto" | "row" | "column"; panels: Panel[] }

export type VisualState = GraphState | SequenceState | ArrayState | GridState | PlotState | MathState | MermaidState | SceneState | BoardState;

const str = (v: unknown, d = "") => (v === undefined || v === null ? d : String(v));
const num = (v: unknown, d = 0) => (typeof v === "number" && isFinite(v) ? v : isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : d);
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? v : []);
const MARKS = new Set(["current", "visited", "done", "error", "none"]);
const mark = (v: unknown): Mark => (MARKS.has(String(v)) ? (v as Mark) : "none");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Turn whatever Claude sent into a well-formed state (or null if it's unusable). */
export function normalize(spec: any): VisualState | null {
  if (!spec || typeof spec !== "object") return null;
  if ((SCENE_KINDS as readonly string[]).includes(spec.kind)) return normalizeScene(spec);
  if (spec.kind === "board") {
    const panels: Panel[] = [];
    arr(spec.panels).forEach((p, i) => {
      const inner = normalize(p?.visual ?? p);
      if (!inner || inner.kind === "board") return;
      panels.push({ id: str(p.id, `p${i + 1}`), title: str(p.title ?? inner.title), state: inner });
    });
    if (!panels.length) return null;
    return { kind: "board", title: str(spec.title), layout: ["row", "column"].includes(spec.layout) ? spec.layout : "auto", panels };
  }
  const title = str(spec.title);
  switch (spec.kind) {
    case "graph": {
      const nodes: GraphNode[] = arr(spec.nodes).filter((n) => n && n.id != null).map((n) => ({
        id: str(n.id), label: str(n.label, str(n.id)), shape: (["rect", "round", "circle", "diamond"].includes(n.shape) ? n.shape : "rect"), mark: mark(n.mark),
      }));
      const ids = new Set(nodes.map((n) => n.id));
      const edges: GraphEdge[] = arr(spec.edges).filter((e) => e && ids.has(str(e.from)) && ids.has(str(e.to)))
        .map((e) => ({ from: str(e.from), to: str(e.to), label: str(e.label), mark: mark(e.mark) }));
      return { kind: "graph", title, direction: spec.direction === "LR" ? "LR" : "TB", nodes, edges };
    }
    case "sequence": {
      const actors = arr(spec.actors).filter((a) => a && a.id != null).map((a) => ({ id: str(a.id), label: str(a.label, str(a.id)) }));
      const st: SequenceState = { kind: "sequence", title, actors, messages: [] };
      arr(spec.messages).forEach((m) => addMessage(st, m));
      return st;
    }
    case "array": {
      const values = arr(spec.values ?? spec.cells);
      const cells = values.map((v, i) => ({ key: `k${i}`, value: str(typeof v === "object" && v ? v.value : v) }));
      const pointers: Record<string, number> = {};
      for (const [k, v] of Object.entries(spec.pointers ?? {})) if (v !== null && v !== undefined) pointers[k] = num(v);
      return { kind: "array", title, cells, pointers, orientation: spec.orientation === "stack" ? "stack" : "row", nextKey: cells.length };
    }
    case "grid": {
      const rows = arr<any[]>(spec.rows).map((r) => arr(r).map((c) => str(c)));
      return { kind: "grid", title, rows, marks: {}, rowLabels: arr(spec.row_labels).map((x) => str(x)), colLabels: arr(spec.col_labels).map((x) => str(x)) };
    }
    case "plot": {
      const x = arr(spec.x).length === 2 ? [num(spec.x[0], -5), num(spec.x[1], 5)] as [number, number] : [-5, 5] as [number, number];
      const y = arr(spec.y).length === 2 ? [num(spec.y[0], -5), num(spec.y[1], 5)] as [number, number] : [-5, 5] as [number, number];
      const st: PlotState = { kind: "plot", title, x, y, functions: [], points: [] };
      arr(spec.functions).forEach((f, i) => addPlotItem(st, { type: "function", id: f?.id ?? `f${i + 1}`, ...f }));
      arr(spec.points).forEach((p, i) => addPlotItem(st, { type: "point", id: p?.id ?? `p${i + 1}`, ...p }));
      return st;
    }
    case "math": {
      const lines = arr(spec.lines).map((l, i) => ({ id: str(l?.id, `l${i + 1}`), tex: str(l?.tex ?? l), note: str(l?.note), mark: mark(l?.mark) }));
      return { kind: "math", title, lines };
    }
    case "mermaid":
      return spec.source ? { kind: "mermaid", title, source: str(spec.source) } : null;
    default:
      return null;
  }
}

function addMessage(st: SequenceState, m: any) {
  if (!m) return;
  const ids = new Set(st.actors.map((a) => a.id));
  for (const end of [str(m.from), str(m.to)]) if (end && !ids.has(end)) { st.actors.push({ id: end, label: end }); ids.add(end); }
  st.messages.push({
    id: str(m.id, `m${st.messages.length + 1}`), from: str(m.from), to: str(m.to), label: str(m.label),
    style: m.style === "reply" ? "reply" : "solid", mark: mark(m.mark),
  });
}

function addPlotItem(st: PlotState, it: any) {
  if (!it) return;
  if (it.type === "point" || (it.x !== undefined && it.y !== undefined && !it.expr)) {
    st.points = st.points.filter((p) => p.id !== str(it.id));
    st.points.push({ id: str(it.id, `p${st.points.length + 1}`), x: num(it.x), y: num(it.y), label: str(it.label) });
  } else if (it.expr) {
    st.functions = st.functions.filter((f) => f.id !== str(it.id));
    st.functions.push({ id: str(it.id, `f${st.functions.length + 1}`), expr: str(it.expr), label: str(it.label) });
  }
}

const idsOf = (op: Op): string[] => arr(op.ids ?? (op.id !== undefined ? [op.id] : [])).map((x) => str(x));

/** Apply one op and return a new state. Unknown or invalid ops are ignored. */
export function applyOp(state: VisualState, op: Op): VisualState {
  // Adding a panel to a single visual turns it into a board with that visual as the first panel.
  if (op.op === "add_panel" && state.kind !== "board") {
    state = { kind: "board", title: state.title, layout: "auto", panels: [{ id: "main", title: state.title, state }] };
  }
  if (state.kind === "board") return applyBoardOp(state, op);
  if ((SCENE_KINDS as readonly string[]).includes(state.kind)) {
    try { return applySceneOp(state as SceneState, op); } catch (e) { console.warn("Ignoring op", op, e); return state; }
  }
  const s = clone(state) as VisualState;
  try {
    switch (s.kind) {
      case "graph": {
        if (op.op === "add_node" && op.id != null && !s.nodes.some((n) => n.id === str(op.id))) {
          s.nodes.push({ id: str(op.id), label: str(op.label, str(op.id)), shape: ["rect", "round", "circle", "diamond"].includes(op.shape) ? op.shape : "rect", mark: mark(op.mark) });
          if (op.from != null && s.nodes.some((n) => n.id === str(op.from))) s.edges.push({ from: str(op.from), to: str(op.id), label: str(op.edge_label) });
        } else if (op.op === "add_edge") {
          const ok = s.nodes.some((n) => n.id === str(op.from)) && s.nodes.some((n) => n.id === str(op.to));
          if (ok && !s.edges.some((e) => e.from === str(op.from) && e.to === str(op.to))) s.edges.push({ from: str(op.from), to: str(op.to), label: str(op.label) });
        } else if (op.op === "remove") {
          for (const id of idsOf(op)) {
            if (id.includes("->")) { const [a, b] = id.split("->"); s.edges = s.edges.filter((e) => !(e.from === a && e.to === b)); }
            else { s.nodes = s.nodes.filter((n) => n.id !== id); s.edges = s.edges.filter((e) => e.from !== id && e.to !== id); }
          }
        } else if (op.op === "label") {
          const n = s.nodes.find((n) => n.id === str(op.id)); if (n) n.label = str(op.label);
        } else if (op.op === "mark") {
          for (const id of idsOf(op)) {
            if (id.includes("->")) { const [a, b] = id.split("->"); const e = s.edges.find((e) => e.from === a && e.to === b); if (e) e.mark = mark(op.state); }
            else { const n = s.nodes.find((n) => n.id === id); if (n) n.mark = mark(op.state); }
          }
        }
        break;
      }
      case "sequence": {
        if (op.op === "add_message") addMessage(s, op);
        else if (op.op === "add_actor" && op.id != null && !s.actors.some((a) => a.id === str(op.id))) s.actors.push({ id: str(op.id), label: str(op.label, str(op.id)) });
        else if (op.op === "mark") for (const id of idsOf(op)) { const m = s.messages.find((m) => m.id === id); if (m) m.mark = mark(op.state); }
        break;
      }
      case "array": {
        const n = s.cells.length;
        const inRange = (i: number) => i >= 0 && i < n;
        if (op.op === "swap") {
          const i = num(op.i, -1), j = num(op.j, -1);
          if (inRange(i) && inRange(j)) [s.cells[i], s.cells[j]] = [s.cells[j], s.cells[i]];
        } else if (op.op === "set" && inRange(num(op.i, -1))) s.cells[num(op.i)].value = str(op.value);
        else if (op.op === "pointer") {
          if (op.index === null || op.index === undefined) delete s.pointers[str(op.name)];
          else s.pointers[str(op.name)] = num(op.index);
        } else if (op.op === "insert") {
          const i = Math.max(0, Math.min(n, num(op.i, n)));
          s.cells.splice(i, 0, { key: `k${s.nextKey++}`, value: str(op.value) });
        } else if (op.op === "remove" && inRange(num(op.i, -1))) s.cells.splice(num(op.i), 1);
        else if (op.op === "push") s.cells.push({ key: `k${s.nextKey++}`, value: str(op.value) });
        else if (op.op === "pop") s.cells.pop();
        else if (op.op === "shift") s.cells.shift();
        else if (op.op === "mark") {
          const idx = arr(op.indices ?? op.ids).map((x) => num(x, -1));
          for (const i of idx) if (i >= 0 && i < s.cells.length) s.cells[i].mark = mark(op.state);
        }
        break;
      }
      case "grid": {
        const r = num(op.r, -1), c = num(op.c, -1);
        if (op.op === "set" && r >= 0 && c >= 0) {
          while (s.rows.length <= r) s.rows.push([]);
          while (s.rows[r].length <= c) s.rows[r].push("");
          s.rows[r][c] = str(op.value);
        } else if (op.op === "mark") {
          for (const cell of arr(op.cells)) {
            const [rr, cc] = Array.isArray(cell) ? cell : String(cell).split(",");
            s.marks[`${num(rr)},${num(cc)}`] = mark(op.state);
          }
        }
        break;
      }
      case "plot": {
        if (op.op === "add") addPlotItem(s, op.item ?? op);
        else if (op.op === "move") { const p = s.points.find((p) => p.id === str(op.id)); if (p) { p.x = num(op.x, p.x); p.y = num(op.y, p.y); if (op.label !== undefined) p.label = str(op.label); } }
        else if (op.op === "remove") for (const id of idsOf(op)) { s.points = s.points.filter((p) => p.id !== id); s.functions = s.functions.filter((f) => f.id !== id); }
        break;
      }
      case "math": {
        if (op.op === "add_line") s.lines.push({ id: str(op.id, `l${s.lines.length + 1}`), tex: str(op.tex), note: str(op.note) });
        else if (op.op === "replace") { const l = s.lines.find((l) => l.id === str(op.id)); if (l) { l.tex = str(op.tex, l.tex); if (op.note !== undefined) l.note = str(op.note); } }
        else if (op.op === "mark") for (const id of idsOf(op)) { const l = s.lines.find((l) => l.id === id); if (l) l.mark = mark(op.state); }
        break;
      }
    }
  } catch (e) {
    console.warn("Ignoring op", op, e);
    return state;
  }
  return s;
}

function applyBoardOp(b: BoardState, op: Op): BoardState {
  const s: BoardState = { ...b, panels: b.panels.map((p) => ({ ...p })) };
  if (op.op === "add_panel") {
    const raw = op.panel ?? op.visual ?? {};
    const inner = normalize(raw);
    if (inner && inner.kind !== "board") {
      const id = str(raw.id ?? op.id, `p${s.panels.length + 1}`);
      const panel = { id, title: str(raw.title ?? inner.title), state: inner };
      const at = s.panels.findIndex((p) => p.id === id);
      if (at >= 0) s.panels[at] = panel; else s.panels.push(panel);
    }
    return s;
  }
  if (op.op === "remove_panel") { s.panels = s.panels.filter((p) => p.id !== str(op.id ?? op.panel)); return s; }
  if (op.op === "set" && op.field === "layout" && !op.panel) { s.layout = ["row", "column"].includes(op.value) ? op.value : "auto"; return s; }
  // anything else goes to its panel (or the only/first panel if none is named)
  const target = s.panels.find((p) => p.id === str(op.panel)) ?? s.panels[0];
  if (!target) return s;
  const { panel: _panel, ...inner } = op;
  target.state = applyOp(target.state, inner as Op);
  return s;
}

/** A compact version of the state, sent back to Claude so it knows what's on screen. */
export function describe(s: VisualState | null): string {
  if (!s) return "";
  if (s.kind === "board") {
    return JSON.stringify({ kind: "board", title: s.title, layout: s.layout,
      panels: s.panels.map((p) => ({ id: p.id, title: p.title, ...JSON.parse(describe(p.state) || "{}") })) }).slice(0, 8000);
  }
  const out: any = { ...s };
  if (s.kind === "array") { out.values = s.cells.map((c) => c.value); delete out.cells; delete out.nextKey; }
  return JSON.stringify(out).slice(0, 4000);
}
