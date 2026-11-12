"""Coding exercises: Claude sets a problem with tests; the student writes the code and runs it in Chalk.

The tests come in two kinds:
  examples    shown in full, like the examples in a problem statement
  edge cases  hidden. Each one is an input Claude expects to break a solution that only handles the
              examples (empty input, duplicates, negatives, a huge input...). When one fails the
              student gets its nudge (a question pointing at the input, never the fix) and can ask
              to see the case.

Claude also writes a reference solution. It's never shown: Chalk runs it against Claude's own tests
first and drops any case it fails, so a student is never marked wrong by a wrong expected answer.
"""
from __future__ import annotations

import json
import re
from typing import Any

import complexity
import docs
import runner

PROMPT = r"""

# Coding exercises: the student writes the code
Chalk can run code. When a student is learning to program, don't write their solution for them:
set it as an exercise they solve in Chalk's editor, with tests that run on their PC. Do this when
they ask for practice, ask how to write something they should learn to write themselves, or
(in Tutor, Partner and Quiz modes) ask you to just write the code for an exercise or assignment.
In Answer mode, or for code that's clearly a means to an end (a quick script, a config), answer
normally.

Put the exercise in its own block, before your usual reply blocks:

```chalk-exercise
{
  "title": "Two sum",
  "language": "python",                 // "python" or "javascript"
  "kind": "function",                   // "function", "class" (a sequence of method calls) or "program" (stdin → stdout)
  "function": "two_sum",                // or "class": "LRUCache" for kind "class"
  "prompt": "Given a list of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`...",
  "starter": "def two_sum(nums, target):\n    # your code here\n    pass\n",
  "compare": "unordered",               // "exact" (default), "unordered" (list order doesn't matter), "unordered_nested", "approx" (floats)
  "time_limit_ms": 1500,
  "examples": [
    {"args": [[2, 7, 11, 15], 9], "expected": [0, 1]},
    {"args": [[3, 2, 4], 6], "expected": [1, 2]}
  ],
  "edge_cases": [
    {"args": [[3, 3], 6], "expected": [0, 1], "nudge": "What if both numbers are the same value?", "why": "A dictionary written before it's checked overwrites the first 3, so the pair is never found."},
    {"args": [[1, 2], 7], "expected": null, "nudge": "What should happen when no pair adds up to the target?", "why": "..."},
    {"args_expr": "[list(range(100000)), 199997]", "expected": [99998, 99999], "nudge": "How does your solution cope with 100,000 numbers?", "why": "Checking every pair is about 5 billion steps; a dictionary does it in one pass."}
  ],
  "hints": ["What do you need to remember about the numbers you've already seen?", "..."],
  "solution": "def two_sum(nums, target):\n    ..."   // your reference solution: never shown, used to check your tests
}
```

- Function cases: "args" is the list of arguments; "expected" the return value (JSON: lists for
  tuples, null for None). Python only: "args_expr" is a Python expression for the argument list,
  for big inputs. Class cases: {"calls": [["LRUCache", [2]], ["put", [1, 1]], ["get", [1]]],
  "expected": [null, null, 1]} (the first call constructs). Program cases: {"stdin": "3\n4\n",
  "expected_stdout": "7\n"}.
- EDGE CASES are the point. Think adversarially: what input breaks a solution that passes the
  examples? Empty input, one element, duplicates, negatives and zero, the boundaries (first/last,
  off by one), unsorted or already sorted, no answer, ties, very large input (for efficiency, with
  "args_expr"), unusual characters or case. Write 3–6, each with a "nudge": a question that
  points the student at the input that breaks them, without saying how to fix it, and a "why"
  shown after they ask to see the case. Examples should NOT give the edge cases away.
- Always include "solution": Chalk checks your expected values with it and drops any case it fails.""" + complexity.PROMPT.rstrip() + r"""
- Then reply briefly (spoken): what to build and one thing to think about first. Don't explain
  the solution.

## Languages: "python", "javascript", "java", "c", "sql"
Use the student's default coding language (each turn says which) unless they ask for another or
the topic needs one (a databases module means SQL). Each turn also says which languages this PC can
run; for one that isn't set up, the student is offered a one-click download, so it's fine to set it.
- Java: "kind": "function" calls method "function" on class "class_name" (default "Solution";
  static, or an instance made with a no-argument constructor). JSON arguments convert to the
  parameter types: int/long/double/boolean/char/String, arrays (int[], int[][], String[]),
  List<...>, Set<...>, Map<String, ...>. "kind": "class" builds "class" and makes calls, as above.
  "kind": "program" runs main(String[]) with "stdin". Starter: a full class.
- C: "kind": "function" needs "signature", e.g. "int sum(const int *a, int n)": numbers, char,
  bool, strings (char *) and 1-D arrays (pass the length as its own argument; args [[1, 2, 3], 3]).
  For functions that change an array or string in place, give "expected_args": {"0": [1, 2, 3]}
  (argument index → its value afterwards) as well as, or instead of, "expected". C functions can't
  return arrays: use an output array argument, or "kind": "program" (stdin → stdout, usual for
  first C courses). Starter: the function with an empty body (and #includes it needs).
- SQL (SQLite): "kind": "query" with "schema": the CREATE TABLE and INSERT statements for the sample
  data the student sees. Each case may add hidden "setup" SQL run after the schema (more rows), and
  gives "expected": the rows as lists ([["Ada", 71.5], ["Cy", 64]]); "ordered": true only when the
  question asks for an order. For UPDATE/INSERT/DELETE exercises add "check": "SELECT ..." whose rows
  are compared instead. SQL edge cases are datasets: NULLs, ties, no matching rows, duplicates,
  empty tables, mixed case. Starter: "-- your query\n".
- Edge-case "args_expr" (computed big inputs) is Python-only; elsewhere write big inputs out or skip
  them. The complexity "args_expr" works in every language but SQL (Chalk builds the inputs in Python).

When the student shows you code (theirs or yours), run it in your head against those same kinds
of input first. If something breaks it, don't fix it and don't name the bug: ask about the input
("what does this return for an empty list?") and let them find it. If they keep struggling,
narrow the question, then show the failing trace, and only then the fix. When they send results
from Chalk's runner, talk about the failing case they're on, not the whole solution.
"""

LANGS = ("python", "javascript", "java", "c", "sql")
NAMES = {"python": "Python", "javascript": "JavaScript", "java": "Java", "c": "C", "sql": "SQL"}
KINDS = ("function", "class", "program", "query")
_LANG_ALIASES = {"py": "python", "python3": "python", "js": "javascript", "node": "javascript", "nodejs": "javascript",
                 "c99": "c", "c11": "c", "ansi c": "c", "sqlite": "sql", "sqlite3": "sql", "postgres": "sql",
                 "postgresql": "sql", "mysql": "sql", "tsql": "sql", "jdk": "java"}
COMPARES = ("exact", "unordered", "unordered_nested", "approx")
_OPEN = re.compile(r"```[ \t]*(?:json[ \t]+)?chalk[-_ ]?exercise\b[^\n]*\n?", re.I)


def extract(text: str) -> tuple[str, dict | None, str | None]:
    """Remove the exercise block from a reply. Returns (rest, exercise or None, problem or None)."""
    m = _OPEN.search(text)
    if not m:
        return text, None, None
    i = text.find("{", m.end())
    got = docs._decode_at(text, i) if i != -1 else None
    if not got:
        close = text.find("```", m.end())
        return text[: m.start()] + (text[close + 3:] if close != -1 else ""), None, \
            "Claude's exercise was cut off or garbled, so it couldn't be set up. Ask for it again."
    obj, end = got
    close = text.find("```", end)
    rest = text[: m.start()] + (text[close + 3:] if close != -1 else text[end:])
    ex = clean(obj) if isinstance(obj, dict) else None
    return rest, ex, None if ex else "Claude's exercise had no tests in it."


def _s(v: Any, n: int = 4000) -> str:
    return docs._s(v, n)


def _case(c: Any, kind: str, edge: bool) -> dict | None:
    if not isinstance(c, dict):
        return None
    out: dict[str, Any] = {}
    if kind == "function":
        if isinstance(c.get("args_expr"), str) and c["args_expr"].strip():
            out["args_expr"] = c["args_expr"][:400]
        elif "args" in c:
            out["args"] = c["args"] if isinstance(c["args"], list) else [c["args"]]
        elif "input" in c:
            out["args"] = c["input"] if isinstance(c["input"], list) else [c["input"]]
        else:
            return None
        if "expected" not in c and "output" not in c and not isinstance(c.get("expected_args"), dict):
            return None
        if "expected" in c or "output" in c:
            out["expected"] = c.get("expected", c.get("output"))
        if isinstance(c.get("expected_args"), dict):
            out["expected_args"] = {str(k): v for k, v in c["expected_args"].items() if str(k).isdigit()}
    elif kind == "class":
        if not isinstance(c.get("calls"), list) or not c["calls"]:
            return None
        out["calls"] = [[str(x[0]), x[1] if len(x) > 1 and isinstance(x[1], list) else []] for x in c["calls"][:200] if isinstance(x, list) and x]
        out["expected"] = c.get("expected") if isinstance(c.get("expected"), list) else []
    elif kind == "query":
        rows = c.get("expected", c.get("rows", c.get("output")))
        if not isinstance(rows, list):
            return None
        out["expected"] = [r if isinstance(r, list) else list(r.values()) if isinstance(r, dict) else [r] for r in rows][:2000]
        for k in ("setup", "check"):
            if isinstance(c.get(k), str) and c[k].strip():
                out[k] = c[k][:40000]
        if c.get("ordered") is not None:
            out["ordered"] = bool(c["ordered"])
    else:
        out["stdin"] = str(c.get("stdin", ""))[:20000]
        if c.get("expected_stdout") is None:
            return None
        out["expected_stdout"] = str(c["expected_stdout"])[:20000]
    if c.get("compare") in COMPARES:
        out["compare"] = c["compare"]
    if isinstance(c.get("time_limit_ms"), (int, float)):
        out["time_limit_ms"] = max(100, min(15000, int(c["time_limit_ms"])))
    if c.get("name") or c.get("label"):
        out["name"] = _s(c.get("name") or c.get("label"), 80)
    if edge:
        out["nudge"] = _s(c.get("nudge") or c.get("hint") or "There's an input your code doesn't handle yet. What unusual inputs could this get?", 300)
        if c.get("why") or c.get("explanation"):
            out["why"] = _s(c.get("why") or c.get("explanation"), 1200)
    return out


def clean(d: dict) -> dict | None:
    lang = _s(d.get("language")).lower()
    lang = _LANG_ALIASES.get(lang, lang)
    if lang not in LANGS:
        lang = "sql" if d.get("schema") else "python"
    kind = _s(d.get("kind")).lower()
    if lang == "sql":
        kind = "query"
    elif kind not in KINDS or kind == "query":
        kind = "class" if d.get("class") and not d.get("function") else "program" if any(isinstance(c, dict) and "stdin" in c for c in (d.get("examples") or [])) else "function"
    out: dict[str, Any] = {"title": _s(d.get("title"), 120) or "Exercise", "language": lang, "kind": kind,
                           "prompt": _s(d.get("prompt") or d.get("statement") or d.get("description"), 12000),
                           "starter": str(d.get("starter") or d.get("starter_code") or "")[:20000]}
    if kind == "function" and lang == "c":
        sig = _s(d.get("signature"), 300) or _c_signature_from(out["starter"])
        try:
            parsed = runner.parse_c_signature(sig)
        except ValueError:
            return None
        out["signature"] = sig
        out["function"] = parsed["name"]
    elif kind == "function":
        name = _s(d.get("function") or d.get("function_name") or d.get("method"), 80)
        if not name:
            m = re.search(r"\bdef\s+(\w+)|function\s+(\w+)|const\s+(\w+)\s*=", out["starter"])
            name = next((g for g in (m.groups() if m else ()) if g), "")
        if not re.fullmatch(r"[A-Za-z_]\w*", name or ""):
            return None
        out["function"] = name
        if lang == "java":
            cn = _s(d.get("class_name") or d.get("class"), 80)
            if not cn:
                m = re.search(r"\bclass\s+(\w+)", out["starter"])
                cn = m.group(1) if m else "Solution"
            out["class_name"] = cn if re.fullmatch(r"[A-Za-z_]\w*", cn) else "Solution"
    elif kind == "class":
        name = _s(d.get("class") or d.get("class_name"), 80)
        if not re.fullmatch(r"[A-Za-z_]\w*", name or ""):
            return None
        out["class"] = name
    if d.get("compare") in COMPARES:
        out["compare"] = d["compare"]
    cx = _complexity(d.get("complexity"), kind)
    if cx:
        out["complexity"] = cx
    if kind == "query":
        out["schema"] = str(d.get("schema") or "")[:40000]
        if not out["schema"].strip():
            return None
        if d.get("ordered"):
            out["ordered"] = True
    lim = d.get("time_limit_ms")
    out["time_limit_ms"] = max(200, min(15000, int(lim))) if isinstance(lim, (int, float)) else 2000
    out["examples"] = [c for c in (_case(c, kind, False) for c in (d.get("examples") or d.get("tests") or [])[:20]) if c]
    out["edge_cases"] = [c for c in (_case(c, kind, True) for c in (d.get("edge_cases") or d.get("hidden") or [])[:20]) if c]
    if lang != "python":  # args_expr is Python-only
        for c in out["examples"] + out["edge_cases"]:
            if "args_expr" in c:
                c.clear()
        out["examples"] = [c for c in out["examples"] if c]
        out["edge_cases"] = [c for c in out["edge_cases"] if c]
    if not out["examples"] and not out["edge_cases"]:
        return None
    out["hints"] = [_s(h, 400) for h in (d.get("hints") or [])[:6] if _s(h)]
    if isinstance(d.get("solution"), str) and d["solution"].strip():
        out["solution"] = d["solution"][:30000]
    return out


def _complexity(v: Any, kind: str) -> dict | None:
    """Claude's note on how fast the problem can be solved, and how to build big inputs to time it."""
    if not isinstance(v, dict) or kind not in ("function", "program") or not _s(v.get("time")):
        return None
    out: dict[str, Any] = {"time": _s(v["time"], 40)}
    for k in ("space", "why"):
        if _s(v.get(k)):
            out[k] = _s(v[k], 40 if k == "space" else 1200)
    expr = _s(v.get("stdin_expr") if kind == "program" else v.get("args_expr"), 600)
    sizes = [int(x) for x in (v.get("sizes") or []) if isinstance(x, (int, float)) and 1 <= x <= 10_000_000][:6]
    if expr and len(sizes) >= 3 and sizes == sorted(set(sizes)):
        out["stdin_expr" if kind == "program" else "args_expr"] = expr
        out["sizes"] = sizes
    return out


def _c_signature_from(starter: str) -> str:
    """The first non-main function definition in some C code, as a signature."""
    for m in re.finditer(r"^[ \t]*((?:const\s+)?[A-Za-z_][\w \t]*?[\s\*]+([A-Za-z_]\w*)\s*\([^;{)]*\))\s*\{", starter, re.M):
        if m.group(2) != "main":
            return m.group(1).strip()
    return ""


def spec(ex: dict, which: str = "all", mine: list[dict] | None = None) -> dict:
    """The runner's spec. which: "examples", "edge" or "all" (examples, the student's own tests, then edge cases)."""
    # The student's own tests run straight after the examples, so a slow hidden case can't stop them running.
    cases = (ex["examples"] if which in ("examples", "all") else []) + (list(mine or []) if which == "all" else []) \
        + (ex["edge_cases"] if which in ("edge", "all") else [])
    s = {"kind": ex["kind"], "cases": cases, "time_limit_ms": ex.get("time_limit_ms", 2000)}
    for k in ("function", "class", "compare", "class_name", "signature", "schema", "ordered"):
        if k in ex:
            s[k] = ex[k]
    return s


def verify(ex: dict) -> dict:
    """Run Claude's reference solution against Claude's tests and drop the cases it fails, so the
    student is only ever marked against expected answers that hold up. Python only."""
    report = {"checked": False, "dropped": []}
    if ex["language"] == "javascript" or not ex.get("solution"):
        return report
    r = runner.run(ex["language"], ex["solution"], spec(ex))
    if r.get("missing"):
        report["error"] = f"{NAMES[ex['language']]} isn't set up, so the tests weren't checked"
        return report
    if r.get("compile_error"):
        report["error"] = r["compile_error"]
        return report
    report["checked"] = True
    n_ex = len(ex["examples"])
    bad = {res["i"] for res in r["results"] if res.get("status") != "pass"}
    keep_ex = [c for i, c in enumerate(ex["examples"]) if i not in bad]
    keep_edge = [c for j, c in enumerate(ex["edge_cases"]) if n_ex + j not in bad]
    report["dropped"] = [("example", i) for i in range(n_ex) if i in bad] + [("edge case", j) for j in range(len(ex["edge_cases"])) if n_ex + j in bad]
    ex["examples"], ex["edge_cases"] = keep_ex, keep_edge
    return report


def public(ex: dict, revealed: set[int] | None = None) -> dict:
    """What the app shows: no solution, and edge cases as nudges only (unless revealed)."""
    revealed = revealed or set()
    out = {k: v for k, v in ex.items() if k not in ("solution", "edge_cases", "complexity")}
    if ex.get("complexity"):
        out["complexity_check"] = bool(ex["complexity"].get("sizes"))
    out["edge_cases"] = [
        ({**c, "revealed": True} if i in revealed else {"nudge": c.get("nudge", ""), "revealed": False, **({"name": c["name"]} if c.get("name") else {})})
        for i, c in enumerate(ex["edge_cases"])]
    if ex["kind"] == "query":
        out["tables"] = sample_tables(ex["schema"])
    return out


def sample_tables(schema: str, limit: int = 12) -> list[dict]:
    """The sample data the student sees: each table's columns and first rows."""
    import sqlite3
    db = sqlite3.connect(":memory:")
    try:
        db.executescript(schema)
        out = []
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid"):
            cur = db.execute(f'SELECT * FROM "{name}" LIMIT {limit + 1}')
            rows = [list(r) for r in cur.fetchall()]
            total = db.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            out.append({"name": name, "columns": [d[0] for d in cur.description], "rows": rows[:limit], "total": total})
        return out
    except sqlite3.Error:
        return []
    finally:
        db.close()


def summary(ex: dict) -> str:
    lang = NAMES[ex["language"]]
    n, e = len(ex["examples"]), len(ex["edge_cases"])
    return f"{lang} exercise · {n} example{'s' * (n != 1)} · {e} hidden edge case{'s' * (e != 1)}"


def clean_tests(ex: dict, tests: Any) -> list[dict]:
    """The student's own test cases, in the same shape as Claude's (at most 12)."""
    out = []
    for t in tests if isinstance(tests, list) else []:
        if not isinstance(t, dict):
            continue
        c = _case(t, ex["kind"], ex["language"])
        if c:
            c.pop("args_expr", None)
            c.pop("nudge", None)
            out.append(c)
    return out[:12]


def _features(c: dict, kind: str) -> set[str]:
    """What makes an input tricky, as tags: "empty", "duplicates", "negative", "no answer"…"""
    tags: set[str] = set()

    def walk(v: Any, top: bool = False) -> None:
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, (int, float)):
            if v < 0:
                tags.add("negative")
            if v == 0:
                tags.add("zero")
            if abs(v) >= 10**6:
                tags.add("huge number")
            if isinstance(v, float) and not float(v).is_integer():
                tags.add("decimal")
        elif isinstance(v, str):
            if v == "":
                tags.add("empty")
            elif len(v) == 1:
                tags.add("single")
            if v != v.strip() or "  " in v:
                tags.add("extra spaces")
            if any(ch.isupper() for ch in v) and any(ch.islower() for ch in v):
                tags.add("mixed case")
            if any(ord(ch) > 127 for ch in v):
                tags.add("unusual characters")
        elif isinstance(v, (list, dict)):
            items = list(v.values()) if isinstance(v, dict) else v
            if not items:
                tags.add("empty")
            elif len(items) == 1:
                tags.add("single")
            if len(items) >= 1000:
                tags.add("large input")
            plain = [x for x in items if isinstance(x, (int, float, str)) and not isinstance(x, bool)]
            if len(plain) >= 2 and len(set(map(repr, plain))) < len(plain):
                tags.add("all the same" if len(set(map(repr, plain))) == 1 else "duplicates")
            if len(plain) >= 3 and all(isinstance(x, (int, float)) for x in plain):
                if plain == sorted(plain, reverse=True) and plain != sorted(plain):
                    tags.add("descending")
            for x in items[:200]:
                walk(x)

    if kind == "program":
        text = c.get("stdin", "")
        walk(text)
        if len(text.splitlines()) >= 1000:
            tags.add("large input")
    else:
        for a in c.get("args") or []:
            walk(a, True)
        for call in c.get("calls") or []:
            if isinstance(call, list) and len(call) > 1:
                for a in call[1] or []:
                    walk(a, True)
        if "args_expr" in c:
            tags.add("large input")
        exp = c.get("expected", "__")
        if exp is None or exp in ([], "", -1, False):
            tags.add("no answer")
    return tags


def anticipated(ex: dict, mine: list[dict]) -> list[bool]:
    """For each hidden edge case: did one of the student's own tests probe the same thing? An edge case's
    point is what it has that the visible examples don't; a test with all of that counts."""
    kind = ex["kind"]
    seen = set().union(*[_features(c, kind) for c in ex["examples"]]) if ex["examples"] else set()
    theirs = [_features(t, kind) for t in mine]
    out = []
    for c in ex["edge_cases"]:
        point = _features(c, kind) - seen
        same_input = any(json.dumps(t.get("args", t.get("stdin")), sort_keys=True) == json.dumps(c.get("args", c.get("stdin")), sort_keys=True) for t in mine)
        out.append(same_input or bool(point and any(point <= f for f in theirs)))
    return out


def shape_results(ex: dict, run: dict, revealed: set[int], mine: list[dict] | None = None, gate: bool = False) -> dict:
    """Split runner results into examples (full detail) and edge cases (status + nudge, details only
    once revealed). The student's own tests run after them. With gate on (they haven't written any
    tests yet, nor chosen to skip that), edge cases show only pass or fail: think first, then the nudges."""
    n_ex = len(ex["examples"])
    res = {r["i"]: r for r in run.get("results", [])}
    n_mine = int(run.get("mine_n", len(mine or [])))  # how many of the student's tests that run included
    if n_mine:  # in the run, edge cases come after the student's tests
        res = {(i if i < n_ex else i + len(ex["edge_cases"]) if i < n_ex + n_mine else i - n_mine): r for i, r in res.items()}
    examples, edges = [], []
    for i, c in enumerate(ex["examples"]):
        r = res.get(i, {"status": "skipped"})
        examples.append({**_shown(c), **_result(r)})
    for j, c in enumerate(ex["edge_cases"]):
        r = res.get(n_ex + j, {"status": "skipped"})
        item: dict[str, Any] = {"status": r.get("status"), "nudge": c.get("nudge", ""), "revealed": j in revealed}
        if c.get("name"):
            item["name"] = c["name"]
        if j in revealed:
            item.update(_shown(c))
            item.update(_result(r))
            if c.get("why"):
                item["why"] = c["why"]
        elif r.get("status") == "error":
            item["error_type"] = (r.get("error") or "").split(":")[0]  # "IndexError" is a fair clue; the message may give the input away
        if gate and j not in revealed:
            item["nudge"] = ""
            item.pop("error_type", None)
            item["gated"] = True
        edges.append(item)
    out = {"examples": examples, "edge_cases": edges, "stdout": run.get("stdout", ""), "ms": run.get("ms")}
    if mine:
        n_all = n_ex + len(ex["edge_cases"])
        out["mine"] = [{**_shown(t), **_result(res.get(n_all + k, {"status": "skipped"}) if k < n_mine else {"status": "not run"})}
                       for k, t in enumerate(mine)]
        for item, hit in zip(edges, anticipated(ex, mine)):
            item["anticipated"] = hit
    if gate:
        out["gated"] = True
    if run.get("compile_error"):
        out["compile_error"] = run["compile_error"]
        out["line"] = run.get("line")
    return out


def _shown(c: dict) -> dict:
    out = {k: c[k] for k in ("args", "args_expr", "expected", "expected_args", "calls", "stdin", "expected_stdout", "name", "setup", "check", "ordered") if k in c}
    if "args_expr" in out:
        out["args_note"] = "a very large input"
    return out


def _result(r: dict) -> dict:
    return {k: r[k] for k in ("status", "got", "error", "line", "stdout", "ms", "bad_call") if k in r}


# A sample for mock mode and the tests. Edge case 4's expected answer is deliberately wrong:
# verify() must drop it rather than mark a correct student wrong.
MOCK = {
    "title": "Two sum", "language": "python", "kind": "function", "function": "two_sum", "compare": "unordered",
    "prompt": "Given a list of integers `nums` and an integer `target`, return the **indices** of the two numbers that add up to `target`, as a list `[i, j]`. Return `None` if no two numbers do.\n\n```\ntwo_sum([2, 7, 11, 15], 9)  ->  [0, 1]\ntwo_sum([3, 2, 4], 6)       ->  [1, 2]\n```\n\nTry for one pass through the list.",
    "starter": "def two_sum(nums, target):\n    # return [i, j] or None\n    pass\n",
    "time_limit_ms": 1500,
    "examples": [{"args": [[2, 7, 11, 15], 9], "expected": [0, 1]}, {"args": [[3, 2, 4], 6], "expected": [1, 2]}],
    "edge_cases": [
        {"args": [[3, 3], 6], "expected": [0, 1], "nudge": "What if both numbers are the same value?", "why": "If you store each number before checking for its partner, the second 3 finds itself, or overwrites the first."},
        {"args": [[1, 2], 7], "expected": None, "nudge": "What should happen when no two numbers add up to the target?", "why": "The function has to return None explicitly after the loop."},
        {"args": [[-3, 4, 3, 90], 0], "expected": [0, 2], "nudge": "Do negative numbers and zero still work?", "why": "Solutions that skip non-positive numbers or assume sorted input miss this."},
        {"args": [[5], 10], "expected": [0, 0], "nudge": "deliberately wrong expected answer", "why": "must be dropped by verify()"},
        {"args_expr": "[list(range(200000)), 399997]", "expected": [199998, 199999], "nudge": "How long does your solution take with 200,000 numbers?", "why": "Checking every pair is about 20 billion comparisons; remembering what you've seen in a dictionary makes it one pass."},
    ],
    "hints": ["For each number, what other number would you need to have seen already?", "A dictionary can remember where you saw each number."],
    "solution": "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return None\n",
}

MOCK_JS = {
    "title": "Two sum (JavaScript)", "language": "javascript", "kind": "function", "function": "twoSum", "compare": "unordered",
    "prompt": "Write `twoSum(nums, target)` returning the indices `[i, j]` of two numbers that add up to `target`, or `null` if none do.",
    "starter": "function twoSum(nums, target) {\n  // return [i, j] or null\n}\n",
    "time_limit_ms": 1500,
    "examples": [{"args": [[2, 7, 11, 15], 9], "expected": [0, 1]}, {"args": [[3, 2, 4], 6], "expected": [1, 2]}],
    "edge_cases": [
        {"args": [[3, 3], 6], "expected": [0, 1], "nudge": "What if both numbers are the same value?", "why": "Store each number after checking for its partner, not before."},
        {"args": [[1, 2], 7], "expected": None, "nudge": "What should happen when no two numbers add up to the target?", "why": "Return null explicitly after the loop."},
    ],
    "hints": ["What do you need to remember about the numbers you've already seen?"],
}

MOCK_JAVA = {
    "title": "Second largest", "language": "java", "kind": "function", "class_name": "Solution", "function": "secondLargest",
    "prompt": "Write `secondLargest(int[] nums)` returning the second largest **distinct** value, or `-1` if there isn't one.\n\n```\nsecondLargest([4, 1, 9, 7])  ->  7\n```",
    "starter": "class Solution {\n    static int secondLargest(int[] nums) {\n        // your code\n        return -1;\n    }\n}\n",
    "time_limit_ms": 3000,
    "examples": [{"args": [[4, 1, 9, 7]], "expected": 7}, {"args": [[10, 20]], "expected": 10}],
    "edge_cases": [
        {"args": [[5, 5, 5]], "expected": -1, "nudge": "What if every number is the same?", "why": "There is no second distinct value, so the answer is -1."},
        {"args": [[9, 9, 3]], "expected": 3, "nudge": "What if the largest value appears twice?", "why": "Skipping only the first copy of the maximum returns 9 instead of 3."},
        {"args": [[-4, -2, -9]], "expected": -4, "nudge": "Does it still work when every number is negative?", "why": "Starting the running values at 0 beats every negative input."},
        {"args": [[]], "expected": -1, "nudge": "What about an empty array?", "why": "Reading nums[0] throws ArrayIndexOutOfBoundsException."},
    ],
    "hints": ["Keep two running values: the largest so far and the second largest so far."],
    "solution": "class Solution {\n    static int secondLargest(int[] nums) {\n        Integer a = null, b = null;\n        for (int n : nums) {\n            if (a == null || n > a) { if (a != null) b = a; a = n; }\n            else if (n != a && (b == null || n > b)) b = n;\n        }\n        return b == null ? -1 : b;\n    }\n}\n",
}

MOCK_C = {
    "title": "Reverse in place", "language": "c", "kind": "function", "signature": "void reverse(int *a, int n)",
    "prompt": "Write `void reverse(int *a, int n)` that reverses the first `n` elements of `a` **in place**.\n\n```\nint a[] = {1, 2, 3};\nreverse(a, 3);   /* a is now {3, 2, 1} */\n```",
    "starter": "void reverse(int *a, int n) {\n    /* your code */\n}\n",
    "time_limit_ms": 2000,
    "examples": [{"args": [[1, 2, 3], 3], "expected_args": {"0": [3, 2, 1]}}, {"args": [[4, 5], 2], "expected_args": {"0": [5, 4]}}],
    "edge_cases": [
        {"args": [[1, 2, 3, 4], 4], "expected_args": {"0": [4, 3, 2, 1]}, "nudge": "Does an even number of elements work?", "why": "Looping while i <= n / 2 swaps the middle pair twice."},
        {"args": [[7], 1], "expected_args": {"0": [7]}, "nudge": "What about a single element?"},
        {"args": [[], 0], "expected_args": {"0": []}, "nudge": "And an empty array?", "why": "n - 1 is -1 here; an index from it reads outside the array."},
    ],
    "hints": ["Swap a[i] with a[n - 1 - i]. How far should i go?"],
    "solution": "void reverse(int *a, int n) {\n    for (int i = 0; i < n / 2; i++) { int t = a[i]; a[i] = a[n - 1 - i]; a[n - 1 - i] = t; }\n}\n",
}

MOCK_SQL = {
    "title": "Average mark per course", "language": "sql", "kind": "query",
    "prompt": "Return each course's `name` and its **average mark**, rounded to 1 decimal place, highest first. Courses with no marks shouldn't appear.",
    "schema": "CREATE TABLE courses (id INTEGER PRIMARY KEY, name TEXT);\nCREATE TABLE marks (student TEXT, course_id INTEGER, mark INTEGER);\nINSERT INTO courses VALUES (1, 'Algebra'), (2, 'Biology'), (3, 'Chemistry');\nINSERT INTO marks VALUES ('Ada', 1, 80), ('Ben', 1, 70), ('Ada', 2, 90), ('Cy', 2, 61);",
    "starter": "-- your query\n",
    "ordered": True,
    "examples": [{"expected": [["Biology", 75.5], ["Algebra", 75.0]], "ordered": True}],
    "edge_cases": [
        {"setup": "INSERT INTO marks VALUES ('Dee', 3, NULL), ('Eve', 3, 50);", "expected": [["Biology", 75.5], ["Algebra", 75.0], ["Chemistry", 50.0]], "ordered": True,
         "nudge": "What if a mark is missing (NULL)?", "why": "AVG ignores NULLs, but SUM(mark) / COUNT(*) counts them and gives 25."},
        {"setup": "INSERT INTO courses VALUES (4, 'Drama');", "expected": [["Biology", 75.5], ["Algebra", 75.0]], "ordered": True,
         "nudge": "What about a course nobody has a mark in yet?", "why": "A LEFT JOIN keeps Drama with a NULL average; the question says leave it out."},
    ],
    "hints": ["JOIN the two tables, then GROUP BY the course."],
    "solution": "SELECT c.name, ROUND(AVG(m.mark), 1) AS avg_mark FROM courses c JOIN marks m ON m.course_id = c.id GROUP BY c.id HAVING AVG(m.mark) IS NOT NULL ORDER BY avg_mark DESC;",
}

MOCK["complexity"] = {"time": "O(n)", "space": "O(n)", "why": "One pass: remember the index of each number you've seen in a dictionary, and look up target − x before storing x.",
                      "args_expr": "[random.sample(range(-10**7, 10**7), n), 10**8]", "sizes": [500, 1000, 2000, 4000]}
MOCK_JS["complexity"] = {**MOCK["complexity"], "why": "One pass with a Map from value to index."}
MOCK_JAVA["complexity"] = {"time": "O(n)", "space": "O(1)", "why": "One pass, keeping the largest and second largest so far.",
                           "args_expr": "[[random.randint(-10**9, 10**9) for _ in range(n)]]", "sizes": [20000, 40000, 80000, 160000]}

MOCKS = {"python": MOCK, "javascript": MOCK_JS, "java": MOCK_JAVA, "c": MOCK_C, "sql": MOCK_SQL}
