/**
 * Claude's speaking voice. Prefers the most natural voice available:
 *   1. Kokoro, running locally on your GPU (if installed: install-voice.bat)
 *   2. Edge's free "Online (Natural)" voices, or Chrome's Google voices
 *   3. whatever else the system has (Windows' default voices sound robotic)
 * The choice and speed are saved; Settings has a picker with a preview button.
 */

export interface VoiceChoice { id: string; label: string; group: string; score: number }

export interface KokoroVoice { id: string; name: string; accent: string; gender: string; note: string; installed: boolean; bytes: number }
let kokoroCatalogue: KokoroVoice[] = [];
export const setKokoroCatalogue = (v: KokoroVoice[]) => { kokoroCatalogue = v; listeners.forEach((f) => f()); };

export const KOKORO_VOICES: [string, string][] = [
  ["bf_emma", "Emma (British, female)"], ["bf_isabella", "Isabella (British, female)"], ["bm_george", "George (British, male)"],
  ["bm_fable", "Fable (British, male)"], ["af_heart", "Heart (American, female)"], ["af_bella", "Bella (American, female)"],
  ["af_nicole", "Nicole (American, female, soft)"], ["am_michael", "Michael (American, male)"], ["am_fenrir", "Fenrir (American, male)"],
];

let browserVoices: SpeechSynthesisVoice[] = [];
const listeners: (() => void)[] = [];
function loadBrowserVoices() {
  browserVoices = speechSynthesis.getVoices();
  listeners.forEach((f) => f());
}
loadBrowserVoices();
speechSynthesis.addEventListener?.("voiceschanged", loadBrowserVoices);
export const onVoicesChanged = (f: () => void) => listeners.push(f);

/** How natural a browser voice is likely to sound (higher is better). */
function score(v: SpeechSynthesisVoice): number {
  let s = 0;
  const n = v.name.toLowerCase();
  if (n.includes("natural")) s += 10;     // Edge's neural voices
  if (n.includes("online")) s += 3;
  if (n.includes("google")) s += 5;       // Chrome's network voices
  if (/david|zira|mark|hazel|george|susan|desktop/.test(n) && !n.includes("natural")) s -= 5; // old Windows voices
  if (v.lang?.toLowerCase().startsWith((navigator.language || "en-GB").toLowerCase())) s += 2;
  if (!v.lang?.toLowerCase().startsWith("en")) s -= 20;
  return s;
}

export function availableVoices(kokoro: boolean): VoiceChoice[] {
  const out: VoiceChoice[] = [];
  if (kokoro) {
    const list = kokoroCatalogue.length
      ? kokoroCatalogue.filter((v) => v.accent !== "other")
      : KOKORO_VOICES.map(([id, label]) => ({ id, name: label, accent: "", gender: "", note: "", installed: true, bytes: 0 }));
    for (const v of list) {
      const label = v.accent ? `${v.name} (${v.accent}, ${v.gender}${v.note ? `, ${v.note}` : ""})${v.installed ? "" : " · downloads on first use"}` : v.name;
      out.push({ id: `kokoro:${v.id}`, label, group: "Kokoro (local, natural)", score: v.installed ? 101 : 100 });
    }
  }
  for (const v of browserVoices) {
    const s = score(v);
    if (s < -10) continue;
    out.push({ id: `browser:${v.voiceURI}`, label: `${v.name}${s >= 8 ? "  ★" : s < 0 ? "  (robotic)" : ""}`, group: "Browser voices", score: s });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function bestVoice(kokoro: boolean): string {
  if (kokoro) return (navigator.language || "").toLowerCase().startsWith("en-gb") ? "kokoro:bf_emma" : "kokoro:af_heart";
  return availableVoices(false)[0]?.id ?? "";
}

export function chosenVoice(kokoro: boolean): string {
  const saved = localStorage.getItem("chalk.voice") ?? "";
  const valid = availableVoices(kokoro).some((v) => v.id === saved);
  return valid ? saved : bestVoice(kokoro);
}
export const setVoice = (id: string) => localStorage.setItem("chalk.voice", id);
export const voiceRate = () => Number(localStorage.getItem("chalk.rate") || "1");
export const setVoiceRate = (r: number) => localStorage.setItem("chalk.rate", String(r));
export const browserVoice = (id: string) => browserVoices.find((v) => `browser:${v.voiceURI}` === id) ?? null;
export const hasNaturalBrowserVoice = () => browserVoices.some((v) => score(v) >= 8);
