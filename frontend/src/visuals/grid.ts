/** Grids: tables, matrices, DP tables, boards. Hand-drawn cells that fill in and light up. */
import type { GridState, VisualState } from "./state";
import { type RenderContext, type Renderer, applyHighlight, fadeOutAndRemove, markClass, popIn, svgEl, textWidth, tweenViewBox } from "./common";
import { sketch } from "./sketch";

const CH = 48, GAP = 6;

export class GridRenderer implements Renderer {
  readonly kind = "grid" as const;
  private svg: SVGSVGElement;
  private labelLayer: SVGGElement;
  private cellLayer: SVGGElement;

  constructor(private host: HTMLElement, private ctx: RenderContext) {
    this.svg = svgEl("svg", { class: "vis-svg gridvis" });
    this.labelLayer = svgEl("g", {}, this.svg);
    this.cellLayer = svgEl("g", {}, this.svg);
    host.appendChild(this.svg);
  }

  draw(state: VisualState, highlight: string[], animate: boolean) {
    const s = state as GridState;
    const nCols = Math.max(s.colLabels.length, ...s.rows.map((r) => r.length), 1);
    const nRows = Math.max(s.rows.length, 1);
    const CW = Math.max(52, ...s.rows.flat().map((v) => textWidth(v, "600 17px Inter, system-ui") + 22));
    const RLW = s.rowLabels.length ? Math.max(...s.rowLabels.map((l) => textWidth(l, "13px Inter")), 10) + 16 : 0;
    const x = (c: number) => c * (CW + GAP), y = (r: number) => r * (CH + GAP);
    const firstDraw = !this.cellLayer.firstChild;

    // labels
    this.labelLayer.textContent = "";
    s.colLabels.forEach((l, c) => {
      const t = svgEl("text", { class: "grid-label item", x: x(c), y: -CH / 2 - 12, "text-anchor": "middle", "data-hid": `col:${c}` }, this.labelLayer);
      t.textContent = l;
    });
    s.rowLabels.forEach((l, r) => {
      const t = svgEl("text", { class: "grid-label item", x: -CW / 2 - 10, y: y(r) + 4, "text-anchor": "end", "data-hid": `row:${r}` }, this.labelLayer);
      t.textContent = l;
    });

    // cells
    const old = new Map<string, SVGGElement>();
    this.cellLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => old.set(el.dataset.key!, el));
    let order = 0;
    for (let r = 0; r < nRows; r++) {
      for (let c = 0; c < nCols; c++) {
        const key = `${r},${c}`;
        const value = s.rows[r]?.[c] ?? "";
        let el = old.get(key);
        if (!el) {
          el = svgEl("g", { class: "item cell" }, this.cellLayer);
          el.dataset.key = key;
          const inner = svgEl("g", { class: "inner" }, el);
          svgEl("g", { class: "sk" }, inner);
          svgEl("text", { class: "value", "text-anchor": "middle", "dominant-baseline": "central" }, inner);
          const cell = el;
          cell.addEventListener("click", (ev) => { ev.stopPropagation(); this.ctx.onItemClick(key, `row ${r}, column ${c} (${cell.dataset.value || "empty"})`, cell); });
          if (animate) popIn(inner, firstDraw ? 40 + order++ * 25 : 0);
        }
        old.delete(key);
        el.setAttribute("data-hid", key);
        el.dataset.row = String(r);
        el.dataset.col = String(c);
        el.setAttribute("transform", `translate(${x(c)} ${y(r)})`);
        sketch(el.querySelector<SVGGElement>(".sk")!, { type: "rect", w: CW, h: CH, r: 5 }, `grid${key}`);
        markClass(el, s.marks[key]);
        if (el.dataset.value !== value) {
          const had = el.dataset.value !== undefined;
          el.dataset.value = value;
          el.querySelector("text")!.textContent = value;
          if (animate && had && value) popIn(el.querySelector(".inner")!, 0);
        }
      }
    }
    old.forEach(fadeOutAndRemove);

    const left = -CW / 2 - RLW - 10, top = -CH / 2 - (s.colLabels.length ? 34 : 10);
    const w = x(nCols - 1) + CW / 2 + 10 - left, h = y(nRows - 1) + CH / 2 + 10 - top;
    const vw = Math.max(w, 420), vh = Math.max(h, 240);
    tweenViewBox(this.svg, [left - (vw - w) / 2, top - (vh - h) / 2, vw, vh], animate && !firstDraw);
    this.highlight(highlight);
  }

  /** "row:2" / "col:3" highlight a whole row or column. */
  highlight(highlight: string[]) {
    const ids = new Set(highlight.map(String));
    for (const id of [...ids]) {
      const m = id.match(/^(row|col):(\d+)$/);
      if (!m) continue;
      this.cellLayer.querySelectorAll<SVGGElement>(`g[data-${m[1]}="${m[2]}"]`).forEach((g) => ids.add(g.getAttribute("data-hid")!));
    }
    applyHighlight(this.svg, [...ids]);
  }

  destroy() { this.svg.remove(); }
}
