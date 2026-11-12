/**
 * "Predict, then check": a card on the canvas that pauses a walkthrough and asks what happens next.
 * Answer by clicking, with 1–5 / A–E, or by holding Space and saying it. You see straight away if
 * you were right, with Claude's one-line explanation, and then the animation shows what happens.
 */
import { esc } from "./ctx";
import { icon } from "./icons";
import type { Predict } from "./anim/protocol";

export interface Prediction { question: string; picked: string; answer: string; correct: boolean }
type Done = (r: Prediction | null) => void;

export class PredictCard {
  private el: HTMLElement;
  private pending: { p: Predict; done: Done } | null = null;
  private timer = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "predict";
    this.el.hidden = true;
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Predict what happens next");
    host.appendChild(this.el);
  }

  get isOpen() { return !this.el.hidden; }
  get awaiting() { return !!this.pending; }

  /** Choices that are themselves letters ("B", "C") get number labels, so "B" never means two things. */
  private label(p: Predict, i: number) { return letterChoices(p.choices) ? String(i + 1) : String.fromCharCode(65 + i); }

  /** Show the question; resolves with the student's prediction (or null if skipped or stopped). */
  ask(p: Predict): Promise<Prediction | null> {
    this.close(null);
    return new Promise<Prediction | null>((done) => {
      this.pending = { p, done };
      this.el.hidden = false;
      this.el.classList.remove("answered");
      this.el.innerHTML = `
        <div class="pr-head"><span class="pr-kicker">${icon("bulb")}Predict</span><span class="pr-how">Click, press ${letterChoices(p.choices) ? "the letter" : `1–${p.choices.length}`}, or hold <kbd>Space</kbd> and say it</span></div>
        <div class="pr-q">${esc(p.question)}</div>
        <div class="pr-choices">${p.choices.map((c, i) => `<button class="pr-choice" data-i="${i}"><b>${this.label(p, i)}</b><span>${esc(c)}</span></button>`).join("")}</div>
        <div class="pr-foot"><button class="pr-skip" data-skip>Skip, just show me</button></div>`;
      this.el.querySelectorAll<HTMLElement>("[data-i]").forEach((b) => (b.onclick = () => this.pick(Number(b.dataset.i))));
      this.el.querySelector<HTMLElement>("[data-skip]")!.onclick = () => this.close(null);
      (this.el.querySelector(".pr-choice") as HTMLElement | null)?.focus({ preventScroll: true });
    });
  }

  /** A key press while the card is up: 1–5 or A–E picks; Enter continues after answering. Returns true if used. */
  key(e: KeyboardEvent): boolean {
    if (!this.isOpen || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (this.el.classList.contains("answered")) {
      if (e.key === "Enter" || e.key === "ArrowRight") { this.finish(); return true; }
      return false;
    }
    if (!this.pending) return false;
    const n = this.pending.p.choices.length;
    const k = e.key.toLowerCase();
    const byText = this.pending.p.choices.findIndex((c) => c.trim().toLowerCase() === k);
    const i = /^[1-5]$/.test(k) ? Number(k) - 1 : byText >= 0 ? byText : /^[a-e]$/.test(k) && !letterChoices(this.pending.p.choices) ? k.charCodeAt(0) - 97 : -1;
    if (i >= 0 && i < n) { this.pick(i); return true; }
    return false;
  }

  /** What the student said ("B", "option two", "it's C because…", or the answer itself). True if understood. */
  voice(text: string): boolean {
    if (!this.pending) return false;
    const i = matchSpoken(text, this.pending.p.choices);
    if (i < 0) {
      this.el.querySelector(".pr-how")!.textContent = `Didn't catch which one: “${text.slice(0, 60)}”. Try saying the letter.`;
      return true;  // still ours: don't send it to Claude as a message
    }
    this.pick(i);
    return true;
  }

  private pick(i: number) {
    if (!this.pending) return;
    const { p } = this.pending;
    const ok = i === p.answer;
    this.el.classList.add("answered");
    this.el.querySelectorAll<HTMLButtonElement>(".pr-choice").forEach((b, j) => {
      b.disabled = true;
      b.classList.toggle("right", j === p.answer);
      b.classList.toggle("wrong", j === i && !ok);
      b.classList.toggle("mine", j === i);
    });
    const foot = this.el.querySelector(".pr-foot")!;
    foot.innerHTML = `<div class="pr-verdict ${ok ? "ok" : "no"}">${icon(ok ? "check" : "x")}<span><b>${ok ? "Right." : `Not quite: it's ${esc(p.choices[p.answer])}.`}</b>${p.explain ? ` ${esc(p.explain)}` : ""}</span></div>
      <button class="btn primary sm" data-go>${ok ? "Carry on" : "Watch what happens"} ${icon("next")}</button>`;
    foot.querySelector<HTMLElement>("[data-go]")!.onclick = () => this.finish();
    const result: Prediction = { question: p.question, picked: p.choices[i], answer: p.choices[p.answer], correct: ok };
    this.resultFor = result;
    // Right: carry on by itself. Wrong: give them time to read why, then show it.
    this.timer = window.setTimeout(() => this.finish(), ok ? 1800 : 6500);
  }
  private resultFor: Prediction | null = null;

  private finish() {
    const r = this.resultFor;
    this.resultFor = null;
    this.close(r);
  }

  /** Close the card; anyone waiting gets r (null = skipped or stopped). */
  close(r: Prediction | null = null) {
    clearTimeout(this.timer);
    const p = this.pending;
    this.pending = null;
    this.el.hidden = true;
    this.el.innerHTML = "";
    p?.done(r);
  }
}

const letterChoices = (choices: string[]) => choices.some((c) => /^[A-Za-z]$/.test(c.trim()));

/** Which choice a spoken answer means: the choice's own words ("node C", "B"), a label ("option b",
 * "number two"), or an ordinal ("the second one"). -1 if it can't tell. */
export function matchSpoken(text: string, choices: string[]): number {
  const norm = (x: string) => x.toLowerCase().replace(/[.,!?'"()]/g, " ").replace(/\s+/g, " ").trim();
  const t = norm(text);
  const words = t.split(" ");
  const n = choices.length;
  const SAY: Record<string, string> = { ay: "a", eh: "a", bee: "b", be: "b", see: "c", sea: "c", dee: "d", ee: "e" };
  const spoken = words.map((w) => SAY[w] ?? w);
  // 1. The choice's own words. Short choices ("B", "12") must be a whole word; the first one said wins.
  let best = -1, bestAt = Infinity, bestLen = 0;
  choices.forEach((c, i) => {
    const cc = norm(c);
    if (!cc) return;
    let at = -1;
    if (!cc.includes(" ") && cc.length <= 4) at = spoken.indexOf(cc);
    else { const k = ` ${spoken.join(" ")} `.indexOf(` ${cc} `); at = k < 0 ? -1 : spoken.join(" ").slice(0, k).split(" ").length - 1; }
    if (at >= 0 && (at < bestAt || (at === bestAt && cc.length > bestLen))) { best = i; bestAt = at; bestLen = cc.length; }
  });
  if (best >= 0) return best;
  // 2. Ordinals and numbers anywhere ("the second one", "number 2").
  const ORD: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4 };
  const NUM: Record<string, number> = { one: 0, two: 1, three: 2, four: 3, five: 4 };
  for (let k = 0; k < spoken.length; k++) {
    const w = spoken[k];
    // "one", "2" only as a label ("number two", "option 2", or said on its own): "a big one" isn't an answer.
    const asLabel = spoken.length === 1 || /^(number|option|answer|choice)$/.test(spoken[k - 1] ?? "");
    const i = w in ORD ? ORD[w] : asLabel && w in NUM ? NUM[w] : asLabel && /^[1-5]$/.test(w) ? Number(w) - 1 : -1;
    if (i >= 0 && i < n) return i;
  }
  // 3. A label letter ("option b", "it's c") when the choices aren't letters themselves.
  if (!letterChoices(choices)) {
    for (let k = 0; k < spoken.length; k++) {
      const w = spoken[k];
      const cue = k === 0 || /^(option|answer|choice|letter|is|its|it|s|say|pick|with)$/.test(spoken[k - 1]);
      if (/^[a-e]$/.test(w) && cue && w !== "a") { const i = w.charCodeAt(0) - 97; if (i < n) return i; }
      if (w === "a" && (spoken[k - 1] === "option" || spoken[k - 1] === "answer" || spoken.length === 1)) return 0;
    }
  }
  return -1;
}
