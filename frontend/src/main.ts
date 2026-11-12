/**
 * Chalk: the interface.
 *   - notes (sidebar), each its own conversation with Claude, saved on this PC
 *   - the notebook: your words in Newsreader, Claude's margin notes in ink
 *   - Claude's canvas: diagrams and animations walked through step by step, in sync with its voice
 *   - the bottom bar: mode, the voice orb, the composer (code and drawings), mute
 */
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./app.css";
import "./visuals.css";
import { marked } from "marked";
import { Stage as VisualStage, buildFrames, type BeatSpec, type Frame } from "./visuals/stage";
import { describe, type VisualState } from "./visuals/state";
import { Whiteboard } from "./whiteboard";
import { CodeBoxes, codeBlock, highlightAll, looksLikeCode, splitFences } from "./codebox";
import { AnimStage } from "./anim/animstage";
import type { PlayerState } from "./anim/player";
import type { Program } from "./anim/protocol";
import { browserVoice, chosenVoice, setKokoroCatalogue, voiceRate } from "./voices";
import { type CxReview, ExercisePanel, type ExerciseRef } from "./exercise";
import { PredictCard, matchSpoken } from "./predict";
import { FileTray, fileChips, initDrop, type FileMeta } from "./files";
import { initDocView, openUpload, openDoc, closeDoc, docOpen, docTheme, handleKey as docKey } from "./docview";
import { $, S, api, esc, sleep, toast, hideToast, modelName, when, edited, confirmBox, type Account, type ModelInfo, type Note, type Settings, type Status, type Usage, type Limits, type DocRef, planName, resetsIn } from "./ctx";
import { icon, hydrateIcons } from "./icons";
import { Palette, type PaletteItem } from "./palette";
import { desktop, isDesktop, saveText } from "./desktop";
import { watchForSpeech, stopWatching } from "./bargein";
import { initVoiceIn, startRecording, stopRecording, cancelRecording, phase as micPhase, holding as micHolding, type MicPhase } from "./voicein";
import { initSettings, openSettings as openSettingsView, settingsOpen, showWelcome, renderWelcome, type ThemePref } from "./settingsView";

// ---------------------------------------------------------------- types
type Stage = "starting" | "waiting" | "thinking" | "writing" | "fixing" | "reading";
type Beat = BeatSpec;
interface TutorReply {
  say: string; beats: Beat[]; visual: unknown; margin: string; question: string; awaiting: "answer" | "next" | "none";
  script?: string; title?: string; note_title?: string; concepts?: Note["concepts"]; complexity_review?: CxReview;
  user_turn?: number; tutor_turn?: number;
  timing?: { start_ms: number; first_token_ms: number | null; total_ms: number; model: string; effort: string; api_calls: number };
  note?: Note;
  document?: DocRef;
  doc_error?: string;
  exercise?: ExerciseRef;
  exercise_error?: string;
}
type TurnEvent =
  | { type: "stage"; stage: Stage }
  | ({ type: "usage" } & Usage)
  | ({ type: "limits" } & Limits)
  | ({ type: "result" } & TutorReply)
  | { type: "error"; message: string };
interface Turn { id: number; role: "user" | "tutor"; via: string; text: string; data: any; created: number }
/** One reply's visual walkthrough: the visual it starts from and one frame per spoken beat. */
interface Walk {
  title: string; start: VisualState | null; frames: Frame[]; beats: Beat[]; msgEl: HTMLElement;
  anim?: { base: PlayerState | null; program: Program };
}
const steps = (w: Walk) => (w.anim ? w.anim.program.beats.length : w.frames.length);

marked.use({ renderer: { html: ({ text }: { text: string }) => esc(text) } }); // never render raw HTML from Claude
hydrateIcons();
if (isDesktop) $("app").classList.remove("is-browser");

// ---------------------------------------------------------------- elements & state
const appEl = $("app");
const log = $<HTMLDivElement>("log");
const input = $<HTMLTextAreaElement>("input");
const composer = $<HTMLFormElement>("composer");
const sendBtn = $<HTMLButtonElement>("send");
const diagramEl = $("diagram");
const predictCard = new PredictCard($("stageArea"));  // "predict, then check" pauses in walkthroughs
const animEl = $("anim");
const captionEl = $("caption");
const wLabel = $("wLabel");
const wDots = $("wDots");
const wPlay = $<HTMLButtonElement>("wPlay");
const orb = $("orb");

let notes: Note[] = [];
let note: Note | null = null;       // the open note
let turns: Turn[] = [];             // its saved turns
let transcript: string[] = [];      // recent text: a hint for speech recognition
let walks: Walk[] = [];             // every reply in this note that came with a visual walkthrough
let walkIdx = -1;                   // which one is on the canvas
let beatIdx = -1;                   // which of its beats is showing (-1 = its starting state)
let latest: VisualState | null = null;         // end state of the newest classic visual: what Claude builds on
let animEnd: PlayerState | null = null;        // the animated scene at the end of the newest script
let latestKind: "anim" | "classic" | null = null;
let animAt = 0;                     // how many beats of the open walk the player has applied
let currentAudio: HTMLAudioElement | null = null;
let speaking = false;
let mode = "tutor";
const stage = new VisualStage(diagramEl);
const anim = new AnimStage(animEl);

function showHost(kind: "anim" | "classic" | null) {
  animEl.hidden = kind !== "anim";
  diagramEl.hidden = kind !== "classic";
  $("cvEmpty").hidden = kind !== null;
  if (kind === "anim") requestAnimationFrame(() => anim.player.refit());
}

// ---------------------------------------------------------------- theme
let themePref: ThemePref = (localStorage.getItem("chalk.theme") as ThemePref) || "system";
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const dark = themePref === "dark" || (themePref === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $<HTMLImageElement>("tbMark").src = `/brand/${dark ? "icon-f-dark" : "icon-f"}.svg`;
  desktop?.setTheme(dark ? "dark" : "light");
  whiteboard?.setThemeInk(dark);
  docTheme();
}
darkQuery.addEventListener("change", applyTheme);
const setTheme = (t: ThemePref) => { themePref = t; localStorage.setItem("chalk.theme", t); applyTheme(); };
const setReduceMotion = (on: boolean) => document.documentElement.classList.toggle("reduce-motion", on);
setReduceMotion(localStorage.getItem("chalk.reduceMotion") === "1");

// ---------------------------------------------------------------- account, settings, status
async function refreshAccount() {
  try { S.account = await api<Account>("/api/account"); } catch { return; }
  if (S.account.usage) renderUsage(S.account.usage);
  if (S.account.limits) renderLimits(S.account.limits);
}
async function loadSettings() {
  try {
    const r = await api<{ settings: Settings; models: ModelInfo[]; efforts: string[] }>("/api/settings");
    S.settings = r.settings; S.models = r.models; S.efforts = r.efforts;
  } catch { /* backend unreachable: shown elsewhere */ }
}
async function saveSettings(patch: Record<string, unknown>) {
  const r = await api<{ settings: Settings }>("/api/settings", patch);
  S.settings = r.settings;
}
async function loadStatus() {
  try { S.status = await api<Status>("/api/status"); } catch { /* not up yet */ }
  if (S.status.tts) api("/api/voices").then((v) => setKokoroCatalogue(v.voices)).catch(() => {});
}
/** Real plan numbers (session + weekly windows). When we have them they win over the coarse status. */
function renderLimits(l: Limits | null) {
  if (!l || !l.windows.length) return;
  S.limits = l;
  const session = l.windows.find((w) => w.key === "five_hour") ?? l.windows[0];
  const pct = Math.round(session.pct);
  $("usageMini").hidden = false;
  $("usageMiniName").textContent = `${planName()} usage`;
  $("usageMiniText").textContent = `${pct}% used`;
  $("usageMiniBar").style.width = `${pct}%`;
  $("usageMini").title = l.windows.map((w) => `${w.label}: ${Math.round(w.pct)}%${w.resets_at ? `, ${resetsIn(w.resets_at)}` : ""}`).join("\n");
  const week = l.windows.find((w) => w.key === "seven_day");
  $("usageMiniWeek").hidden = !week;
  if (week) $("usageMiniWeek").textContent = `This week ${Math.round(week.pct)}%`;
}
async function refreshLimits() {
  try { renderLimits((await api<{ limits: Limits | null }>("/api/usage")).limits); } catch { /* backend restarting */ }
}
function renderUsage(u: Usage | null) {
  if (!u) return;
  S.usage = u;
  if (S.limits) return;  // the real numbers are already showing
  $("usageMiniName").textContent = `${planName()} usage`;
  const pct = u.utilization != null ? Math.round(u.utilization * 100) : null;
  $("usageMini").hidden = pct == null && u.status === "allowed";
  $("usageMiniText").textContent = pct != null ? `${pct}% used` : u.status === "allowed" ? "within limit" : u.status === "allowed_warning" ? "close to limit" : "limit reached";
  $("usageMiniBar").style.width = `${pct ?? (u.status === "allowed" ? 10 : 90)}%`;
}

// ---------------------------------------------------------------- notes (sidebar)
async function loadNotes() {
  try { notes = (await api<{ notes: Note[] }>("/api/notes")).notes; } catch { notes = []; }
  renderNoteList();
}

function renderNoteList() {
  const list = $("noteList");
  const now = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = day(now);
  const groups: [string, Note[]][] = [["Today", []], ["Yesterday", []], ["This week", []], ["Earlier", []]];
  for (const n of notes) {
    const t = day(new Date(n.updated * 1000));
    groups[t >= today ? 0 : t >= today - 864e5 ? 1 : t >= today - 6 * 864e5 ? 2 : 3][1].push(n);
  }
  const MODE: Record<string, string> = { tutor: "Tutor", partner: "Thinking partner", quiz: "Quiz", answer: "Just answer" };
  list.innerHTML = groups.filter(([, ns]) => ns.length).map(([label, ns]) => `
    <div class="sb-group"><span class="sb-group-label">${label}</span>
      ${ns.map((n) => `<button class="sb-note${note?.id === n.id ? " on" : ""}" data-note="${n.id}" title="${esc(n.title || n.preview || "Untitled")}">
        <span class="t">${esc(n.title || n.preview || "Untitled")}</span>
        <span class="m">${MODE[n.mode] ?? "Tutor"} · ${when(n.updated)}</span>
        <span class="del icon-btn sm" data-del="${n.id}" role="button" aria-label="Delete note" title="Delete note">${icon("trash")}</span>
      </button>`).join("")}
    </div>`).join("") || `<div class="sb-empty">No notes yet.</div>`;
  list.querySelectorAll<HTMLButtonElement>("[data-note]").forEach((b) => (b.onclick = (e) => {
    const del = (e.target as HTMLElement).closest<HTMLElement>("[data-del]");
    if (del) { e.stopPropagation(); deleteNote(del.dataset.del!); return; }
    if (b.dataset.note !== note?.id) openNote(b.dataset.note!);
  }));
}

async function newNote() {
  closeDoc();
  closeExercise();
  clearFirst();
  if (note && !turns.length) { focusComposer(); return; } // the open note is still empty: use it
  const n = await api<Note>("/api/notes", { mode: S.settings.default_mode ?? "tutor" });
  notes.unshift(n);
  await openNote(n.id, n);
  focusComposer();
}

async function deleteNote(id: string) {
  const n = notes.find((x) => x.id === id);
  if (!(await confirmBox("Delete this note?", `“${esc(n?.title || n?.preview || "Untitled")}” and its conversation will be removed from this PC.`))) return;
  await api(`/api/notes/${id}`, undefined, "DELETE");
  notes = notes.filter((x) => x.id !== id);
  if (note?.id === id) { note = null; if (notes[0]) await openNote(notes[0].id); else await newNote(); }
  renderNoteList();
}

/** Open a note: its saved turns are re-rendered and its visuals rebuilt (scripts are re-run, instantly). */
async function openNote(id: string, known?: Note) {
  closeDoc();
  closeExercise();
  clearFirst();
  stopSpeaking();
  const data = known ? { ...known, turns: [] as Turn[] } : await api<Note & { turns: Turn[] }>(`/api/notes/${id}`);
  note = data; turns = data.turns ?? [];
  localStorage.setItem("chalk.lastNote", id);
  mode = data.mode || "tutor";
  renderMode();
  // reset the canvas and the conversation's visual state
  walks = []; walkIdx = -1; beatIdx = -1; latest = null; animEnd = null; latestKind = null; transcript = [];
  anim.reset(); stage.clear(); showHost(null); captionEl.textContent = "";
  log.innerHTML = "";
  renderHeader();
  for (const t of turns) {
    if (t.role === "user") { addUser(t.text, t.via, t.data?.images?.[0], t.data?.files); transcript.push(t.text); continue; }
    await restoreReply(t.data as TutorReply);
  }
  markLatest();
  decorateTurns();
  if (walks.length) await openWalk(walks.length - 1, false, true);
  renderWalkBar();
  renderNoteList();
  renderFirstRun();
  $("notebook").scrollTop = $("notebook").scrollHeight;
}

/** Rebuild a saved reply: its entry in the notebook and, if it had one, its walkthrough. */
async function restoreReply(reply: TutorReply) {
  if (reply.script) {
    const base = animEnd;
    const r = await anim.run(reply.script);
    const program = r.program;
    const beats = alignBeats(reply, program);
    const hasVisual = program.beats.some((b) => b.cmds.length);
    const msgEl = addClaude({ ...reply, beats }, hasVisual ? walks.length : -1, metaLine(reply));
    if (hasVisual) {
      walks.push({ title: reply.title ?? "", start: null, frames: [], beats, msgEl, anim: { base, program } });
      animEnd = anim.endState(base, program);
      latestKind = "anim";
    }
  } else {
    if (!reply.beats?.length) reply.beats = [{ text: reply.say, highlight: [] }];
    const { start, frames } = buildFrames(latest, reply.visual, reply.beats);
    const msgEl = addClaude(reply, start ? walks.length : -1, metaLine(reply));
    if (start) {
      walks.push({ title: start.title, start, frames, beats: reply.beats, msgEl });
      latest = frames.at(-1)?.state ?? start;
      latestKind = "classic";
    }
  }
  transcript.push(reply.say || reply.beats?.map((b) => b.text).join(" ") || "");
}

/** The spoken beats of a scripted reply come from its say() calls; keep beats and steps lined up. */
function alignBeats(reply: TutorReply, program: Program): Beat[] {
  const beats = program.beats.map((b) => ({ text: b.text, highlight: [] as string[] }));
  if (beats.length && !beats[0].text) beats[0].text = reply.say || "";
  const keep = beats.map((b, i) => !!(b.text || program.beats[i].cmds.length));
  program.beats = program.beats.filter((_, i) => keep[i]);
  const out = beats.filter((_, i) => keep[i]);
  reply.say = out.map((b) => b.text).join(" ");
  return out.length ? out : [{ text: reply.question || "…", highlight: [] }];
}

// ---------------------------------------------------------------- the note's header: title, concepts, edited
const titleEl = $("noteTitle");
function renderHeader() {
  if (document.activeElement !== titleEl) titleEl.textContent = note?.title ?? "";
  titleEl.classList.toggle("placeholder", !note?.title);
  const crumb = $("crumb");
  crumb.textContent = note?.title || "Untitled";
  const meta = $("noteMeta");
  meta.innerHTML = (note?.concepts ?? []).map((c) => `<span class="chip" title="${c.status === "understood" ? "Understood" : c.status === "shaky" ? "Shaky" : "New"}"><span class="cdot ${c.status}"></span>${esc(c.name)}</span>`).join("")
    + (note && turns.length ? `<span class="edited">${edited(note.updated)}</span>` : "")
    + contextChip();
  meta.querySelector<HTMLElement>(".ctx-chip")?.addEventListener("click", (e) => showBreakdown(e.currentTarget as HTMLElement));
  renderCarry();
  renderNudge();
}

// ---------------------------------------------------------------- how heavy this note's conversation is
const CONTEXT_NUDGE = 50_000;
const kTok = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
function contextChip(): string {
  const c = note?.context ?? 0;
  if (!c || !turns.length) return "";
  const lvl = c >= CONTEXT_NUDGE ? "heavy" : c >= CONTEXT_NUDGE * 0.6 ? "mid" : "light";
  const pct = Math.min(100, Math.round((c / (CONTEXT_NUDGE * 1.6)) * 100));
  const tip = `Each message in this note has Claude re-read about ${kTok(c)} tokens of conversation. `
    + (lvl === "light" ? "That's light." : lvl === "mid" ? "It's getting heavier: a fresh note would be cheaper soon." : "That uses up your limits faster: a fresh note would be much cheaper.");
  return `<button class="ctx-chip ${lvl}" title="${esc(tip)}" data-ctx="${c}" aria-haspopup="dialog"><span class="ctx-bar"><i style="width:${pct}%"></i></span>${kTok(c)} context</button>`;
}

/** Where this note's tokens are: Claude Code's own count, from the last reply. */
function showBreakdown(anchor: HTMLElement) {
  document.querySelector(".ctx-pop")?.remove();
  const last = [...turns].reverse().find((t) => t.role === "tutor")?.data as { breakdown?: { name: string; tokens: number }[] } | undefined;
  const rows = last?.breakdown ?? [];
  const total = note?.context ?? 0;
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  const pop = document.createElement("div");
  pop.className = "ctx-pop";
  pop.setAttribute("role", "dialog");
  pop.innerHTML = `<b>Each message here re-reads about ${kTok(total)} tokens</b>
    ${rows.length ? `<div class="cp-rows">${rows.map((r) => `<div class="cp-row"><span>${esc(r.name)}</span>${r.tokens ? `<i><em style="width:${Math.max(2, (r.tokens / max) * 100)}%"></em></i><code>${kTok(r.tokens)}</code>` : ""}</div>`).join("")}</div>`
      : `<p>A breakdown appears after Claude's next reply.</p>`}
    <p>Most of it is cached, which is cheaper, but long notes still use up your limits faster. Starting a fresh note resets it.</p>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, innerWidth - pop.offsetWidth - 12)}px`;
  pop.style.top = `${r.bottom + 8}px`;
  const close = (e: Event) => { if (!pop.contains(e.target as Node)) { pop.remove(); removeEventListener("pointerdown", close, true); } };
  setTimeout(() => addEventListener("pointerdown", close, true));
}

function renderNudge() {
  const el = $("ctxNudge");
  const c = note?.context ?? 0;
  const later = note?.continued_in ? notes.find((n) => n.id === note!.continued_in) : null;
  if (note?.continued_in) {
    el.hidden = false;
    el.className = "ctx-nudge done";
    el.innerHTML = `<span>This topic continues in <a href="#" data-goto="${note.continued_in}">${esc(later?.title || "a fresh note")}</a>.</span>`;
  } else if (c >= CONTEXT_NUDGE && !S.busy && localStorage.getItem(`chalk.nudged.${note!.id}`) !== "1") {
    el.hidden = false;
    el.className = "ctx-nudge";
    el.innerHTML = `<div class="cn-text"><b>This note is getting long</b><span>Every message here has Claude re-read about ${kTok(c)} tokens of conversation, which uses up your limits faster. A fresh note picks up where you are, with a summary and your latest paper, for a fraction of that.</span></div>
      <div class="cn-acts"><button class="btn quiet sm" data-x="later">Not now</button><button class="btn primary sm" data-x="continue">Continue in a fresh note</button></div>`;
  } else {
    el.hidden = true;
    el.innerHTML = "";
  }
  el.querySelector<HTMLElement>("[data-x=later]")?.addEventListener("click", () => { localStorage.setItem(`chalk.nudged.${note!.id}`, "1"); renderNudge(); });
  el.querySelector<HTMLButtonElement>("[data-x=continue]")?.addEventListener("click", (e) => continueNote(e.currentTarget as HTMLButtonElement));
  el.querySelector<HTMLElement>("[data-goto]")?.addEventListener("click", (e) => { e.preventDefault(); openNote((e.currentTarget as HTMLElement).dataset.goto!); });
}

async function continueNote(btn?: HTMLButtonElement) {
  if (!note) return;
  if (btn) { btn.disabled = true; btn.textContent = "Summarising…"; }
  try {
    const r = await api<{ note: Note }>(`/api/notes/${note.id}/continue`, {});
    notes = [r.note, ...notes.filter((n) => n.id !== r.note.id)].map((n) => (n.id === note!.id ? { ...n, continued_in: r.note.id } : n));
    await openNote(r.note.id);
    focusComposer();
  } catch (e) {
    toast("Couldn't start a fresh note", esc((e as Error).message));
    if (btn) { btn.disabled = false; btn.textContent = "Continue in a fresh note"; }
  }
}

function renderCarry() {
  const el = $("carryCard");
  if (!note?.continued_from) { el.hidden = true; return; }
  const from = notes.find((n) => n.id === note!.continued_from);
  el.hidden = false;
  if (el.dataset.note === note.id) return;  // keep it open or closed as you left it
  el.dataset.note = note.id;
  el.innerHTML = `<div class="cc-head"><span>Continued from <a href="#" data-goto="${note.continued_from}">${esc(from?.title || "an earlier note")}</a></span>
    ${note.carry ? `<button class="btn quiet sm" data-x="carry">What Claude carried over</button>` : ""}</div>
    ${note.carry ? `<div class="cc-body" hidden>${esc(note.carry)}</div>` : ""}`;
  el.querySelector<HTMLElement>("[data-goto]")!.onclick = (e) => { e.preventDefault(); openNote(note!.continued_from!); };
  const b = el.querySelector<HTMLButtonElement>("[data-x=carry]");
  if (b) b.onclick = () => { const body = el.querySelector<HTMLElement>(".cc-body")!; body.hidden = !body.hidden; b.classList.toggle("on", !body.hidden); };
}
titleEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); } if (e.key === "Escape") { titleEl.textContent = note?.title ?? ""; titleEl.blur(); } });
titleEl.addEventListener("blur", async () => {
  if (!note) return;
  const t = (titleEl.textContent ?? "").trim();
  if (t === note.title) return;
  note = await api<Note>(`/api/notes/${note.id}`, { title: t }, "PATCH");
  notes = notes.map((n) => (n.id === note!.id ? note! : n));
  renderHeader(); renderNoteList();
});
setInterval(() => { if (note && turns.length) renderHeader(); }, 60000);

function renderFirstRun() {
  const empty = !turns.length;
  $("firstRun").hidden = !empty;
  titleEl.classList.toggle("placeholder", !note?.title);
}

function focusComposer() { (firstRunShown() ? firstInput : input).focus(); }

// ---------------------------------------------------------------- writing straight onto an empty note
// The first message can be written on the page itself, where the note says "start typing here".
const firstInput = $<HTMLTextAreaElement>("firstInput");
const firstRunShown = () => !$("firstRun").hidden && !$("mainView").hidden;
function growFirst() {
  firstInput.style.height = "auto";
  firstInput.style.height = `${firstInput.scrollHeight}px`;
  firstInput.parentElement!.classList.toggle("filled", firstInput.value.length > 0);
}
firstInput.addEventListener("input", () => { growFirst(); syncComposer(); });
firstInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); }
  else if (e.key === "Escape") firstInput.blur();
});
function clearFirst() { firstInput.value = ""; growFirst(); }

// ---------------------------------------------------------------- notebook entries
function gutter(kind: "you" | "voice" | "claude" | "none" | "pending" | "notice") {
  const g = document.createElement("span");
  g.className = "gutter";
  if (kind === "voice") { g.innerHTML = icon("mic"); g.title = "Spoken"; g.setAttribute("aria-label", "Spoken"); }
  if (kind === "claude" || kind === "pending") g.innerHTML = `<span class="dot${kind === "pending" ? " pulse" : ""}"></span>`;
  if (kind === "notice") g.innerHTML = icon("info");
  return g;
}

function addUser(text: string, via: string, image?: string, files?: FileMeta[]) {
  const g = gutter(via === "voice" ? "voice" : "you");
  const div = document.createElement("div");
  div.className = "entry you";
  if (text.includes("```")) {
    for (const part of splitFences(text)) {
      if (part.kind === "code") div.appendChild(codeBlock(part.code, part.lang));
      else { const p = document.createElement("div"); p.className = "msg-text"; p.textContent = part.text.trim(); div.appendChild(p); }
    }
  } else { const p = document.createElement("div"); p.className = "msg-text"; p.textContent = text; div.appendChild(p); }
  if (image) {
    const img = document.createElement("img");
    img.src = image; img.className = "drawing"; img.alt = "Your drawing";
    div.appendChild(img);
  }
  if (files?.length) div.appendChild(fileChips(files, openUpload));
  log.append(g, div);
  $("firstRun").hidden = true;
  scrollNotebook();
  return div;
}

// ---------------------------------------------------------------- edit a message, or regenerate the last reply
/** Give each of your messages an Edit button, and the last reply a Regenerate button. */
function decorateTurns() {
  const users = turns.filter((t) => t.role === "user");
  log.querySelectorAll<HTMLElement>(".entry.you").forEach((el, i) => {
    const t = users[i];
    if (!t) return;
    el.dataset.turn = String(t.id || "");
    if (!el.querySelector(".you-edit")) {
      const b = document.createElement("button");
      b.className = "you-edit"; b.innerHTML = icon("pencil"); b.title = "Edit and resend"; b.setAttribute("aria-label", "Edit and resend");
      b.onclick = () => editMessage(el);
      el.appendChild(b);
    }
  });
  log.querySelectorAll(".regen").forEach((b) => b.remove());
  const lastReply = [...log.querySelectorAll<HTMLElement>(".entry.claude")].pop();
  const foot = lastReply?.querySelector(".entry-meta");
  if (foot && turns.length && turns[turns.length - 1].role === "tutor") {
    const b = document.createElement("button");
    b.className = "link regen"; b.textContent = "Regenerate"; b.title = "Ask again: Claude forgets this reply";
    b.onclick = () => regenerate();
    foot.insertBefore(b, foot.children[1] ?? null);
  }
}

/** Remove a message and everything after it (here and in Claude's conversation), then send `text` in its place. */
async function resendFrom(turnId: number, text: string) {
  if (S.busy || !note || !turnId) { if (!turnId) toast("One moment", "That message is still being saved."); return; }
  stopSpeaking();
  const nid = note.id;
  try {
    await api(`/api/notes/${nid}/truncate`, { turn_id: turnId });
  } catch (e) { toast("Couldn't change that message", esc((e as Error).message)); return; }
  await openNote(nid);
  await sendTurn(text);
}

function editMessage(el: HTMLElement) {
  if (S.busy) return;
  const id = Number(el.dataset.turn);
  const t = turns.find((x) => x.id === id);
  if (!t || el.classList.contains("editing")) return;
  el.classList.add("editing");
  const box = document.createElement("div");
  box.className = "you-editbox";
  box.innerHTML = `<textarea rows="3" aria-label="Edit your message"></textarea>
    <div class="you-edit-acts"><span>Claude forgets this message and everything after it.</span><button class="btn quiet sm" data-x="cancel">Cancel</button><button class="btn primary sm" data-x="send">Send</button></div>`;
  const ta = box.querySelector("textarea")!;
  ta.value = t.text;
  el.appendChild(box);
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  const fit = () => { ta.style.height = "auto"; ta.style.height = `${Math.min(320, ta.scrollHeight)}px`; };
  fit(); ta.oninput = fit;
  const close = () => { box.remove(); el.classList.remove("editing"); };
  box.querySelector<HTMLElement>("[data-x=cancel]")!.onclick = close;
  const go = () => { const v = ta.value.trim(); if (!v) return; close(); resendFrom(id, v); };
  box.querySelector<HTMLElement>("[data-x=send]")!.onclick = go;
  ta.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); }
    if (e.key === "Escape") { e.preventDefault(); close(); }
  };
}

function regenerate() {
  const u = [...turns].reverse().find((t) => t.role === "user");
  if (u) resendFrom(u.id, u.text);
}

function metaLine(reply: TutorReply, extra: string[] = []) {
  const t = reply.timing;
  if (!t) return extra.join(" · ");
  return [...extra, `${(t.total_ms / 1000).toFixed(1)} s`, `${modelName(t.model)}, ${t.effort} effort`].join(" · ");
}

/** Claude's margin note: the spoken beats (lit up as they're said), its question, a written note, and Replay. */
function addClaude(reply: TutorReply, walkIndex: number, meta: string) {
  const g = gutter("claude");
  const div = document.createElement("div");
  div.className = "entry claude";
  const said = document.createElement("p");
  said.className = "said";
  for (const b of reply.beats) {
    const s = document.createElement("span");
    s.className = "beat";
    s.textContent = b.text + " ";
    said.appendChild(s);
  }
  div.appendChild(said);
  if (reply.question && !reply.beats.some((b) => b.text.includes(reply.question.slice(0, 30)))) {
    const q = document.createElement("p");
    q.className = "question";
    q.textContent = reply.question;
    div.appendChild(q);
  }
  if (reply.margin) {
    const m = document.createElement("div");
    m.className = "margin-note";
    m.innerHTML = marked.parse(reply.margin) as string;
    highlightAll(m);
    div.appendChild(m);
  }
  if (reply.document) div.appendChild(docCard(reply.document));
  if (reply.exercise) div.appendChild(exerciseCard(reply.exercise));
  if (reply.exercise_error) {
    const n = document.createElement("div");
    n.className = "doc-card failed";
    n.innerHTML = `<span class="dc-thumb code" aria-hidden="true">{ }</span><span class="dc-text"><b>The exercise didn't come through</b><span>${esc(reply.exercise_error)}</span></span>`;
    div.appendChild(n);
  }
  if (reply.doc_error) {
    const n = document.createElement("div");
    n.className = "doc-card failed";
    n.innerHTML = `<span class="dc-thumb" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="dc-text"><b>${reply.document ? "Some changes didn't go through" : /^The paper wasn't changed/.test(reply.doc_error) ? "The paper wasn't changed" : "The document didn't come through"}</b><span>${esc(reply.doc_error)}</span></span>`;
    div.appendChild(n);
  }
  const actions = document.createElement("div");
  actions.className = "entry-actions";
  actions.dataset.awaiting = reply.awaiting;
  div.appendChild(actions);
  const foot = document.createElement("div");
  foot.className = "entry-meta";
  const replay = document.createElement("button");
  replay.className = "link";
  replay.innerHTML = "Replay";
  replay.title = "Replay this explanation with its visual";
  replay.onclick = () => replayReply(walkIndex, div, reply.beats);
  foot.append(replay);
  if (meta) foot.append(Object.assign(document.createElement("span"), { textContent: meta }));
  div.appendChild(foot);
  log.append(g, div);
  scrollNotebook();
  return div;
}

/** A coding exercise Claude set: opens in the exercise panel. */
function exerciseCard(x: ExerciseRef): HTMLElement {
  const card = document.createElement("div");
  card.className = "doc-card ex-card";
  card.innerHTML = `<button class="dc-main" title="Open ${esc(x.title)}">
      <span class="dc-thumb code" aria-hidden="true">{ }</span>
      <span class="dc-text"><b>${esc(x.title)}</b><span>${esc(x.summary)}</span></span>
    </button>
    <div class="dc-acts"><button class="btn ink-soft sm">Open</button></div>`;
  const open = () => openExercise(x.id);
  card.querySelector<HTMLElement>(".dc-main")!.onclick = open;
  card.querySelector<HTMLElement>(".dc-acts button")!.onclick = open;
  return card;
}

/** A practice paper / worksheet / notes Claude made: opens in the document viewer. */
function docCard(d: DocRef): HTMLElement {
  const card = document.createElement("div");
  card.className = "doc-card";
  card.innerHTML = `<button class="dc-main" title="Open ${esc(d.title)}">
      <span class="dc-thumb" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="dc-text"><b>${esc(d.title)}</b><span>${d.edited?.length ? `<span class="dc-tag">Edited</span>` : ""}${esc(d.edited?.length ? d.edited.join(" · ") : d.summary)}</span></span>
    </button>
    <div class="dc-acts">
      ${d.kind !== "notes" ? `<button class="btn quiet sm" data-part="scheme">${d.kind === "paper" ? "Mark scheme" : d.kind === "interview" ? "Solutions" : "Answers"}</button>` : ""}
      <button class="btn ink-soft sm" data-part="paper">Open</button>
    </div>`;
  card.querySelector<HTMLElement>(".dc-main")!.onclick = () => openDoc(d);
  card.querySelectorAll<HTMLElement>("[data-part]").forEach((b) => (b.onclick = () => openDoc(d, b.dataset.part as "paper" | "scheme")));
  return card;
}

/** Only the newest reply is in full ink and carries Next / I'm stuck. */
function markLatest() {
  const all = Array.from(log.querySelectorAll<HTMLElement>(".entry.claude"));
  all.forEach((el, i) => {
    const last = i === all.length - 1;
    el.classList.toggle("older", !last);
    el.classList.toggle("latest", last);
    (el.previousElementSibling as HTMLElement | null)?.classList.toggle("older", !last);
    const actions = el.querySelector<HTMLElement>(".entry-actions")!;
    actions.innerHTML = "";
    if (last && actions.dataset.awaiting !== "none" && !S.busy) {
      const next = document.createElement("button");
      next.className = "btn ink-soft"; next.innerHTML = `Next <span style="font-weight:500;opacity:.7">→</span>`;
      next.onclick = () => sendTurn("Next, please.");
      const stuck = document.createElement("button");
      stuck.className = "btn quiet sm"; stuck.style.height = "32px"; stuck.textContent = "I'm stuck";
      stuck.onclick = () => sendTurn("I'm stuck. Can you give me a hint?");
      actions.append(next, stuck);
    }
  });
}

function addNotice(title: string, body: string) {
  const g = gutter("notice");
  const div = document.createElement("div");
  div.className = "entry notice";
  div.innerHTML = `<div><b>${esc(title)}</b> ${esc(body)}</div>`;
  log.append(g, div);
  scrollNotebook();
}

const scrollNotebook = () => { const nb = $("notebook"); nb.scrollTo({ top: nb.scrollHeight, behavior: "smooth" }); };

/** The live "Claude is thinking" line: its stage and a running timer. */
const STAGE_TEXT: Record<Stage, string> = {
  starting: "Starting a Claude session…", waiting: "Waiting for Claude…", thinking: "Claude is thinking…",
  writing: "Claude is writing…", fixing: "The animation hit a snag: asking Claude to fix it…",
  reading: "Claude asked to see some pages again: sending them…",
};
function pendingLine() {
  const g = gutter("pending");
  const el = document.createElement("div");
  el.className = "entry pending";
  el.innerHTML = `<span class="label">Sending…</span><span class="timer"></span>`;
  log.append(g, el);
  scrollNotebook();
  const t0 = performance.now();
  const timer = window.setInterval(() => { el.querySelector(".timer")!.textContent = `${((performance.now() - t0) / 1000).toFixed(1)} s`; }, 100);
  return {
    stage(s: Stage) { el.querySelector(".label")!.textContent = STAGE_TEXT[s]; },
    done() { clearInterval(timer); g.remove(); el.remove(); },
  };
}

// ---------------------------------------------------------------- a turn
function setBusy(b: boolean) {
  S.busy = b;
  syncComposer();
  syncOrb();
  markLatest();
}

/** POST a turn and read its stream of events (one JSON object per line) until the result. */
/** The student stopped the message before Claude finished: it's dropped, as if never sent. */
class StoppedError extends Error { constructor() { super("stopped"); } }
let turnInFlight = false;
let stopping = false;
async function stopTurn() {
  if (!turnInFlight || stopping) return;
  stopping = true;
  syncComposer();
  try { await api("/api/turn/stop", {}); } catch { /* the reply will just arrive */ }
}

async function requestTurn(body: Record<string, unknown>, pending: ReturnType<typeof pendingLine>): Promise<TutorReply> {
  const res = await fetch("/api/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.detail ?? res.statusText);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", reply: TutorReply | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as TurnEvent;
      if (ev.type === "stage") pending.stage(ev.stage);
      else if (ev.type === "usage") renderUsage(ev);
      else if (ev.type === "limits") renderLimits(ev);
      else if (ev.type === "error") throw new Error(ev.message);
      else if (ev.type === "result") reply = ev;
      else if ((ev as { type: string }).type === "stopped") throw new StoppedError();
    }
  }
  if (!reply) throw new Error("No reply from Claude.");
  return reply;
}

/** The same beat played faster: every time and duration scaled by f (< 1). */
function speedUp(b: Program["beats"][number], f: number): Program["beats"][number] {
  return { ...b, animDur: b.animDur * f, cmds: b.cmds.map((c) => ({ ...c, t: c.t * f, ...("dur" in c ? { dur: Math.max(120, c.dur * f) } : {}) })) as typeof b.cmds };
}

async function runScript(script: string) {
  const describeBefore = anim.describe;
  const r = await anim.run(script);
  return { ...r, describeBefore };
}

let predictionLog: { question: string; picked: string; answer: string; correct: boolean }[] = [];
/** What the student predicted since their last message, sent along so Claude can build on it. */
function takePredictions() { const p = predictionLog; predictionLog = []; return p; }
let askingAbout = "";  // set when "Ask Claude" in the exercise panel sends a message
let askingReview = "";  // the code, when the student asked Claude to explain its complexity

async function sendTurn(text: string, extra: string[] = [], via: "text" | "voice" = "text") {
  text = text.trim();
  if (S.busy) return;
  if (!note) await newNote();
  if (tray.uploading) { S.busy = true; syncComposer(); await tray.settled(); S.busy = false; }
  const files = tray.take();
  const image = whiteboard.hasInk ? await whiteboard.exportImage() : null;
  if (!text && !image && !files.length) return;
  if (!text) text = files.length ? (files.length === 1 ? "Here's a file." : "Here are some files.") : "Here's my drawing.";
  if (image) { whiteboard.clear(); whiteboard.close(); syncAttachment(); }
  stopSpeaking();
  hideToast();
  const userEl = addUser(text, via, image ?? undefined, files);
  turns.push({ id: 0, role: "user", via, text, data: {}, created: Date.now() / 1000 });
  transcript.push(text);
  setBusy(true);
  const pending = pendingLine();
  const noteId = note!.id;

  turnInFlight = true; stopping = false; syncComposer();
  try {
    let reply = await requestTurn({ text, note_id: noteId, via, mode, diagram: latestKind === "classic" ? describe(latest) : "",
      scene: latestKind === "anim" ? anim.describe : "", stage: anim.worldSize, images: image ? [image] : [], attachments: files.map((f) => f.id),
      exercise_id: askingAbout, predictions: takePredictions(), review_code: askingReview }, pending)
      .finally(() => { turnInFlight = false; stopping = false; syncComposer(); });
    let ran: Awaited<ReturnType<typeof runScript>> | null = null;
    if (reply.script) {
      ran = await runScript(reply.script);
      if (ran.program.error) {
        // one automatic retry: Claude gets the error and sends a fixed script
        anim.restore(ran.before, ran.describeBefore);
        pending.stage("fixing");
        const errLine = ran.program.errorLine ? reply.script.split("\n")[ran.program.errorLine - 1] ?? "" : "";
        const fixed = await requestTurn({ text: "", note_id: noteId, mode, repair: { error: ran.program.error, line: ran.program.errorLine ?? null, code: errLine } }, pending).catch(() => null);
        if (fixed?.script) {
          const again = await runScript(fixed.script);
          if (!again.program.error || again.program.beats.length >= ran.program.beats.length) {
            reply = { ...reply, script: fixed.script, note: fixed.note ?? reply.note };
            ran = again;
          } else anim.restore(ran.after, ran.program.describe);
        } else anim.restore(ran.after, ran.program.describe);
        extra = [...extra, ran.program.error ? "animation stopped early" : "animation fixed automatically"];
      }
      if (ran.program.error) console.warn("Animation script error:", ran.program.error, "line", ran.program.errorLine);
      reply.beats = alignBeats(reply, ran.program);
    }
    pending.done();
    if (!reply.beats?.length) reply.beats = [{ text: reply.say, highlight: [] }];
    if (reply.note && note?.id === reply.note.id) {
      note = reply.note;
      notes = [note, ...notes.filter((n) => n.id !== note!.id)];
      renderHeader(); renderNoteList();
    }
    { const ui = turns.map((t) => t.role).lastIndexOf("user"); if (ui >= 0 && reply.user_turn) turns[ui].id = reply.user_turn; }
    turns.push({ id: reply.tutor_turn ?? 0, role: "tutor", via: "", text: reply.say, data: reply, created: Date.now() / 1000 });
    if (reply.complexity_review) exercisePanel.showReview(reply.complexity_review);
    if (note?.id !== noteId) { setBusy(false); return; } // you switched notes while Claude was replying

    const meta = metaLine(reply, extra);
    let wi = -1;
    if (ran) {
      const program = ran.program, base = animEnd;
      if (program.beats.some((b) => b.cmds.length)) {
        wi = walks.length;
        walks.push({ title: reply.title ?? "", start: null, frames: [], beats: reply.beats, msgEl: null as any, anim: { base, program } });
        animEnd = anim.endState(base, program);
        latestKind = "anim";
      }
    } else {
      const { start, frames } = buildFrames(latest, reply.visual, reply.beats);
      if (start) {
        wi = walks.length;
        walks.push({ title: start.title, start, frames, beats: reply.beats, msgEl: null as any });
        latest = frames.at(-1)?.state ?? start;
        latestKind = "classic";
      }
    }
    const msgEl = addClaude(reply, wi, meta);
    if (reply.exercise) openExercise(reply.exercise.id);  // a new exercise opens straight away
    if (wi >= 0) walks[wi].msgEl = msgEl;
    transcript.push(reply.say);
    setBusy(false);
    decorateTurns();
    if (wi >= 0) { await openWalk(wi, true); playWalkthrough(0, ran ? 400 : 600); }
    else speakOnly(msgEl, reply.beats);
  } catch (e) {
    pending.done();
    if (e instanceof StoppedError) {
      // Take the message back out of the notebook and put it back in the box, ready to fix and resend.
      userEl.previousElementSibling?.classList.contains("gutter") && userEl.previousElementSibling.remove();
      userEl.remove();
      const i = turns.map((t) => t.role).lastIndexOf("user");
      if (i >= 0) turns.splice(i, 1);
      transcript.pop();
      if (!input.value.trim() && !text.startsWith("(")) { input.value = text; }
      setBusy(false);
      syncComposer();
      if (note?.id === noteId && !turns.length) renderHeader();
      toast("Stopped", "Claude won't see that message. It's back in the box if you want to change it.");
      return;
    }
    const msg = (e as Error).message;
    addNotice("Claude couldn't reply.", msg);
    setBusy(false);
    if (/sign(ed)? in/i.test(msg)) { await refreshAccount(); openSettings("claude"); }
  }
}

// ---------------------------------------------------------------- walkthroughs on the canvas
stage.actions = [
  { label: "Explain this", prompt: (name, id, kind) => `Explain "${name}" (${id}) in the ${kind} on screen in more detail.` },
  { label: "Why is this here?", prompt: (name, id) => `Why is "${name}" (${id}) there? What would happen without it?` },
  { label: "Walk me through it", prompt: (name, id, kind) => `Walk me through "${name}" (${id}) step by step, using the ${kind}.` },
  { label: "Quiz me on this", prompt: (name, id) => `Ask me a question to check I understand "${name}" (${id}).` },
];
stage.onAsk = (prompt) => sendTurn(prompt);
anim.player.onItemClick = (id, label, el) => { stage.openMenu(id, label, el, "animation"); };

let playToken = 0;
let playing = false;
const readMs = (text: string) => Math.max(1400, text.split(/\s+/).length * 330);

/** Put walkthrough i on the canvas, at its start (or its last step, for browsing history). */
async function openWalk(i: number, animate = true, atEnd = false) {
  if (i < 0 || i >= walks.length) return;
  stopSpeaking();
  walkIdx = i;
  const w = walks[i];
  captionEl.textContent = w.title;
  if (w.anim) {
    showHost("anim");
    beatIdx = atEnd ? steps(w) - 1 : -1;
    animAt = atEnd ? steps(w) : 0;
    anim.seek(w.anim.base, w.anim.program, animAt);
  } else {
    showHost("classic");
    if (atEnd && w.frames.length) { beatIdx = w.frames.length - 1; await stage.show(w.frames[beatIdx].state, [], animate); }
    else { beatIdx = -1; await stage.show(w.start, [], animate); }
  }
  karaoke(null);
  renderWalkBar();
}

/** Light up the sentence being spoken; dim the ones still to come. */
function karaoke(el: HTMLElement | null, i = -1) {
  log.querySelectorAll(".said.playing").forEach((s) => s.classList.remove("playing"));
  log.querySelectorAll(".beat.speaking, .beat.ahead").forEach((s) => s.classList.remove("speaking", "ahead"));
  if (!el || i < 0) return;
  const said = el.querySelector(".said");
  said?.classList.add("playing");
  el.querySelectorAll<HTMLSpanElement>(".beat").forEach((b, j) => { b.classList.toggle("speaking", j === i); b.classList.toggle("ahead", j > i); });
}

function renderWalkBar() {
  const w = walks[walkIdx];
  const has = !!w;
  for (const id of ["wRestart", "wPrev", "wNext", "wPlay"]) $<HTMLButtonElement>(id).disabled = !has;
  $<HTMLButtonElement>("hPrev").disabled = walkIdx <= 0;
  $<HTMLButtonElement>("hNext").disabled = walkIdx >= walks.length - 1;
  $("hPrev").style.visibility = $("hNext").style.visibility = walks.length > 1 ? "visible" : "hidden";
  const atEnd = !w || beatIdx >= steps(w) - 1;
  wPlay.innerHTML = icon(playing ? "pause" : atEnd ? "replay" : "play");
  wPlay.title = playing ? "Pause (Esc)" : atEnd ? "Replay" : "Play from here";
  wPlay.setAttribute("aria-label", wPlay.title);
  if (!w) { wLabel.textContent = ""; wDots.innerHTML = ""; return; }
  wLabel.textContent = beatIdx < 0 ? `${steps(w)} steps` : `Step ${beatIdx + 1} of ${steps(w)}`;
  wDots.innerHTML = "";
  w.beats.slice(0, steps(w)).forEach((_, j) => {
    const d = document.createElement("button");
    d.className = (j < beatIdx ? "done" : j === beatIdx ? "now" : "") + (w.anim?.program.beats[j]?.predict ? " q" : "");
    d.title = (w.anim?.program.beats[j]?.predict ? "Predict: " : "") + (w.beats[j]?.text ?? "");
    d.setAttribute("aria-label", `Step ${j + 1}`);
    d.onclick = () => playWalkthrough(j, 0, j);
    wDots.appendChild(d);
  });
}

function stopSpeaking() {
  playToken++;
  predictCard.close(null);
  playing = false;
  currentAudio?.pause();
  currentAudio = null;
  speechSynthesis.cancel();
  setSpeaking(false);
  renderWalkBar();
}
function setSpeaking(on: boolean) {
  speaking = on; syncOrb();
  // While Claude talks, you can interrupt just by talking.
  if (on) watchForSpeech(() => { if (speaking && micPhase === "idle" && !S.busy) startRecording({ handsFree: true }); });
  else stopWatching();
}

const useKokoro = () => S.status.tts && chosenVoice(S.status.tts).startsWith("kokoro:");
async function fetchTts(text: string, voiceOverride?: string): Promise<Blob | null> {
  try {
    const voice = voiceOverride ?? chosenVoice(true).replace(/^kokoro:/, "");
    const res = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice, speed: voiceRate() }) });
    return res.ok ? await res.blob() : null;
  } catch { return null; }
}
function playBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(URL.createObjectURL(blob));
    currentAudio = a;
    a.onended = a.onpause = a.onerror = () => resolve();
    a.play().catch(() => resolve());
  });
}
function speakBrowser(text: string, voiceId?: string): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = browserVoice(voiceId ?? chosenVoice(S.status.tts));
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = voiceRate();
    const done = () => { clearTimeout(safety); resolve(); };
    const safety = setTimeout(done, readMs(text) * 1.8 + 2000); // some systems never fire onend
    u.onend = u.onerror = done;
    speechSynthesis.speak(u);
  });
}
/** Say one beat: Kokoro if installed, else the system voice, else just wait reading time. */
async function sayBeat(text: string, audio: Promise<Blob | null> | null, token: number) {
  if (!S.voiceOn) return sleep(readMs(text));
  if (audio) {
    const blob = await audio;
    if (token !== playToken) return;
    if (blob) return playBlob(blob);
  }
  return speakBrowser(text);
}

/** Play beats from..to: each changes the visual while its sentence is spoken and lit up. */
async function playWalkthrough(from: number, leadInMs = 0, to?: number) {
  stopSpeaking();
  predictCard.close(null);
  const token = playToken;
  const w = walks[walkIdx];
  if (!w || !steps(w)) return;
  const last = Math.min(to ?? steps(w) - 1, steps(w) - 1);
  playing = true;
  setSpeaking(true);
  renderWalkBar();
  if (leadInMs) await sleep(leadInMs);
  const audio = S.voiceOn && useKokoro() ? w.beats.map((b, j) => (j >= from && j <= last ? fetchTts(b.text) : Promise.resolve(null))) : null;

  for (let i = from; i <= last; i++) {
    if (token !== playToken) return;
    beatIdx = i;
    renderWalkBar();
    karaoke(w.msgEl, i);
    if (w.anim) {
      if (animAt !== i) anim.seek(w.anim.base, w.anim.program, i);
      const pb0 = w.anim.program.beats[i];
      // a beat with far more animation than words would play on in silence: speed it up (at most 2.5x)
      const words = (w.beats[i]?.text ?? "").split(/\s+/).filter(Boolean).length;
      const target = Math.max(((words * 360) / Math.max(0.5, voiceRate() || 1)) * 1.5, 5000);
      const pb = pb0.animDur > target ? speedUp(pb0, Math.max(0.4, target / pb0.animDur)) : pb0;
      anim.player.play(pb.cmds);
      animAt = i + 1;
      const t0 = performance.now();
      await sayBeat(w.beats[i]?.text ?? "", audio?.[i] ?? null, token);
      if (token !== playToken) return;
      const rest = pb.animDur + 250 - (performance.now() - t0);
      if (rest > 0) await sleep(rest);
      const pred = w.anim.program.beats[i]?.predict;
      if (pred && token === playToken) {
        setSpeaking(false);
        const got = await predictCard.ask(pred);
        if (token !== playToken) return;
        if (got) predictionLog.push(got);
        setSpeaking(true);
      }
    } else {
      const frame = w.frames[i];
      const before = i > 0 ? w.frames[i - 1].state : w.start;
      stage.show(frame.state, frame.highlight, true);
      const t0 = performance.now();
      await sayBeat(w.beats[i].text, audio?.[i] ?? null, token);
      if (token !== playToken) return;
      const rest = (frame.state !== before ? 1000 : 300) - (performance.now() - t0);
      if (rest > 0) await sleep(rest);
    }
    if (token !== playToken) return;
    await sleep(180);
  }
  if (token !== playToken) return;
  playing = false;
  setSpeaking(false);
  karaoke(null);
  if (last === steps(w) - 1 && !w.anim) stage.highlight([]);
  renderWalkBar();
}

/** A reply without a visual: just narrate it, lighting up each sentence. */
async function speakOnly(msgEl: HTMLElement, beats: Beat[]) {
  stopSpeaking();
  const token = playToken;
  setSpeaking(true);
  const audio = S.voiceOn && useKokoro() ? beats.map((b) => fetchTts(b.text)) : null;
  for (let i = 0; i < beats.length; i++) {
    if (token !== playToken) return;
    karaoke(msgEl, i);
    await sayBeat(beats[i].text, audio?.[i] ?? null, token);
  }
  if (token === playToken) { karaoke(null); setSpeaking(false); }
}

async function replayReply(walkIndex: number, msgEl: HTMLElement, beats: Beat[]) {
  if (walkIndex < 0) return speakOnly(msgEl, beats);
  await openWalk(walkIndex);
  playWalkthrough(0, 400);
}

$("wRestart").onclick = async () => { await openWalk(walkIdx); playWalkthrough(0, 300); };
$("wPrev").onclick = () => { const w = walks[walkIdx]; if (!w) return; if (beatIdx <= 0) openWalk(walkIdx); else playWalkthrough(beatIdx - 1, 0, beatIdx - 1); };
$("wNext").onclick = () => { const w = walks[walkIdx]; if (!w) return; if (beatIdx < steps(w) - 1) playWalkthrough(beatIdx + 1, 0, beatIdx + 1); };
wPlay.onclick = async () => {
  const w = walks[walkIdx]; if (!w) return;
  if (playing) { stopSpeaking(); return; }
  if (beatIdx >= steps(w) - 1) { await openWalk(walkIdx); playWalkthrough(0, 300); } else playWalkthrough(beatIdx + 1);
};
$("hPrev").onclick = () => openWalk(walkIdx - 1, true, true);
$("hNext").onclick = () => openWalk(walkIdx + 1, true, true);
$("expandBtn").onclick = () => {
  const big = appEl.classList.toggle("canvas-big");
  $("expandBtn").innerHTML = icon(big ? "shrink" : "expand");
  $("expandBtn").title = big ? "Show the notebook again" : "Expand canvas";
  requestAnimationFrame(() => anim.player.refit());
};

// ---------------------------------------------------------------- previews (Settings)
async function previewVoice(voiceId?: string) {
  stopSpeaking();
  const token = playToken;
  const text = "Hi! I'll talk you through things step by step. Ask me anything.";
  const id = voiceId ?? chosenVoice(S.status.tts);
  if (id.startsWith("kokoro:") && S.status.tts) {
    const blob = await fetchTts(text, id.slice(7));
    if (token !== playToken) return; // a newer preview started meanwhile: stay silent
    if (blob) { setSpeaking(true); await playBlob(blob); if (token === playToken) setSpeaking(false); return; }
  }
  if (token !== playToken) return;
  setSpeaking(true);
  await speakBrowser(text, id.startsWith("browser:") ? id : undefined);
  if (token === playToken) setSpeaking(false);
}

// ---------------------------------------------------------------- the orb and the bottom bar
function syncOrb() {
  const p = micPhase;
  const state = p === "listening" ? "listening" : p === "starting" ? "starting" : p === "finishing" || S.busy ? "thinking" : speaking ? "speaking" : "idle";
  orb.dataset.state = state;
  const mic = $("mic");
  mic.setAttribute("aria-label", state === "speaking" ? "Claude is speaking. Click or press Esc to stop" : state === "listening" ? "Listening. Release to send" : state === "thinking" ? "Claude is thinking" : "Hold to talk");
  const hint = $("bbHint");
  hint.innerHTML = state === "listening" || state === "starting"
    ? `<span>Release <kbd class="sm">Space</kbd> to send</span><span><kbd class="sm">Esc</kbd> to cancel</span>`
    : state === "speaking" ? `<span><kbd class="sm">Esc</kbd> to stop</span>` : "";
}
function renderMute() {
  const b = $("muteBtn");
  b.innerHTML = icon(S.voiceOn ? "volume" : "volumeOff");
  b.classList.toggle("off", !S.voiceOn);
  b.title = S.voiceOn ? "Mute Claude's voice" : "Unmute Claude's voice";
  b.setAttribute("aria-label", b.title);
}
function setVoiceOn(on: boolean) {
  S.voiceOn = on;
  localStorage.setItem("chalk.voiceOn", on ? "1" : "0");
  if (!on) { currentAudio?.pause(); speechSynthesis.cancel(); }
  renderMute();
}
$("muteBtn").onclick = () => setVoiceOn(!S.voiceOn);
// clicking the orb while Claude talks stops it (instead of starting to record)
$("mic").addEventListener("pointerdown", (e) => { if (speaking && micPhase === "idle") { e.stopImmediatePropagation(); stopSpeaking(); } }, true);

function renderMode() {
  $("modeSeg").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
}
async function setMode(m: string) {
  mode = m;
  renderMode();
  if (note) {
    note = await api<Note>(`/api/notes/${note.id}`, { mode: m }, "PATCH").catch(() => note);
    notes = notes.map((n) => (n.id === note!.id ? note! : n));
    renderNoteList();
  }
}
$("modeSeg").querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode!)));

// ---------------------------------------------------------------- composer
/** Put a request in the composer for you to tweak (exam board, topics…) before sending. */
function askFor(text: string) {
  input.value = text;
  syncComposer();
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

function syncComposer() {
  const has = !!input.value.trim() || codeBoxes.count > 0 || whiteboard.hasInk || tray.count > 0
    || (firstRunShown() && !!firstInput.value.trim());
  sendBtn.classList.toggle("ready", has && !S.busy);
  // While Claude is working on your message, the send button stops it.
  const stopMode = turnInFlight;
  if (sendBtn.classList.contains("stop") !== stopMode) {
    sendBtn.classList.toggle("stop", stopMode);
    sendBtn.innerHTML = icon(stopMode ? "stopsq" : "send");
    sendBtn.setAttribute("aria-label", stopMode ? "Stop (Esc)" : "Send");
    sendBtn.title = stopMode ? "Stop: Claude won't see this message (Esc)" : "";
  }
  sendBtn.disabled = stopMode ? stopping : S.busy;
  input.style.height = "34px";
  input.style.height = `${Math.min(160, input.scrollHeight)}px`;
}
composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (turnInFlight) { stopTurn(); return; }
  if (S.busy) return; // keep what you wrote until Claude has answered
  const code = codeBoxes.markdown();
  const written = [firstRunShown() ? firstInput.value.trim() : "", input.value.trim()].filter(Boolean).join("\n\n");
  const t = [written, code].filter(Boolean).join("\n\n");
  if (!t.trim() && !whiteboard.hasInk && !tray.count) return;
  input.value = "";
  clearFirst(); firstInput.blur();
  codeBoxes.clear(); $("pasteNote").hidden = true;
  syncComposer();
  input.blur(); // so Space goes back to push-to-talk
  sendTurn(t);
});
input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); } });

const codeBoxes = new CodeBoxes($("codeBoxes"));
codeBoxes.onSubmit = () => composer.requestSubmit();
codeBoxes.onLeave = () => input.focus();
codeBoxes.onChange = () => { $("codeBtn").classList.toggle("active", codeBoxes.count > 0); syncComposer(); };
$("codeBtn").onclick = () => codeBoxes.add();
// typing ``` opens a code box
input.addEventListener("input", () => {
  syncComposer();
  const pos = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, pos);
  const m = before.match(/(^|\n)```([\w+#.-]*)(\n| )?$/);
  if (!m || (m[2] && !m[3])) return;
  input.value = before.slice(0, before.length - m[0].length + m[1].length).replace(/\n$/, "") + input.value.slice(pos);
  codeBoxes.add("", m[2] || undefined);
});
// ---------------------------------------------------------------- files for Claude (PDFs, images)
const tray = new FileTray($("fileTray"));
tray.onChange = () => { $("attachBtn").classList.toggle("active", tray.count > 0); syncComposer(); };
tray.onOpen = (m) => openUpload(m);
$("attachBtn").onclick = () => $<HTMLInputElement>("fileInput").click();
$<HTMLInputElement>("fileInput").onchange = (e) => {
  const inp = e.target as HTMLInputElement;
  if (inp.files?.length) tray.add(inp.files);
  inp.value = "";
  input.focus();
};
initDrop(document.body, (f) => { tray.add(f); input.focus(); }, () => !$("mainView").hidden);
// pasted screenshots and copied files
document.addEventListener("paste", (e) => {
  const files = Array.from(e.clipboardData?.files ?? []);
  if (!files.length || $("mainView").hidden) return;
  e.preventDefault();
  tray.add(files);
  input.focus();
});

// pasting code puts it in a code box (with a way back)
let pasteTimer = 0;
input.addEventListener("paste", (e) => {
  if (e.clipboardData?.files.length) return;  // files are handled above
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (!looksLikeCode(text)) return;
  e.preventDefault();
  const fenced = text.match(/^\s*```([\w+#.-]*)\n([\s\S]*?)\n?```\s*$/);
  codeBoxes.add(fenced ? fenced[2] : text.replace(/\s+$/, ""), fenced?.[1] || undefined);
  $("pasteNote").hidden = false;
  clearTimeout(pasteTimer);
  pasteTimer = window.setTimeout(() => ($("pasteNote").hidden = true), 8000);
});
$("pasteUndo").onclick = () => {
  const t = codeBoxes.popText();
  input.setRangeText(t, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, "end");
  $("pasteNote").hidden = true;
  input.focus(); syncComposer();
};

// ---------------------------------------------------------------- whiteboard
const whiteboard = new Whiteboard($("wb"), $("stageArea"));
function syncAttachment() {
  const show = whiteboard.hasInk && !whiteboard.isOpen;
  $("attachChip").hidden = !show;
  $("drawBtn").classList.toggle("active", whiteboard.isOpen || whiteboard.hasInk);
  $("drawOnCanvas").classList.toggle("on", whiteboard.isOpen);
  if (show) whiteboard.exportImage().then((url) => { if (url) $<HTMLImageElement>("attachThumb").src = url; });
  syncComposer();
}
whiteboard.onChange = syncAttachment;
const toggleDraw = () => {
  if (whiteboard.isOpen) whiteboard.close();
  else { appEl.classList.remove("focus"); whiteboard.open(walks.length ? "visual" : "blank"); }
  syncAttachment();
};
$("drawBtn").onclick = toggleDraw;
$("drawOnCanvas").onclick = toggleDraw;
$("wbDone").onclick = () => { whiteboard.close(); syncAttachment(); };
$("attachEdit").onclick = () => { whiteboard.open(); syncAttachment(); };
$("attachRemove").onclick = () => { whiteboard.clear(); syncAttachment(); };

// ---------------------------------------------------------------- voice in
initVoiceIn({
  send: async (text, meta) => { if (predictCard.awaiting && predictCard.voice(text)) return; await sendTurn(text, [meta], "voice"); },
  stopSpeaking,
  hint: () => transcript.slice(-2).join(" "),
  onPhase: (_p: MicPhase) => syncOrb(),
  needVoicePack: () => openSettings("claude"),
});

// ---------------------------------------------------------------- export
async function exportNote() {
  if (!note || !turns.length) { toast("Nothing to export yet", "This note is empty."); return; }
  const res = await fetch(`/api/notes/${note.id}/export`);
  const md = await res.text();
  const name = `${(note.title || "Untitled").replace(/[\\/:*?"<>|]+/g, "").slice(0, 60) || "note"}.md`;
  if (await saveText(name, md)) toast("Exported", `Saved as ${esc(name)}.`, 4000);
}

// ---------------------------------------------------------------- command palette
const PERSONAS: [string, string][] = [
  ["professor", "Critique as a professor"], ["staff engineer", "Critique as a staff engineer"], ["sceptical investor", "Critique as a sceptical investor"],
];
const MODES: [string, string, string][] = [
  ["tutor", "Switch to Tutor", "Explains one step at a time"], ["partner", "Switch to Thinking partner", "Listens, asks why, rarely explains"],
  ["quiz", "Switch to Quiz", "Asks questions, revisits weak spots"], ["answer", "Switch to Just answer", "Answers directly"],
];
const palette = new Palette($("palette"), async (q): Promise<PaletteItem[]> => {
  const items: PaletteItem[] = [];
  for (const [m, label, sub] of MODES) if (m !== mode) items.push({ group: "Mode", label, side: sub, icon: "chat", run: () => setMode(m) });
  const found = q ? (await api<{ notes: (Note & { hit?: string })[] }>(`/api/search?q=${encodeURIComponent(q)}`).catch(() => ({ notes: [] }))).notes : notes.slice(0, 5);
  for (const n of found) items.push({ group: "Notes", label: n.title || n.preview || "Untitled", sub: n.hit && !(n.title ?? "").toLowerCase().includes(q.toLowerCase()) ? n.hit.slice(0, 60) : undefined, side: when(n.updated), icon: "file", run: () => openNote(n.id) });
  for (const [p, label] of PERSONAS) items.push({ group: "Persona", label, icon: "person", run: () => sendTurn(`Critique what we've discussed in this note as a ${p} would: be specific and direct about the weak spots.`) });
  items.push(
    { group: "Actions", label: "New note", keys: ["Ctrl", "N"], icon: "plus", run: () => newNote() },
    { group: "Actions", label: "Export this note as Markdown", keys: ["Ctrl", "E"], icon: "download", run: () => exportNote() },
    { group: "Actions", label: "Make a practice paper", sub: "timed, with a mark scheme", icon: "paper", run: () => askFor("Make me a practice paper on what we've covered in this note. Ask me first if you need to know the exam board, level or length.") },
    { group: "Actions", label: "Make revision notes", sub: "to print or keep as a PDF", icon: "file", run: () => askFor("Make me revision notes (as a document I can save as a PDF) on what we've covered in this note.") },
    { group: "Actions", label: "Draw on the canvas", icon: "pen", run: () => toggleDraw() },
    { group: "Actions", label: "Write some code", icon: "code", run: () => codeBoxes.add() },
    { group: "Actions", label: document.documentElement.dataset.theme === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: document.documentElement.dataset.theme === "dark" ? "sun" : "moon", run: () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark") },
    { group: "Actions", label: "Focus mode", sub: "hide notes and canvas", keys: ["Ctrl", "."], icon: "focus", run: () => toggleFocus() },
    { group: "Actions", label: S.voiceOn ? "Mute Claude's voice" : "Unmute Claude's voice", icon: S.voiceOn ? "volumeOff" : "volume", run: () => setVoiceOn(!S.voiceOn) },
    { group: "Actions", label: "Settings", keys: ["Ctrl", ","], icon: "sliders", run: () => openSettings() },
    { group: "Actions", label: "Keyboard shortcuts", icon: "keyboard", run: () => openSettings("shortcuts") },
  );
  if (note && turns.length) items.push({ group: "Actions", label: "Delete this note", icon: "trash", run: () => deleteNote(note!.id) });
  return items;
});
$("sbSearch").onclick = () => palette.open();
$("sbNew").onclick = () => newNote();
$("openSettings").onclick = () => openSettings();
$("usageMini").onclick = () => openSettings("claude");
$("sidebarToggle").onclick = () => { appEl.classList.remove("focus"); appEl.classList.toggle("no-sidebar"); requestAnimationFrame(() => anim.player.refit()); };
function toggleFocus() { appEl.classList.toggle("focus"); requestAnimationFrame(() => anim.player.refit()); }

/** Settings take over the window; the title bar's first button becomes "back". */
function openSettings(section?: Parameters<typeof openSettingsView>[0]) {
  stopSpeaking();
  openSettingsView(section);
  const t = $("sidebarToggle");
  t.innerHTML = icon("back"); t.title = "Back to notes (Esc)"; t.setAttribute("aria-label", "Back to notes");
  $("crumb").textContent = "Settings";
}
function closeSettings() {
  const t = $("sidebarToggle");
  t.innerHTML = icon("sidebar"); t.title = "Notes list (Ctrl+\\)"; t.setAttribute("aria-label", "Show or hide the notes list");
  $("crumb").textContent = note?.title || "Untitled";
  $("settingsView").hidden = true;
  $("mainView").hidden = false; $("bottombar").hidden = false;
  renderMute();
  requestAnimationFrame(() => anim.player.refit());
}

// ---------------------------------------------------------------- selection toolbar: ask about text you select
const selBar = document.createElement("div");
selBar.className = "sel-toolbar"; selBar.hidden = true; selBar.setAttribute("role", "toolbar"); selBar.setAttribute("aria-label", "Ask about the selection");
selBar.innerHTML = [["explain", "Explain"], ["draw", "Draw this"], ["quiz", "Quiz me"], ["challenge", "Challenge"]].map(([k, l]) => `<button data-sel="${k}">${l}</button>`).join("");
document.body.appendChild(selBar);
let selText = "";
document.addEventListener("selectionchange", () => {
  const sel = getSelection();
  const text = sel?.toString().trim() ?? "";
  const inNotebook = sel?.rangeCount && $("notebook").contains(sel.getRangeAt(0).commonAncestorContainer) && document.activeElement !== titleEl;
  if (!text || !inNotebook || text.length > 600) { selBar.hidden = true; return; }
  selText = text;
  const r = sel!.getRangeAt(0).getBoundingClientRect();
  selBar.hidden = false;
  selBar.style.left = `${Math.max(8, Math.min(innerWidth - selBar.offsetWidth - 8, r.left + r.width / 2 - selBar.offsetWidth / 2))}px`;
  selBar.style.top = `${Math.max(52, r.top - selBar.offsetHeight - 10)}px`;
});
selBar.addEventListener("pointerdown", (e) => e.preventDefault()); // keep the selection
selBar.addEventListener("click", (e) => {
  const k = (e.target as HTMLElement).closest<HTMLElement>("[data-sel]")?.dataset.sel;
  if (!k) return;
  selBar.hidden = true;
  getSelection()?.removeAllRanges();
  const q = `“${selText}”`;
  sendTurn(k === "explain" ? `Explain this: ${q}` : k === "draw" ? `Draw this for me, step by step: ${q}` : k === "quiz" ? `Quiz me on this: ${q}` : `Challenge this. What's wrong or missing? ${q}`);
});

// ---------------------------------------------------------------- keyboard
/** Space talks unless you're typing: an empty message box still counts as "not typing". */
function spaceShouldTalk(): boolean {
  if (palette.isOpen || settingsOpen() || !$("welcomeView").hidden) return false;
  const el = document.activeElement;
  if (el === input) return input.value.trim() === "";
  if (el === firstInput) return firstInput.value.trim() === "";
  if (el instanceof HTMLElement && el.isContentEditable) return false;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return false;
  return true;
}
/** A printable key pressed while nothing that takes text has focus. */
function startsTyping(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.isComposing) return false;
  if (palette.isOpen || settingsOpen() || docOpen() || whiteboard.isOpen || $("mainView").hidden || micPhase !== "idle") return false;
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return false;
  if (el instanceof HTMLElement && (el.isContentEditable || el.closest(".cm-editor"))) return false;
  return true;
}
window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (docOpen() && !palette.isOpen && (e.key === "Escape" || (mod && ["p", "s", "=", "+", "-", "0"].includes(e.key)))) {
    if (docKey(e.key, mod)) { e.preventDefault(); return; }
  }
  if (e.key === "Escape") {
    if (micPhase === "starting" || micPhase === "listening") { cancelRecording(); return; }
    if (palette.isOpen) return;
    if (whiteboard.isOpen) { whiteboard.close(); syncAttachment(); return; }
    if (settingsOpen()) { closeSettings(); return; }
    if (turnInFlight) { stopTurn(); return; }
    if (appEl.classList.contains("canvas-big")) { $("expandBtn").click(); }
    stopSpeaking();
    return;
  }
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); palette.isOpen ? palette.close() : palette.open(); return; }
  if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newNote(); return; }
  if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); exportNote(); return; }
  if (mod && e.key === ",") { e.preventDefault(); settingsOpen() ? closeSettings() : openSettings(); return; }
  if (mod && e.key === "\\") { e.preventDefault(); $("sidebarToggle").click(); return; }
  if (mod && e.key === ".") { e.preventDefault(); toggleFocus(); return; }
  if (whiteboard.isOpen && mod && e.key.toLowerCase() === "z") { e.preventDefault(); ($("wb").querySelector("[data-tool=undo]") as HTMLButtonElement).click(); return; }
  if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && spaceShouldTalk() && document.activeElement !== input) {
    e.preventDefault(); $(e.key === "ArrowLeft" ? "wPrev" : "wNext").click(); return;
  }
  if (predictCard.isOpen && !palette.isOpen && predictCard.key(e)) { e.preventDefault(); return; }
  if (e.code !== "Space" && startsTyping(e)) {
    // Not focused on anything you can type in: the key starts your message (on the page if the note is empty).
    (firstRunShown() ? firstInput : input).focus();
    return;  // the browser then types the key into it
  }
  if (e.code !== "Space") return;
  const ctrlTalk = e.ctrlKey && !settingsOpen() && !palette.isOpen;
  if (e.repeat || micPhase !== "idle") { if (micHolding || micPhase !== "idle") e.preventDefault(); return; }
  if (!ctrlTalk && !spaceShouldTalk()) return;
  e.preventDefault();
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur(); // don't "click" it on release
  startRecording();
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && (micHolding || micPhase === "listening")) { e.preventDefault(); stopRecording(); }
});

initDocView({ onClose: () => {} });

// ---------------------------------------------------------------- coding exercises
const exercisePanel = new ExercisePanel($("exView"), {
  close: closeExercise,
  expand: () => $("expandBtn").click(),
  settings: () => openSettings("coding"),
  ask: (text, id, extra) => { askingAbout = id; askingReview = extra?.review_code ?? ""; return sendTurn(text).finally(() => { askingAbout = ""; askingReview = ""; }); },
});
(window as any).__chalkTest = { setCode: (c: string) => exercisePanel.setCode(c), matchSpoken };
async function openExercise(id: string) {
  if (!(await exercisePanel.open(id))) return;
  $("canvas").classList.add("ex-mode");
  $("exView").hidden = false;
  requestAnimationFrame(() => exercisePanel.focus());
}
function closeExercise() {
  $("canvas").classList.remove("ex-mode");
  $("exView").hidden = true;
  if (walks[walkIdx]?.anim) requestAnimationFrame(() => anim.player.refit());
}

// ---------------------------------------------------------------- settings hooks
initSettings({
  close: closeSettings,
  refreshAccount,
  saveSettings,
  theme: () => themePref,
  setTheme,
  previewVoice,
  async deleteAllNotes() { await api("/api/notes/delete-all", {}); notes = []; note = null; await newNote(); closeSettings(); },
  async reloadStatus() { await loadStatus(); },
  setVoiceOn,
  setReduceMotion,
});
// the settings page's own back button lives in the title bar while it's open
$("sidebarToggle").addEventListener("click", (e) => { if (settingsOpen()) { e.stopImmediatePropagation(); closeSettings(); } }, true);

// ---------------------------------------------------------------- start
async function start() {
  applyTheme();
  renderMute();
  renderMode();
  syncOrb();
  syncComposer();
  renderWalkBar();
  await loadStatus();
  await refreshAccount();
  loadSettings();
  await loadNotes();
  const last = localStorage.getItem("chalk.lastNote");
  const pick = notes.find((n) => n.id === last) ?? notes[0];
  if (pick) await openNote(pick.id); else await newNote();
  if (!S.account?.auth.loggedIn || !localStorage.getItem("chalk.welcomed")) {
    showWelcome(() => { $("mainView").hidden = false; $("bottombar").hidden = false; applyTheme(); api("/api/warmup", {}).catch(() => {}); });
    if (S.account?.login.running) renderWelcome();
  } else api("/api/warmup", {}).catch(() => {});
  // Usage moves in other apps too (claude.ai, Claude Code), so check now and then.
  setInterval(() => { if (!document.hidden) refreshLimits(); }, 3 * 60_000);
  window.addEventListener("focus", () => refreshLimits());
}
start();
