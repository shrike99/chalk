/**
 * Messages between the director (a worker that runs Claude's script) and the player (which
 * draws and animates). The director runs the whole script instantly and records a timeline:
 * one "beat" per say(...), each a list of timed commands. The player plays a beat with real
 * animation, or applies beats instantly to jump to any point.
 */

export type Mark = "current" | "visited" | "done" | "error" | "none";

export interface TextSpec { text: string; dx?: number; dy?: number; cls?: string; anchor?: "start" | "middle" | "end" }

export type ShapeSpec =
  | { type: "rect"; w: number; h: number; r?: number }
  | { type: "circle"; w: number; h: number }
  | { type: "diamond"; w: number; h: number };

/** Every object is positioned by its centre (x, y) and has a size (w, h) used for layout and the camera. */
export interface PrimBase {
  x: number; y: number; w: number; h: number;
  layer?: "back" | "front";
  label?: string;       // what the click menu calls it
  clickable?: boolean;
}
export interface ShapePrim extends PrimBase {
  kind: "shape";
  shape?: ShapeSpec | null;   // null = just text
  hatch?: boolean;
  texts: TextSpec[];
  cls?: string;
  color?: string;             // palette name: indigo, orange, green, pink, blue, purple, yellow, teal, grey
  mark?: Mark;
  highlight?: boolean;
}
export type Endpoint = { id: string } | { x: number; y: number };
export interface ArrowPrim extends PrimBase {
  kind: "arrow";
  from: Endpoint; to: Endpoint;
  text?: string; bend?: number; head?: "end" | "both" | "none"; dashed?: boolean;
  cls?: string; color?: string; mark?: Mark; highlight?: boolean;
}
export interface MathPrim extends PrimBase { kind: "math"; tex: string; size: number; mark?: Mark; highlight?: boolean; color?: string }
export type Prim = ShapePrim | ArrowPrim | MathPrim;

export type Cmd =
  | { t: number; op: "create"; id: string; prim: Prim; anim: "pop" | "fade" | "draw" | "fly" | "none"; dur: number; from?: { x: number; y: number } }
  | { t: number; op: "move"; id: string; x: number; y: number; dur: number; arc?: number }
  | { t: number; op: "update"; id: string; props: Partial<ShapePrim & ArrowPrim & MathPrim>; effect?: "pop" | "flash" | "none" }
  | { t: number; op: "remove"; id: string; dur: number; anim?: "fade" | "shrink" | "up" }
  | { t: number; op: "flash"; id: string; dur: number }
  | { t: number; op: "spotlight"; ids: string[] | null }
  | { t: number; op: "camera"; box: [number, number, number, number] | null; dur: number }
  | { t: number; op: "packet"; from: { x: number; y: number }; to: { x: number; y: number }; dur: number; text?: string };

/** A pause where the student predicts what happens next, before the animation shows it. */
export interface Predict { question: string; choices: string[]; answer: number; explain: string }
export interface Beat { text: string; cmds: Cmd[]; animDur: number; predict?: Predict }

export interface Program {
  beats: Beat[];
  describe: string;            // what's on screen now, for Claude's next turn
  error?: string;              // the script threw: beats hold what ran before the error
  errorLine?: number;
}

export type ToWorker =
  | { type: "run"; script: string; runId: number; aspect?: number }
  | { type: "restore"; snapshot: string }
  | { type: "reset" };
export type FromWorker =
  | { type: "done"; runId: number; program: Program; before: string; after: string }
  | { type: "ready" };
