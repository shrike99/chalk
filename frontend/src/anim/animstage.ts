/**
 * The animated stage: runs Claude's scripts in the director worker and plays them in the player.
 *
 * It keeps what the worker knows (the scene, for the next script) in step with what's on screen,
 * and handles runaway scripts: if one doesn't finish in time the worker is thrown away and
 * restarted from the last good scene.
 */
import type { FromWorker, Program } from "./protocol";
import { Player, type PlayerState } from "./player";

export interface RunResult { program: Program; before: string; after: string }

const TIMEOUT_MS = 4000;

export class AnimStage {
  readonly player: Player;
  private worker!: Worker;
  private runId = 0;
  private good = ""; // the worker's scene after the last successful run ("" = empty)
  describe = "(the canvas is empty)";

  constructor(readonly host: HTMLElement) {
    this.player = new Player(host);
    this.spawn();
    new ResizeObserver(() => this.player.refit()).observe(host);
  }

  private spawn() {
    this.worker?.terminate();
    this.worker = new Worker(new URL("./director.worker.ts", import.meta.url), { type: "module" });
    if (this.good) this.worker.postMessage({ type: "restore", snapshot: this.good });
  }

  /** Run a script against the current scene. Never throws: errors come back in program.error. */
  run(script: string): Promise<RunResult> {
    const id = ++this.runId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.worker.removeEventListener("message", onMsg);
        this.spawn(); // kills the stuck script
        resolve({ program: { beats: [], describe: this.describe, error: `The script didn't finish within ${TIMEOUT_MS / 1000} s (an endless loop?).` }, before: this.good, after: this.good });
      }, TIMEOUT_MS);
      const onMsg = (ev: MessageEvent<FromWorker>) => {
        const m = ev.data;
        if (m.type !== "done" || m.runId !== id) return;
        clearTimeout(timer);
        this.worker.removeEventListener("message", onMsg);
        this.good = m.after;
        this.describe = m.program.describe;
        resolve({ program: m.program, before: m.before, after: m.after });
      };
      this.worker.addEventListener("message", onMsg);
      this.worker.postMessage({ type: "run", script, runId: id, aspect: this.aspect });
    });
  }

  /** The stage's width / height (the world is laid out to match it). */
  get aspect() {
    // measure the canvas area (the host itself may be hidden until the first animation)
    const box = this.host.parentElement ?? this.host;
    const r = box.getBoundingClientRect();
    return r && r.width && r.height ? r.width / r.height : 1.6;
  }
  /** For Claude: how big the world is right now. */
  get worldSize() { const h = Math.round(Math.max(420, Math.min(1400, 1000 / this.aspect))); return `1000 x ${h}`; }

  /** Put the worker's scene back (e.g. before running a fixed version of a failed script). */
  restore(snapshot: string, describe?: string) {
    this.good = snapshot;
    if (describe !== undefined) this.describe = describe;
    if (snapshot) this.worker.postMessage({ type: "restore", snapshot });
    else this.worker.postMessage({ type: "reset" });
  }

  reset() { this.restore(""); this.describe = "(the canvas is empty)"; this.player.clear(); }

  /** What the screen looks like after applying a program's first `n` beats to a starting state. */
  seek(base: PlayerState | null, program: Program, n: number) {
    this.player.load(base);
    for (let i = 0; i < Math.min(n, program.beats.length); i++) this.player.applyInstant(program.beats[i].cmds);
  }
  /** The state at the end of a program (for the next one to start from). */
  endState(base: PlayerState | null, program: Program): PlayerState {
    this.seek(base, program, program.beats.length);
    return this.player.dump();
  }
}
