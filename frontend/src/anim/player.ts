/**
 * The player: plays a recorded timeline (from the director) as real animation.
 *
 * Every object has a current state (x, y, scale, opacity) that tweens toward its target
 * in one requestAnimationFrame loop. Arrows are recomputed from their endpoints every frame,
 * so anything that moves drags its arrows along. The camera follows the content unless a
 * script focused it on something.
 *
 * Seeking works by jumping: dump() what's on screen, load() it back, and apply commands
 * instantly (no animation) up to the point you want.
 */
import katex from "katex";
import "katex/dist/katex.min.css";
import type { ArrowPrim, Cmd, Endpoint, MathPrim, Prim, ShapePrim } from "./protocol";
import { arrowDefs, markClass, svgEl } from "../visuals/common";
import { sketch, sketchFilter } from "../visuals/sketch";

type Ease = (t: number) => number;
const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack: Ease = (t) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3);

interface Tw { from: number; to: number; t0: number; dur: number; ease: Ease }
interface PosTw { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number; arc: number; ease: Ease }
interface Obj {
  id: string; prim: Prim;
  g: SVGGElement;       // translate (engine)
  mid: SVGGElement;     // scale + opacity (engine)
  body: SVGGElement;    // effects (Web Animations: pop, flash)
  x: number; y: number; s: number; o: number;
  pos?: PosTw; sTw?: Tw; oTw?: Tw;
  dying?: number;       // time it's removed
  path?: SVGPathElement; label?: SVGTextElement; drawTw?: Tw;
}
export interface PlayerState { prims: { id: string; prim: Prim }[]; spot: string[] | null; camera: [number, number, number, number] | null }

const val = (tw: Tw | undefined, now: number, cur: number) => {
  if (!tw) return cur;
  const t = Math.max(0, Math.min(1, (now - tw.t0) / tw.dur));
  return tw.from + (tw.to - tw.from) * tw.ease(t);
};
const COLORS = new Set(["blue", "green", "red", "orange", "purple", "yellow", "gray", "grey", "pink", "teal"]);

let uid = 0;
export class Player {
  readonly svg: SVGSVGElement;
  private layers: Record<"back" | "edges" | "front" | "fx", SVGGElement>;
  private objs = new Map<string, Obj>();
  private queue: Cmd[] = [];
  private beatStart = 0;
  private raf = 0;
  private spot: Set<string> | null = null;
  private camBox: [number, number, number, number] | null = null; // focused box, or null = follow content
  private vb: [number, number, number, number] = [0, 0, 1000, 600];
  private vbTw: { from: number[]; to: number[]; t0: number; dur: number } | null = null;
  private fitDue = 0;
  private fx: { el: SVGGElement; fx: number; fy: number; tx: number; ty: number; t0: number; dur: number }[] = [];
  private prefix = `an${++uid}`;
  onItemClick: (id: string, label: string, el: Element) => void = () => {};

  constructor(host: HTMLElement) {
    this.svg = svgEl("svg", { class: "vis-svg anim-svg", viewBox: this.vb.join(" ") }, host) as SVGSVGElement;
    arrowDefs(this.svg, this.prefix);
    sketchFilter(this.svg, `${this.prefix}-wob`, 1.6);
    this.layers = {
      back: svgEl("g", { class: "l-back" }, this.svg), edges: svgEl("g", { class: "l-edges" }, this.svg),
      front: svgEl("g", { class: "l-front" }, this.svg), fx: svgEl("g", { class: "l-fx" }, this.svg),
    };
    this.svg.addEventListener("click", (ev) => {
      const g = (ev.target as Element).closest<SVGGElement>("[data-oid]");
      if (!g) return;
      const o = this.objs.get(g.dataset.oid!);
      if (o && o.prim.label) { ev.stopPropagation(); this.onItemClick(o.id, o.prim.label, g); }
    });
  }

  destroy() { cancelAnimationFrame(this.raf); this.svg.remove(); }

  // ------------------------------------------------------------ playing
  /** Play one beat's commands in real time. Resolves its duration in ms. */
  play(cmds: Cmd[]) {
    this.finish();
    this.queue = [...cmds].sort((a, b) => a.t - b.t);
    this.beatStart = performance.now();
    this.kick();
  }
  /** Jump to the end of whatever is playing. */
  finish() {
    const q = this.queue; this.queue = [];
    for (const c of q) this.apply(c, -1);
    const end = Infinity;
    for (const o of [...this.objs.values()]) this.settle(o, end);
    for (const p of this.fx) p.el.remove();
    this.fx = [];
    if (this.vbTw) { this.vb = this.vbTw.to as any; this.vbTw = null; }
    this.frame(performance.now(), true);
  }
  /** Apply commands instantly (for seeking). */
  applyInstant(cmds: Cmd[]) { for (const c of cmds) this.apply(c, -1); this.finish(); }
  get busy() { return this.queue.length > 0 || this.fx.length > 0 || [...this.objs.values()].some((o) => o.pos || o.sTw || o.oTw || o.drawTw || o.dying); }

  // ------------------------------------------------------------ state for seeking
  dump(): PlayerState {
    this.finish();
    return { prims: [...this.objs.values()].map((o) => ({ id: o.id, prim: JSON.parse(JSON.stringify(o.prim)) })), spot: this.spot ? [...this.spot] : null, camera: this.camBox };
  }
  load(st: PlayerState | null) {
    this.queue = [];
    for (const o of this.objs.values()) o.g.remove();
    this.objs.clear();
    for (const p of this.fx) p.el.remove();
    this.fx = [];
    for (const { id, prim } of st?.prims ?? []) this.create(id, prim, "none", 0, undefined, -1);
    this.spot = st?.spot ? new Set(st.spot) : null;
    this.camBox = st?.camera ?? null;
    this.vbTw = null;
    this.vb = this.camBox ?? this.fitBox() ?? this.vb;
    this.applySpot();
    this.frame(performance.now(), true);
  }
  clear() { this.load(null); }

  // ------------------------------------------------------------ commands
  private apply(c: Cmd, startAt: number) {
    const now = startAt < 0 ? -1 : startAt; // -1 = instant
    switch (c.op) {
      case "create": this.create(c.id, c.prim, c.anim, c.dur, c.from, now); break;
      case "move": {
        const o = this.objs.get(c.id); if (!o) break;
        o.prim.x = c.x; o.prim.y = c.y;
        if (now < 0) { o.pos = undefined; o.x = c.x; o.y = c.y; }
        else { const p = this.posNow(o, now); o.pos = { fx: p.x, fy: p.y, tx: c.x, ty: c.y, t0: now, dur: c.dur, arc: c.arc ?? 0, ease: easeInOut }; }
        this.wantFit();
        break;
      }
      case "update": {
        const o = this.objs.get(c.id); if (!o) break;
        Object.assign(o.prim, c.props);
        this.render(o);
        if (now >= 0 && c.effect === "pop") o.body.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 420, easing: "ease-out" });
        if (now >= 0 && c.effect === "flash") this.glow(o);
        if ("w" in c.props || "h" in c.props) this.wantFit();
        break;
      }
      case "remove": {
        const o = this.objs.get(c.id); if (!o) break;
        if (now < 0) { this.drop(o); break; }
        o.dying = now + c.dur;
        o.oTw = { from: o.o, to: 0, t0: now, dur: c.dur, ease: easeOut };
        if (c.anim === "shrink") o.sTw = { from: o.s, to: 0.3, t0: now, dur: c.dur, ease: easeOut };
        if (c.anim === "up") { const p = this.posNow(o, now); o.pos = { fx: p.x, fy: p.y, tx: p.x, ty: p.y - 46, t0: now, dur: c.dur, arc: 0, ease: easeOut }; }
        this.wantFit();
        break;
      }
      case "flash": { const o = this.objs.get(c.id); if (o && now >= 0) this.glow(o); break; }
      case "spotlight": this.spot = c.ids ? new Set(c.ids) : null; this.applySpot(); break;
      case "camera": this.camBox = c.box; if (c.box) this.camTo(c.box, now < 0 ? 0 : c.dur, now); else this.wantFit(true); break;
      case "packet": if (now >= 0) this.packet(c.from, c.to, c.dur, c.text, now); break;
    }
  }

  private create(id: string, prim: Prim, anim: string, dur: number, from: { x: number; y: number } | undefined, now: number) {
    this.objs.get(id)?.g.remove();
    const layer = prim.kind === "arrow" ? this.layers.edges : this.layers[prim.layer === "back" ? "back" : "front"];
    const g = svgEl("g", { "data-oid": id }, layer);
    const mid = svgEl("g", {}, g);
    const body = svgEl("g", { class: "body" }, mid);
    const o: Obj = { id, prim: JSON.parse(JSON.stringify(prim)), g, mid, body, x: prim.x, y: prim.y, s: 1, o: 1 };
    this.objs.set(id, o);
    this.render(o);
    if (now >= 0) {
      const ease = anim === "pop" ? easeOutBack : easeOut;
      if (anim === "pop") { o.s = 0.4; o.o = 0; o.sTw = { from: 0.4, to: 1, t0: now, dur, ease }; o.oTw = { from: 0, to: 1, t0: now, dur: dur * 0.6, ease: easeOut }; }
      else if (anim === "fade") { o.o = 0; o.oTw = { from: 0, to: 1, t0: now, dur, ease }; }
      else if (anim === "fly" && from) {
        o.x = from.x; o.y = from.y; o.s = 0.9;
        o.pos = { fx: from.x, fy: from.y, tx: prim.x, ty: prim.y, t0: now, dur, arc: -Math.min(90, Math.hypot(prim.x - from.x, prim.y - from.y) * 0.25), ease: easeInOut };
        o.sTw = { from: 0.9, to: 1, t0: now, dur, ease: easeOut };
      } else if (anim === "draw" && prim.kind === "arrow") {
        if ((prim as ArrowPrim).dashed) { o.o = 0; o.oTw = { from: 0, to: 1, t0: now, dur, ease }; }
        else o.drawTw = { from: 1, to: 0, t0: now, dur, ease: easeInOut };
      }
    }
    this.applySpot();
    this.wantFit();
  }

  private drop(o: Obj) { o.g.remove(); this.objs.delete(o.id); }

  // ------------------------------------------------------------ rendering one object
  private render(o: Obj) {
    const p = o.prim;
    const cls = ["item", p.kind === "arrow" ? "edge" : p.kind === "math" ? "mathobj" : (p as ShapePrim).shape ? "shape" : "txt"];
    if ((p as any).cls) cls.push(...String((p as any).cls).split(/\s+/));
    if (p.color && COLORS.has(p.color)) cls.push(`col-${p.color === "grey" ? "gray" : p.color}`);
    if (p.label && p.kind !== "arrow") cls.push("clickable");
    o.g.setAttribute("class", cls.join(" "));
    markClass(o.g, (p as any).mark);
    o.g.classList.toggle("hl", !!(p as any).highlight);
    if (p.kind === "shape") this.renderShape(o, p);
    else if (p.kind === "math") this.renderMath(o, p);
    else this.renderArrow(o, p);
  }
  private renderShape(o: Obj, p: ShapePrim) {
    let sk = o.body.querySelector<SVGGElement>(":scope > g.sk");
    if (p.shape) {
      if (!sk) sk = svgEl("g", { class: "sk" }, o.body);
      o.body.prepend(sk);
      sketch(sk, p.shape, o.id, { hatch: p.hatch !== false });
    } else sk?.remove();
    const key = JSON.stringify(p.texts);
    if (o.body.dataset.texts === key) return;
    o.body.dataset.texts = key;
    o.body.querySelectorAll(":scope > text").forEach((t) => t.remove());
    for (const t of p.texts) {
      const el = svgEl("text", { x: t.dx ?? 0, y: t.dy ?? 0, class: t.cls ?? "label", "text-anchor": t.anchor ?? "middle", "dominant-baseline": "central" }, o.body);
      el.textContent = t.text;
    }
  }
  private renderMath(o: Obj, p: MathPrim) {
    if (o.body.dataset.tex === p.tex + p.size) return;
    o.body.dataset.tex = p.tex + p.size;
    o.body.textContent = "";
    const W = 900, H = Math.max(60, p.h + 20);
    const fo = svgEl("foreignObject", { x: -W / 2, y: -H / 2, width: W, height: H, "data-tex": p.tex }, o.body);
    const div = document.createElement("div");
    div.className = "anim-math";
    div.style.fontSize = `${p.size * 16}px`;
    div.style.height = `${H}px`;
    try { katex.render(p.tex, div, { throwOnError: false, displayMode: false }); } catch { div.textContent = p.tex; }
    fo.appendChild(div);
    // measure the real width once it's in the page, for click targets and fitting
    requestAnimationFrame(() => { const k = div.firstElementChild as HTMLElement | null; if (k?.offsetWidth) { p.w = k.offsetWidth; p.h = Math.max(p.h, k.offsetHeight); } });
  }
  private renderArrow(o: Obj, p: ArrowPrim) {
    if (!o.path) {
      svgEl("path", { class: "hit" }, o.body);
      o.path = svgEl("path", { class: "line", filter: `url(#${this.prefix}-wob)` }, o.body);
    }
    const head = p.head ?? "end";
    const marker = `url(#${this.prefix}-arrow${p.highlight ? "-hl" : ""})`;
    if (head === "none") { o.path.removeAttribute("marker-end"); o.path.removeAttribute("marker-start"); }
    else { o.path.setAttribute("marker-end", marker); if (head === "both") o.path.setAttribute("marker-start", marker); else o.path.removeAttribute("marker-start"); }
    o.path.classList.toggle("dashed", !!p.dashed);
    if (p.text) {
      if (!o.label) o.label = svgEl("text", { class: "edge-label", "text-anchor": "middle", "dominant-baseline": "central" }, o.body);
      o.label.textContent = p.text;
    } else { o.label?.remove(); o.label = undefined; }
  }

  // ------------------------------------------------------------ the loop
  private kick() { if (!this.raf) this.raf = requestAnimationFrame((t) => this.tick(t)); }
  private tick(now: number) {
    this.raf = 0;
    const elapsed = now - this.beatStart;
    while (this.queue.length && this.queue[0].t <= elapsed) { const c = this.queue.shift()!; this.apply(c, this.beatStart + c.t); }
    this.frame(now, false);
    if (this.busy || this.vbTw || this.fitDue) this.kick();
  }

  private posNow(o: Obj, now: number) {
    const p = o.pos;
    if (!p) return { x: o.x, y: o.y };
    const t = Math.max(0, Math.min(1, (now - p.t0) / p.dur)), e = p.ease(t);
    let x = p.fx + (p.tx - p.fx) * e, y = p.fy + (p.ty - p.fy) * e;
    if (p.arc) {
      // bow sideways from the straight line, peaking halfway
      const dx = p.tx - p.fx, dy = p.ty - p.fy, len = Math.hypot(dx, dy) || 1;
      // sideways = perpendicular to the travel direction, always measured left-to-right,
      // so two things swapping with opposite arcs pass on opposite sides
      const k = 4 * e * (1 - e) * p.arc * (dx >= 0 ? 1 : -1);
      x += (-dy / len) * k;
      y += (dx / len) * k;
    }
    return { x, y };
  }

  /** Snap an object to the end of its tweens. */
  private settle(o: Obj, now: number) {
    if (o.dying !== undefined && o.dying <= now) { this.drop(o); return; }
    if (o.pos) { o.x = o.pos.tx; o.y = o.pos.ty; o.pos = undefined; }
    if (o.sTw) { o.s = o.sTw.to; o.sTw = undefined; }
    if (o.oTw) { o.o = o.oTw.to; o.oTw = undefined; }
    if (o.drawTw) { o.drawTw = undefined; o.path?.removeAttribute("pathLength"); if (o.path) o.path.style.strokeDasharray = o.path.style.strokeDashoffset = o.path.style.markerEnd = o.path.style.markerStart = ""; }
  }

  private frame(now: number, instant: boolean) {
    for (const o of [...this.objs.values()]) {
      if (o.dying !== undefined && now >= o.dying) { this.drop(o); continue; }
      if (o.pos) { const p = this.posNow(o, now); o.x = p.x; o.y = p.y; if (now >= o.pos.t0 + o.pos.dur) { o.x = o.pos.tx; o.y = o.pos.ty; o.pos = undefined; } }
      if (o.sTw) { o.s = val(o.sTw, now, o.s); if (now >= o.sTw.t0 + o.sTw.dur) { o.s = o.sTw.to; o.sTw = undefined; } }
      if (o.oTw) { o.o = val(o.oTw, now, o.o); if (now >= o.oTw.t0 + o.oTw.dur) { o.o = o.oTw.to; o.oTw = undefined; } }
      if (o.prim.kind !== "arrow") {
        o.g.setAttribute("transform", `translate(${o.x.toFixed(2)} ${o.y.toFixed(2)})`);
        o.mid.setAttribute("transform", o.s === 1 ? "" : `scale(${o.s.toFixed(3)})`);
      }
      o.mid.setAttribute("opacity", o.o >= 0.999 ? "1" : o.o.toFixed(3));
    }
    for (const o of this.objs.values()) if (o.prim.kind === "arrow") this.layoutArrow(o, now);
    // packets
    this.fx = this.fx.filter((p) => {
      const t = Math.max(0, Math.min(1, (now - p.t0) / p.dur)), e = easeInOut(t);
      p.el.setAttribute("transform", `translate(${p.fx + (p.tx - p.fx) * e} ${p.fy + (p.ty - p.fy) * e - Math.sin(Math.PI * e) * 30})`);
      p.el.setAttribute("opacity", String(t < 0.1 ? t / 0.1 : t > 0.9 ? (1 - t) / 0.1 : 1));
      if (t >= 1) { p.el.remove(); return false; }
      return true;
    });
    // camera
    if (this.fitDue && (instant || now >= this.fitDue)) { this.fitDue = 0; this.autoFit(instant ? -1 : now); }
    if (this.vbTw) {
      const t = Math.min(1, (now - this.vbTw.t0) / this.vbTw.dur), e = easeInOut(Math.max(0, t));
      this.vb = this.vbTw.from.map((v, i) => v + (this.vbTw!.to[i] - v) * e) as any;
      if (t >= 1) this.vbTw = null;
    }
    this.svg.setAttribute("viewBox", this.vb.map((v) => v.toFixed(1)).join(" "));
  }

  private endPoint(e: Endpoint, toward: { x: number; y: number }, gap = 5) {
    if (!("id" in e)) return { x: e.x, y: e.y };
    const o = this.objs.get(e.id);
    if (!o) return null;
    const p = o.prim, c = { x: o.x, y: o.y };
    const dx = toward.x - c.x, dy = toward.y - c.y;
    if (!dx && !dy) return c;
    const shape = p.kind === "shape" ? p.shape : null;
    const hw = (p.w / 2) * o.s + gap, hh = (p.h / 2) * o.s + gap;
    if (shape?.type === "circle") { const len = Math.hypot(dx, dy); return { x: c.x + (dx / len) * hw, y: c.y + (dy / len) * hh }; }
    if (shape?.type === "diamond") { const k = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh); return { x: c.x + dx * k, y: c.y + dy * k }; }
    const k = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
    return { x: c.x + dx * k, y: c.y + dy * k };
  }
  private center(e: Endpoint) { if (!("id" in e)) return e; const o = this.objs.get(e.id); return o ? { x: o.x, y: o.y } : null; }

  private layoutArrow(o: Obj, now: number) {
    const p = o.prim as ArrowPrim;
    const ca = this.center(p.from), cb = this.center(p.to);
    if (!ca || !cb || !o.path) { o.g.setAttribute("visibility", "hidden"); return; }
    o.g.removeAttribute("visibility");
    const bend = p.bend ?? 0;
    const mx = (ca.x + cb.x) / 2, my = (ca.y + cb.y) / 2, len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    const ctrl = { x: mx + (-(cb.y - ca.y) / len) * bend * 2, y: my + ((cb.x - ca.x) / len) * bend * 2 };
    const a = this.endPoint(p.from, bend ? ctrl : cb), b = this.endPoint(p.to, bend ? ctrl : ca, p.head === "none" ? 0 : 5);
    if (!a || !b) return;
    const d = bend ? `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${ctrl.x.toFixed(1)} ${ctrl.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}` : `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    if (o.path.getAttribute("d") !== d) { o.path.setAttribute("d", d); (o.body.firstElementChild as SVGPathElement).setAttribute("d", d); }
    if (o.drawTw) {
      const v = val(o.drawTw, now, 0);
      o.path.setAttribute("pathLength", "1");
      o.path.style.strokeDasharray = "1 1";
      o.path.style.strokeDashoffset = String(v);
      o.path.style.markerEnd = o.path.style.markerStart = v > 0.03 ? "none" : ""; // the head appears when the line arrives
      if (now >= o.drawTw.t0 + o.drawTw.dur) { o.drawTw = undefined; o.path.removeAttribute("pathLength"); o.path.style.strokeDasharray = o.path.style.strokeDashoffset = o.path.style.markerEnd = o.path.style.markerStart = ""; }
    }
    if (o.label) {
      const lx = bend ? 0.25 * a.x + 0.5 * ctrl.x + 0.25 * b.x : (a.x + b.x) / 2, ly = bend ? 0.25 * a.y + 0.5 * ctrl.y + 0.25 * b.y : (a.y + b.y) / 2;
      o.label.setAttribute("x", lx.toFixed(1)); o.label.setAttribute("y", (ly - (bend ? 0 : 10)).toFixed(1));
    }
  }

  // ------------------------------------------------------------ effects
  private glow(o: Obj) {
    o.body.animate([{ filter: "drop-shadow(0 0 0 rgba(79,70,229,0))" }, { filter: "drop-shadow(0 0 12px rgba(79,70,229,.95))", transform: "scale(1.08)" }, { filter: "drop-shadow(0 0 0 rgba(79,70,229,0))" }],
      { duration: 650, easing: "ease-out" });
  }
  private packet(from: { x: number; y: number }, to: { x: number; y: number }, dur: number, text: string | undefined, now: number) {
    const el = svgEl("g", { class: "packet" }, this.layers.fx);
    svgEl("circle", { r: 9 }, el);
    if (text) { const t = svgEl("text", { y: -18, "text-anchor": "middle", class: "packet-label" }, el); t.textContent = text; }
    this.fx.push({ el, fx: from.x, fy: from.y, tx: to.x, ty: to.y, t0: now, dur });
  }
  private applySpot() {
    const on = this.spot;
    this.svg.classList.toggle("focus", !!on);
    for (const o of this.objs.values()) {
      let lit = !on || on.has(o.id);
      if (on && !lit && o.prim.kind === "arrow") {
        const p = o.prim as ArrowPrim;
        const ends = [p.from, p.to].map((e) => ("id" in e ? e.id : null));
        lit = ends.every((e) => e === null || on.has(e));
      }
      o.g.classList.toggle("dim", !lit);
    }
  }

  // ------------------------------------------------------------ camera
  private wantFit(now = false) {
    if (this.camBox) return;
    if (now) this.fitDue = performance.now();
    else if (!this.fitDue) this.fitDue = performance.now() + 120;
    this.kick();
  }
  /** Bounding box of everything (where it's heading, not where it is mid-animation). */
  private fitBox(): [number, number, number, number] | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of this.objs.values()) {
      if (o.dying !== undefined || o.prim.kind === "arrow") continue;
      const p = o.prim;
      x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2);
      y0 = Math.min(y0, p.y - p.h / 2); y1 = Math.max(y1, p.y + p.h / 2);
    }
    for (const o of this.objs.values()) {
      const p = o.prim;
      if (p.kind !== "arrow" || o.dying !== undefined) continue;
      for (const e of [p.from, p.to]) if (!("id" in e)) { x0 = Math.min(x0, e.x); x1 = Math.max(x1, e.x); y0 = Math.min(y0, e.y); y1 = Math.max(y1, e.y); }
    }
    if (!isFinite(x0)) return null;
    const pad = 46;
    let w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    w = Math.max(w, 520); h = Math.max(h, 320);
    // match the screen's shape so nothing ends up tiny in one direction
    const r = this.svg.clientWidth && this.svg.clientHeight ? this.svg.clientWidth / this.svg.clientHeight : 1.6;
    if (w / h < r) w = h * r; else h = w / r;
    return [cx - w / 2, cy - h / 2, w, h];
  }
  private autoFit(now: number) {
    if (this.camBox) return;
    const b = this.fitBox();
    if (!b) return;
    const [x, y, w, h] = this.vbTw ? (this.vbTw.to as any) : this.vb;
    const contains = b[0] >= x - 1 && b[1] >= y - 1 && b[0] + b[2] <= x + w + 1 && b[1] + b[3] <= y + h + 1;
    const offCentre = Math.abs(b[0] + b[2] / 2 - (x + w / 2)) > w * 0.06 || Math.abs(b[1] + b[3] / 2 - (y + h / 2)) > h * 0.06;
    if (contains && !offCentre && b[2] * b[3] > w * h * 0.8) return; // close enough: don't drift around
    this.camTo(b, now < 0 ? 0 : 700, now);
  }
  private camTo(box: [number, number, number, number], dur: number, now: number) {
    // keep the screen's aspect ratio around the requested box
    const r = this.svg.clientWidth && this.svg.clientHeight ? this.svg.clientWidth / this.svg.clientHeight : 1.6;
    let [x, y, w, h] = box;
    if (w / h < r) { const nw = h * r; x -= (nw - w) / 2; w = nw; } else { const nh = w / r; y -= (nh - h) / 2; h = nh; }
    const to = [x, y, w, h];
    if (dur <= 0 || now < 0) { this.vb = to as any; this.vbTw = null; return; }
    this.vbTw = { from: [...this.vb], to, t0: now, dur };
    this.kick();
  }
  /** Re-fit after the panel is resized. */
  refit() { if (this.camBox) this.camTo(this.camBox, 0, -1); else { const b = this.fitBox(); if (b) this.camTo(b, 0, -1); } this.frame(performance.now(), true); }

  /** Objects' screen boxes, for highlighting by id from outside. */
  element(id: string) { return this.objs.get(id)?.g ?? null; }
  highlightIds(ids: string[]) { this.spot = ids.length ? new Set(ids) : null; this.applySpot(); }
}
