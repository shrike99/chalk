"""Documents Claude writes for you: practice papers, worksheets, coding interviews and revision notes.

Claude puts a document in its reply as a ```chalk-doc block of JSON. Chalk stores it and lays it out
as A4 pages (the same pages are the in-app preview and the PDF), so Claude never has to produce a
file itself: it only decides the content and the format.

Claude is a good writer but an imperfect JSON writer, especially with LaTeX in it, so extract() is
forgiving: it repairs the usual escaping slips and accepts the document under a few other wrappers.
"""
from __future__ import annotations

import json
import re
from typing import Any

PROMPT = r"""

# Documents: practice papers, worksheets, coding interviews, revision notes
When the student asks for a past paper, practice paper, mock exam, test, quiz sheet, worksheet,
problem set, interview questions, revision notes, a cheat sheet or anything else to print or keep
as a PDF, write it as a document. Chalk lays it out as real A4 pages and shows it in a viewer with
"Save PDF". Don't make one unless they ask (or clearly agree when you offer).

Put the document in its own block, before your usual reply blocks:

```chalk-doc
{ "kind": "paper", "title": "...", ... }
```

It must be valid JSON: escape backslashes in LaTeX ("$\\frac{1}{2}$", "\\theta") and newlines in
strings ("\n"). Then reply as normal but briefly: one or two sentences saying what you made and how
to use it. You may skip the animation script for this turn; if you do, put a "say" field in your
notes JSON with that spoken line.

## Following a format the student gives you
When they attach past papers (or describe a format) and ask you to follow it, match its FORMAT
closely: the cover page (fields such as candidate number, the instructions and information
wording), how questions are numbered (1, Q1, Question 1, 1.1) and parts labelled ((a), a), (i),
1.1), how marks are shown ([3], [3 marks], (3)), sections ("Section A: answer all questions"), the
kinds of answer space (lines, boxes, tables, multiple choice, code), the command words, the
difficulty curve, the mark distribution, the length and the time allowed, and the mark scheme's
conventions. Study every page you're shown.
Its CONTENT must be brand new: let the paper inspire you, never copy it. New contexts and
scenarios, new numbers, new names, new data, and new figures you draw yourself, even when a
question tests the same skill. A student who has done their paper should not recognise a single
question or diagram in yours. Never reuse, crop or trace a figure from their file, even if asked to
keep the same diagram; draw a fresh one that tests the same thing.

## Fields
All text is Markdown (tables and ```code``` blocks work). Maths goes in $...$ or $$...$$ (KaTeX).
Write money as £5 or \$5.
{
  "kind": "paper",            // "paper" (cover page + mark scheme), "worksheet", "interview", "notes"
  "title": "Quadratic equations",
  "subtitle": "Higher tier · Non-calculator",
  "style_of": "AQA GCSE Mathematics (8300) Paper 1",   // optional: the exam or format it imitates
  "time": "1 hour 30 minutes",
  "header": "Running header text",                       // optional, top of pages after the first
  "font": "sans",             // "sans" (most exam boards) or "serif" (university / LaTeX-style)
  "numbering": "box",         // "box" [1], "plain" 1, "dot" 1., "q" Q1, "question" Question 1, "problem" Problem 1
  "part_labels": "paren",     // "paren" (a), "letter" a), "decimal" 1.1, "roman" (i)
  "marks_style": "brackets",  // "brackets" [3], "brackets_word" [3 marks], "parens" (3), "parens_word" (3 marks), "none"
  "question_totals": true,    // "Total for question 3: 9 marks" after multi-part questions
  "answer_space": "inline",   // "inline", or "none" when answers go in a separate booklet or answer sheet
  "choice_style": "boxes",    // multiple choice: "boxes" (tick boxes), "bubbles" (circles to fill), "list" (A. … only)
  "cover": { "fields": ["Name", "Candidate number"], "facts": true, "marking_grid": true,
             "notice": "Do not turn over until told to." },  // or false for no cover page
  "instructions": ["Answer all questions.", "..."],
  "information": ["The marks for each question are shown in brackets.", "..."],
  "questions": [
    { "section": "Section A", "text": "Answer **all** questions in this section.", "page_break": false },
    { "text": "Solve $x^2 - 5x + 6 = 0$.", "marks": 3, "answer": {"lines": 3, "final": "x ="} },
    { "text": "The graph shows ...", "figure": {"svg": "<svg viewBox='0 0 300 200'>...</svg>", "caption": "Figure 1"},
      "parts": [
        { "text": "Write down the roots.", "marks": 2, "answer": {"lines": 2} },
        { "text": "Hence ...", "marks": 4, "answer": {"space": 6},
          "parts": [ { "text": "...", "marks": 1, "answer": {"lines": 1} } ] }
      ] },
    { "text": "Which is a prime number?", "marks": 1, "answer": {"choices": ["9", "15", "17", "21"]} },
    { "text": "Complete the table.", "marks": 2, "answer": {"table": {"headers": ["x", "-1", "0", "1"], "rows": 1, "first_column": ["y"]}} },
    { "text": "Write a function `two_sum(nums, target)` ...", "marks": 6,
      "answer": {"code": 14, "language": "python", "starter": "def two_sum(nums, target):\n    "} }
  ],
  "insert": [ { "heading": "Formulae", "body": "..." } ],   // data / formula sheet printed after the questions
  "mark_scheme_notes": "General marking guidance ...",       // optional, before the table
  "mark_scheme": [
    { "q": "1", "answer": "$x = 2$ or $x = 3$", "marks": "3", "guidance": "M1 factorise · A1 · A1" },
    { "q": "2(a)", "answer": "...", "marks": "2", "guidance": "..." }
  ],
  "sections": [ { "heading": "...", "body": "..." } ]      // notes only
}
Questions are numbered automatically (sections don't count); give "number": "7" to override.
Answer space ("answer"): {"lines": n} ruled lines, {"space": n} blank working space n lines tall,
{"grid": n} squared paper, {"choices": [...], "multi": false} multiple choice (options are lettered
A, B, C… for you; ALWAYS put a multiple-choice question's options here, even on papers answered on
a separate sheet: they print as an "A. … E." list then), {"table": {...}}
a blank table, {"code": n, "language": "python", "starter": "..."} a code box with n lines, and
"final": "x =" or "cm" adds an answer line with that label. Combine them, e.g. {"space": 6, "final": "x ="}.
## Figures
Draw every figure yourself. For graphs, geometry and circuits, describe the figure and Chalk draws
it exactly (prefer this: hand-placed SVG coordinates are easy to get wrong):

- Graph: {"plot": {"x": [-2, 6], "y": [-5, 10], "x_step": 1, "y_step": 1, "grid": true,
    "x_label": "x", "y_label": "y",
    "functions": [{"expr": "x^2 - 4x + 3", "label": "y = x^2 - 4x + 3", "domain": [-1, 5]}],
    "lines": [{"points": [[0, 0], [4, 20], [10, 20]], "dashed": false}],
    "points": [{"at": [1, 0], "label": "A"}],
    "bars": [{"x": 1, "height": 12, "label": "Mon"}]}}
  Expressions use x with + - * / ^, implicit multiplication (4x, 2(x+1)) and sin cos tan sqrt
  abs ln log exp pi. "lines" draws straight segments through points (velocity-time graphs,
  distance-time graphs, line graphs); "bars" makes bar charts; "grid": false for plain axes,
  "fine" for 2 mm-style graph paper; "numbers": false hides the axis numbers.
- Geometry: {"geometry": {"points": {"A": [0, 0], "B": [8, 0], "C": [0, 6]},
    "polygons": ["ABC"], "segments": ["AD"], "dashed": ["CD"],
    "labels": {"AB": "8 cm", "AC": "6 cm"}, "right_angles": [{"at": "A", "from": "B", "to": "C"}],
    "angles": [{"at": "B", "from": "A", "to": "C", "label": "x"}],
    "circles": [{"centre": "O", "radius": 3}], "dots": false}}
  Coordinates are only for drawing (choose ones that make the shape look right); the numbers the
  student sees come from "labels". Add "Not drawn accurately" as the caption when it isn't.
- Circuit: {"circuit": {"source": "battery:12 V",
    "branches": [["resistor:6 Ω", "lamp"], ["resistor:3 Ω"]],
    "main": ["ammeter", "switch"],
    "voltmeters": [{"branch": 0, "index": 0}]}}
  One branch is a series circuit; more branches are in parallel. "main" components sit on the
  return wire in series with everything. Components: cell, battery, resistor, variable_resistor,
  lamp, ammeter, voltmeter, motor, switch, closed_switch, diode, led, ldr, thermistor, fuse,
  heater; add ":label" for a value.
- Anything else (apparatus, flowcharts, number lines, Venn diagrams, trees): an SVG string,
  {"svg": "<svg viewBox='0 0 300 200'>...</svg>"}: black strokes, white fill, labels in plain
  text, no colour unless it matters, no scripts, under 4 KB.
Any figure can have "caption" ("Figure 1", "Not drawn accurately") and "width" (0.3 to 1 of the
line). Use "figures": [...] for more than one.

Interviews ("kind": "interview"): each question is a problem with a statement, examples (input and
output in code blocks), constraints and a code answer box; the mark scheme is a reference solution
with its complexity, edge cases to test and a hiring rubric (what strong, OK and weak answers look like).

Make papers feel like the real thing: realistic mark allocations (about 60–80 marks for a
1-hour-30 GCSE paper), questions that get harder through the paper, the exam's command words,
and a mark scheme an examiner would recognise (M1/A1/B1 for maths, indicative content and level
descriptors for essays). Never claim it's an official paper.
"""

KINDS = ("paper", "worksheet", "interview", "notes")
NUMBERING = ("box", "plain", "dot", "q", "question", "problem")
PART_LABELS = ("paren", "letter", "decimal", "roman")
MARKS_STYLES = ("brackets", "brackets_word", "parens", "parens_word", "none")


# ---------------------------------------------------------------- pulling the document out of a reply
_OPEN = re.compile(r"```[ \t]*(?:json[ \t]+)?chalk[-_ ]?doc(?:ument)?\b[^\n]*\n?", re.I)
_JSON_FENCE = re.compile(r"```[ \t]*json[^\n]*\n", re.I)
_VALID_ESC = re.compile(r'\\(\\|["/bfnrt]|u[0-9a-fA-F]{4})|\\')


def _escape_repair(s: str) -> str:
    """Double every backslash that isn't a JSON escape: "\\sqrt", "\\alpha", "\\underline"."""
    return _VALID_ESC.sub(lambda m: m.group(0) if m.group(1) else "\\\\", s)


def _trailing_commas(s: str) -> str:
    return re.sub(r",(\s*[}\]])", r"\1", s)


_MATH = re.compile(r"\$\$[\s\S]+?\$\$|\$[^$]+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]")
_NL_TEX = re.compile(r"\n(?=(?:eq|abla|u\b|ot\b|otin|exists|i\b|leq|geq|mid|parallel|subseteq|e\b|ewline|warrow|earrow|eg\b|vdash))")


def _fix_tex_controls(s: str) -> str:
    """Undo LaTeX that JSON turned into control characters: "\\frac" written as "\frac" is a form feed + "rac"."""
    if not any(c in s for c in "\x0c\x08\t\r\n"):
        return s
    s = re.sub("\x0c(?=[a-zA-Z])", r"\\f", s)
    s = re.sub("\x08(?=[a-zA-Z])", r"\\b", s)
    s = re.sub("\r(?=[a-zA-Z])", r"\\r", s)
    s = re.sub(r"\t(?=(?:heta|imes|ext|an\b|anh\b|o\b|riangle|ilde|frac|au\b|op\b|extbf|extit|extrm|filde))", r"\\t", s)
    if "\n" in s:  # only inside maths: real newlines before words are everywhere else
        s = _MATH.sub(lambda m: _NL_TEX.sub(r"\\n", m.group(0)), s)
    return s


def _walk_strings(v: Any) -> Any:
    if isinstance(v, str):
        return _fix_tex_controls(v)
    if isinstance(v, list):
        return [_walk_strings(x) for x in v]
    if isinstance(v, dict):
        return {k: _walk_strings(x) for k, x in v.items()}
    return v


def _decode_at(text: str, i: int) -> tuple[Any, int] | None:
    """Decode the JSON object starting at text[i], repairing common slips. Returns (obj, end) or None."""
    dec = json.JSONDecoder()
    try:
        return dec.raw_decode(text, i)
    except json.JSONDecodeError:
        pass
    # Repair candidates end at each closing fence after the start, nearest first.
    ends = [m.start() for m in re.finditer(r"\n[ \t]*```", text[i:])] + [len(text) - i]
    for e in ends[:40]:
        chunk = text[i:i + e]
        last = chunk.rfind("}")
        if last == -1:
            continue
        chunk = chunk[:last + 1]
        for fix in (_escape_repair, lambda c: _trailing_commas(_escape_repair(c))):
            try:
                obj, n = dec.raw_decode(fix(chunk))
                return obj, i + len(chunk)
            except json.JSONDecodeError:
                continue
    return None


def _looks_like_doc(o: Any) -> bool:
    return isinstance(o, dict) and (isinstance(o.get("questions"), list) or isinstance(o.get("sections"), list)) and \
        bool(o.get("kind") or o.get("mark_scheme") or o.get("title"))


def extract(text: str) -> tuple[str, dict | None, str | None]:
    """Remove the document from a reply. Returns (rest of the reply, document or None, problem or None).

    The problem is a short sentence for the student when there clearly was a document but it
    couldn't be read (usually because the reply was cut off part-way through it).
    """
    m = _OPEN.search(text)
    if m:
        i = text.find("{", m.end())
        got = _decode_at(text, i) if i != -1 else None
        if not got:
            close = text.find("```", m.end())
            rest = text[: m.start()] + (text[close + 3:] if close != -1 and text.find("{", m.end()) > close else "")
            return rest, None, "Claude's document was cut off or garbled, so it couldn't be laid out. Ask for it again, maybe a little shorter."
        obj, end = got
        close = text.find("```", end)
        rest = text[: m.start()] + (text[close + 3:] if close != -1 else text[end:])
        doc = clean(_walk_strings(obj)) if isinstance(obj, dict) else None
        return rest, doc, None if doc else "Claude's document had no questions or sections in it."
    # Not fenced as chalk-doc: a ```json block that is clearly a document, or a "document" key.
    for fm in _JSON_FENCE.finditer(text):
        i = text.find("{", fm.end())
        got = _decode_at(text, i) if i != -1 else None
        if got and _looks_like_doc(got[0]):
            obj, end = got
            close = text.find("```", end)
            rest = text[: fm.start()] + (text[close + 3:] if close != -1 else text[end:])
            return rest, clean(_walk_strings(obj)), None
    dm = re.search(r'"document"\s*:\s*\{', text)
    if dm:
        got = _decode_at(text, dm.end() - 1)
        if got and _looks_like_doc(got[0]):
            return text, clean(_walk_strings(got[0])), None
    return text, None, None


# ---------------------------------------------------------------- cleaning (whatever Claude wrote → what the renderer expects)
def _s(v: Any, n: int = 4000) -> str:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    return str(v if v is not None else "").strip()[:n]


def _int(v: Any, lo: int = 0, hi: int = 1000) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, str) and re.fullmatch(r"\s*\d+(\.\d+)?\s*", v):
        v = float(v)
    if isinstance(v, (int, float)):
        return max(lo, min(hi, int(v)))
    return None


def _choices(v: Any) -> list[str]:
    """Options as plain text, from a list of strings, a list of {label, text} or a {"A": "..."} map.
    A label is kept as a prefix ("B. text") so the letters on the page are the ones Claude meant."""
    out: list[str] = []
    if isinstance(v, dict):
        v = [{"label": k, "text": t} for k, t in v.items()]
    if not isinstance(v, list):
        return out
    for c in v[:10]:
        if isinstance(c, dict):
            text = _s(c.get("text") or c.get("option") or c.get("value") or c.get("answer") or c.get("content"), 600)
            label = _s(c.get("label") or c.get("letter") or c.get("key") or c.get("id"), 3)
            if text:
                out.append(f"{label.rstrip('.)')}. {text}" if re.fullmatch(r"[A-Ha-h][.)]?", label) else text)
        elif _s(c):
            out.append(_s(c, 600))
    return out


def _answer(a: Any) -> dict | None:
    if isinstance(a, (int, float)) and not isinstance(a, bool):
        a = {"lines": a}
    if isinstance(a, list):  # "answer": ["A ...", "B ..."]
        a = {"choices": a}
    if not isinstance(a, dict):
        return None
    out: dict[str, Any] = {}
    for k in ("lines", "space", "grid"):
        n = _int(a.get(k), 0, 40)
        if n:
            out[k] = n
    if a.get("choices") is not None or a.get("options") is not None:
        ch = _choices(a.get("choices") if a.get("choices") is not None else a.get("options"))
        if ch:
            out["choices"] = ch
            if a.get("multi"):
                out["multi"] = _int(a["multi"], 1, 10) if not isinstance(a["multi"], bool) else 2
    t = a.get("table")
    if isinstance(t, dict) and isinstance(t.get("headers"), list) and t["headers"]:
        out["table"] = {"headers": [_s(h, 200) for h in t["headers"][:12]],
                        "rows": _int(t.get("rows"), 1, 30) or 3}
        if isinstance(t.get("first_column"), list):
            out["table"]["first_column"] = [_s(c, 200) for c in t["first_column"][:30]]
            out["table"]["rows"] = max(out["table"]["rows"], len(out["table"]["first_column"]))
    if a.get("code") is not None:
        n = _int(a.get("code"), 1, 60) or 12
        out["code"] = n
        if a.get("language"):
            out["language"] = _s(a["language"], 30)
        if a.get("starter"):
            out["starter"] = str(a["starter"])[:3000]
    if a.get("final") is not None:
        out["final"] = _s(a.get("final"), 80)
    return out or None


DRAWN = ("plot", "geometry", "circuit")


def _figure(f: Any) -> dict | None:
    """A figure Claude drew: a description Chalk draws exactly (plot, geometry, circuit) or an SVG.

    Figures from the student's own files are not accepted: new papers get new figures.
    """
    if isinstance(f, str):
        f = {"svg": f}
    if not isinstance(f, dict):
        return None
    out: dict[str, Any] = {}
    svg = f.get("svg")
    drawn = next((k for k in DRAWN if isinstance(f.get(k), dict)), None)
    if drawn:
        if len(json.dumps(f[drawn])) > 20000:
            return None
        out[drawn] = f[drawn]
    elif isinstance(svg, str) and "<svg" in svg[:400] and len(svg) < 40000:
        out["svg"] = svg
    else:
        return None  # includes {"upload": ...}: never reuse the student's figures
    if f.get("caption"):
        out["caption"] = _s(f["caption"], 300)
    w = f.get("width")
    if isinstance(w, (int, float)) and 0.15 <= w <= 1:
        out["width"] = float(w)
    return out


def _question(q: Any, depth: int = 0) -> dict | None:
    if isinstance(q, str):
        q = {"text": q}
    if not isinstance(q, dict):
        return None
    if depth == 0 and (q.get("section") or q.get("heading")) and not q.get("parts") and q.get("marks") is None and not q.get("answer"):
        sec = {"section": _s(q.get("section") or q.get("heading"), 200), "text": _s(q.get("text") or q.get("instructions"), 2000)}
        if q.get("page_break"):
            sec["page_break"] = True
        return sec
    out: dict[str, Any] = {"text": _s(q.get("text") or q.get("question") or q.get("prompt"), 8000)}
    for k in ("label", "number"):
        if q.get(k) is not None and _s(q[k]):
            out[k] = _s(q[k], 12)
    m = _int(q.get("marks"), 0, 500)
    if m is not None:
        out["marks"] = m
    figs = q.get("figures") if isinstance(q.get("figures"), list) else [q.get("figure")] if q.get("figure") else []
    figs = [f for f in (_figure(f) for f in figs[:4]) if f]
    if figs:
        out["figures"] = figs
    ans = _answer(q.get("answer")) or {}
    # Multiple-choice options are part of the question, wherever Claude put them.
    if "choices" not in ans:
        a = q.get("answer") if isinstance(q.get("answer"), dict) else {}
        for src in (q.get("choices"), q.get("options"), a.get("options"), a.get("choices")):
            ch = _choices(src)
            if ch:
                ans["choices"] = ch
                multi = q.get("multi") or a.get("multi")
                if multi:
                    ans["multi"] = _int(multi, 1, 10) if not isinstance(multi, bool) else 2
                break
    if ans:
        out["answer"] = ans
    if q.get("page_break"):
        out["page_break"] = True
    if depth < 2 and isinstance(q.get("parts"), list):
        parts = [p for p in (_question(p, depth + 1) for p in q["parts"][:16]) if p and "section" not in p]
        if parts:
            out["parts"] = parts
    return out if (out["text"] or out.get("parts") or out.get("figures")) else None


def _marks(q: dict) -> int:
    if "section" in q:
        return 0
    return q.get("marks", 0) if not q.get("parts") else sum(_marks(p) for p in q["parts"])


def _choice(v: Any, options: tuple, default: str) -> str:
    v = _s(v).lower().replace("-", "_").replace(" ", "_")
    return v if v in options else default


def clean(d: dict) -> dict | None:
    kind = _s(d.get("kind")).lower()
    if kind in ("exam", "test", "mock", "past_paper", "past paper", "assessment"):
        kind = "paper"
    if kind in ("problem_set", "problems", "quiz", "homework", "exercise", "exercises"):
        kind = "worksheet"
    if kind in ("coding_interview", "interview_questions", "coding"):
        kind = "interview"
    if kind in ("revision_notes", "cheat_sheet", "cheatsheet", "summary", "notes_sheet"):
        kind = "notes"
    kind = kind if kind in KINDS else ("notes" if d.get("sections") and not d.get("questions") else "worksheet")
    out: dict[str, Any] = {"kind": kind, "title": _s(d.get("title"), 160) or {"paper": "Practice paper", "interview": "Coding interview", "notes": "Revision notes"}.get(kind, "Worksheet")}
    for k in ("subtitle", "style_of", "time", "header"):
        if d.get(k):
            out[k] = _s(d[k], 200)
    out["font"] = "serif" if _s(d.get("font")).lower() in ("serif", "times", "latex") else "sans"
    out["numbering"] = _choice(d.get("numbering"), NUMBERING, "problem" if kind == "interview" else "box")
    out["part_labels"] = _choice(d.get("part_labels"), PART_LABELS, "paren")
    out["marks_style"] = _choice(d.get("marks_style"), MARKS_STYLES, "brackets_word")
    out["question_totals"] = bool(d.get("question_totals", kind == "paper"))
    out["answer_space"] = "none" if _s(d.get("answer_space")).lower() in ("none", "booklet", "separate", "answer_sheet", "sheet") else "inline"
    cs = _s(d.get("choice_style")).lower()
    if cs in ("list", "boxes", "bubbles"):
        out["choice_style"] = cs
    cov = d.get("cover", kind == "paper")
    if cov is False or kind not in ("paper", "worksheet"):
        out["cover"] = False
    else:
        cv = cov if isinstance(cov, dict) else {}
        fields = [_s(f, 60) for f in (cv.get("fields") or ["Name", "Date"])[:8] if _s(f)]
        out["cover"] = {"fields": fields or ["Name"], "facts": cv.get("facts", True) is not False,
                        "marking_grid": cv.get("marking_grid", True) is not False}
        if cv.get("notice"):
            out["cover"]["notice"] = _s(cv["notice"], 300)
        if kind == "worksheet" and not isinstance(cov, dict):
            out["cover"] = False  # worksheets get a title block, not a cover, unless asked
    for k in ("instructions", "information"):
        if isinstance(d.get(k), list):
            out[k] = [_s(x, 400) for x in d[k][:14] if _s(x)]
        elif isinstance(d.get(k), str) and d[k].strip():
            out[k] = [_s(d[k], 800)]
    qs = [q for q in (_question(q) for q in (d.get("questions") or [])[:80]) if q]
    if qs:
        out["questions"] = qs
        out["total_marks"] = sum(_marks(q) for q in qs)
    ins = []
    for x in (d.get("insert") or [])[:20] if isinstance(d.get("insert"), list) else []:
        if isinstance(x, dict) and (x.get("heading") or x.get("body")):
            ins.append({"heading": _s(x.get("heading"), 200), "body": _s(x.get("body"), 12000)})
    if ins:
        out["insert"] = ins
    if d.get("mark_scheme_notes"):
        out["mark_scheme_notes"] = _s(d["mark_scheme_notes"], 6000)
    ms = []
    raw_ms = d.get("mark_scheme") or d.get("answers") or d.get("solutions") or []
    for r in raw_ms[:300] if isinstance(raw_ms, list) else []:
        if isinstance(r, dict) and (r.get("answer") or r.get("guidance") or r.get("solution")):
            ms.append({"q": _s(r.get("q") or r.get("question"), 20), "answer": _s(r.get("answer") or r.get("solution"), 8000),
                       "marks": _s(r.get("marks"), 20), "guidance": _s(r.get("guidance") or r.get("notes"), 6000)})
    if ms:
        out["mark_scheme"] = ms
    secs = []
    for sct in (d.get("sections") or [])[:60] if isinstance(d.get("sections"), list) else []:
        if isinstance(sct, dict) and (sct.get("heading") or sct.get("body")):
            secs.append({"heading": _s(sct.get("heading"), 200), "body": _s(sct.get("body"), 16000)})
    if secs:
        out["sections"] = secs
    if not qs and not secs:
        return None
    return out


def summary(doc: dict) -> str:
    """"Practice paper · 7 questions · 60 marks" for the card in the notebook."""
    if doc["kind"] == "notes":
        n = len(doc.get("sections") or [])
        return f"Revision notes · {n} section{'s' * (n != 1)}"
    n = sum(1 for q in doc.get("questions") or [] if "section" not in q)
    word = "problem" if doc["kind"] == "interview" else "question"
    label = {"paper": "Practice paper", "worksheet": "Worksheet", "interview": "Coding interview"}[doc["kind"]]
    bits = [label, f"{n} {word}{'s' * (n != 1)}"]
    if doc.get("total_marks"):
        bits.append(f"{doc['total_marks']} mark{'s' * (doc['total_marks'] != 1)}")
    if doc.get("time"):
        bits.append(doc["time"])
    return " · ".join(bits)


# A sample for mock mode (and the UI tests): reads like a short GCSE maths paper.
MOCK_PAPER = {
    "kind": "paper",
    "title": "Quadratic equations",
    "subtitle": "Higher tier · Non-calculator",
    "style_of": "a GCSE Mathematics higher-tier paper",
    "time": "45 minutes",
    "questions": [
        {"text": "Factorise $x^2 + 7x + 12$.", "marks": 2, "answer": {"lines": 2, "final": ""}},
        {"text": "Solve $x^2 - 5x + 6 = 0$.", "marks": 3, "answer": {"space": 5, "final": "x = "}},
        {"text": "The diagram shows the graph of $y = x^2 - 4x + 3$.",
         "figure": "<svg viewBox='0 0 260 200' xmlns='http://www.w3.org/2000/svg'><g stroke='#000' fill='none' stroke-width='1.2'><path d='M20 170 H250 M60 190 V10'/><path d='M40 30 Q120 330 200 30' stroke-width='1.6'/></g><g font-size='11' font-family='serif'><text x='242' y='184'>x</text><text x='66' y='18'>y</text><text x='84' y='184'>1</text><text x='158' y='184'>3</text></g></svg>",
         "parts": [
             {"label": "a", "text": "Write down the coordinates of the points where the graph crosses the $x$-axis.", "marks": 2, "answer": {"lines": 2}},
             {"label": "b", "text": "By completing the square, find the coordinates of the turning point.", "marks": 3, "answer": {"space": 6, "final": "( ____ , ____ )"}},
             {"label": "c", "text": "Which of these is the equation of the line of symmetry?", "marks": 1,
              "answer": {"choices": ["$x = -2$", "$x = 2$", "$y = 2$", "$y = -1$"]}},
         ]},
        {"text": "Show that $\\dfrac{2}{x+1} + \\dfrac{3}{x-2} = 1$ can be written as $x^2 - 6x - 1 = 0$.", "marks": 4, "answer": {"space": 8}},
        {"text": "Hence solve $x^2 - 6x - 1 = 0$. Give your answers in the form $a \\pm b\\sqrt{10}$.", "marks": 3, "answer": {"space": 6, "final": "x = "}},
        {"text": "A rectangle has length $(x + 5)$ cm and width $(x - 2)$ cm. Its area is $30\\text{ cm}^2$.",
         "parts": [
             {"label": "a", "text": "Show that $x^2 + 3x - 40 = 0$.", "marks": 2, "answer": {"lines": 3}},
             {"label": "b", "text": "Find the perimeter of the rectangle.", "marks": 3, "answer": {"grid": 6, "final": "cm"}},
         ]},
    ],
    "mark_scheme": [
        {"q": "1", "answer": "$(x+3)(x+4)$", "marks": "2", "guidance": "M1 for $(x \\pm 3)(x \\pm 4)$ · A1 cao"},
        {"q": "2", "answer": "$(x-2)(x-3) = 0$, $x = 2$ or $x = 3$", "marks": "3", "guidance": "M1 factorisation or correct use of formula · A1 · A1"},
        {"q": "3(a)", "answer": "$(1, 0)$ and $(3, 0)$", "marks": "2", "guidance": "B1 each"},
        {"q": "3(b)", "answer": "$(x-2)^2 - 1$, so $(2, -1)$", "marks": "3", "guidance": "M1 $(x-2)^2$ · M1 $-1$ · A1 coordinates"},
        {"q": "3(c)", "answer": "$x = 2$", "marks": "1", "guidance": "B1"},
        {"q": "4", "answer": "$2(x-2) + 3(x+1) = (x+1)(x-2)$, $5x - 1 = x^2 - x - 2$, so $x^2 - 6x - 1 = 0$", "marks": "4", "guidance": "M1 common denominator · M1 expand · M1 collect · A1 shown with no errors"},
        {"q": "5", "answer": "$x = 3 \\pm \\sqrt{10}$", "marks": "3", "guidance": "M1 formula or completing the square · M1 $\\sqrt{40} = 2\\sqrt{10}$ · A1"},
        {"q": "6(a)", "answer": "$(x+5)(x-2) = 30 \\Rightarrow x^2 + 3x - 10 = 30$", "marks": "2", "guidance": "M1 expand · A1 shown"},
        {"q": "6(b)", "answer": "$x = 5$; sides 10 and 3; perimeter 26 cm", "marks": "3", "guidance": "M1 solve · M1 sides · A1 26"},
    ],
}
