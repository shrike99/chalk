/**
 * Settings (a full page, as in the design): General, Claude & voice, Visuals, Coding, Shortcuts, Privacy, About.
 * Also the welcome screen shown until you've signed in to Claude.
 */
import { bargeInEnabled, setBargeIn } from "./bargein";
import { $, S, api, esc, who, plan, planName, resetsIn, fmtBytes, confirmBox, toast, type Account } from "./ctx";
import { icon } from "./icons";
import { desktop, isDesktop, openLink, type VoiceInstallEvent } from "./desktop";
import { availableVoices, chosenVoice, setVoice, voiceRate, setVoiceRate, setKokoroCatalogue, type KokoroVoice } from "./voices";
import { micTest } from "./voicein";

export type ThemePref = "system" | "light" | "dark";
export interface SettingsHooks {
  close(): void;
  refreshAccount(): Promise<void>;
  saveSettings(patch: Record<string, unknown>): Promise<void>;
  theme(): ThemePref;
  setTheme(t: ThemePref): void;
  previewVoice(id?: string): void;
  deleteAllNotes(): Promise<void>;
  reloadStatus(): Promise<void>;
  setVoiceOn(on: boolean): void;
  setReduceMotion(on: boolean): void;
}

export type Section = "general" | "claude" | "visuals" | "coding" | "shortcuts" | "privacy" | "about";
const SECTIONS: [Section, string][] = [["general", "General"], ["claude", "Claude & voice"], ["visuals", "Visuals"], ["coding", "Coding"], ["shortcuts", "Shortcuts"], ["privacy", "Privacy"], ["about", "About Chalk"]];

export interface Toolchain {
  id: string; name: string; state: "builtin" | "ready" | "missing" | "installing" | "error"; detail?: string; source?: string;
  can_download?: boolean; progress?: { phase: string; done: number; total: number; error?: string };
}
let chains: Toolchain[] | null = null;
let chainTimer = 0;
const LANG_ICON: Record<string, string> = { python: "Py", javascript: "JS", java: "Jv", c: "C", sql: "SQL" };

interface VoiceStore { available: boolean; voices: KokoroVoice[]; models: { name: string; bytes: number }[]; cache_dir?: string; error?: string }
let H: SettingsHooks;
let section: Section = "claude";
let store: VoiceStore | null = null;
let filter: "installed" | "all" = "installed";
let install: { running: boolean; step: string; pct: number; log: string[]; error?: string } = { running: false, step: "", pct: 0, log: [] };

const seg = (key: string, items: [string, string][], current: string, sm = true) =>
  `<div class="seg${sm ? " sm" : ""}" role="group" data-seg="${key}">${items.map(([v, l]) => `<button data-v="${esc(v)}" class="${v === current ? "on" : ""}">${esc(l)}</button>`).join("")}</div>`;
const sw = (key: string, on: boolean, label: string) => `<button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-switch="${key}"></button>`;
const row = (title: string, sub: string, control: string) => `<div class="st-row"><div class="st-label"><span>${title}</span>${sub ? `<span>${sub}</span>` : ""}</div>${control}</div>`;

export function initSettings(hooks: SettingsHooks) {
  H = hooks;
  desktop?.voice.onEvent(onInstallEvent);
}

export async function openSettings(to?: Section) {
  if (to) section = to;
  $("mainView").hidden = true; $("bottombar").hidden = true; $("welcomeView").hidden = true;
  const v = $("settingsView");
  v.hidden = false;
  render();
  H.refreshAccount().then(render);
  loadStore().then(render);
  if (section === "coding") loadChains();
}

export async function loadChains() {
  try { chains = (await api<{ languages: Toolchain[] }>("/api/toolchains")).languages; } catch { chains = chains ?? []; }
  clearTimeout(chainTimer);
  if (chains.some((c) => c.state === "installing")) chainTimer = window.setTimeout(loadChains, 600);
  if (settingsOpen() && section === "coding") render();
  return chains;
}
export const settingsOpen = () => !$("settingsView").hidden;

async function loadStore() {
  if (!S.status.tts) { store = null; return; }
  try { store = await api<VoiceStore>("/api/voices"); setKokoroCatalogue(store.voices); } catch { store = null; }
}

function render() {
  const v = $("settingsView");
  const scroll = v.querySelector(".st-main")?.scrollTop ?? 0;
  v.innerHTML = `
    <nav class="st-nav" aria-label="Settings sections">
      ${SECTIONS.map(([k, l]) => `<button data-sec="${k}" class="${k === section ? "on" : ""}">${l}</button>`).join("")}
    </nav>
    <main class="st-main"><div class="st-inner">${body()}</div></main>`;
  v.querySelector(".st-main")!.scrollTop = scroll;
  wire(v);
}

function body(): string {
  switch (section) {
    case "general": return general();
    case "claude": return claude();
    case "visuals": return visuals();
    case "coding": return coding();
    case "shortcuts": return shortcuts();
    case "privacy": return privacy();
    case "about": return about();
  }
}

// ---------------------------------------------------------------- sections
function general() {
  const reduce = localStorage.getItem("chalk.reduceMotion") === "1";
  return `<h1>General</h1>
  <section class="st-sec"><h2>Appearance</h2><div class="card">
    ${row("Theme", "Paper in the day, slate at night. System follows Windows.", seg("theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], H.theme()))}
    ${row("Reduce motion", "Swaps animations for quick fades. Diagrams still change step by step.", sw("reduce", reduce, "Reduce motion"))}
  </div></section>
  <section class="st-sec"><h2>Notes</h2><div class="card">
    ${row("Mode for new notes", "You can switch mode at any time from the bottom bar.", seg("default_mode", [["tutor", "Tutor"], ["partner", "Partner"], ["quiz", "Quiz"], ["answer", "Answer"]], S.settings.default_mode ?? "tutor"))}
    ${row("Send when I let go", "Off: your spoken words land in the message box so you can edit them first.", sw("autosend", S.autoSend, "Send voice messages when I let go"))}
    ${row("Speak Claude's replies", "Off: replies are shown, not spoken. Same as the speaker button.", sw("voiceon", S.voiceOn, "Speak Claude's replies"))}
  </div></section>`;
}

function accountRow(): string {
  const acc = S.account;
  if (!acc) return row("Account", "Checking…", "");
  const a = acc.auth;
  if (a.loggedIn) {
    return row("Signed in", `${esc(who(a))}${plan(a) ? ` · ${esc(plan(a))}` : ""}${a.usingApiKey ? " · <b>this login bills an API account</b>: sign in with your Claude Pro account instead" : ""}`,
      `<button class="btn secondary sm" data-act="logout">${icon("logout")}Sign out</button>`);
  }
  if (acc.login.running) {
    return `<div class="st-row col"><div class="st-label"><span>Finish signing in in your browser</span>
      <span>A browser tab opened for your Claude account. ${acc.login.url ? `<a href="#" data-open="${esc(acc.login.url)}">Open it again</a>.` : ""} If it shows a code, paste it here:</span></div>
      <div style="display:flex;gap:8px"><input type="text" class="code-input" placeholder="Paste code" style="flex:1;height:34px;border-radius:9px;border:1px solid var(--line-strong);background:var(--raised);padding:0 10px" /><button class="btn primary sm" data-act="code">Submit</button></div></div>`;
  }
  return row("Not signed in", a.error ? esc(a.error) : "Chalk uses your Claude Pro plan through Claude Code. No API key.", `<button class="btn primary sm" data-act="login">Sign in with Claude</button>`);
}

function usageRow(): string {
  const note = `<span class="caption" style="font-weight:400">Signed in as your Claude account through Claude Code. No API key is used.</span>`;
  const name = planName();
  const L = S.limits ?? S.account?.limits;
  if (L && L.windows.length) {
    // The same windows Claude's own usage page shows: this session, then the weekly limits.
    const rows = L.windows.map((w, i) => {
      const pct = Math.round(w.pct);
      const title = i === 0 && w.key === "five_hour" ? `${name} usage this window` : w.label;
      const reset = resetsIn(w.resets_at);
      return `<div class="usage-win${i ? " sub" : ""}"><div class="usage-row"><span>${esc(title)}</span><span>${pct}% used${reset ? ` · ${reset}` : ""}</span></div>
        <div class="bar lg"><div style="width:${pct}%"></div></div></div>`;
    }).join("");
    return `<div class="st-row col">${rows}${note}</div>`;
  }
  const u = S.usage ?? S.account?.usage;
  if (!u) return `<div class="st-row col"><div class="usage-win"><div class="usage-row"><span>${name} usage this window</span><span>shown after your first message</span></div><div class="bar lg"><div style="width:0"></div></div></div>${note}</div>`;
  const pct = u.utilization != null ? Math.round(u.utilization * 100) : null;
  const reset = resetsIn(u.resets_at);
  const label = pct != null ? `${pct}% used` : u.status === "allowed" ? "within your limit" : u.status === "allowed_warning" ? "getting close to your limit" : "limit reached";
  return `<div class="st-row col"><div class="usage-win"><div class="usage-row"><span>${name} usage this window</span><span>${label}${reset ? ` · ${reset}` : ""}</span></div>
    <div class="bar lg"><div style="width:${pct ?? (u.status === "allowed" ? 10 : 90)}%"></div></div></div>${note}</div>`;
}

function modelSeg(): string {
  const want = ["haiku", "sonnet", "opus"];
  const items: [string, string][] = want.map((m) => [m, m[0].toUpperCase() + m.slice(1)]);
  if (S.settings.model && !want.includes(S.settings.model)) items.push([S.settings.model, S.models.find((m) => m.value === S.settings.model)?.displayName?.replace(/ \(.*\)$/, "") ?? S.settings.model]);
  return seg("model", items, S.settings.model);
}

function installCard(): string {
  if (install.running || install.error) {
    return `<div class="st-row col"><div class="st-label"><span>${install.error ? "Voice pack install stopped" : "Installing the voice pack…"}</span>
      <span>${install.error ? esc(install.error) : `${esc(install.step)} · about 3 GB the first time; you can keep using Chalk meanwhile.`}</span></div>
      <div class="progress${install.pct ? "" : " indeterminate"}"><div style="width:${install.pct}%"></div></div>
      <pre class="log-tail">${esc(install.log.slice(-5).join("\n"))}</pre>
      ${install.error ? `<div><button class="btn secondary sm" data-act="install">Try again</button></div>` : ""}</div>`;
  }
  if (!isDesktop) return `<div class="st-note">To install the voice pack, run <b>backend\\install-voice.bat</b>, then restart the backend.</div>`;
  return row("Voice pack", "Whisper (your speech to text) and Kokoro (Claude's natural voice), on your graphics card. About 3 GB.",
    `<button class="btn primary sm" data-act="install">${icon("download")}Install</button>`);
}

function claude() {
  const st = S.status;
  const voices = voiceRows();
  return `<h1>Claude &amp; voice</h1>
  <section class="st-sec"><h2>Claude</h2><div class="card">
    ${accountRow()}
    ${row("Model", "Sonnet answers fastest for voice. Opus thinks deeper but replies slower.", modelSeg())}
    ${row("Effort", "Higher effort gives longer, slower turns.", seg("effort", S.efforts.map((e) => [e, e[0].toUpperCase() + e.slice(1)] as [string, string]), S.settings.effort))}
    ${row("Small jobs", "Summaries for a fresh note and complexity explanations don't need the main model. Haiku uses much less of your plan.", seg("small_model", [["haiku", "Haiku"], ["same", "Same as above"]], S.settings.small_model ?? "haiku"))}
    ${usageRow()}
  </div></section>
  <section class="st-sec"><h2>Listening</h2><div class="card">
    ${row("Interrupt by talking", "While Claude speaks, just start talking: it stops and listens, and sends when you pause. Works best with headphones.", sw("bargein", bargeInEnabled(), "Interrupt Claude by talking"))}
    ${row("Talk key", "Hold to talk. Space works when you're not typing; Ctrl + Space works anywhere.", `<span class="st-value" style="font-weight:400;color:var(--text-2);font-size:12px"><kbd>Space</kbd>or<kbd>Ctrl</kbd><kbd>Space</kbd></span>`)}
    ${row("Speech recognition", st.stt ? "Runs on your PC. Nothing but text leaves it." : "Not installed yet: install the voice pack to talk to Chalk.",
      st.stt ? `<span class="st-value">Whisper ${esc(st.whisper_model)}<span class="tag">${st.mock ? "mock" : "local"}</span></span>` : `<span class="tag">Not installed</span>`)}
    ${row("Keep recordings", S.settings.keep_recordings ? "On: recordings are saved in your Chalk data folder." : "Off: audio is deleted as soon as it's transcribed.", sw("keep", !!S.settings.keep_recordings, "Keep recordings"))}
    <div class="st-row"><div class="st-label"><span>Test microphone</span><span class="mic-out">Checks Chalk can hear you.</span></div>
      <div style="display:flex;align-items:center;gap:12px"><div class="meter"><div class="mic-bar"></div></div><button class="btn secondary sm" data-act="mictest">${icon("mic")}Test</button></div></div>
    ${!st.stt || !st.tts ? installCard() : ""}
  </div></section>
  <section class="st-sec"><h2>Claude's voice</h2><div class="card">
    ${row("Speak replies", "Claude reads each step aloud as the diagram changes.", sw("voiceon", S.voiceOn, "Speak Claude's replies"))}
    <div class="st-row"><label class="st-label" for="speed"><span>Speaking speed</span><span>1.0× is a calm teaching pace.</span></label>
      <div class="range"><input id="speed" type="range" min="0.75" max="1.5" step="0.05" value="${voiceRate()}" /><span id="speedVal">${voiceRate().toFixed(2).replace(/0$/, "")}×</span></div></div>
    ${voices}
  </div></section>`;
}

function voiceRows(): string {
  const current = chosenVoice(S.status.tts);
  if (S.status.tts && store?.available) {
    const installed = store.voices.filter((v) => v.installed);
    const list = (filter === "installed" ? installed : store.voices).filter((v) => v.accent !== "other" || filter === "all");
    const total = installed.reduce((t, v) => t + v.bytes, 0) + store.models.reduce((t, m) => t + m.bytes, 0);
    return `<div class="vs-filter"><span class="caption" style="font-weight:400">${installed.length} of ${store.voices.length} voices installed · ${fmtBytes(total)} on disk</span>
        ${seg("vfilter", [["installed", "Installed"], ["all", "All voices"]], filter)}</div>
      ${list.map((v) => {
        const id = `kokoro:${v.id}`, inUse = id === current;
        return `<div class="voice-row">
          <button class="play" data-preview="${esc(id)}" aria-label="Preview ${esc(v.name)}">${icon("play")}</button>
          <div class="who"><span>${esc(v.name)}</span><span>${esc([v.accent, v.gender, v.note].filter(Boolean).join(" · "))}${v.installed ? ` · ${fmtBytes(v.bytes)}` : ""}</span></div>
          ${inUse ? `<span class="in-use">In use</span>` : v.installed ? `<button class="btn secondary sm" data-use="${esc(id)}">Use</button>` : ""}
          ${v.installed ? `<button class="btn secondary sm" data-vdel="${esc(v.id)}">Remove</button>` : `<button class="btn primary sm" data-vget="${esc(v.id)}">Download</button>`}
        </div>`;
      }).join("") || `<div class="st-note">No voices downloaded yet. Pick one under All voices.</div>`}
      <div class="st-note">Kokoro voices run on your graphics card. ${store.cache_dir ? `Stored in ${esc(store.cache_dir)}.` : ""}</div>`;
  }
  const list = availableVoices(false).slice(0, 6);
  return `${list.map((v) => `<div class="voice-row">
      <button class="play" data-preview="${esc(v.id)}" aria-label="Preview ${esc(v.label)}">${icon("play")}</button>
      <div class="who"><span>${esc(v.label.replace(/\s+★$/, "").replace(/\s+\(robotic\)$/, ""))}</span><span>System voice${v.score >= 8 ? " · natural" : v.score < 0 ? " · sounds robotic" : ""}</span></div>
      ${v.id === current ? `<span class="in-use">In use</span>` : `<button class="btn secondary sm" data-use="${esc(v.id)}">Use</button>`}
    </div>`).join("") || `<div class="st-note">No system voices found.</div>`}
    <div class="st-note">Kokoro voices run on your GPU and sound far more natural. Until the voice pack is installed, Chalk uses your system's most natural voice.</div>`;
}

function visuals() {
  const e = S.settings.engine ?? "script";
  return `<h1>Visuals</h1>
  <section class="st-sec"><h2>How Claude draws</h2><div class="card">
    ${row("Engine", e === "script"
      ? "<b>Animated</b>: Claude writes a short animation script, so values fly between structures, trees grow and the camera follows, in step with its voice."
      : "<b>Classic</b>: Claude picks from 28 hand-drawn diagram kinds (plots, charts, Venn diagrams, timelines…) and changes them per sentence.",
      seg("engine", [["script", "Animated"], ["classic", "Classic"]], e))}
    <div class="st-note">Animated is newer and moves more; Classic covers more kinds of chart. Switching keeps your notes; the next reply uses the new engine.</div>
  </div></section>
  <section class="st-sec"><h2>Canvas</h2><div class="card">
    ${row("Click anything in a diagram", "to ask Claude to explain it, say why it's there, walk you through it, or quiz you.", "")}
    ${row("Draw on it", "The pencil lets you circle or annotate the diagram. Your drawing goes to Claude with your next message.", "")}
  </div></section>`;
}

function coding() {
  const cur = S.settings.code_language ?? "python";
  const langs: [string, string][] = [["python", "Python"], ["javascript", "JavaScript"], ["java", "Java"], ["c", "C"], ["sql", "SQL"]];
  const curChain = chains?.find((c) => c.id === cur);
  const warn = curChain && (curChain.state === "missing" || curChain.state === "error")
    ? `<div class="st-note">${esc(curChain.name)} isn't set up on this PC yet, so its exercises can't run. Download it below.</div>` : "";
  return `<h1>Coding</h1>
  <section class="st-sec"><h2>Questions</h2><div class="card">
    ${row("Default language", "For exercises, and for code in explanations and practice papers. Ask for another language any time.", seg("code_language", langs, cur))}
    ${warn}
  </div></section>
  <section class="st-sec"><h2>Languages on this PC</h2><div class="card lang-list">
    ${chains ? chains.map(chainRow).join("") : `<div class="st-note">Checking…</div>`}
  </div>
  <span class="caption" style="font-weight:400;padding-left:4px">Code runs on your PC with a time limit for each test. Downloads come from Eclipse Temurin (Java) and TinyCC (C).</span></section>`;
}

function chainRow(c: Toolchain): string {
  let control = "";
  let sub = esc(c.detail ?? "");
  if (c.state === "builtin") control = `<span class="tag">Built in</span>`;
  else if (c.state === "ready") control = c.source === "chalk"
    ? `<span class="tag ok">Ready</span><button class="btn secondary sm" data-chain-rm="${c.id}">Remove</button>`
    : `<span class="tag ok">Ready</span>`;
  else if (c.state === "installing") {
    const p = c.progress!, pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    sub = p.phase === "unpacking" ? "Unpacking…" : p.total ? `Downloading… ${fmtBytes(p.done)} of ${fmtBytes(p.total)}` : "Downloading…";
    control = `<div class="progress${pct ? "" : " indeterminate"}" style="width:140px"><div style="width:${pct}%"></div></div>`;
  } else if (c.can_download) control = `<button class="btn ${c.state === "error" ? "secondary" : "primary"} sm" data-chain-get="${c.id}">${icon("download")}${c.state === "error" ? "Try again" : "Download"}</button>`;
  else control = `<span class="tag">Not found</span>`;
  return `<div class="st-row" data-lang-row="${c.id}"><div class="st-label lang-label"><span><i class="lang-badge l-${c.id}">${LANG_ICON[c.id] ?? ""}</i>${esc(c.name)}</span><span>${sub}</span></div><div class="lang-ctl">${control}</div></div>`;
}

function shortcuts() {
  const k = (...keys: string[]) => keys.map((x) => `<kbd>${x}</kbd>`).join("");
  const rows: [string, string][] = [
    ["Talk (hold)", `${k("Space")} or ${k("Ctrl", "Space")}`], ["Stop Claude speaking, or cancel recording", k("Esc")],
    ["Search notes and commands", k("Ctrl", "K")], ["New note", k("Ctrl", "N")], ["Export this note as Markdown", k("Ctrl", "E")],
    ["Previous / next step of a diagram", k("←") + k("→")], ["Send message", k("Enter")], ["New line", k("Shift", "Enter")],
    ["Add a code block", "type " + k("```") + " or the " + "<b>{ }</b> button"], ["Send from a code box", k("Ctrl", "Enter")],
    ["Show or hide the notes list", k("Ctrl", "\\")], ["Focus mode (hide notes and canvas)", k("Ctrl", ".")], ["Settings", k("Ctrl", ",")],
  ];
  return `<h1>Shortcuts</h1><section class="st-sec"><div class="card"><table class="keys-table">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table></div></section>`;
}

function privacy() {
  return `<h1>Privacy</h1>
  <section class="st-sec"><h2>What leaves your PC</h2><div class="card">
    ${row("Text and drawings", "Your messages (typed or transcribed) and any drawing you attach go to Claude, as in the Claude app.", "")}
    ${row("Your voice", "Never. Speech is turned into text on your PC, and Claude's voice is made on your PC.", "")}
    ${row("Notes", "Stay on this PC, in one local database.", isDesktop && S.status.data_dir ? `<button class="btn secondary sm" data-act="folder">${icon("folder")}Open folder</button>` : "")}
    ${row("Keep recordings", "Off: audio is deleted as soon as it's transcribed.", sw("keep", !!S.settings.keep_recordings, "Keep recordings"))}
  </div></section>
  <section class="st-sec"><h2>Your data</h2><div class="card">
    ${row("Export a note", "Markdown, from the palette (Ctrl+K) or Ctrl+E.", "")}
    ${row("Delete all notes", "Removes every note and conversation from this PC. This can't be undone.", `<button class="btn secondary sm" data-act="deleteall">${icon("trash")}Delete all</button>`)}
  </div>${S.status.data_dir ? `<span class="caption" style="font-weight:400;padding-left:4px">Data folder: ${esc(S.status.data_dir)}</span>` : ""}</section>`;
}

function about() {
  const dark = document.documentElement.dataset.theme === "dark";
  return `<h1>About Chalk</h1>
  <section class="st-sec"><div class="card"><div class="about">
    <img src="/brand/${dark ? "icon-f-dark" : "icon-f"}.svg" alt="Chalk icon" />
    <div style="display:flex;flex-direction:column;gap:8px">
      <span class="wordmark">chalk<i>.</i></span>
      <span style="font:italic 400 18px/1.4 var(--font-note);color:var(--text-2)">Think out loud. Learn it one step at a time.</span>
      <span class="caption" style="font-weight:400">Version ${esc(S.status.version ?? desktop?.version ?? "1.0.0")}${desktop ? ` · ${esc(desktop.platform)}` : " · browser"}</span>
    </div></div></div></section>
  <section class="st-sec"><h2>Built with</h2><div class="card">
    ${row("Claude", "through Claude Code and the Claude Agent SDK, signed in with your Claude plan", "")}
    ${row("Whisper", "speech to text (faster-whisper, large-v3-turbo)", "")}
    ${row("Kokoro", "Claude's natural voice, on your GPU", "")}
    ${row("Inter, Newsreader, JetBrains Mono", "type · Rough.js, dagre, Mermaid, KaTeX, CodeMirror", "")}
  </div></section>`;
}

// ---------------------------------------------------------------- events
function wire(v: HTMLElement) {
  v.querySelectorAll<HTMLButtonElement>("[data-sec]").forEach((b) => (b.onclick = () => { section = b.dataset.sec as Section; render(); v.querySelector(".st-main")!.scrollTop = 0; if (section === "coding") loadChains(); }));
  v.querySelectorAll<HTMLElement>("[data-seg]").forEach((g) => g.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = async () => {
    const key = g.dataset.seg!, val = b.dataset.v!;
    g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    if (key === "theme") H.setTheme(val as ThemePref);
    else if (key === "vfilter") filter = val as typeof filter;
    else await H.saveSettings({ [key]: val }).catch((e) => toast("Couldn't save", (e as Error).message));
    render();
  })));
  v.querySelectorAll<HTMLButtonElement>("[data-switch]").forEach((b) => (b.onclick = async () => {
    const on = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(on));
    const k = b.dataset.switch;
    if (k === "reduce") { localStorage.setItem("chalk.reduceMotion", on ? "1" : "0"); H.setReduceMotion(on); }
    if (k === "autosend") { S.autoSend = on; localStorage.setItem("chalk.autoSend", on ? "1" : "0"); }
    if (k === "bargein") setBargeIn(on);
    if (k === "voiceon") H.setVoiceOn(on);
    if (k === "keep") await H.saveSettings({ keep_recordings: on });
    render();
  }));
  const speed = v.querySelector<HTMLInputElement>("#speed");
  if (speed) speed.oninput = () => { setVoiceRate(Number(speed.value)); v.querySelector("#speedVal")!.textContent = `${Number(speed.value).toFixed(2).replace(/0$/, "")}×`; };
  v.querySelectorAll<HTMLButtonElement>("[data-preview]").forEach((b) => (b.onclick = () => H.previewVoice(b.dataset.preview)));
  v.querySelectorAll<HTMLButtonElement>("[data-use]").forEach((b) => (b.onclick = () => { setVoice(b.dataset.use!); render(); H.previewVoice(); }));
  v.querySelectorAll<HTMLButtonElement>("[data-vget]").forEach((b) => (b.onclick = async () => {
    b.disabled = true; b.textContent = "Downloading…";
    try { store = await api<VoiceStore>("/api/voices/download", { voice: b.dataset.vget }); setKokoroCatalogue(store.voices); } catch (e) { toast("Download failed", (e as Error).message); }
    render();
  }));
  v.querySelectorAll<HTMLButtonElement>("[data-vdel]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.vdel!;
    if (!(await confirmBox(`Remove the ${id} voice?`, "About half a megabyte. It downloads again if you use it.", "Remove"))) return;
    if (chosenVoice(true) === `kokoro:${id}`) localStorage.removeItem("chalk.voice");
    store = await api<VoiceStore>("/api/voices/delete", { voice: id });
    setKokoroCatalogue(store.voices);
    render();
  }));
  v.querySelectorAll<HTMLButtonElement>("[data-chain-get]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api(`/api/toolchains/${b.dataset.chainGet}`, {}); } catch (e) { toast("Couldn't start the download", (e as Error).message); }
    loadChains();
  }));
  v.querySelectorAll<HTMLButtonElement>("[data-chain-rm]").forEach((b) => (b.onclick = async () => {
    const c = chains?.find((x) => x.id === b.dataset.chainRm);
    if (!(await confirmBox(`Remove ${c?.name ?? "this language"}?`, "Its exercises won't run until you download it again.", "Remove"))) return;
    await api(`/api/toolchains/${b.dataset.chainRm}`, undefined, "DELETE").catch((e) => toast("Couldn't remove it", (e as Error).message));
    loadChains();
  }));
  v.querySelectorAll<HTMLAnchorElement>("[data-open]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openLink(a.dataset.open!); }));
  v.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => (b.onclick = () => act(b, v)));
}

async function act(b: HTMLButtonElement, v: HTMLElement) {
  const a = b.dataset.act;
  if (a === "mictest") { b.disabled = true; await micTest(v.querySelector<HTMLElement>(".mic-bar")!, v.querySelector<HTMLElement>(".mic-out")!); b.disabled = false; return; }
  if (a === "folder") { desktop?.openPath(S.status.data_dir!); return; }
  if (a === "deleteall") {
    if (await confirmBox("Delete all notes?", "Every note and conversation on this PC will be removed. This can't be undone.", "Delete all")) { await H.deleteAllNotes(); toast("All notes deleted"); }
    return;
  }
  if (a === "install") { startInstall(); return; }
  b.disabled = true;
  try { await accountAction(a!, v); } catch (e) { toast("Something went wrong", (e as Error).message); }
  b.disabled = false;
  render();
}

export async function accountAction(a: string, root: HTMLElement) {
  if (a === "login") {
    const state = await api<{ url: string | null }>("/api/account/login", {});
    if (S.account) S.account.login = { running: true, url: state.url };
    pollLogin();
  } else if (a === "code") {
    const code = root.querySelector<HTMLInputElement>(".code-input")?.value ?? "";
    await api("/api/account/code", { code });
    await H.refreshAccount();
  } else if (a === "logout") {
    await api("/api/account/logout", {});
    await H.refreshAccount();
  }
}

let polling = false;
async function pollLogin() {
  if (polling) return;
  polling = true;
  for (let i = 0; i < 150; i++) { // up to ~5 minutes
    await new Promise((r) => setTimeout(r, 2000));
    await H.refreshAccount();
    if (settingsOpen()) render(); else if (!$("welcomeView").hidden) renderWelcome();
    if (S.account?.auth.loggedIn || !S.account?.login.running) break;
  }
  polling = false;
}

// ---------------------------------------------------------------- voice pack install (desktop)
async function startInstall() {
  if (!desktop) return;
  install = { running: true, step: "Starting", pct: 0, log: [] };
  render();
  const r = await desktop.voice.install();
  if (!r.ok && !install.error) install = { ...install, running: false, error: r.error ?? "Install failed." };
}
function onInstallEvent(ev: VoiceInstallEvent) {
  if (ev.phase === "step") { install.step = ev.step ?? install.step; install.pct = ev.pct ?? install.pct; }
  if (ev.phase === "log" && ev.line) { install.log.push(ev.line); install.log = install.log.slice(-40); }
  if (ev.phase === "error") { install.running = false; install.error = ev.message ?? "Install failed."; }
  if (ev.phase === "done") {
    install = { running: false, step: "", pct: 0, log: [] };
    H.reloadStatus().then(() => { loadStore().then(() => { if (settingsOpen()) render(); }); toast("Voice pack installed", "Hold Space and talk. Claude now speaks with Kokoro.", 8000); });
  }
  if (settingsOpen() && section === "claude") {
    // update just the progress, without re-rendering the whole page on every log line
    const card = $("settingsView").querySelector(".log-tail");
    if (card && ev.phase === "log") card.textContent = install.log.slice(-5).join("\n");
    else render();
  }
}

// ---------------------------------------------------------------- welcome (before you've signed in)
export function showWelcome(onDone: () => void) {
  $("mainView").hidden = true; $("bottombar").hidden = true; $("settingsView").hidden = true;
  $("welcomeView").hidden = false;
  welcomeDone = onDone;
  renderWelcome();
}
let welcomeDone: () => void = () => {};
export function renderWelcome() {
  const v = $("welcomeView");
  const acc: Account | null = S.account;
  const signed = !!acc?.auth.loggedIn;
  const dark = document.documentElement.dataset.theme === "dark";
  const voiceReady = S.status.stt && S.status.tts;
  v.innerHTML = `<div class="welcome-card">
    <img src="/brand/${dark ? "icon-f-dark" : "icon-f"}.svg" alt="Chalk" />
    <span class="wordmark" style="font-size:64px">chalk<i>.</i></span>
    <p class="tagline">Think out loud. Learn it one step at a time.</p>
    <div class="card welcome-steps">
      <div class="wstep${signed ? " done" : ""}"><span class="n">${signed ? icon("check") : "1"}</span><div class="b">
        <span>Sign in to Claude</span>
        ${signed ? `<p>Signed in as ${esc(who(acc!.auth))}${plan(acc!.auth) ? ` · ${esc(plan(acc!.auth))}` : ""}.</p>`
          : acc?.login.running ? `<p>Finish signing in in the browser tab that opened. ${acc.login.url ? `<a href="#" data-open="${esc(acc.login.url)}">Open it again</a>.` : ""} If it shows a code, paste it here:</p>
            <div class="row"><input type="text" class="code-input" placeholder="Paste code" /><button class="btn primary sm" data-wact="code">Submit</button></div>`
          : `<p>Chalk uses your Claude Pro plan through Claude Code. No API key, no extra cost.</p>
            ${acc?.auth.error ? `<p>${esc(acc.auth.error)}</p>` : ""}<div class="row"><button class="btn primary" data-wact="login">Sign in with Claude</button></div>`}
      </div></div>
      <div class="wstep${voiceReady ? " done" : ""}"><span class="n">${voiceReady ? icon("check") : "2"}</span><div class="b">
        <span>Talk to Chalk <span class="tag" style="margin-left:6px">optional</span></span>
        ${voiceReady ? `<p>Whisper and Kokoro are installed: hold Space and talk.</p>`
          : install.running ? `<p>${esc(install.step)}… you can start while it installs.</p><div class="progress${install.pct ? "" : " indeterminate"}"><div style="width:${install.pct}%"></div></div>`
          : isDesktop ? `<p>Install the voice pack (about 3 GB) to talk and hear a natural voice. Runs on your graphics card. You can do this later in Settings.</p><div class="row"><button class="btn secondary" data-wact="install">${icon("download")}Install voice pack</button></div>`
          : `<p>To talk, install Whisper and Kokoro: run backend\\install-voice.bat. You can always type.</p>`}
      </div></div>
    </div>
    <button class="btn ${signed ? "primary" : "quiet"}" data-wact="start" ${signed ? "" : "disabled"}>${signed ? "Start" : "Sign in to start"}</button>
  </div>`;
  v.querySelectorAll<HTMLButtonElement>("[data-chain-get]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try { await api(`/api/toolchains/${b.dataset.chainGet}`, {}); } catch (e) { toast("Couldn't start the download", (e as Error).message); }
    loadChains();
  }));
  v.querySelectorAll<HTMLButtonElement>("[data-chain-rm]").forEach((b) => (b.onclick = async () => {
    const c = chains?.find((x) => x.id === b.dataset.chainRm);
    if (!(await confirmBox(`Remove ${c?.name ?? "this language"}?`, "Its exercises won't run until you download it again.", "Remove"))) return;
    await api(`/api/toolchains/${b.dataset.chainRm}`, undefined, "DELETE").catch((e) => toast("Couldn't remove it", (e as Error).message));
    loadChains();
  }));
  v.querySelectorAll<HTMLAnchorElement>("[data-open]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openLink(a.dataset.open!); }));
  v.querySelectorAll<HTMLButtonElement>("[data-wact]").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.wact!;
    if (a === "start") { localStorage.setItem("chalk.welcomed", "1"); v.hidden = true; welcomeDone(); return; }
    if (a === "install") { startInstall(); renderWelcome(); return; }
    b.disabled = true;
    try { await accountAction(a, v); } catch (e) { toast("Something went wrong", (e as Error).message); }
    renderWelcome();
  }));
}
desktop?.voice.onEvent(() => { if (!$("welcomeView").hidden) renderWelcome(); });
