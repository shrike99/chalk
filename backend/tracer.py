"""Code walkthrough: run the student's Python on one test, recording every line it executes, with
the variables in each function call at that moment. The app then steps through it like a debugger
(no Claude, no tokens).

Each step: {"line", "event": "line" | "call" | "return" | "exception", "stack": [{"fn", "line", "vars"}],
"stdout", and for returns "value"}. Values are JSON-ish: numbers, strings, lists and dicts are kept
(trimmed), anything else becomes {"$type": name, "repr": "..."}.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path

import runner

MAX_STEPS = 600
TIMEOUT_S = 8

TRACER = r'''
import io, json, sys, types
spec = json.load(open(sys.argv[1], encoding="utf-8"))
SRC = sys.argv[2]
code = open(SRC, encoding="utf-8").read()
MAX = spec.get("max_steps", 600)
steps, out = [], io.StringIO()
SEEN_TYPES = (int, float, bool, str, type(None))

def val(v, depth=0):
    if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
        return v if not isinstance(v, float) or v == v and abs(v) != float("inf") else repr(v)
    if isinstance(v, str):
        return v if len(v) <= 120 else v[:117] + "…"
    if depth >= 3:
        return {"$type": type(v).__name__, "repr": "…"}
    if isinstance(v, (list, tuple)):
        items = [val(x, depth + 1) for x in list(v)[:40]]
        res = {"$type": "tuple", "items": items} if isinstance(v, tuple) else items
        if len(v) > 40:
            (res["items"] if isinstance(res, dict) else res).append({"$more": len(v) - 40})
        return res
    if isinstance(v, (set, frozenset)):
        try: items = sorted(v)
        except TypeError: items = list(v)
        return {"$type": "set", "items": [val(x, depth + 1) for x in items[:40]]}
    if isinstance(v, dict):
        pairs = [[val(k, depth + 1), val(x, depth + 1)] for k, x in list(v.items())[:30]]
        return {"$type": "dict", "pairs": pairs, "size": len(v)}
    if isinstance(v, (types.FunctionType, types.BuiltinFunctionType, types.ModuleType, type)):
        return {"$type": "function" if callable(v) and not isinstance(v, type) else type(v).__name__, "repr": getattr(v, "__name__", "")}
    attrs = getattr(v, "__dict__", None)
    if isinstance(attrs, dict) and attrs:
        return {"$type": type(v).__name__, "attrs": {k: val(x, depth + 1) for k, x in list(attrs.items())[:15]}}
    r = repr(v)
    return {"$type": type(v).__name__, "repr": r if len(r) <= 80 else r[:77] + "…"}

def frame_vars(f):
    loc = f.f_locals if f.f_code.co_name != "<module>" else {k: v for k, v in f.f_globals.items()
          if not k.startswith("__") and not isinstance(v, (types.ModuleType,)) and not (isinstance(v, types.FunctionType)) and not isinstance(v, type)}
    return {k: val(v) for k, v in list(loc.items())[:25] if not k.startswith("__")}

def stack_of(f):
    st = []
    while f is not None:
        if f.f_code.co_filename == SRC:
            st.append({"fn": f.f_code.co_name, "line": f.f_lineno, "vars": frame_vars(f)})
        f = f.f_back
    return list(reversed(st))

class Stop(Exception): pass

def tracer(frame, event, arg):
    if frame.f_code.co_filename != SRC:
        return None
    if spec["kind"] != "program" and frame.f_code.co_name == "<module>":
        return tracer  # defining the functions isn't the interesting part
    if event in ("line", "return", "exception", "call"):
        if len(steps) >= MAX:
            sys.settrace(None)
            raise Stop()
        step = {"line": frame.f_lineno, "event": event, "stack": stack_of(frame), "stdout": out.getvalue()[-2000:]}
        if event == "return":
            step["value"] = val(arg)
        if event == "exception":
            step["error"] = f"{arg[0].__name__}: {arg[1]}"
        steps.append(step)
    return tracer

g = {"__name__": "__main__" if spec["kind"] == "program" else "solution"}
result, error = None, None
real_out, real_in = sys.stdout, sys.stdin
sys.stdout = out
if spec["kind"] == "program":
    sys.stdin = io.StringIO(spec.get("stdin", ""))
try:
    compiled = compile(code, SRC, "exec")
    sys.settrace(tracer)
    try:
        exec(compiled, g)
        if spec["kind"] == "function":
            result = g[spec["function"]](*spec.get("args", []))
        elif spec["kind"] == "class":
            obj = None
            for name, args in spec.get("calls", []):
                if obj is None:
                    obj = g[spec["class"]](*args); result = None
                else:
                    result = getattr(obj, name)(*args)
    finally:
        sys.settrace(None)
except Stop:
    error = f"Stopped after {MAX} steps: the walkthrough shows the start."
except SyntaxError as e:
    error = f"SyntaxError: {e.msg} (line {e.lineno})"
except BaseException as e:
    error = f"{type(e).__name__}: {e}"
sys.stdout, sys.stdin = real_out, real_in
print(json.dumps({"steps": steps, "result": val(result), "error": error, "stdout": out.getvalue()[-4000:],
                  "truncated": len(steps) >= MAX}))
'''


def trace_python(code: str, ex: dict, case: dict) -> dict:
    """Walk through the student's code on one case."""
    spec = {"kind": ex["kind"], "function": ex.get("function"), "class": ex.get("class"), "max_steps": MAX_STEPS,
            "args": case.get("args", []), "calls": case.get("calls", []), "stdin": case.get("stdin", "")}
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="chalk-trace-") as d:
        dd = Path(d)
        (dd / "solution.py").write_text(code, "utf-8")
        (dd / "spec.json").write_text(json.dumps(spec), "utf-8")
        (dd / "tracer.py").write_text(TRACER, "utf-8")
        try:
            p = subprocess.run([runner._python(), "-X", "utf8", str(dd / "tracer.py"), str(dd / "spec.json"), str(dd / "solution.py")],
                               cwd=d, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_S,
                               env=runner._clean_env())
        except subprocess.TimeoutExpired:
            return {"error": "Your code took too long to walk through (it may loop forever on this input)."}
    lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
    if not lines:
        return {"error": (p.stderr.strip().splitlines() or ["The walkthrough didn't run."])[-1][:300]}
    out = json.loads(lines[-1])
    out["ms"] = int((time.perf_counter() - t0) * 1000)
    return out
