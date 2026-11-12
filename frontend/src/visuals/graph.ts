/** Graphs: flowcharts, trees, recursion, networks, state machines, mind maps. Auto-laid-out with dagre. */
import { Graph, layout } from "@dagrejs/dagre";
import type { GraphState, VisualState } from "./state";
import {
  type RenderContext, type Renderer, DURATION, applyHighlight, arrowDefs, drawIn, fadeOutAndRemove,
  markClass, popIn, setText, svgEl, textWidth, tweenViewBox,
} from "./common";
import { sketch, sketchFilter } from "./sketch";

let uid = 0;

export class GraphRenderer implements Renderer {
  readonly kind = "graph" as const;
  private svg: SVGSVGElement;
  private edgeLayer: SVGGElement;
  private nodeLayer: SVGGElement;
  private prefix = `g${++uid}`;

  constructor(private host: HTMLElement, private ctx: RenderContext) {
    this.svg = svgEl("svg", { class: "vis-svg graph" });
    arrowDefs(this.svg, this.prefix);
    sketchFilter(this.svg, `${this.prefix}-sk`);
    this.edgeLayer = svgEl("g", { class: "edges" }, this.svg);
    this.nodeLayer = svgEl("g", { class: "nodes" }, this.svg);
    host.appendChild(this.svg);
  }

  draw(state: VisualState, highlight: string[], animate: boolean) {
    const s = state as GraphState;
    // ---- layout ----
    const g = new Graph({ multigraph: false });
    g.setGraph({ rankdir: s.direction, nodesep: 36, ranksep: 56, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));
    const size = new Map<string, { w: number; h: number }>();
    for (const n of s.nodes) {
      const tw = textWidth(n.label);
      const lines = n.label.split("\n").length;
      let w = Math.max(64, tw + 32), h = 26 + lines * 17;
      if (n.shape === "circle") { w = h = Math.max(56, tw + 22, h); }
      if (n.shape === "diamond") { w = tw + 64; h = Math.max(62, h + 22); }
      size.set(n.id, { w, h });
      g.setNode(n.id, { width: w, height: h });
    }
    for (const e of s.edges) {
      g.setEdge(e.from, e.to, e.label ? { width: textWidth(e.label, "12px Inter, system-ui") + 10, height: 18, labelpos: "c" } : {});
    }
    layout(g);

    // ---- nodes ----
    const existing = new Map<string, SVGGElement>();
    this.nodeLayer.querySelectorAll<SVGGElement>(":scope > g[data-key]").forEach((el) => existing.set(el.dataset.key!, el));
    const isFirstDraw = existing.size === 0;
    let order = 0;
    for (const n of s.nodes) {
      const pos = g.node(n.id);
      const { w, h } = size.get(n.id)!;
      let el = existing.get(n.id);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", { class: "item node" }, this.nodeLayer);
        el.dataset.key = n.id;
        const inner0 = svgEl("g", { class: "inner" }, el);
        svgEl("g", { class: "sk" }, inner0);
        svgEl("text", { class: "label", "text-anchor": "middle", "dominant-baseline": "central" }, inner0);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); this.ctx.onItemClick(n.id, el!.dataset.label ?? n.id, el!); });
        el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      }
      existing.delete(n.id);
      el.setAttribute("data-hid", n.id);
      el.dataset.label = n.label.replace(/\n/g, " ");
      // shape (rebuilt each draw: cheap, and handles label/shape changes)
      const inner = el.querySelector<SVGGElement>(".inner")!;
      const prevLabel = inner.dataset.label;
      sketch(inner.querySelector<SVGGElement>(".sk")!,
        n.shape === "circle" ? { type: "circle", w, h } : n.shape === "diamond" ? { type: "diamond", w, h } : { type: "rect", w, h, r: n.shape === "round" ? h / 2 : 6 },
        n.id);
      if (prevLabel !== n.label) setText(inner.querySelector<SVGTextElement>("text")!, n.label);
      inner.dataset.label = n.label;
      markClass(el, n.mark);
      el.style.transition = animate && !fresh ? `transform ${DURATION}ms cubic-bezier(.3,.7,.3,1)` : "none";
      el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      if (fresh && animate) popIn(inner, isFirstDraw ? 80 + order++ * 140 : 120);
      else if (animate && prevLabel !== undefined && prevLabel !== n.label) popIn(inner, 0);
    }
    for (const el of existing.values()) fadeOutAndRemove(el);

    // ---- edges ----
    const oldEdges = new Map<string, SVGGElement>();
    this.edgeLayer.querySelectorAll<SVGGElement>(":scope > g[data-key]").forEach((el) => oldEdges.set(el.dataset.key!, el));
    for (const e of s.edges) {
      const key = `${e.from}->${e.to}`;
      const pts = g.edge(e.from, e.to)?.points ?? [];
      if (pts.length < 2) continue;
      const d = smoothPath(pts);
      let el = oldEdges.get(key);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", { class: "item edge" }, this.edgeLayer);
        el.dataset.key = key;
        svgEl("path", { class: "line", "marker-end": `url(#${this.prefix}-arrow)`, filter: `url(#${this.prefix}-sk)` }, el);
        svgEl("text", { class: "edge-label", "text-anchor": "middle", "dominant-baseline": "central" }, el);
      }
      oldEdges.delete(key);
      el.setAttribute("data-hid", key);
      el.setAttribute("data-ends", `${e.from} ${e.to}`);
      markClass(el, e.mark);
      const path = el.querySelector<SVGPathElement>("path")!;
      path.style.transition = animate && !fresh ? `d ${DURATION}ms cubic-bezier(.3,.7,.3,1)` : "none";
      path.style.setProperty("d", `path("${d}")`);
      path.setAttribute("d", d);
      const lbl = el.querySelector<SVGTextElement>("text")!;
      lbl.textContent = e.label ?? "";
      const lp = g.edge(e.from, e.to);
      const lx = lp?.x ?? (pts[0].x + pts[pts.length - 1].x) / 2, ly = lp?.y ?? (pts[0].y + pts[pts.length - 1].y) / 2;
      lbl.style.transition = animate && !fresh ? `transform ${DURATION}ms` : "none";
      lbl.style.transform = `translate(${lx}px, ${ly}px)`;
      if (fresh && animate) {
        // draw the arrow just before its target node pops in
        const idx = s.nodes.findIndex((n) => n.id === e.to);
        drawIn(path, isFirstDraw ? Math.max(0, 80 + idx * 140 - 120) : 0, 420);
      }
    }
    for (const el of oldEdges.values()) fadeOutAndRemove(el);

    // ---- fit ----
    const gr = g.graph() as { width?: number; height?: number };
    // Never zoom in past a natural size: a lone node stays node-sized, and the view zooms out as it grows.
    const gw = gr.width ?? 100, gh = gr.height ?? 100;
    const W = Math.max(gw, 480), H = Math.max(gh, 320);
    tweenViewBox(this.svg, [(gw - W) / 2, (gh - H) / 2, W, H], animate && !isFirstDraw);
    this.highlight(highlight);
  }

  highlight(ids: string[]) {
    applyHighlight(this.svg, ids);
    this.edgeLayer.querySelectorAll<SVGGElement>("g.edge").forEach((el) =>
      el.querySelector("path")!.setAttribute("marker-end", `url(#${this.prefix}-arrow${el.classList.contains("hl") ? "-hl" : ""})`));
  }

  destroy() { this.svg.remove(); }
}

/** A path with a fixed structure (M + one cubic), so CSS can morph it smoothly between layouts. */
function smoothPath(pts: { x: number; y: number }[]): string {
  const a = pts[0], b = pts[pts.length - 1];
  const c1 = pts.length > 2 ? pts[1] : { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
  const c2 = pts.length > 2 ? pts[pts.length - 2] : { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 };
  const f = (n: number) => n.toFixed(1);
  return `M ${f(a.x)} ${f(a.y)} C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
}
