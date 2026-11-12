/** Fallback: any Mermaid diagram (class, ER, timeline, gantt, pie…). Flowchart/state nodes can be highlighted. */
import mermaid from "mermaid";
import type { MermaidState, VisualState } from "./state";
import { type RenderContext, type Renderer, applyHighlight, drawIn, popIn } from "./common";

mermaid.initialize({ startOnLoad: false, theme: "neutral", look: "handDrawn", securityLevel: "strict" });
let renderCount = 0;

export class MermaidRenderer implements Renderer {
  readonly kind = "mermaid" as const;
  private wrap: HTMLDivElement;
  private source = "";
  private shown = new Set<string>();

  constructor(private host: HTMLElement, private ctx: RenderContext) {
    this.wrap = document.createElement("div");
    this.wrap.className = "vis-html mermaid-wrap";
    host.appendChild(this.wrap);
  }

  async draw(state: VisualState, highlight: string[], animate: boolean) {
    const s = state as MermaidState;
    if (s.source !== this.source) {
      this.source = s.source;
      try {
        const { svg } = await mermaid.render(`mmd-${++renderCount}`, s.source);
        this.wrap.innerHTML = svg;
      } catch (e) {
        this.wrap.innerHTML = "";
        const pre = document.createElement("pre");
        pre.className = "vis-error";
        pre.textContent = `Couldn't draw this diagram:\n${(e as Error).message}\n\n${s.source}`;
        this.wrap.appendChild(pre);
        return;
      }
      const root = this.wrap.querySelector("svg")!;
      const ids = this.index(root);
      if (animate) {
        let k = 0;
        for (const id of ids) {
          if (this.shown.has(id)) continue;
          const inner = root.querySelector(`[data-hid="${CSS.escape(id)}"] > .inner`);
          if (inner) popIn(inner, 80 + k++ * 140);
        }
        root.querySelectorAll<SVGPathElement>("[data-ends] path").forEach((p) => drawIn(p, 0, 500));
        if (!ids.length) root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500 });
      }
      this.shown = new Set(ids);
    }
    this.highlight(highlight);
  }

  highlight(ids: string[]) { applyHighlight(this.wrap, ids.map(String)); }

  private index(root: SVGSVGElement): string[] {
    const ids: string[] = [];
    root.querySelectorAll<SVGGElement>("g.node, g.rough-node").forEach((g) => {
      const id = g.id.match(/-(?:flowchart|state)-(.+)-\d+$/)?.[1] ?? g.getAttribute("data-id");
      if (!id) return;
      const inner = document.createElementNS("http://www.w3.org/2000/svg", "g");
      inner.setAttribute("class", "inner");
      while (g.firstChild) inner.appendChild(g.firstChild);
      g.appendChild(inner);
      g.classList.add("item");
      g.setAttribute("data-hid", id);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); this.ctx.onItemClick(id, (g.textContent ?? id).trim(), g); });
      ids.push(id);
    });
    const known = new Set(ids);
    root.querySelectorAll<SVGPathElement>("path[data-id^='L_']").forEach((p) => {
      const raw = p.getAttribute("data-id")!;
      const body = raw.slice(2, raw.lastIndexOf("_"));
      for (let i = body.indexOf("_"); i !== -1; i = body.indexOf("_", i + 1)) {
        const a = body.slice(0, i), b = body.slice(i + 1);
        if (known.has(a) && known.has(b)) {
          const wrap = document.createElementNS("http://www.w3.org/2000/svg", "g");
          wrap.setAttribute("class", "item edge");
          wrap.setAttribute("data-hid", `${a}->${b}`);
          wrap.setAttribute("data-ends", `${a} ${b}`);
          p.replaceWith(wrap);
          wrap.appendChild(p);
          break;
        }
      }
    });
    return ids;
  }

  destroy() { this.wrap.remove(); }
}
