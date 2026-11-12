"""Reading Claude's documents out of replies: the slips real model output makes, one by one.

Run: python -m pytest backend/tests -q
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import docs  # noqa: E402
import tutor  # noqa: E402

FENCE = "```"


def wrap(body: str, lang: str = "chalk-doc", after: str = '```json\n{"margin": "Done.", "say": "Here it is."}\n```') -> str:
    return f"Sure, here you go.\n{FENCE}{lang}\n{body}\n{FENCE}\n{after}"


def q_text(doc, i=0):
    return [q for q in doc["questions"] if "section" not in q][i]["text"]


# ---------------------------------------------------------------- well-formed
def test_plain_document():
    rest, doc, prob = docs.extract(wrap(json.dumps(docs.MOCK_PAPER)))
    assert prob is None and doc["kind"] == "paper" and len(doc["questions"]) == 6
    assert "chalk-doc" not in rest and '"margin"' in rest


def test_reply_still_parses_around_document():
    r = tutor._parse_reply(wrap(json.dumps(docs.MOCK_PAPER)))
    assert r["document"]["title"] == "Quadratic equations"
    assert r["say"] == "Here it is."


def test_code_fences_inside_strings():
    body = json.dumps({"kind": "interview", "title": "Arrays", "questions": [
        {"text": "Example:\n```\nInput: [2,7,11,15], 9\nOutput: [0,1]\n```\nNow solve it.", "marks": 10,
         "answer": {"code": 12, "language": "python", "starter": "def f():\n    pass"}}],
        "mark_scheme": [{"q": "1", "answer": "```python\ndef f(): ...\n```", "marks": "10"}]})
    r = tutor._parse_reply(wrap(body) + "\n```js\nsay('ok')\n```")
    d = r["document"]
    assert d["kind"] == "interview" and "Output: [0,1]" in q_text(d)
    assert d["questions"][0]["answer"]["code"] == 12
    assert r.get("script") and "say('ok')" in r["script"]


# ---------------------------------------------------------------- LaTeX escaping slips
def test_unescaped_latex_invalid_escapes():
    # \s, \a, \d, \l, \c are not JSON escapes: strict JSON fails, repair doubles them.
    body = r'{"kind":"paper","title":"T","questions":[{"text":"Simplify $\sqrt{50}$, $\alpha$, $\dfrac{1}{2}$, $\left(x\right)$, $\cdot$","marks":2}]}'
    _, doc, prob = docs.extract(wrap(body))
    assert prob is None
    assert q_text(doc) == r"Simplify $\sqrt{50}$, $\alpha$, $\dfrac{1}{2}$, $\left(x\right)$, $\cdot$"


def test_unescaped_latex_that_is_valid_json():
    # \f \t \b \r \n ARE JSON escapes, so "\frac" silently becomes form feed + "rac". We put them back.
    body = r'{"kind":"paper","title":"T","questions":[{"text":"Find $\frac{1}{2}$, $\theta$, $\tan x$, $\tan^{-1}$, $x \to 0$, $\tau$, $\beta$, $\rho$, $a \neq b$, $\nabla f$, $\times$\nNext line","marks":2}]}'
    _, doc, prob = docs.extract(wrap(body))
    assert prob is None
    t = q_text(doc)
    for tex in (r"\frac{1}{2}", r"\theta", r"\tan x", r"\tan^{-1}", r"\to 0", r"\tau", r"\beta", r"\rho", r"\neq", r"\nabla", r"\times"):
        assert tex in t, tex
    assert "\nNext line" in t  # a real newline outside maths stays a newline


def test_mixed_correct_and_incorrect_escapes():
    body = r'{"kind":"worksheet","title":"T","questions":[{"text":"$\\frac{a}{b}$ and $\sqrt{2}$ and $\\pi$","marks":1}]}'
    _, doc, _ = docs.extract(wrap(body))
    assert q_text(doc) == r"$\frac{a}{b}$ and $\sqrt{2}$ and $\pi$"


def test_unicode_escape_lookalike():
    body = r'{"kind":"worksheet","title":"T","questions":[{"text":"$\underline{x}$ and café","marks":1}]}'
    _, doc, _ = docs.extract(wrap(body))
    assert q_text(doc) == r"$\underline{x}$ and café"


def test_trailing_commas():
    body = '{"kind":"paper","title":"T","questions":[{"text":"Q","marks":1,},],}'
    _, doc, prob = docs.extract(wrap(body))
    assert prob is None and q_text(doc) == "Q"


# ---------------------------------------------------------------- other wrappers
def test_fence_variants():
    body = json.dumps({"kind": "paper", "title": "T", "questions": [{"text": "Q", "marks": 1}]})
    for lang in ("chalk-doc", "chalkdoc", "Chalk-Doc", "json chalk-doc", "chalk_doc", "chalk-document"):
        _, doc, prob = docs.extract(wrap(body, lang))
        assert doc and prob is None, lang


def test_document_in_a_plain_json_fence():
    body = json.dumps({"kind": "paper", "title": "T", "questions": [{"text": "Q", "marks": 1}], "mark_scheme": []})
    rest, doc, _ = docs.extract(wrap(body, "json"))
    assert doc and doc["title"] == "T" and '"margin"' in rest


def test_notes_json_is_not_mistaken_for_a_document():
    text = '```json\n{"margin": "Look at the **queue**.", "title": "BFS", "concepts": []}\n```'
    _, doc, prob = docs.extract(text)
    assert doc is None and prob is None


def test_document_key_inside_notes():
    inner = {"kind": "worksheet", "title": "T", "questions": [{"text": "Q", "marks": 1}]}
    text = "```json\n" + json.dumps({"margin": "Here.", "say": "Here.", "document": inner}) + "\n```"
    r = tutor._parse_reply(text)
    assert r["document"]["title"] == "T"


# ---------------------------------------------------------------- broken documents
def test_truncated_document_is_reported_not_shown():
    body = json.dumps(docs.MOCK_PAPER)[:900]  # the reply ran out part-way through
    r = tutor._parse_reply(f"Here.\n```chalk-doc\n{body}")
    assert "document" not in r and "cut off" in r["doc_error"]
    assert "chalk-doc" not in (r.get("say", "") + r.get("margin", ""))


def test_empty_document():
    _, doc, prob = docs.extract(wrap('{"kind":"paper","title":"T","questions":[]}'))
    assert doc is None and prob


# ---------------------------------------------------------------- cleaning
def test_kind_synonyms_and_defaults():
    for raw, want in (("exam", "paper"), ("quiz", "worksheet"), ("coding_interview", "interview"), ("cheat_sheet", "notes"), ("???", "worksheet")):
        d = docs.clean({"kind": raw, "questions": [{"text": "Q"}], "sections": [{"heading": "h", "body": "b"}]})
        assert d["kind"] == want, raw


def test_marks_as_strings_and_answer_shorthand():
    d = docs.clean({"kind": "paper", "questions": [{"text": "Q", "marks": "4", "answer": 3}]})
    q = d["questions"][0]
    assert q["marks"] == 4 and q["answer"] == {"lines": 3} and d["total_marks"] == 4


def test_sections_do_not_count_as_questions():
    d = docs.clean({"kind": "paper", "questions": [
        {"section": "Section A", "text": "Answer all questions."},
        {"text": "Q1", "marks": 2}, {"text": "Q2", "marks": 3},
        {"section": "Section B", "text": "Answer one question.", "page_break": True},
        {"text": "Q3", "parts": [{"text": "a", "marks": 5}, {"text": "b", "marks": 5}]}]})
    assert d["total_marks"] == 15
    assert docs.summary(d).startswith("Practice paper · 3 questions · 15 marks")
    assert d["questions"][3] == {"section": "Section B", "text": "Answer one question.", "page_break": True}


def test_format_options():
    d = docs.clean({"kind": "paper", "numbering": "Question", "part_labels": "decimal", "marks_style": "parens",
                    "font": "LaTeX", "answer_space": "booklet", "questions": [{"text": "Q"}]})
    assert (d["numbering"], d["part_labels"], d["marks_style"], d["font"], d["answer_space"]) == ("question", "decimal", "parens", "serif", "none")
    d = docs.clean({"kind": "paper", "numbering": "fancy", "questions": [{"text": "Q"}]})
    assert d["numbering"] == "box"


def test_cover_options():
    d = docs.clean({"kind": "paper", "cover": {"fields": ["Candidate number", "Centre number"], "notice": "Do not open"}, "questions": [{"text": "Q"}]})
    assert d["cover"]["fields"] == ["Candidate number", "Centre number"] and d["cover"]["notice"] == "Do not open"
    assert docs.clean({"kind": "paper", "cover": False, "questions": [{"text": "Q"}]})["cover"] is False
    assert docs.clean({"kind": "interview", "questions": [{"text": "Q"}]})["cover"] is False


def test_figures():
    d = docs.clean({"kind": "paper", "questions": [
        {"text": "a", "figure": "<svg viewBox='0 0 10 10'></svg>"},
        {"text": "b", "figure": {"plot": {"x": [0, 5], "y": [0, 10], "functions": [{"expr": "x^2"}]}, "caption": "Figure 1"}},
        {"text": "c", "figure": {"geometry": {"points": {"A": [0, 0], "B": [1, 0]}}}},
        {"text": "d", "figure": {"circuit": {"branches": [["lamp"]]}, "width": 0.5}},
        {"text": "e", "figure": {"upload": "0123456789ab", "page": 1, "crop": [0, 0, 1, 1]}},
        {"text": "f", "figures": [{"svg": "<svg/>"}, {"upload": "0123456789ab"}, {"plot": "not a dict"}]}]})
    qs = d["questions"]
    assert qs[0]["figures"][0]["svg"].startswith("<svg")
    assert qs[1]["figures"][0] == {"plot": {"x": [0, 5], "y": [0, 10], "functions": [{"expr": "x^2"}]}, "caption": "Figure 1"}
    assert "geometry" in qs[2]["figures"][0] and qs[3]["figures"][0]["width"] == 0.5
    assert "figures" not in qs[4]                          # a figure lifted from their file is refused
    assert len(qs[5]["figures"]) == 1                      # only the one Claude drew survives


def test_prompt_says_new_content():
    assert "never copy it" in docs.PROMPT and "Never reuse, crop or trace a figure" in docs.PROMPT
    assert '"upload"' not in docs.PROMPT


def test_answer_types():
    a = docs.clean({"kind": "worksheet", "questions": [{"text": "Q", "answer": {
        "choices": ["A", "B", "C"], "multi": True, "table": {"headers": ["x", "y"], "rows": 2, "first_column": ["a", "b", "c"]},
        "code": "20", "language": "python", "starter": "def f():", "final": "x ="}}]})["questions"][0]["answer"]
    assert a["multi"] == 2 and a["table"]["rows"] == 3 and a["code"] == 20 and a["final"] == "x ="


def test_mark_scheme_synonyms():
    d = docs.clean({"kind": "interview", "questions": [{"text": "Q"}], "solutions": [{"question": "1", "solution": "code", "notes": "O(n)"}]})
    assert d["mark_scheme"] == [{"q": "1", "answer": "code", "marks": "", "guidance": "O(n)"}]


def test_question_text_synonyms():
    d = docs.clean({"kind": "worksheet", "questions": ["Plain string question", {"question": "Q2"}, {"prompt": "Q3"}]})
    assert [q["text"] for q in d["questions"]] == ["Plain string question", "Q2", "Q3"]


# ---------------------------------------------------------------- multiple-choice options, wherever Claude puts them
def test_choices_in_every_shape():
    d = docs.clean({"kind": "paper", "answer_space": "none", "questions": [
        {"text": "a", "marks": 2, "answer": {"choices": ["x", "y"]}},
        {"text": "b", "marks": 2, "choices": ["x", "y"]},
        {"text": "c", "marks": 2, "options": ["A. x", "B. y"]},
        {"text": "d", "marks": 2, "options": {"A": "x", "B": "y"}},
        {"text": "e", "marks": 2, "options": [{"label": "A", "text": "x"}, {"letter": "B", "option": "y"}]},
        {"text": "f", "marks": 2, "answer": {"options": ["x", "y"]}},
        {"text": "g", "marks": 2, "answer": ["x", "y"]},
        {"text": "h", "marks": 2, "answer": {"type": "multiple_choice", "options": [{"text": "x"}, {"text": "y"}]}}]})
    got = [q["answer"]["choices"] for q in d["questions"]]
    assert got[0] == got[1] == got[5] == got[6] == got[7] == ["x", "y"]
    assert got[2] == got[3] == got[4] == ["A. x", "B. y"]
    assert d["answer_space"] == "none"


def test_answer_sheet_synonyms_and_choice_style():
    assert docs.clean({"kind": "paper", "answer_space": "answer_sheet", "questions": [{"text": "q"}]})["answer_space"] == "none"
    assert docs.clean({"kind": "paper", "choice_style": "bubbles", "questions": [{"text": "q"}]})["choice_style"] == "bubbles"
    assert "choice_style" not in docs.clean({"kind": "paper", "choice_style": "sparkles", "questions": [{"text": "q"}]})


def test_prompt_says_options_always_go_in_choices():
    assert "ALWAYS put a multiple-choice question's options here" in docs.PROMPT
