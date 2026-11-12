import json
import pytest
import exercises
import runner
import toolchains


def fresh(m):
    return exercises.clean(json.loads(json.dumps(m)))


@pytest.mark.parametrize("lang", ["java", "c", "sql"])
def test_mock_cleans(lang):
    ex = fresh(exercises.MOCKS[lang])
    assert ex and ex["language"] == lang
    s = exercises.spec(ex)
    if lang == "c":
        assert s["signature"].startswith("void reverse") and ex["function"] == "reverse"
    if lang == "java":
        assert s["class_name"] == "Solution" and s["function"] == "secondLargest"
    if lang == "sql":
        assert ex["kind"] == "query" and "CREATE TABLE" in s["schema"] and s["cases"][2]["setup"]


def have(lang):
    return {"java": toolchains.java, "c": toolchains.cc}.get(lang, lambda: True)()


@pytest.mark.parametrize("lang", ["java", "c", "sql"])
def test_mock_solution_passes_everything(lang):
    if not have(lang):
        pytest.skip(f"no {lang}")
    ex = fresh(exercises.MOCKS[lang])
    rep = exercises.verify(ex)
    assert rep["checked"] and rep["dropped"] == [], rep
    r = runner.run(lang, ex["solution"], exercises.spec(ex))
    assert all(x["status"] == "pass" for x in r["results"]), r


@pytest.mark.parametrize("lang", ["java", "c", "sql"])
def test_starter_fails_an_edge_case_with_hidden_details(lang):
    if not have(lang):
        pytest.skip(f"no {lang}")
    ex = fresh(exercises.MOCKS[lang])
    r = runner.run(lang, ex["starter"] if lang != "sql" else "SELECT name, 0 FROM courses;", exercises.spec(ex))
    shaped = exercises.shape_results(ex, r, set())
    assert any(e["status"] != "pass" for e in shaped["edge_cases"])
    for e in shaped["edge_cases"]:
        assert "expected" not in e and "expected_args" not in e and "setup" not in e


def test_verify_drops_wrong_sql_case():
    d = json.loads(json.dumps(exercises.MOCK_SQL))
    d["edge_cases"].append({"expected": [["nonsense"]], "nudge": "bad"})
    ex = fresh(d)
    rep = exercises.verify(ex)
    assert rep["dropped"] and len(ex["edge_cases"]) == 2


def test_language_aliases_and_c_signature_from_starter():
    ex = exercises.clean({"title": "t", "language": "C11", "prompt": "p", "starter": "#include <string.h>\nint count_vowels(const char *s) {\n  return 0;\n}\n",
                          "examples": [{"args": ["hello"], "expected": 2}]})
    assert ex["language"] == "c" and ex["function"] == "count_vowels" and ex["signature"].startswith("int count_vowels")
    q = exercises.clean({"title": "q", "language": "postgres", "prompt": "p", "schema": "CREATE TABLE t(x);", "examples": [{"expected": [[1]]}]})
    assert q["language"] == "sql" and q["kind"] == "query"
    assert exercises.clean({"title": "q", "language": "sql", "prompt": "p", "examples": [{"expected": [[1]]}]}) is None  # no schema


def test_c_bad_signature_rejected():
    assert exercises.clean({"title": "t", "language": "c", "prompt": "p", "signature": "struct node *f(struct node *x)",
                            "examples": [{"args": [1], "expected": 1}]}) is None


def test_prompt_mentions_default_language():
    import tutor
    p = tutor._build_prompt("hi", "tutor", "", code_language="java")
    assert "default language is Java" in p
