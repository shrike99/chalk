"""After every test passes: how fast is it?

The student predicts their solution's time complexity, then Chalk measures it: it runs their code on
inputs of doubling size (built from a Python expression Claude wrote with the exercise), fits how the
time grows, and compares that with the best complexity Claude says is possible for the problem.
Big-O can't be measured exactly, so results are reported as bands that timing can tell apart:
"barely grows" (O(1), O(log n)), "linear" (O(n), O(n log n)), "quadratic", "cubic" and "worse".
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from typing import Any

import runner

BANDS = [
    {"label": "barely grows", "big_o": "O(1) or O(log n)"},
    {"label": "linear", "big_o": "O(n) or O(n log n)"},
    {"label": "quadratic", "big_o": "O(n²)"},
    {"label": "cubic", "big_o": "O(n³)"},
    {"label": "faster than polynomial growth", "big_o": "O(2ⁿ) or worse"},
]
CHOICES = ["O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n²)", "O(n³)", "O(2ⁿ)"]
LIMIT_MS = 4000          # per run while measuring
MIN_MS = 3.0             # below this at the largest size, timing is mostly noise: try bigger inputs
MAX_INPUT_BYTES = 40_000_000
ROUNDS = 3               # each size runs this many times; the fastest counts (less noise, warm JIT)

PROMPT = r"""
- "complexity": include it for every function or program exercise where a slower solution is
  possible (nearly every algorithm or interview-style problem). It says what's achievable and how
  to build inputs of size n, so Chalk can time the student's code once every test passes:
  "complexity": {"time": "O(n)", "space": "O(n)", "why": "One pass, remembering each value's index in a hash map.",
                 "args_expr": "[random.sample(range(-10**7, 10**7), n), 10**8]", "sizes": [2000, 4000, 8000, 16000]}
  "args_expr" is a Python expression using n and random (seeded) that builds the argument list
  (for programs, "stdin_expr" builds the input text). Pick inputs that make every solution do its
  full work (here: no pair matches), and doubling sizes where the best solution takes a few
  milliseconds at the largest and a slower one clearly takes longer (but under a few seconds).
  For C, keep the largest size under about 200,000 values (the inputs are compiled in).
  The student predicts the complexity, sees the measurement, and is told whether a faster
  approach exists; "why" is shown once they reach it. If they ask for a nudge towards it, ask a
  question about the work their code repeats; don't name the technique.
- When Chalk says the student wants their code's complexity explained, add "complexity_review" to
  your notes json, about THEIR code exactly as written (Chalk gives it with line numbers):
  "complexity_review": {"time": "O(n²)", "space": "O(1)", "n": "n = len(nums)", "line": 3,
                        "because": "Line 3 scans every later number for each number: about n²/2 additions."}
  "line" is the line doing the costly work. Count hidden costs too (`in` on a list, slicing,
  string +=, sort, recursion). Use Chalk's timing as a check and say so if it disagrees with you
  (a stopwatch can't tell n log n from n). Speak a sentence or two. Don't describe a faster
  approach or what to change: if one exists, end with a question about the repeated work.
"""


def band_of(text: str) -> int | None:
    """Which band a big-O expression belongs to: 'O(n log n)' → 1, 'O(n^2)' → 2."""
    t = (text or "").lower().replace(" ", "").replace("²", "^2").replace("³", "^3").replace("ⁿ", "^n").replace("**", "^")
    m = re.search(r"o\((.*)\)", t)
    t = m.group(1) if m else t
    if not t:
        return None
    if re.search(r"(\d|\w)\^n|n!|\^\(?n", t):
        return 4
    powers = [int(p) for p in re.findall(r"\^(\d)", t)]
    if powers:
        return min(4, max(powers))
    if re.search(r"n[*·]?m|nm|n[*·]?n", t):
        return 2
    rest = re.sub(r"log[^+*·]*", "", t)  # O(log n) barely grows; O(n log n) is still about linear
    if re.search(r"[nmvek]", rest):
        return 1
    return 0


def _gen(expr: str, sizes: list[int], program: bool) -> list[Any]:
    """Build the inputs for each size, in a separate Python (Claude's expression, run sandboxed and time-limited)."""
    code = r'''
import json, random, sys
expr, sizes = sys.argv[1], json.loads(sys.argv[2])
out = []
for n in sizes:
    random.seed(1234 + n)
    v = eval(expr, {"__builtins__": __builtins__, "random": random, "n": n, "range": range})
    out.append(v if isinstance(v, str) else list(v))
sys.stdout.write(json.dumps(out, default=lambda o: sorted(o) if isinstance(o, (set, frozenset)) else list(o)))
'''
    p = subprocess.run([sys.executable, "-I", "-c", code, expr, json.dumps(sizes)], capture_output=True, text=True,
                       timeout=30, env=runner._clean_env())
    if p.returncode != 0:
        raise ValueError(p.stderr.strip().splitlines()[-1] if p.stderr.strip() else "the input builder failed")
    if len(p.stdout) > MAX_INPUT_BYTES:
        raise ValueError("the inputs are too big to send")
    vals = json.loads(p.stdout)
    if program and not all(isinstance(v, str) for v in vals):
        raise ValueError("stdin_expr must build text")
    return vals


def plan(ex: dict, scale: float = 1, rounds: int = ROUNDS, only: list[int] | None = None, limit_ms: int = LIMIT_MS) -> dict | None:
    """The sizes and inputs to time this exercise with (None if it has no complexity spec)."""
    cx = ex.get("complexity") or {}
    expr = cx.get("stdin_expr") if ex["kind"] == "program" else cx.get("args_expr")
    if not expr or ex["kind"] not in ("function", "program"):
        return None
    sizes = sorted({max(1, int(int(s) * scale)) for s in cx.get("sizes") or []})[:6]
    if only is not None:
        sizes = [n for n in sizes if n in only]
    base = max(1, min(int(int(s) * scale) for s in cx["sizes"]) // 64)  # a tiny run: the cost of starting, not of the algorithm
    values = _gen(expr, [base] + sizes, ex["kind"] == "program")
    key = "stdin" if ex["kind"] == "program" else "args"
    cases = []
    for _ in range(rounds):  # round-robin, so a warm-up (Java's JIT) helps every size alike
        cases += [{key: v, "time_limit_ms": limit_ms, "expected": None, "expected_stdout": ""} for v in values]
    return {"sizes": sizes, "base": base, "cases": cases, "rounds": rounds}


def collect(sizes: list[int], results: list[dict]) -> dict:
    """Fastest time per size (index 0 is the tiny baseline run), which sizes ran out of time, and any crash."""
    k = len(sizes) + 1
    best: dict[int, float] = {}
    timeouts: set[int] = set()
    error = None
    for idx, r in enumerate(results):
        j, st = idx % k, r.get("status")
        n = 0 if j == 0 else sizes[j - 1]
        if st == "timeout":
            timeouts.add(n)
        elif st == "error" and j > 0 and not isinstance(r.get("ms"), (int, float)):
            error = error or r.get("error") or "it crashed"
        elif st == "error" and j > 0 and r.get("error"):
            error = error or r["error"]
        elif isinstance(r.get("ms"), (int, float)):
            best[n] = min(best.get(n, math.inf), float(r["ms"]))
    return {"best": best, "timeouts": timeouts, "error": error}


def _merge(a: dict, b: dict) -> dict:
    best = dict(a["best"])
    for n, ms in b["best"].items():
        best[n] = min(best.get(n, math.inf), ms)
    return {"best": best, "timeouts": a["timeouts"] | b["timeouts"], "error": a["error"] or b["error"]}


def _time(ex: dict, code: str, **kw) -> dict:
    p = plan(ex, **kw)
    if not p:
        return {"fatal": "This exercise doesn't say how to build big inputs, so it can't be timed."}
    spec = {**_spec_keys(ex), "cases": p["cases"], "time_limit_ms": kw.get("limit_ms", LIMIT_MS), "compare": "exact"}
    r = runner.run(ex["language"], code, spec)
    if r.get("missing"):
        return {"missing": r["missing"]}
    if r.get("compile_error"):
        return {"fatal": r["compile_error"]}
    return {"sizes": p["sizes"], **collect(p["sizes"], r.get("results", []))}


def _spec_keys(ex: dict) -> dict:
    return {k: ex[k] for k in ("kind", "function", "class", "class_name", "signature") if k in ex}


def analyse(ex: dict, sizes: list[int], timings: dict, prediction: str | None = None) -> dict:
    """Turn the timings (from collect) into what the student sees."""
    best, timeouts = timings["best"], timings["timeouts"]
    if timings.get("error") and len(best) <= 1:
        return {"error": f"Your code crashed on the big inputs: {timings['error']}"}
    overhead = best.get(0, 0.0)
    first_timeout = min((n for n in timeouts if n), default=None)
    points = []
    for n in sizes:
        if n in best and (first_timeout is None or n < first_timeout):
            points.append({"n": n, "ms": round(max(best[n] - overhead, 0.01), 2)})
        elif first_timeout is not None and n >= first_timeout:
            points.append({"n": n, "ms": None, "timeout": True})
    good = [p for p in points if p.get("ms") is not None]
    out: dict[str, Any] = {"points": points, "sizes": sizes}
    usable = [p for p in good if p["ms"] >= 0.3]
    if first_timeout is not None and len(good) < 2:
        out.update(too_slow=True, measured=True)
    elif len(usable) >= 2:
        xs = [math.log(p["n"]) for p in usable]
        ys = [math.log(p["ms"]) for p in usable]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sum((x - mx) ** 2 for x in xs) or 1)
        if first_timeout is not None and good:  # it ran out of time at the next size: at least this steep
            last = good[-1]
            limit = timings.get("limit_ms", LIMIT_MS)
            slope = max(slope, math.log(max(limit / max(last["ms"], 0.01), 1)) / math.log(first_timeout / last["n"]))
        out["exponent"] = round(slope, 2)
        out["per_doubling"] = round(2 ** slope, 1)
        out["band"] = 0 if slope < 0.35 else 1 if slope < 1.5 else 2 if slope < 2.5 else 3 if slope < 3.5 else 4
        out["measured"] = True
    else:
        out.update(band=0, measured=bool(good), too_fast=True)
    if out.get("band") is not None:
        out["label"] = BANDS[out["band"]]["label"]
        out["big_o"] = BANDS[out["band"]]["big_o"]
    cx = ex.get("complexity") or {}
    target = band_of(cx.get("time", ""))
    if target is not None and out.get("band") is not None:
        out["target"] = cx["time"]
        out["can_beat"] = out["band"] > target
        if not out["can_beat"]:
            out["why"] = cx.get("why", "")
            if cx.get("space"):
                out["space"] = cx["space"]
    if out.get("too_slow") and target is not None:
        out["target"] = cx["time"]
        out["can_beat"] = True
    if prediction:
        pb = band_of(prediction)
        out["prediction"] = prediction
        out["prediction_right"] = pb is not None and out.get("band") is not None and pb == out["band"]
    return out


PROBE_MS = 1500   # per run: past this a size counts as too slow, and smaller sizes are tried instead


def measure(ex: dict, code: str, prediction: str | None = None) -> dict:
    """Time the code: one quick pass to find sizes that fit, then repeats of the quick sizes for less noise."""
    scale = 1.0
    t = _time(ex, code, scale=scale, rounds=1, limit_ms=PROBE_MS)
    if "sizes" not in t:
        return {"missing": t["missing"]} if t.get("missing") else {"error": t["fatal"]}
    a = analyse(ex, t["sizes"], {**t, "limit_ms": PROBE_MS}, prediction)
    first = next((p for p in a.get("points", []) if p.get("ms") is not None), None)
    top = max((p["ms"] for p in a.get("points", []) if p.get("ms") is not None), default=0)
    if not a.get("error"):
        if a.get("too_fast") or (top < MIN_MS and not a.get("too_slow")):
            scale = 8.0
        elif a.get("too_slow") or (first and first["ms"] > PROBE_MS / 6) or sum(1 for p in a.get("points", []) if p.get("ms") is not None) < 3:
            scale = 1 / 8
        if scale != 1.0:
            t2 = _time(ex, code, scale=scale, rounds=1, limit_ms=PROBE_MS)
            if "sizes" in t2:
                a2 = analyse(ex, t2["sizes"], {**t2, "limit_ms": PROBE_MS}, prediction)
                if not a2.get("error") and (a2.get("band") is not None or a.get("band") is None):
                    t, a = t2, a2
    if a.get("error") or a.get("band") is None:
        return a
    # Repeat the quick sizes (where noise matters) and keep the fastest of each.
    quick = [n for n in t["sizes"] if n in t["best"] and t["best"][n] < 250 and n not in t["timeouts"]]
    if ex["language"] == "c":  # its inputs are compiled into the program: repeats would mean compiling it all again
        quick = []
    if quick:
        t3 = _time(ex, code, scale=scale, rounds=ROUNDS - 1, only=quick, limit_ms=PROBE_MS)
        if "sizes" in t3:
            merged = _merge(t, {"best": t3["best"], "timeouts": set(), "error": None})
            a3 = analyse(ex, t["sizes"], {**merged, "limit_ms": PROBE_MS}, prediction)
            if not a3.get("too_fast"):
                a = a3
    return a


def clean_review(v: Any, code_lines: int) -> dict | None:
    """Claude's analysis of the student's code, kept to what the panel shows."""
    if not isinstance(v, dict) or not str(v.get("time") or "").strip():
        return None
    out = {"time": str(v["time"]).strip()[:40]}
    for k, n in (("space", 40), ("n", 120), ("because", 900)):
        if str(v.get(k) or "").strip():
            out[k] = str(v[k]).strip()[:n]
    try:
        line = int(v.get("line"))
        if 1 <= line <= max(1, code_lines):
            out["line"] = line
    except (TypeError, ValueError):
        pass
    out["band"] = band_of(out["time"])
    return out


def review_context(ex: dict, code: str, state: dict | None) -> str:
    """What Claude needs to explain the student's code: the code with line numbers and the timing."""
    lines = code.rstrip("\n").split("\n")[:400]
    numbered = "\n".join(f"{i:>3} | {line}" for i, line in enumerate(lines, 1))
    r = (state or {}).get("result") or {}
    timing = ""
    if r.get("points"):
        ts = ", ".join(f"n={p['n']}: {'too slow' if p.get('ms') is None else str(p['ms']) + ' ms'}" for p in r["points"])
        timing = f"Chalk's timing on inputs of doubling size: {ts}" + (f" (×{r['per_doubling']} per doubling, so {r.get('label')})" if r.get("per_doubling") else "") + "."
    return "\n".join(["", "COMPLEXITY REVIEW (from Chalk): the student asked you to explain the time and memory complexity of",
                      f"their {ex['language']} code for \"{ex['title']}\". Their code, with line numbers:", numbered, timing,
                      'Add "complexity_review" to your notes json (see "complexity" in the exercise instructions).', ""])


def context_line(state: dict | None) -> str:
    """For Claude: where the student got to in the complexity check."""
    if not state or not state.get("result"):
        return ""
    r = state["result"]
    bits = [f"Complexity check: the student predicted {r.get('prediction') or 'nothing'}"]
    if r.get("big_o"):
        bits.append(f"Chalk measured {r['label']} growth (≈ {r['big_o']}" + (f", ×{r['per_doubling']} per doubling" if r.get("per_doubling") else "") + ")")
    if r.get("target"):
        bits.append(f"your target is {r['target']}" + (" and they haven't reached it yet" if r.get("can_beat") else " and they've reached it"))
    return "; ".join(bits) + ". If they ask for a nudge, ask about the work their code repeats; don't name the technique."
