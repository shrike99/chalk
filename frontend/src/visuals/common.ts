/** Shared helpers for the visual renderers: SVG building, animation and highlighting. */
import type { VisualState } from "./state";

export const SVGNS = "http://www.w3.org/2000/svg";
export const DURATION = 550; // ms for moves / morphs

export interface RenderContext {
  /** Called when the user clicks an item (node, cell, message…) in the visual. */
  onItemClick(id: string, label: string, el: Element): void;
}

export interface Renderer {
  readonly kind: VisualState["kind"];
  draw(state: VisualState, highlight: string[], animate: boolean): Promise<void> | void;
  /** Change only the spotlight (no re-layout, so running animations aren't disturbed). */
  highlight(ids: string[]): void;
  destroy(): void;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

const measureCtx = document.createElement("canvas").getContext("2d")!;
export function textWidth(text: string, font = "500 14px Inter, system-ui, sans-serif"): number {
  measureCtx.font = font;
  return Math.max(...text.split("\n").map((l) => measureCtx.measureText(l).width), 0);
}

/** Multi-line centred SVG text (lines split on \n). */
export function setText(t: SVGTextElement, text: string, lineHeight = 17) {
  const lines = text.split("\n");
  t.textContent = "";
  lines.forEach((line, i) => {
    const span = svgEl("tspan", { x: 0, dy: i === 0 ? -((lines.length - 1) * lineHeight) / 2 : lineHeight }, t);
    span.textContent = line;
  });
}

/** Scale-and-fade an element in. Expects `inner` to be a wrapper we can transform freely. */
export function popIn(inner: Element, delay = 0) {
  (inner as HTMLElement).animate(
    [{ opacity: 0, transform: "scale(0.55)" }, { opacity: 1, transform: "scale(1.07)", offset: 0.7 }, { opacity: 1, transform: "scale(1)" }],
    { duration: 520, delay, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
  );
}

/** Make a path draw itself from start to end. */
export function drawIn(path: SVGGeometryElement, delay = 0, duration = 500) {
  const len = path.getTotalLength?.() ?? 0;
  if (!len) return;
  path.style.strokeDasharray = `${len}`;
  const a = path.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration, delay, easing: "ease-in-out", fill: "backwards" });
  a.onfinish = () => { path.style.strokeDasharray = ""; };
}

export function fadeOutAndRemove(el: Element) {
  const a = (el as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease-out" });
  a.onfinish = () => el.remove();
}

export function flash(el: Element) {
  (el as HTMLElement).animate(
    [{ filter: "drop-shadow(0 0 0 rgba(79,70,229,0))" }, { filter: "drop-shadow(0 0 10px rgba(79,70,229,.9))" }, { filter: "drop-shadow(0 0 0 rgba(79,70,229,0))" }],
    { duration: 700, easing: "ease-out" },
  );
}

/** Smoothly animate an SVG viewBox to fit new content. */
export function tweenViewBox(svg: SVGSVGElement, target: [number, number, number, number], animate: boolean) {
  const cur = svg.viewBox.baseVal;
  const from: [number, number, number, number] = cur && cur.width ? [cur.x, cur.y, cur.width, cur.height] : target;
  const prev = (svg as any)._vbRaf as number | undefined;
  if (prev) cancelAnimationFrame(prev);
  if (!animate || from.every((v, i) => Math.abs(v - target[i]) < 0.5)) { svg.setAttribute("viewBox", target.join(" ")); return; }
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / DURATION);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    svg.setAttribute("viewBox", from.map((v, i) => v + (target[i] - v) * e).join(" "));
    if (t < 1) (svg as any)._vbRaf = requestAnimationFrame(step);
  };
  (svg as any)._vbRaf = requestAnimationFrame(step);
}

/**
 * Spotlight: items whose data-hid is in `ids` glow, everything else dims.
 * Items with data-ends="a b" (edges, messages) light up when both ends are highlighted,
 * or when a single highlighted item is their target.
 */
export function applyHighlight(root: Element, ids: string[]) {
  const want = new Set(ids.map(String));
  const items = root.querySelectorAll<Element>("[data-hid]");
  const present = new Set([...items].map((el) => el.getAttribute("data-hid")!));
  const active = [...want].filter((id) => present.has(id));
  root.classList.toggle("focus", active.length > 0);
  for (const el of items) {
    const hid = el.getAttribute("data-hid")!;
    let on = want.has(hid);
    const ends = el.getAttribute("data-ends");
    if (!on && ends) {
      const [a, b] = ends.split(" ");
      on = (want.has(a) && want.has(b)) || (active.length === 1 && want.has(b) && !el.classList.contains("msg-item"));
    }
    el.classList.toggle("hl", on);
    el.classList.toggle("dim", active.length > 0 && !on);
  }
}

export function markClass(el: Element, mark: string | undefined) {
  for (const m of ["current", "visited", "done", "error"]) el.classList.toggle(`m-${m}`, mark === m);
}

/** Arrow markers (normal + highlighted) for an SVG. */
export function arrowDefs(svg: SVGSVGElement, prefix: string) {
  const defs = svgEl("defs", {}, svg);
  for (const [id, cls] of [[`${prefix}-arrow`, "arrowhead"], [`${prefix}-arrow-hl`, "arrowhead hl"]]) {
    const m = svgEl("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    svgEl("path", { d: "M0 0L10 5L0 10z", class: cls }, m);
  }
  return defs;
}
