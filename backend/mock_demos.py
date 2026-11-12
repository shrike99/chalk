"""Canned replies for TUTOR_MOCK=1: one demo walkthrough per visual kind.

Type a message containing a kind's name (graph, sequence, array, grid, plot, math, mermaid)
to see that demo; otherwise they play in turn. No Claude usage.
"""

from __future__ import annotations

from typing import Any

B = lambda text, hl=(), do=(): {"text": text, "highlight": list(hl), "do": list(do)}  # noqa: E731

DEMOS: dict[str, dict[str, Any]] = {
    "graph": {
        "visual": {"kind": "graph", "title": "fib(4): the call tree", "direction": "TB",
                   "nodes": [{"id": "a", "label": "fib(4)", "shape": "round"}], "edges": []},
        "beats": [
            B("We call fib of 4. It can't answer straight away.", ["a"], [{"op": "mark", "ids": ["a"], "state": "current"}]),
            B("So it asks for fib of 3 and fib of 2.", ["b", "c"], [
                {"op": "add_node", "id": "b", "label": "fib(3)", "shape": "round", "from": "a"},
                {"op": "add_node", "id": "c", "label": "fib(2)", "shape": "round", "from": "a"}]),
            B("fib of 3 splits again, into fib of 2 and fib of 1.", ["d", "e"], [
                {"op": "add_node", "id": "d", "label": "fib(2)", "shape": "round", "from": "b"},
                {"op": "add_node", "id": "e", "label": "fib(1) = 1", "shape": "circle", "from": "b"},
                {"op": "mark", "ids": ["e"], "state": "done"}]),
            B("fib of 1 is a base case: it answers immediately.", ["e"]),
            B("Notice fib of 2 appears twice. What does that tell you about the work being done?", ["c", "d"],
              [{"op": "mark", "ids": ["c", "d"], "state": "error"}]),
        ],
        "margin": "**Base case:** the input small enough to answer directly, e.g. `fib(1) = 1`.",
    },
    "array": {
        "visual": {"kind": "array", "title": "Bubble sort, first pass", "values": [5, 2, 9, 1], "pointers": {"i": 0, "j": 1}},
        "beats": [
            B("Bubble sort compares neighbours, starting with the first two.", [0, 1, "ptr:i", "ptr:j"]),
            B("Five is bigger than two, so they swap.", [0, 1], [{"op": "swap", "i": 0, "j": 1}]),
            B("Move along: five and nine are already in order.", [1, 2], [{"op": "pointer", "name": "i", "index": 1}, {"op": "pointer", "name": "j", "index": 2}]),
            B("Nine and one are not, so they swap too.", [2, 3], [{"op": "pointer", "name": "i", "index": 2}, {"op": "pointer", "name": "j", "index": 3}, {"op": "swap", "i": 2, "j": 3}]),
            B("After one pass, the biggest value has bubbled to the end.", [3], [{"op": "mark", "indices": [3], "state": "done"}, {"op": "pointer", "name": "i", "index": None}, {"op": "pointer", "name": "j", "index": None}]),
            B("How many passes do you think we need in the worst case?", []),
        ],
        "margin": "Each pass fixes the largest remaining value in place.",
    },
    "sequence": {
        "visual": {"kind": "sequence", "title": "Loading a web page",
                   "actors": [{"id": "b", "label": "Browser"}, {"id": "d", "label": "DNS"}, {"id": "s", "label": "Server"}], "messages": []},
        "beats": [
            B("First the browser needs the server's address, so it asks DNS.", ["m1"], [{"op": "add_message", "id": "m1", "from": "b", "to": "d", "label": "where is example.com?"}]),
            B("DNS replies with an IP address.", ["m2"], [{"op": "add_message", "id": "m2", "from": "d", "to": "b", "label": "93.184.216.34", "style": "reply"}]),
            B("Now the browser can send its request to the server.", ["m3"], [{"op": "add_message", "id": "m3", "from": "b", "to": "s", "label": "GET /index.html"}]),
            B("And the server sends the page back.", ["m4"], [{"op": "add_message", "id": "m4", "from": "s", "to": "b", "label": "200 OK + HTML", "style": "reply"}]),
            B("Why do you think the browser caches DNS answers?", ["b", "d"]),
        ],
        "margin": "",
    },
    "grid": {
        "visual": {"kind": "grid", "title": "Fibonacci with a table (dynamic programming)",
                   "rows": [["", "", "", "", "", "", ""]], "col_labels": ["0", "1", "2", "3", "4", "5", "6"], "row_labels": ["fib"]},
        "beats": [
            B("Instead of recursing, we fill a table from the left.", ["row:0"]),
            B("The first two cells are the base cases: zero and one.", ["0,0", "0,1"], [{"op": "set", "r": 0, "c": 0, "value": "0"}, {"op": "set", "r": 0, "c": 1, "value": "1"}, {"op": "mark", "cells": [[0, 0], [0, 1]], "state": "done"}]),
            B("Each next cell is the sum of the two before it.", ["0,0", "0,1", "0,2"], [{"op": "set", "r": 0, "c": 2, "value": "1"}, {"op": "mark", "cells": [[0, 2]], "state": "current"}]),
            B("Keep going and the table fills itself in.", ["0,3", "0,4", "0,5"], [{"op": "set", "r": 0, "c": 3, "value": "2"}, {"op": "set", "r": 0, "c": 4, "value": "3"}, {"op": "set", "r": 0, "c": 5, "value": "5"}, {"op": "mark", "cells": [[0, 2]], "state": "done"}]),
            B("What goes in the last cell?", ["0,6"], [{"op": "mark", "cells": [[0, 6]], "state": "current"}]),
        ],
        "margin": "`fib[i] = fib[i-1] + fib[i-2]`",
    },
    "plot": {
        "visual": {"kind": "plot", "title": "The slope of y = x²", "x": [-3, 3], "y": [-1, 9],
                   "functions": [{"id": "f", "expr": "x^2", "label": "y = x²"}], "points": []},
        "beats": [
            B("Here's the curve y equals x squared.", ["f"]),
            B("Put a point at x equals one.", ["p"], [{"op": "add", "item": {"type": "point", "id": "p", "x": 1, "y": 1, "label": "(1, 1)"}}]),
            B("The tangent there has slope two.", ["t", "p"], [{"op": "add", "item": {"type": "function", "id": "t", "expr": "2x - 1", "label": "slope 2"}}]),
            B("Slide the point to x equals two, and the tangent gets steeper.", ["p", "t2"], [
                {"op": "move", "id": "p", "x": 2, "y": 4, "label": "(2, 4)"}, {"op": "remove", "ids": ["t"]},
                {"op": "add", "item": {"type": "function", "id": "t2", "expr": "4x - 4", "label": "slope 4"}}]),
            B("What's the pattern between x and the slope?", ["p"]),
        ],
        "margin": "Derivative of x² is **2x**.",
    },
    "math": {
        "visual": {"kind": "math", "title": "Solving x² − 5x + 6 = 0", "lines": [{"id": "l1", "tex": "x^2 - 5x + 6 = 0", "note": "start"}]},
        "beats": [
            B("We want two numbers that multiply to six and add to minus five.", ["l1"]),
            B("Minus two and minus three work, so it factorises.", ["l2"], [{"op": "add_line", "id": "l2", "tex": "(x - 2)(x - 3) = 0", "note": "factorise"}]),
            B("If a product is zero, one of the factors must be zero.", ["l3"], [{"op": "add_line", "id": "l3", "tex": "x - 2 = 0 \\quad\\text{or}\\quad x - 3 = 0", "note": "zero product"}]),
            B("So x is two or three.", ["l4"], [{"op": "add_line", "id": "l4", "tex": "x = 2 \\;\\text{or}\\; x = 3", "note": "solutions"}, {"op": "mark", "ids": ["l4"], "state": "done"}]),
            B("How could you check these answers?", []),
        ],
        "margin": "",
    },
    "mermaid": {
        "visual": {"kind": "mermaid", "title": "Classes (Mermaid fallback)",
                   "source": "classDiagram\n  Animal <|-- Dog\n  Animal <|-- Cat\n  Animal : +name\n  Animal : +speak()\n  Dog : +fetch()"},
        "beats": [B("Mermaid handles everything else, like this class diagram.", []), B("Which methods does Dog have?", [])],
        "margin": "",
    },
}
ORDER = ["graph", "array", "sequence", "grid", "plot", "math", "mermaid"]


def mock_reply(text: str, turn: int) -> dict[str, Any]:
    low = text.lower()
    # longest names first, so "timeline" isn't mistaken for "line"
    if "bfs" in low or "breadth" in low:
        low += " board"
    kind = next((k for k in sorted(ORDER, key=len, reverse=True) if k in low), ORDER[(turn - 1) % len(ORDER)])
    demo = DEMOS[kind]
    beats = demo["beats"]
    return {
        "say": " ".join(b["text"] for b in beats),
        "beats": [{**b, "highlight": [str(x) for x in b["highlight"]]} for b in beats],
        "visual": demo["visual"],
        "margin": demo["margin"] or f"(Mock demo: **{kind}**. Type a kind's name to pick a demo; unset TUTOR_MOCK to use Claude.)",
        "question": beats[-1]["text"],
        "awaiting": "answer",
    }


# ---------------------------------------------------------------- the 21 "scene" kinds
U = lambda id_, **f: {"op": "update", "id": id_, **f}  # noqa: E731
A = lambda item, **kw: {"op": "add", "item": item, **kw}  # noqa: E731
M = lambda ids, state: {"op": "mark", "ids": ids, "state": state}  # noqa: E731

DEMOS.update({
    "tree": {"visual": {"kind": "tree", "title": "Inserting into a binary search tree", "nodes": [{"id": "r", "label": "8"}, {"id": "a", "label": "3", "parent": "r", "side": "left"}, {"id": "b", "label": "10", "parent": "r", "side": "right"}]},
             "beats": [B("Here's a binary search tree. Smaller values go left, bigger go right.", ["r"]),
                       B("To insert 6, compare with 8: smaller, so go left.", ["r", "a"], [M(["r"], "visited")]),
                       B("6 is bigger than 3, so it goes to the right of 3.", ["c"], [A({"id": "c", "label": "6", "parent": "a", "side": "right"}), M(["a"], "visited")]),
                       B("And 14 ends up right of 10.", ["d"], [A({"id": "d", "label": "14", "parent": "b", "side": "right"})]),
                       B("Where would 1 go?", ["a"], [M(["r", "a"], "none")])], "margin": ""},
    "linkedlist": {"visual": {"kind": "linkedlist", "title": "Inserting into a linked list", "nodes": [{"id": "n1", "value": 3}, {"id": "n2", "value": 7}, {"id": "n3", "value": 9}], "pointers": {"head": "n1"}},
                   "beats": [B("Each node points to the next one; head points to the first.", ["ptr:head", "n1"]),
                             B("Walk along with a pointer called cur.", ["ptr:cur", "n2"], [{"op": "pointer", "name": "cur", "to": "n2"}]),
                             B("Insert 8 after 7: the new node slots in and the arrows rewire.", ["n4"], [A({"id": "n4", "value": 8}, after="n2"), M(["n4"], "current")]),
                             B("Why is this faster than inserting into an array?", [], [M(["n4"], "none"), {"op": "pointer", "name": "cur", "to": None}])], "margin": ""},
    "hashtable": {"visual": {"kind": "hashtable", "title": "A hash table with chaining", "buckets": 5, "entries": [{"key": "cat", "value": "3", "bucket": 1}]},
                  "beats": [B("Each key is hashed to pick a bucket.", ["b:1", "cat"]),
                            B("dog hashes to bucket 3.", ["dog"], [{"op": "put", "key": "dog", "value": "5", "bucket": 3}]),
                            B("owl also lands in bucket 1: a collision, so it chains after cat.", ["owl", "b:1"], [{"op": "put", "key": "owl", "value": "1", "bucket": 1}, M(["owl"], "error")]),
                            B("What happens to lookups if every key collides?", ["b:1"], [M(["owl"], "none")])], "margin": ""},
    "memory": {"visual": {"kind": "memory", "title": "What happens when you call a function", "frames": [{"id": "main", "name": "main", "vars": [{"name": "x", "value": "5"}]}], "heap": []},
               "beats": [B("main has a variable x set to 5.", ["main.x"]),
                         B("Creating a Point puts an object on the heap, and p points to it.", ["main.p", "o1"], [A({"id": "o1", "label": "Point", "fields": [{"name": "x", "value": "1"}, {"name": "y", "value": "2"}]}, into="heap"), {"op": "setvar", "name": "p", "value": "@o1"}]),
                         B("Calling move pushes a new frame with its own variables.", ["move"], [{"op": "push_frame", "id": "move", "name": "move", "vars": [{"name": "pt", "value": "@o1"}, {"name": "dx", "value": "3"}]}]),
                         B("move changes the object both pointers share.", ["o1"], [{"op": "setfield", "obj": "o1", "name": "x", "value": "4"}]),
                         B("When move returns its frame disappears. What is p.x now?", ["main.p"], [{"op": "pop_frame"}])], "margin": ""},
    "code": {"visual": {"kind": "code", "title": "Tracing a loop", "lang": "python", "code": "total = 0\nfor i in range(1, 4):\n    total += i\nprint(total)", "current": 1, "vars": []},
             "beats": [B("Line 1 sets total to zero.", ["L1", "v:total"], [{"op": "setvar", "name": "total", "value": "0"}]),
                       B("The loop starts with i equal to 1.", ["L2", "v:i"], [{"op": "line", "n": 2}, {"op": "setvar", "name": "i", "value": "1"}]),
                       B("total becomes 1.", ["L3", "v:total"], [{"op": "line", "n": 3}, {"op": "setvar", "name": "total", "value": "1"}]),
                       B("Then i is 2 and total is 3; then i is 3 and total is 6.", ["v:i", "v:total"], [{"op": "setvar", "name": "i", "value": "3"}, {"op": "setvar", "name": "total", "value": "6"}]),
                       B("Finally it prints 6. What would range of 1 to 5 print?", ["L4", "output"], [{"op": "line", "n": 4}, {"op": "print", "text": "6"}])], "margin": ""},
    "bits": {"visual": {"kind": "bits", "title": "Binary", "bits": "00101101"},
             "beats": [B("Each bit is worth double the one to its right.", ["b7", "b6"]),
                       B("The ones are worth 32, 8, 4 and 1: that's 45.", ["b2", "b4", "b5", "b7", "value"]),
                       B("Shifting left doubles the number.", ["value"], [{"op": "shift", "dir": "left", "n": 1}]),
                       B("Flip the last bit and you add one.", ["b7", "value"], [{"op": "flip", "i": 7}]),
                       B("What does shifting right do?", [])], "margin": ""},
    "bar": {"visual": {"kind": "bar", "title": "Hours of sleep", "unit": "h", "bars": [{"id": "m", "label": "Mon", "value": 6}, {"id": "t", "label": "Tue", "value": 8}, {"id": "w", "label": "Wed", "value": 5}, {"id": "th", "label": "Thu", "value": 7}]},
            "beats": [B("Here's a week of sleep.", []), B("Wednesday was rough.", ["w"], [M(["w"], "error")]),
                      B("After a nap, Wednesday goes up to 7.", ["w"], [U("w", value=7), M(["w"], "done")]),
                      B("Sorted, the pattern is clearer.", [], [{"op": "sort", "order": "desc"}]), B("Which day is the median?", [])], "margin": ""},
    "line": {"visual": {"kind": "line", "title": "Temperature through the day", "x_label": "hour", "y_label": "°C", "series": [{"id": "t", "label": "Temp", "points": [[6, 8], [9, 12]]}]},
             "beats": [B("It starts cool in the morning.", ["t"]),
                       B("By noon it's warmed up.", ["t"], [{"op": "add_point", "series": "t", "x": 12, "y": 17}]),
                       B("It peaks mid-afternoon, then falls.", ["t"], [{"op": "add_point", "series": "t", "x": 15, "y": 19}, {"op": "add_point", "series": "t", "x": 18, "y": 14}]),
                       B("Why does the peak come after noon?", [])], "margin": ""},
    "pie": {"visual": {"kind": "pie", "title": "Where a budget goes", "slices": [{"id": "r", "label": "Rent", "value": 45}, {"id": "f", "label": "Food", "value": 20}, {"id": "t", "label": "Travel", "value": 10}, {"id": "o", "label": "Other", "value": 25}]},
            "beats": [B("Rent is almost half.", ["r"]), B("Food is a fifth.", ["f"]), B("If rent rises, everything else shrinks.", ["r"], [U("r", value=60)]), B("What fraction is left for food now?", ["f"])], "margin": ""},
    "numberline": {"visual": {"kind": "numberline", "title": "Solving x + 3 > 5", "min": -2, "max": 8, "points": [{"id": "s", "x": 2, "label": "x = 2"}], "intervals": [], "jumps": []},
                   "beats": [B("Start from the boundary, x equals 2.", ["s"]),
                             B("Adding 3 takes us to 5.", ["j"], [A({"id": "j", "type": "jump", "from": 2, "to": 5, "label": "+3"})]),
                             B("Anything bigger than 2 works, but not 2 itself: an open circle.", ["iv"], [A({"id": "iv", "type": "interval", "from": 2, "to": 8, "closed": [False, True], "label": "x > 2"})]),
                             B("Is 2.5 a solution?", ["iv"])], "margin": ""},
    "timeline": {"visual": {"kind": "timeline", "title": "Space race", "events": [{"id": "a", "date": "1957", "label": "Sputnik 1"}]},
                 "beats": [B("1957: the first satellite.", ["a"]),
                           B("1961: the first human in space.", ["b"], [A({"id": "b", "date": "1961", "label": "Gagarin orbits Earth"})]),
                           B("1969: the Moon landing.", ["c"], [A({"id": "c", "date": "1969", "label": "Apollo 11", "detail": "First steps on the Moon"})]),
                           B("Why did it move so fast?", [])], "margin": ""},
    "quadrant": {"visual": {"kind": "quadrant", "title": "Prioritising tasks", "x_axis": ["low effort", "high effort"], "y_axis": ["low impact", "high impact"], "quadrants": ["Quick wins", "Big projects", "Fill-ins", "Avoid"], "items": [{"id": "a", "label": "Fix typo", "x": 0.15, "y": 0.3}]},
                 "beats": [B("Effort goes across, impact goes up.", ["q0", "q1", "q2", "q3"]),
                           B("A tiny fix with little impact is a fill-in.", ["a", "q2"]),
                           B("A new onboarding flow: high impact, high effort.", ["b"], [A({"id": "b", "label": "New onboarding", "x": 0.8, "y": 0.85})]),
                           B("If we simplify it, it slides into quick wins.", ["b", "q0"], [U("b", x=0.3)]),
                           B("What would you do first?", [])], "margin": ""},
    "fraction": {"visual": {"kind": "fraction", "title": "Equivalent fractions", "wholes": [{"id": "a", "parts": 2, "shaded": 1, "label": "one half"}]},
                 "beats": [B("Here's one half.", ["a"]),
                           B("Cut each half in two: four parts, two shaded.", ["b"], [A({"id": "b", "parts": 4, "shaded": 2, "label": "two quarters"})]),
                           B("Same amount, as a circle.", ["c"], [A({"id": "c", "parts": 8, "shaded": 4, "shape": "circle", "label": "four eighths"})]),
                           B("How many twelfths make a half?", [])], "margin": ""},
    "venn": {"visual": {"kind": "venn", "title": "Animals", "sets": [{"id": "m", "label": "Mammals"}, {"id": "f", "label": "Can fly"}], "items": [{"id": "dog", "label": "Dog", "in": ["m"]}, {"id": "eagle", "label": "Eagle", "in": ["f"]}]},
             "beats": [B("Dogs are mammals; eagles fly.", ["m", "f"]),
                       B("Bats are both, so they sit in the overlap.", ["bat"], [A({"id": "bat", "label": "Bat", "in": ["m", "f"]})]),
                       B("Penguins are birds that can't fly.", ["peng"], [A({"id": "peng", "label": "Penguin", "in": []})]),
                       B("Where would a flying fish go?", [])], "margin": ""},
    "mindmap": {"visual": {"kind": "mindmap", "title": "Photosynthesis", "nodes": [{"id": "c", "label": "Photosynthesis"}]},
                "beats": [B("Photosynthesis needs three inputs.", ["c"]),
                          B("Light, water and carbon dioxide.", ["l", "w", "co"], [A({"id": "l", "label": "Light", "parent": "c"}), A({"id": "w", "label": "Water", "parent": "c"}), A({"id": "co", "label": "CO₂", "parent": "c"})]),
                          B("And it makes glucose and oxygen.", ["g", "o"], [A({"id": "g", "label": "Glucose", "parent": "c"}), A({"id": "o", "label": "Oxygen", "parent": "c"}), A({"id": "g1", "label": "stored as starch", "parent": "g"})]),
                          B("Which of these do we breathe?", [])], "margin": ""},
    "cycle": {"visual": {"kind": "cycle", "title": "The water cycle", "stages": [{"id": "e", "label": "Evaporation"}, {"id": "c", "label": "Condensation"}, {"id": "p", "label": "Precipitation"}, {"id": "r", "label": "Collection"}]},
              "beats": [B("The sun heats water and it evaporates.", ["e"]), B("Vapour cools into clouds.", ["c", "e->c"]), B("Rain falls.", ["p"]), B("It collects and the cycle repeats.", ["r", "r->e"]), B("What drives the whole cycle?", [])], "margin": ""},
    "layers": {"visual": {"kind": "layers", "title": "Sending a web request", "layers": [{"id": "a", "label": "Application", "detail": "HTTP"}, {"id": "t", "label": "Transport", "detail": "TCP"}, {"id": "n", "label": "Internet", "detail": "IP"}, {"id": "l", "label": "Link", "detail": "Wi-Fi / Ethernet"}]},
               "beats": [B("Your browser speaks HTTP at the top.", ["a"]), B("TCP splits it into reliable segments.", ["t"]), B("IP addresses each packet.", ["n"]), B("And the link layer sends the bits.", ["l"]), B("Which layer notices a lost packet?", [])], "margin": ""},
    "pyramid": {"visual": {"kind": "pyramid", "title": "Maslow's hierarchy", "levels": [{"id": "s", "label": "Self-actualisation"}, {"id": "e", "label": "Esteem"}, {"id": "b", "label": "Belonging"}, {"id": "sa", "label": "Safety"}, {"id": "p", "label": "Physiological"}]},
                "beats": [B("At the base: food, water, sleep.", ["p"]), B("Then safety and security.", ["sa"]), B("Then love and belonging, then esteem.", ["b", "e"]), B("At the top, becoming your best self.", ["s"]), B("Can you skip a level?", [])], "margin": ""},
    "compare": {"visual": {"kind": "compare", "title": "Arrays vs linked lists", "columns": [{"id": "arr", "title": "Array"}, {"id": "ll", "title": "Linked list"}], "items": []},
                "beats": [B("Arrays give instant access by index.", ["a1"], [A({"id": "a1", "text": "Instant access by index", "column": "arr"})]),
                          B("Linked lists insert cheaply anywhere.", ["l1"], [A({"id": "l1", "text": "Cheap insert and delete", "column": "ll"})]),
                          B("But lists must walk to find things.", ["l2"], [A({"id": "l2", "text": "Slow lookup: walk from head", "column": "ll"})]),
                          B("Which would you use for a playlist?", [])], "margin": ""},
    "steps": {"visual": {"kind": "steps", "title": "Making bread", "steps": [{"id": "s1", "label": "Mix", "detail": "flour, water, yeast, salt"}]},
              "beats": [B("First mix the ingredients.", ["s1"]),
                        B("Knead to build gluten.", ["s2"], [A({"id": "s2", "label": "Knead", "detail": "10 minutes"})]),
                        B("Let it rise.", ["s3"], [A({"id": "s3", "label": "Prove", "detail": "until doubled"})]),
                        B("Then bake.", ["s4"], [A({"id": "s4", "label": "Bake", "detail": "220°C, 30 min"})]),
                        B("What does the yeast do while it rises?", ["s3"])], "margin": ""},
    "geometry": {"visual": {"kind": "geometry", "title": "Pythagoras", "x": [-1, 6], "y": [-1, 5], "points": [{"id": "A", "x": 0, "y": 0}, {"id": "B", "x": 4, "y": 0}, {"id": "C", "x": 4, "y": 3}],
                            "segments": [{"id": "AB", "from": "A", "to": "B", "label": "4"}, {"id": "BC", "from": "B", "to": "C", "label": "3"}]},
                 "beats": [B("A right angle at B, sides 3 and 4.", ["AB", "BC", "r"], [A({"id": "r", "at": "B", "from": "A", "to": "C", "label": "90°"}, into="angles")]),
                           B("The hypotenuse joins A to C.", ["AC"], [A({"id": "AC", "from": "A", "to": "C", "label": "5"}, into="segments")]),
                           B("Fill in the triangle.", ["T"], [A({"id": "T", "points": ["A", "B", "C"]}, into="polygons")]),
                           B("Move C up and the sides stretch.", ["C", "AC"], [U("C", y=4), U("BC", label="4"), U("AC", label="5.66")]),
                           B("How long is AC now, exactly?", ["AC"])], "margin": ""},
})
ORDER = ["graph", "array", "sequence", "grid", "plot", "math", "mermaid",
         "tree", "linkedlist", "hashtable", "memory", "code", "bits", "bar", "line", "pie", "numberline", "timeline",
         "quadrant", "fraction", "venn", "mindmap", "cycle", "layers", "pyramid", "compare", "steps", "geometry"]


# ---------------------------------------------------------------- board: several panels at once
_BFS_CODE = "def bfs(root):\n    queue = [root]\n    while queue:\n        node = queue.pop(0)\n        visit(node)\n        queue += node.children"
P = lambda panel, **op: {"panel": panel, **op}  # noqa: E731
DEMOS["board"] = {
    "visual": {"kind": "board", "title": "Breadth-first search, step by step", "layout": "auto", "panels": [
        {"id": "code", "title": "Code", "kind": "code", "lang": "python", "code": _BFS_CODE, "current": 1, "vars": []},
        {"id": "tree", "title": "Tree", "kind": "tree", "nodes": [
            {"id": "a", "label": "A"}, {"id": "b", "label": "B", "parent": "a"}, {"id": "c", "label": "C", "parent": "a"},
            {"id": "d", "label": "D", "parent": "b"}, {"id": "e", "label": "E", "parent": "b"}, {"id": "f", "label": "F", "parent": "c"}]},
        {"id": "q", "title": "Queue", "kind": "array", "values": []},
    ]},
    "beats": [
        B("BFS starts by putting the root, A, in the queue.", ["code:L2", "tree:a", "q:0"],
          [P("code", op="line", n=2), P("q", op="push", value="A"), P("tree", op="mark", ids=["a"], state="current")]),
        B("While the queue isn't empty, we take the front: A.", ["code:L4", "tree:a", "code:v:node"],
          [P("code", op="line", n=4), P("q", op="shift"), P("code", op="setvar", name="node", value="A")]),
        B("Visit A, then add its children, B and C, to the back of the queue.", ["tree:b", "tree:c", "q:0", "q:1", "code:L6"],
          [P("code", op="line", n=6), P("tree", op="mark", ids=["a"], state="done"), P("q", op="push", value="B"), P("q", op="push", value="C"),
           P("tree", op="mark", ids=["b", "c"], state="visited")]),
        B("Next out is B. We visit it and queue its children, D and E.", ["tree:b", "tree:d", "tree:e", "q:1", "q:2"],
          [P("code", op="setvar", name="node", value="B"), P("q", op="shift"), P("tree", op="mark", ids=["b"], state="done"),
           P("q", op="push", value="D"), P("q", op="push", value="E"), P("tree", op="mark", ids=["d", "e"], state="visited")]),
        B("Notice we finish a whole level before going deeper. Which node comes out of the queue next?", ["q:0", "tree:c"],
          [P("code", op="line", n=4), P("tree", op="mark", ids=["c"], state="current")]),
    ],
    "margin": "**Queue = first in, first out.** That's what makes BFS go level by level.",
}
ORDER.insert(0, "board")
