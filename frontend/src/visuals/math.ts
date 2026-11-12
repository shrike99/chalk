/** Maths: a derivation revealed one line at a time, typeset with KaTeX. */
import katex from "katex";
import "katex/dist/katex.min.css";
import type { MathState, VisualState } from "./state";
import { type RenderContext, type Renderer, applyHighlight, fadeOutAndRemove, markClass } from "./common";
import { sketch } from "./sketch";

export class MathRenderer implements Renderer {
  readonly kind = "math" as const;
  private wrap: HTMLDivElement;

  constructor(private host: HTMLElement, private ctx: RenderContext) {
    this.wrap = document.createElement("div");
    this.wrap.className = "vis-html math";
    host.appendChild(this.wrap);
  }

  draw(state: VisualState, highlight: string[], animate: boolean) {
    const s = state as MathState;
    const old = new Map<string, HTMLDivElement>();
    this.wrap.querySelectorAll<HTMLDivElement>(":scope > .mline").forEach((el) => old.set(el.dataset.key!, el));
    const firstDraw = old.size === 0;
    s.lines.forEach((l, i) => {
      let el = old.get(l.id);
      const fresh = !el;
      if (!el) {
        el = document.createElement("div");
        el.className = "mline item";
        el.dataset.key = l.id;
        el.innerHTML = `<svg class="mframe"><g class="sk"></g></svg><div class="tex"></div><div class="note"></div>`;
        el.onclick = (ev) => { ev.stopPropagation(); this.ctx.onItemClick(l.id, l.note || "this step", el!); };
      }
      old.delete(l.id);
      this.wrap.appendChild(el); // keeps order
      el.setAttribute("data-hid", l.id);
      markClass(el, l.mark);
      if (el.dataset.tex !== l.tex) {
        const changed = el.dataset.tex !== undefined;
        el.dataset.tex = l.tex;
        katex.render(l.tex, el.querySelector<HTMLDivElement>(".tex")!, { throwOnError: false, displayMode: true });
        if (changed && animate) el.animate([{ opacity: 0.2, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 400 });
      }
      el.querySelector<HTMLDivElement>(".note")!.textContent = l.note;
      if (fresh && animate) {
        el.animate([{ opacity: 0, transform: "translateY(14px)", filter: "blur(3px)" }, { opacity: 1, transform: "none", filter: "none" }],
          { duration: 480, delay: firstDraw ? i * 160 : 0, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
      }
    });
    old.forEach(fadeOutAndRemove);
    // frames: drawn to each line's size (after layout), centred in an svg that fills the line
    this.wrap.querySelectorAll<HTMLDivElement>(":scope > .mline").forEach((el) => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      const svg = el.querySelector<SVGSVGElement>("svg.mframe")!;
      svg.setAttribute("viewBox", `${-w / 2} ${-h / 2} ${w} ${h}`);
      sketch(svg.querySelector<SVGGElement>(".sk")!, { type: "rect", w: w - 4, h: h - 4, r: 8 }, `math${el.dataset.key}`, { hatch: false });
    });
    this.highlight(highlight);
    if (animate && !this.wrap.querySelector(".mline.hl")) this.wrap.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  highlight(ids: string[]) {
    applyHighlight(this.wrap, ids.map(String));
    this.wrap.querySelector(".mline.hl")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  destroy() { this.wrap.remove(); }
}
