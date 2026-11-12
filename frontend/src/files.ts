/**
 * Files you give Claude: PDFs (past papers, worksheets, notes) and images.
 *
 * They're uploaded as soon as you pick, drop or paste them (so a big PDF is ready by the time you've
 * typed), shown as chips above the composer, and sent with your next message.
 */
import { $, esc, fmtBytes, toast } from "./ctx";
import { icon } from "./icons";

export interface FileMeta { id: string; name: string; kind: "pdf" | "image"; pages: number; size: number; total_pages?: number }
type Pending = { key: number; name: string; size: number; status: "uploading" | "ready" | "error"; meta?: FileMeta; error?: string; done: Promise<void> };

const ACCEPT = /\.(pdf|png|jpe?g|webp|gif|bmp)$/i;
const MAX = 60 * 1024 * 1024;
let seq = 0;

export class FileTray {
  private items: Pending[] = [];
  onChange: () => void = () => {};
  onOpen: (m: FileMeta) => void = () => {};

  constructor(private host: HTMLElement) {
    host.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-remove], [data-open]");
      if (!b) return;
      const key = Number(b.dataset.remove ?? b.dataset.open);
      const it = this.items.find((x) => x.key === key);
      if (!it) return;
      if (b.dataset.remove !== undefined) {
        this.items = this.items.filter((x) => x !== it);
        if (it.meta) fetch(`/api/uploads/${it.meta.id}`, { method: "DELETE" }).catch(() => {});
        this.render();
      } else if (it.meta) this.onOpen(it.meta);
    });
  }

  get count() { return this.items.length; }
  get ready(): FileMeta[] { return this.items.filter((x) => x.status === "ready").map((x) => x.meta!); }
  get uploading() { return this.items.some((x) => x.status === "uploading"); }
  /** Wait for uploads still on their way (sending while a big PDF uploads just waits for it). */
  async settled() { await Promise.all(this.items.map((x) => x.done)); }

  add(files: FileList | File[]) {
    const list = Array.from(files);
    const bad = list.filter((f) => !ACCEPT.test(f.name) && !/^image\//.test(f.type) && f.type !== "application/pdf");
    if (bad.length) toast("Chalk reads PDFs and images", `${esc(bad.map((f) => f.name).join(", "))} ${bad.length === 1 ? "isn't" : "aren't"} one of those.`);
    for (const f of list) {
      if (bad.includes(f)) continue;
      if (f.size > MAX) { toast("That file is too big", `${esc(f.name)} is ${fmtBytes(f.size)}; the limit is 60 MB.`); continue; }
      if (this.items.length >= 10) { toast("That's plenty of files", "Send these first: up to 10 at a time."); break; }
      const it: Pending = { key: ++seq, name: f.name || "pasted image.png", size: f.size, status: "uploading", done: Promise.resolve() };
      it.done = this.upload(it, f);
      this.items.push(it);
    }
    this.render();
  }

  private async upload(it: Pending, f: File) {
    const body = new FormData();
    body.append("file", f, it.name);
    try {
      const r = await fetch("/api/uploads", { method: "POST", body });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.detail ?? `Upload failed (${r.status})`);
      it.meta = j as FileMeta;
      it.status = "ready";
    } catch (e) {
      it.status = "error";
      it.error = (e as Error).message;
      toast("Couldn't add that file", esc(it.error));
    }
    if (this.items.includes(it)) this.render();
  }

  /** Hand over the ready files for sending, and empty the tray. Failed ones are dropped. */
  take(): FileMeta[] {
    const out = this.ready;
    this.items = [];
    this.render();
    return out;
  }

  private render() {
    this.items = this.items.filter((x) => x.status !== "error");
    this.host.hidden = this.items.length === 0;
    this.host.innerHTML = this.items.map((it) => {
      const m = it.meta;
      const thumb = m ? `<img src="/api/uploads/${m.id}/thumb.png" alt="">` : `<span class="ft-spin" aria-hidden="true"></span>`;
      const sub = it.status === "uploading" ? "Reading…" : describe(m!);
      return `<div class="ft-chip${it.status === "uploading" ? " busy" : ""}">
        <button type="button" class="ft-open" data-open="${it.key}" ${m ? "" : "disabled"} title="${m ? "Preview" : "Uploading"}">
          <span class="ft-thumb">${thumb}</span>
          <span class="ft-text"><b>${esc(it.name)}</b><span>${esc(sub)}</span></span>
        </button>
        <button type="button" class="ft-x" data-remove="${it.key}" aria-label="Remove ${esc(it.name)}" title="Remove">${icon("x")}</button>
      </div>`;
    }).join("");
    this.onChange();
  }
}

export function describe(m: FileMeta): string {
  if (m.kind === "image") return `Image · ${fmtBytes(m.size)}`;
  const pages = `${m.pages} page${m.pages === 1 ? "" : "s"}`;
  return `PDF · ${pages}${m.total_pages ? ` (of ${m.total_pages})` : ""}`;
}

/** The files on one of your messages in the notebook. */
export function fileChips(files: FileMeta[], open: (m: FileMeta) => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "msg-files";
  for (const m of files) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ft-chip static";
    b.title = `Preview ${m.name}`;
    b.innerHTML = `<span class="ft-thumb"><img src="/api/uploads/${m.id}/thumb.png" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ft-gone',textContent:'Deleted'}))"></span>
      <span class="ft-text"><b>${esc(m.name)}</b><span>${esc(describe(m))}</span></span>`;
    b.onclick = () => open(m);
    row.appendChild(b);
  }
  return row;
}

/** Drag files anywhere onto the window to attach them. */
export function initDrop(target: HTMLElement, onFiles: (f: FileList) => void, enabled: () => boolean) {
  const zone = $("dropZone");
  let depth = 0;
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  target.addEventListener("dragenter", (e) => {
    if (!hasFiles(e) || !enabled()) return;
    e.preventDefault();
    depth++;
    zone.hidden = false;
  });
  target.addEventListener("dragover", (e) => { if (hasFiles(e) && enabled()) { e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; } });
  target.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) zone.hidden = true; });
  target.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    zone.hidden = true;
    if (enabled() && e.dataTransfer?.files.length) onFiles(e.dataTransfer.files);
  });
}
