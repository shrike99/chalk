"""Editing a document Claude already wrote, one question at a time.

Rewriting a whole paper to change one question costs a full paper's worth of output and puts a
second copy of it in the conversation. Instead Claude sends a ```chalk-doc-edit block:

    {"doc": "a1b2c3", "ops": [
        {"op": "replace", "question": 3, "with": {...}, "mark_scheme": [{"q": "(a)", "answer": "..."}]},
        {"op": "replace", "question": "4(b)", "with": {...}},
        {"op": "insert", "after": 5, "question": {...}, "mark_scheme": [...]},
        {"op": "delete", "question": 2},
        {"op": "set", "field": "time", "value": "1 hour"}]}

Question numbers always mean the document as it is before the edit (what the student sees).
Chalk renumbers the rest, moves their mark-scheme entries with them, and saves a new version.
"""
from __future__ import annotations

import copy
import json
import re
from typing import Any

import docs

PROMPT = r"""

## Changing a document you already made
When the student wants part of an existing document changed (a harder question 3, another
multiple-choice question, fewer marks, a typo), don't write the whole document again: send only the
changes, in its own block before your usual reply blocks:

```chalk-doc-edit
{"doc": "<its id>", "ops": [
  {"op": "replace", "question": 3, "with": { ...a whole question, as in a chalk-doc... },
   "mark_scheme": [ {"q": "(a)", "answer": "...", "marks": "2", "guidance": "..."} ]},
  {"op": "replace", "question": "4(b)", "with": { ...just that part... }},
  {"op": "insert", "after": 5, "question": { ... }, "mark_scheme": [ ... ]},   // or "before": 1
  {"op": "delete", "question": 2},
  {"op": "set", "field": "time", "value": "1 hour 15 minutes"}
]}
```
- Question numbers mean the document as the student sees it now, before this edit; Chalk
  renumbers everything after and keeps each mark-scheme entry with its question.
- "mark_scheme" entries replace that question's (or part's) entries; their "q" is relative: "(a)",
  "(b)(ii)", or "" for the whole question. Include them for papers that have a mark scheme.
- "set" fields: title, subtitle, time, header, instructions, information, numbering, part_labels,
  marks_style, answer_space, choice_style, font, cover, insert, mark_scheme_notes.
- JSON rules as for chalk-doc (escape backslashes in LaTeX).
Write a whole new chalk-doc only for a new document, or when most of it changes. Each turn lists
the documents in the note with their ids; the newest version is the one to edit.
"""

SETTABLE = ("title", "subtitle", "style_of", "time", "header", "instructions", "information", "numbering", "part_labels",
            "marks_style", "question_totals", "answer_space", "choice_style", "font", "cover", "insert", "mark_scheme_notes")

_OPEN = re.compile(r"```[ \t]*(?:json[ \t]+)?chalk[-_ ]?doc[-_ ]?edits?\b[^\n]*\n?", re.I)
_SMALL_ROMAN = {r: i for i, r in enumerate(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii",
                                             "xiii", "xiv", "xv", "xvi"])}


def extract(text: str) -> tuple[str, dict | None, str | None]:
    """(text without the block, the edit, a problem to show if the block was unusable)."""
    m = _OPEN.search(text)
    if not m:
        return text, None, None
    i = text.find("{", m.end())
    got = docs._decode_at(text, i) if i != -1 else None
    close = text.find("```", (got[1] if got else m.end()))
    rest = text[: m.start()] + (text[close + 3:] if close != -1 else "")
    if not got or not isinstance(got[0], dict):
        return rest, None, "Claude's changes to the paper were cut off or garbled, so nothing was changed. Ask again."
    edit = docs._walk_strings(got[0])
    ops = edit.get("ops") or edit.get("changes") or edit.get("edits")
    if isinstance(edit.get("op"), str):  # a single op, not wrapped
        ops = [edit]
    if not isinstance(ops, list) or not ops:
        return rest, None, "Claude's changes to the paper had nothing in them."
    return rest, {"doc": str(edit.get("doc") or edit.get("id") or "").strip(), "ops": [o for o in ops if isinstance(o, dict)][:40]}, None


# ---------------------------------------------------------------- addressing questions and parts
def display_numbers(qs: list[dict]) -> list[str | None]:
    """What each question is shown as (None for section headings), as the paper renderer numbers them."""
    out: list[str | None] = []
    n = 0
    for q in qs:
        if "section" in q:
            out.append(None)
            continue
        n += 1
        num = q.get("number") or str(n)
        if q.get("number") and str(q["number"]).isdigit():
            n = int(q["number"])
        out.append(str(num))
    return out


def _level_kind(style: str, depth: int) -> str:
    if style == "decimal":
        return "digit"
    roman = (style == "roman") != (depth == 2)
    return "roman" if roman else "letter"


def _tokens(rest: str) -> list[str]:
    out = []
    for t in re.findall(r"[a-z]+|\d+", rest.lower()):
        if t.isdigit() or len(t) == 1 or t in _SMALL_ROMAN:
            out.append(t)
        else:  # "bii" → "b", "ii"
            out += [t[0], t[1:]] if t[1:] in _SMALL_ROMAN else list(t)
    return out


def parse_ref(ref: Any, part_style: str = "paren") -> tuple[str | None, list[int]]:
    """'3(b)(ii)' → ('3', [1, 1]); 'Q4' → ('4', []); 7 → ('7', []). (None, []) if there's no number."""
    s = str(ref).strip()
    m = re.match(r"^(?:q(?:uestion)?|problem)?\s*\.?\s*(\d+)(.*)$", s, re.I)
    if not m:
        return None, []
    path = []
    for depth, t in enumerate(_tokens(m.group(2)), 1):
        kind = _level_kind(part_style, depth)
        if t.isdigit():
            path.append(int(t) - 1)
        elif kind == "roman" and t in _SMALL_ROMAN:
            path.append(_SMALL_ROMAN[t])
        elif len(t) == 1:
            path.append(ord(t) - 97)
        elif t in _SMALL_ROMAN:
            path.append(_SMALL_ROMAN[t])
        else:
            return m.group(1), [-1]
    return m.group(1), path


def _relabel(num: str, q: Any) -> str:
    """A mark-scheme label for question `num`: "(a)" → "3(a)", "" → "3", "5(b)" → "3(b)"."""
    s = str(q or "").strip()
    m = re.match(r"^(q(?:uestion)?\s*\.?\s*)?(\d+)", s, re.I)
    if m:
        return s[: m.start(2)] + num + s[m.end(2):]
    if not s:
        return num
    return num + s if s[0] in "(.)" or s[0].isalpha() else f"{num} {s}"


def _get_part(q: dict, path: list[int]) -> tuple[list, int] | None:
    """The list holding the part at `path`, and its index."""
    node = q
    for depth, i in enumerate(path):
        parts = node.get("parts") if isinstance(node, dict) else None
        if not isinstance(parts, list) or not (0 <= i < len(parts)):
            return None
        if depth == len(path) - 1:
            return parts, i
        node = parts[i]
    return None


# ---------------------------------------------------------------- applying an edit
def apply(doc: dict, edit: dict) -> tuple[dict | None, list[str], list[str]]:
    """(the new document, what changed, what couldn't be done). The document is None if nothing changed."""
    style = doc.get("part_labels") or "paren"
    raw = copy.deepcopy(doc)
    qs: list[dict] = raw.get("questions") or []
    nums = display_numbers(qs)
    where = {n: i for i, n in enumerate(nums) if n}
    count = sum(1 for n in nums if n)
    changes: list[str] = []
    failed: list[str] = []
    replaced: dict[int, tuple[dict, list | None]] = {}
    part_ms: dict[int, list[tuple[list[int], list | None]]] = {}  # question index → (part path, its new entries or None to drop)
    deleted: set[int] = set()
    inserts: dict[int, list[tuple[dict, list | None]]] = {}  # after index (-1: at the start)

    def target(ref: Any) -> tuple[int, list[int]] | None:
        num, path = parse_ref(ref, style)
        if num is None or num not in where:
            failed.append(f"there's no question {ref} (the paper has {count})")
            return None
        if path and (path[0] < 0 or _get_part(qs[where[num]], path) is None):
            failed.append(f"question {num} has no part {str(ref)[len(num):].strip() or ref}")
            return None
        return where[num], path

    def ms_of(o: dict) -> list | None:
        ms = o.get("mark_scheme")
        return [e for e in ms if isinstance(e, dict)] if isinstance(ms, list) else None

    for o in edit.get("ops") or []:
        op = str(o.get("op") or o.get("action") or "").lower()
        if op in ("set", "update"):
            field = str(o.get("field") or "")
            if field in SETTABLE:
                raw[field] = o.get("value")
                changes.append(f"{field.replace('_', ' ').capitalize()} changed")
            else:
                failed.append(f"“{field}” can't be set")
            continue
        if op in ("insert", "add"):
            new = o.get("question") or o.get("with") or o.get("value")
            if docs._question(new) is None:
                failed.append("a new question had nothing in it")
                continue
            if o.get("before") is not None:
                t = target(o["before"])
                if t is None:
                    continue
                prev = [i for i in range(t[0]) if i not in deleted]
                at = prev[-1] if prev else -1
                # "before 1" when a section heading comes first: go after the heading, not before it
                if t[0] > 0 and "section" in qs[t[0] - 1]:
                    at = t[0] - 1
            elif o.get("after") is not None:
                t = target(o["after"])
                if t is None:
                    continue
                at = t[0]
            else:
                at = len(qs) - 1
            inserts.setdefault(at, []).append((new, ms_of(o)))
            changes.append("New question added" + (f" after question {o['after']}" if o.get("after") is not None else
                                                   f" before question {o['before']}" if o.get("before") is not None else " at the end"))
            continue
        t = target(o.get("question") or o.get("q") or o.get("number"))
        if t is None:
            continue
        idx, path = t
        label = str(o.get("question") or o.get("q") or o.get("number"))
        if op in ("delete", "remove"):
            if path:
                parts, i = _get_part(qs[idx], path)  # type: ignore[misc]
                parts.pop(i)
                part_ms.setdefault(idx, []).append((path, None))
                changes.append(f"Question {label} removed")
            else:
                deleted.add(idx)
                changes.append(f"Question {nums[idx]} removed")
        elif op in ("replace", "rewrite", "change"):
            new = o.get("with") or o.get("question_data") or o.get("value")
            if isinstance(o.get("question"), dict):
                new = o["question"]
            if docs._question(new, depth=min(len(path), 2)) is None:
                failed.append(f"the new question {label} had nothing in it")
                continue
            if path:
                parts, i = _get_part(qs[idx], path)  # type: ignore[misc]
                parts[i] = new
                part_ms.setdefault(idx, []).append((path, ms_of(o)))
            else:
                replaced[idx] = (new, ms_of(o))
            changes.append(f"Question {label} rewritten")
        else:
            failed.append(f"unknown change “{op}”")

    if not changes:
        return None, changes, failed

    # ---- the new question list
    order: list[tuple[str, Any, list | None]] = [("new", q, ms) for q, ms in inserts.get(-1, [])]
    for i, q in enumerate(qs):
        if i not in deleted:
            nq, ms = replaced.get(i, (q, None))
            order.append(("old", (i, nq), ms))
        order += [("new", q2, ms2) for q2, ms2 in inserts.get(i, [])]
    new_qs = [x[1][1] if x[0] == "old" else x[1] for x in order]
    new_nums = display_numbers([{"section": 1} if "section" in q else q for q in new_qs])

    # ---- the mark scheme follows its questions
    old_ms = raw.get("mark_scheme") or []
    if old_ms or any(ms for _, _, ms in order) or part_ms:
        by_num: dict[str, list[dict]] = {}
        loose_head, loose_tail = [], []
        seen_numbered = False
        for e in old_ms:
            num, _ = parse_ref(e.get("q", ""), style)
            if num is not None and num in where:
                by_num.setdefault(num, []).append(e)
                seen_numbered = True
            else:
                (loose_tail if seen_numbered else loose_head).append(e)
        out_ms = list(loose_head)
        for (kind, item, ms), nn in zip(order, new_nums):
            if nn is None:
                continue
            if kind == "new":
                out_ms += [{**e, "q": _relabel(nn, e.get("q"))} for e in (ms or [])]
                continue
            i, _ = item
            on = nums[i]
            if ms is not None:  # the whole question was rewritten with its own mark scheme
                out_ms += [{**e, "q": _relabel(nn, e.get("q"))} for e in ms]
                continue
            entries = by_num.get(on or "", [])
            for path, pms in part_ms.get(i, []):
                keep, first_at = [], None
                for e in entries:
                    _, ep = parse_ref(e.get("q", ""), style)
                    if ep[: len(path)] == path:
                        first_at = len(keep) if first_at is None else first_at
                    else:
                        keep.append(e)
                if pms:
                    base = _part_label(on or "", path, style)
                    ins = [{**e, "q": base + str(e.get("q") or "").strip() if not re.match(r"^\s*\d", str(e.get("q") or ""))
                            else str(e.get("q"))} for e in pms]
                    at = first_at if first_at is not None else len(keep)
                    keep[at:at] = ins
                entries = keep
            out_ms += [{**e, "q": _relabel(nn, e.get("q"))} for e in entries]
        out_ms += loose_tail
        raw["mark_scheme"] = out_ms
    raw["questions"] = new_qs
    cleaned = docs.clean(raw)
    if not cleaned:
        return None, [], failed + ["the paper would have had no questions left"]
    return cleaned, changes, failed


def _part_label(num: str, path: list[int], style: str) -> str:
    if style == "decimal":
        return num + "." + ".".join(str(i + 1) for i in path)
    out = num
    for depth, i in enumerate(path, 1):
        k = _level_kind(style, depth)
        core = list(_SMALL_ROMAN)[i] if k == "roman" and i < len(_SMALL_ROMAN) else chr(97 + i)
        out += f"({core})"
    return out


def outline(doc: dict, limit: int = 40) -> str:
    """One line per question: what Claude needs to point at the right one without the whole paper."""
    qs = doc.get("questions") or []
    lines = []
    for q, n in zip(qs, display_numbers(qs)):
        if n is None:
            lines.append(f"  [{q.get('section', '')}]")
            continue
        text = re.sub(r"\s+", " ", q.get("text") or "").strip()
        parts = len(q.get("parts") or [])
        kind = " multiple choice" if (q.get("answer") or {}).get("choices") else ""
        lines.append(f"  {n}. {text[:70]}{'…' if len(text) > 70 else ''} ({docs._marks(q)} marks{', ' + str(parts) + ' parts' if parts else ''}{kind})")
        if len(lines) >= limit:
            lines.append(f"  … {len(qs) - limit} more")
            break
    return "\n".join(lines)


def compact(doc: dict) -> str:
    """The whole document as compact JSON, for a fresh conversation that needs to edit it."""
    return json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
