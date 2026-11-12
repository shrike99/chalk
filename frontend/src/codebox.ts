/**
 * Code in your messages.
 *
 * - CodeBoxes: small code editors above the message box (syntax colours, line numbers, Tab indents,
 *   brackets close themselves). Open one with the { } button, by typing ``` or by pasting code.
 * - highlightInto(): colours a finished code block in the conversation (your messages and Claude's notes).
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder } from "@codemirror/view";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting, type Language, type LanguageSupport } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { go } from "@codemirror/lang-go";

// ---------------------------------------------------------------- languages
interface Lang { id: string; name: string; aliases: string[]; support?: () => LanguageSupport }
export const LANGS: Lang[] = [
  { id: "python", name: "Python", aliases: ["py", "python3"], support: () => python() },
  { id: "javascript", name: "JavaScript", aliases: ["js", "jsx", "node"], support: () => javascript({ jsx: true }) },
  { id: "typescript", name: "TypeScript", aliases: ["ts", "tsx"], support: () => javascript({ typescript: true, jsx: true }) },
  { id: "java", name: "Java", aliases: [], support: () => java() },
  { id: "c", name: "C", aliases: ["h"], support: () => cpp() },
  { id: "cpp", name: "C++", aliases: ["c++", "cc", "hpp"], support: () => cpp() },
  { id: "csharp", name: "C#", aliases: ["cs", "c#"], support: () => java() }, // close enough for colours
  { id: "go", name: "Go", aliases: ["golang"], support: () => go() },
  { id: "rust", name: "Rust", aliases: ["rs"], support: () => rust() },
  { id: "sql", name: "SQL", aliases: [], support: () => sql() },
  { id: "html", name: "HTML", aliases: ["xml", "svg"], support: () => html() },
  { id: "css", name: "CSS", aliases: ["scss"], support: () => css() },
  { id: "json", name: "JSON", aliases: [], support: () => json() },
  { id: "text", name: "Plain text", aliases: ["txt", "plaintext", ""] },
];
export function findLang(id: string | undefined): Lang {
  const k = (id ?? "").trim().toLowerCase();
  return LANGS.find((l) => l.id === k || l.aliases.includes(k)) ?? LANGS[LANGS.length - 1];
}
const parserCache = new Map<string, Language | null>();
function languageOf(id: string): Language | null {
  if (!parserCache.has(id)) parserCache.set(id, findLang(id).support?.().language ?? null);
  return parserCache.get(id)!;
}

/** A best guess at the language of some code (used until you pick one yourself). */
export function detectLang(code: string): string {
  const s = code.slice(0, 4000);
  const score: Record<string, number> = {};
  const add = (k: string, re: RegExp, w = 1) => { const m = s.match(re); if (m) score[k] = (score[k] ?? 0) + w * Math.min(m.length, 4); };
  add("python", /^\s*(def|class) \w+.*:\s*$/gm, 3); add("python", /^\s*(import \w+|from \w+(\.\w+)* import)/gm, 2);
  add("python", /\b(elif|self|None|True|False|print\(|range\(|len\()/g); add("python", /:\s*$/gm, 0.5);
  add("javascript", /\b(const|let|var) \w+\s*=/g, 1.5); add("javascript", /=>|function\s*\w*\(|console\.log|document\.|require\(/g, 2);
  add("typescript", /:\s*(string|number|boolean|void|any)\b|interface \w+|<\w+>\(|as const/g, 2.5);
  add("java", /\b(public|private|protected) (static )?(void|class|int|String)|System\.out\.print/g, 3);
  add("c", /#include\s*<\w+\.h>|printf\(|malloc\(|\bint main\s*\(/g, 2);
  add("cpp", /#include\s*<(iostream|vector|string|map)>|std::|cout\s*<<|template\s*</g, 3);
  add("csharp", /\busing System|Console\.Write|namespace \w+|\bvar \w+ = new\b/g, 3);
  add("go", /\bpackage \w+|\bfunc \w*\(|:=|fmt\.Print/g, 2.5);
  add("rust", /\bfn \w+|let mut |println!|impl |->\s*\w+\s*\{|::new\(/g, 2.5);
  add("sql", /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|FROM|WHERE|JOIN)\b/g, 1.5);
  add("html", /<\/?(div|span|html|body|p|a|ul|li|head|script)\b[^>]*>/g, 2);
  add("css", /^[.#]?[\w-]+\s*\{[^}]*:\s*[^;]+;/gm, 2); add("css", /^\s*[\w-]+:\s*[^;]+;\s*$/gm, 0.6);
  if (/^\s*[[{][\s\S]*[\]}]\s*$/.test(s)) { try { JSON.parse(s); return "json"; } catch { /* not JSON */ } }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : "text";
}

/** Does pasted text look like code (rather than prose)? */
export function looksLikeCode(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const codey = lines.filter((l) => /^(\s{2,}|\t)|[;{}()[\]=<>]\s*$|^\s*(def|class|import|from|function|const|let|var|return|if|for|while|#include|public|fn|func|SELECT)\b|=>|::|==/.test(l)).length;
  const prose = lines.filter((l) => /^[A-Z][^;{}=]*[.?!]$/.test(l.trim()) && l.split(" ").length > 6).length;
  return codey / lines.length >= 0.5 && prose / lines.length < 0.3;
}

// ---------------------------------------------------------------- colouring finished code
/** Fill `el` with syntax-coloured code. */
export function highlightInto(el: HTMLElement, code: string, lang: string) {
  el.textContent = "";
  const language = languageOf(findLang(lang).id);
  if (!language) { el.textContent = code; return; }
  const tree = language.parser.parse(code);
  highlightCode(code, tree, classHighlighter,
    (text, classes) => {
      if (!classes) { el.appendChild(document.createTextNode(text)); return; }
      const span = document.createElement("span"); span.className = classes; span.textContent = text; el.appendChild(span);
    },
    () => el.appendChild(document.createTextNode("\n")));
}

/** A finished code block for the conversation: language label, Copy, coloured code. */
export function codeBlock(code: string, lang: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "code-block";
  const head = document.createElement("div");
  head.className = "code-head";
  const l = findLang(lang);
  head.innerHTML = `<span>${l.id === "text" && lang ? lang : l.name}</span>`;
  const copy = document.createElement("button");
  copy.type = "button"; copy.className = "link"; copy.textContent = "Copy";
  copy.onclick = async () => { try { await navigator.clipboard.writeText(code); copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1200); } catch { /* blocked */ } };
  head.appendChild(copy);
  const pre = document.createElement("pre");
  const c = document.createElement("code");
  highlightInto(c, code, lang);
  pre.appendChild(c);
  wrap.append(head, pre);
  return wrap;
}

/** Split a message into text and ```fenced``` code parts. */
export function splitFences(text: string): ({ kind: "text"; text: string } | { kind: "code"; lang: string; code: string })[] {
  const out: ({ kind: "text"; text: string } | { kind: "code"; lang: string; code: string })[] = [];
  const re = /```([\w+#.-]*)[ \t]*\n([\s\S]*?)(?:\n```|$(?![\s\S]))/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "code", lang: m[1], code: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out.filter((p) => p.kind === "code" || p.text.trim());
}

/** Colour every <pre><code class="language-x"> inside an element (e.g. Claude's markdown notes). */
export function highlightAll(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>("pre > code").forEach((c) => {
    const lang = (c.className.match(/language-([\w+#.-]+)/) ?? [])[1] ?? detectLang(c.textContent ?? "");
    const block = codeBlock((c.textContent ?? "").replace(/\n$/, ""), lang);
    c.parentElement!.replaceWith(block);
  });
}

// ---------------------------------------------------------------- editors in the composer
const theme = EditorView.theme({
  "&": { fontSize: "13.5px", background: "transparent" },
  ".cm-content": { fontFamily: "Consolas, 'Cascadia Code', ui-monospace, monospace", padding: "6px 0", caretColor: "var(--claude)" },
  ".cm-gutters": { background: "transparent", border: "none", color: "#bdb8b0" },
  ".cm-activeLine": { background: "rgba(79,70,229,0.05)" },
  ".cm-activeLineGutter": { background: "transparent", color: "#8a857e" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { maxHeight: "260px", overflow: "auto", lineHeight: "1.5" },
  ".cm-placeholder": { color: "#b5b0a8", fontStyle: "italic" },
});

interface Box { el: HTMLElement; view: EditorView; lang: string; picked: boolean; langComp: Compartment; select: HTMLSelectElement }

export class CodeBoxes {
  private boxes: Box[] = [];
  /** Ctrl+Enter in an editor */
  onSubmit: () => void = () => {};
  /** focus leaves the editors (Esc, or Backspace in an empty one) */
  onLeave: () => void = () => {};
  onChange: () => void = () => {};

  constructor(private host: HTMLElement) {}

  get isEmpty() { return this.blocks().length === 0; }
  get count() { return this.boxes.length; }

  /** The code to send: one entry per non-empty editor. */
  blocks() { return this.boxes.map((b) => ({ lang: b.lang, code: b.view.state.doc.toString().replace(/\s+$/, "") })).filter((b) => b.code.trim()); }

  /** Everything as markdown, to append to the message. */
  markdown() { return this.blocks().map((b) => "```" + (b.lang === "text" ? "" : b.lang) + "\n" + b.code + "\n```").join("\n\n"); }

  add(code = "", lang?: string, focus = true) {
    const el = document.createElement("div");
    el.className = "codebox";
    const head = document.createElement("div");
    head.className = "codebox-head";
    const select = document.createElement("select");
    select.title = "Language";
    for (const l of LANGS) { const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; select.appendChild(o); }
    const hint = document.createElement("span");
    hint.className = "codebox-hint";
    hint.innerHTML = `<kbd>Tab</kbd> indents · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> sends · <kbd>Esc</kbd> back to text`;
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "link"; remove.textContent = "Remove"; remove.title = "Remove this code";
    head.append(select, hint, remove);
    el.appendChild(head);
    this.host.appendChild(el);
    this.host.hidden = false;

    const langComp = new Compartment();
    const initial = lang ? findLang(lang).id : code ? detectLang(code) : "python";
    const box: Box = { el, view: null as any, lang: initial, picked: !!lang, langComp, select };
    select.value = initial;
    const ext = (id: string) => findLang(id).support?.() ?? [];
    box.view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(), highlightActiveLine(), drawSelection(), history(), bracketMatching(), closeBrackets(), indentOnInput(),
          indentUnit.of("    "), EditorState.tabSize.of(4),
          syntaxHighlighting(classHighlighter), theme, langComp.of(ext(initial)),
          placeholder("Write or paste code…"),
          Prec.highest(keymap.of([
            { key: "Mod-Enter", run: () => { this.onSubmit(); return true; } },
            { key: "Escape", run: () => { this.onLeave(); return true; } },
            { key: "Backspace", run: (v) => { if (v.state.doc.length) return false; this.remove(box); this.onLeave(); return true; } },
          ])),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            // keep guessing the language until you choose one
            if (!box.picked) { const g = detectLang(u.state.doc.toString()); if (g !== "text" && g !== box.lang) this.setLang(box, g, false); }
            this.onChange();
          }),
        ],
      }),
    });
    select.onchange = () => this.setLang(box, select.value, true);
    remove.onclick = () => { this.remove(box); this.onLeave(); };
    this.boxes.push(box);
    if (focus) { box.view.focus(); box.view.dispatch({ selection: { anchor: box.view.state.doc.length } }); }
    this.onChange();
    return box;
  }

  private setLang(box: Box, id: string, picked: boolean) {
    box.lang = id; box.picked = box.picked || picked; box.select.value = id;
    box.view.dispatch({ effects: box.langComp.reconfigure(findLang(id).support?.() ?? []) });
  }

  remove(box: Box) {
    box.view.destroy(); box.el.remove();
    this.boxes = this.boxes.filter((b) => b !== box);
    this.host.hidden = this.boxes.length === 0;
    this.onChange();
  }
  /** Remove the newest editor and give back its text (for "keep as text"). */
  popText(): string { const b = this.boxes[this.boxes.length - 1]; if (!b) return ""; const t = b.view.state.doc.toString(); this.remove(b); return t; }
  clear() { for (const b of [...this.boxes]) this.remove(b); }
  focusLast() { this.boxes[this.boxes.length - 1]?.view.focus(); }
}
