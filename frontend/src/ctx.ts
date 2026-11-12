/** State and helpers shared by the parts of the interface (notebook, voice, settings, welcome). */

export interface Status { mock: boolean; stt: boolean; tts: boolean; whisper_model: string; version?: string; data_dir?: string }
export interface ModelInfo { value: string; displayName?: string; description?: string }
export interface Settings { model: string; effort: string; engine?: string; keep_recordings?: boolean; default_mode?: string; code_language?: string; small_model?: string }
export interface Usage { status: string; resets_at: number | null; window: string | null; utilization: number | null }
/** One plan limit window: the current 5-hour session, or a weekly limit. pct is 0–100. */
export interface LimitWindow { key: string; label: string; short: string; pct: number; resets_at: number | null }
export interface Limits { windows: LimitWindow[]; extra_enabled?: boolean; fetched_at?: number }
export interface Account {
  auth: Record<string, any> & { loggedIn: boolean; authMethod?: string; usingApiKey?: boolean; error?: string };
  usage: Usage | null;
  limits?: Limits | null;
  login: { running: boolean; url: string | null };
}
/** A document Claude made (practice paper, worksheet, revision notes), as carried on a reply. */
export interface DocRef { id: string; kind: "paper" | "worksheet" | "interview" | "notes"; title: string; summary: string; edited?: string[] }
export interface Concept { name: string; status: "new" | "shaky" | "understood" }
export interface Note { id: string; title: string; mode: string; session_id?: string | null; concepts: Concept[]; created: number; updated: number; preview?: string; hit?: string; title_locked?: number;
  /** Tokens Claude read on this note's last turn: what every message here costs. */
  context?: number; carry?: string | null; continued_from?: string | null; continued_in?: string | null }

export const S = {
  status: { mock: false, stt: false, tts: false, whisper_model: "" } as Status,
  account: null as Account | null,
  settings: { model: "sonnet", effort: "low", engine: "script" } as Settings,
  models: [] as ModelInfo[],
  efforts: ["low", "medium", "high"] as string[],
  usage: null as Usage | null,
  limits: null as Limits | null,
  busy: false,
  voiceOn: localStorage.getItem("chalk.voiceOn") !== "0",
  autoSend: localStorage.getItem("chalk.autoSend") !== "0",
};

export const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(path, body === undefined && !method ? undefined : {
    method: method ?? "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.detail;
    const err = new Error(typeof detail === "string" ? detail : detail?.message ?? res.statusText) as Error & { detail?: unknown; status?: number };
    err.detail = detail; err.status = res.status;
    throw err;
  }
  return res.json();
}

/** A short message above the composer. Not red: red only ever means recording. */
let toastTimer = 0;
export function toast(title: string, body = "", ms = 5000, action?: { label: string; run: () => void }) {
  const el = $("toast");
  clearTimeout(toastTimer);
  el.hidden = false;
  el.innerHTML = `<div><b>${esc(title)}</b>${body ? `<span class="muted">${body}</span>` : ""}</div>`;
  if (action) {
    const b = document.createElement("button");
    b.className = "btn secondary sm"; b.textContent = action.label;
    b.onclick = () => { el.hidden = true; action.run(); };
    el.appendChild(b);
  }
  if (ms) toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}
export const hideToast = () => { clearTimeout(toastTimer); $("toast").hidden = true; };

// ----- small pieces of account info -----
function findField(obj: any, re: RegExp): string | null {
  if (!obj || typeof obj !== "object") return null;
  for (const [k, v] of Object.entries(obj)) {
    if (re.test(k) && (typeof v === "string" || typeof v === "number")) return String(v);
    if (v && typeof v === "object") { const f = findField(v, re); if (f) return f; }
  }
  return null;
}
export const who = (a: Account["auth"]) => findField(a, /email/i) ?? findField(a, /^(name|displayName|accountName)$/i) ?? "your Claude account";
export const plan = (a: Account["auth"]) => findField(a, /subscription|plan|tier/i);
export const modelName = (value: string) => S.models.find((m) => m.value === value)?.displayName?.replace(/ \(.*\)$/, "") ?? value.charAt(0).toUpperCase() + value.slice(1);

export const fmtBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`;

/** "now", "11:20", "Thu", "Oct 14": how the notes list says when. */
export function when(ts: number): string {
  const d = new Date(ts * 1000), now = new Date();
  const mins = (now.getTime() - d.getTime()) / 60000;
  if (mins < 2) return "now";
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (mins < 7 * 24 * 60) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
export function edited(ts: number): string {
  const mins = (Date.now() / 1000 - ts) / 60;
  if (mins < 1) return "Edited just now";
  if (mins < 60) return `Edited ${Math.round(mins)} min ago`;
  if (mins < 24 * 60) return `Edited ${Math.round(mins / 60)} h ago`;
  return `Edited ${when(ts)}`;
}

/** Resolve once the user agrees (styled confirm, not the browser's). */
export function confirmBox(title: string, body: string, ok = "Delete"): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "palette-scrim";
    wrap.innerHTML = `<div class="palette" role="alertdialog" style="width:min(440px,92%);padding:22px 22px 18px;gap:14px">
      <div style="font-size:17px;font-weight:600;letter-spacing:-0.01em">${esc(title)}</div>
      <div class="muted" style="font-size:14px;line-height:20px">${body}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button class="btn quiet" data-a="no">Cancel</button><button class="btn primary" data-a="yes">${esc(ok)}</button></div></div>`;
    document.body.appendChild(wrap);
    const done = (v: boolean) => { wrap.remove(); document.removeEventListener("keydown", key, true); resolve(v); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } if (e.key === "Enter") { e.stopPropagation(); done(true); } };
    document.addEventListener("keydown", key, true);
    wrap.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
      if (a) done(a === "yes"); else if (e.target === wrap) done(false);
    });
    wrap.querySelector<HTMLButtonElement>("[data-a=yes]")!.focus();
  });
}

/** "Pro", "Max"… from the signed-in account, for "Pro usage" labels. */
export function planName(): string {
  const p = S.account?.auth ? plan(S.account.auth) : null;
  const m = String(p ?? "").match(/max|pro|team|enterprise/i);
  return m ? m[0][0].toUpperCase() + m[0].slice(1).toLowerCase() : "Pro";
}

/** "resets in 2 h 14 min", or "resets Thu 09:00" when it's more than a day away. */
export function resetsIn(epoch: number | null | undefined): string {
  if (!epoch) return "";
  const mins = Math.max(0, Math.round((epoch * 1000 - Date.now()) / 60000));
  if (mins >= 24 * 60) {
    const d = new Date(epoch * 1000);
    return `resets ${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `resets in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}`;
}
