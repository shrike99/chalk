"""Running a student's Python against an exercise's tests, on their own PC.

Three kinds of exercise:
  function  call a function with each case's arguments, compare what it returns
  class     build an object and make a sequence of calls (LeetCode-style "design" problems)
  program   run the whole file with some input on stdin, compare what it prints

Each run is a separate Python process with a time limit per case. A case that runs too long (an
infinite loop, or code far too slow for a big input) is reported as timed out, and the cases after
it as not run; everything before it still comes back. print() output is captured per case.

This is the student's own code on the student's own machine, so it isn't sandboxed beyond that:
it runs in an empty temporary folder with a short time limit.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

DEFAULT_LIMIT_MS = 2000
MAX_CASES = 60

# The harness runs inside the student's process. It reads the spec, loads the student's file as a
# module, and prints one JSON line per case as it goes (so a hang still leaves earlier results).
HARNESS = r'''
import io, json, math, os, sys, threading, time, traceback, contextlib, types

with open(sys.argv[1], encoding="utf-8") as fh:
    spec = json.load(fh)
os.remove(sys.argv[1])  # the hidden cases aren't left lying around for the code under test to read
path = sys.argv[2]
out = sys.__stdout__

def emit(obj):
    out.write(json.dumps(obj) + "\n"); out.flush()

def short(v, n=600):
    try:
        s = json.dumps(v)
    except Exception:
        s = repr(v)
    return s if len(s) <= n else s[:n] + "…"

def plain(v):
    """Tuples and sets as lists, so results compare like JSON."""
    if isinstance(v, (list, tuple)):
        return [plain(x) for x in v]
    if isinstance(v, (set, frozenset)):
        return sorted((plain(x) for x in v), key=lambda x: json.dumps(x, sort_keys=True, default=str))
    if isinstance(v, dict):
        return {str(k): plain(x) for k, x in v.items()}
    return v

def same(got, want, how):
    got, want = plain(got), plain(want)
    if how == "approx":
        if isinstance(got, (int, float)) and isinstance(want, (int, float)) and not isinstance(got, bool):
            return math.isclose(got, want, rel_tol=1e-6, abs_tol=1e-9)
        if isinstance(got, list) and isinstance(want, list) and len(got) == len(want):
            return all(same(a, b, "approx") for a, b in zip(got, want))
        return got == want
    if how == "unordered" and isinstance(got, list) and isinstance(want, list):
        key = lambda x: json.dumps(x, sort_keys=True, default=str)
        return sorted(got, key=key) == sorted(want, key=key)
    if how == "unordered_nested" and isinstance(got, list) and isinstance(want, list):
        key = lambda x: json.dumps(x, sort_keys=True, default=str)
        norm = lambda l: sorted((sorted(x, key=key) if isinstance(x, list) else x for x in l), key=key)
        return norm(got) == norm(want)
    return got == want

def where(tb):
    """The student's own line in a traceback (not the harness's)."""
    line = None
    for fr in traceback.extract_tb(tb):
        if fr.filename == path:
            line = fr.lineno
    return line

def describe(e):
    return f"{type(e).__name__}: {e}" if str(e) else type(e).__name__

# Load the student's file. Output printed at import time is kept for the console.
mod = types.ModuleType("solution")
mod.__file__ = path
src = open(path, encoding="utf-8").read()
buf = io.StringIO()
try:
    code = compile(src, path, "exec")
except SyntaxError as e:
    emit({"compile_error": f"{type(e).__name__}: {e.msg}", "line": e.lineno, "col": e.offset})
    sys.exit(0)
try:
    with contextlib.redirect_stdout(buf):
        exec(code, mod.__dict__)
except BaseException as e:
    emit({"compile_error": "Your file stopped while loading: " + describe(e), "line": where(e.__traceback__), "stdout": buf.getvalue()[-4000:]})
    sys.exit(0)
emit({"loaded": True, "stdout": buf.getvalue()[-4000:]})

kind = spec.get("kind", "function")
target_name = spec.get("function") if kind == "function" else spec.get("class")
target = mod.__dict__.get(target_name)
if target is None or not callable(target):
    emit({"compile_error": f"Couldn't find {'a function' if kind == 'function' else 'a class'} called {target_name} in your code."})
    sys.exit(0)

def args_of(case):
    if case.get("args_expr"):
        return list(eval(case["args_expr"], {"__builtins__": __builtins__}, {}))
    a = case.get("args", [])
    return list(a) if isinstance(a, list) else [a]

def run_case(i, case, box):
    o = io.StringIO()
    t0 = time.perf_counter()
    try:
        with contextlib.redirect_stdout(o):
            if kind == "function":
                args = args_of(case)
                got = target(*args)
                ok = same(got, case.get("expected"), case.get("compare") or spec.get("compare") or "exact")
                box.update(status="pass" if ok else "fail", got=short(plain(got)))
            else:
                calls = case.get("calls", [])
                want = case.get("expected", [])
                obj, results = None, []
                for k, call in enumerate(calls):
                    name, cargs = call[0], call[1] if len(call) > 1 else []
                    if k == 0:
                        obj = target(*cargs); results.append(None)
                    else:
                        results.append(plain(getattr(obj, name)(*cargs)))
                bad = next((k for k, (g, w) in enumerate(zip(results, want)) if not same(g, w, case.get("compare") or "exact")), None)
                if bad is None and len(results) != len(want):
                    bad = min(len(results), len(want))
                box.update(status="pass" if bad is None else "fail", got=short(results), bad_call=bad)
    except RecursionError as e:
        box.update(status="error", error="RecursionError: maximum recursion depth exceeded (does your recursion stop?)", line=where(e.__traceback__))
    except BaseException as e:
        box.update(status="error", error=describe(e), line=where(e.__traceback__))
    box["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    box["stdout"] = o.getvalue()[-2000:]

sys.setrecursionlimit(5000)
limit = spec.get("time_limit_ms", 2000) / 1000
cases = spec.get("cases", [])
for i, case in enumerate(cases):
    box = {"i": i}
    th = threading.Thread(target=run_case, args=(i, case, box), daemon=True)
    th.start(); th.join(case.get("time_limit_ms", limit * 1000) / 1000)
    if th.is_alive():
        emit({"i": i, "status": "timeout"})
        for j in range(i + 1, len(cases)):
            emit({"i": j, "status": "skipped"})
        out.flush()
        os._exit(0)
    emit(box)
'''


def _python() -> str:
    return sys.executable


def _clean_env() -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CHALK_", "TUTOR_", "ANTHROPIC", "CLAUDE"))}
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def run_python(code: str, spec: dict) -> dict:
    """Run code against spec. Returns {"results": [...], "compile_error"?, "stdout", "ms"}."""
    kind = spec.get("kind", "function")
    cases = list(spec.get("cases", []))[:MAX_CASES]
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="chalk-run-") as d:
        dd = Path(d)
        (dd / "solution.py").write_text(code, "utf-8")
        if kind in ("program", "script"):
            return _run_program(dd, cases, spec, t0)
        (dd / "spec.json").write_text(json.dumps({**spec, "cases": cases}), "utf-8")
        (dd / "harness.py").write_text(HARNESS, "utf-8")
        per = max(100, int(spec.get("time_limit_ms", DEFAULT_LIMIT_MS)))
        budget = per * max(1, len(cases)) / 1000 + 6
        try:
            p = subprocess.run([_python(), "-X", "utf8", str(dd / "harness.py"), str(dd / "spec.json"), str(dd / "solution.py")],
                               cwd=d, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=budget, env=_clean_env())
            stdout_lines, stderr = p.stdout.splitlines(), p.stderr
        except subprocess.TimeoutExpired as e:
            stdout_lines = (e.stdout or b"").decode("utf-8", "replace").splitlines() if isinstance(e.stdout, bytes) else (e.stdout or "").splitlines()
            stderr = "timed out"
    results: list[dict] = []
    out: dict[str, Any] = {"results": results, "stdout": "", "ms": 0}
    for ln in stdout_lines:
        try:
            ev = json.loads(ln)
        except ValueError:
            continue
        if "compile_error" in ev:
            out["compile_error"] = ev["compile_error"]
            out["line"] = ev.get("line")
            out["stdout"] = ev.get("stdout", "")
        elif ev.get("loaded"):
            out["stdout"] = ev.get("stdout", "")
        elif "i" in ev:
            results.append(ev)
    if not results and "compile_error" not in out:
        out["compile_error"] = "Your code didn't run: " + (stderr.strip().splitlines() or ["no output"])[-1][:400]
    # Any case the process never reached (it crashed hard) is marked so nothing silently disappears.
    seen = {r["i"] for r in results}
    for i in range(len(cases)):
        if i not in seen and "compile_error" not in out:
            results.append({"i": i, "status": "skipped"})
    results.sort(key=lambda r: r["i"])
    out["ms"] = round((time.perf_counter() - t0) * 1000)
    return out


def _run_program(d: Path, cases: list[dict], spec: dict, t0: float, cmd: list[str] | None = None, src_name: str = "solution.py") -> dict:
    """Whole-program exercises: feed stdin, compare stdout line by line (trailing spaces ignored)."""
    per = max(100, int(spec.get("time_limit_ms", DEFAULT_LIMIT_MS))) / 1000
    cmd = cmd or [_python(), "-X", "utf8", str(d / "solution.py")]
    results = []
    if not cases:  # a scratch run: just run it once
        cases = [{"stdin": spec.get("stdin", ""), "expected_stdout": None}]
    for i, case in enumerate(cases):
        c0 = time.perf_counter()
        try:
            p = subprocess.run(cmd, cwd=d, input=case.get("stdin", ""),
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=case.get("time_limit_ms", per * 1000) / 1000, env=_clean_env())
        except subprocess.TimeoutExpired:
            results.append({"i": i, "status": "timeout"})
            results += [{"i": j, "status": "skipped"} for j in range(i + 1, len(cases))]
            break
        ms = round((time.perf_counter() - c0) * 1000, 1)
        got = p.stdout
        r: dict[str, Any] = {"i": i, "ms": ms, "stdout": got[-4000:]}
        if p.returncode != 0 and src_name != "solution.py":
            r.update(status="error", error=_crash_text(p.returncode, p.stderr), line=_java_line(p.stderr, src_name))
            results.append(r)
            continue
        if p.returncode != 0:
            err = (p.stderr.strip().splitlines() or ["error"])[-1]
            line = None
            for ln in p.stderr.splitlines():
                if 'solution.py", line ' in ln:
                    try:
                        line = int(ln.split('line ')[1].split(",")[0])
                    except (IndexError, ValueError):
                        pass
            if "SyntaxError" in p.stderr or "IndentationError" in p.stderr:
                return {"results": [], "compile_error": err, "line": line, "stdout": "", "ms": round((time.perf_counter() - t0) * 1000)}
            r.update(status="error", error=err[:400], line=line)
        elif case.get("expected_stdout") is None:
            r["status"] = "ran"
        else:
            norm = lambda s: "\n".join(x.rstrip() for x in s.strip().splitlines())
            r["status"] = "pass" if norm(got) == norm(case["expected_stdout"]) else "fail"
            r["got"] = got[-600:]
        results.append(r)
    return {"results": results, "stdout": "", "ms": round((time.perf_counter() - t0) * 1000)}


# ================================================================ every language
import re  # noqa: E402

import toolchains  # noqa: E402

HARNESS_DIR = Path(__file__).with_name("harness")


def run(language: str, code: str, spec: dict) -> dict:
    """Run code in any language Chalk supports. If its compiler isn't set up: {"missing": language}."""
    if language == "python":
        return run_python(code, spec)
    if language == "sql":
        return run_sql(code, spec)
    if language == "java":
        return run_java(code, spec)
    if language == "c":
        return run_c(code, spec)
    raise ValueError(f"Chalk can't run {language} here")


# ---------------------------------------------------------------- comparing (the same rules for every language)
def _plain(v):
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _plain(x) for k, x in v.items()}
    return v


def _eq(a, b) -> bool:
    """Equality where 3 == 3.0 (Java and C print doubles) but True is never 1."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_eq(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_eq(a[k], b[k]) for k in a)
    return a == b


def same(got, want, how: str = "exact") -> bool:
    import math
    got, want = _plain(got), _plain(want)
    if how == "approx":
        num = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool)
        if num(got) and num(want):
            return math.isclose(got, want, rel_tol=1e-6, abs_tol=1e-9)
        if isinstance(got, list) and isinstance(want, list):
            return len(got) == len(want) and all(same(a, b, "approx") for a, b in zip(got, want))
        return _eq(got, want)
    key = lambda x: json.dumps(x, sort_keys=True, default=str)
    if how == "unordered" and isinstance(got, list) and isinstance(want, list):
        return len(got) == len(want) and sorted(map(key, got)) == sorted(map(key, want))
    if how == "unordered_nested" and isinstance(got, list) and isinstance(want, list):
        norm = lambda l: sorted(key(sorted(x, key=key)) if isinstance(x, list) else key(x) for x in l)
        return norm(got) == norm(want)
    return _eq(got, want)


def _short(v, n=600) -> str:
    try:
        s = json.dumps(v, ensure_ascii=False)
    except (TypeError, ValueError):
        s = repr(v)
    return s if len(s) <= n else s[:n] + "…"


def _judge(spec: dict, cases: list[dict], raw: list[dict]) -> list[dict]:
    """Turn {"status": "ok", "value": ...} from a harness into pass/fail against each case."""
    out = []
    for r in raw:
        i = r.get("i")
        if r.get("status") != "ok" or i is None or i >= len(cases):
            out.append(r)
            continue
        c = cases[i]
        how = c.get("compare") or spec.get("compare") or "exact"
        val = r.get("value")
        res = {k: v for k, v in r.items() if k not in ("value", "args")}
        if spec.get("kind") == "class":
            want = c.get("expected", [])
            bad = next((k for k, (g, w) in enumerate(zip(val or [], want)) if k > 0 and not same(g, w, how)), None)
            if bad is None and len(val or []) != len(want):
                bad = min(len(val or []), len(want))
            res.update(status="pass" if bad is None else "fail", got=_short(val), bad_call=bad)
        else:
            ok = True
            if "expected" in c:
                ok = same(val, c["expected"], how)
            for k, want in (c.get("expected_args") or {}).items():
                if not same((r.get("args") or {}).get(str(k)), want, how):
                    ok = False
            got = _short(val) if not c.get("expected_args") else _short({"returned": val, **{f"argument {int(k) + 1} afterwards": v for k, v in (r.get("args") or {}).items()}})
            res.update(status="pass" if ok else "fail", got=got)
        out.append(res)
    return out


def _crash_text(code: int, stderr: str) -> str:
    if code in (3221225477, -11, 139):
        return "Crashed: segmentation fault (it read or wrote memory it shouldn't: an index out of range, or a NULL pointer?)"
    if code in (3221225725, -6):
        return "Crashed: stack overflow or abort (does your recursion stop?)"
    if code == 3221225620 or code == -8:
        return "Crashed: arithmetic error (division by zero?)"
    tail = [ln for ln in stderr.strip().splitlines() if ln.strip() and not ln.startswith("Picked up")]
    for ln in tail:
        if re.match(r"^(Exception in thread|\w+(\.\w+)*(Exception|Error))", ln):
            return ln.replace('Exception in thread "main" ', "")[:300]
    return (tail[-1][:300] if tail else f"Exited with code {code}")


def _java_line(stderr: str, src: str) -> int | None:
    m = re.search(rf"\({re.escape(src)}:(\d+)\)", stderr)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------- SQL (SQLite)
def _sql_statements(code: str) -> list[str]:
    import sqlite3
    out, buf = [], ""
    for line in code.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            if buf.strip().strip(";").strip():
                out.append(buf)
            buf = ""
    if buf.strip():
        out.append(buf)  # a last statement without its semicolon
    return out


def run_sql(code: str, spec: dict) -> dict:
    """Each case builds the tables (schema, then the case's own setup data), runs the student's SQL,
    and compares the rows of the last query (or of the case's "check" query, for UPDATE/INSERT
    exercises). Row order only matters when "ordered" is set."""
    import sqlite3
    t0 = time.perf_counter()
    cases = list(spec.get("cases", []))[:MAX_CASES]
    stmts = _sql_statements(code)
    if not stmts:
        return {"results": [], "compile_error": "Write a query first.", "stdout": "", "ms": 0}
    results = []
    limit = spec.get("time_limit_ms", DEFAULT_LIMIT_MS) / 1000
    for i, c in enumerate(cases):
        con = sqlite3.connect(":memory:")
        deadline = time.perf_counter() + c.get("time_limit_ms", limit * 1000) / 1000
        con.set_progress_handler(lambda: 1 if time.perf_counter() > deadline else 0, 2000)
        r: dict[str, Any] = {"i": i}
        c0 = time.perf_counter()
        try:
            con.executescript(spec.get("schema", ""))
            if c.get("setup"):
                con.executescript(c["setup"])
        except sqlite3.Error as e:
            r.update(status="error", error=f"The exercise's own data didn't load ({e}). Ask Claude to fix the exercise.")
            results.append(r); con.close(); continue
        try:
            cur = None
            for st in stmts:
                cur = con.execute(st)
            if c.get("check"):
                cur = con.execute(c["check"])
            cols = [d[0] for d in cur.description] if cur is not None and cur.description else []
            rows = [list(x) for x in cur.fetchall()] if cols else []
            r["ms"] = round((time.perf_counter() - c0) * 1000, 1)
            want = c.get("expected", [])
            how = "approx" if any(isinstance(v, float) for row in rows for v in row) else "exact"
            ordered = c.get("ordered", spec.get("ordered", False))
            ok = (same(rows, want, how) if ordered else
                  len(rows) == len(want) and sorted(map(lambda x: json.dumps(x, default=str), rows)) == sorted(map(lambda x: json.dumps(x, default=str), want))
                  if how == "exact" else same(sorted(rows, key=str), sorted(want, key=str), "approx"))
            if not cols and want:
                r.update(status="fail", got="(your SQL didn't return any rows: is the last statement a SELECT?)")
            else:
                r.update(status="pass" if ok else "fail", got=_short({"columns": cols, "rows": rows[:12], **({"more": len(rows) - 12} if len(rows) > 12 else {})}))
        except sqlite3.OperationalError as e:
            if "interrupted" in str(e):
                r.update(status="timeout")
            else:
                r.update(status="error", error=f"SQL error: {e}")
        except sqlite3.Error as e:
            r.update(status="error", error=f"SQL error: {e}")
        finally:
            con.close()
        results.append(r)
    return {"results": results, "stdout": "", "ms": round((time.perf_counter() - t0) * 1000)}


# ---------------------------------------------------------------- Java
def _java_names(code: str) -> tuple[str | None, str | None]:
    """(the class the file must be named after, the class with main)."""
    pub = re.search(r"\bpublic\s+(?:final\s+|abstract\s+)*class\s+(\w+)", code)
    classes = [(m.start(), m.group(1)) for m in re.finditer(r"\bclass\s+(\w+)", code)]
    main_at = code.find("static void main")
    main_cls = None
    if main_at >= 0:
        before = [n for at, n in classes if at < main_at]
        main_cls = before[-1] if before else None
    return (pub.group(1) if pub else (classes[0][1] if classes else None)), main_cls


def _compile_errors(text: str, src: str) -> tuple[str, int | None]:
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.startswith("Picked up")]
    for k, ln in enumerate(lines):
        m = re.match(rf".*?{re.escape(src)}:(\d+)(?::\d+)?:\s*(?:fatal\s+)?error:\s*(.*)", ln)
        if m:
            extra = [x.strip() for x in lines[k + 1:k + 4] if x.strip().startswith(("symbol", "location", "required", "found", "reason"))]
            return ("; ".join([m.group(2).strip(), *extra]))[:400], int(m.group(1))
    for ln in lines:
        if "error" in ln.lower():
            return ln.strip()[:400], None
    return (lines[-1].strip()[:400] if lines else "It didn't compile."), None


def run_java(code: str, spec: dict) -> dict:
    jdk = toolchains.java()
    if not jdk:
        return {"missing": "java", "results": [], "stdout": "", "ms": 0}
    t0 = time.perf_counter()
    kind = spec.get("kind", "function")
    file_cls, main_cls = _java_names(code)
    if not file_cls:
        return {"results": [], "compile_error": "Couldn't find a class in your code.", "stdout": "", "ms": 0}
    src = f"{file_cls}.java"
    cases = list(spec.get("cases", []))[:MAX_CASES]
    with tempfile.TemporaryDirectory(prefix="chalk-run-") as d:
        dd = Path(d)
        (dd / src).write_text(code, "utf-8")
        out = dd / "out"
        out.mkdir()
        files = [str(dd / src)]
        if kind != "program":
            shutil_copy(HARNESS_DIR / "ChalkHarness.java", dd / "ChalkHarness.java")
            files.append(str(dd / "ChalkHarness.java"))
        try:
            p = subprocess.run([jdk["javac"], "-encoding", "UTF-8", "-nowarn", "-d", str(out), *files], cwd=d, capture_output=True,
                               text=True, encoding="utf-8", errors="replace", timeout=90, env=_clean_env())
        except subprocess.TimeoutExpired:
            return {"results": [], "compile_error": "Compiling took too long.", "stdout": "", "ms": 0}
        if p.returncode != 0:
            msg, line = _compile_errors(p.stderr + p.stdout, src)
            return {"results": [], "compile_error": msg, "line": line, "stdout": "", "ms": round((time.perf_counter() - t0) * 1000)}
        java_cmd = [jdk["java"], "-Xshare:auto", "-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-cp", str(out)]
        if kind == "program":
            if not main_cls:
                return {"results": [], "compile_error": "Your program needs a main method: public static void main(String[] args).", "stdout": "", "ms": 0}
            return _run_program(dd, cases, {**spec, "time_limit_ms": spec.get("time_limit_ms", DEFAULT_LIMIT_MS) + 600}, t0, cmd=[*java_cmd, main_cls], src_name=src)
        target = spec.get("class") if kind == "class" else (spec.get("class_name") or file_cls)
        (dd / "spec.json").write_text(json.dumps({**spec, "cases": cases, "class_name": target}), "utf-8")
        per = max(100, int(spec.get("time_limit_ms", DEFAULT_LIMIT_MS)))
        try:
            p = subprocess.run([*java_cmd, "ChalkHarness", str(dd / "spec.json"), target], cwd=d, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=per * max(1, len(cases)) / 1000 + 15, env=_clean_env())
            lines, stderr = p.stdout.splitlines(), p.stderr
        except subprocess.TimeoutExpired as e:
            lines, stderr = (e.stdout or "").splitlines() if isinstance(e.stdout, str) else [], "timed out"
    return _collect(lines, stderr, spec, cases, t0, src)


def _collect(lines: list[str], stderr: str, spec: dict, cases: list[dict], t0: float, src: str) -> dict:
    raw: list[dict] = []
    out: dict[str, Any] = {"stdout": "", "ms": 0}
    for ln in lines:
        try:
            ev = json.loads(ln)
        except ValueError:
            continue
        if "compile_error" in ev:
            out["compile_error"] = ev["compile_error"]
        elif ev.get("loaded"):
            out["stdout"] = ev.get("stdout", "")
        elif "i" in ev:
            raw.append(ev)
    results = _judge(spec, cases, raw)
    seen = {r["i"] for r in results}
    if not results and "compile_error" not in out:
        out["compile_error"] = "Your code didn't run: " + _crash_text(1, stderr)
    for i in range(len(cases)):
        if i not in seen and "compile_error" not in out:
            results.append({"i": i, "status": "skipped"})
    results.sort(key=lambda r: r["i"])
    out["results"] = results
    out["ms"] = round((time.perf_counter() - t0) * 1000)
    return out


def shutil_copy(a: Path, b: Path) -> None:
    b.write_bytes(a.read_bytes())


# ---------------------------------------------------------------- C
_C_INT = {"int", "long", "long long", "short", "long int", "long long int", "short int", "signed", "signed int",
          "unsigned", "unsigned int", "unsigned long", "unsigned long long", "size_t", "char", "unsigned char",
          "float", "double", "bool", "_Bool", "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t"}


def parse_c_signature(sig: str) -> dict:
    """"int two_sum(int *nums, int n, int target)" -> {"ret": "int", "name": "two_sum", "params": [...]}.
    Raises ValueError with a readable reason for anything the harness can't call."""
    s = re.sub(r"\s+", " ", sig.strip().rstrip(";").strip())
    m = re.match(r"^(.*?)\b([A-Za-z_]\w*)\s*\((.*)\)$", s)
    if not m:
        raise ValueError(f"couldn't read the signature {sig!r}")
    ret = m.group(1).strip()
    name = m.group(2)
    params = []
    body = m.group(3).strip()
    if body and body != "void":
        for k, raw in enumerate(body.split(",")):
            raw = raw.strip()
            pm = re.match(r"^(const\s+)?(.*?)\s*(\*?)\s*([A-Za-z_]\w*)?\s*(\[\s*\d*\s*\])?$", raw)
            if not pm:
                raise ValueError(f"couldn't read the parameter {raw!r}")
            const, base, star, pname, arr = pm.groups()
            base = base.replace("const", "").strip()
            pointer = bool(star) or bool(arr)
            if base not in _C_INT:
                raise ValueError(f"the parameter type {raw!r} isn't supported (use numbers, char, bool, strings or 1-D arrays)")
            kind = "string" if base == "char" and pointer else "array" if pointer else "scalar"
            params.append({"type": base, "kind": kind, "const": bool(const), "name": pname or f"p{k}"})
    ret_ptr = ret.endswith("*")
    rbase = ret.rstrip("*").replace("const", "").strip()
    if ret_ptr and rbase != "char":
        raise ValueError("functions returning arrays (pointers) can't be checked: return a value, fill an output array, or print")
    if rbase not in _C_INT and rbase != "void":
        raise ValueError(f"the return type {ret!r} isn't supported")
    return {"ret": "string" if ret_ptr else rbase, "name": name, "params": params}


def _c_str(s: str) -> str:
    """A C string literal for any text (UTF-8 bytes; hex escapes end the literal so digits can follow)."""
    out = []
    for byte in s.encode("utf-8"):
        ch = chr(byte)
        if ch in '"\\':
            out.append("\\" + ch)
        elif 32 <= byte < 127:
            out.append(ch)
        else:
            out.append(f'\\x{byte:02x}""')
    return '"' + "".join(out) + '"'


def _c_val(v, base: str) -> str:
    if base in ("float", "double"):
        return repr(float(v or 0))
    if base in ("bool", "_Bool"):
        return "1" if v else "0"
    if base == "char" and isinstance(v, str):
        return str(ord(v[0])) if v else "0"
    return str(int(v or 0)) + ("LL" if abs(int(v or 0)) > 2**31 - 1 else "")


def _c_harness(sig: dict, cases: list[dict], signature: str = "") -> str:
    """A main() that runs case argv[1]: build the arguments, call, print the result as JSON."""
    fmt = {"float": "d", "double": "d", "bool": "b", "_Bool": "b", "char": "c", "string": "s", "void": "v"}
    def printer(expr: str, base: str) -> str:
        k = fmt.get(base, "i" if not base.startswith(("unsigned", "uint", "size_t")) else "u")
        return {"d": f"chalk_num({expr});", "b": f"fputs(({expr}) ? \"true\" : \"false\", stdout);", "c": f"chalk_char({expr});",
                "s": f"chalk_str({expr});", "v": 'fputs("null", stdout);', "i": f"printf(\"%lld\", (long long)({expr}));",
                "u": f"printf(\"%llu\", (unsigned long long)({expr}));"}[k]
    blocks = []
    for i, c in enumerate(cases):
        args = c.get("args", [])
        decl, call, after = [], [], []
        for k, (pa, v) in enumerate(zip(sig["params"], args)):
            t = pa["type"]
            if pa["kind"] == "string":
                if v is None:
                    call.append("NULL")
                else:
                    decl.append(f"char a{k}[] = {_c_str(str(v))};")
                    call.append(f"a{k}")
                    after.append((k, f"chalk_str(a{k});"))
            elif pa["kind"] == "array":
                vals = list(v or [])
                decl.append(f"{t} a{k}[{max(1, len(vals))}] = {{{', '.join(_c_val(x, t) for x in vals) or '0'}}};")
                call.append(f"a{k}")
                loop = f"fputc('[', stdout); for (int j = 0; j < {len(vals)}; j++) {{ if (j) fputc(',', stdout); {printer(f'a{k}[j]', t)} }} fputc(']', stdout);"
                after.append((k, loop))
            else:
                call.append(_c_val(v, t))
        ret = sig["ret"]
        call_s = f"{sig['name']}({', '.join(call)})"
        body = [*decl]
        if ret == "void":
            body.append(f"{call_s};")
        else:
            rt = "char *" if ret == "string" else ret
            body.append(f"{rt} r = {call_s};")
        body.append("fflush(stdout); fputs(\"\\n\\x1e\" \"CHALK\\x1e\", stdout);")
        body.append('fputs("{\\"value\\":", stdout);')
        body.append(printer("r", ret) if ret != "void" else 'fputs("null", stdout);')
        if after:
            body.append('fputs(",\\"args\\":{", stdout);')
            for n, (k, pr) in enumerate(after):
                body.append(f'fputs("{"," if n else ""}\\"{k}\\":", stdout); {pr}')
            body.append("fputc('}', stdout);")
        body.append('fputs("}\\n", stdout);')
        blocks.append(f"    case {i}: {{\n      " + "\n      ".join(body) + "\n      break;\n    }")
    return f"""#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdbool.h>
#include "solution.c"
#undef main
static void chalk_str(const char *s) {{
  if (!s) {{ fputs("null", stdout); return; }}
  fputc('"', stdout);
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {{
    if (*p == '"' || *p == '\\\\') {{ fputc('\\\\', stdout); fputc(*p, stdout); }}
    else if (*p == '\\n') fputs("\\\\n", stdout);
    else if (*p < 32) printf("\\\\u%04x", *p);
    else fputc(*p, stdout);
  }}
  fputc('"', stdout);
}}
static void chalk_char(char c) {{ char s[2] = {{c, 0}}; chalk_str(s); }}
static void chalk_num(double d) {{ if (d != d || d > 1e308 || d < -1e308) fputs("null", stdout); else printf("%.17g", d); }}
int main(int argc, char **argv) {{
  int which = argc > 1 ? atoi(argv[1]) : 0;
  switch (which) {{
{chr(10).join(blocks)}
  }}
  return 0;
}}
"""


def run_c(code: str, spec: dict) -> dict:
    tc = toolchains.cc()
    if not tc:
        return {"missing": "c", "results": [], "stdout": "", "ms": 0}
    t0 = time.perf_counter()
    kind = spec.get("kind", "function")
    cases = list(spec.get("cases", []))[:MAX_CASES]
    with tempfile.TemporaryDirectory(prefix="chalk-run-") as d:
        dd = Path(d)
        (dd / "solution.c").write_text(code, "utf-8")
        exe = dd / ("prog.exe" if toolchains.WIN else "prog")
        if kind == "program":
            src = dd / "solution.c"
            defs: list[str] = []
        else:
            try:
                sig = parse_c_signature(spec.get("signature", ""))
            except ValueError as e:
                return {"results": [], "compile_error": f"The exercise's signature can't be tested: {e}", "stdout": "", "ms": 0}
            (dd / "harness.c").write_text(_c_harness(sig, cases, spec.get("signature", "")), "utf-8")
            src = dd / "harness.c"
            defs = ["-Dmain=chalk_student_main"]
        if tc["kind"] == "tcc":
            cmd = [tc["cc"], *defs, "-o", str(exe), str(src)]
        else:
            # Arguments of the wrong type are errors (not silent nonsense); everything else stays quiet.
            strict = ["-Werror=incompatible-pointer-types", "-Werror=int-conversion"] if kind != "program" else []
            cmd = [tc["cc"], "-std=c11", "-O1", *strict, "-fno-diagnostics-color", *defs, "-o", str(exe), str(src), "-lm"]
        try:
            p = subprocess.run(cmd, cwd=d, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, env=_clean_env())
        except subprocess.TimeoutExpired:
            return {"results": [], "compile_error": "Compiling took too long.", "stdout": "", "ms": 0}
        if p.returncode != 0 or not exe.exists():
            text = p.stderr + p.stdout
            msg, line = _compile_errors(text, "solution.c")
            if line is None and "harness.c" in text:
                hm, _ = _compile_errors(text, "harness.c")
                msg = f"Your function doesn't match what the exercise expects ({spec.get('signature', '')}): {hm}"
            return {"results": [], "compile_error": msg, "line": line, "stdout": "", "ms": round((time.perf_counter() - t0) * 1000)}
        if kind == "program":
            return _run_program(dd, cases, spec, t0, cmd=[str(exe)], src_name="solution.c")
        per = max(100, int(spec.get("time_limit_ms", DEFAULT_LIMIT_MS))) / 1000
        raw: list[dict] = []
        for i, c in enumerate(cases):
            c0 = time.perf_counter()
            try:
                q = subprocess.run([str(exe), str(i)], cwd=d, capture_output=True, timeout=c.get("time_limit_ms", per * 1000) / 1000, env=_clean_env())
            except subprocess.TimeoutExpired:
                raw.append({"i": i, "status": "timeout"})
                raw += [{"i": j, "status": "skipped"} for j in range(i + 1, len(cases))]
                break
            text = q.stdout.decode("utf-8", "replace")
            r: dict[str, Any] = {"i": i, "ms": round((time.perf_counter() - c0) * 1000, 1)}
            if "\x1eCHALK\x1e" in text:
                printed, _, tail = text.partition("\n\x1eCHALK\x1e")
                r["stdout"] = printed[-2000:]
                try:
                    r.update(json.loads(tail.strip().splitlines()[0]))
                    r["status"] = "ok"
                except (ValueError, IndexError):
                    r.update(status="error", error="Chalk couldn't read the result")
            else:
                r.update(status="error", error=_crash_text(q.returncode, q.stderr.decode("utf-8", "replace")), stdout=text[-2000:])
            raw.append(r)
    out = {"results": _judge(spec, cases, raw), "stdout": "", "ms": round((time.perf_counter() - t0) * 1000)}
    return out
