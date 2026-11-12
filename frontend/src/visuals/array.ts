/** Arrays, lists, stacks, strings: cells that swap with a hop, pointers that slide. */
import type { ArrayState, VisualState } from "./state";
import {
  type RenderContext, type Renderer, DURATION, applyHighlight, fadeOutAndRemove, flash, markClass,
  popIn, svgEl, textWidth, tweenViewBox,
} from "./common";
import { sketch } from "./sketch";

const H = 52, GAP = 8, PTR_H = 26;

export class ArrayRenderer implements Renderer {
  readonly kind = "array" as const;
  private svg: SVGSVGElement;
  private idxLayer: SVGGElement;
  private cellLayer: SVGGElement;
  private ptrLayer: SVGGElement;
  private pos = new Map<string, { x: number; y: number }>();

  constructor(private host: HTMLElement, private ctx: RenderContext) {
    this.svg = svgEl("svg", { class: "vis-svg array" });
    this.idxLayer = svgEl("g", {}, this.svg);
    this.cellLayer = svgEl("g", {}, this.svg);
    this.ptrLayer = svgEl("g", {}, this.svg);
    host.appendChild(this.svg);
  }

  draw(state: VisualState, highlight: string[], animate: boolean) {
    const s = state as ArrayState;
    const W = Math.max(52, ...s.cells.map((c) => textWidth(c.value, "600 17px Inter, system-ui") + 24));
    const stack = s.orientation === "stack";
    const n = s.cells.length;
    const slot = (i: number) => (stack ? { x: 0, y: (n - 1 - i) * (H + GAP) } : { x: i * (W + GAP), y: 0 });
    const firstDraw = this.pos.size === 0;

    // index labels (one per slot)
    this.idxLayer.textContent = "";
    for (let i = 0; i < n; i++) {
      const p = slot(i);
      const t = svgEl("text", { class: "index", "text-anchor": stack ? "end" : "middle", "dominant-baseline": "central" }, this.idxLayer);
      t.textContent = String(i);
      if (stack) { t.setAttribute("x", String(p.x - W / 2 - 10)); t.setAttribute("y", String(p.y)); }
      else { t.setAttribute("x", String(p.x)); t.setAttribute("y", String(H / 2 + 16)); }
    }

    // cells, keyed by identity so swaps animate
    const old = new Map<string, SVGGElement>();
    this.cellLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => old.set(el.dataset.key!, el));
    const newPos = new Map<string, { x: number; y: number }>();
    s.cells.forEach((c, i) => {
      const p = slot(i);
      newPos.set(c.key, p);
      let el = old.get(c.key);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", { class: "item cell" }, this.cellLayer);
        el.dataset.key = c.key;
        const inner = svgEl("g", { class: "inner" }, el);
        svgEl("g", { class: "sk" }, inner);
        svgEl("text", { class: "value", "text-anchor": "middle", "dominant-baseline": "central" }, inner);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); this.ctx.onItemClick(el!.getAttribute("data-hid")!, `index ${el!.getAttribute("data-hid")} (value ${el!.dataset.value})`, el!); });
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        if (animate) popIn(inner, firstDraw ? 60 + i * 70 : 0);
      }
      old.delete(c.key);
      el.setAttribute("data-hid", String(i));
      sketch(el.querySelector<SVGGElement>(".sk")!, { type: "rect", w: W, h: H, r: 6 }, c.key);
      const txt = el.querySelector("text")!;
      if (!fresh && el.dataset.value !== c.value && animate) flash(el.querySelector(".inner")!);
      txt.textContent = c.value;
      el.dataset.value = c.value;
      markClass(el, c.mark);

      const prev = this.pos.get(c.key);
      el.style.transition = "none";
      if (!fresh && prev && (prev.x !== p.x || prev.y !== p.y) && animate) {
        // hop: arc over (or under) the other cells
        const dir = stack ? (p.x >= prev.x ? 1 : -1) : (p.x > prev.x ? -1 : 1);
        const mid = stack ? { x: (prev.x + p.x) / 2 + dir * (W * 0.9), y: (prev.y + p.y) / 2 } : { x: (prev.x + p.x) / 2, y: dir * (H + 6) };
        el.animate([
          { transform: `translate(${prev.x}px, ${prev.y}px)` },
          { transform: `translate(${mid.x}px, ${mid.y}px)` },
          { transform: `translate(${p.x}px, ${p.y}px)` },
        ], { duration: DURATION + 150, easing: "ease-in-out" });
      }
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    });
    old.forEach(fadeOutAndRemove);
    this.pos = newPos;

    // pointers: little labelled arrows above (or beside) their cell
    const oldPtr = new Map<string, SVGGElement>();
    this.ptrLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => oldPtr.set(el.dataset.key!, el));
    const stackAt = new Map<number, number>();
    for (const [name, idx] of Object.entries(s.pointers)) {
      const i = Math.max(-1, Math.min(n, idx));
      const level = stackAt.get(i) ?? 0;
      stackAt.set(i, level + 1);
      const p = slot(Math.max(0, Math.min(n - 1, i)));
      const off = i < 0 ? -(W + GAP) : i >= n ? (W + GAP) : 0;
      const tx = stack ? p.x + W / 2 + 14 + level * 46 : p.x + off;
      const ty = stack ? p.y : -H / 2 - 10 - level * PTR_H;
      let el = oldPtr.get(name);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", { class: "item pointer" }, this.ptrLayer);
        el.dataset.key = name;
        const inner = svgEl("g", { class: "inner" }, el);
        svgEl("path", { class: "ptr-arrow" }, inner);
        svgEl("text", { class: "ptr-label", "text-anchor": "middle" }, inner);
        el.style.transform = `translate(${tx}px, ${ty}px)`;
        if (animate) popIn(inner, firstDraw ? 300 : 0);
      }
      oldPtr.delete(name);
      el.setAttribute("data-hid", `ptr:${name}`);
      el.querySelector("text")!.textContent = name;
      const arrow = el.querySelector("path")!;
      if (stack) { arrow.setAttribute("d", "M 0 0 L 10 -6 L 10 6 Z"); el.querySelector("text")!.setAttribute("x", "26"); el.querySelector("text")!.setAttribute("y", "5"); }
      else { arrow.setAttribute("d", "M 0 0 L -6 -10 L 6 -10 Z"); el.querySelector("text")!.setAttribute("x", "0"); el.querySelector("text")!.setAttribute("y", "-14"); }
      el.style.transition = animate && !fresh ? `transform ${DURATION}ms cubic-bezier(.3,.7,.3,1.2)` : "none";
      el.style.transform = `translate(${tx}px, ${ty}px)`;
    }
    oldPtr.forEach(fadeOutAndRemove);

    // fit (leave room for pointers and the hop)
    const levels = Math.max(1, ...stackAt.values());
    const vb: [number, number, number, number] = stack
      ? [-W / 2 - 40, -H / 2 - 20, W + 80 + levels * 46 + 40, n * (H + GAP) + 40]
      : [-W / 2 - (W + GAP) - 10, -H / 2 - 20 - levels * PTR_H - 10 - H * 0.6, Math.max(n + 2, 3) * (W + GAP) + 20, H + 40 + levels * PTR_H + H * 1.4];
    tweenViewBox(this.svg, vb, animate && !firstDraw);
    this.highlight(highlight);
  }

  highlight(ids: string[]) { applyHighlight(this.svg, ids.map(String)); }

  destroy() { this.svg.remove(); }
}
