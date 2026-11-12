/**
 * Interrupting by voice: while Claude is speaking, Chalk listens (quietly, on your PC) for you starting
 * to talk. When it hears you, Claude stops and Chalk records you hands-free, sending when you pause.
 *
 * The mic only opens while Claude speaks, and only if you've already allowed it. Echo cancellation
 * removes most of Claude's own voice; what's left is measured for the first moment of each reply
 * and your voice has to be clearly louder than that.
 */
const KEY = "chalk.bargeIn";
export const bargeInEnabled = () => localStorage.getItem(KEY) !== "0";
export function setBargeIn(on: boolean) { localStorage.setItem(KEY, on ? "1" : "0"); if (!on) stopWatching(true); }

let stream: MediaStream | null = null;
let ctx: AudioContext | null = null;
let timer = 0, closeTimer = 0;
let onSpeech: (() => void) | null = null;

async function micAllowed(): Promise<boolean> {
  try {
    const p = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (p.state === "granted") return true;
    if (p.state === "denied") return false;
  } catch { /* not supported here: fall back to whether the mic has worked before */ }
  return localStorage.getItem("chalk.micUsed") === "1";
}

/** Level of a stream, 0..1 (RMS), read on demand. */
export function levelMeter(ac: AudioContext, s: MediaStream): () => number {
  const src = ac.createMediaStreamSource(s);
  const an = ac.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  return () => {
    an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  };
}

export async function watchForSpeech(cb: () => void) {
  onSpeech = cb;
  clearTimeout(closeTimer);
  if (!bargeInEnabled() || timer) return;  // already listening (between two spoken steps)
  if (!(await micAllowed())) return;
  try {
    stream = stream ?? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    ctx = ctx ?? new AudioContext();
  } catch { stopWatching(true); return; }
  const level = levelMeter(ctx, stream);
  const t0 = performance.now();
  let floor = 0.004, loud = 0;
  timer = window.setInterval(() => {
    const v = level();
    if (performance.now() - t0 < 700) { floor = Math.max(floor, v); return; }  // what Claude's echo + the room sound like
    const threshold = Math.max(0.03, floor * 2.6);
    if (v > threshold) loud++;
    else { loud = Math.max(0, loud - 1); floor = Math.max(floor * 0.998, Math.min(v, threshold / 2.6)); }
    if (loud >= 7) {  // about a third of a second of you talking
      const fire = onSpeech;
      stopWatching(true);
      fire?.();
    }
  }, 45);
}

/** Stop listening for interruptions. Between spoken steps there's a short grace, so the mic isn't reopened each time. */
export function stopWatching(now = false) {
  const close = () => {
    clearInterval(timer); timer = 0;
    stream?.getTracks().forEach((t) => t.stop()); stream = null;
    ctx?.close().catch(() => {}); ctx = null;
    onSpeech = null;
  };
  clearTimeout(closeTimer);
  if (now) close();
  else closeTimer = window.setTimeout(close, 1500);
}
