/** Sequence diagrams: parties side by side, messages flowing between them over time. */
import type { SequenceState, VisualState } from "./state";
import {
  type RenderContext, type Renderer, DURATION, applyHighlight, arrowDefs, drawIn, fadeOutAndRemove,
  markClass, popIn, svgEl, textWidth, tweenViewBox,
} from "./common";
import { sketch, sketchFilter } from "./sketch";

let uid = 0;
const TOP = 20, HEAD_H = 40, ROW = 52, FIRST_ROW = TOP + HEAD_H + 40;

export class SequenceRenderer implements Renderer {
  readonly kind = "sequence" as const;
  private svg: SVGSVGElement;
  private lifeLayer: SVGGElement;
  private msgLayer: SVGGElement;
  private actorLayer: SVGGElement;
  private prefix = `s${++uid}`;

  constructor(private host: HTMLElement, private ctx: RenderContext) {
    this.svg = svgEl("svg", { class: "vis-svg sequence" });
    arrowDefs(this.svg, this.prefix);
    sketchFilter(this.svg, `${this.prefix}-sk`);
    this.lifeLayer = svgEl("g", {}, this.svg);
    this.msgLayer = svgEl("g", {}, this.svg);
    this.actorLayer = svgEl("g", {}, this.svg);
    host.appendChild(this.svg);
  }

  draw(state: VisualState, highlight: string[], animate: boolean) {
    const s = state as SequenceState;
    const widths = s.actors.map((a) => Math.max(90, textWidth(a.label) + 32));
    const maxLabel = Math.max(0, ...s.messages.map((m) => textWidth(m.label, "13px Inter, system-ui")));
    const gap = Math.max(170, maxLabel + 40, ...widths.map((w) => w + 30));
    const xOf = new Map(s.actors.map((a, i) => [a.id, 40 + widths[0] / 2 + i * gap]));
    const bottom = FIRST_ROW + Math.max(1, s.messages.length) * ROW;
    const firstDraw = !this.actorLayer.firstChild;

    // actors + lifelines
    const oldActors = new Map<string, SVGGElement>();
    this.actorLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => oldActors.set(el.dataset.key!, el));
    const oldLives = new Map<string, SVGLineElement>();
    this.lifeLayer.querySelectorAll<SVGLineElement>(":scope > line").forEach((el) => oldLives.set(el.dataset.key!, el));
    s.actors.forEach((a, i) => {
      const x = xOf.get(a.id)!, w = widths[i];
      let el = oldActors.get(a.id);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", { class: "item actor" }, this.actorLayer);
        el.dataset.key = a.id;
        const inner = svgEl("g", { class: "inner" }, el);
        svgEl("g", { class: "sk", transform: `translate(0 ${TOP + HEAD_H / 2})` }, inner);
        svgEl("text", { class: "label", y: TOP + HEAD_H / 2, "text-anchor": "middle", "dominant-baseline": "central" }, inner);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); this.ctx.onItemClick(a.id, a.label, el!); });
        el.style.transform = `translateX(${x}px)`;
        if (animate) popIn(inner, firstDraw ? 60 + i * 120 : 0);
      }
      oldActors.delete(a.id);
      el.setAttribute("data-hid", a.id);
      sketch(el.querySelector<SVGGElement>(".sk")!, { type: "rect", w, h: HEAD_H, r: 6 }, a.id);
      el.querySelector("text")!.textContent = a.label;
      el.style.transition = animate && !fresh ? `transform ${DURATION}ms` : "none";
      el.style.transform = `translateX(${x}px)`;

      let life = oldLives.get(a.id);
      if (!life) { life = svgEl("line", { class: "lifeline", y1: TOP + HEAD_H, filter: `url(#${this.prefix}-sk)` }, this.lifeLayer); life.dataset.key = a.id; }
      oldLives.delete(a.id);
      life.setAttribute("x1", String(x)); life.setAttribute("x2", String(x));
      life.setAttribute("y2", String(bottom));
    });
    oldActors.forEach(fadeOutAndRemove);
    oldLives.forEach((l) => l.remove());

    // messages
    const oldMsgs = new Map<string, SVGGElement>();
    this.msgLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => oldMsgs.set(el.dataset.key!, el));
    s.messages.forEach((m, k) => {
      const y = FIRST_ROW + k * ROW;
      const x1 = xOf.get(m.from) ?? 0, x2 = xOf.get(m.to) ?? 0;
      const self = m.from === m.to;
      const d = self ? `M ${x1} ${y - 8} C ${x1 + 60} ${y - 8} ${x1 + 60} ${y + 14} ${x1 + 4} ${y + 14}` : `M ${x1} ${y} L ${x2 + (x2 > x1 ? -3 : 3)} ${y}`;
      let el = oldMsgs.get(m.id);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", { class: "item msg-item" }, this.msgLayer);
        el.dataset.key = m.id;
        svgEl("path", { class: "line", "marker-end": `url(#${this.prefix}-arrow)`, filter: `url(#${this.prefix}-sk)` }, el);
        svgEl("text", { class: "msg-label", "text-anchor": "middle" }, el);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); this.ctx.onItemClick(m.id, m.label, el!); });
      }
      oldMsgs.delete(m.id);
      el.setAttribute("data-hid", m.id);
      el.setAttribute("data-ends", `${m.from} ${m.to}`);
      el.classList.toggle("reply", m.style === "reply");
      markClass(el, m.mark);
      const path = el.querySelector("path")!;
      path.setAttribute("d", d);
      const label = el.querySelector("text")!;
      label.textContent = m.label;
      label.setAttribute("x", String(self ? x1 + 70 : (x1 + x2) / 2));
      label.setAttribute("y", String(self ? y + 4 : y - 9));
      label.setAttribute("text-anchor", self ? "start" : "middle");
      if (fresh && animate) {
        const delay = firstDraw ? 300 + k * 260 : 0;
        drawIn(path, delay, 520);
        label.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: delay + 300, fill: "backwards" });
        if (!self) this.travel(x1, x2, y, delay);
      }
    });
    oldMsgs.forEach(fadeOutAndRemove);

    const W = 40 + widths[0] / 2 + (s.actors.length - 1) * gap + (widths.at(-1) ?? 90) / 2 + 60;
    const vw = Math.max(W, 520), vh = Math.max(bottom + 20, 300);
    tweenViewBox(this.svg, [(W - vw) / 2, 0, vw, vh], animate && !firstDraw);
    this.highlight(highlight);
  }

  /** A dot that travels along a new message, like a packet. */
  private travel(x1: number, x2: number, y: number, delay: number) {
    const dot = svgEl("circle", { r: 5, class: "packet", cx: 0, cy: y }, this.msgLayer);
    const a = dot.animate([{ transform: `translateX(${x1}px)`, opacity: 1 }, { transform: `translateX(${x2}px)`, opacity: 1 }, { transform: `translateX(${x2}px)`, opacity: 0 }],
      { duration: 700, delay, easing: "ease-in-out", fill: "both" });
    a.onfinish = () => dot.remove();
  }

  highlight(ids: string[]) {
    applyHighlight(this.svg, ids);
    this.msgLayer.querySelectorAll<SVGGElement>("g.msg-item").forEach((el) =>
      el.querySelector("path")!.setAttribute("marker-end", `url(#${this.prefix}-arrow${el.classList.contains("hl") ? "-hl" : ""})`));
  }

  destroy() { this.svg.remove(); }
}
