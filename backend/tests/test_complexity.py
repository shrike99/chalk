"""The complexity check: predicting, then measuring how a passing solution's time grows."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import complexity  # noqa: E402
import exercises  # noqa: E402
import toolchains  # noqa: E402

NAIVE = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return None\n"
SORTED = ("def two_sum(nums, target):\n    s = sorted(range(len(nums)), key=lambda i: nums[i])\n    i, j = 0, len(s) - 1\n    while i < j:\n"
          "        t = nums[s[i]] + nums[s[j]]\n        if t == target:\n            return [s[i], s[j]]\n        if t < target:\n            i += 1\n"
          "        else:\n            j -= 1\n    return None\n")


def fresh(m):
    return exercises.clean(json.loads(json.dumps(m)))


@pytest.mark.parametrize("text,band", [("O(1)", 0), ("O(log n)", 0), ("O(log(n))", 0), ("O(n)", 1), ("O(n log n)", 1), ("O(V + E)", 1),
                                       ("O(n^2)", 2), ("O(n²)", 2), ("O(n*m)", 2), ("O(n³)", 3), ("O(2^n)", 4), ("O(n!)", 4), ("", None)])
def test_band_of(text, band):
    assert complexity.band_of(text) == band


def test_spec_is_kept_hidden_and_validated():
    ex = fresh(exercises.MOCK)
    assert ex["complexity"]["time"] == "O(n)" and ex["complexity"]["sizes"] == [500, 1000, 2000, 4000]
    pub = exercises.public(ex)
    assert "complexity" not in pub and pub["complexity_check"] is True
    bad = fresh({**exercises.MOCK, "complexity": {"time": "O(n)", "args_expr": "[[], 0]", "sizes": [10, 5, 20]}})
    assert "sizes" not in bad["complexity"] and exercises.public(bad)["complexity_check"] is False
    sql = fresh({**exercises.MOCK_SQL, "complexity": {"time": "O(n)"}})
    assert "complexity" not in sql


def test_analyse_bands_from_timings():
    ex = fresh(exercises.MOCK)
    sizes = [1000, 2000, 4000, 8000]
    quad = {"best": {0: 0.1, 1000: 4.1, 2000: 16.1, 4000: 64.1, 8000: 256.1}, "timeouts": set(), "error": None}
    a = complexity.analyse(ex, sizes, quad, "O(n)")
    assert a["band"] == 2 and a["per_doubling"] == 4.0 and a["can_beat"] and a["target"] == "O(n)"
    assert a["prediction_right"] is False and "why" not in a          # the better idea stays hidden until they get there
    lin = {"best": {0: 0.0, 1000: 1.0, 2000: 2.1, 4000: 4.0, 8000: 8.2}, "timeouts": set(), "error": None}
    a = complexity.analyse(ex, sizes, lin, "O(n)")
    assert a["band"] == 1 and not a["can_beat"] and a["prediction_right"] and a["why"].startswith("One pass")
    # ran out of time at 4000 after 100 ms at 2000: at least as steep as that
    slow = {"best": {0: 0.0, 1000: 25.0, 2000: 100.0}, "timeouts": {4000}, "error": None, "limit_ms": 1500}
    a = complexity.analyse(ex, sizes, slow)
    assert a["band"] >= 2 and a["points"][2] == {"n": 4000, "ms": None, "timeout": True}
    a = complexity.analyse(ex, sizes, {"best": {0: 0.0}, "timeouts": {1000}, "error": None})
    assert a["too_slow"] and a["can_beat"]


def test_collect_takes_the_fastest_round():
    res = [{"status": "fail", "ms": m} for m in (0.1, 5, 20, 0.1, 4, 25)]
    t = complexity.collect([100, 200], res)
    assert t["best"] == {0: 0.1, 100: 4, 200: 20}


def test_python_naive_vs_one_pass():
    ex = fresh(exercises.MOCK)
    slow = complexity.measure(ex, NAIVE, "O(n)")
    assert slow["band"] == 2 and slow["can_beat"] and not slow["prediction_right"]
    fast = complexity.measure(ex, ex["solution"], "O(n)")
    assert fast["band"] == 1 and not fast["can_beat"] and fast["prediction_right"] and fast["why"]
    assert all(p["ms"] is not None for p in fast["points"])
    srt = complexity.measure(ex, SORTED, "O(n log n)")
    assert srt["band"] == 1          # n log n and n look alike to a stopwatch: both count as reaching the target


def test_crash_on_big_inputs_is_reported():
    ex = fresh(exercises.MOCK)
    a = complexity.measure(ex, "def two_sum(nums, target):\n    if len(nums) > 100:\n        raise ValueError('too big')\n    return None\n")
    assert "crashed" in a["error"] and "too big" in a["error"]


@pytest.mark.skipif(not toolchains.java(), reason="no Java")
def test_java_measures():
    ex = fresh(exercises.MOCK_JAVA)
    a = complexity.measure(ex, ex["solution"])
    assert a["band"] == 1 and not a["can_beat"]


@pytest.mark.skipif(not toolchains.cc(), reason="no C compiler")
def test_c_measures_in_place_quadratic():
    ex = fresh({**exercises.MOCK_C, "complexity": {"time": "O(n)", "args_expr": "[list(range(n)), n]", "sizes": [25000, 50000, 100000, 200000]}})
    bad = "void reverse(int *a, int n) {\n  for (int k = 0; k < n; k++) { int last = a[n-1]; for (int j = n-1; j > k; j--) a[j] = a[j-1]; a[k] = last; }\n}\n"
    a = complexity.measure(ex, bad)
    assert a["band"] == 2 and a["can_beat"]


def test_context_line_for_claude():
    line = complexity.context_line({"result": {"prediction": "O(n)", "label": "quadratic", "big_o": "O(n²)", "per_doubling": 4.0,
                                               "target": "O(n)", "can_beat": True}})
    assert "predicted O(n)" in line and "quadratic" in line and "haven't reached it" in line and "don't name the technique" in line


def test_review_is_cleaned_and_kept_to_the_code():
    r = complexity.clean_review({"time": "O(n²)", "space": "O(1)", "line": "4", "because": "x" * 2000, "extra": 1}, code_lines=6)
    assert r == {"time": "O(n²)", "space": "O(1)", "line": 4, "because": "x" * 900, "band": 2}
    assert "line" not in complexity.clean_review({"time": "O(n)", "line": 40}, code_lines=6)
    assert complexity.clean_review({"space": "O(1)"}, 6) is None


def test_review_context_numbers_the_code_and_gives_the_timing():
    ex = fresh(exercises.MOCK)
    ctx = complexity.review_context(ex, NAIVE, {"result": {"points": [{"n": 500, "ms": 5.0}, {"n": 1000, "ms": 20.0}, {"n": 2000, "ms": None, "timeout": True}],
                                                         "per_doubling": 4.0, "label": "quadratic"}})
    assert "  3 |         for j in range(i + 1, len(nums)):" in ctx
    assert "n=1000: 20.0 ms" in ctx and "n=2000: too slow" in ctx and "×4.0 per doubling" in ctx and "complexity_review" in ctx
    assert "complexity_review" in exercises.PROMPT and "Don't describe a faster" in exercises.PROMPT


def test_review_reaches_the_reply():
    import tutor
    text = ('```json\n{"say": "It is quadratic.", "complexity_review": {"time": "O(n^2)", "space": "O(1)", "line": 3, "because": "nested"}}\n```')
    assert tutor._parse_reply(text)["complexity_review"]["line"] == 3
    mock = tutor._mock_review("Can you explain my code's complexity?\n\n```python\n" + NAIVE + "```")
    assert mock["complexity_review"]["time"] == "O(n²)" and mock["complexity_review"]["line"] == 3
