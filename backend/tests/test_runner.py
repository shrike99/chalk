"""Running student code against tests: right, wrong, crashing, hanging, printing, classes, programs."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runner import run_python  # noqa: E402

TWO_SUM = {"kind": "function", "function": "two_sum", "compare": "unordered", "cases": [
    {"args": [[2, 7, 11, 15], 9], "expected": [0, 1]},
    {"args": [[3, 3], 6], "expected": [0, 1]},
    {"args": [[1, 2], 7], "expected": None},
]}


def statuses(r):
    return [c["status"] for c in r["results"]]


def test_all_pass():
    code = "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return None\n"
    r = run_python(code, TWO_SUM)
    assert statuses(r) == ["pass", "pass", "pass"] and "compile_error" not in r


def test_wrong_answer_shows_what_came_back():
    code = "def two_sum(nums, target):\n    return [0, 0]\n"
    r = run_python(code, TWO_SUM)
    assert statuses(r) == ["fail", "fail", "fail"] and r["results"][0]["got"] == "[0, 0]"


def test_unordered_and_tuples():
    code = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i):\n            if nums[i] + nums[j] == target: return (i, j)\n"
    assert statuses(run_python(code, TWO_SUM)) == ["pass", "pass", "pass"]


def test_exception_points_at_the_students_line():
    code = "def two_sum(nums, target):\n    x = 1\n    return nums[99]\n"
    r = run_python(code, TWO_SUM)
    assert r["results"][0]["status"] == "error" and "IndexError" in r["results"][0]["error"] and r["results"][0]["line"] == 3


def test_syntax_error():
    r = run_python("def two_sum(nums, target)\n    return 1\n", TWO_SUM)
    assert "SyntaxError" in r["compile_error"] and r["line"] == 1 and r["results"] == []


def test_missing_function():
    r = run_python("def twosum(a, b):\n    return 1\n", TWO_SUM)
    assert "two_sum" in r["compile_error"]


def test_infinite_loop_times_out_but_earlier_results_survive():
    code = "def two_sum(nums, target):\n    if target == 6:\n        while True: pass\n    return [0, 1]\n"
    r = run_python(code, {**TWO_SUM, "time_limit_ms": 400})
    assert statuses(r) == ["pass", "timeout", "skipped"]


def test_too_slow_for_a_big_input():
    spec = {"kind": "function", "function": "has_dup", "time_limit_ms": 600, "cases": [
        {"args": [[1, 2, 1]], "expected": True},
        {"args_expr": "[list(range(40000))]", "expected": False},
    ]}
    slow = "def has_dup(a):\n    return any(a[i] == a[j] for i in range(len(a)) for j in range(i))\n"
    fast = "def has_dup(a):\n    return len(set(a)) != len(a)\n"
    assert statuses(run_python(slow, spec)) == ["pass", "timeout"]
    assert statuses(run_python(fast, spec)) == ["pass", "pass"]


def test_prints_are_captured_per_case():
    code = "print('loading')\ndef f(x):\n    print('got', x)\n    return x * 2\n"
    r = run_python(code, {"kind": "function", "function": "f", "cases": [{"args": [2], "expected": 4}, {"args": [5], "expected": 10}]})
    assert r["stdout"] == "loading\n" and r["results"][1]["stdout"] == "got 5\n"


def test_runaway_recursion():
    code = "def f(n):\n    return f(n + 1)\n"
    r = run_python(code, {"kind": "function", "function": "f", "cases": [{"args": [0], "expected": 1}]})
    assert r["results"][0]["status"] == "error" and "recursion" in r["results"][0]["error"]


def test_approx():
    code = "def mean(a):\n    return sum(a) / len(a)\n"
    spec = {"kind": "function", "function": "mean", "compare": "approx", "cases": [{"args": [[0.1, 0.2]], "expected": 0.15}]}
    assert statuses(run_python(code, spec)) == ["pass"]


def test_class_calls():
    spec = {"kind": "class", "class": "Counter", "cases": [
        {"calls": [["Counter", [5]], ["inc", []], ["inc", []], ["value", []]], "expected": [None, None, None, 7]},
        {"calls": [["Counter", [0]], ["value", []]], "expected": [None, 1]},
    ]}
    code = "class Counter:\n    def __init__(self, start):\n        self.v = start\n    def inc(self):\n        self.v += 1\n    def value(self):\n        return self.v\n"
    r = run_python(code, spec)
    assert statuses(r) == ["pass", "fail"] and r["results"][1]["bad_call"] == 1


def test_program_with_stdin():
    spec = {"kind": "program", "cases": [{"stdin": "3\n4\n", "expected_stdout": "7\n"}, {"stdin": "10\n-2\n", "expected_stdout": "8"}]}
    code = "a = int(input())\nb = int(input())\nprint(a + b)\n"
    assert statuses(run_python(code, spec)) == ["pass", "pass"]
    r = run_python("a = int(input())\nprint(a)\n", spec)
    assert statuses(r) == ["fail", "fail"]


def test_program_error_and_timeout():
    spec = {"kind": "program", "time_limit_ms": 500, "cases": [{"stdin": "x\n", "expected_stdout": "1"}, {"stdin": "", "expected_stdout": "1"}]}
    r = run_python("n = int(input())\nprint(n)\n", spec)
    assert r["results"][0]["status"] == "error" and "ValueError" in r["results"][0]["error"]
    r = run_python("while True: pass\n", spec)
    assert statuses(r) == ["timeout", "skipped"]


def test_scratch_run():
    r = run_python("print('hi')\n", {"kind": "script", "cases": []})
    assert r["results"][0]["status"] == "ran" and r["results"][0]["stdout"] == "hi\n"


def test_runs_in_an_empty_folder_and_cleans_up():
    import tempfile
    before = set(Path(tempfile.gettempdir()).glob("chalk-run-*"))
    r = run_python("import os\ndef f():\n    return os.listdir('.')\n", {"kind": "function", "function": "f", "cases": [{"args": [], "expected": []}]})
    assert r["results"][0]["got"] and "solution.py" in r["results"][0]["got"]  # only our own files there
    assert "spec.json" not in r["results"][0]["got"]                             # and not the hidden tests
    assert set(Path(tempfile.gettempdir()).glob("chalk-run-*")) == before
