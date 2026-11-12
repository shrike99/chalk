"""Replies for the assessment scenarios, written the way Claude answers with the Chalk prompt.

Each is a raw reply (```chalk-doc block + notes JSON). "{{upload:<file name>}}" is replaced with the id
the test got when it uploaded that file. Some are deliberately broken the way real replies break.

python backend/tests/fixtures/make_replies.py <out dir>
"""
import json
import sys
from pathlib import Path

NOTES = '```json\n{"margin": "%s", "say": "%s", "note_title": "%s", "awaiting": "none"}\n```'


def reply(doc: dict, margin: str, say: str, title: str, lang: str = "chalk-doc") -> str:
    return f"```{lang}\n{json.dumps(doc, indent=1, ensure_ascii=False)}\n```\n" + NOTES % (margin, say, title)


SVG_LINES = ("<svg viewBox='0 0 260 220' xmlns='http://www.w3.org/2000/svg'><g stroke='#000' fill='none' stroke-width='1'>"
             "<path d='M20 200H250M40 210V10'/>" + "".join(f"<path d='M{40 + i * 20} 200v4M36 {200 - i * 20}h4' />" for i in range(1, 10)) +
             "<path d='M40 120 L240 40' stroke-width='1.8'/><path d='M40 60 L240 180' stroke-width='1.8'/></g>"
             "<g font-size='10' font-family='serif'><text x='244' y='214'>x</text><text x='44' y='16'>y</text>"
             "<text x='200' y='44'>y = 2x + 4</text><text x='186' y='170'>x + 2y = 6</text><text x='26' y='212'>O</text></g></svg>")

GCSE = {
    "kind": "paper", "title": "Algebra: simultaneous equations and inequalities", "subtitle": "Higher Tier · Paper 1 Non-Calculator",
    "style_of": "the GCSE Mathematics paper you sent", "time": "45 minutes", "numbering": "plain", "part_labels": "paren",
    "marks_style": "parens_word", "question_totals": False,
    "cover": {"fields": ["Centre number", "Candidate number", "Surname", "Forename(s)"], "marking_grid": True},
    "instructions": ["Use black ink or black ball-point pen. Draw diagrams in pencil.", "Fill in the boxes at the top of this page.",
                     "Answer **all** questions.", "You must answer the questions in the space provided.", "Do all rough work in this book.",
                     "In all calculations, show clearly how you work out your answer."],
    "information": ["The marks for questions are shown in brackets.", "The maximum mark for this paper is 30.", "You may **not** use a calculator."],
    "questions": [
        {"text": "Solve $3x - 7 > 11$.", "marks": 2, "answer": {"lines": 3, "final": "Answer"}},
        {"text": "Solve the simultaneous equations\n\n$$2x + y = 11$$\n$$x - y = 1$$", "marks": 3, "answer": {"space": 6, "final": "$x$ = ............  $y$ = ............"}},
        {"text": "The graphs of $y = 2x + 4$ and $x + 2y = 6$ are drawn on the grid.",
         "figure": {"plot": {"x": [-4, 6], "y": [-2, 8], "x_step": 1, "y_step": 1, "grid": True,
                             "functions": [{"expr": "2x + 4", "label": "y = 2x + 4"}, {"expr": "(6 - x)/2", "label": "x + 2y = 6"}]}, "width": 0.62},
         "parts": [{"text": "Use the graph to estimate the solution of the simultaneous equations $y = 2x + 4$ and $x + 2y = 6$.", "marks": 2, "answer": {"lines": 2, "final": "Answer"}},
                   {"text": "Explain why your answer to part (a) is only an estimate.", "marks": 1, "answer": {"lines": 2}}]},
        {"text": "$n$ is an integer.\n\n$-3 \\le 2n + 1 < 9$\n\nWrite down all the possible values of $n$.", "marks": 3, "answer": {"lines": 3, "final": "Answer"}},
        {"text": "Adult tickets cost £$a$ and child tickets cost £$c$.\n\n2 adult tickets and 3 child tickets cost £36.\n\n4 adult tickets and 1 child ticket cost £47.\n\nWork out the cost of one adult ticket and one child ticket.",
         "marks": 4, "answer": {"space": 9, "final": "Adult £ ............  Child £ ............"}},
        {"text": "Solve the simultaneous equations\n\n$$y = x^2 - 3x + 1$$\n$$y = 2x - 5$$", "marks": 5, "answer": {"space": 12, "final": "Answer"}},
        {"text": "Show the region that satisfies all three inequalities by shading it on a grid, and label it $R$.\n\n$y \\ge 1 \\qquad x + y \\le 6 \\qquad y \\le 2x$", "marks": 4, "answer": {"grid": 9}},
        {"text": "Prove that the lines $y = 3x + 2$ and $6x - 2y = 5$ never meet.", "marks": 3, "answer": {"space": 7}},
        {"text": "Solve $x^2 - 4x - 12 \\le 0$", "marks": 3, "answer": {"space": 6, "final": "Answer"}},
    ],
    "mark_scheme_notes": "**M** marks are for method, **A** marks for accuracy (dependent on the M mark), **B** marks are independent. *ft* = follow through. Accept any correct method unless the question says otherwise.",
    "mark_scheme": [
        {"q": "1", "answer": "$x > 6$", "marks": "2", "guidance": "M1 $3x > 18$ · A1. Accept $6 < x$. $x = 6$ or $x \\ge 6$ scores M1 A0"},
        {"q": "2", "answer": "$x = 4$, $y = 3$", "marks": "3", "guidance": "M1 eliminating a variable (e.g. adding: $3x = 12$) · A1 $x = 4$ · A1 $y = 3$"},
        {"q": "3(a)", "answer": "$x \\approx -0.4$, $y \\approx 3.2$", "marks": "2", "guidance": "B1 each. Accept $x$ in $[-0.6, -0.2]$, $y$ in $[3, 3.4]$"},
        {"q": "3(b)", "answer": "Reading from a graph is not exact / lines drawn by hand", "marks": "1", "guidance": "B1"},
        {"q": "4", "answer": "$-2, -1, 0, 1, 2, 3$", "marks": "3", "guidance": "M1 $-4 \\le 2n < 8$ · M1 $-2 \\le n < 4$ · A1 all six, no extras"},
        {"q": "5", "answer": "Adult £10.50, child £5", "marks": "4", "guidance": "M1 $2a + 3c = 36$, $4a + c = 47$ · M1 eliminate · A1 one value · A1 both"},
        {"q": "6", "answer": "$(2, -1)$ and $(3, 1)$", "marks": "5", "guidance": "M1 $x^2 - 3x + 1 = 2x - 5$ · M1 $x^2 - 5x + 6 = 0$ · M1 $(x-2)(x-3)$ · A1 $x$ values · A1 pairs"},
        {"q": "7", "answer": "Correct region bounded by the three lines", "marks": "4", "guidance": "B1 each line drawn correctly · B1 correct region labelled $R$"},
        {"q": "8", "answer": "Rearranging: $y = 3x - 2.5$. Both gradients are 3 but the intercepts differ, so the lines are parallel and distinct.", "marks": "3", "guidance": "M1 rearrange · A1 gradient 3 · A1 conclusion referring to equal gradients and different intercepts"},
        {"q": "9", "answer": "$-2 \\le x \\le 6$", "marks": "3", "guidance": "M1 $(x-6)(x+2)$ · A1 critical values · A1 correct inequality"},
    ],
}

UNI = {
    "kind": "paper", "title": "CS2002: Algorithms and Data Structures", "subtitle": "Practice examination · Time allowed: TWO hours",
    "style_of": "your department's CS2002 summer paper", "time": "2 hours", "font": "serif", "numbering": "question", "part_labels": "decimal",
    "marks_style": "brackets_word", "answer_space": "none", "question_totals": False, "cover": False,
    "header": "CS2002 Algorithms and Data Structures · Practice paper",
    "instructions": ["Answer **THREE** of the **FOUR** questions. All questions carry equal marks.", "Write your answers in the answer booklet provided."],
    "questions": [
        {"text": "This question is about hashing.", "parts": [
            {"text": "Define *load factor* for a hash table with separate chaining, and state the expected cost of an unsuccessful search in terms of it.", "marks": 5},
            {"text": "Insert the keys 12, 44, 13, 88, 23, 94, 11, 39, 20 into a table of size 11 using linear probing with $h(k) = k \\bmod 11$. Show the final table.", "marks": 8},
            {"text": "Explain why deletion is harder with open addressing than with chaining, and describe how *tombstones* address this.", "marks": 6},
            {"text": "A colleague proposes resizing the table only when it is completely full. Evaluate this proposal.", "marks": 6}]},
        {"text": "This question is about graph algorithms.", "parts": [
            {"text": "State the cut property of minimum spanning trees.", "marks": 4},
            {"text": "Prove that Kruskal's algorithm returns a minimum spanning tree. You may use the cut property.", "marks": 10},
            {"text": "Give the running time of Kruskal's algorithm with a union–find structure using union by rank and path compression, justifying each term.", "marks": 6},
            {"text": "Does the MST remain the same if every edge weight $w$ is replaced by $w^2$? Justify your answer.", "marks": 5}]},
        {"text": "This question is about dynamic programming.", "parts": [
            {"text": "Explain the difference between *memoisation* and *tabulation*.", "marks": 4},
            {"text": "The edit distance $E(i, j)$ between prefixes $a_{1..i}$ and $b_{1..j}$ satisfies\n$$E(i,j) = \\min\\{E(i-1,j)+1,\\; E(i,j-1)+1,\\; E(i-1,j-1)+[a_i \\ne b_j]\\}.$$\nState the base cases and compute the edit distance between `KITTEN` and `SITTING`, showing the table.", "marks": 12},
            {"text": "Show how to reduce the space used to $O(\\min(m, n))$ and explain what is lost.", "marks": 9}]},
        {"text": "This question is about lower bounds.", "parts": [
            {"text": "Prove that any comparison-based sorting algorithm requires $\\Omega(n \\log n)$ comparisons in the worst case.", "marks": 12},
            {"text": "Counting sort runs in $O(n + k)$. Explain why this does not contradict your answer to 4.1.", "marks": 5},
            {"text": "Describe an algorithm to sort $n$ integers in the range $[0, n^3)$ in $O(n)$ time.", "marks": 8}]},
    ],
    "mark_scheme_notes": "Each question is marked out of 25. Indicative content is given; award marks for equivalent correct reasoning. For proofs, a clear structure (claim, invariant, conclusion) is expected for full marks.",
    "mark_scheme": [
        {"q": "1.1", "answer": "$\\alpha = n/m$; expected unsuccessful search $\\Theta(1 + \\alpha)$", "marks": "5", "guidance": "2 definition · 3 cost with brief justification (uniform hashing)"},
        {"q": "1.2", "answer": "Index: 0:88 1:44 2:12 3:13 4:23 5:11 6:94 7:39 8:— 9:20 10:—", "marks": "8", "guidance": "1 per correctly placed collision chain; −1 per error, minimum 0"},
        {"q": "1.3", "answer": "Removing a key breaks probe sequences; tombstones mark slots deleted-but-occupied for searches and free for inserts.", "marks": "6", "guidance": "3 problem · 3 tombstones, including clean-up on resize"},
        {"q": "1.4", "answer": "Clustering makes probes $\\Theta(n)$ near full; amortised cost of operations degrades; resize at $\\alpha \\approx 0.5$–$0.75$.", "marks": "6", "guidance": "Evaluation, not just description"},
        {"q": "2.1–2.4", "answer": "Cut property; exchange argument proof; $O(E \\log E)$ sort plus near-linear union–find; yes (squaring is monotone on non-negative weights; note the negative-weight caveat).", "marks": "25", "guidance": "4 · 10 · 6 · 5"},
        {"q": "3.1–3.3", "answer": "Top-down vs bottom-up; $E(i,0)=i$, $E(0,j)=j$, distance 3; keep two rows, lose the ability to reconstruct the alignment without Hirschberg.", "marks": "25", "guidance": "4 · 12 (table 8, answer 4) · 9"},
        {"q": "4.1–4.3", "answer": "Decision tree with $n!$ leaves has height $\\ge \\log_2 n! = \\Omega(n \\log n)$; counting sort is not comparison-based; radix sort in base $n$, 3 passes.", "marks": "25", "guidance": "12 · 5 · 8"},
    ],
}

MCQ = {
    "kind": "paper", "title": "Electricity", "subtitle": "Foundation Tier · Practice test", "style_of": "the physics paper you sent",
    "time": "30 minutes", "numbering": "box", "marks_style": "brackets_word", "cover": {"fields": ["Name", "Candidate number"], "facts": True, "marking_grid": False},
    "questions": [
        {"section": "Section A", "text": "Answer **all** questions in this section. Each question is worth 1 mark. Tick one box for each question."},
        {"number": "0 1", "text": "Which quantity is measured in ohms?", "marks": 1, "answer": {"choices": ["Current", "Potential difference", "Resistance", "Charge"]}},
        {"number": "0 2", "text": "Figure 1 shows a circuit. What is the reading on the ammeter?",
         "figure": {"circuit": {"source": "battery:9 V", "branches": [["resistor:2 Ω", "resistor:4 Ω"]], "main": ["ammeter", "switch"]}, "caption": "Figure 1", "width": 0.6},
         "marks": 1, "answer": {"choices": ["A 0.67 A", "B 1.5 A", "C 2.25 A", "D 4.5 A"]}},
        {"number": "0 3", "text": "Which **two** statements about a series circuit are correct?", "marks": 1,
         "answer": {"choices": ["The current is the same everywhere.", "The potential difference is shared between components.", "Adding a resistor decreases the total resistance.", "Each component has its own loop."], "multi": 2}},
        {"number": "0 4", "text": "What is the charge that flows when a current of 2 A flows for 30 s?", "marks": 1, "answer": {"choices": ["15 C", "32 C", "60 C", "0.067 C"]}},
        {"section": "Section B", "text": "Answer **all** questions in the spaces provided.", "page_break": True},
        {"number": "0 5", "text": "A student investigated how the current through a filament lamp depends on the potential difference across it.",
         "parts": [{"text": "Complete the table.", "marks": 3, "answer": {"table": {"headers": ["Potential difference (V)", "Current (A)", "Resistance (Ω)"], "rows": 4}}},
                   {"text": "Explain why the resistance of the lamp increases as the current increases.", "marks": 3, "answer": {"lines": 5}},
                   {"text": "Calculate the power of the lamp when the potential difference is 12 V and the current is 0.5 A.", "marks": 2, "answer": {"space": 4, "final": "Power = ............ W"}}]},
    ],
    "insert": [{"heading": "Equations", "body": "| | |\n|---|---|\n| charge flow = current × time | $Q = I\\,t$ |\n| potential difference = current × resistance | $V = I\\,R$ |\n| power = potential difference × current | $P = V\\,I$ |"}],
    "mark_scheme": [
        {"q": "01", "answer": "C", "marks": "1", "guidance": ""},
        {"q": "02", "answer": "B", "marks": "1", "guidance": "$I = V/R = 9/6 = 1.5$ A"},
        {"q": "03", "answer": "A and B", "marks": "1", "guidance": "Both needed for the mark"},
        {"q": "04", "answer": "C", "marks": "1", "guidance": "$Q = It = 2 \\times 30$"},
        {"q": "05.1", "answer": "Resistance values from $R = V/I$", "marks": "3", "guidance": "1 per correct row"},
        {"q": "05.2", "answer": "Filament heats up; ions vibrate more; electrons collide more often", "marks": "3", "guidance": "Any three points"},
        {"q": "05.3", "answer": "6 W", "marks": "2", "guidance": "M1 $P = 12 \\times 0.5$ · A1"},
    ],
}

INTERVIEW = {
    "kind": "interview", "title": "Onsite interview: Round 2 (practice)", "subtitle": "45 minutes · 2 problems · talk through your approach before coding",
    "style_of": "the interview sheet you sent", "time": "45 minutes",
    "questions": [
        {"text": "**Insert interval.** You are given a list of non-overlapping intervals sorted by start, and a new interval. Insert it, merging where necessary, and return the result.\n\n**Example**\n```\nInput:  intervals = [[1,3],[6,9]], new = [2,5]\nOutput: [[1,5],[6,9]]\n\nInput:  intervals = [[1,2],[3,5],[6,7],[8,10],[12,16]], new = [4,8]\nOutput: [[1,2],[3,10],[12,16]]\n```\n\n**Constraints**\n- `0 <= len(intervals) <= 10^4`\n- `intervals` is sorted by start and non-overlapping\n\n*Follow-up:* do it in one pass without sorting.",
         "marks": 10, "answer": {"code": 16, "language": "python", "starter": "def insert(intervals: list[list[int]], new: list[int]) -> list[list[int]]:\n    "}},
        {"text": "**Time-based key–value store.** Design `TimeMap` with `set(key, value, timestamp)` and `get(key, timestamp)`, which returns the value set at the largest timestamp $\\le$ `timestamp`, or `\"\"` if none. Timestamps for each key arrive in increasing order.\n\n**Example**\n```\nt = TimeMap()\nt.set(\"foo\", \"bar\", 1)\nt.get(\"foo\", 1)   # \"bar\"\nt.get(\"foo\", 3)   # \"bar\"\nt.set(\"foo\", \"bar2\", 4)\nt.get(\"foo\", 4)   # \"bar2\"\n```\n\n**Constraints**\n- At most $2 \\times 10^5$ calls in total\n\n*Follow-up:* what changes if timestamps can arrive out of order?",
         "marks": 10, "answer": {"code": 22, "language": "python", "starter": "class TimeMap:\n    def __init__(self):\n        \n\n    def set(self, key: str, value: str, timestamp: int) -> None:\n        \n\n    def get(self, key: str, timestamp: int) -> str:\n        "}},
    ],
    "mark_scheme": [
        {"q": "1", "marks": "10", "answer": "```python\ndef insert(intervals, new):\n    out, i, n = [], 0, len(intervals)\n    while i < n and intervals[i][1] < new[0]:\n        out.append(intervals[i]); i += 1\n    lo, hi = new\n    while i < n and intervals[i][0] <= hi:\n        lo, hi = min(lo, intervals[i][0]), max(hi, intervals[i][1]); i += 1\n    out.append([lo, hi])\n    return out + intervals[i:]\n```\n**Complexity:** $O(n)$ time, $O(n)$ output space.\n\n**Test these:** empty list; new interval before all / after all; new interval covering everything; touching endpoints `[1,2]` + `[2,3]`.",
         "guidance": "- **Strong:** states the three phases before coding, handles touching endpoints, tests edge cases unprompted.\n- **OK:** correct after a hint about the three phases; misses one edge case.\n- **Weak:** re-sorts everything ($O(n \\log n)$) without noticing the input is sorted, or merges incorrectly."},
        {"q": "2", "marks": "10", "answer": "```python\nfrom bisect import bisect_right\nfrom collections import defaultdict\n\nclass TimeMap:\n    def __init__(self):\n        self.times = defaultdict(list)\n        self.vals = defaultdict(list)\n\n    def set(self, key, value, timestamp):\n        self.times[key].append(timestamp)\n        self.vals[key].append(value)\n\n    def get(self, key, timestamp):\n        i = bisect_right(self.times[key], timestamp)\n        return self.vals[key][i - 1] if i else \"\"\n```\n**Complexity:** `set` $O(1)$, `get` $O(\\log n)$.\n\n**Follow-up:** out-of-order timestamps need a balanced BST / sorted container per key (`insort` is $O(n)$).",
         "guidance": "- **Strong:** spots binary search immediately, explains why appends keep lists sorted, discusses the follow-up trade-offs.\n- **OK:** linear scan first, then improves with a hint.\n- **Weak:** stores only the latest value, or can't reason about the `<=` boundary."},
    ],
}

SCANNED = {
    "kind": "worksheet", "title": "Energy transfers worksheet", "subtitle": "Year 9 Science", "style_of": "your rates-of-reaction worksheet",
    "numbering": "dot", "marks_style": "none", "cover": {"fields": ["Name", "Class"]},
    "questions": [
        {"text": "Name **two** ways energy can be transferred from a hot drink to its surroundings.", "answer": {"lines": 3}},
        {"text": "Why does a metal spoon feel colder than a wooden spoon at the same temperature?", "answer": {"lines": 3}},
        {"text": "Complete the table of results below.", "answer": {"table": {"headers": ["Time (min)", "Temperature (°C)", "Change (°C)"], "rows": 4, "first_column": ["0", "2", "4", "6"]}}},
        {"text": "Sketch a graph of temperature against time for the cooling drink.", "answer": {"grid": 10}},
        {"text": "Suggest **one** way to keep the drink hot for longer and explain why it works.", "answer": {"lines": 4}},
    ],
    "mark_scheme": [
        {"q": "1", "answer": "Conduction, convection, radiation, evaporation (any two)", "marks": "", "guidance": ""},
        {"q": "2", "answer": "Metal is a better thermal conductor, so it transfers energy away from your hand faster", "marks": "", "guidance": ""},
        {"q": "3–5", "answer": "Values from the class results; a curve that falls quickly then levels off; a lid or insulation reduces convection / evaporation", "marks": "", "guidance": ""},
    ],
}

PHOTO = {
    "kind": "worksheet", "title": "Velocity–time graphs", "subtitle": "Inspired by the graph you photographed", "numbering": "box",
    "marks_style": "brackets", "cover": False,
    "questions": [
        {"text": "The graph shows how the velocity of a runner changes during a 24-second sprint.",
         "figure": {"plot": {"x": [0, 24], "y": [0, 10], "x_step": 2, "y_step": 1, "grid": True, "x_label": "time (s)", "y_label": "velocity (m/s)",
                             "lines": [{"points": [[0, 0], [3, 9], [15, 9], [18, 6], [24, 0]]}]}, "caption": "Figure 1", "width": 0.75},
         "parts": [{"text": "Describe the motion of the runner between 3 s and 15 s.", "marks": 1, "answer": {"lines": 2}},
                   {"text": "Calculate the acceleration during the first 3 s.", "marks": 2, "answer": {"space": 3, "final": "m/s²"}},
                   {"text": "Use the graph to find the total distance travelled.", "marks": 4, "answer": {"space": 6, "final": "m"}},
                   {"text": "Between which times is the runner decelerating fastest? Explain how you can tell from the graph.", "marks": 2, "answer": {"lines": 3}}]},
    ],
    "mark_scheme": [
        {"q": "1(a)", "answer": "Constant velocity of 9 m/s", "marks": "1", "guidance": ""},
        {"q": "1(b)", "answer": "$a = 9 / 3 = 3$ m/s²", "marks": "2", "guidance": "M1 gradient · A1"},
        {"q": "1(c)", "answer": "Area $= 13.5 + 108 + 22.5 + 18 = 162$ m", "marks": "4", "guidance": "M1 area idea · M1 two areas · M1 all areas · A1"},
        {"q": "1(d)", "answer": "15–18 s: gradient −1 m/s² (18–24 s is −1 m/s² too: accept either with a gradient comparison)", "marks": "2", "guidance": ""},
    ],
}

LONG_PASSAGE = "\n\n".join(
    f"{i}. " + "The railway arrived in the town in 1847, and with it came a new sense of time. Before the trains, every town kept its own clock, set by the sun; noon in Bristol was ten minutes after noon in London. " * 3
    for i in range(1, 9))

STRESS = {
    "kind": "paper", "title": "Stress test: everything at once", "time": "3 hours", "insert": [{"heading": "Formula sheet", "body": "$$\\int_a^b f(x)\\,dx = F(b) - F(a)$$\n\n" + "| a | b |\n|---|---|\n" + "\n".join(f"| $x^{i}$ | $\\frac{{x^{{{i + 1}}}}}{{{i + 1}}}$ |" for i in range(12))}],
    "questions": [
        {"section": "Section A: reading", "text": "Read the extract, then answer the questions."},
        {"text": "**Extract**\n\n" + LONG_PASSAGE, "parts": [{"text": "What changed when the railway arrived?", "marks": 4, "answer": {"lines": 6}}]},
        {"text": "A question with a 40-line code answer.", "marks": 20, "answer": {"code": 40, "language": "java", "starter": "public class Main {\n    public static void main(String[] args) {\n        " + "x" * 200 + "\n    }\n}"}},
        {"text": "A table that is far too wide:\n\n| " + " | ".join(f"Column {i}" for i in range(14)) + " |\n|" + "---|" * 14 + "\n| " + " | ".join("value" for _ in range(14)) + " |", "marks": 2, "answer": {"table": {"headers": [f"h{i}" for i in range(12)], "rows": 2}}},
        {"text": "An unbroken URL: https://example.com/" + "a" * 160 + " and some emoji 🧪📐 and other scripts: 数学 · رياضيات · Математика", "marks": 1, "answer": {"lines": 1}},
        {"text": "Broken maths that KaTeX can't parse: $\\frac{1}{$ (should show as an error, not crash).", "marks": 1, "answer": {"lines": 1}},
        {"text": "Deeply nested parts.", "parts": [{"text": "Level one.", "parts": [{"text": "Level two.", "marks": 1, "answer": {"lines": 1}, "parts": [{"text": "Level three (dropped: too deep).", "marks": 9}]}, {"text": "Level two again.", "marks": 2, "answer": {"lines": 2}}]}]},
        {"text": "Huge figure.", "figure": "<svg viewBox='0 0 100 400' xmlns='http://www.w3.org/2000/svg'><rect x='5' y='5' width='90' height='390' fill='none' stroke='#000'/><script>alert(1)</script><a href='https://evil.example'><text x='10' y='50' onclick='alert(2)'>tall</text></a></svg>", "marks": 1, "answer": {"space": 30}},
        {"page_break": True, "text": "This question starts on a new page and has 30 lines of space plus a 30-line grid.", "marks": 5, "answer": {"lines": 30, "grid": 30}},
    ] + [{"text": f"Short question {i}: state one fact about the number {i}.", "marks": 1, "answer": {"lines": 1}} for i in range(1, 26)],
}

LATEX_SLIPS = r'''Here's a short worksheet.
```chalk-doc
{"kind": "worksheet", "title": "Trigonometry warm-up", "questions": [
  {"text": "Find $\theta$ if $\tan\theta = \frac{\sqrt{3}}{3}$ and $0 \le \theta < 90°$.", "marks": 2, "answer": {"lines": 2, "final": "\theta ="}},
  {"text": "Show that $\frac{\sin^2 x}{1 - \cos x} = 1 + \cos x$.", "marks": 3, "answer": {"space": 6}},
  {"text": "Solve $2\sin x - 1 = 0$ for $0 \le x \le 2\pi$, giving answers as multiples of $\pi$. Note: $a \neq b$ and $\nabla f$, $\beta$, $\rho$, $\times$.", "marks": 3, "answer": {"space": 5}},
],
"mark_scheme": [{"q": "1", "answer": "$\theta = 30°$", "marks": "2", "guidance": "M1 $\tan^{-1}$ · A1"}]}
```
```json
{"margin": "Three warm-up questions.", "say": "Here are three warm-up questions.", "awaiting": "none"}
```'''

TRUNCATED = "Here's your paper.\n```chalk-doc\n" + json.dumps(GCSE)[:2500]

JSON_FENCE_SCRIPT = reply({"kind": "worksheet", "title": "Fractions", "questions": [{"text": "Work out $\\frac{1}{2} + \\frac{1}{3}$.", "marks": 1, "answer": {"lines": 1}}]},
                          "One question.", "One question for you.", "Fractions", lang="json") + "\n```js\nsay('Here is one question.')\n```"

GALLERY = {
    "kind": "worksheet", "title": "Figure gallery", "cover": False, "questions": [
        {"text": "A quadratic and a straight line.", "figure": {"plot": {"x": [-2, 6], "y": [-3, 9], "x_step": 1, "y_step": 1, "functions": [{"expr": "x^2 - 4x + 3", "label": "y = x^2 - 4x + 3", "domain": [-1.5, 5.5]}, {"expr": "x + 1", "label": "y = x + 1", "dashed": True}], "points": [{"at": [2, -1], "label": "T"}]}, "width": 0.6}, "marks": 2, "answer": {"lines": 2}},
        {"text": "Trig on fine graph paper.", "figure": {"plot": {"x": [0, 360], "y": [-1.5, 1.5], "x_step": 90, "y_step": 0.5, "grid": "fine", "functions": [{"expr": "sin(x*pi/180)", "label": "y = sin x"}, {"expr": "cos(x*pi/180)", "dashed": True, "label": "y = cos x"}], "x_label": "x°"}, "width": 0.7}, "marks": 1},
        {"text": "A bar chart.", "figure": {"plot": {"x": [0, 6], "y": [0, 30], "y_step": 5, "x_label": "day", "y_label": "visitors", "bars": [{"x": 1, "height": 12, "label": "Mon"}, {"x": 2, "height": 18, "label": "Tue"}, {"x": 3, "height": 25, "label": "Wed", "shaded": True}, {"x": 4, "height": 9, "label": "Thu"}, {"x": 5, "height": 21, "label": "Fri"}]}, "width": 0.55}, "marks": 1},
        {"text": "A cubic with points, no grid.", "figure": {"plot": {"x": [-3, 3], "y": [-10, 10], "y_step": 5, "grid": False, "functions": [{"expr": "x(x-2)(x+2)"}], "points": [{"at": [-2, 0], "label": "A"}, {"at": [2, 0], "label": "B"}]}, "width": 0.5}, "marks": 1},
        {"text": "A right-angled triangle.", "figure": {"geometry": {"points": {"A": [0, 0], "B": [8, 0], "C": [0, 6]}, "polygons": ["ABC"], "labels": {"AB": "8 cm", "AC": "6 cm", "BC": "x cm"}, "right_angles": [{"at": "A", "from": "B", "to": "C"}], "angles": [{"at": "B", "from": "A", "to": "C", "label": "θ"}]}, "caption": "Not drawn accurately", "width": 0.42}, "marks": 3, "answer": {"space": 4, "final": "x ="}},
        {"text": "A circle theorem diagram.", "figure": {"geometry": {"points": {"O": [0, 0], "A": [-3, 0], "B": [3, 0], "C": [1.2, 2.75]}, "circles": [{"centre": "O", "radius": 3}], "polygons": ["ABC"], "segments": ["OC"], "angles": [{"at": "C", "from": "A", "to": "B", "label": "y"}], "dots": True}, "width": 0.4}, "marks": 2},
        {"text": "A trapezium with a dashed height.", "figure": {"geometry": {"points": {"P": [0, 0], "Q": [10, 0], "R": [7, 4], "S": [2, 4], "H": [2, 0]}, "polygons": ["PQRS"], "dashed": ["SH"], "labels": {"PQ": "10 cm", "SR": "5 cm", "SH": "4 cm"}, "right_angles": [{"at": "H", "from": "Q", "to": "S"}], "hide": ["H"]}, "width": 0.5}, "marks": 2},
        {"text": "A series circuit with a voltmeter.", "figure": {"circuit": {"source": "cell:1.5 V", "branches": [["resistor:R", "lamp"]], "main": ["ammeter"], "voltmeters": [{"branch": 0, "index": 0}]}, "width": 0.55}, "marks": 1},
        {"text": "A parallel circuit.", "figure": {"circuit": {"source": "battery:6 V", "branches": [["lamp:L1"], ["lamp:L2"], ["resistor:4 Ω", "led"]], "main": ["ammeter", "fuse"]}, "width": 0.6}, "marks": 2},
        {"text": "Sensors.", "figure": {"circuit": {"source": "battery", "branches": [["ldr", "thermistor", "variable_resistor"]], "main": ["switch", "motor", "diode"]}, "width": 0.7}, "marks": 1},
        {"text": "A hand-drawn SVG still works (a number line).", "figure": "<svg viewBox='0 0 300 40' xmlns='http://www.w3.org/2000/svg'><path d='M10 20H290' stroke='#000'/><circle cx='100' cy='20' r='4' fill='#000'/><circle cx='220' cy='20' r='4' fill='#fff' stroke='#000'/><path d='M100 20H220' stroke='#000' stroke-width='3'/></svg>", "marks": 1},
    ]}

REUSE = {"kind": "worksheet", "title": "Reuse attempt", "questions": [
    {"text": "Uses the student's circuit (must be refused).", "figure": {"upload": "{{upload:mcq_physics.pdf}}", "page": 1, "crop": [0.26, 0.375, 0.67, 0.57]}, "marks": 1},
    {"text": "Draws its own.", "figure": {"circuit": {"branches": [["lamp"]]}}, "marks": 1}]}

BAD_FIGS = {"kind": "worksheet", "title": "Broken figures", "questions": [
    {"text": "Bad expression.", "figure": {"plot": {"x": [0, 5], "y": [0, 5], "functions": [{"expr": "x^^2 + @"}]}}, "marks": 1},
    {"text": "Unknown point.", "figure": {"geometry": {"points": {"A": [0, 0], "B": [1, 1]}, "polygons": ["ABZ"]}}, "marks": 1},
    {"text": "Unknown component.", "figure": {"circuit": {"branches": [["flux_capacitor"]]}}, "marks": 1},
    {"text": "Backwards range.", "figure": {"plot": {"x": [5, 0], "y": [0, 5]}}, "marks": 1},
    {"text": "Still fine.", "figure": {"plot": {"x": [0, 5], "y": [0, 5], "functions": [{"expr": "x"}]}}, "marks": 1}]}

# Modelled on a real report: a university multiple-choice paper answered on a computer-marked
# sheet. Options written several different ways; all must print as an A–E list.
IPCV = {
    "kind": "paper", "title": "Image Processing and Computer Vision", "subtitle": "Practice paper", "time": "2 Hours",
    "numbering": "q", "marks_style": "brackets_word", "answer_space": "none", "font": "sans",
    "cover": {"fields": ["Candidate number"], "marking_grid": False, "notice": "Do not turn over until told to start the exam."},
    "instructions": ["This paper contains 6 questions.", "Each question has exactly one correct answer.", "You must select exactly one answer per question."],
    "questions": [
        {"text": "In relation to K-means clustering consider points 1 to 5 below:\n\n1. The number of clusters $k$ must be chosen first.\n2. It always finds the global minimum.\n3. Each iteration never increases the within-cluster error.\n4. It works well on ring-shaped clusters.\n5. Outliers pull centroids away.\n\nWhich set of the above are FALSE statements?",
         "marks": 3, "options": ["2 and 4", "1 and 3", "2 and 5", "4 only", "3 and 4"]},
        {"text": "Which of the following statements about sampling and aliasing is INCORRECT?", "marks": 2,
         "options": {"A": "Sampling below the Nyquist rate can cause aliasing.", "B": "A low-pass filter before downsampling reduces aliasing.", "C": "Aliasing makes high frequencies appear as low ones.", "D": "Doubling the sampling rate always removes aliasing.", "E": "None of the above are incorrect."}},
        {"text": "Which of the following statements about the Fourier transform of an image is INCORRECT?", "marks": 2,
         "answer": {"options": [{"label": "A", "text": "The magnitude spectrum of a real image is symmetric."}, {"label": "B", "text": "Phase carries much of the structure."}, {"label": "C", "text": "Blurring removes high frequencies."}, {"label": "D", "text": "A shift in space changes the magnitude spectrum."}, {"label": "E", "text": "None of the above."}]}},
        {"text": "A $4 \\times 4$ image has the integral image $II$ below.\n\n| $II$ | x=0 | x=1 | x=2 | x=3 |\n|---|---|---|---|---|\n| y=0 | 1 | 3 | 3 | 4 |\n| y=1 | 4 | 7 | 9 | 10 |\n| y=2 | 4 | 9 | 12 | 17 |\n| y=3 | 5 | 10 | 16 | 23 |\n\nWhat is the sum of the pixels in columns 2–3, rows 2–3?",
         "marks": 4, "choices": ["A. 6", "B. 7", "C. 8", "D. 9", "E. 10"]},
        {"text": "Consider the following statements:\n\n1. The Harris response is invariant to image scale.\n2. SIFT descriptors are histograms of gradient orientations.\n\nSelect one of the following:", "marks": 2,
         "answer": ["Only 1 is true", "Only 2 is true", "Both are true", "Neither is true"]},
        {"text": "Indicate which one of the following statements is NOT TRUE about the 2-D motion field of a moving camera viewing a static scene.", "marks": 2,
         "answer": {"choices": ["Pure translation along the optical axis gives a field radiating from a focus of expansion.", "Nearer points move faster in the image under translation.", "Pure rotation gives a field that depends on depth.", "The field can be computed from optical flow only under assumptions.", "None of the above."]}},
    ],
    "mark_scheme": [{"q": str(i), "answer": a, "marks": m, "guidance": ""} for i, (a, m) in enumerate([("A", "3"), ("D", "2"), ("D", "2"), ("B", "4"), ("B", "2"), ("C", "2")], 1)],
}

SCENARIOS = {
    "gcse_follow": (reply(GCSE, "A 45-minute paper in the same format as yours.", "I've made a 45-minute paper in the same format as the one you sent.", "Simultaneous equations paper"), ["gcse_maths_style.pdf"]),
    "uni_follow": (reply(UNI, "A practice paper in your department's format: answer three of four.", "Here's a practice exam in your department's format.", "CS2002 practice exam"), ["university_exam.pdf"]),
    "mcq_follow": (reply(MCQ, "Same layout as your paper, with a new circuit.", "Here's a practice test in the same layout, with new questions and a new circuit.", "Electricity test"), ["mcq_physics.pdf"]),
    "interview_follow": (reply(INTERVIEW, "Two new problems in the same style.", "Two new problems, same style as your sheet.", "Interview practice"), ["coding_interview.pdf"]),
    "scanned_follow": (reply(SCANNED, "A worksheet like your scanned one.", "Here's a worksheet like the one you scanned.", "Energy transfers"), ["scanned_worksheet.pdf"]),
    "photo_questions": (reply(PHOTO, "Questions on a new graph like yours.", "Here are some questions on a new graph like yours.", "Velocity-time graph"), ["velocity_graph_photo.jpg"]),
    "ipcv_follow": (reply(IPCV, "In the style of your two IPCV papers.", "Here's a practice paper in the style of your two papers.", "IPCV practice"), ["university_exam.pdf"]),
    "figure_gallery": (reply(GALLERY, "Every kind of figure.", "Every kind of figure.", "Figures"), []),
    "reuse_refused": (reply(REUSE, "Tried to reuse.", "Tried to reuse.", "Reuse"), ["mcq_physics.pdf"]),
    "bad_figures": (reply(BAD_FIGS, "Broken figures.", "Broken figures.", "Broken figures"), []),
    "multi_paper_follow": (reply(GCSE, "In the style of all three papers.", "Here's one in the style of all three.", "Combined style"), ["gcse_maths_style.pdf", "long_paper_40pp.pdf", "university_exam.pdf"]),
    "stress": (reply(STRESS, "Stress test.", "Stress test.", "Stress"), []),
    "latex_slips": (LATEX_SLIPS, []),
    "truncated": (TRUNCATED, ["gcse_maths_style.pdf"]),
    "json_fence_script": (JSON_FENCE_SCRIPT, []),
}

if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/chalk-replies")
    out.mkdir(parents=True, exist_ok=True)
    for name, (text, _) in SCENARIOS.items():
        (out / f"{name}.txt").write_text(text, "utf-8")
    print(len(SCENARIOS), "replies in", out)
