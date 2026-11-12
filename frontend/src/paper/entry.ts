/**
 * A Chalk document laid out as A4 pages: /paper.html?doc=<id>&part=paper|scheme&theme=light|dark
 *
 * The same pages are the preview inside Chalk (in an iframe) and the PDF (the desktop app loads this
 * page in a hidden window with &print=1 and prints it), so what you see is exactly what you save.
 */
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import "@fontsource/jetbrains-mono/400.css";
import "katex/dist/katex.min.css";
import "./paper.css";
import { md, mdInline, escHtml as esc, cleanSvg } from "./md";
import { drawFigure } from "./figures";

type Answer = {
  lines?: number; space?: number; grid?: number; choices?: string[]; multi?: number; final?: string;
  table?: { headers: string[]; rows: number; first_column?: string[] }; code?: number; language?: string; starter?: string;
};
type Figure = { svg?: string; plot?: unknown; geometry?: unknown; circuit?: unknown; caption?: string; width?: number };
type Q = {
  section?: string; text: string; marks?: number; figures?: Figure[]; answer?: Answer; parts?: Q[];
  label?: string; number?: string; page_break?: boolean;
};
type Doc = {
  kind: "paper" | "worksheet" | "interview" | "notes"; title: string; subtitle?: string; style_of?: string; time?: string; header?: string;
  font?: "sans" | "serif"; choice_style?: "boxes" | "bubbles" | "list"; numbering?: string; part_labels?: string; marks_style?: string; question_totals?: boolean; answer_space?: string;
  cover?: false | { fields: string[]; facts?: boolean; marking_grid?: boolean; notice?: string };
  instructions?: string[]; information?: string[]; questions?: Q[]; total_marks?: number;
  insert?: { heading: string; body: string }[];
  mark_scheme_notes?: string; mark_scheme?: { q: string; answer: string; marks: string; guidance: string }[];
  sections?: { heading: string; body: string }[];
};

const params = new URLSearchParams(location.search);
const part = params.get("part") === "scheme" ? "scheme" : "paper";
const printing = params.has("print");
document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
if (printing) document.documentElement.classList.add("printing");

const pagesEl = document.getElementById("pages")!;
const measure = document.getElementById("measure")!;
const post = (msg: Record<string, unknown>) => { try { parent.postMessage({ source: "chalk-paper", ...msg }, location.origin); } catch { /* top level */ } };

/** A block that pagination moves as one piece. keep = stay on the same page as the next block. */
type Block = { el: HTMLElement; keep?: boolean; breakBefore?: boolean };
const block = (html: string, cls: string, keep = false, breakBefore = false): Block => {
  const el = document.createElement("div");
  el.className = `blk ${cls}`;
  el.innerHTML = html;
  return { el, keep, breakBefore };
};

let D: Doc;  // the document being laid out
const isQ = (q: Q) => !q.section;
const marksOf = (q: Q): number => (q.parts?.length ? q.parts.reduce((t, p) => t + marksOf(p), 0) : q.marks ?? 0);
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi"];
const letter = (i: number) => String.fromCharCode(97 + i);
const plural = (m: number) => `${m} mark${m === 1 ? "" : "s"}`;

function marksTag(m?: number): string {
  if (!m || D.marks_style === "none") return "";
  const t = { brackets: `[${m}]`, brackets_word: `[${plural(m)}]`, parens: `(${m})`, parens_word: `(${plural(m)})` }[D.marks_style ?? "brackets_word"] ?? `[${plural(m)}]`;
  return `<span class="mk">${t}</span>`;
}

/** "(a)", "a)", "1.1", "(i)" for a part, by the document's style and how deep it is. */
function partLabel(qn: string, path: number[]): string {
  const style = D.part_labels ?? "paren";
  const i = path[path.length - 1];
  if (style === "decimal") return `${qn}.${path.map((x) => x + 1).join(".")}`;
  const depth = path.length;
  const roman = (style === "roman") !== (depth === 2);  // second level swaps letters and numerals
  const core = roman ? ROMAN[i] ?? String(i + 1) : letter(i);
  return style === "letter" ? `${core})` : `(${core})`;
}

function questionLabel(n: string): string {
  return { box: n, plain: n, dot: `${n}.`, q: `Q${n}` }[D.numbering ?? "box"] ?? n;
}
const headedNumbering = () => D.numbering === "question" || D.numbering === "problem";

function figureHtml(f: Figure): string {
  let inner = "";
  if (f.svg) inner = cleanSvg(f.svg);
  else if (f.plot || f.geometry || f.circuit) {
    try { inner = drawFigure(f); }
    catch (e) { inner = `<div class="fig-error">Figure couldn't be drawn: ${esc((e as Error).message)}</div>`; }
  }
  if (!inner) return "";
  const w = f.width ? ` style="--fw:${Math.round(f.width * 100)}%"` : "";
  return `<figure class="fig${f.width ? " sized" : ""}"${w}>${inner}${f.caption ? `<figcaption>${mdInline(f.caption)}</figcaption>` : ""}</figure>`;
}
const figuresHtml = (q: Q) => (q.figures ?? []).map(figureHtml).join("");

function codeBox(a: Answer): string {
  const starter = (a.starter ?? "").replace(/\s+$/, "").split("\n");
  const n = Math.max(a.code ?? 12, starter.length + 2);
  const rows = Array.from({ length: n }, (_, i) => `<div class="cl"><span class="ln">${i + 1}</span><code>${esc(starter[i] ?? "")}</code></div>`).join("");
  return `<div class="codebox">${a.language ? `<div class="cb-lang">${esc(a.language)}</div>` : ""}<div class="cb-rows">${rows}</div></div>`;
}

function tableBox(t: NonNullable<Answer["table"]>): string {
  const first = t.first_column;
  const head = `<tr>${t.headers.map((h) => `<th>${mdInline(h)}</th>`).join("")}</tr>`;
  const cols = t.headers.length - (first ? 1 : 0);
  const rows = Array.from({ length: t.rows }, (_, r) =>
    `<tr>${first ? `<th>${mdInline(first[r] ?? "")}</th>` : ""}${"<td></td>".repeat(Math.max(1, cols))}</tr>`).join("");
  return `<table class="anstable${t.headers.length > 6 ? " many" : ""}">${head}${rows}</table>`;
}

function choicesBox(a: Answer): string {
  const labelled = a.choices!.every((c) => /^[A-Ha-h][.)]?\s/.test(c));
  // Answered on a separate sheet: options are just an "A. …" list, like the real paper.
  const style = D.choice_style ?? (D.answer_space === "none" ? "list" : "boxes");
  const opts = a.choices!.map((c, i) => {
    const m = labelled ? c.match(/^([A-Ha-h])[.)]?\s+([\s\S]*)$/) : null;
    return { L: (m ? m[1] : String.fromCharCode(65 + i)).toUpperCase(), t: mdInline(m ? m[2] : c) };
  });
  if (style === "list") {
    return `<div class="choices list">${opts.map((o) => `<div class="choice"><b class="ch-l">${o.L}.</b><span class="ch-t">${o.t}</span></div>`).join("")}</div>`;
  }
  const note = a.multi ? `Tick (✓) ${["", "one", "two", "three", "four"][a.multi] ?? a.multi} boxes.` : style === "bubbles" ? "Fill in one circle." : "Tick (✓) one box.";
  return `<div class="choices ${style}"><div class="tick-note">${note}</div>${opts.map((o) =>
    `<div class="choice"><b class="ch-l">${o.L}</b><span class="ch-t">${o.t}</span><span class="box"></span></div>`).join("")}</div>`;
}

function answerHtml(a: Answer | undefined, marks?: number): string {
  let h = "";
  if (a?.choices?.length) h += choicesBox(a);  // options are part of the question: always printed
  if (D.answer_space !== "none" && a) {
    if (a.table) h += tableBox(a.table);
    if (a.code) h += codeBox(a);
    if (a.lines) h += `<div class="lines">${'<div class="line"></div>'.repeat(a.lines)}</div>`;
    if (a.space) h += `<div class="space" style="height:${a.space * 9}mm"></div>`;
    if (a.grid) h += `<div class="grid" style="height:${a.grid * 9}mm"></div>`;
    if (a.final !== undefined) {
      let label = a.final.trim();
      if (/^[a-zA-Z]\s*=$/.test(label) || (/^\\[a-zA-Z]+[\s=]*$/.test(label) && !label.includes("$"))) label = `$${label}$`;  // "x =", "\theta =" read as maths
      if (/_{2,}|\.{3,}|…/.test(label)) {                                      // "( ___ , ___ )" is its own blank
        h += `<div class="final"><span>${mdInline(label.replace(/_{2,}|\.{3,}|…/g, "\u0002")).replace(/\u0002/g, '<span class="fl short"></span>')}</span></div>`;
      } else {
        // A unit ("cm", "m/s²", "kg", "N") goes after the line; a word ("Answer") or "x =" goes before it.
        const unitAfter = !!label && /^[a-zA-Zµ°%²³/·.^\s-]{1,6}$/.test(label) && !/^[A-Z][a-z]{2,}/.test(label);
        h += `<div class="final">${unitAfter ? "" : `<span>${mdInline(label)}</span>`}<span class="fl"></span>${unitAfter ? `<span>${mdInline(label)}</span>` : ""}</div>`;
      }
    }
  }
  return h + (marks ? `<div class="mk-row">${marksTag(marks)}</div>` : "");
}

function partBlocks(p: Q, qn: string, path: number[]): Block[] {
  const label = p.label ? (/^[(\d]/.test(p.label) ? p.label : D.part_labels === "letter" ? `${p.label})` : `(${p.label})`) : partLabel(qn, path);
  const out: Block[] = [];
  const own = p.parts?.length ? "" : answerHtml(p.answer, p.marks);
  const depth = Math.min(path.length, 3);
  out.push(block(`<div class="lbl">${esc(label)}</div><div class="body">${md(p.text)}${figuresHtml(p)}${own}</div>`,
    `part d${depth}${D.part_labels === "decimal" ? " dec" : ""}`, !!p.parts?.length));
  p.parts?.forEach((s, i) => out.push(...partBlocks(s, qn, [...path, i])));
  return out;
}

function questionBlocks(q: Q, n: string): Block[] {
  const hasParts = !!q.parts?.length;
  const own = hasParts ? "" : answerHtml(q.answer, q.marks);
  let first: Block;
  if (headedNumbering()) {
    const word = D.numbering === "problem" ? "Problem" : "Question";
    const total = marksOf(q);
    first = block(`<div class="qhead"><span>${word} ${esc(n)}</span>${hasParts && total && D.marks_style !== "none" ? `<span class="qhead-m">${plural(total)}</span>` : ""}</div>
      <div class="body">${md(q.text)}${figuresHtml(q)}${own}</div>`, "q headed", hasParts, !!q.page_break);
  } else {
    first = block(`<div class="qn ${D.numbering ?? "box"}">${esc(questionLabel(n))}</div><div class="body">${md(q.text)}${figuresHtml(q)}${own}</div>`,
      `q${D.numbering === "box" || !D.numbering ? "" : " wide"}`, hasParts, !!q.page_break);
  }
  const out: Block[] = [first];
  q.parts?.forEach((p, i) => out.push(...partBlocks(p, n, [i])));
  if (hasParts && D.question_totals && marksOf(q)) out.push(block(`<span>Total for question ${esc(n)}: ${plural(marksOf(q))}</span>`, "qtotal"));
  out.push(block("", "qsep"));
  return out;
}

function sectionBlock(q: Q): Block {
  return block(`<h2>${mdInline(q.section!)}</h2>${q.text ? `<div class="sec-text">${md(q.text)}</div>` : ""}`, "section", true, !!q.page_break);
}

function questionsBlocks(d: Doc): Block[] {
  const out: Block[] = [];
  let n = 0;
  for (const q of d.questions ?? []) {
    if (!isQ(q)) { out.push(sectionBlock(q)); continue; }
    n++;
    const num = q.number || String(n);
    if (q.number && /^\d+$/.test(q.number)) n = Number(q.number);
    out.push(...questionBlocks(q, num));
  }
  // No divider after the last question.
  if (out.length && out[out.length - 1].el.classList.contains("qsep")) out.pop();
  if (d.kind === "paper") out.push(block("<span>End of questions</span>", "endq"));
  return out;
}

const isNumberField = (f: string) => /\bnumber\b|\bno\.?$|\bID\b/i.test(f);

function coverBlocks(d: Doc): Block[] {
  const cov = d.cover || { fields: ["Name", "Date"], facts: true, marking_grid: true };
  const qs = (d.questions ?? []).filter(isQ);
  const total = d.total_marks ?? qs.reduce((t, q) => t + marksOf(q), 0);
  const instructions = d.instructions?.length ? d.instructions : [
    "Use black ink or black ball-point pen. Draw diagrams in pencil.",
    d.answer_space === "none" ? "Write your answers in the answer booklet." : "Answer all questions in the spaces provided.",
    "Show your working: you may get marks for a correct method even if your answer is wrong.",
  ];
  const information = d.information?.length ? d.information : [
    `The total mark for this paper is ${total}.`,
    "The marks for each question are shown in brackets.",
  ];
  const fields = cov.fields.map((f) => isNumberField(f)
    ? `<div class="num"><span>${esc(f)}</span><span class="digits">${"<i></i>".repeat(/centre/i.test(f) ? 5 : 4)}</span></div>`
    : `<div><span>${esc(f)}</span><i></i></div>`).join("");
  const nums = qs.map((q, i) => q.number || String(i + 1));
  const cols = nums.map((x) => `<th>${esc(x)}</th>`).join("");
  const cells = nums.map(() => "<td></td>").join("");
  const grid = cov.marking_grid !== false && qs.length && qs.length <= 24;
  return [block(`
    <div class="cv-top"><span class="wordmark">chalk<i>.</i></span><span>Practice paper</span></div>
    <h1>${esc(d.title)}</h1>
    ${d.subtitle ? `<div class="cv-sub">${esc(d.subtitle)}</div>` : ""}
    ${d.style_of ? `<div class="cv-style">Written in the style of ${esc(d.style_of)}</div>` : ""}
    <div class="cv-cand">${fields}</div>
    ${cov.facts !== false ? `<div class="cv-facts">
      ${d.time ? `<div><span>Time allowed</span><b>${esc(d.time)}</b></div>` : ""}
      ${total ? `<div><span>Total marks</span><b>${total}</b></div>` : ""}
      <div><span>Questions</span><b>${qs.length}</b></div>
    </div>` : ""}
    <h3>Instructions</h3><ul>${instructions.map((x) => `<li>${mdInline(x)}</li>`).join("")}</ul>
    <h3>Information</h3><ul>${information.map((x) => `<li>${mdInline(x)}</li>`).join("")}</ul>
    ${grid ? `<div class="cv-exam"><div class="cv-exam-h">For marking</div><table><tr><th>Question</th>${cols}<th>Total</th></tr><tr><td>Mark</td>${cells}<td></td></tr></table></div>` : ""}
    ${cov.notice ? `<div class="cv-notice">${mdInline(cov.notice)}</div>` : ""}
    <div class="cv-note">A practice paper written by Claude in Chalk. It is not an official exam paper.</div>`, "cover")];
}

function titleBlock(d: Doc, label: string, nameLine: boolean): Block {
  const facts = [d.time, d.total_marks ? plural(d.total_marks) : ""].filter(Boolean).map((x) => esc(x)).join(" · ");
  return block(`<div class="tb-kicker"><span class="wordmark">chalk<i>.</i></span><span>${esc(label)}</span></div>
    <h1>${esc(d.title)}</h1>${d.subtitle ? `<div class="cv-sub">${esc(d.subtitle)}</div>` : ""}
    ${d.style_of ? `<div class="cv-style">In the style of ${esc(d.style_of)}</div>` : ""}
    ${facts && part === "paper" ? `<div class="tb-facts">${facts}</div>` : ""}
    ${nameLine ? `<div class="cv-cand one"><div><span>Name</span><i></i></div></div>` : ""}
    ${part === "paper" && (d.instructions?.length) ? `<ul class="tb-instr">${d.instructions.map((x) => `<li>${mdInline(x)}</li>`).join("")}</ul>` : ""}`, "titleblk");
}

const schemeName = (d: Doc) => (d.kind === "paper" ? "Mark scheme" : d.kind === "interview" ? "Solutions" : "Answers");
const partName = (d: Doc) => part === "scheme" ? schemeName(d)
  : ({ paper: "Practice paper", worksheet: "Worksheet", interview: "Coding interview", notes: "Revision notes" } as const)[d.kind];

function schemeBlocks(d: Doc): Block[] {
  const out: Block[] = [titleBlock(d, schemeName(d), false)];
  if (d.mark_scheme_notes) out.push(block(md(d.mark_scheme_notes), "para ms-notes"));
  if (!d.mark_scheme?.length) {
    out.push(block(`<p class="empty">Claude didn't write ${schemeName(d).toLowerCase()} for this one. Ask for them in the note.</p>`, "para"));
    return out;
  }
  // Interviews: long solutions read better as sections than in a narrow table column.
  if (d.kind === "interview") {
    for (const r of d.mark_scheme) {
      out.push(block(`<h2>${r.q ? `Problem ${esc(r.q)}` : "Solution"}${r.marks ? ` <span class="qhead-m">${esc(/^\d+$/.test(r.marks) ? plural(Number(r.marks)) : r.marks)}</span>` : ""}</h2>`, "h", true));
      const tmp = document.createElement("div");
      tmp.innerHTML = md(r.answer) + (r.guidance ? `<h3>Rubric</h3>${md(r.guidance)}` : "");
      for (const child of Array.from(tmp.children)) out.push(block(child.outerHTML, "para"));
    }
    return out;
  }
  out.push(block(`<div>Q</div><div>Answer</div><div>Marks</div><div>Guidance</div>`, "ms-row ms-head"));
  for (const r of d.mark_scheme) {
    out.push(block(`<div class="ms-q">${esc(r.q)}</div><div>${md(r.answer)}</div><div class="ms-m">${esc(r.marks)}</div><div class="ms-g">${md(r.guidance)}</div>`, "ms-row"));
  }
  return out;
}

function proseBlocks(sections: { heading: string; body: string }[]): Block[] {
  const out: Block[] = [];
  for (const s of sections) {
    if (s.heading) out.push(block(`<h2>${mdInline(s.heading)}</h2>`, "h", true));
    // Split a section into its paragraphs, lists and tables so a long one can run across pages.
    const tmp = document.createElement("div");
    tmp.innerHTML = md(s.body);
    for (const child of Array.from(tmp.children)) out.push(block(child.outerHTML, "para"));
  }
  return out;
}

function insertBlocks(d: Doc): Block[] {
  if (!d.insert?.length) return [];
  const out = proseBlocks(d.insert);
  out.unshift(block(`<div class="tb-kicker"><span class="wordmark">chalk<i>.</i></span><span>Insert</span></div>`, "insert-head", true, true));
  return out;
}

function newPage(): HTMLElement {
  const p = document.createElement("section");
  p.className = "page";
  // Pages after the first carry a running header: reserve its space now, so the page doesn't shrink
  // after it's been filled (decorate() writes the text).
  const head = pagesEl.childElementCount > 0 ? "<span>&nbsp;</span>" : "";
  p.innerHTML = `<header class="ph">${head}</header><div class="pb"></div><footer class="pf"><span class="pf-l"></span><span class="pf-c"></span><span class="pf-r"></span></footer>`;
  pagesEl.appendChild(p);
  return p;
}

/**
 * Make a block that's taller than a whole page fit: first shrink its answer space (blank space, lines,
 * code rows), then move its trailing paragraphs into a continuation block for the next page.
 * Returns the continuation, if one was needed.
 */
function fitBlock(el: HTMLElement, overflows: () => boolean): HTMLElement | null {
  const shrinkables = () => Array.from(el.querySelectorAll<HTMLElement>(".space, .grid, .lines, .codebox")).reverse();
  for (let guard = 0; overflows() && guard < 200; guard++) {
    let changed = false;
    for (const s of shrinkables()) {
      if (s.classList.contains("lines") && s.childElementCount > 2) { s.lastElementChild!.remove(); changed = true; break; }
      if (s.classList.contains("codebox")) {
        const rows = s.querySelectorAll(".cl");
        const last = rows[rows.length - 1];
        if (rows.length > 4 && last && !last.querySelector("code")!.textContent) { last.remove(); changed = true; break; }
      }
      if (s.classList.contains("space") || s.classList.contains("grid")) {
        const h = s.getBoundingClientRect().height;
        if (h > 70) { s.style.height = `${Math.max(68, h * 0.85)}px`; changed = true; break; }
      }
    }
    if (!changed) break;
  }
  if (!overflows()) return null;
  // Still too tall: carry the end of its text over to a continuation on the next page. A single long
  // list or quote is split item by item.
  const body = el.querySelector<HTMLElement>(":scope > .body") ?? el;
  let box: HTMLElement = body;
  while (box.children.length === 1 && /^(OL|UL|BLOCKQUOTE|DIV)$/.test(box.children[0].tagName) && box.children[0].children.length > 1) {
    box = box.children[0] as HTMLElement;
  }
  if (box.children.length < 2) return null;  // one enormous paragraph or figure: nothing sensible to split
  const path: HTMLElement[] = [];
  for (let n: HTMLElement = box; n !== el; n = n.parentElement!) path.unshift(n);
  const cont = el.cloneNode(false) as HTMLElement;
  cont.classList.add("cont");
  let into: HTMLElement = cont;
  let from: HTMLElement = el;
  for (const node of path) {
    if (from === el) {  // keep the grid columns: an empty label cell before the body
      for (const c of Array.from(el.children)) { if (c === node) break; cont.appendChild(Object.assign(document.createElement("div"), { className: `${(c as HTMLElement).className} ph-empty` })); }
    }
    const cl = node.cloneNode(false) as HTMLElement;
    into.appendChild(cl);
    into = cl;
    from = node;
  }
  const kids = Array.from(box.children) as HTMLElement[];
  for (let i = kids.length - 1; i > 0 && overflows(); i--) into.insertBefore(kids[i], into.firstChild);
  // The last thing moved may be a list that could partly stay: keep as many of its items as fit.
  const moved = into.firstElementChild as HTMLElement | null;
  if (moved && /^(OL|UL)$/.test(moved.tagName) && moved.children.length > 1) {
    box.appendChild(moved);
    const tail = moved.cloneNode(false) as HTMLElement;
    into.insertBefore(tail, into.firstChild);
    const items = Array.from(moved.children);
    for (let i = items.length - 1; i >= 0 && overflows(); i--) tail.insertBefore(items[i], tail.firstChild);
    if (!moved.children.length) { moved.remove(); into.replaceChild(moved, tail); for (const li of Array.from(tail.children)) moved.appendChild(li); }
    else if (moved.tagName === "OL") tail.setAttribute("start", String((Number(moved.getAttribute("start")) || 1) + moved.children.length));
  }
  if (box.tagName === "OL") into.setAttribute("start", String((Number(box.getAttribute("start")) || 1) + box.children.length));
  return into.childElementCount ? cont : null;
}

/**
 * Gently shrink a block's answer space (to no less than two thirds of what Claude asked for) so it
 * fits the rest of this page instead of leaving most of the page blank. Undone if it doesn't help.
 */
function squeezeToFit(el: HTMLElement, overflows: () => boolean): boolean {
  const before = el.innerHTML;
  const floor = new Map<Element, number>();
  for (const s of Array.from(el.querySelectorAll<HTMLElement>(".space, .grid, .lines, .codebox"))) {
    floor.set(s, s.classList.contains("lines") ? Math.ceil(s.childElementCount * 0.66)
      : s.classList.contains("codebox") ? Math.ceil(s.querySelectorAll(".cl").length * 0.66)
      : s.getBoundingClientRect().height * 0.66);
  }
  for (let guard = 0; overflows() && guard < 120; guard++) {
    let changed = false;
    for (const [s, min] of Array.from(floor.entries()).reverse()) {
      const e = s as HTMLElement;
      if (e.classList.contains("lines") && e.childElementCount > min) { e.lastElementChild!.remove(); changed = true; break; }
      if (e.classList.contains("codebox")) {
        const rows = e.querySelectorAll(".cl");
        const last = rows[rows.length - 1];
        if (rows.length > min && last && !last.querySelector("code")!.textContent) { last.remove(); changed = true; break; }
      }
      if ((e.classList.contains("space") || e.classList.contains("grid")) && e.getBoundingClientRect().height > min + 4) {
        e.style.height = `${Math.max(min, e.getBoundingClientRect().height * 0.92)}px`; changed = true; break;
      }
    }
    if (!changed) break;
  }
  if (overflows()) { el.innerHTML = before; return false; }
  return true;
}

function paginate(blocks: Block[], opts: { freshPageAfterCover: boolean; repeatHead?: HTMLElement }) {
  pagesEl.innerHTML = "";
  let page = newPage();
  let body = page.querySelector<HTMLElement>(".pb")!;
  const overflows = () => body.scrollHeight > body.clientHeight + 1;
  let base = 0; // blocks every page starts with (the repeated table header)
  const empty = () => body.childElementCount <= base;
  const freshPage = () => {
    page = newPage(); body = page.querySelector<HTMLElement>(".pb")!;
    base = 0;
    if (opts.repeatHead) { body.appendChild(opts.repeatHead.cloneNode(true)); base = 1; }
  };
  const isSep = (g: Block[]) => g[0].el.classList.contains("qsep");
  // Group blocks that must stay together (a question's stem with its first part).
  const queue: Block[][] = [];
  for (let i = 0; i < blocks.length; i++) {
    const g = [blocks[i]];
    while (blocks[i].keep && i + 1 < blocks.length) g.push(blocks[++i]);
    queue.push(g);
  }
  const afterPlaced = (g: Block[]) => { if (opts.freshPageAfterCover && g[0].el.classList.contains("cover")) freshPage(); };
  for (let gi = 0; gi < queue.length; gi++) {
    const g = queue[gi];
    if (isSep(g) && empty()) continue; // no divider at the top of a page
    if (g[0].breakBefore && !empty()) { body.querySelector(".qsep:last-child")?.remove(); freshPage(); }
    const wasEmpty = empty();
    const used = wasEmpty ? 0 : body.lastElementChild!.getBoundingClientRect().bottom - body.getBoundingClientRect().top;
    g.forEach((b) => body.appendChild(b.el));
    if (!overflows()) { afterPlaced(g); continue; }
    const height = g.reduce((h, b) => h + b.el.getBoundingClientRect().height, 0);
    // A block taller than any page has to be split anyway: start it here if a good part of the page is free.
    if (g.length === 1 && !isSep(g) && height > body.clientHeight && body.clientHeight - used > body.clientHeight * 0.3) {
      const rest = fitBlock(g[0].el, overflows);
      if (rest) { queue.splice(gi + 1, 0, [{ el: rest }]); continue; }
      if (!overflows()) continue;
    }
    // Most of the page still free: trim the answer space a little rather than leave it blank.
    if (!isSep(g) && !wasEmpty && body.clientHeight - used > body.clientHeight * 0.5 && squeezeToFit(g[g.length - 1].el, overflows)) {
      afterPlaced(g); continue;
    }
    g.forEach((b) => b.el.remove());
    if (isSep(g)) continue;
    if (!wasEmpty) {
      body.querySelector(".qsep:last-child")?.remove();
      freshPage();
      g.forEach((b) => body.appendChild(b.el));
      if (!overflows()) { afterPlaced(g); continue; }
      g.forEach((b) => b.el.remove());
    }
    // Too tall even for an empty page.
    if (g.length > 1) {                       // let the group break across pages
      queue.splice(gi + 1, 0, ...g.map((b, i) => [{ ...b, keep: false, breakBefore: i === 0 ? false : b.breakBefore }]));
      continue;
    }
    body.appendChild(g[0].el);
    const rest = fitBlock(g[0].el, overflows);
    if (rest) queue.splice(gi + 1, 0, [{ el: rest }]);
    afterPlaced(g);
  }
  // Tidy the end: drop a trailing divider, and a blank last page.
  body.querySelector(".qsep:last-child")?.remove();
  if (empty() && pagesEl.children.length > 1) page.remove();
}

/** What a test (or a curious developer) needs to know about how the layout went. */
function report() {
  const pages = Array.from(pagesEl.querySelectorAll<HTMLElement>(".page"));
  return {
    pages: pages.length,
    clipped: pages.flatMap((p, i) => { const b = p.querySelector<HTMLElement>(".pb"); return b && b.scrollHeight > b.clientHeight + 2 ? [i + 1] : []; }),
    wide: pages.flatMap((p, i) => {
      const b = p.querySelector<HTMLElement>(".pb");
      if (!b) return [];
      const right = b.getBoundingClientRect().right + 2;
      return Array.from(b.querySelectorAll<HTMLElement>("*")).some((e) => e.getBoundingClientRect().right > right && !e.closest(".cl")) ? [i + 1] : [];
    }),
    katexErrors: pagesEl.querySelectorAll(".katex-error").length,
    brokenImages: Array.from(pagesEl.querySelectorAll("img")).filter((im) => !im.naturalWidth).length,
    figures: pagesEl.querySelectorAll("figure").length,
    figureErrors: Array.from(pagesEl.querySelectorAll(".fig-error")).map((e) => e.textContent ?? ""),
    emptyPages: pages.flatMap((p, i) => (p.querySelector(".pb")?.childElementCount === 0 ? [i + 1] : [])),
    continued: pagesEl.querySelectorAll(".cont").length,
    // Maths that didn't render: "$" or "\\frac"-style commands left in the text (code excepted).
    rawTex: (() => {
      const hits: string[] = [];
      const walker = document.createTreeWalker(pagesEl, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement!;
        if (el.closest(".katex, pre, code, .codebox")) continue;
        const t = n.textContent ?? "";
        if (/(^|[^\\])\$(?!\d)|\\[a-zA-Z]{2,}/.test(t)) hits.push(t.trim().slice(0, 60));  // "$5" is money
      }
      return hits;
    })(),
  };
}

function decorate(d: Doc) {
  const pages = Array.from(pagesEl.querySelectorAll<HTMLElement>(".page"));
  const n = pages.length;
  const label = partName(d);
  const exam = part === "paper" && d.kind !== "notes";
  pages.forEach((p, i) => {
    if (i > 0) p.querySelector(".ph")!.innerHTML = `<span>${esc(d.header || d.title)}</span><span>${label}</span>`;
    p.querySelector(".pf-l")!.textContent = exam ? "Chalk practice material · not an official paper" : "Made with Chalk";
    p.querySelector(".pf-c")!.textContent = `Page ${i + 1} of ${n}`;
    p.querySelector(".pf-r")!.innerHTML = exam && i < n - 1 ? "Turn over ›" : "";
  });
  return n;
}

// ---------------------------------------------------------------- zoom and the current page
let zoom: number | "fit" = "fit";
function applyZoom() {
  const pageW = 210 * 96 / 25.4;
  const z = zoom === "fit" ? Math.max(0.3, Math.min(1, (innerWidth - 56) / pageW)) : zoom;
  pagesEl.style.setProperty("zoom", String(z));
  post({ type: "zoom", zoom: Math.round(z * 100) });
}
function currentPage(): number {
  const pages = Array.from(pagesEl.children) as HTMLElement[];
  const mid = innerHeight / 3;
  let best = 0;
  pages.forEach((p, i) => { if (p.getBoundingClientRect().top < mid) best = i; });
  return best + 1;
}
let lastPage = 0;
addEventListener("scroll", () => { const p = currentPage(); if (p !== lastPage) { lastPage = p; post({ type: "page", page: p }); } }, { passive: true });
addEventListener("resize", () => { if (zoom === "fit") applyZoom(); });
addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.data?.source !== "chalk-host") return;
  if (e.data.type === "zoom") { zoom = e.data.value === "fit" ? "fit" : Number(e.data.value) || 1; applyZoom(); }
  if (e.data.type === "goto") (pagesEl.children[Number(e.data.page) - 1] as HTMLElement | undefined)?.scrollIntoView({ block: "start" });
  if (e.data.type === "print") print();
  if (e.data.type === "theme") document.documentElement.dataset.theme = e.data.value === "dark" ? "dark" : "light";
});
addEventListener("keydown", (e) => {  // keep the app's shortcuts working while the preview has focus
  if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && ["p", "s", "=", "-", "0"].includes(e.key))) {
    e.preventDefault();
    post({ type: "key", key: e.key, ctrl: e.ctrlKey || e.metaKey });
  }
});

// ---------------------------------------------------------------- your files, page by page
async function showUpload(uid: string) {
  const r = await fetch(`/api/uploads/${encodeURIComponent(uid)}`);
  if (!r.ok) {
    pagesEl.innerHTML = `<p class="load-err">This file was deleted.</p>`;
    post({ type: "error", message: "deleted" });
    return;
  }
  const m = await r.json() as { name: string; pages: number; kind: string };
  document.title = m.name;
  pagesEl.innerHTML = Array.from({ length: m.pages }, (_, i) =>
    `<section class="page img-page${m.kind === "image" ? " photo" : ""}"><img alt="Page ${i + 1}" src="/api/uploads/${encodeURIComponent(uid)}/page/${i + 1}.png"></section>`).join("");
  await Promise.all(Array.from(pagesEl.querySelectorAll("img")).map((im) => im.decode().catch(() => {})));
  measure.remove();
  if (!printing) applyZoom();
  post({ type: "ready", pages: m.pages, title: m.name, kind: "upload", hasScheme: false });
  (window as any).__paperReady = true;
}

// ---------------------------------------------------------------- go
async function main() {
  if (params.has("upload")) return showUpload(params.get("upload")!);
  const id = params.get("doc");
  let d: Doc;
  try {
    const r = await fetch(`/api/docs/${encodeURIComponent(id ?? "")}`);
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? r.statusText);
    d = (await r.json()).doc;
  } catch (e) {
    pagesEl.innerHTML = `<p class="load-err">Couldn't open this document. ${esc((e as Error).message)}</p>`;
    post({ type: "error", message: String((e as Error).message) });
    (window as any).__paperReady = true;
    return;
  }
  D = d;
  document.title = d.title;
  document.documentElement.classList.toggle("serif", d.font === "serif");
  let blocks: Block[];
  let head: HTMLElement | undefined;
  if (part === "scheme") {
    blocks = schemeBlocks(d);
    head = blocks.find((b) => b.el.classList.contains("ms-head"))?.el;
  } else if (d.kind === "notes") blocks = [titleBlock(d, "Revision notes", false), ...proseBlocks(d.sections ?? [])];
  else {
    blocks = d.kind === "paper" && d.cover !== false ? coverBlocks(d) : [titleBlock(d, partName(d), d.kind !== "interview" && d.answer_space !== "none")];
    blocks.push(...questionsBlocks(d), ...insertBlocks(d));
  }
  // Lay everything out once off-screen so the fonts load, then measure for real.
  blocks.forEach((b) => measure.appendChild(b.el));
  // Fonts only start loading once something is laid out in them (KaTeX's are taller than Inter), so
  // force a layout first, then wait for every face that's still loading.
  void measure.offsetHeight;
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await document.fonts.ready;
  await Promise.all(Array.from(document.fonts).filter((f) => f.status === "loading").map((f) => f.loaded.catch(() => null)));
  // Images have to arrive before their height is known.
  await Promise.all(Array.from(measure.querySelectorAll("img")).map((im) => im.decode().catch(() => im.classList.add("broken"))));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  paginate(blocks, { freshPageAfterCover: d.kind === "paper" && part === "paper" && d.cover !== false, repeatHead: head });
  measure.remove();
  const n = decorate(d);
  if (!printing) applyZoom();
  post({ type: "ready", pages: n, title: d.title, kind: d.kind, hasScheme: !!(d.mark_scheme?.length || d.mark_scheme_notes), schemeLabel: schemeName(d) });
  (window as any).__paperReport = report();
  (window as any).__paperReady = true;
}
main();
