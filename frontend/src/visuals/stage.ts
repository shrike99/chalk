/**
 * The stage: shows one visual at a time, switches renderer when the kind changes,
 * and plays walkthrough frames (one per spoken beat).
 */
import { applyOp, normalize, type BoardState, type Op, type VisualState } from "./state";
import type { RenderContext, Renderer } from "./common";
import { GraphRenderer } from "./graph";
import { SequenceRenderer } from "./sequence";
import { ArrayRenderer } from "./array";
import { GridRenderer } from "./grid";
import { PlotRenderer } from "./plot";
import { MathRenderer } from "./math";
import { MermaidRenderer } from "./mermaidView";
import { SceneRenderer, type Layout } from "./scene";
import type { SceneKind } from "./generic";
import { bitsLayout, codeLayout, hashTableLayout, linkedListLayout, memoryLayout, treeLayout } from "./kinds_ds";
import { barLayout, fractionLayout, lineLayout, numberLineLayout, pieLayout, quadrantLayout, timelineLayout } from "./kinds_charts";
import { compareLayout, cycleLayout, geometryLayout, layersLayout, mindmapLayout, pyramidLayout, stepsLayout, vennLayout } from "./kinds_concepts";

export interface BeatSpec { text: string; highlight: (string | number)[]; do?: Op[] }
export interface Frame { state: VisualState; highlight: string[] }
export interface NodeAction { label: string; prompt: (name: string, id: string, kind: string) => string }

type Factory = (host: HTMLElement, ctx: RenderContext) => Renderer;
const LAYOUTS: Record<SceneKind, Layout> = {
  tree: treeLayout, linkedlist: linkedListLayout, hashtable: hashTableLayout, memory: memoryLayout, code: codeLayout, bits: bitsLayout,
  bar: barLayout, line: lineLayout, pie: pieLayout, numberline: numberLineLayout, timeline: timelineLayout, quadrant: quadrantLayout, fraction: fractionLayout,
  venn: vennLayout, mindmap: mindmapLayout, cycle: cycleLayout, layers: layersLayout, pyramid: pyramidLayout, compare: compareLayout, steps: stepsLayout, geometry: geometryLayout,
};
const RENDERERS: Record<string, Factory> = {
  graph: (h, c) => new GraphRenderer(h, c), sequence: (h, c) => new SequenceRenderer(h, c), array: (h, c) => new ArrayRenderer(h, c),
  grid: (h, c) => new GridRenderer(h, c), plot: (h, c) => new PlotRenderer(h, c), math: (h, c) => new MathRenderer(h, c),
  mermaid: (h, c) => new MermaidRenderer(h, c),
  board: (h, c) => new BoardRenderer(h, c),
  ...Object.fromEntries(Object.entries(LAYOUTS).map(([k, layout]) => [k, ((h, c) => new SceneRenderer(h, c, k as SceneKind, layout)) as Factory])),
};

/**
 * A board: one panel per visual, laid out in a grid. Each panel has its own renderer;
 * highlights are routed by prefix ("code:L4" -> panel "code", item "L4"), and panels with
 * nothing spotlit fade back while others are being talked about.
 */
class BoardRenderer implements Renderer {
  readonly kind = "board" as const;
  private wrap: HTMLDivElement;
  private panels = new Map<string, { el: HTMLDivElement; host: HTMLDivElement; title: HTMLDivElement; renderer: Renderer | null }>();

  constructor(host: HTMLElement, private ctx: RenderContext) {
    this.wrap = document.createElement("div");
    this.wrap.className = "board";
    host.appendChild(this.wrap);
  }

  private split(pid: string, ids: string[]): string[] {
    const out: string[] = [];
    for (const raw of ids.map(String)) {
      if (raw.startsWith(pid + ":")) out.push(raw.slice(pid.length + 1));
      else if (![...this.panels.keys()].some((k) => raw.startsWith(k + ":"))) out.push(raw); // un-prefixed: try every panel
    }
    return out;
  }

  async draw(state: VisualState, highlight: string[], animate: boolean) {
    const s = state as BoardState;
    this.wrap.dataset.layout = s.layout;
    this.wrap.dataset.n = String(s.panels.length);
    const keep = new Set(s.panels.map((p) => p.id));
    for (const [id, p] of this.panels) if (!keep.has(id)) { p.renderer?.destroy(); p.el.remove(); this.panels.delete(id); }
    const draws: (Promise<void> | void)[] = [];
    s.panels.forEach((p, i) => {
      let slot = this.panels.get(p.id);
      if (!slot) {
        const el = document.createElement("div");
        el.className = "panel";
        el.innerHTML = `<div class="panel-title"></div><div class="panel-host"></div>`;
        slot = { el, host: el.querySelector(".panel-host")!, title: el.querySelector(".panel-title")!, renderer: null };
        this.panels.set(p.id, slot);
        if (animate) el.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: "ease-out" });
      }
      this.wrap.appendChild(slot.el); // keeps panel order
      slot.el.style.setProperty("--i", String(i));
      slot.el.dataset.kind = p.state.kind;
      slot.title.textContent = p.title;
      if (!slot.renderer || slot.renderer.kind !== p.state.kind) {
        slot.renderer?.destroy();
        const pid = p.id, title = p.title;
        slot.renderer = RENDERERS[p.state.kind](slot.host, {
          onItemClick: (id, label, el) => this.ctx.onItemClick(`${pid}:${id}`, `${label} (in ${title})`, el),
        });
      }
      draws.push(slot.renderer.draw(p.state, this.split(p.id, highlight), animate));
    });
    await Promise.all(draws);
    this.focus(highlight);
  }

  highlight(ids: string[]) {
    for (const [pid, p] of this.panels) p.renderer?.highlight(this.split(pid, ids));
    this.focus(ids);
  }

  /** Fade panels that have nothing spotlit while another panel does. */
  private focus(ids: string[]) {
    const hits = new Map([...this.panels].map(([pid, p]) => [pid, !!p.el.querySelector("[data-hid].hl")]));
    const any = ids.length > 0 && [...hits.values()].some(Boolean);
    for (const [pid, p] of this.panels) p.el.classList.toggle("panel-dim", any && !hits.get(pid));
  }

  destroy() { for (const p of this.panels.values()) p.renderer?.destroy(); this.wrap.remove(); }
}

/** Build the frames for a reply: start from its new visual (or what's on screen) and apply each beat's ops. */
export function buildFrames(base: VisualState | null, visualSpec: unknown, beats: BeatSpec[]): { start: VisualState | null; frames: Frame[] } {
  const start = normalize(visualSpec) ?? base;
  const frames: Frame[] = [];
  let st = start;
  for (const b of beats) {
    if (st) for (const op of b.do ?? []) if (op && typeof op === "object") st = applyOp(st, op);
    frames.push({ state: st as VisualState, highlight: (b.highlight ?? []).map(String) });
  }
  return { start, frames };
}

export class Stage {
  private renderer: Renderer | null = null;
  private menu: HTMLDivElement;
  current: VisualState | null = null;
  actions: NodeAction[] = [];
  onAsk: (prompt: string) => void = () => {};

  constructor(private host: HTMLElement) {
    this.menu = document.createElement("div");
    this.menu.className = "node-menu";
    this.menu.hidden = true;
    document.body.appendChild(this.menu);
    document.addEventListener("pointerdown", (e) => { if (!this.menu.contains(e.target as Node)) this.menu.hidden = true; });
  }

  /** Draw a state (animating from whatever is on screen) with these items spotlit. */
  async show(state: VisualState | null, highlight: string[] = [], animate = true) {
    this.menu.hidden = true;
    if (!state) { this.clear(); return; }
    if (!this.renderer || this.renderer.kind !== state.kind) {
      const old = this.renderer;
      this.host.querySelector(".placeholder")?.remove();
      this.renderer = RENDERERS[state.kind](this.host, { onItemClick: (id, label, el) => this.openMenu(id, label, el) });
      if (old) old.destroy();
    }
    this.current = state;
    try {
      await this.renderer.draw(state, highlight, animate);
    } catch (e) {
      console.error("Visual failed to draw", e, state);
    }
  }

  highlight(ids: string[]) { this.renderer?.highlight(ids.map(String)); }

  clear() {
    this.renderer?.destroy();
    this.renderer = null;
    this.current = null;
    this.host.innerHTML = "";
  }

  /** The "ask about this" menu for a clicked item (also used by the animated stage). */
  openMenu(id: string, label: string, el: Element, kindOverride?: string) {
    const kind = kindOverride ?? this.current?.kind ?? "";
    const r = el.getBoundingClientRect();
    this.menu.innerHTML = `<div class="node-menu-title"></div>`;
    this.menu.querySelector(".node-menu-title")!.textContent = label;
    for (const a of this.actions) {
      const b = document.createElement("button");
      b.className = "ghost";
      b.textContent = a.label;
      b.onclick = () => { this.menu.hidden = true; this.onAsk(a.prompt(label, id, kind)); };
      this.menu.appendChild(b);
    }
    this.menu.hidden = false;
    const mw = this.menu.offsetWidth, mh = this.menu.offsetHeight;
    this.menu.style.left = `${Math.min(window.innerWidth - mw - 8, Math.max(8, r.left + r.width / 2 - mw / 2))}px`;
    this.menu.style.top = `${r.bottom + 8 + mh > window.innerHeight ? r.top - mh - 8 : r.bottom + 8}px`;
    if (!kindOverride) this.renderer?.highlight([id]);
  }
}
