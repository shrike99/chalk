/**
 * Voice in: hold Space (or the orb) to talk. While you hold it the orb pulses with your voice and the
 * composer turns into a listening panel: a red "Listening" label, a timer, a waveform and your words
 * as you speak. Release to send; Esc cancels.
 *
 * Words come from local Whisper (re-transcribed every 1.2 s for the live text), or from the browser's
 * speech recognition when Whisper isn't installed and the browser has one.
 */
import { $, S, sleep, toast, hideToast } from "./ctx";
import { isDesktop } from "./desktop";
import { levelMeter } from "./bargein";

export type MicPhase = "idle" | "starting" | "listening" | "finishing";

export interface VoiceHooks {
  send(text: string, meta: string): Promise<void>;
  stopSpeaking(): void;
  hint(): string;                 // recent conversation text, to help Whisper with names and terms
  onPhase(p: MicPhase): void;     // orb + bottom bar state
  needVoicePack(): void;          // open settings where the voice pack can be installed
}

let H: VoiceHooks;
export let phase: MicPhase = "idle";
export let holding = false;
let cancelled = false;
let micStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let recognition: any = null;
let srBase = "", finalText = "", interimText = "", srError = "";
let recStart = 0;
let stopMeter: (() => void) | null = null;
let recTimer = 0, partialTimer = 0;
let partialBusy: Promise<void> | null = null;

const listenEl = () => $("listen"), composerEl = () => $("composer");
const setPhase = (p: MicPhase) => { phase = p; H.onPhase(p); };

function showListening(state: "listening" | "finishing", label: string) {
  listenEl().hidden = false;
  composerEl().hidden = true;
  listenEl().dataset.state = state;
  $("recState").textContent = label;
}
function hideListening() { listenEl().hidden = true; composerEl().hidden = false; }

const liveText = () => `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
function renderLive() {
  const el = $("recText");
  const t = liveText();
  el.classList.toggle("placeholder", !t);
  el.innerHTML = "";
  if (!t) { el.textContent = "Start speaking… your words appear here."; return; }
  const fin = document.createElement("span");
  fin.textContent = finalText.trim() + (interimText ? " " : "");
  const inter = document.createElement("span");
  inter.className = "interim";
  inter.textContent = interimText;
  el.append(fin, inter);
  el.scrollTop = el.scrollHeight;
}

/** Live level: a scrolling bar waveform on the canvas and the orb's pulse size. */
export function startMeter(stream: MediaStream, opts: { canvas?: HTMLCanvasElement; bar?: HTMLElement } = {}): () => void {
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const history: number[] = [];
  const c2d = opts.canvas?.getContext("2d") ?? null;
  const orb = $("orb");
  const colour = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#1D1D1F";
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    const level = Math.min(1, peak / 45);
    orb.style.setProperty("--level", level.toFixed(2));
    if (opts.bar) opts.bar.style.width = `${Math.round(level * 100)}%`;
    if (c2d && opts.canvas) {
      const cv = opts.canvas;
      const W = cv.width = cv.clientWidth * 2 || 400, Hh = cv.height = 44;
      history.push(level);
      const n = Math.floor(W / 8);
      while (history.length > n) history.shift();
      c2d.clearRect(0, 0, W, Hh);
      c2d.fillStyle = colour;
      history.forEach((l, i) => {
        const h = Math.max(4, l * Hh);
        c2d.globalAlpha = i > history.length - 4 ? 0.9 : 0.85;
        c2d.beginPath();
        c2d.roundRect?.(W - (history.length - i) * 8, (Hh - h) / 2, 4, h, 2);
        c2d.fill();
      });
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { cancelAnimationFrame(raf); ctx.close(); orb.style.setProperty("--level", "0"); if (opts.bar) opts.bar.style.width = "0"; };
}

const SR_ERRORS: Record<string, [string, string]> = {
  "not-allowed": ["Microphone blocked", "Allow the microphone for this page, then try again."],
  "service-not-allowed": ["Speech recognition isn't available here", "Install the voice pack in Settings for voice input that runs on your PC."],
  network: ["Speech recognition needs the voice pack", "Install it in Settings → Claude & voice. You can always type."],
  "audio-capture": ["No microphone found", "Plug one in or pick one in Windows sound settings, then try again."],
  "language-not-supported": ["Language not supported", "Your browser's speech recogniser doesn't support your language."],
};

function releaseMic() {
  stopMeter?.(); stopMeter = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  clearInterval(recTimer); clearInterval(partialTimer);
}

let handsFree = false;
let silenceTimer = 0;
let silenceCtx: AudioContext | null = null;

/** Hands-free (after interrupting Claude by talking): record until you pause, then send. */
function watchSilence(stream: MediaStream) {
  silenceCtx = new AudioContext();
  const level = levelMeter(silenceCtx, stream);
  let peak = 0, spoke = 0, quietSince = 0;
  const t0 = performance.now();
  silenceTimer = window.setInterval(() => {
    const v = level(), now = performance.now();
    peak = Math.max(peak * 0.999, v);
    const quiet = v < Math.max(0.012, peak * 0.18);
    if (!quiet) { spoke += 50; quietSince = 0; } else if (!quietSince) quietSince = now;
    if ((spoke > 300 && quietSince && now - quietSince > 1300) || now - t0 > 45_000 || (!spoke && now - t0 > 6000)) stopRecording();
  }, 50);
}
function stopSilence() { clearInterval(silenceTimer); silenceTimer = 0; silenceCtx?.close().catch(() => {}); silenceCtx = null; }

export async function startRecording(opts: { handsFree?: boolean } = {}) {
  if (phase !== "idle") return; // you can talk while Claude is replying: it's sent once Claude finishes
  handsFree = !!opts.handsFree;
  const canSR = !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) && !isDesktop;
  if (!S.status.stt && !canSR) {
    toast("Voice input needs the voice pack", "Whisper turns your speech into text on your PC. You can always type.", 9000,
      { label: "Set it up", run: () => H.needVoicePack() });
    return;
  }
  holding = true;
  cancelled = false;
  H.stopSpeaking();
  hideToast();
  setPhase("starting");
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    localStorage.setItem("chalk.micUsed", "1");
  } catch (e) {
    setPhase("idle");
    releaseMic();
    const blocked = (e as DOMException).name === "NotAllowedError";
    toast(blocked ? "Microphone blocked" : "Microphone error",
      blocked ? (isDesktop ? "Allow Chalk to use the microphone in Windows Settings → Privacy & security → Microphone." : "Allow the microphone for this page, then try again.") : (e as Error).message, 12000);
    return;
  }
  if (!holding || cancelled) {
    // released while the permission prompt was up: nothing was recorded
    setPhase("idle");
    releaseMic();
    toast("Microphone is ready", "Now hold Space (or the mic) and talk. Release to send.", 6000);
    return;
  }
  srBase = ""; finalText = ""; interimText = ""; srError = "";
  recStart = performance.now();
  setPhase("listening");
  showListening("listening", handsFree ? "Listening: pause to send" : "Listening");
  if (handsFree) watchSilence(micStream);
  renderLive();
  $("recTime").textContent = "0:00";
  recTimer = window.setInterval(() => {
    const s = Math.floor((performance.now() - recStart) / 1000);
    $("recTime").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 250);
  stopMeter = startMeter(micStream, { canvas: $<HTMLCanvasElement>("recWave") });

  if (S.status.stt) {
    chunks = [];
    recorder = new MediaRecorder(micStream);
    recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    recorder.start(300);
    partialTimer = window.setInterval(() => { if (!partialBusy) partialBusy = sendPartial().finally(() => (partialBusy = null)); }, 1200);
  } else startBrowserRecognition();
}

function startBrowserRecognition() {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const r = new SR();
  recognition = r;
  r.lang = navigator.language || "en-GB";
  r.interimResults = true;
  r.continuous = true;
  r.onresult = (ev: any) => {
    let fin = "", inter = "";
    for (let i = 0; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) fin += ev.results[i][0].transcript + " ";
      else inter += ev.results[i][0].transcript;
    }
    finalText = `${srBase} ${fin}`;
    interimText = inter;
    renderLive();
  };
  r.onerror = (ev: any) => { srError = ev.error; if (SR_ERRORS[ev.error]) abort(...SR_ERRORS[ev.error]); };
  r.onend = () => {
    // Chrome stops listening after a pause: carry on while Space is still held
    if (phase === "listening" && holding && recognition === r && !SR_ERRORS[srError]) {
      srBase = liveText(); interimText = ""; startBrowserRecognition();
    }
    r._ended = true;
  };
  try { r.start(); } catch (e) { console.warn(e); }
}

async function transcribeBlob(blob: Blob, partial: boolean) {
  const form = new FormData();
  form.append("audio", blob, "clip.webm");
  form.append("hint", H.hint().slice(0, 200));
  if (partial) form.append("partial", "1");
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail ?? res.statusText);
  return res.json() as Promise<{ text: string; stt_ms: number; device?: string }>;
}

async function sendPartial() {
  if (phase !== "listening" || !chunks.length) return;
  try {
    const { text } = await transcribeBlob(new Blob(chunks, { type: recorder?.mimeType || "audio/webm" }), true);
    if (phase === "listening" && text) { finalText = text; interimText = ""; renderLive(); }
  } catch { /* the final transcription reports real problems */ }
}

function abort(title: string, text: string, ms = 12000) {
  stopSilence();
  const r = recognition; recognition = null;
  try { r?.abort(); } catch { /* already stopped */ }
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
  releaseMic();
  holding = false;
  hideListening();
  setPhase("idle");
  if (title) toast(title, text, ms);
}

export function cancelRecording() { cancelled = true; abort("Cancelled", "Nothing was sent.", 1800); }

export async function stopRecording() {
  holding = false;
  stopSilence();
  if (phase === "starting") return; // startRecording() tidies up once the mic is ready
  if (phase !== "listening") return;
  setPhase("finishing");
  const heldMs = performance.now() - recStart;
  clearInterval(recTimer); clearInterval(partialTimer);
  stopMeter?.(); stopMeter = null;
  showListening("finishing", "Finishing…");

  let text = "", meta = "";
  try {
    if (recognition) {
      const r = recognition; recognition = null;
      if (!r._ended) await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1500);
        r.onend = () => { clearTimeout(t); resolve(); };
        try { r.stop(); } catch { resolve(); }
      });
      text = liveText();
      meta = "browser speech recognition";
    } else if (recorder) {
      const rec = recorder; recorder = null;
      const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
      rec.stop();
      await stopped;
      if (partialBusy) await partialBusy;
      showListening("finishing", "Transcribing…");
      const out = await transcribeBlob(new Blob(chunks, { type: rec.mimeType || "audio/webm" }), false);
      text = out.text.trim();
      meta = `Whisper ${out.stt_ms} ms${out.device ? ` (${out.device})` : ""}`;
    }
  } catch (e) {
    releaseMic(); hideListening(); setPhase("idle");
    toast("Couldn't transcribe", (e as Error).message, 12000);
    return;
  }
  releaseMic();
  hideListening();
  setPhase("idle");

  if (handsFree && !text) return;  // a false start (a cough, the room): nothing to say
  if (heldMs < 350) { toast("Too short", "Hold Space the whole time you're speaking, then let go.", 5000); return; }
  if (!text) {
    toast(heldMs < 600 ? "Too short" : "Didn't catch that",
      heldMs < 600 ? "Hold Space the whole time you're speaking, then let go." : "Nothing was recognised. Check the waveform moves when you talk.", 7000);
    return;
  }
  if (S.autoSend) {
    if (S.busy) {
      toast("Queued", `“${text.slice(0, 80)}${text.length > 80 ? "…" : ""}” goes as soon as Claude finishes.`, 0);
      while (S.busy) await sleep(150);
      hideToast();
    }
    await H.send(text, meta);
  } else {
    const input = $<HTMLTextAreaElement>("input");
    input.value = text;
    input.dispatchEvent(new Event("input"));
    input.focus();
    toast("Ready to edit", "Your words are in the message box: edit them, then press Enter.", 5000);
  }
}

export function initVoiceIn(hooks: VoiceHooks) {
  H = hooks;
  const mic = $<HTMLButtonElement>("mic");
  mic.addEventListener("pointerdown", (e) => { e.preventDefault(); startRecording(); });
  mic.addEventListener("pointerup", () => stopRecording());
  mic.addEventListener("pointerleave", () => { if (holding) stopRecording(); });
  window.addEventListener("blur", () => { if (holding) stopRecording(); }); // e.g. Alt+Tab while holding
}

/** Settings → Test microphone: a live level for a few seconds. */
export async function micTest(bar: HTMLElement, out: HTMLElement) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    out.textContent = "Say something: the bar should move.";
    const stop = startMeter(stream, { bar });
    await sleep(5000);
    stop(); stream.getTracks().forEach((t) => t.stop());
    out.textContent = "Your microphone works.";
  } catch (err) {
    out.textContent = (err as DOMException).name === "NotAllowedError" ? "The microphone is blocked." : `Microphone error: ${(err as Error).message}`;
  }
}
