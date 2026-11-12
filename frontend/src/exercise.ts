/**
 * The exercise panel: Claude sets a problem, you write the code, Chalk runs it against Claude's tests.
 *
 * It takes over the canvas card (with a way back to the canvas). Examples are shown in full; edge
 * cases stay hidden until they fail, and then you get a nudge (a question about the input that
 * broke your code), not the answer. You can ask to see the case, take a hint, or ask Claude.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, StateField, StateEffect, Prec } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { classHighlighter } from "@lezer/highlight";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql, SQLite } from "@codemirror/lang-sql";
import { api, esc, fmtBytes, toast } from "./ctx";
import { icon } from "./icons";
import { md } from "./paper/md";
import { runJs, type RunSpec } from "./jsrunner";

export interface ExerciseRef { id: string; title: string; language: string; summary: string; dropped?: number }
interface Case {
  args?: unknown[]; args_expr?: string; args_note?: string; expected?: unknown; expected_args?: Record<string, unknown>; calls?: [string, unknown[]][];
  stdin?: string; expected_stdout?: string; name?: string; setup?: string; check?: string;
}
interface EdgeCase extends Case { nudge: string; revealed: boolean; why?: string }
interface Table { name: string; columns: string[]; rows: unknown[][]; total: number }
type Lang = "python" | "javascript" | "java" | "c" | "sql";
interface Exercise {
  title: string; language: Lang; kind: "function" | "class" | "program" | "query"; function?: string; class?: string; class_name?: string;
  signature?: string; schema?: string; tables?: Table[]; complexity_check?: boolean;
  prompt: string; starter: string; examples: Case[]; edge_cases: EdgeCase[]; hints: string[]; time_limit_ms: number;
}
const LANG_NAME: Record<Lang, string> = { python: "Python", javascript: "JavaScript", java: "Java", c: "C", sql: "SQL" };
const langMode = (l: Lang) => l === "python" ? python() : l === "java" ? java() : l === "c" ? cpp() : l === "sql" ? sql({ dialect: SQLite, upperCaseKeywords: true }) : javascript();
interface Result { status: string; got?: string; error?: string; error_type?: string; line?: number | null; stdout?: string; ms?: number; bad_call?: number | null }
interface CxPoint { n: number; ms: number | null; timeout?: boolean }
interface CxResult {
  points?: CxPoint[]; band?: number; label?: string; big_o?: string; per_doubling?: number; too_fast?: boolean; too_slow?: boolean;
  target?: string; can_beat?: boolean; why?: string; space?: string; prediction?: string; prediction_right?: boolean; error?: string;
}
export interface CxReview { time: string; space?: string; n?: string; line?: number; because?: string; band?: number | null; code?: string; exercise_id?: string }
interface CxState { prediction: string; result: CxResult; attempts: number; first?: CxResult; code?: string; review?: CxReview }
const CX_CHOICES: [string, string][] = [["O(1)", "the same"], ["O(log n)", "a tiny bit"], ["O(n)", "×2"], ["O(n log n)", "a bit over ×2"], ["O(n²)", "×4"], ["O(n³)", "×8"], ["O(2ⁿ)", "squares"]];
const fmtN = (n: number) => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n);
const fmtMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : ms >= 10 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`;

/** Your timings against what linear and quadratic growth would look like from the same start. */
function cxChart(pts: CxPoint[]): string {
  const W = 310, H = 136, L = 50, R = 40, T = 16, B = 24;
  const good = pts.filter((p) => p.ms != null) as { n: number; ms: number }[];
  if (!good.length) return "";
  const n0 = good[0].n, m0 = good[0].ms;
  const lin = pts.map((p) => m0 * (p.n / n0));
  const quad = pts.map((p) => m0 * (p.n / n0) ** 2);
  const top = Math.max(...good.map((p) => p.ms), ...lin) * 1.12 || 1;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, pts.length - 1);
  const y = (ms: number) => T + (H - T - B) * (1 - Math.min(ms, top * 1.04) / top);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const clipQuad = quad.map((v) => Math.min(v, top * 1.04));
  const mine = good.map((p) => `${pts.indexOf(p) ? "L" : "M"}${x(pts.indexOf(p)).toFixed(1)} ${y(p.ms).toFixed(1)}`).join(" ");
  const lastQ = quad.findIndex((v) => v > top * 1.04);
  return `<svg class="cx-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running time as the input doubles">
    <line x1="${L}" y1="${H - B}" x2="${W - R + 6}" y2="${H - B}" class="ax"/><line x1="${L}" y1="${T}" x2="${L}" y2="${H - B}" class="ax"/>
    <text x="${L - 6}" y="${T + 8}" class="lbl" text-anchor="end">${fmtMs(top / 1.12)}</text><text x="${L - 6}" y="${H - B}" class="lbl" text-anchor="end">0</text>
    ${pts.map((p, i) => `<text x="${x(i)}" y="${H - 8}" class="lbl" text-anchor="middle">${fmtN(p.n)}</text>`).join("")}
    <path d="${path(clipQuad)}" class="ref q"/><text x="${lastQ > 0 ? x(lastQ - 1) + 4 : W - R + 4}" y="${lastQ > 0 ? T + 9 : y(quad[quad.length - 1]) + 3}" class="lbl ref-l">n²</text>
    <path d="${path(lin)}" class="ref"/><text x="${W - R + 4}" y="${y(lin[lin.length - 1]) + 3}" class="lbl ref-l">n</text>
    <path d="${mine}" class="mine"/>
    ${good.map((p) => `<circle cx="${x(pts.indexOf(p))}" cy="${y(p.ms)}" r="3" class="mine-pt"/>`).join("")}
    ${pts.map((p, i) => p.timeout ? `<text x="${x(i)}" y="${T + 9}" class="lbl slow" text-anchor="middle">too slow</text>` : "").join("")}
    <text x="${x(good.length - 1) + 6}" y="${y(good[good.length - 1].ms) - 6}" class="lbl you">you</text>
  </svg>`;
}

interface Shaped {
  examples: (Case & Result)[]; edge_cases: (Partial<EdgeCase> & Result & { nudge: string; revealed: boolean; gated?: boolean; anticipated?: boolean })[];
  stdout: string; ms?: number; compile_error?: string; line?: number | null; mine?: (Case & Result)[]; gated?: boolean;
}
interface TestsState { tests: Case[]; skipped: boolean }
interface TestCheck { agrees?: boolean; reference?: string }

// ---------------------------------------------------------------- code walkthrough (Python)
interface TFrame { fn: string; line: number; vars: Record<string, unknown> }
interface TStep { line: number; event: string; stack: TFrame[]; stdout: string; value?: unknown; error?: string }
interface Trace { steps: TStep[]; result?: unknown; error?: string | null; stdout?: string; truncated?: boolean }

/** A value from the tracer, drawn: lists as indexed boxes, dicts as key → value rows. */
function drawVal(v: unknown, prev?: unknown, depth = 0): string {
  const changed = prev !== undefined && JSON.stringify(prev) !== JSON.stringify(v);
  const cls = changed ? " chg" : "";
  if (v === null) return `<span class="tv nil${cls}">None</span>`;
  if (typeof v === "boolean") return `<span class="tv${cls}">${v ? "True" : "False"}</span>`;
  if (typeof v === "number") return `<span class="tv num${cls}">${v}</span>`;
  if (typeof v === "string") return `<span class="tv str${cls}">"${esc(v)}"</span>`;
  if (Array.isArray(v)) {
    const p = Array.isArray(prev) ? prev : [];
    return `<span class="tl${cls}">${v.length ? v.map((x, i) => (x && typeof x === "object" && "$more" in (x as object))
      ? `<span class="tl-more">+${(x as { $more: number }).$more}</span>`
      : `<span class="tl-c"><em>${i}</em>${drawVal(x, p[i], depth + 1)}</span>`).join("") : `<span class="tl-empty">[ ]</span>`}</span>`;
  }
  const o = v as Record<string, unknown>;
  if (o.$type === "dict") {
    const pairs = o.pairs as [unknown, unknown][];
    const pp = new Map(((prev as Record<string, unknown>)?.pairs as [unknown, unknown][] | undefined)?.map(([k, x]) => [JSON.stringify(k), x]) ?? []);
    return `<span class="td${cls}">${pairs.length ? pairs.map(([k, x]) => `<span class="td-r">${drawVal(k, k, depth + 1)}<i>→</i>${drawVal(x, pp.get(JSON.stringify(k)), depth + 1)}</span>`).join("") : `<span class="tl-empty">{ }</span>`}</span>`;
  }
  if (o.$type === "set" || o.$type === "tuple") {
    const it = (o.items as unknown[]).map((x) => drawVal(x, undefined, depth + 1)).join(`<i class="sep">,</i>`);
    return `<span class="tv${cls}">${o.$type === "set" ? `{${it}}` : `(${it})`}</span>`;
  }
  if (o.attrs) return `<span class="td${cls}"><b class="td-t">${esc(String(o.$type))}</b>${Object.entries(o.attrs as Record<string, unknown>).map(([k, x]) => `<span class="td-r"><span class="tv">${esc(k)}</span><i>=</i>${drawVal(x, undefined, depth + 1)}</span>`).join("")}</span>`;
  return `<span class="tv obj${cls}">${esc(String(o.repr ?? o.$type))}</span>`;
}

// ---------------------------------------------------------------- the editor's error-line highlight
const setErrorLine = StateEffect.define<number | null>();
const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setErrorLine)) {
      if (e.value == null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
      return Decoration.set([Decoration.line({ class: "cm-error-line" }).range(tr.state.doc.line(e.value).from)]);
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const setFocusLine = StateEffect.define<number | null>();
const focusLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setFocusLine)) {
      if (e.value == null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
      return Decoration.set([Decoration.line({ class: "cm-focus-line" }).range(tr.state.doc.line(e.value).from)]);
    }
    return tr.docChanged ? Decoration.none : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const theme = EditorView.theme({
  "&": { fontSize: "13.5px", height: "100%", background: "transparent" },
  ".cm-content": { fontFamily: "'JetBrains Mono', Consolas, ui-monospace, monospace", padding: "10px 0", caretColor: "var(--text)" },
  ".cm-gutters": { background: "transparent", border: "none", color: "var(--text-3)" },
  ".cm-activeLine": { background: "color-mix(in srgb, var(--ink) 5%, transparent)" },
  ".cm-activeLineGutter": { background: "transparent", color: "var(--text-2)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", lineHeight: "1.6" },
  ".cm-error-line": { background: "color-mix(in srgb, #d93a3f 12%, transparent)" },
});

const show = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };
/** C parameter names, from "void reverse(int *a, int n)" → ["a", "n"]. */
const cParams = (sig = "") => (sig.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((p) => p.trim().match(/([A-Za-z_]\w*)\s*(\[\s*\])?$/)?.[1] ?? "").filter((p) => p && p !== "void");
const cell = (v: unknown) => v === null ? `<i class="null">NULL</i>` : esc(typeof v === "string" ? v : show(v));
const tableHtml = (columns: string[] | null, rows: unknown[][], caption = "") =>
  `<div class="ex-table-wrap">${caption ? `<div class="ex-table-cap">${caption}</div>` : ""}<table class="ex-table">${columns ? `<thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>` : ""}
   <tbody>${rows.length ? rows.map((r) => `<tr>${r.map((v) => `<td>${cell(v)}</td>`).join("")}</tr>`).join("") : `<tr><td class="empty" colspan="${Math.max(1, columns?.length ?? 1)}">no rows</td></tr>`}</tbody></table></div>`;
const parseGot = (g?: string) => { try { return g ? JSON.parse(g) : undefined; } catch { return undefined; } };
const callText = (ex: Exercise, c: Case) => {
  if (ex.kind === "query") return c.setup ? `the sample data, plus:<pre class="ex-sql">${esc(c.setup)}</pre>` : "the sample data";
  if (c.args_note) return `${esc(ex.function ?? "")}(<i>${esc(c.args_note)}</i>)`;
  if (ex.kind === "function") return `${esc(ex.function ?? "")}(${(c.args ?? []).map((a) => esc(show(a))).join(", ")})`;
  if (ex.kind === "class") return (c.calls ?? []).map(([n, a], k) => k === 0 ? `${esc(n)}(${a.map((x) => esc(show(x))).join(", ")})` : `.${esc(n)}(${a.map((x) => esc(show(x))).join(", ")})`).join(" ");
  return `input: <code>${esc(JSON.stringify(c.stdin ?? ""))}</code>`;
};
const wantText = (ex: Exercise, c: Case) => {
  if (ex.kind === "program") return esc(c.expected_stdout ?? "");
  if (c.expected_args) {
    const names = cParams(ex.signature);
    const parts = Object.entries(c.expected_args).map(([k, v]) => `${esc(names[Number(k)] ?? `argument ${Number(k) + 1}`)} = ${esc(show(v))}`);
    if (c.expected !== undefined) parts.unshift(`returns ${esc(show(c.expected))}`);
    return parts.join(", ");
  }
  return esc(show(c.expected));
};
/** A C result {"returned", "argument 1 afterwards"} with the parameter names put back. */
const gotText = (ex: Exercise, got: string) => {
  const g = parseGot(got);
  if (ex.language !== "c" || !g || typeof g !== "object" || !("returned" in g)) return esc(got);
  const names = cParams(ex.signature);
  return Object.entries(g as Record<string, unknown>).map(([k, v]) => {
    const m = k.match(/^argument (\d+) afterwards$/);
    return m ? `${esc(names[Number(m[1]) - 1] ?? k)} = ${esc(show(v))}` : v === null ? "" : `returns ${esc(show(v))}`;
  }).filter(Boolean).join(", ");
};

export class ExercisePanel {
  private id = "";
  private ex: Exercise | null = null;
  private view: EditorView | null = null;
  private last: Shaped | null = null;
  private running = false;
  private hintsShown = 0;
  private ranOnce = false;
  private saveTimer = 0;
  /** The language that isn't set up yet, after a run said so. */
  private missing: string | null = null;
  private chainTimer = 0;
  /** The complexity check, once every test passes: your guess, then the measurement. */
  private cx: CxState | null = null;
  private cxPick = "";
  private cxBusy = false;
  private reviewing = false;
  private tests: TestsState = { tests: [], skipped: false };
  private checks: TestCheck[] = [];
  private addingTest = false;
  private trace: Trace | null = null;
  private traceAt = 0;
  private traceLabel = "";
  private traceTimer = 0;
  constructor(private host: HTMLElement, private hooks: { close: () => void; ask: (text: string, exerciseId: string, extra?: { review_code?: string }) => Promise<void> | void; expand: () => void; settings?: () => void }) {}

  /** Claude's explanation of the complexity arrived (from the notebook's reply). */
  showReview(review: CxReview) {
    if (!this.ex || review.exercise_id !== this.id) return;
    this.reviewing = false;
    this.cx = { ...(this.cx ?? { prediction: "", attempts: 0, result: {} }), review: { ...review, code: this.code } };
    const box = this.host.querySelector<HTMLElement>("[data-cx]");
    if (box) { this.renderCx(box); box.querySelector(".cx-review")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    if (review.line) this.showLine(review.line);
  }

  // ---------------------------------------------------------------- your own tests (write them before the hints)
  private testsHtml(l: Shaped, label: (r: Result) => string, st: (r: Result) => string, detail: (c: Case, r: Result) => string,
                    walkBtn: (src: string, i: number, name: string) => string): string {
    const ex = this.ex!;
    if (ex.kind === "query") return "";
    const mine = this.tests.tests;
    const gate = l.gated && !mine.length;
    const rows = mine.map((t, k) => {
      const r = (l.mine?.[k] ?? { status: "skipped" }) as Result;
      const chk = this.checks[k];
      const ref = chk && chk.agrees === false ? `<div class="ex-kv warn"><span>Chalk's answer</span><code>${esc(chk.reference ?? "")}</code><em>Your expected answer differs. Who's right?</em></div>` : "";
      return `<div class="ex-row ${r.status}">${st(r)}<div><div class="ex-row-h">Your test ${k + 1} <span>${r.status === "skipped" || r.status === "not run" ? "Run to check" : label(r)}</span>${walkBtn("mine", k, `Your test ${k + 1}`)}<button class="ex-x" data-del-test="${k}" title="Remove this test" aria-label="Remove test ${k + 1}">${icon("x")}</button></div>
        ${r.status === "pass" ? `<div class="ex-call"><code>${callText(ex, t)}</code> → <code>${wantText(ex, t)}</code></div>` : detail({ ...t }, r)}${ref}</div></div>`;
    }).join("");
    const intro = gate ? `<div class="ex-own-intro"><b>Your turn first: what could break a solution?</b><span>Add the tricky inputs you can think of. Chalk then shows which hidden edge cases you saw coming, and its hints for the rest.</span></div>` : "";
    const form = this.addingTest ? this.testForm() : "";
    return `<div class="ex-group mine"><div class="ex-group-h">Your tests <span>${mine.length ? "they run every time, before the hidden ones" : "inputs you think are tricky"}</span></div>
      ${intro}${rows}${form}
      ${this.addingTest ? "" : `<div class="ex-own-acts"><button class="btn quiet sm" data-add-test>${icon("plus")}Add a test</button>${gate ? `<button class="btn quiet sm" data-skip-tests>Skip: show the hints</button>` : ""}</div>`}</div>`;
  }

  private testForm(): string {
    const ex = this.ex!;
    const eg = ex.examples[0] ?? {};
    if (ex.kind === "program") return `<div class="ex-form"><label>Input <textarea data-f="stdin" rows="3" spellcheck="false">${esc(eg.stdin ?? "")}</textarea></label>
      <label>Expected output <textarea data-f="out" rows="2" spellcheck="false"></textarea></label>${this.formActs()}</div>`;
    if (ex.kind === "class") return `<div class="ex-form"><label>Calls <small>[method, [arguments]] pairs, the first one makes the object</small><textarea data-f="calls" rows="3" spellcheck="false">${esc(JSON.stringify(eg.calls ?? []))}</textarea></label>
      <label>Expected <small>what each call returns, as a list</small><input data-f="exp" spellcheck="false"></label>${this.formActs()}</div>`;
    const names = ex.language === "c" ? cParams(ex.signature) : [];
    return `<div class="ex-form"><label>Arguments <small>as JSON, like the examples${names.length ? `: ${esc(names.join(", "))}` : ""}</small><textarea data-f="args" rows="2" spellcheck="false">${esc(JSON.stringify(eg.args ?? []))}</textarea></label>
      <label>${eg.expected_args && eg.expected === undefined ? `Arguments afterwards <small>e.g. {"0": [3, 2, 1]}</small>` : "Expected result"}<input data-f="exp" spellcheck="false" placeholder="${eg.expected_args && eg.expected === undefined ? '{"0": [...]}' : "e.g. [0, 1] or null"}"></label>${this.formActs()}</div>`;
  }

  private formActs() {
    return `<div class="ex-form-err" hidden></div><div class="ex-own-acts"><button class="btn quiet sm" data-cancel-test>Cancel</button><button class="btn primary sm" data-save-test>Add and run</button></div>`;
  }

  private wireTests(box: HTMLElement) {
    box.querySelector<HTMLElement>("[data-add-test]")?.addEventListener("click", () => {
      this.addingTest = true; this.renderResults();
      this.host.querySelector<HTMLElement>(".ex-form [data-f]")?.focus();
      this.host.querySelector(".ex-form")?.scrollIntoView({ block: "nearest" });
    });
    box.querySelector<HTMLElement>("[data-skip-tests]")?.addEventListener("click", () => this.saveTests(this.tests.tests, true));
    box.querySelector<HTMLElement>("[data-cancel-test]")?.addEventListener("click", () => { this.addingTest = false; this.renderResults(); });
    box.querySelectorAll<HTMLElement>("[data-del-test]").forEach((b) => (b.onclick = () => {
      const k = Number(b.dataset.delTest);
      this.saveTests(this.tests.tests.filter((_, i) => i !== k));
    }));
    box.querySelectorAll<HTMLElement>(".ex-form textarea, .ex-form input").forEach((el) => el.addEventListener("keydown", (e) => {
      e.stopPropagation();  // typing here isn't push-to-talk
      if ((e as KeyboardEvent).key === "Enter" && ((e as KeyboardEvent).ctrlKey || el.tagName === "INPUT")) { e.preventDefault(); box.querySelector<HTMLElement>("[data-save-test]")?.click(); }
    }));
    box.querySelector<HTMLElement>("[data-save-test]")?.addEventListener("click", () => {
      const f = (k: string) => box.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-f=${k}]`)?.value ?? "";
      const err = box.querySelector<HTMLElement>(".ex-form-err")!;
      const parse = (text: string, what: string) => {
        try { return JSON.parse(text.trim() || "null"); } catch { throw new Error(`${what} ${/s$/.test(what) ? "aren't" : "isn't"} valid JSON. Write ${/s$/.test(what) ? "them" : "it"} like the examples: [1, 2], "text", null.`); }
      };
      try {
        const ex = this.ex!;
        let t: Case;
        if (ex.kind === "program") t = { stdin: f("stdin"), expected_stdout: f("out") };
        else if (ex.kind === "class") t = { calls: parse(f("calls"), "The calls"), expected: parse(f("exp"), "The expected results") };
        else {
          const args = parse(f("args"), "The arguments");
          if (!Array.isArray(args)) throw new Error("Arguments go in a list, one item per argument: [[2, 7, 11], 9].");
          const exp = parse(f("exp"), "The expected result");
          const eg = ex.examples[0] ?? {};
          t = eg.expected_args && eg.expected === undefined && exp && typeof exp === "object" && !Array.isArray(exp) ? { args, expected_args: exp } : { args, expected: exp };
        }
        this.addingTest = false;
        this.saveTests([...this.tests.tests, t], undefined, true);
      } catch (e) { err.hidden = false; err.textContent = (e as Error).message; }
    });
  }

  private async saveTests(tests: Case[], skipped?: boolean, run = false) {
    try {
      const r = await api<{ tests: Case[]; skipped: boolean; checks: TestCheck[]; last: Shaped | null }>(`/api/exercises/${this.id}/tests`, { tests, skipped }, "PUT");
      this.tests = { tests: r.tests, skipped: r.skipped };
      this.checks = r.checks;
      if (r.last) this.last = r.last;
      if (r.tests.length < tests.length) toast("That test didn't fit", "Chalk couldn't use it: check it's shaped like the examples.");
    } catch (e) { toast("Couldn't save your tests", esc((e as Error).message)); }
    if (run && this.ranOnce) await this.run();
    else this.renderResults();
  }

  // ---------------------------------------------------------------- code walkthrough
  private async walk(source: string, index: number, name: string) {
    const box = this.host.querySelector<HTMLElement>(".ex-results");
    if (!box) return;
    box.innerHTML = `<div class="ex-empty"><span class="ex-spin"></span> Running your code step by step…</div>`;
    try {
      const t = await api<Trace>(`/api/exercises/${this.id}/trace`, { code: this.code, source, index });
      if (!t.steps?.length) { toast("Nothing to walk through", esc(t.error || "Your code didn't run any lines on this test.")); this.renderResults(); return; }
      this.trace = t; this.traceAt = 0; this.traceLabel = name;
      this.renderResults();
    } catch (e) { toast("Couldn't walk through it", esc((e as Error).message)); this.renderResults(); }
  }

  private closeTrace(render = true) {
    clearInterval(this.traceTimer); this.traceTimer = 0;
    this.trace = null;
    this.view?.dispatch({ effects: setFocusLine.of(null) });
    if (render) this.renderResults();
  }

  private renderTrace(box: HTMLElement) {
    const t = this.trace!, n = t.steps.length, i = Math.min(this.traceAt, n - 1);
    const step = t.steps[i], prev = i > 0 ? t.steps[i - 1] : undefined;
    const ev = step.event === "call" ? `calls <b>${esc(step.stack.at(-1)?.fn ?? "")}</b>` : step.event === "return" ? `<b>${esc(step.stack.at(-1)?.fn ?? "")}</b> returns ${drawVal(step.value)}`
      : step.event === "exception" ? `<span class="tr-err">${esc(step.error ?? "error")}</span>` : `runs line ${step.line}`;
    const frames = step.stack.map((f, k) => {
      const pf = prev?.stack[k]?.fn === f.fn ? prev.stack[k] : undefined;
      const vars = Object.entries(f.vars);
      return `<div class="tr-frame${k === step.stack.length - 1 ? " top" : ""}"><div class="tr-fn">${esc(f.fn === "<module>" ? "your program" : f.fn + "()")}<span>line ${f.line}</span></div>
        ${vars.length ? vars.map(([name, v]) => `<div class="tr-var${pf && !(name in pf.vars) ? " new" : ""}"><code>${esc(name)}</code><div>${drawVal(v, pf?.vars[name])}</div></div>`).join("") : `<div class="tr-none">no variables yet</div>`}</div>`;
    }).join("");
    const end = i === n - 1;
    box.innerHTML = `<div class="tr">
      <div class="tr-head"><b>Walkthrough: ${esc(this.traceLabel)}</b><span>step ${i + 1} of ${n}${t.truncated ? "+" : ""}</span><button class="btn quiet sm" data-tr="close">Back to results</button></div>
      <div class="tr-ctl">
        <button class="btn quiet sm" data-tr="first" title="First step (Home)" ${i ? "" : "disabled"}>${icon("skipback")}</button>
        <button class="btn quiet sm" data-tr="prev" title="Back (←)" ${i ? "" : "disabled"}>${icon("chevl")}</button>
        <button class="btn ${this.traceTimer ? "ink-soft" : "quiet"} sm" data-tr="play" title="Play (Space)">${icon(this.traceTimer ? "pause" : "play")}</button>
        <button class="btn quiet sm" data-tr="next" title="Next (→)" ${end ? "disabled" : ""}>${icon("chevr")}</button>
        <input type="range" min="0" max="${n - 1}" value="${i}" data-tr="seek" aria-label="Step">
      </div>
      <div class="tr-ev">${ev}</div>
      <div class="tr-frames">${frames}</div>
      ${step.stdout ? `<div class="tr-out"><span>Printed</span><pre>${esc(step.stdout)}</pre></div>` : ""}
      ${end ? `<div class="tr-end">${t.error ? `<span class="tr-err">${esc(t.error)}</span>` : `Finished: returned ${drawVal(t.result)}`}</div>` : ""}
    </div>`;
    this.view?.dispatch({ effects: [setFocusLine.of(step.line), EditorView.scrollIntoView(this.view.state.doc.line(Math.min(step.line, this.view.state.doc.lines)).from, { y: "nearest" })] });
    const go = (k: number) => { this.traceAt = Math.max(0, Math.min(n - 1, k)); this.renderTrace(box); };
    const act: Record<string, () => void> = {
      close: () => this.closeTrace(), first: () => go(0), prev: () => go(i - 1), next: () => go(i + 1),
      play: () => {
        if (this.traceTimer) { clearInterval(this.traceTimer); this.traceTimer = 0; this.renderTrace(box); return; }
        if (end) this.traceAt = 0;
        this.traceTimer = window.setInterval(() => {
          if (!this.trace || this.traceAt >= this.trace.steps.length - 1) { clearInterval(this.traceTimer); this.traceTimer = 0; if (this.trace) this.renderTrace(box); return; }
          this.traceAt++; this.renderTrace(box);
        }, 650);
        this.renderTrace(box);
      },
    };
    box.querySelectorAll<HTMLElement>("[data-tr]").forEach((b) => {
      if (b.dataset.tr === "seek") (b as HTMLInputElement).oninput = () => go(Number((b as HTMLInputElement).value));
      else b.onclick = act[b.dataset.tr!];
    });
    const tr = box.querySelector<HTMLElement>(".tr")!;
    tr.tabIndex = -1;
    tr.onkeydown = (e) => {
      const k = { ArrowRight: () => go(i + 1), ArrowLeft: () => go(i - 1), Home: () => go(0), End: () => go(n - 1), " ": act.play, Escape: act.close }[e.key];
      if (k) { e.preventDefault(); e.stopPropagation(); k(); }
    };
    if (!box.contains(document.activeElement)) tr.focus({ preventScroll: true });
  }

  /** The bar between the code and the test results: drag it (or use ↑/↓) to share the space. */
  private initSplit() {
    const bar = this.host.querySelector<HTMLElement>(".ex-split");
    const results = this.host.querySelector<HTMLElement>(".ex-results");
    const view = this.host.querySelector<HTMLElement>(".ex-view") ?? this.host;
    if (!bar || !results) return;
    const KEY = "chalk.exResultsHeight";
    const clamp = (h: number) => {
      const editor = this.host.querySelector<HTMLElement>(".ex-editor");
      const room = results.getBoundingClientRect().bottom - (editor?.getBoundingClientRect().top ?? 0);
      return Math.round(Math.max(56, Math.min(h, room - 110)));
    };
    const apply = (h: number | null) => {
      results.style.flex = h == null ? "" : `0 0 ${clamp(h)}px`;
      results.style.maxHeight = h == null ? "" : "none";
    };
    const saved = Number(localStorage.getItem(KEY));
    if (saved > 0) requestAnimationFrame(() => apply(saved));
    const save = () => { try { localStorage.setItem(KEY, String(Math.round(results.getBoundingClientRect().height))); } catch { /* private mode */ } };
    bar.onpointerdown = (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add("drag");
      view.classList.add("resizing");
      const bottom = results.getBoundingClientRect().bottom;
      bar.onpointermove = (m) => apply(bottom - m.clientY);
      bar.onpointerup = bar.onpointercancel = () => {
        bar.onpointermove = bar.onpointerup = bar.onpointercancel = null;
        bar.classList.remove("drag");
        view.classList.remove("resizing");
        save();
        this.view?.requestMeasure();
      };
    };
    bar.ondblclick = () => { apply(null); localStorage.removeItem(KEY); this.view?.requestMeasure(); };
    bar.onkeydown = (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      apply(results.getBoundingClientRect().height + (e.key === "ArrowUp" ? 32 : -32));
      save();
      this.view?.requestMeasure();
    };
  }

  private showLine(line: number) {
    if (!this.view || line < 1 || line > this.view.state.doc.lines) return;
    const pos = this.view.state.doc.line(line).from;
    this.view.dispatch({ effects: [setFocusLine.of(line), EditorView.scrollIntoView(pos, { y: "center" })] });
  }

  get openId() { return this.id; }

  async open(id: string) {
    const r = await api<{ exercise: Exercise; code: string; last: Shaped | null; summary: string; cx: CxState | null; tests: TestsState | null }>(`/api/exercises/${id}`).catch((e) => { toast("Couldn't open that exercise", esc((e as Error).message)); return null; });
    if (!r) return false;
    this.id = id; this.ex = r.exercise; this.last = r.last; this.hintsShown = 0; this.ranOnce = !!r.last; this.missing = null;
    this.cx = r.cx; this.cxPick = ""; this.cxBusy = false;
    this.tests = r.tests ?? { tests: [], skipped: false }; this.checks = []; this.addingTest = false; this.closeTrace(false);
    this.render(r.summary, r.code || r.exercise.starter);
    return true;
  }

  private render(summary: string, code: string) {
    const ex = this.ex!;
    this.host.innerHTML = `
      <div class="ex-head">
        <button class="icon-btn sm" data-x="close" title="Back to the canvas" aria-label="Back to the canvas">${icon("back")}</button>
        <div class="ex-title"><b>${esc(ex.title)}</b><span>${esc(summary)}</span></div>
        <div class="ex-tools">
          ${ex.hints.length ? `<button class="btn quiet sm" data-x="hint" title="A hint, one at a time">${icon("bulb")}Hint</button>` : ""}
          <button class="btn quiet sm" data-x="ask" title="Ask Claude about your code (it won't just give you the answer)">${icon("chat")}Ask Claude</button>
          <button class="btn primary sm" data-x="run" title="Run the tests (Ctrl+Enter)">${icon("play")}Run</button>
          <button class="icon-btn sm" data-x="expand" title="More room" aria-label="More room">${icon("expand")}</button>
        </div>
      </div>
      <div class="ex-main">
        <details class="ex-prompt"${this.ranOnce ? "" : " open"}><summary>Problem</summary><div class="ex-prompt-body">${md(ex.prompt)}
          ${ex.tables?.length ? `<div class="ex-tables">${ex.tables.map((t) => tableHtml(t.columns, t.rows, `<b>${esc(t.name)}</b>${t.total > t.rows.length ? ` · first ${t.rows.length} of ${t.total} rows` : ""}`)).join("")}</div>` : ""}
          ${ex.kind !== "query" && ex.examples.length && !ex.prompt.includes("```") ? `<div class="ex-eg">${ex.examples.map((c) => `<div><code>${callText(ex, c)}</code> → <code>${wantText(ex, c)}</code></div>`).join("")}</div>` : ""}</div></details>
        <div class="ex-hints" hidden></div>
        <div class="ex-editor"><span class="ex-lang">${LANG_NAME[ex.language] ?? ex.language}${ex.language === "sql" ? " · SQLite" : ""}</span></div>
        <div class="ex-split" role="separator" aria-orientation="horizontal" aria-label="Drag to resize the test results" tabindex="0" title="Drag to resize · double-click to reset"><span></span></div>
        <div class="ex-results" aria-live="polite"></div>
      </div>`;
    this.host.querySelectorAll<HTMLElement>("[data-x]").forEach((b) => (b.onclick = () => this.action(b.dataset.x!)));
    this.view?.destroy();
    this.initSplit();
    this.view = new EditorView({
      parent: this.host.querySelector(".ex-editor")!,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(), highlightActiveLine(), drawSelection(), history(), bracketMatching(), closeBrackets(), indentOnInput(),
          indentUnit.of(ex.language === "javascript" || ex.language === "sql" ? "  " : "    "), EditorState.tabSize.of(4),
          syntaxHighlighting(classHighlighter), theme, errorLine, focusLine, langMode(ex.language),
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => { this.run(); return true; } }, { key: "Escape", run: (v) => { v.contentDOM.blur(); return true; } }])),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => { if (u.docChanged) this.queueSave(); }),
        ],
      }),
    });
    this.renderResults();
  }

  private queueSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => api(`/api/exercises/${this.id}`, { code: this.code }, "PATCH").catch(() => {}), 800);
  }
  get code() { return this.view?.state.doc.toString() ?? ""; }
  /** Replace the code (used by the UI tests). */
  setCode(code: string) { this.view?.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: code } }); }
  focus() { this.view?.focus(); }

  private action(x: string) {
    if (x === "close") this.hooks.close();
    else if (x === "run") this.run();
    else if (x === "expand") this.hooks.expand();
    else if (x === "hint") this.hint();
    else if (x === "ask") this.ask();
  }

  private hint() {
    const ex = this.ex!;
    if (this.hintsShown >= ex.hints.length) return;
    this.hintsShown++;
    const box = this.host.querySelector<HTMLElement>(".ex-hints")!;
    box.hidden = false;
    box.innerHTML = ex.hints.slice(0, this.hintsShown).map((h, i) => `<div class="ex-hint"><b>Hint ${i + 1}</b> ${md(h)}</div>`).join("")
      + (this.hintsShown < ex.hints.length ? "" : `<div class="ex-hint-end">That's every hint. Still stuck? Ask Claude.</div>`);
    const btn = this.host.querySelector<HTMLButtonElement>('[data-x="hint"]');
    if (btn) { btn.disabled = this.hintsShown >= ex.hints.length; btn.lastChild!.textContent = this.hintsShown < ex.hints.length ? "Another hint" : "No more hints"; }
  }

  async run() {
    if (this.running || !this.ex) return;
    this.running = true;
    const btn = this.host.querySelector<HTMLButtonElement>('[data-x="run"]')!;
    btn.disabled = true; btn.innerHTML = `<span class="ex-spin"></span>Running`;
    this.host.querySelector(".ex-results")!.classList.add("stale");
    try {
      if (this.ex.language !== "javascript") {
        this.missing = null;
        this.last = await api<Shaped>(`/api/exercises/${this.id}/run`, { code: this.code });
      } else {
        const spec = await api<RunSpec>(`/api/exercises/${this.id}/cases`);
        const run = await runJs(this.code, spec);
        this.last = await api<Shaped>(`/api/exercises/${this.id}/results`, { code: this.code, run });
      }
    } catch (e) {
      const d = (e as { detail?: { missing?: string } }).detail;
      if (d && typeof d === "object" && d.missing) this.missing = d.missing;
      else toast("Couldn't run your code", esc((e as Error).message));
    } finally {
      this.running = false;
      btn.disabled = false; btn.innerHTML = `${icon("play")}Run`;
      this.host.querySelector(".ex-results")?.classList.remove("stale");
      // After the first run the problem folds away: the code and the results need the room.
      const prompt = this.host.querySelector<HTMLDetailsElement>(".ex-prompt");
      if (prompt && !this.ranOnce) prompt.open = false;
      this.ranOnce = true;
      this.renderResults();
      this.host.querySelector(".ex-results")?.scrollTo({ top: 0 });
    }
  }

  private async reveal(j: number) {
    const r = await api<{ exercise: Exercise; last: Shaped | null }>(`/api/exercises/${this.id}/reveal/${j}`, {});
    this.ex = { ...this.ex!, edge_cases: r.exercise.edge_cases };
    if (r.last) this.last = r.last;
    this.renderResults();
  }

  private async renderMissing(box: HTMLElement) {
    const id = this.missing!;
    const name = LANG_NAME[id as Lang] ?? id;
    let chains: { id: string; state: string; detail?: string; size?: string; can_download?: boolean; progress?: { phase: string; done: number; total: number } }[] = [];
    try { chains = (await api<{ languages: typeof chains }>("/api/toolchains")).languages; } catch { /* offline backend: show the plain message */ }
    if (this.missing !== id) return;
    const c = chains.find((x) => x.id === id);
    clearTimeout(this.chainTimer);
    if (c?.state === "ready") { this.missing = null; this.run(); return; }
    let body: string;
    if (c?.state === "installing") {
      const p = c.progress!, pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      body = `<div class="ex-setup-p">${p.phase === "unpacking" ? "Unpacking…" : p.total ? `Downloading ${name}… ${fmtBytes(p.done)} of ${fmtBytes(p.total)}` : `Downloading ${name}…`}</div>
        <div class="progress${pct ? "" : " indeterminate"}"><div style="width:${pct}%"></div></div><div class="ex-setup-p dim">Your code runs as soon as it's ready.</div>`;
      this.chainTimer = window.setTimeout(() => this.renderResults(), 700);
    } else if (c?.can_download) {
      body = `<div class="ex-setup-p">${esc(c.state === "error" ? c.detail ?? "The download failed." : `To run ${name} here, Chalk needs ${name === "Java" ? "a Java compiler (the JDK)" : "a C compiler"}: a one-time download${c.size ? ` of ${c.size}` : ""}.`)}</div>
        <div class="ex-setup-btns"><button class="btn primary sm" data-get="${id}">${icon("download")}${c.state === "error" ? "Try again" : `Set up ${name}`}</button>
        <button class="btn quiet sm" data-settings>Languages in Settings</button></div>`;
    } else {
      body = `<div class="ex-setup-p">${esc(c?.detail ?? `${name} isn't set up on this PC.`)}</div><div class="ex-setup-btns"><button class="btn quiet sm" data-settings>Languages in Settings</button></div>`;
    }
    box.innerHTML = `<div class="ex-setup"><b>${esc(name)} isn't set up on this PC yet</b>${body}</div>`;
    box.querySelector<HTMLButtonElement>("[data-get]")?.addEventListener("click", async (e) => {
      (e.currentTarget as HTMLButtonElement).disabled = true;
      try { await api(`/api/toolchains/${id}`, {}); } catch (err) { toast("Couldn't start the download", esc((err as Error).message)); }
      this.renderResults();
    });
    box.querySelector<HTMLButtonElement>("[data-settings]")?.addEventListener("click", () => this.hooks.settings?.());
  }

  private ask() {
    const ex = this.ex!, l = this.last;
    const fence = "```";
    let status = "I haven't run it yet.";
    if (l?.compile_error) status = `It doesn't run: ${l.compile_error}${l.line ? ` (line ${l.line})` : ""}.`;
    else if (l) {
      const exPass = l.examples.filter((r) => r.status === "pass").length;
      const edPass = l.edge_cases.filter((r) => r.status === "pass").length;
      const firstBad = l.examples.find((r) => r.status !== "pass");
      const edgeBad = l.edge_cases.find((r) => r.status !== "pass");
      status = `${exPass}/${l.examples.length} examples and ${edPass}/${l.edge_cases.length} edge cases pass.`;
      if (firstBad) status += ` An example fails: ${firstBad.status}${firstBad.got ? `, I return ${firstBad.got}` : ""}${firstBad.error ? ` (${firstBad.error})` : ""}.`;
      else if (edgeBad) status += ` The edge case I'm stuck on asks: "${edgeBad.nudge}"`;
    }
    this.hooks.ask(`I'm working on the "${ex.title}" exercise. ${status} Can you help me see what's wrong without just giving me the answer?\n\n${fence}${ex.language}\n${this.code}\n${fence}`, this.id);
  }

  private renderResults() {
    const box = this.host.querySelector<HTMLElement>(".ex-results");
    if (!box || !this.ex) return;
    const ex = this.ex, l = this.last;
    this.view?.dispatch({ effects: setErrorLine.of(l?.compile_error ? l.line ?? null : l?.examples.find((r) => r.status === "error")?.line ?? null) });
    if (this.missing) { this.renderMissing(box); return; }
    if (this.trace) { this.renderTrace(box); return; }
    if (!l) { box.innerHTML = `<div class="ex-empty">Write your ${ex.kind === "query" ? "query" : "code"}, then <b>Run</b> (Ctrl+Enter). It's checked against the examples and ${ex.edge_cases.length} hidden edge case${ex.edge_cases.length === 1 ? "" : "s"}.</div>`; return; }
    if (l.compile_error) {
      box.innerHTML = `<div class="ex-sum bad"><b>Your code didn't run</b></div><div class="ex-row error"><span class="ex-st">${icon("x")}</span><div><div class="ex-err">${esc(l.compile_error)}${l.line ? ` <span class="ex-line">line ${l.line}</span>` : ""}</div>${l.stdout ? `<pre class="ex-out">${esc(l.stdout)}</pre>` : ""}</div></div>`;
      return;
    }
    const pass = (r: Result) => r.status === "pass";
    const exOk = l.examples.filter(pass).length, edOk = l.edge_cases.filter(pass).length;
    const all = exOk === l.examples.length && edOk === l.edge_cases.length;
    const label = (r: Result) => ({ pass: "Passed", fail: ex.kind === "query" ? "Wrong rows" : "Wrong answer", error: ex.kind === "query" ? "SQL error" : "Crashed", timeout: `Took longer than ${(ex.time_limit_ms / 1000).toFixed(1)} s`, skipped: "Not run" } as Record<string, string>)[r.status] ?? r.status;
    const st = (r: Result) => `<span class="ex-st ${r.status}">${icon(r.status === "pass" ? "check" : r.status === "skipped" ? "minus" : "x")}</span>`;
    const detail = (c: Case, r: Result) => `
      <div class="ex-call"><code>${callText(ex, c)}</code></div>
      ${ex.kind === "query" ? queryDetail(c, r) : `
      ${r.status !== "pass" && r.status !== "skipped" ? `<div class="ex-kv"><span>Expected</span><code>${wantText(ex, c)}</code></div>` : ""}
      ${r.got !== undefined && r.status === "fail" ? `<div class="ex-kv"><span>${ex.kind === "program" ? "Printed" : "Got"}</span><code>${gotText(ex, r.got)}</code></div>` : ""}`}
      ${r.bad_call != null && ex.kind === "class" ? `<div class="ex-kv"><span>First wrong call</span><code>#${r.bad_call + 1}</code></div>` : ""}
      ${r.error ? `<div class="ex-err">${esc(r.error)}${r.line ? ` <span class="ex-line">line ${r.line}</span>` : ""}</div>` : ""}
      ${r.stdout ? `<details class="ex-print"><summary>Printed</summary><pre class="ex-out">${esc(r.stdout)}</pre></details>` : ""}`;
    const queryDetail = (c: Case, r: Result) => {
      if (r.status !== "fail") return "";
      const got = parseGot(r.got) as { columns?: string[]; rows?: unknown[][] } | undefined;
      const cols = got?.columns ?? null;
      return `<div class="ex-tables two">${tableHtml(cols && (c.expected as unknown[][])[0]?.length === cols.length ? cols : null, (c.expected as unknown[][]) ?? [], "Expected")}
        ${got?.rows ? tableHtml(cols, got.rows, "Your query returned") : ""}</div>${c.check ? `<div class="ex-kv"><span>Checked with</span><code>${esc(c.check)}</code></div>` : ""}`;
    };
    const canWalk = ex.language === "python" && ex.kind !== "query";
    const walkBtn = (src: string, i: number, name: string) => canWalk ? `<button class="btn quiet sm ex-walk" data-walk="${src}:${i}" data-walk-name="${esc(name)}" title="Step through your code on this test">${icon("play")}Walk through</button>` : "";
    const exRows = l.examples.map((r, i) => `<div class="ex-row ${r.status}">${st(r)}<div><div class="ex-row-h">Example ${i + 1} <span>${label(r)}${r.ms != null && r.status === "pass" ? ` · ${r.ms} ms` : ""}</span>${walkBtn("example", i, `Example ${i + 1}`)}</div>${r.status === "pass" ? "" : detail(r, r)}</div></div>`).join("");
    const hasMine = this.tests.tests.length > 0;
    const edRows = l.edge_cases.map((r, j) => {
      const tag = hasMine ? (r.anticipated ? `<b class="ex-tag hit">${icon("check")}You thought of this</b>` : `<b class="ex-tag miss">You didn't test this</b>`) : "";
      const head = `<div class="ex-row-h">Edge case ${j + 1}${r.name ? `: ${esc(r.name)}` : ""} <span>${label(r)}</span>${tag}${r.revealed ? walkBtn("edge", j, `Edge case ${j + 1}`) : ""}</div>`;
      if (pass(r)) return `<div class="ex-row pass">${st(r)}<div>${head}</div></div>`;
      if (r.status === "skipped") return `<div class="ex-row skipped">${st(r)}<div>${head}</div></div>`;
      if (r.gated) return `<div class="ex-row ${r.status}">${st(r)}<div>${head}<div class="ex-nudge gated">${icon("bulb")}<span>Something here breaks your code. What could it be? Write a test for it above, before Chalk gives you a hint.</span></div></div></div>`;
      const body = r.revealed
        ? `${detail(r as Case, r)}${r.why ? `<div class="ex-why">${md(r.why)}</div>` : ""}`
        : `<div class="ex-nudge">${icon("bulb")}<span>${esc(r.nudge)}</span></div>${r.error_type ? `<div class="ex-kv"><span>It crashed with</span><code>${esc(r.error_type)}</code></div>` : ""}
           <button class="btn quiet sm ex-reveal" data-reveal="${j}">Show me the case</button>`;
      return `<div class="ex-row ${r.status}">${st(r)}<div>${head}${body}</div></div>`;
    }).join("");
    const firstFail = l.examples.find((r) => !pass(r));
    box.innerHTML = `
      <div class="ex-sum ${all ? "good" : ""}">
        <b>${all ? "Every test passes" : firstFail ? "Get the examples working first" : exOk === l.examples.length ? "The examples pass. Now the edge cases" : ""}</b>
        <span class="ex-pips">${l.examples.map((r) => `<i class="${r.status}"></i>`).join("")}<em></em>${l.edge_cases.map((r) => `<i class="${r.status} edge"></i>`).join("")}</span>
        <span class="ex-count">Examples ${exOk}/${l.examples.length} · Edge cases ${edOk}/${l.edge_cases.length}</span>
      </div>
      ${all && !ex.complexity_check ? `<div class="ex-done">Including ${l.edge_cases.length} edge case${l.edge_cases.length === 1 ? "" : "s"} you couldn't see. Can you explain why your solution handles them? Try telling Claude.</div>` : ""}
      ${all && ex.complexity_check ? `<div class="cx" data-cx></div>` : ""}
      ${l.stdout ? `<details class="ex-print"><summary>Printed while loading</summary><pre class="ex-out">${esc(l.stdout)}</pre></details>` : ""}
      <div class="ex-group">${exRows}</div>
      ${this.testsHtml(l, label, st, detail, walkBtn)}
      ${l.edge_cases.length ? `<div class="ex-group edge"><div class="ex-group-h">Hidden edge cases <span>${hasMine ? `you anticipated ${l.edge_cases.filter((r) => r.anticipated).length} of ${l.edge_cases.length}` : "inputs chosen to break code that only handles the examples"}</span></div>${edRows}</div>` : ""}`;
    box.querySelectorAll<HTMLElement>("[data-reveal]").forEach((b) => (b.onclick = () => this.reveal(Number(b.dataset.reveal))));
    this.wireTests(box);
    box.querySelectorAll<HTMLElement>("[data-walk]").forEach((b) => (b.onclick = () => {
      const [src, i] = b.dataset.walk!.split(":");
      this.walk(src, Number(i), b.dataset.walkName ?? "");
    }));
    const cxEl = box.querySelector<HTMLElement>("[data-cx]");
    if (cxEl) this.renderCx(cxEl);
  }

  // ---------------------------------------------------------------- how fast is it? (predict, then measure)
  private renderCx(el: HTMLElement) {
    const done = this.cx?.result && !this.cx.result.error;
    const stale = done && this.cx!.code !== undefined && this.cx!.code !== this.code;
    if (this.cxBusy) {
      el.innerHTML = `<div class="cx-h"><b>Timing your code</b></div><div class="cx-busy"><span class="ex-spin"></span>Running it on bigger and bigger inputs…</div>`;
      return;
    }
    if (!done || stale) {
      const before = stale ? this.cx!.result : null;
      el.innerHTML = `<div class="cx-h"><b>${stale ? "You changed your code. How fast is it now?" : "Bonus round: how fast is it?"}</b></div>
        <p class="cx-q">When the input gets twice as big, what happens to the time your code takes? Pick its time complexity, then Chalk times it.</p>
        <div class="cx-choices" role="radiogroup" aria-label="Time complexity">${CX_CHOICES.map(([o, hint]) => `<button class="cx-choice${this.cxPick === o ? " on" : ""}" role="radio" aria-checked="${this.cxPick === o}" data-pick="${o}"><b>${o}</b><span>${hint}</span></button>`).join("")}</div>
        ${before?.big_o ? `<div class="cx-prev">Last time it measured ${esc(before.label ?? "")} (${esc(before.big_o)}).</div>` : ""}
        ${this.cx?.result?.error ? `<div class="ex-err">${esc(this.cx.result.error)}</div>` : ""}
        <div class="cx-acts"><button class="btn primary sm" data-cx-go ${this.cxPick ? "" : "disabled"}>Time it</button></div>`;
      el.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((b) => (b.onclick = () => { this.cxPick = b.dataset.pick!; this.renderCx(el); }));
      el.querySelector<HTMLButtonElement>("[data-cx-go]")!.onclick = () => this.measure(el);
      return;
    }
    const r = this.cx!.result;
    const pts = r.points ?? [];
    const good = pts.filter((p) => p.ms != null);
    const growth = r.too_slow ? `Even the smallest input didn't finish in time: it grows <b>very fast</b>.`
      : r.too_fast ? `It finished almost instantly at every size: its time <b>barely grows</b>.`
      : `Each time the input doubled, your code took about <b>×${r.per_doubling}</b> as long: <b>${esc(r.label ?? "")}</b> growth, so ${esc(r.big_o ?? "")}.`;
    const guess = r.prediction ? (r.prediction_right ? `<div class="cx-verdict ok">${icon("check")}You said ${esc(r.prediction)}: spot on.</div>`
      : `<div class="cx-verdict no">${icon("x")}You said ${esc(r.prediction)}. ${(r.band ?? 9) > (CX_BANDS[r.prediction] ?? 0) ? "It grows faster than that: look for work your code repeats inside a loop." : "It's quicker than you thought: what does it avoid repeating?"}</div>`) : "";
    const target = r.can_beat
      ? `<div class="cx-beat"><b>There's a faster way: ${esc(r.target ?? "")} is possible.</b><span>Your code passes, so this is a bonus round. Can you find it?</span>
          <div class="cx-acts"><button class="btn quiet sm" data-cx-retry>Change my code</button><button class="btn ink-soft sm" data-cx-nudge>${icon("bulb")}Give me a nudge</button></div></div>`
      : r.target ? `<div class="cx-best">${icon("check")}<div><b>That's as fast as it gets here (${esc(r.target)}).</b>${r.why ? `<span>${md(r.why)}</span>` : ""}${r.space ? `<span class="cx-space">Memory: ${esc(r.space)}. What does your code store?</span>` : ""}</div></div>` : "";
    const rv = this.cx!.review && this.cx!.review.code === this.code ? this.cx!.review : null;
    const review = rv ? `<div class="cx-review">
        <div class="cx-review-h">${icon("sparkle")}<b>Claude's read of your code</b></div>
        <div class="cx-review-o"><span><em>Time</em>${esc(rv.time)}</span>${rv.space ? `<span><em>Memory</em>${esc(rv.space)}</span>` : ""}${rv.n ? `<span class="cx-n">${esc(rv.n)}</span>` : ""}</div>
        ${rv.because ? `<div class="cx-because">${md(rv.because)}</div>` : ""}
        ${rv.line ? `<button class="btn quiet sm" data-cx-line="${rv.line}">Show line ${rv.line}</button>` : ""}
      </div>`
      : `<div class="cx-acts left"><button class="btn quiet sm" data-cx-explain ${this.reviewing ? "disabled" : ""}>${this.reviewing ? `<span class="ex-spin"></span>Asking Claude…` : `${icon("sparkle")}Ask Claude to explain`}</button>
         <span class="cx-hint">Exact time and memory complexity, and the line responsible</span></div>`;
    el.innerHTML = `<div class="cx-h"><b>How fast is it?</b><button class="btn quiet sm" data-cx-again>Time it again</button></div>
      ${guess}
      <div class="cx-body">${good.length >= 2 ? cxChart(pts) : ""}
        <div class="cx-times">${pts.map((p) => `<span><em>n = ${fmtN(p.n)}</em>${p.ms == null ? "too slow" : fmtMs(p.ms)}</span>`).join("")}</div></div>
      <p class="cx-growth">${growth}</p>
      ${review}
      ${target}`;
    el.querySelector<HTMLButtonElement>("[data-cx-line]")?.addEventListener("click", (e) => this.showLine(Number((e.currentTarget as HTMLElement).dataset.cxLine)));
    el.querySelector<HTMLButtonElement>("[data-cx-explain]")?.addEventListener("click", () => this.askReview(el, r));
    el.querySelector<HTMLButtonElement>("[data-cx-again]")!.onclick = () => this.measure(el);
    el.querySelector<HTMLButtonElement>("[data-cx-retry]")?.addEventListener("click", () => this.view?.focus());
    el.querySelector<HTMLButtonElement>("[data-cx-nudge]")?.addEventListener("click", () => this.hooks.ask(
      `My solution passes, but Chalk timed it as ${r.big_o ?? r.label} and says ${r.target} is possible. Can you nudge me towards it without giving it away?`, this.id));
  }

  private async askReview(el: HTMLElement, r: CxResult) {
    if (this.reviewing || !this.ex) return;
    this.reviewing = true;
    this.renderCx(el);
    const fence = "```";
    const timing = r.per_doubling ? `Chalk timed it as ${r.big_o} (×${r.per_doubling} each time the input doubled).` : r.label ? `Chalk timed it: ${r.label}.` : "";
    void timing; void fence;
    try {
      // A one-off question on the small model: the note's conversation doesn't grow.
      this.showReview(await api<CxReview>(`/api/exercises/${this.id}/review`, { code: this.code }));
    } catch (e) {
      toast("Claude couldn't explain it", esc((e as Error).message));
    } finally {
      if (this.reviewing) {  // no review came back (an error, or Claude left it out)
        this.reviewing = false;
        const box = this.host.querySelector<HTMLElement>("[data-cx]");
        if (box) this.renderCx(box);
      }
    }
  }

  private async measure(el: HTMLElement) {
    if (this.cxBusy || !this.ex) return;
    const prediction = this.cxPick || this.cx?.prediction || "";
    this.cxBusy = true; this.renderCx(el);
    try {
      let body: Record<string, unknown> = { code: this.code, prediction };
      if (this.ex.language === "javascript") {
        // Timed here in the app; like the server does for other languages, resize the inputs until the times are readable.
        const spec = await api<RunSpec>(`/api/exercises/${this.id}/cases`);
        let scale = 1;
        for (let attempt = 0; ; attempt++) {
          const plan = await api<{ sizes: number[]; cases: RunSpec["cases"] }>(`/api/exercises/${this.id}/complexity/plan?scale=${scale}`);
          const run = await runJs(this.code, { ...spec, cases: plan.cases, time_limit_ms: 1500 });
          body = { ...body, sizes: plan.sizes, results: run.results };
          const k = plan.sizes.length + 1, best: number[] = [];
          let timedOut = false;
          run.results.forEach((x, i) => {
            if (x.status === "timeout") timedOut = true;
            else if (i % k && x.ms != null) best[i % k] = Math.min(best[i % k] ?? Infinity, x.ms);
          });
          const top = Math.max(0, ...best.filter((v) => v != null));
          if (attempt >= 2) break;
          if (!timedOut && top < 3 && scale < 64) { scale *= 8; continue; }
          if ((timedOut && best.filter((v) => v != null).length < 3) || (best[1] ?? 0) > 250) { scale /= 8; continue; }
          break;
        }
      }
      this.cx = { ...(await api<CxState>(`/api/exercises/${this.id}/complexity`, body)), code: this.code };
      this.cxPick = "";
    } catch (e) {
      const d = (e as { detail?: { missing?: string } }).detail;
      if (d && typeof d === "object" && d.missing) { this.missing = d.missing; this.cxBusy = false; this.renderResults(); return; }
      this.cx = { prediction, attempts: 0, result: { error: (e as Error).message }, code: this.code };
    } finally {
      this.cxBusy = false;
    }
    const box = this.host.querySelector<HTMLElement>("[data-cx]");
    if (box) this.renderCx(box);
  }
}

const CX_BANDS: Record<string, number> = { "O(1)": 0, "O(log n)": 0, "O(n)": 1, "O(n log n)": 1, "O(n²)": 2, "O(n³)": 3, "O(2ⁿ)": 4 };
