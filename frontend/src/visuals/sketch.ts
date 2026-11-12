/**
 * Hand-drawn shapes (the same rough.js look Mermaid uses): wobbly outlines and pencil hatching.
 *
 * Colours aren't baked in: hatching, outline and background read CSS variables
 * (--sk-hatch, --sk-stroke, --sk-bg), so marks (current/done/…) and the spotlight just change
 * variables, and the drawing itself stays put. Each shape gets a stable random seed from its
 * id, so it keeps the same wobble every time it's redrawn instead of jittering.
 */
import rough from "roughjs";
import { svgEl } from "./common";

const gen = rough.generator();
const FILL = "#ff0000", STROKE = "#0000ff"; // sentinels: tell hatching and outline paths apart

export type SketchShape =
  | { type: "rect"; w: number; h: number; r?: number }
  | { type: "circle"; w: number; h: number }
  | { type: "diamond"; w: number; h: number }
  | { type: "path"; d: string; w: number; h: number }; // any closed path, in local coordinates

function seedOf(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (Math.abs(h) % 2_000_000) + 1;
}

function roundedRect(w: number, h: number, r: number) {
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  return `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
}

/**
 * Draw (or keep) a sketchy shape centred at 0,0 inside group `g`.
 * Only redraws when the shape's size or type actually changed.
 */
export function sketch(g: SVGGElement, shape: SketchShape, key: string, opts: { hatch?: boolean } = {}) {
  const hatch = opts.hatch !== false;
  const sig = JSON.stringify(shape) + hatch;
  if (g.dataset.sig === sig) return;
  g.dataset.sig = sig;
  g.textContent = "";
  const o = {
    seed: seedOf(key), roughness: 0.9, bowing: 0.8, stroke: STROKE, strokeWidth: 1.4,
    fill: hatch ? FILL : undefined, fillStyle: "hachure", hachureGap: 4.2, fillWeight: 0.7, hachureAngle: -41,
  };
  const { w, h } = shape;
  let drawable;
  // solid base underneath, so lines behind the shape don't show through the hatching
  if (shape.type === "circle") {
    svgEl("ellipse", { rx: w / 2, ry: h / 2, class: "sk-base" }, g);
    drawable = gen.ellipse(0, 0, w, h, o);
  } else if (shape.type === "diamond") {
    const pts: [number, number][] = [[0, -h / 2], [w / 2, 0], [0, h / 2], [-w / 2, 0]];
    svgEl("polygon", { points: pts.map((p) => p.join(",")).join(" "), class: "sk-base" }, g);
    drawable = gen.polygon(pts, o);
  } else if (shape.type === "path") {
    svgEl("path", { d: shape.d, class: "sk-base" }, g);
    drawable = gen.path(shape.d, o);
  } else {
    const r = shape.r ?? 0;
    const d = r > 0 ? roundedRect(w, h, r) : `M ${-w / 2} ${-h / 2} h ${w} v ${h} h ${-w} Z`;
    svgEl("path", { d, class: "sk-base" }, g);
    drawable = r > 0 ? gen.path(d, o) : gen.rectangle(-w / 2, -h / 2, w, h, o);
  }
  for (const p of gen.toPaths(drawable)) {
    svgEl("path", { d: p.d, class: p.stroke === FILL ? "sk-fill" : "sk-line", "stroke-width": p.strokeWidth, fill: "none" }, g);
  }
}

/** A filter that gives plain lines (arrows, curves) a slightly hand-drawn wobble. */
export function sketchFilter(svg: SVGSVGElement, id: string, scale = 2.2) {
  const defs = svg.querySelector("defs") ?? svgEl("defs", {}, svg);
  const f = svgEl("filter", { id, filterUnits: "userSpaceOnUse", x: -5000, y: -5000, width: 10000, height: 10000 }, defs);
  svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: 0.035, numOctaves: 2, seed: 7, result: "noise" }, f);
  svgEl("feDisplacementMap", { in: "SourceGraphic", in2: "noise", scale, xChannelSelector: "R", yChannelSelector: "G" }, f);
}
