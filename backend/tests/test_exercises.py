"""Coding exercises: reading them out of replies, checking Claude's tests, hiding the edge cases."""
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import exercises  # noqa: E402
import runner  # noqa: E402
import tutor  # noqa: E402

GOOD = exercises.MOCK["solution"]
# A typical first attempt: right on the examples, but slow, and returns [] instead of None.
NAIVE = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return []\n"


def fresh():
    return exercises.clean(copy.deepcopy(exercises.MOCK))


def test_extract_from_a_reply():
    body = json.dumps(exercises.MOCK)
    r = tutor._parse_reply(f"Try this.\n```chalk-exercise\n{body}\n```\n```json\n{{\"margin\": \"Go!\", \"say\": \"Your turn.\"}}\n```")
    ex = r["exercise"]
    assert ex["function"] == "two_sum" and len(ex["examples"]) == 2 and len(ex["edge_cases"]) == 5
    assert r["say"] == "Your turn." and "chalk-exercise" not in r.get("margin", "")


def test_exercise_alongside_a_script_and_with_latex_slips():
    body = json.dumps(exercises.MOCK).replace('"prompt": "', '"prompt": "Complexity $O(n)$, not $O(n^2)$ with \\\\sqrt{n} ')
    raw = body.replace("\\\\sqrt", "\\sqrt")  # an unescaped backslash, as models write it
    r = tutor._parse_reply(f"```chalk-exercise\n{raw}\n```\n```json\n{{\"margin\": \"m\"}}\n```\n```js\nsay('hi')\n```")
    assert r["exercise"]["title"] == "Two sum" and "\\sqrt{n}" in r["exercise"]["prompt"] and "say('hi')" in r["script"]


def test_cut_off_exercise_is_reported():
    r = tutor._parse_reply("```chalk-exercise\n" + json.dumps(exercises.MOCK)[:500])
    assert "exercise" not in r and "cut off" in r["exercise_error"]


def test_function_name_from_the_starter():
    d = {"title": "t", "starter": "def add(a, b):\n    pass", "examples": [{"args": [1, 2], "expected": 3}]}
    assert exercises.clean(d)["function"] == "add"
    d = {"title": "t", "language": "js", "starter": "function add(a, b) {}", "examples": [{"input": [1, 2], "output": 3}]}
    ex = exercises.clean(d)
    assert ex["language"] == "javascript" and ex["function"] == "add" and ex["examples"][0] == {"args": [1, 2], "expected": 3}


def test_no_tests_no_exercise():
    assert exercises.clean({"title": "t", "function": "f", "examples": []}) is None
    assert exercises.clean({"title": "t", "function": "1bad", "examples": [{"args": [], "expected": 1}]}) is None


def test_args_expr_is_python_only():
    d = {"language": "javascript", "function": "f", "examples": [{"args": [1], "expected": 1}],
         "edge_cases": [{"args_expr": "[list(range(9))]", "expected": 1, "nudge": "big"}]}
    assert exercises.clean(d)["edge_cases"] == []


def test_verify_drops_a_case_claude_got_wrong():
    ex = fresh()
    rep = exercises.verify(ex)
    assert rep["checked"] and rep["dropped"] == [("edge case", 3)]
    assert len(ex["edge_cases"]) == 4 and all(c["nudge"] != "deliberately wrong expected answer" for c in ex["edge_cases"])


def test_verify_without_a_solution_keeps_everything():
    ex = fresh(); ex.pop("solution")
    assert exercises.verify(ex) == {"checked": False, "dropped": []} and len(ex["edge_cases"]) == 5


def test_public_view_hides_solution_and_edge_cases():
    ex = fresh(); exercises.verify(ex)
    pub = exercises.public(ex)
    blob = json.dumps(pub)
    assert "solution" not in pub and "seen = {}" not in blob
    assert all(set(c) <= {"nudge", "revealed", "name"} for c in pub["edge_cases"])
    pub = exercises.public(ex, {0})
    assert pub["edge_cases"][0]["args"] == [[3, 3], 6] and pub["edge_cases"][1] == {"nudge": ex["edge_cases"][1]["nudge"], "revealed": False}


def test_naive_solution_passes_examples_but_edge_cases_nudge():
    ex = fresh(); exercises.verify(ex)
    run = runner.run_python(NAIVE, exercises.spec(ex))
    shaped = exercises.shape_results(ex, run, set())
    assert [e["status"] for e in shaped["examples"]] == ["pass", "pass"]
    edge = shaped["edge_cases"]
    # same values: fine; no pair: [] instead of None; negatives: fine; 200,000 numbers: too slow
    assert [e["status"] for e in edge] == ["pass", "fail", "pass", "timeout"]
    assert edge[1]["nudge"] == "What should happen when no two numbers add up to the target?" and "args" not in edge[1] and "got" not in edge[1]


def test_good_solution_passes_everything():
    ex = fresh(); exercises.verify(ex)
    shaped = exercises.shape_results(ex, runner.run_python(GOOD, exercises.spec(ex)), set())
    assert all(e["status"] == "pass" for e in shaped["examples"] + shaped["edge_cases"])


def test_revealed_case_shows_details_and_why():
    ex = fresh(); exercises.verify(ex)
    shaped = exercises.shape_results(ex, runner.run_python(NAIVE, exercises.spec(ex)), {1, 3})
    e1, e3 = shaped["edge_cases"][1], shaped["edge_cases"][3]
    assert e1["args"] == [[1, 2], 7] and e1["got"] == "[]" and e1["why"].startswith("The function has to return None")
    assert e3["args_note"] == "a very large input" and e3["status"] == "timeout"


def test_class_and_program_exercises():
    cls = exercises.clean({"title": "Stack", "kind": "class", "class": "MinStack", "examples": [{"calls": [["MinStack", []], ["push", [3]], ["get_min", []]], "expected": [None, None, 3]}]})
    assert cls["kind"] == "class" and cls["examples"][0]["calls"][1] == ["push", [3]]
    prog = exercises.clean({"title": "Sum", "examples": [{"stdin": "1\n2\n", "expected_stdout": "3"}]})
    assert prog["kind"] == "program"


def test_prompt_wants_edge_cases_and_nudges():
    p = exercises.PROMPT
    assert "Think adversarially" in p and '"nudge"' in p and "without saying how to fix it" in p and '"solution"' in p
