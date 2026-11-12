/**
 * The command palette (Ctrl+K): search notes and run commands from one box.
 * Groups: Mode, Notes, Persona, Actions. ↑ ↓ move, Enter runs, Tab jumps to the next group, Esc closes.
 */
import { icon } from "./icons";

export interface PaletteItem {
  group: "Mode" | "Notes" | "Persona" | "Actions";
  label: string;          // plain text, matched against the query
  sub?: string;           // shown dimmed after the label (also matched)
  side?: string;          // right-aligned detail
  keys?: string[];        // keyboard shortcut
  icon: string;
  run: () => void;
}
type Source = (query: string) => PaletteItem[] | Promise<PaletteItem[]>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The text with the query's matches in bold. */
function mark(text: string, q: string) {
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return esc(text.slice(0, i)) + `<b>${esc(text.slice(i, i + q.length))}</b>` + esc(text.slice(i + q.length));
}
const ORDER = ["Mode", "Notes", "Persona", "Actions"];

export class Palette {
  private items: PaletteItem[] = [];
  private sel = 0;
  private seq = 0;
  private input!: HTMLInputElement;
  private list!: HTMLDivElement;
  private lastFocus: Element | null = null;
  onClose: () => void = () => {};

  constructor(private host: HTMLElement, private source: Source) {}

  get isOpen() { return !this.host.hidden; }

  open(initial = "") {
    this.lastFocus = document.activeElement;
    this.host.hidden = false;
    this.host.innerHTML = `
      <div class="palette-scrim">
        <div class="palette" role="dialog" aria-label="Command palette">
          <div class="pal-search">${icon("search")}
            <label for="palQ" class="sr-only">Search notes and commands</label>
            <input id="palQ" autocomplete="off" spellcheck="false" placeholder="Search notes and commands…" />
            <kbd>Esc</kbd>
          </div>
          <div class="pal-list" role="listbox"></div>
          <div class="pal-foot"><span>↑ ↓ to move</span><span>Enter to choose</span><span>Tab for the next group</span></div>
        </div>
      </div>`;
    this.input = this.host.querySelector("input")!;
    this.list = this.host.querySelector(".pal-list")!;
    this.input.value = initial;
    this.input.oninput = () => this.refresh();
    this.input.onkeydown = (e) => this.key(e);
    this.host.querySelector(".palette-scrim")!.addEventListener("pointerdown", (e) => { if (e.target === e.currentTarget) this.close(); });
    this.input.focus();
    this.refresh();
  }

  close() {
    if (!this.isOpen) return;
    this.host.hidden = true;
    this.host.innerHTML = "";
    (this.lastFocus as HTMLElement | null)?.focus?.();
    this.onClose();
  }

  private async refresh() {
    const q = this.input.value.trim();
    const seq = ++this.seq;
    const all = await this.source(q);
    if (seq !== this.seq || !this.isOpen) return;
    const ql = q.toLowerCase();
    this.items = all
      .filter((it) => !q || it.group === "Notes" || `${it.label} ${it.sub ?? ""}`.toLowerCase().includes(ql))
      .sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));
    this.sel = 0;
    this.render(q);
  }

  private render(q: string) {
    if (!this.items.length) { this.list.innerHTML = `<div class="pal-empty">Nothing matches “${esc(q)}”.</div>`; return; }
    let html = "", last = "";
    this.items.forEach((it, i) => {
      if (it.group !== last) { html += `<div class="pal-group">${it.group}</div>`; last = it.group; }
      html += `<button class="pal-item${i === this.sel ? " on" : ""}" data-i="${i}" role="option" aria-selected="${i === this.sel}">
        <span class="ic">${icon(it.icon)}</span>
        <span class="lbl">${mark(it.label, q)}${it.sub ? ` <span class="sub">· ${mark(it.sub, q)}</span>` : ""}</span>
        ${it.side ? `<span class="side">${esc(it.side)}</span>` : ""}
        ${it.keys ? `<span class="keys">${it.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</span>` : i === this.sel ? `<span class="keys"><kbd>Enter</kbd></span>` : ""}
      </button>`;
    });
    this.list.innerHTML = html;
    this.list.querySelectorAll<HTMLButtonElement>(".pal-item").forEach((b) => {
      b.onclick = () => this.choose(Number(b.dataset.i));
      b.onmousemove = () => { if (this.sel !== Number(b.dataset.i)) { this.sel = Number(b.dataset.i); this.render(q); } };
    });
    this.list.querySelector(".pal-item.on")?.scrollIntoView({ block: "nearest" });
  }

  private key(e: KeyboardEvent) {
    const q = this.input.value.trim();
    if (e.key === "Escape") { e.preventDefault(); this.close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); this.sel = Math.min(this.items.length - 1, this.sel + 1); this.render(q); }
    else if (e.key === "ArrowUp") { e.preventDefault(); this.sel = Math.max(0, this.sel - 1); this.render(q); }
    else if (e.key === "Tab") {
      e.preventDefault();
      const g = this.items[this.sel]?.group;
      const next = this.items.findIndex((it, i) => i > this.sel && it.group !== g);
      this.sel = next >= 0 ? next : 0;
      this.render(q);
    } else if (e.key === "Enter") { e.preventDefault(); this.choose(this.sel); }
  }

  private choose(i: number) {
    const it = this.items[i];
    if (!it) return;
    this.close();
    it.run();
  }
}
