/** Plots: functions that draw themselves on axes, and points that can move. */
import type { PlotState, VisualState } from "./state";
import { compile } from "./expr";
import { type RenderContext, type Renderer, DURATION, applyHighlight, drawIn, fadeOutAndRemove, popIn, svgEl } from "./common";
import { sketch, sketchFilter } from "./sketch";

const W = 560, H = 380, PAD = { l: 44, r: 20, t: 16, b: 34 };

function niceStep(range: number) {
  const raw = range / 8, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}
const fmt = (v: number) => (Math.abs(v) < 1e-9 ? "0" : Number(v.toPrecision(4)).toString());

export class PlotRenderer implements Renderer {
  readonly kind = "plot" as const;
  private svg: SVGSVGElement;
  private axes: SVGGElement;
  private fnLayer: SVGGElement;
  private ptLayer: SVGGElement;
  private axesKey = "";

  constructor(private host: HTMLElement, private ctx: RenderContext) {
    this.svg = svgEl("svg", { class: "vis-svg plot", viewBox: `0 0 ${W} ${H}` });
    const clipId = `plotclip${Math.random().toString(36).slice(2, 8)}`;
    const clip = svgEl("clipPath", { id: clipId }, svgEl("defs", {}, this.svg));
    svgEl("rect", { x: PAD.l, y: PAD.t, width: W - PAD.l - PAD.r, height: H - PAD.t - PAD.b }, clip);
    sketchFilter(this.svg, `${clipId}-sk`, 1.8);
    this.axes = svgEl("g", {}, this.svg);
    this.fnLayer = svgEl("g", { "clip-path": `url(#${clipId})` }, this.svg);
    this.ptLayer = svgEl("g", {}, this.svg);
    host.appendChild(this.svg);
  }

  draw(state: VisualState, highlight: string[], animate: boolean) {
    const s = state as PlotState;
    const [x0, x1] = s.x[0] < s.x[1] ? s.x : [-5, 5];
    const [y0, y1] = s.y[0] < s.y[1] ? s.y : [-5, 5];
    const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const sy = (y: number) => H - PAD.b - ((y - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);

    // axes & grid (redrawn only when the ranges change)
    const key = `${x0},${x1},${y0},${y1}`;
    const axesChanged = key !== this.axesKey;
    if (axesChanged) {
      this.axesKey = key;
      this.axes.textContent = "";
      const xs = niceStep(x1 - x0), ys = niceStep(y1 - y0);
      for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
        svgEl("line", { filter: `url(#${this.svg.querySelector("filter")!.id})`, class: "grid", x1: sx(v), x2: sx(v), y1: PAD.t, y2: H - PAD.b }, this.axes);
        const t = svgEl("text", { class: "tick", x: sx(v), y: H - PAD.b + 16, "text-anchor": "middle" }, this.axes);
        t.textContent = fmt(v);
      }
      for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
        svgEl("line", { filter: `url(#${this.svg.querySelector("filter")!.id})`, class: "grid", y1: sy(v), y2: sy(v), x1: PAD.l, x2: W - PAD.r }, this.axes);
        const t = svgEl("text", { class: "tick", x: PAD.l - 6, y: sy(v) + 4, "text-anchor": "end" }, this.axes);
        t.textContent = fmt(v);
      }
      if (x0 <= 0 && x1 >= 0) svgEl("line", { filter: `url(#${this.svg.querySelector("filter")!.id})`, class: "axis", x1: sx(0), x2: sx(0), y1: PAD.t, y2: H - PAD.b }, this.axes);
      if (y0 <= 0 && y1 >= 0) svgEl("line", { filter: `url(#${this.svg.querySelector("filter")!.id})`, class: "axis", y1: sy(0), y2: sy(0), x1: PAD.l, x2: W - PAD.r }, this.axes);
    }

    // functions
    const oldFns = new Map<string, SVGGElement>();
    this.fnLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => oldFns.set(el.dataset.key!, el));
    s.functions.forEach((f, i) => {
      let el = oldFns.get(f.id);
      const fresh = !el;
      const sig = `${f.expr}|${key}`;
      if (!el) {
        el = svgEl("g", { class: `item fn c${i % 4}` }, this.fnLayer);
        el.dataset.key = f.id;
        svgEl("path", { class: "curve", filter: `url(#${this.svg.querySelector("filter")!.id})` }, el);
        svgEl("text", { class: "fn-label" }, el);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); this.ctx.onItemClick(f.id, f.label || f.expr, el!); });
      }
      oldFns.delete(f.id);
      el.setAttribute("data-hid", f.id);
      if (el.dataset.sig !== sig) {
        el.dataset.sig = sig;
        let d = "", lastPt: [number, number] | null = null;
        try {
          const fn = compile(f.expr);
          let pen = false, prevY = NaN;
          const N = 400;
          for (let k = 0; k <= N; k++) {
            const x = x0 + ((x1 - x0) * k) / N, y = fn(x);
            const off = !Number.isFinite(y) || y < y0 - (y1 - y0) * 2 || y > y1 + (y1 - y0) * 2;
            const jump = Number.isFinite(prevY) && Math.abs(y - prevY) > (y1 - y0) * 1.5;
            if (off || jump) { pen = false; prevY = y; continue; }
            d += `${pen ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)} `;
            pen = true; prevY = y;
            if (y >= y0 && y <= y1) lastPt = [sx(x), sy(y)];
          }
        } catch (e) {
          console.warn("Bad expression", f.expr, e);
        }
        const path = el.querySelector("path")!;
        path.setAttribute("d", d);
        const lbl = el.querySelector("text")!;
        lbl.textContent = f.label || `y = ${f.expr}`;
        if (lastPt) { lbl.setAttribute("x", String(Math.min(lastPt[0], W - PAD.r - 4))); lbl.setAttribute("y", String(Math.max(lastPt[1] - 8, PAD.t + 14))); lbl.setAttribute("text-anchor", "end"); }
        if (animate) { drawIn(path, fresh ? 100 : 0, 900); lbl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 800, fill: "backwards" }); }
      }
    });
    oldFns.forEach(fadeOutAndRemove);

    // points
    const oldPts = new Map<string, SVGGElement>();
    this.ptLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => oldPts.set(el.dataset.key!, el));
    s.points.forEach((p) => {
      let el = oldPts.get(p.id);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", { class: "item pt" }, this.ptLayer);
        el.dataset.key = p.id;
        const inner = svgEl("g", { class: "inner" }, el);
        sketch(svgEl("g", { class: "sk dot" }, inner), { type: "circle", w: 14, h: 14 }, p.id);
        svgEl("text", { class: "pt-label", x: 10, y: -10 }, inner);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); this.ctx.onItemClick(p.id, p.label || `(${p.x}, ${p.y})`, el!); });
        el.style.transform = `translate(${sx(p.x)}px, ${sy(p.y)}px)`;
        if (animate) popIn(inner, 400);
      }
      oldPts.delete(p.id);
      el.setAttribute("data-hid", p.id);
      el.querySelector("text")!.textContent = p.label;
      el.style.transition = animate && !fresh ? `transform ${DURATION + 250}ms cubic-bezier(.3,.7,.3,1)` : "none";
      el.style.transform = `translate(${sx(p.x)}px, ${sy(p.y)}px)`;
    });
    oldPts.forEach(fadeOutAndRemove);

    this.highlight(highlight);
  }

  highlight(ids: string[]) { applyHighlight(this.svg, ids.map(String)); }

  destroy() { this.svg.remove(); }
}
