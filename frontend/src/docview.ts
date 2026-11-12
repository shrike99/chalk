/**
 * The document viewer: Claude's practice papers, worksheets and revision notes as A4 pages.
 *
 * The pages come from /paper.html in an iframe, the same page the desktop app prints to PDF, so the
 * preview is the PDF. It opens over the notebook and canvas; the notes list stays put.
 */
import { $, api, esc, toast, type DocRef } from "./ctx";
import { desktop } from "./desktop";
import { icon } from "./icons";
import { describe, type FileMeta } from "./files";

let current: { ref: DocRef | UploadRef; part: "paper" | "scheme"; hasScheme: boolean; pages: number; page: number; zoom: number | "fit"; shownZoom: number } | null = null;
let onClose: () => void = () => {};
type UploadRef = { id: string; kind: "upload"; title: string; summary: string };
const isUpload = () => current?.ref.kind === "upload";

const frame = () => $<HTMLIFrameElement>("dvFrame");
const send = (msg: Record<string, unknown>) => frame().contentWindow?.postMessage({ source: "chalk-host", ...msg }, location.origin);
const theme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const src = (part: string) => isUpload()
  ? `/paper.html?upload=${encodeURIComponent(current!.ref.id)}&theme=${theme()}`
  : `/paper.html?doc=${encodeURIComponent(current!.ref.id)}&part=${part}&theme=${theme()}`;

export function initDocView(hooks: { onClose: () => void }) {
  onClose = hooks.onClose;
  const v = $("docView");
  v.innerHTML = `
    <div class="dv-bar">
      <button class="icon-btn" data-dv="close" aria-label="Back to the note" title="Back to the note (Esc)">${icon("back")}</button>
      <div class="dv-title"><b id="dvTitle"></b><span id="dvSub"></span></div>
      <div class="seg sm" role="group" aria-label="Show" id="dvPart">
        <button data-part="paper" class="on">Paper</button><button data-part="scheme">Mark scheme</button>
      </div>
      <div class="dv-zoom" role="group" aria-label="Zoom">
        <button class="icon-btn sm" data-dv="out" aria-label="Zoom out" title="Zoom out (Ctrl −)">${icon("minus")}</button>
        <button class="dv-zoomval" data-dv="fit" title="Fit to width (Ctrl 0)" id="dvZoom">100%</button>
        <button class="icon-btn sm" data-dv="in" aria-label="Zoom in" title="Zoom in (Ctrl +)">${icon("plus")}</button>
      </div>
      <span class="dv-page" id="dvPage"></span>
      <div class="dv-actions">
        <button class="btn secondary sm" data-dv="print" title="Print (Ctrl P)">${icon("printer")}Print</button>
        <button class="btn primary sm" data-dv="save" title="Save as PDF (Ctrl S)">${icon("download")}Save PDF</button>
      </div>
    </div>
    <div class="dv-stage"><iframe id="dvFrame" title="Document preview"></iframe><div class="dv-loading" id="dvLoading"><span class="dv-spin"></span>Laying out pages…</div></div>`;
  v.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-dv], [data-part]");
    if (!b || !current) return;
    if (b.dataset.part) return showPart(b.dataset.part as "paper" | "scheme");
    switch (b.dataset.dv) {
      case "close": return closeDoc();
      case "in": return setZoom(step(+1));
      case "out": return setZoom(step(-1));
      case "fit": return setZoom("fit");
      case "print": return send({ type: "print" });
      case "save": return savePdf();
    }
  });
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.data?.source !== "chalk-paper" || !current) return;
    const m = e.data;
    if (m.type === "ready") {
      current.pages = m.pages; current.page = 1; current.hasScheme = m.hasScheme;
      $("dvLoading").hidden = true;
      $("dvPart").hidden = isUpload() || !(current.ref.kind !== "notes" && (m.hasScheme || current.part === "scheme"));
      if (m.schemeLabel) $("dvPart").querySelector<HTMLElement>('[data-part="scheme"]')!.textContent = m.schemeLabel;
      renderPage();
      if (current.zoom !== "fit") send({ type: "zoom", value: current.zoom });
    } else if (m.type === "page") { current.page = m.page; renderPage(); }
    else if (m.type === "zoom") { current.shownZoom = m.zoom; $("dvZoom").textContent = `${m.zoom}%`; }
    else if (m.type === "key") handleKey(m.key, m.ctrl);
    else if (m.type === "error") { $("dvLoading").hidden = true; }
  });
}

export const docOpen = () => !!current && !$("docView").hidden;

export async function openDoc(ref: DocRef | string, part: "paper" | "scheme" = "paper") {
  if (typeof ref === "string") {
    try { const d = await api<{ id: string; kind: DocRef["kind"]; title: string; summary: string }>(`/api/docs/${ref}`); ref = { id: d.id, kind: d.kind, title: d.title, summary: d.summary }; }
    catch (e) { toast("Couldn't open that document", esc((e as Error).message)); return; }
  }
  current = { ref, part, hasScheme: false, pages: 0, page: 1, zoom: current?.zoom ?? "fit", shownZoom: 100 };
  $("dvTitle").textContent = ref.title;
  $("dvSub").textContent = ref.summary;
  $("dvPart").hidden = ref.kind === "notes";
  $("docView").querySelector<HTMLElement>('[data-dv="save"]')!.hidden = false;
  $("docView").hidden = false;
  $("mainView").classList.add("doc-open");
  $("docView").classList.toggle("notes-doc", ref.kind === "notes");
  showPart(part);
}

/** Your own files (what you gave Claude), page by page in the same viewer. */
export function openUpload(m: FileMeta) {
  current = { ref: { id: m.id, kind: "upload", title: m.name, summary: describe(m) }, part: "paper", hasScheme: false, pages: 0, page: 1, zoom: current?.zoom ?? "fit", shownZoom: 100 };
  $("dvTitle").textContent = m.name;
  $("dvSub").textContent = `${describe(m)} · you gave this to Claude`;
  $("dvPart").hidden = true;
  $("docView").querySelector<HTMLElement>('[data-dv="save"]')!.hidden = true;
  $("docView").hidden = false;
  $("mainView").classList.add("doc-open");
  $("docView").classList.remove("notes-doc");
  showPart("paper");
}

function showPart(part: "paper" | "scheme") {
  if (!current) return;
  current.part = part;
  $("dvPart").querySelectorAll<HTMLElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.part === part));
  $("dvLoading").hidden = false;
  $("dvPage").textContent = "";
  frame().src = src(part);
}

export function closeDoc() {
  if (!current) return;
  $("docView").hidden = true;
  $("mainView").classList.remove("doc-open");
  frame().src = "about:blank";
  current = null;
  onClose();
}

/** Keep the preview's desk in step with the app theme. */
export function docTheme() { if (current) send({ type: "theme", value: theme() }); }

const ZOOMS = [50, 67, 75, 90, 100, 110, 125, 150];
function step(dir: 1 | -1): number {
  const now = current!.shownZoom;
  const next = dir > 0 ? ZOOMS.find((z) => z > now + 1) ?? 150 : [...ZOOMS].reverse().find((z) => z < now - 1) ?? 50;
  return next / 100;
}
function setZoom(z: number | "fit") { current!.zoom = z; send({ type: "zoom", value: z }); }

function renderPage() {
  if (!current) return;
  $("dvPage").textContent = current.pages ? `Page ${current.page} of ${current.pages}` : "";
}

export function handleKey(key: string, ctrl: boolean): boolean {
  if (!docOpen()) return false;
  if (key === "Escape") { closeDoc(); return true; }
  if (!ctrl) return false;
  if (key === "=" || key === "+") setZoom(step(+1));
  else if (key === "-") setZoom(step(-1));
  else if (key === "0") setZoom("fit");
  else if (key === "p") send({ type: "print" });
  else if (key === "s") savePdf();
  else return false;
  return true;
}

function fileName() {
  const c = current! as { ref: DocRef; part: string };
  const base = c.ref.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Chalk";
  const what = c.part === "scheme" ? "Mark scheme" : c.ref.kind === "paper" ? "Practice paper" : c.ref.kind === "worksheet" ? "Worksheet" : "Notes";
  return `${base} - ${what}.pdf`;
}

async function savePdf() {
  if (!current || isUpload()) return;
  if (!desktop?.docPdf) {  // in a browser: the print dialog's "Save as PDF" makes the same file
    toast("Saving as PDF", "Choose “Save as PDF” as the printer.");
    send({ type: "print" });
    return;
  }
  const btn = $("docView").querySelector<HTMLButtonElement>('[data-dv="save"]')!;
  btn.disabled = true;
  try {
    const r = await desktop.docPdf({ path: src(current.part).replace(/&theme=\w+/, ""), name: fileName(), action: "save" });
    if (r.ok && r.path) toast("PDF saved", esc(r.path), 8000, { label: "Open", run: () => desktop!.openPath(r.path!) });
    else if (r.error) toast("Couldn't save the PDF", esc(r.error));
  } finally { btn.disabled = false; }
}
