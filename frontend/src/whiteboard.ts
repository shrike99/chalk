/**
 * Whiteboard: draw on a blank page, or on top of Claude's current visual, and send the
 * drawing to Claude as an image with your next message (typed or spoken).
 */

interface Stroke { color: string; width: number; erase: boolean; pts: [number, number][] }

export class Whiteboard {
  private wrap: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private color = "#1D1D1F";
  private width = 3;
  private erase = false;
  mode: "blank" | "visual" = "visual";
  private lastRect: DOMRect | null = null; // canvas size/position while it was visible (it's 0×0 once hidden)
  onChange: () => void = () => {};

  constructor(private host: HTMLElement, private stage: HTMLElement) {
    this.wrap = host;
    this.canvas = host.querySelector("canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(host);

    this.canvas.addEventListener("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.current = { color: this.color, width: this.erase ? 22 : this.width, erase: this.erase, pts: [this.pt(e)] };
      this.strokes.push(this.current);
      this.redraw();
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.current) return;
      for (const ce of e.getCoalescedEvents?.() ?? [e]) this.current.pts.push(this.pt(ce));
      this.redraw();
    });
    const end = () => { if (this.current) { this.current = null; this.onChange(); } };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);

    // toolbar
    host.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((b) => b.onclick = () => {
      this.color = b.dataset.color!; this.erase = false; this.syncTools();
    });
    host.querySelectorAll<HTMLButtonElement>("[data-size]").forEach((b) => b.onclick = () => {
      this.width = Number(b.dataset.size); this.erase = false; this.syncTools();
    });
    host.querySelector<HTMLButtonElement>("[data-tool=eraser]")!.onclick = () => { this.erase = true; this.syncTools(); };
    host.querySelector<HTMLButtonElement>("[data-tool=undo]")!.onclick = () => { this.strokes.pop(); this.redraw(); this.onChange(); };
    host.querySelector<HTMLButtonElement>("[data-tool=clear]")!.onclick = () => this.clear();
    host.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.onclick = () => this.setMode(b.dataset.mode as "blank" | "visual"));
    this.syncTools();
  }

  get isOpen() { return !this.wrap.hidden; }
  get hasInk() { return this.strokes.some((s) => !s.erase); }

  open(mode?: "blank" | "visual") {
    if (mode) this.mode = mode;
    this.wrap.hidden = false;
    this.setMode(this.mode);
    this.resize();
  }
  close() { this.wrap.hidden = true; this.onChange(); }
  clear() { this.strokes = []; this.redraw(); this.onChange(); }

  setMode(m: "blank" | "visual") {
    this.mode = m;
    this.wrap.dataset.mode = m;
    this.wrap.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.classList.toggle("selected", b.dataset.mode === m));
  }

  private syncTools() {
    this.wrap.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((b) => b.classList.toggle("selected", !this.erase && b.dataset.color === this.color));
    this.wrap.querySelectorAll<HTMLButtonElement>("[data-size]").forEach((b) => b.classList.toggle("selected", !this.erase && Number(b.dataset.size) === this.width));
    this.wrap.querySelector("[data-tool=eraser]")!.classList.toggle("selected", this.erase);
    this.canvas.style.cursor = this.erase ? "cell" : "crosshair";
  }

  private rect(): DOMRect | null {
    const r = this.canvas.getBoundingClientRect();
    if (r.width && r.height) this.lastRect = r;
    return this.lastRect;
  }

  private pt(e: PointerEvent): [number, number] {
    const r = this.rect()!;
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    this.lastRect = r;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  private paint(ctx: CanvasRenderingContext2D, strokes: Stroke[], ox = 0, oy = 0) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes) {
      ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.beginPath();
      const p = s.pts.map(([x, y]) => [x + ox, y + oy]);
      ctx.moveTo(p[0][0], p[0][1]);
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.1, p[0][1]);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my); // smooth curves through the points
      }
      if (p.length > 1) ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private redraw() {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, width, height);
    this.paint(this.ctx, this.strokes);
  }

  /**
   * The drawing as an image (data URL). In "visual" mode the current visual is painted
   * underneath, so Claude sees what you drew on. Scaled to at most 1200px wide.
   */
  /** The first pen follows the theme: graphite on paper, chalk white on slate. */
  setThemeInk(dark: boolean) {
    const b = this.wrap.querySelector<HTMLButtonElement>("[data-color]");
    if (!b) return;
    const was = b.dataset.color!, now = dark ? "#F2F1EE" : "#1D1D1F";
    b.dataset.color = now; b.style.setProperty("--c", now); b.title = dark ? "Chalk white" : "Graphite";
    for (const st of this.strokes) if (st.color === was) st.color = now;
    if (this.color === was) this.color = now;
    this.syncTools(); this.redraw();
  }

  async exportImage(): Promise<string | null> {
    if (!this.hasInk) return null;
    const r = this.rect();
    if (!r) return null;
    const scale = Math.min(1, 1200 / r.width);
    const out = document.createElement("canvas");
    out.width = Math.round(r.width * scale);
    out.height = Math.round(r.height * scale);
    const ctx = out.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff";
    ctx.fillRect(0, 0, r.width, r.height);
    if (this.mode === "visual") {
      try { await this.paintVisual(ctx, r); } catch (e) { console.warn("Couldn't capture the visual under the drawing", e); }
    }
    // strokes go on their own layer so the eraser only removes ink, not the visual
    const ink = document.createElement("canvas");
    ink.width = Math.max(1, Math.round(r.width)); ink.height = Math.max(1, Math.round(r.height));
    this.paint(ink.getContext("2d")!, this.strokes);
    ctx.drawImage(ink, 0, 0);
    return out.toDataURL(this.mode === "visual" ? "image/jpeg" : "image/png", 0.9);
  }

  /** Rasterise the visual (every panel of a board) with the page's styles inlined, where it sits on screen. */
  private async paintVisual(ctx: CanvasRenderingContext2D, canvasRect: DOMRect) {
    // panel frames and titles first, so a board reads as separate panels
    for (const panel of Array.from(this.stage.querySelectorAll<HTMLElement>(".panel"))) {
      const r = panel.getBoundingClientRect();
      ctx.strokeStyle = "#d6d3cd"; ctx.lineWidth = 1;
      ctx.strokeRect(r.left - canvasRect.left, r.top - canvasRect.top, r.width, r.height);
      const t = panel.querySelector(".panel-title")?.textContent;
      if (t) { ctx.fillStyle = "#8E8C88"; ctx.font = "600 12px sans-serif"; ctx.fillText(t.toUpperCase(), r.left - canvasRect.left + 10, r.top - canvasRect.top + 16); }
    }
    for (const svg of Array.from(this.stage.querySelectorAll<SVGSVGElement>("svg.vis-svg, .mermaid-wrap > svg"))) {
      try { await this.paintSvg(ctx, canvasRect, svg); } catch (e) { console.warn("Skipped one panel in the snapshot", e); }
    }
  }

  private async paintSvg(ctx: CanvasRenderingContext2D, canvasRect: DOMRect, svg: SVGSVGElement) {
    const sr = svg.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(sr.width));
    clone.setAttribute("height", String(sr.height));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    // HTML inside SVG (typeset maths) would taint the canvas: draw its source as plain text instead
    for (const fo of Array.from(clone.querySelectorAll("foreignObject"))) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("text-anchor", "middle"); t.setAttribute("dominant-baseline", "central");
      t.setAttribute("style", "font: 18px serif; fill: #1f1f1f");
      t.textContent = fo.getAttribute("data-tex") ?? "";
      fo.replaceWith(t);
    }
    let css = "";
    for (const sheet of Array.from(document.styleSheets)) {
      try { css += Array.from(sheet.cssRules).map((r) => r.cssText).join("\n"); } catch { /* cross-origin sheet */ }
    }
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = css + "\n.item, .inner { animation: none !important; } .focus .item.dim, .dim { opacity: 0.75 !important; }";
    clone.insertBefore(style, clone.firstChild);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("svg load failed")); img.src = url; });
      ctx.drawImage(img, sr.left - canvasRect.left, sr.top - canvasRect.top, sr.width, sr.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
