"""Canned animation-script replies for TUTOR_MOCK=1 with the script engine.

Type "bfs", "sort", "showcase", "graph", "maths" or "broken" (a script with a bug, to see the automatic
fix) to pick one; otherwise they play in turn. The BFS one is also the worked example in the prompt.
"""

from __future__ import annotations

import json
import re
from typing import Any

BFS = r"""
scene.clear();
// lay out to suit the screen: side by side when it's wide, stacked when it's tall
const tall = scene.height > 760;
const code = scene.code(`def bfs(root):
    q = deque([root])
    while q:
        node = q.popleft()
        visit(node)
        for child in node.children:
            q.append(child)`, { lang: "python", name: "code", at: tall ? [430, scene.height * 0.66] : [250, 260] });
const tree = scene.tree(["A", ["B", ["D"], ["E"]], ["C", ["F"]]], { name: "tree", at: tall ? [300, 190] : [760, 170] });
const q = scene.array([], { label: "queue", name: "q", at: tall ? [760, 200] : [760, 430] });
say("Breadth-first search explores a tree level by level, and a queue keeps track of who's next.");
await code.line(2);
await q.push("A", { from: tree.node("A") });

say("Each time round the loop, we take the node at the front of the queue and visit it.", { focus: [code, q, tree] });
let rounds = 0;
while (q.length && rounds < 3) {
  rounds++;
  if (rounds === 2) {
    predict("The queue holds B, then C. Which node comes out next?", { choices: ["B", "C", "D"], answer: 0, explain: "A queue is first in, first out, and B went in before C." });
    say("B comes out. Its children, D and E, go to the back, behind C.");
  }
  if (rounds === 3) say("Then C comes out, and F joins the queue.");
  await code.line(4);
  const name = await q.shift();          // flies out of the queue...
  await code.var("node", name);          // ...into the variable
  const node = tree.node(name);
  await code.line(5);
  await node.mark("current");
  if (rounds === 1) say("A's children, B and C, join the back of the queue.");
  await code.line(6);
  for (const child of node.children) {
    await all(code.line(7), q.push(child)); // each child flies from the tree into the queue
  }
  await node.mark("visited");
}
say("Notice we finish a whole level before going deeper. Which node comes out of the queue next?", { focus: [q, tree] });
await q.mark(0, "current");
"""

SORT = r"""
scene.clear();
const a = scene.array([5, 2, 9, 1, 6], { label: "numbers", name: "nums", at: [500, 260] });
scene.text("Bubble sort", { size: "title", above: a, gap: 70 });
say("Bubble sort walks along the list comparing neighbours, and swaps any pair that's in the wrong order.");
await a.pointer("i", 0);
await a.pointer("j", 1);
let swaps = 0;
for (let i = 0; i < a.length - 1; i++) {
  await all(a.pointer("i", i), a.pointer("j", i + 1));
  await a.mark([i, i + 1], "current");
  if (a.get(i) > a.get(i + 1)) {
    if (swaps === 0) say(`${a.get(i)} is bigger than ${a.get(i + 1)}, so they swap places.`);
    await a.swap(i, i + 1);
    swaps++;
  }
  await a.mark([i, i + 1], "none");
}
say("After one pass, the biggest number has bubbled all the way to the end.");
await a.mark(a.length - 1, "done");
await all(a.pointer("i", null), a.pointer("j", null));
say("How many passes do you think it takes to sort the whole list?");
await a.cell(a.length - 1).flash();
"""

SHOWCASE = r"""
scene.clear();
const client = scene.box("Browser", { at: [180, 200], name: "client" });
const server = scene.box("Server", { at: [820, 200], name: "server" });
const db = scene.circle("DB", { at: [820, 420] });
say("Here's what happens when you load a web page.");
await scene.arrow(client, server, { label: "request", bend: 12 });
say("The browser sends a request across the network to the server.");
await scene.packet(client, server, { label: "GET /" });
await server.flash();
say("The server needs some data, so it asks the database.");
await scene.arrow(server, db, { dashed: true });
await scene.packet(server, db, { label: "query" });
await db.mark("current");
say("Then the answer travels all the way back to the browser.");
await scene.packet(db, server);
await scene.packet(server, client, { label: "HTML" });
await client.mark("done");
const n = scene.note("rendered!", { near: client, side: "bottom" });
say("Which of these hops do you think is usually the slowest?", { focus: [server, db] });
await camera.focus(server, db);
await wait(600);
await camera.reset();
"""

GRAPH = r"""
scene.clear();
const g = scene.graph(["S", "A", "B", "C", "T"], [["S", "A", "4"], ["S", "B", "1"], ["B", "A", "2"], ["A", "C", "1"], ["B", "C", "5"], ["C", "T", "3"]],
  { directed: true, direction: "LR", name: "g" });
say("Here's a small road network. The numbers are travel times.");
await g.node("S").mark("current");
say("From S, the quickest first hop is to B, which costs just 1.");
await g.edge("S", "B").highlight(true);
await g.node("B").mark("visited");
say("Going S to B to A costs 3, which beats the direct road to A that costs 4.");
await g.edge("B", "A").highlight(true);
await g.node("A").mark("visited");
await scene.note("3 < 4", { near: g.node("A"), side: "top" });
say("So what's the cheapest way all the way to T?");
await g.node("T").flash();
"""

MATHS = r"""
scene.clear();
const l1 = scene.math("x^2 - 5x + 6 = 0", { size: "big", at: [500, 160] });
say("Let's solve x squared minus five x plus six equals zero.");
await wait(300);
const l2 = scene.math("(x - 2)(x - 3) = 0", { size: "big", below: l1 });
say("We look for two numbers that multiply to six and add to minus five: minus two and minus three.");
await scene.note("-2 × -3 = 6,  -2 + -3 = -5", { near: l2, side: "right" });
const l3 = scene.math("x = 2 \\quad\\text{or}\\quad x = 3", { size: "big", below: l2 });
say("If a product is zero, one of the factors must be zero.");
await l3.mark("done");
say("Can you check that x equals 3 really works?");
await l3.flash();
"""

BROKEN = r"""
scene.clear();
const a = scene.array([3, 1, 2], { name: "a" });
say("Let's look at this array.");
await a.swapp(0, 1);
"""

BROKEN_FIXED = r"""
scene.clear();
const a = scene.array([3, 1, 2], { name: "a" });
say("Let's look at this array. (This is the fixed script: the first one had a typo.)");
await a.swap(0, 1);
say("The first two values swapped places.");
await a.mark([0, 1], "done");
"""

DEMOS: dict[str, dict[str, Any]] = {
    "bfs": {"script": BFS, "title": "Breadth-first search", "margin": "**Queue = first in, first out.** That's what makes BFS go level by level."},
    "sort": {"script": SORT, "title": "Bubble sort: one pass", "margin": "Each pass moves the largest remaining value to the end."},
    "showcase": {"script": SHOWCASE, "title": "Loading a web page", "margin": "Round trip: browser → server → database → server → browser."},
    "graph": {"script": GRAPH, "title": "Shortest paths", "margin": ""},
    "maths": {"script": MATHS, "title": "Solving a quadratic", "margin": "If $ab = 0$ then $a = 0$ or $b = 0$."},
    "broken": {"script": BROKEN, "title": "A script with a bug", "margin": ""},
}
ORDER = ["bfs", "sort", "showcase", "graph", "maths"]
ALIASES = {"breadth": "bfs", "bubble": "sort", "sorting": "sort", "web": "showcase", "network": "graph", "path": "graph",
           "math": "maths", "quadratic": "maths", "bug": "broken", "error": "broken"}


def mock_script_reply(text: str, turn: int, repair: dict | None = None) -> dict[str, Any]:
    if repair:
        return {"script": BROKEN_FIXED, "title": "Fixed", "margin": "", "question": "", "awaiting": "answer",
                "say": "", "beats": [], "visual": None}
    fence = re.search(r"```([\w+#.-]*)\n([\s\S]*?)\n```", text)
    if fence:
        return _your_code(fence.group(2), fence.group(1) or "python")
    low = text.lower()
    key = next((k for k in DEMOS if k in low), None) or next((v for k, v in ALIASES.items() if k in low), None)
    key = key or ORDER[(turn - 1) % len(ORDER)]
    d = DEMOS[key]
    return {"script": d["script"].strip(), "title": d["title"],
            "margin": d["margin"] or f"(Mock script demo: **{key}**. Try: bfs, sort, showcase, graph, maths, broken.)",
            "question": "", "awaiting": "answer", "say": "", "beats": [], "visual": None}

HEAP = r"""
scene.clear();
const t = scene.tree([8, [3, [1], [6]], [10, null, [14]]], { binary: true, name: "bst" });
say("This is a binary search tree: smaller values go left, bigger ones go right.");
await t.root.mark("current");
say("To insert 7, we start at the root. 7 is less than 8, so we go left.");
await t.node(3).mark("current");
say("7 is more than 3, so we go right, to 6, and then right again, into an empty spot.");
await t.node(6).mark("current");
await t.add(6, 7, { side: "right" });
await t.node(7).mark("done");
const arr = scene.array(t.inorder().map((n) => n.value), { label: "in order", below: t, gap: 60 });
say("Reading the tree in order always gives the values sorted. Why do you think that is?");
await arr.mark(arr.indexOf(7), "done");
"""
DEMOS["bst"] = {"script": HEAP, "title": "Inserting into a binary search tree", "margin": ""}
ORDER.append("bst")
ALIASES["binary search"] = "bst"


def _your_code(code: str, lang: str) -> dict[str, Any]:
    """Mock: walk through the code the student sent, line by line."""
    n = len(code.split("\n"))
    script = f"""
scene.clear();
const c = scene.code({json.dumps(code)}, {{ lang: {json.dumps(lang)}, name: "theirs", title: "Your code" }});
say("Here's your code. Let's read it a line at a time.");
await c.line(1);
say("I'll step through the first few lines.");
for (let i = 2; i <= Math.min({n}, 6); i++) {{ await c.line(i); await wait(250); }}
say("Which line would you like to look at more closely?");
await c.at(1).flash();
"""
    return {"script": script.strip(), "title": "Your code", "margin": f"(Mock: you sent {n} lines of {lang}.)",
            "question": "", "awaiting": "answer", "say": "", "beats": [], "visual": None}
