"""Changing one question of a paper without rewriting it."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import docedit  # noqa: E402
import docs  # noqa: E402

PAPER = docs.clean(json.loads(json.dumps(docs.MOCK_PAPER)))


def ms(d):
    return [e["q"] for e in d.get("mark_scheme", [])]


def texts(d):
    return [q.get("text", "")[:20] for q in d["questions"]]


def test_extract_block_and_rest():
    text = 'Before\n```chalk-doc-edit\n{"doc": "abc", "ops": [{"op": "delete", "question": 2}]}\n```\n```json\n{"say": "done"}\n```'
    rest, edit, problem = docedit.extract(text)
    assert edit == {"doc": "abc", "ops": [{"op": "delete", "question": 2}]} and problem is None
    assert "chalk-doc-edit" not in rest and '"say": "done"' in rest
    _, edit, problem = docedit.extract('```chalk-doc-edit\n{"ops": [{"op": "set", "field": "time", "value": "$\\frac12$ hour"}]}\n```')
    assert edit["ops"][0]["value"] == "$\\frac12$ hour"   # LaTeX repaired as in chalk-doc
    _, edit, problem = docedit.extract('```chalk-doc-edit\n{"ops": [{"op": "set", "fie')
    assert edit is None and "cut off" in problem


def test_parse_ref():
    assert docedit.parse_ref("3(b)(ii)") == ("3", [1, 1])
    assert docedit.parse_ref("Q4") == ("4", [])
    assert docedit.parse_ref(7) == ("7", [])
    assert docedit.parse_ref("3bii") == ("3", [1, 1])
    assert docedit.parse_ref("2.3", "decimal") == ("2", [2])
    assert docedit.parse_ref("Question 5 (a)") == ("5", [0])
    assert docedit.parse_ref("General") == (None, [])


def test_replace_keeps_others_and_swaps_its_mark_scheme():
    new, changes, failed = docedit.apply(PAPER, {"ops": [{"op": "replace", "question": 2, "with": {"text": "Solve $x^2 = 49$.", "marks": 2},
                                                          "mark_scheme": [{"q": "", "answer": "$x = \\pm 7$", "marks": "2"}]}]})
    assert not failed and changes == ["Question 2 rewritten"]
    assert new["questions"][1]["text"] == "Solve $x^2 = 49$." and new["questions"][0] == PAPER["questions"][0]
    assert ms(new) == ms(PAPER)
    assert next(e for e in new["mark_scheme"] if e["q"] == "2")["answer"] == "$x = \\pm 7$"
    assert new["total_marks"] == PAPER["total_marks"] - 3 + 2


def test_delete_renumbers_mark_scheme():
    new, changes, failed = docedit.apply(PAPER, {"ops": [{"op": "delete", "question": 2}]})
    assert len(new["questions"]) == 5 and ms(new) == ["1", "2(a)", "2(b)", "2(c)", "3", "4", "5(a)", "5(b)"]
    assert new["mark_scheme"][1]["answer"] == PAPER["mark_scheme"][2]["answer"]   # old 3(a) is now 2(a)


def test_insert_after_and_before_with_relative_labels():
    new, changes, failed = docedit.apply(PAPER, {"ops": [
        {"op": "insert", "after": 1, "question": {"text": "Expand $(x+1)^2$.", "marks": 1}, "mark_scheme": [{"q": "", "answer": "$x^2+2x+1$"}]},
        {"op": "insert", "before": 1, "question": {"text": "Warm up", "parts": [{"text": "a", "marks": 1}, {"text": "b", "marks": 1}]},
         "mark_scheme": [{"q": "(a)", "answer": "A"}, {"q": "(b)", "answer": "B"}]},
    ]})
    assert not failed
    assert texts(new)[:3] == ["Warm up", "Factorise $x^2 + 7x ", "Expand $(x+1)^2$."]
    assert ms(new)[:5] == ["1(a)", "1(b)", "2", "3", "4"]
    assert new["mark_scheme"][3]["answer"] == "$x^2+2x+1$" and ms(new)[-1] == "8(b)"


def test_ops_use_numbers_from_before_the_edit():
    # delete 1 and replace 3 in one edit: "3" is still the graph question, not the one that slides into its place
    new, _, failed = docedit.apply(PAPER, {"ops": [{"op": "delete", "question": 1},
                                                   {"op": "replace", "question": 3, "with": {"text": "New graph question", "marks": 4}}]})
    assert not failed and texts(new)[:2] == ["Solve $x^2 - 5x + 6 ", "New graph question"]
    assert ms(new)[:4] == ["1", "2(a)", "2(b)", "2(c)"]   # no mark scheme given: the old entries follow it


def test_part_level_replace_and_delete():
    new, changes, failed = docedit.apply(PAPER, {"ops": [
        {"op": "replace", "question": "3(c)", "with": {"text": "Write down the minimum value of $y$.", "marks": 1},
         "mark_scheme": [{"q": "", "answer": "$-1$"}]},
        {"op": "delete", "question": "6(b)"}]})
    assert not failed
    q3 = new["questions"][2]
    assert q3["parts"][2]["text"].startswith("Write down the minimum") and "answer" not in q3["parts"][2] or not q3["parts"][2]["answer"].get("choices")
    assert ms(new) == ["1", "2", "3(a)", "3(b)", "3(c)", "4", "5", "6(a)"]
    assert next(e for e in new["mark_scheme"] if e["q"] == "3(c)")["answer"] == "$-1$"
    assert len(new["questions"][5]["parts"]) == 1


def test_bad_references_are_reported_and_the_rest_applied():
    new, changes, failed = docedit.apply(PAPER, {"ops": [{"op": "delete", "question": 12}, {"op": "replace", "question": "2(d)", "with": {"text": "x"}},
                                                         {"op": "set", "field": "time", "value": "1 hour"}, {"op": "set", "field": "questions", "value": []}]})
    assert new["time"] == "1 hour" and len(new["questions"]) == 6
    assert any("no question 12" in f for f in failed) and any("no part" in f for f in failed) and any("can't be set" in f for f in failed)
    none, changes, failed = docedit.apply(PAPER, {"ops": [{"op": "delete", "question": 99}]})
    assert none is None and not changes


def test_sections_are_skipped_in_numbering():
    d = docs.clean({"kind": "paper", "title": "T", "questions": [{"section": "Section A"}, {"text": "one", "marks": 1},
                                                                  {"section": "Section B", "text": "Answer all"}, {"text": "two", "marks": 1}],
                    "mark_scheme": [{"q": "1", "answer": "a1"}, {"q": "2", "answer": "a2"}]})
    assert docedit.display_numbers(d["questions"]) == [None, "1", None, "2"]
    new, _, failed = docedit.apply(d, {"ops": [{"op": "insert", "before": 2, "question": {"text": "new", "marks": 1},
                                                "mark_scheme": [{"q": "", "answer": "n"}]}]})
    assert [q.get("section") or q["text"] for q in new["questions"]] == ["Section A", "one", "Section B", "new", "two"]
    assert [(e["q"], e["answer"]) for e in new["mark_scheme"]] == [("1", "a1"), ("2", "n"), ("3", "a2")]


def test_outline_is_short():
    o = docedit.outline(PAPER)
    assert o.count("\n") == 5 and "3. The diagram shows" in o and "3 parts" in o
