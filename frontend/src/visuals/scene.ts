/**
 * A general renderer for "scenes": positioned items (hand-drawn shapes with text), links
 * (arrows/lines between things) and decoration (axes, ticks, captions).
 *
 * Each visual kind only provides a layout function, state -> Scene. This renderer diffs the
 * new scene against what's on screen by key: new things pop in or draw themselves, moved
 * things glide, changed text re-pops, removed things fade out. Highlighting, marks and
 * click-to-ask work the same for every kind.
 */
import type { VisualState } from "./state";
import {
  type RenderContext, type Renderer, DURATION, applyHighlight, arrowDefs, drawIn, fadeOutAndRemove,
  markClass, popIn, svgEl, tweenViewBox,
} from "./common";
import { type SketchShape, sketch, sketchFilter } from "./sketch";

export interface SText { text: string; dx?: number; dy?: number; cls?: string; anchor?: "start" | "middle" | "end" }

export interface SItem {
  key: string;
  hid?: string;          // highlight / click id (omit for non-interactive items)
  ends?: string;         // "a b": also light up when both a and b are highlighted
  x: number; y: number;
  shape?: SketchShape | null;
  hatch?: boolean;       // pencil hatching inside the shape (default true)
  texts?: SText[];       // text lines, positioned relative to the item's centre
  mark?: string;
  cls?: string;
  vars?: Record<string, string>; // CSS variables, e.g. a set's colour
  layer?: "back" | "front";
  label?: string;        // name shown in the click menu
  noMove?: boolean;      // don't animate position changes
  grow?: boolean;        // when the shape's height changes, grow/shrink it from its bottom edge (bars)
}

export interface SLink {
  key: string;
  hid?: string;
  ends?: string;
  d: string;
  arrow?: "end" | "both" | "none";
  dashed?: boolean;
  cls?: string;
  label?: string; lx?: number; ly?: number;
  wobble?: boolean;      // hand-drawn wobble (default true)
}

export interface SDecor { key: string; d?: string; text?: string; x?: number; y?: number; cls?: string; anchor?: "start" | "middle" | "end"; wobble?: boolean; hid?: string }

export interface Scene {
  items: SItem[];
  links?: SLink[];
  decor?: SDecor[];
  bounds: [number, number, number, number]; // x, y, w, h of the content
  minW?: number; minH?: number;
}

/** What a layout knows about where it's drawn: the panel's width / height. */
export interface LayoutEnv { aspect: number }
export type Layout = (state: any, env: LayoutEnv) => Scene;

let uid = 0;

export class SceneRenderer implements Renderer {
  private svg: SVGSVGElement;
  private decorLayer: SVGGElement;
  private backLayer: SVGGElement;
  private linkLayer: SVGGElement;
  private frontLayer: SVGGElement;
  private prefix = `sc${++uid}`;
  private drawn = false;

  constructor(private host: HTMLElement, private ctx: RenderContext, readonly kind: VisualState["kind"], private layout: Layout) {
    this.svg = svgEl("svg", { class: `vis-svg scene k-${kind}` });
    arrowDefs(this.svg, this.prefix);
    sketchFilter(this.svg, `${this.prefix}-sk`);
    this.decorLayer = svgEl("g", { class: "decor" }, this.svg);
    this.backLayer = svgEl("g", {}, this.svg);
    this.linkLayer = svgEl("g", {}, this.svg);
    this.frontLayer = svgEl("g", {}, this.svg);
    host.appendChild(this.svg);
  }

  draw(state: VisualState, highlight: string[], animate: boolean) {
    let scene: Scene;
    try {
      const r = this.host.getBoundingClientRect();
      scene = this.layout(state, { aspect: r.width && r.height ? r.width / r.height : 1.5 });
    } catch (e) {
      console.error("Layout failed", this.kind, e, state);
      return;
    }
    const first = !this.drawn;
    this.drawn = true;
    this.drawItems(scene.items, animate, first);
    this.drawLinks(scene.links ?? [], animate, first, scene.items);
    this.drawDecor(scene.decor ?? [], animate);
    const [bx, by, bw, bh] = scene.bounds;
    const pad = 24;
    const w = Math.max(bw + 2 * pad, scene.minW ?? 420), h = Math.max(bh + 2 * pad, scene.minH ?? 260);
    tweenViewBox(this.svg, [bx + bw / 2 - w / 2, by + bh / 2 - h / 2, w, h], animate && !first);
    this.highlight(highlight);
  }

  highlight(ids: string[]) {
    applyHighlight(this.svg, ids.map(String));
    this.linkLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => {
      const path = el.querySelector("path")!;
      const hl = el.classList.contains("hl") ? "-hl" : "";
      const a = el.dataset.arrow;
      if (a === "end" || a === "both") path.setAttribute("marker-end", `url(#${this.prefix}-arrow${hl})`);
      if (a === "both") path.setAttribute("marker-start", `url(#${this.prefix}-arrow${hl})`);
    });
  }

  destroy() { this.svg.remove(); }

  // ---------- items ----------
  private drawItems(items: SItem[], animate: boolean, first: boolean) {
    const old = new Map<string, SVGGElement>();
    for (const layer of [this.backLayer, this.frontLayer])
      layer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => old.set(el.dataset.key!, el));
    let k = 0;
    for (const it of items) {
      const layer = it.layer === "back" ? this.backLayer : this.frontLayer;
      let el = old.get(it.key);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", {}, layer);
        el.dataset.key = it.key;
        const inner = svgEl("g", { class: "inner" }, el);
        svgEl("g", { class: "sk" }, inner);
        svgEl("g", { class: "texts" }, inner);
        const g = el;
        g.addEventListener("click", (ev) => {
          const hid = g.getAttribute("data-hid");
          if (!hid) return;
          ev.stopPropagation();
          this.ctx.onItemClick(hid, g.dataset.label || hid, g);
        });
        el.style.transform = `translate(${it.x}px, ${it.y}px)`;
        if (animate) popIn(inner, first ? 60 + k++ * 90 : k++ * 70);
      } else if (el.parentNode !== layer) layer.appendChild(el);
      old.delete(it.key);

      el.setAttribute("class", `${it.hid ? "item " : "static "}${it.cls ?? ""}`);
      if (it.hid) el.setAttribute("data-hid", it.hid); else el.removeAttribute("data-hid");
      if (it.ends) el.setAttribute("data-ends", it.ends); else el.removeAttribute("data-ends");
      el.dataset.label = it.label ?? it.texts?.[0]?.text ?? it.hid ?? "";
      markClass(el, it.mark);
      for (const [k2, v] of Object.entries(it.vars ?? {})) el.style.setProperty(k2, v);

      const inner = el.querySelector<SVGGElement>(".inner")!;
      const sk = inner.querySelector<SVGGElement>(".sk")!;
      const prevH = Number(sk.dataset.h || 0);
      if (it.shape) {
        sketch(sk, it.shape, `${this.kind}:${it.key}`, { hatch: it.hatch !== false });
        sk.dataset.h = String(it.shape.h);
        if (it.grow && animate && prevH && Math.abs(prevH - it.shape.h) > 0.5 && it.shape.h > 0) {
          sk.style.transformBox = "fill-box";
          sk.style.transformOrigin = "50% 100%";
          sk.animate([{ transform: `scaleY(${prevH / it.shape.h})` }, { transform: "scaleY(1)" }], { duration: DURATION + 150, easing: "cubic-bezier(.3,.7,.3,1)" });
        }
      }
      else { sk.textContent = ""; delete sk.dataset.sig; delete sk.dataset.h; }

      // texts (re-pop the item when its text changes)
      const sig = JSON.stringify(it.texts ?? []);
      if (inner.dataset.tsig !== sig) {
        const changed = inner.dataset.tsig !== undefined;
        inner.dataset.tsig = sig;
        const tg = inner.querySelector<SVGGElement>(".texts")!;
        tg.textContent = "";
        for (const t of it.texts ?? []) {
          const te = svgEl("text", { x: t.dx ?? 0, y: t.dy ?? 0, class: t.cls ?? "label", "text-anchor": t.anchor ?? "middle", "dominant-baseline": "central" }, tg);
          te.textContent = t.text;
        }
        if (changed && animate && !fresh) popIn(inner, 0);
      }

      const moveMs = it.noMove || fresh || !animate ? 0 : DURATION;
      el.style.transition = moveMs ? `transform ${moveMs}ms cubic-bezier(.3,.7,.3,1)` : "none";
      el.style.transform = `translate(${it.x}px, ${it.y}px)`;
    }
    old.forEach(fadeOutAndRemove);
  }

  // ---------- links ----------
  private drawLinks(links: SLink[], animate: boolean, first: boolean, items: SItem[]) {
    const old = new Map<string, SVGGElement>();
    this.linkLayer.querySelectorAll<SVGGElement>(":scope > g").forEach((el) => old.set(el.dataset.key!, el));
    const order = new Map(items.map((it, i) => [it.key, i]));
    for (const l of links) {
      let el = old.get(l.key);
      const fresh = !el;
      if (!el) {
        el = svgEl("g", {}, this.linkLayer);
        el.dataset.key = l.key;
        svgEl("path", { class: "line", fill: "none" }, el);
        svgEl("text", { class: "edge-label", "text-anchor": "middle", "dominant-baseline": "central" }, el);
      }
      old.delete(l.key);
      el.setAttribute("class", `${l.hid || l.ends ? "item " : ""}link ${l.cls ?? ""}${l.dashed ? " dashed" : ""}`);
      if (l.hid) el.setAttribute("data-hid", l.hid); else el.removeAttribute("data-hid");
      if (l.ends) el.setAttribute("data-ends", l.ends); else el.removeAttribute("data-ends");
      el.dataset.arrow = l.arrow ?? "end";
      const path = el.querySelector("path")!;
      if (l.wobble !== false) path.setAttribute("filter", `url(#${this.prefix}-sk)`); else path.removeAttribute("filter");
      if ((l.arrow ?? "end") === "none") { path.removeAttribute("marker-end"); path.removeAttribute("marker-start"); }
      const prevD = path.getAttribute("d");
      const sameShape = prevD && prevD.replace(/[^A-Za-z]/g, "") === l.d.replace(/[^A-Za-z]/g, "");
      path.style.transition = animate && !fresh && sameShape ? `d ${DURATION}ms cubic-bezier(.3,.7,.3,1)` : "none";
      path.style.setProperty("d", `path("${l.d}")`);
      path.setAttribute("d", l.d);
      const lbl = el.querySelector("text")!;
      lbl.textContent = l.label ?? "";
      lbl.style.transition = animate && !fresh ? `transform ${DURATION}ms` : "none";
      lbl.style.transform = `translate(${l.lx ?? 0}px, ${l.ly ?? 0}px)`;
      if (fresh && animate) {
        const target = l.ends?.split(" ")[1];
        const delay = first ? Math.max(0, 60 + (order.get(target ?? "") ?? 0) * 90 - 80) : 60;
        drawIn(path, delay, 450);
      }
    }
    old.forEach(fadeOutAndRemove);
  }

  // ---------- decoration (axes, ticks, captions) ----------
  private drawDecor(decor: SDecor[], animate: boolean) {
    const old = new Map<string, SVGElement>();
    this.decorLayer.querySelectorAll<SVGElement>(":scope > *").forEach((el) => old.set(el.dataset.key!, el));
    for (const d of decor) {
      let el = old.get(d.key);
      const isText = d.text !== undefined;
      if (el && (el.tagName === "text") !== isText) { el.remove(); el = undefined; }
      const fresh = !el;
      if (!el) {
        el = isText ? svgEl("text", { "dominant-baseline": "central" }, this.decorLayer) : svgEl("path", { fill: "none" }, this.decorLayer);
        el.dataset.key = d.key;
        if (animate) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      }
      old.delete(d.key);
      el.setAttribute("class", `${d.cls ?? (isText ? "decor-text" : "decor-line")}${d.hid ? " item" : ""}`);
      if (d.hid) el.setAttribute("data-hid", d.hid);
      if (isText) {
        el.textContent = d.text!;
        el.setAttribute("x", String(d.x ?? 0));
        el.setAttribute("y", String(d.y ?? 0));
        el.setAttribute("text-anchor", d.anchor ?? "middle");
      } else {
        el.setAttribute("d", d.d ?? "");
        if (d.wobble !== false) el.setAttribute("filter", `url(#${this.prefix}-sk)`);
        if (fresh && animate) drawIn(el as unknown as SVGPathElement, 0, 500);
      }
    }
    old.forEach(fadeOutAndRemove);
  }
}

// ---------- layout helpers ----------
export const P = (n: number) => n.toFixed(1);
/** A curved link with a fixed structure (M + one cubic) so it morphs smoothly. */
export function curve(x1: number, y1: number, x2: number, y2: number, bend = 0): string {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * bend, ny = dx / len * bend;
  return `M ${P(x1)} ${P(y1)} C ${P(x1 + dx / 3 + nx)} ${P(y1 + dy / 3 + ny)} ${P(x1 + 2 * dx / 3 + nx)} ${P(y1 + 2 * dy / 3 + ny)} ${P(x2)} ${P(y2)}`;
}
/** Point where a line from (cx,cy) towards (tx,ty) leaves a w×h box centred at (cx,cy). */
export function boxEdge(cx: number, cy: number, w: number, h: number, tx: number, ty: number, pad = 3): [number, number] {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = dx ? (w / 2 + pad) / Math.abs(dx) : Infinity, sy = dy ? (h / 2 + pad) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}
/** Point where a line towards (tx,ty) leaves a circle of radius r at (cx,cy). */
export function circleEdge(cx: number, cy: number, r: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx, dy = ty - cy, len = Math.hypot(dx, dy) || 1;
  return [cx + (dx / len) * r, cy + (dy / len) * r];
}
/** Break text into lines of at most `max` characters. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (line && (line + " " + word).length > max) { out.push(line); line = word; }
      else line = line ? line + " " + word : word;
    }
    out.push(line);
  }
  return out;
}
