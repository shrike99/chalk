"""Talks to Claude through the Claude Agent SDK, signed in with your Claude Pro login.

Speed: one Claude Code session is kept open (by a background worker) instead of
starting a new process every turn, and the model and effort level are configurable.
The conversation lives in that session; switching model keeps it, changing effort
reconnects and resumes it, and "New session" starts fresh.
"""

from __future__ import annotations

import asyncio
import uuid
import json
import re
import os
import tempfile
import time
from pathlib import Path
from typing import Any, AsyncIterator

import docs
import docedit
import exercises

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
)

# Never let an API key take precedence over the subscription login.
os.environ.pop("ANTHROPIC_API_KEY", None)

MOCK = os.getenv("TUTOR_MOCK") == "1"
_WORKDIR = tempfile.mkdtemp(prefix="chalk-tutor-")  # empty, so no CLAUDE.md gets loaded
# Where notes, settings and (optionally) recordings live. The desktop app points this at %APPDATA%\Chalk.
DATA_DIR = Path(os.environ.get("CHALK_DATA") or Path(__file__).with_name("data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_PATH = DATA_DIR / "settings.json"
DEFAULT_SETTINGS = {"model": "sonnet", "effort": "low", "engine": "script", "keep_recordings": False, "default_mode": "tutor",
                    "code_language": "python", "small_model": "haiku"}
CODE_LANGUAGES = {"python": "Python", "javascript": "JavaScript", "java": "Java", "c": "C", "sql": "SQL"}
ENGINES = ["script", "classic"]
EFFORTS = ["low", "medium", "high"]

MODES = {
    "tutor": (
        "TUTOR mode. Teach Socratically. First find out what the student already knows. "
        "Explain ONE small step per turn, then check understanding with a question "
        "before moving on. Never dump the whole answer."
    ),
    "partner": (
        "THINKING PARTNER mode. The student is working through their own ideas. "
        "Listen, reflect back what you heard, ask 'why?', and gently challenge assumptions. "
        "Rarely explain; mostly ask."
    ),
    "quiz": (
        "QUIZ mode. Ask one question at a time about the topic so far. "
        "When they answer, say briefly whether it's right and why, then ask the next one, "
        "focusing on what they got wrong."
    ),
    "answer": (
        "JUST ANSWER mode. The student is in a hurry: answer directly and concisely, "
        "with a diagram if it genuinely helps. Set awaiting to \"none\"."
    ),
}

FIELDS = ["say", "margin", "question", "awaiting"]

PROMPT_HEAD = """You are a patient, encouraging tutor inside a voice-first notebook app.
What you say is read aloud while a visual on screen animates in step with your words, so you
narrate like a teacher at a whiteboard: short, warm, plain spoken English, no markdown, no
lists, no code in what you say.

Pacing rules:
- One idea per turn: at most ~80 spoken words in total.
- End most turns with exactly ONE question (put it in `question`, and say it in the last beat).
- Never reveal the next step until the student has responded or said "next".
- If the student is wrong, ask a question that exposes the gap before correcting them.
- If the student says they're stuck, climb a hint ladder: small nudge, then bigger hint,
  then a worked step, then the full answer. Never skip straight to the answer.

"""

CLASSIC_VISUALS = """BEATS: split what you say into 1-6 beats (one or two short sentences each). Each beat:
  {"text": "...", "highlight": [ids it talks about], "do": [ops that change the visual]}
The ops in "do" run (animated) as the beat starts, then its highlighted items glow and
everything else dims. Use [] for no highlight / no ops. Build things up gradually: start a
visual small and add or change parts beat by beat while you explain them, instead of showing
everything at once. This makes the visual come alive in step with your voice.

VISUAL: "visual" is null (keep what's on screen and keep using its ids; your ops still apply
to it) or a whole new visual. There are 28 kinds, and a "board" (kind 29) shows SEVERAL of them side by
side, animating together. Whenever there is more than one thing to watch, use a board: above all,
ANY walkthrough of code or an algorithm shows the code AND the data it changes (BFS: code + tree +
queue; recursion: code + call stack; sorting: code + array), and every beat moves them in step.
Pick the kinds that make the idea easiest to SEE
(e.g. recursion: tree or memory; sorting: array or bar; code: code; percentages: pie or fraction;
inequalities: numberline; history: timeline; overlap/classification: venn; trade-offs: compare or
quadrant; processes: steps or cycle; networking: layers or sequence; proofs/algebra: math):

1. graph: flowcharts, trees, recursion, graphs/networks, state machines, mind maps.
   {"kind":"graph","title":"...","direction":"TB"|"LR",
    "nodes":[{"id":"a","label":"fib(4)","shape":"rect"|"round"|"circle"|"diamond"}],
    "edges":[{"from":"a","to":"b","label":""}]}
   ops: {"op":"add_node","id","label","shape"?,"from"?: parent id to connect from}
        {"op":"add_edge","from","to","label"?}  {"op":"remove","ids":[...]}  (edges as "a->b")
        {"op":"label","id","label"}  {"op":"mark","ids":[...],"state":"current"|"visited"|"done"|"error"|"none"}
   highlight: node ids, or edges as "a->b".
2. sequence: messages between parties over time (protocols, request/response, who calls whom).
   {"kind":"sequence","title":"...","actors":[{"id":"c","label":"Browser"}],
    "messages":[{"id":"m1","from":"c","to":"s","label":"GET /","style":"solid"|"reply"}]}
   ops: {"op":"add_message","id","from","to","label","style"?}  {"op":"add_actor","id","label"}  {"op":"mark",...}
   highlight: actor ids and message ids.
3. array: arrays, lists, strings, stacks ("orientation":"stack") and queues: ideal for
   algorithms (sorting, searching, two pointers, sliding windows).
   {"kind":"array","title":"...","values":[5,2,9,1],"pointers":{"i":0,"j":1},"orientation":"row"|"stack"}
   ops: {"op":"swap","i","j"}  {"op":"set","i","value"}  {"op":"pointer","name","index"} (index null removes;
        -1 or length = just outside)  {"op":"insert","i","value"}  {"op":"remove","i"}  {"op":"push","value"}
        {"op":"pop"}  {"op":"shift"}  {"op":"mark","indices":[...],"state":...}
   highlight: indices (numbers) and pointers as "ptr:i". Indices refer to positions AFTER the beat's ops.
4. grid: tables, matrices, DP tables, game boards.
   {"kind":"grid","title":"...","rows":[["","",""],["","",""]],"row_labels":[...]?,"col_labels":[...]?}
   ops: {"op":"set","r","c","value"}  {"op":"mark","cells":[[r,c],...],"state":...}
   highlight: "r,c" strings, or "row:r" / "col:c" for a whole row or column.
5. plot: functions and points on axes.
   {"kind":"plot","title":"...","x":[-5,5],"y":[-2,10],
    "functions":[{"id":"f","expr":"x^2","label":"y = x²"}],"points":[{"id":"p","x":1,"y":1,"label":"(1, 1)"}]}
   expr uses x, numbers, + - * / ^, parentheses, sin cos tan exp ln log sqrt abs, pi, e.
   ops: {"op":"add","item":{"type":"function"|"point", ...}}  {"op":"move","id","x","y","label"?}  {"op":"remove","ids":[...]}
   highlight: function and point ids.
6. math: step-by-step algebra, derivations, proofs (LaTeX).
   {"kind":"math","title":"...","lines":[{"id":"l1","tex":"x^2 - 5x + 6 = 0","note":"start"}]}
   ops: {"op":"add_line","id","tex","note"?}  {"op":"replace","id","tex","note"?}  {"op":"mark","ids":[...],"state":...}
   highlight: line ids.
7. mermaid: anything else Mermaid can draw (class or ER diagrams, timelines, gantt, pie):
   {"kind":"mermaid","title":"...","source":"classDiagram\\n ..."}  (no ops; highlight only works on flowchart node ids)

MORE KINDS (8-28). They all share these ops, plus any extra ops listed for the kind:
   {"op":"add","into"?: collection name,"item":{...},"after"?: id}   (new things pop in)
   {"op":"update","id":...,<fields to change>}   (things glide / grow / change)
   {"op":"remove","ids":[...]}   {"op":"mark","ids":[...],"state":"current"|"visited"|"done"|"error"|"none"}
   {"op":"set","field":...,"value":...}   (top-level fields)
   Highlight ids are item ids unless stated.
8. tree: binary trees, BSTs, heaps, family/org trees.
   {"kind":"tree","title":"...","nodes":[{"id":"r","label":"8"},{"id":"a","label":"3","parent":"r","side":"left"}]}
   "side" left/right makes it a binary tree; omit for general trees. Extra: {"op":"swap","a","b"} swaps two
   nodes' labels (heapify). Highlight edges as "parent->child".
9. linkedlist: {"nodes":[{"id":"n1","value":3}],"pointers":{"head":"n1"},"doubly":false}
   Insert with add + "after". Extra: {"op":"pointer","name","to": node id or null}. Highlight "ptr:head".
10. hashtable: {"buckets":8,"entries":[{"key":"cat","value":"3","bucket":2}]}  (always give the bucket)
   Extra: {"op":"put","key","value","bucket"}  {"op":"delete","key"}. Highlight keys and buckets "b:2".
11. memory: call stack + heap (variables, references, recursion, objects).
   {"frames":[{"id":"main","name":"main","vars":[{"name":"x","value":"5"},{"name":"p","value":"@o1"}]}],
    "heap":[{"id":"o1","label":"Point","fields":[{"name":"x","value":"1"}]}]}   ("@id" values draw an arrow)
   Extra: {"op":"push_frame","id","name","vars"} {"op":"pop_frame"} {"op":"setvar","frame"?,"name","value"}
   {"op":"setfield","obj","name","value"}. Highlight frame ids, "frame.var", heap ids.
12. code: trace a program line by line.
   {"kind":"code","lang":"python","code":"def f(n):\n    ...","current":1,"vars":[{"name":"n","value":"3"}]}
   Extra: {"op":"line","n":3} moves the cursor, {"op":"setvar","name","value"}, {"op":"print","text"}.
   Highlight "L3" (line 3), "v:n" (a variable), "output".
13. bits: binary numbers and bitwise ops. {"bits":"00101101"} or {"value":45,"width":8}
   Extra: {"op":"set_bits","value"} {"op":"flip","i"} {"op":"set","i","value"} {"op":"shift","dir":"left"|"right","n"}.
   Index 0 is the leftmost bit. Highlight "b0", "b1", … and "value".
14. bar: {"bars":[{"id":"a","label":"Mon","value":4}],"unit":"h"}  update a value and the bar grows.
   Extra: {"op":"swap","a","b"} {"op":"sort","order":"asc"|"desc"}.
15. line: {"series":[{"id":"s","label":"Temp","points":[[0,3],[1,5]]}],"x_label":"","y_label":""}
   Extra: {"op":"add_point","series","x","y"}.
16. pie: {"slices":[{"id":"a","label":"Rent","value":40}]}  (highlighted slices pop out)
17. numberline: {"min":-5,"max":5,"points":[{"id":"p","x":2,"label":"2"}],
   "intervals":[{"id":"i","from":-1,"to":3,"closed":[true,false]}],"jumps":[{"id":"j","from":2,"to":5,"label":"+3"}]}
   add with "into":"jumps" / "intervals" / "points".
18. timeline: {"events":[{"id":"e1","date":"1969","label":"Moon landing","detail":"Apollo 11"}]}
19. quadrant: 2x2 matrix. {"x_axis":["low effort","high effort"],"y_axis":["low impact","high impact"],
   "quadrants":["top-left","top-right","bottom-left","bottom-right"],"items":[{"id":"a","label":"Idea","x":0.2,"y":0.8}]}
   x, y from 0 to 1; update them to move an item. Highlight item ids and "q0"-"q3".
20. fraction: area models. {"wholes":[{"id":"w1","parts":4,"shaded":3,"shape":"bar"|"circle","label":"pizza"}]}
   update "shaded" or "parts" to animate. Highlight a whole id, or one part as "w1:0".
21. venn: {"sets":[{"id":"A","label":"Mammals"}] (1 to 3 sets),"items":[{"id":"x","label":"Bat","in":["A","B"]}]}
   update an item's "in" to move it to another region.
22. mindmap: {"nodes":[{"id":"c","label":"Photosynthesis"},{"id":"a","label":"Light","parent":"c"}]}
23. cycle: loops and life cycles. {"stages":[{"id":"a","label":"Evaporation","detail":"optional"}]}  Highlight "a->b" for an arrow.
24. layers: stacked layers (network stack, architecture). {"layers":[{"id":"l7","label":"Application","detail":"HTTP"}]}  top first.
25. pyramid: {"levels":[{"id":"t","label":"Self-actualisation","detail":"optional"}]}  top level first.
26. compare: pros/cons, A vs B. {"columns":[{"id":"pro","title":"Pros"},{"id":"con","title":"Cons"}],
   "items":[{"id":"a","text":"Fast","column":"pro"}]}  update "column" to move a card.
27. steps: a numbered process. {"steps":[{"id":"s1","label":"Mix","detail":"optional"}],"direction":"LR"|"TB"}
28. geometry: shapes on a coordinate plane (y up).
   {"x":[-1,8],"y":[-1,6],"points":[{"id":"A","x":1,"y":1}],"segments":[{"id":"AB","from":"A","to":"B","label":"5"}],
    "vectors":[{"id":"v","from":"A","to":"B"}],"circles":[{"id":"c","center":"A","r":2}],
    "polygons":[{"id":"T","points":["A","B","C"]}],"angles":[{"id":"t","at":"A","from":"B","to":"C","label":"θ"}]}
   update a point's x/y and everything attached to it follows.
29. board: several visuals side by side that move together.
   {"kind":"board","title":"Breadth-first search","layout":"auto","panels":[
     {"id":"code","title":"Code","kind":"code","lang":"python","code":"def bfs(root):\n    q = [root]\n    ...","current":1},
     {"id":"tree","title":"Tree","kind":"tree","nodes":[{"id":"a","label":"A"},{"id":"b","label":"B","parent":"a"}]},
     {"id":"q","title":"Queue","kind":"array","values":[]}]}
   Each panel is any kind above (with its own "id" and "title"). layout "auto" (3 panels: first one down
   the left, others stacked on the right), "row" or "column". 2-4 panels is best.
   Every op names its panel: {"panel":"code","op":"line","n":3}, {"panel":"q","op":"push","value":"A"},
   {"panel":"tree","op":"mark","ids":["a"],"state":"current"}. Highlights name it too: "code:L3", "tree:a", "q:0".
   One beat can change and highlight several panels at once: that is the point, keep them in step
   (e.g. the beat for "we pop A and add its children" moves the code line, marks A visited, shifts the
   queue and pushes B and C). Panels with nothing highlighted fade back so the student knows where to look.
   {"op":"add_panel","panel":{"id","title","kind",...}} adds a panel (it also turns a single visual into a
   board, keeping the current one as panel "main"); {"op":"remove_panel","id"}.

Use short ids (letters/digits). When continuing with the same visual, either send "visual": null
and use ops (best: it animates), or resend it keeping the same ids. Use "visual": null with no ops
when a picture wouldn't help. Every id you highlight must exist at that beat.

"""

DRAWINGS = """DRAWINGS: the student can attach a drawing: a sketch on a blank whiteboard, or marks they drew on
top of your current visual (their ink is drawn over a snapshot of it). Look at it carefully. Say briefly
what you see ("I see you circled the 3 and drew an arrow to..."), connect it to what they said, and
respond to their thinking. If it's unclear, ask about it rather than guessing.

"""

CLASSIC_OUTPUT = """OUTPUT FORMAT: reply with ONLY one JSON object, no code fences, no text before or after it:
{"beats":[...], "visual": {...} | null, "margin": "optional written note shown (not spoken) in the
notebook: a definition, formula or short code snippet worth keeping, markdown allowed, or empty",
 "question": "the single question you're asking, or empty",
 "awaiting": "answer" (you asked a question) | "next" (waiting for them to say carry on) | "none" (topic finished),
 "note_title": "2-6 word title for the whole note (first reply, or when the topic changes)",
 "concepts": [{"name": "Queue", "status": "new" | "shaky" | "understood"}] (the 1-5 key ideas so far, judged from the student's answers)}
"""

SCRIPT_PROMPT = (Path(__file__).with_name("script_prompt.md")).read_text(encoding="utf-8")

STUDENT_CODE = """
STUDENT'S CODE: the student can send code in fenced blocks (```python … ```). When they do, it's THEIR code:
talk about it by line number, quote it exactly, and when you show it, show their code as written (same
lines, same names) rather than a tidied-up version. If it has a bug, help them find it (point at the
line, ask what they expect it to do) rather than handing over a fixed version straight away.
"""

LIGHT_PROMPT = r"""

# Keeping the conversation light
The student's Claude plan has usage limits, and every message re-reads this whole conversation.
- When the student attaches files, Chalk sends their pages once. On that turn add "files_digest" to
  your notes json: what you'll need to keep helping without seeing the files again. For each file:
  its format (cover, numbering, part labels, marks style, sections, answer spaces, time, total
  marks), the topics and question types with their marks, and anything the student asked about.
  Up to about 300 words per file; don't copy questions out.
- Later turns carry your digest, the files' text and a record of the conversation, not the page
  images. If you truly need to see pages again (a diagram, a layout detail), reply with only
  {"need_pages": [{"file": "name.pdf", "pages": [3, 4]}]} as your notes json and nothing else;
  Chalk sends them and asks you again.
"""

FORMATS_POINTER = r"""

# Documents and coding exercises
You can write printable documents (practice papers, worksheets, interview question sets, revision
notes) in a ```chalk-doc block, change one with a ```chalk-doc-edit block, and set coding exercises
that run inside Chalk with a ```chalk-exercise block. Their formats are long, so to keep the
student's usage down Chalk adds them to the conversation only when one might be needed (look for
FORMAT INSTRUCTIONS earlier in this conversation; once given, they hold for the rest of it). If you
want to make one and haven't been given its format, reply with only {"need_format": ["doc"]} (or
["exercise"]) as your notes json and nothing else: Chalk sends it and asks you again.
"""

# Sent with a message only when it might need them, and only once per conversation.
SPECS = {
    "doc": docs.PROMPT.strip() + "\n" + docedit.PROMPT.strip(),
    "exercise": exercises.PROMPT.strip(),
    "files": LIGHT_PROMPT.strip(),
}

PROMPTS = {
    "classic": PROMPT_HEAD + CLASSIC_VISUALS + STUDENT_CODE + DRAWINGS + FORMATS_POINTER + CLASSIC_OUTPUT,
    "script": PROMPT_HEAD + SCRIPT_PROMPT + "\n" + STUDENT_CODE + DRAWINGS + FORMATS_POINTER,
}


def _format_block(specs: list[str]) -> str:
    if not specs:
        return ""
    return ("FORMAT INSTRUCTIONS (Chalk adds these once; they hold for the rest of this conversation):\n\n"
            + "\n\n".join(SPECS[k] for k in specs) + "\n\n---\n\n")
SYSTEM_PROMPT = PROMPTS["classic"]  # kept for older imports


MOCK_MODELS = [
    {"value": "default", "displayName": "Default (recommended)", "description": "Claude Code's default model"},
    {"value": "opus", "displayName": "Opus", "description": "Most capable, slower"},
    {"value": "sonnet", "displayName": "Sonnet", "description": "Fast and capable"},
    {"value": "haiku", "displayName": "Haiku", "description": "Fastest"},
]


def load_settings() -> dict:
    try:
        return {**DEFAULT_SETTINGS, **json.loads(SETTINGS_PATH.read_text())}
    except Exception:
        return dict(DEFAULT_SETTINGS)


def _friendly(e: BaseException) -> str:
    msg = str(e)
    if "auth" in msg.lower() or "log in" in msg.lower() or "login" in msg.lower():
        return "You're not signed in to Claude. Open Settings and click Sign in."
    return f"Claude call failed: {msg[:500]}"


_SCRIPT_OPEN = re.compile(r"^[ \t]*```[ \t]*(?:js|javascript|jsx|ts|typescript)[ \t]*$", re.M | re.I)
_SCRIPT_OPEN_LOOSE = re.compile(r"```[ \t]*(?:js|javascript|jsx|ts|typescript)\b", re.I)
_FENCE_CLOSE = re.compile(r"^[ \t]*```[ \t]*$", re.M)


def _parse_script_reply(text: str) -> dict[str, Any] | None:
    """The script format: a ```json block of notes, then a ```js block of animation script.

    Robust to fences *inside* the notes (a margin with a ```python snippet in it): the script is the
    last ```js block, read up to the last closing fence, and the notes are decoded as JSON from the
    first "{" before it, which skips over anything inside JSON strings.
    """
    opens = list(_SCRIPT_OPEN.finditer(text)) or list(_SCRIPT_OPEN_LOOSE.finditer(text))
    if not opens:
        return None
    o = opens[-1]
    rest = text[o.end():]
    closes = list(_FENCE_CLOSE.finditer(rest))
    if closes:
        script = rest[: closes[-1].start()]
    else:  # no closing fence on its own line (or the reply was cut off)
        script = rest[: rest.rfind("```")] if rest.rstrip().endswith("```") else rest
    script = script.strip("\n").rstrip()
    if not script.strip():
        return None
    meta: dict[str, Any] = {}
    head = text[: o.start()]
    i = head.find("{")
    while i != -1 and not meta:
        try:
            obj, _ = json.JSONDecoder().raw_decode(head, i)
            meta = obj if isinstance(obj, dict) else {}
        except json.JSONDecodeError:
            pass
        i = head.find("{", i + 1) if not meta else -1
    awaiting = str(meta.get("awaiting") or "answer")
    return {"script": script, "title": str(meta.get("title") or ""), "margin": str(meta.get("margin") or ""),
            "question": str(meta.get("question") or ""), "awaiting": awaiting if awaiting in ("answer", "next", "none") else "answer",
            "say": "", "beats": [], "visual": None, **_note_meta(meta)}


def _note_meta(meta: dict) -> dict:
    """The note's title and the concepts covered so far, if Claude sent them."""
    concepts = []
    for c in meta.get("concepts") or []:
        if isinstance(c, dict) and str(c.get("name") or "").strip():
            st = str(c.get("status") or "new")
            concepts.append({"name": str(c["name"]).strip()[:40], "status": st if st in ("new", "shaky", "understood") else "new"})
    out: dict[str, Any] = {"note_title": str(meta.get("note_title") or "").strip()[:80], "concepts": concepts[:6]}
    if isinstance(meta.get("files_digest"), str) and meta["files_digest"].strip():
        out["files_digest"] = meta["files_digest"].strip()[:8000]
    pages = []
    for r in meta.get("need_pages") or [] if isinstance(meta.get("need_pages"), list) else []:
        if isinstance(r, dict) and r.get("file") and isinstance(r.get("pages"), list):
            pages.append({"file": str(r["file"])[:200], "pages": [int(p) for p in r["pages"][:8] if isinstance(p, int) or str(p).isdigit()]})
    if pages:
        out["need_pages"] = pages[:4]
    if isinstance(meta.get("complexity_review"), dict):
        out["complexity_review"] = meta["complexity_review"]
    nf = meta.get("need_format")
    nf = [nf] if isinstance(nf, str) else nf if isinstance(nf, list) else []
    nf = [str(x).lower().replace("document", "doc").replace("paper", "doc") for x in nf]
    if any(x in SPECS for x in nf):
        out["need_format"] = [x for x in dict.fromkeys(nf) if x in SPECS]
    return out


def _parse_reply(text: str) -> dict[str, Any]:
    text, edit, edit_problem = docedit.extract(text)
    text, document, problem = docs.extract(text)
    text, exercise, ex_problem = exercises.extract(text)
    reply = _parse_reply_body(text)
    if exercise:
        reply["exercise"] = exercise
    if ex_problem:
        reply["exercise_error"] = ex_problem
    if problem or edit_problem:
        reply["doc_error"] = problem or edit_problem
    if edit and not document:
        reply["doc_edit"] = edit
        if not reply.get("say") and not reply.get("script") and not reply.get("beats"):
            reply["say"] = "I've updated the paper."
    if document:
        reply["document"] = document
        if not reply.get("say") and not reply.get("script") and not reply.get("beats"):
            reply["say"] = "Here's your " + ("paper." if document["kind"] == "paper" else "document.")
    if exercise and not reply.get("say") and not reply.get("script") and not reply.get("beats"):
        reply["say"] = "Here's an exercise for you to try."
    return reply


def _parse_reply_body(text: str) -> dict[str, Any]:
    scripted = _parse_script_reply(text)
    if scripted:
        return scripted
    t = text.strip()
    if t.startswith("```"):
        t = t.strip("`")
        t = t[t.find("{"):] if "{" in t else t
    start, end = t.find("{"), t.rfind("}")
    try:
        data = json.loads(t[start : end + 1]) if start != -1 and end > start else {}
    except json.JSONDecodeError:
        data = {}
    if isinstance(data, dict) and (data.get("need_pages") or data.get("need_format")) and not (data.get("beats") or data.get("say")):
        return {"say": "", "beats": [], "visual": None, "margin": "", "question": "", "awaiting": "none", **_note_meta(data)}
    if not isinstance(data, dict) or not (data.get("beats") or data.get("say")):
        return {"say": text.strip(), "beats": [{"text": text.strip(), "highlight": [], "do": []}],
                "visual": None, "margin": "", "question": "", "awaiting": "answer"}
    beats = []
    for b in data.get("beats") or []:
        if isinstance(b, dict) and str(b.get("text") or "").strip():
            hl = b.get("highlight") or []
            ops = b.get("do") or []
            beats.append({"text": str(b["text"]).strip(),
                          "highlight": [str(x) for x in hl] if isinstance(hl, list) else [],
                          "do": [o for o in ops if isinstance(o, dict)] if isinstance(ops, list) else []})
    if not beats and data.get("say"):
        beats = [{"text": str(data["say"]).strip(), "highlight": [], "do": []}]
    visual = data.get("visual")
    if not isinstance(visual, dict):
        visual = None
        if data.get("diagram_mermaid"):  # older format
            visual = {"kind": "mermaid", "title": str(data.get("diagram_caption") or ""), "source": str(data["diagram_mermaid"])}
    out = {k: str(data.get(k) or "") for k in FIELDS}
    out.update(beats=beats, visual=visual, say=" ".join(b["text"] for b in beats), **_note_meta(data))
    if out["awaiting"] not in ("answer", "next", "none"):
        out["awaiting"] = "answer"
    return out


async def _with_images(prompt: str, images: list[str]):
    """One user message holding the text and the student's drawings (base64 PNG/JPEG data URLs)."""
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for url in images:
        head, _, data = url.partition(",")
        media = head.removeprefix("data:").split(";")[0] or "image/png"
        content.append({"type": "image", "source": {"type": "base64", "media_type": media, "data": data}})
    yield {"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None}


def _coding_line(lang: str | None) -> str:
    import toolchains
    name = CODE_LANGUAGES.get(lang or "python", "Python")
    ready = [CODE_LANGUAGES[k] for k in ("python", "javascript", "sql")]
    if toolchains.java():
        ready.append("Java")
    if toolchains.cc():
        ready.append("C")
    missing = [n for k, n in CODE_LANGUAGES.items() if n not in ready]
    return (f"Coding: the student's default language is {name}: use it for exercises and for code in explanations and papers "
            f"unless they ask for another or the topic needs one. This PC can run {', '.join(ready)}"
            + (f"; {' and '.join(missing)} would need a one-click download." if missing else "."))


def _build_prompt(text: str, mode: str, diagram: str, scene: str = "", repair: dict | None = None, stage: str = "", code_language: str | None = None) -> str:
    if repair:
        return "\n".join([
            "Your animation script failed with this error:",
            f"  {repair.get('error', '')}" + (f" (line {repair['line']}: `{repair.get('code', '').strip()}`)" if repair.get("line") else ""),
            "The screen has been put back to how it was before the script ran. Reply again in the same format",
            "(the json block and the js block), with the same narration, and a fixed script that uses only the documented API.",
        ])
    lines = [MODES.get(mode, MODES["tutor"]), "", _coding_line(code_language), ""]
    if stage:
        lines += [f"Stage (world size for this turn's script): {stage}.", ""]
    if scene.strip():
        lines += ["On screen now (the animated scene; get named objects with scene.get):", scene.strip(), ""]
    elif diagram.strip():
        lines += ["Visual currently on screen (JSON; reuse its ids or replace it):", diagram.strip(), ""]
    else:
        lines += ["Nothing is on screen yet.", ""]
    lines += ["Student:", text.strip()]
    return "\n".join(lines)


# Chalk's conversations ignore the student's own Claude Code setup: its settings, CLAUDE.md files,
# MCP servers, plugins and skills would otherwise ride along with every message, costing tokens.
ISOLATED: dict[str, Any] = {"setting_sources": [], "strict_mcp_config": True, "mcp_servers": {}}


class ClaudeWorker:
    """Owns the Claude session. All Claude work runs inside this one background task,
    because the SDK client must stay within the async context that opened it."""

    def __init__(self) -> None:
        self.jobs: asyncio.Queue = asyncio.Queue()
        self.client: ClaudeSDKClient | None = None
        self.session_id: str | None = None
        self.note_id: str | None = None
        self.settings = load_settings()
        self.models: list[dict] | None = MOCK_MODELS if MOCK else None
        self.usage: dict | None = None
        self.mock_started = False
        self.mock_context = 0  # mock mode: a stand-in for the context size Claude would report
        self._task: asyncio.Task | None = None
        # Which format instructions each conversation has already been given (they stay in its history).
        self.specs_sent: dict[str, set[str]] = {}
        # Stopping a message: the last message of the last finished turn, to resume the conversation from.
        self.last_uuid: str | None = None
        self.rewind_at: str | None = None
        self.turns_waiting = 0
        self.turn_running = False
        self.stop_requested = False

    # ----- public API (called from request handlers) -----
    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def interrupt(self) -> bool:
        """Stop the message Claude is working on (or about to start). False if there's nothing to stop."""
        if not (self.turn_running or self.turns_waiting):
            return False
        self.stop_requested = True
        if self.turn_running and self.client is not None and not MOCK:
            try:
                await self.client.interrupt()
            except Exception:
                pass
        return True

    async def stream(self, kind: str, **payload: Any) -> AsyncIterator[dict]:
        out: asyncio.Queue = asyncio.Queue()
        if kind == "turn":
            self.turns_waiting += 1
        await self.jobs.put((kind, payload, out))
        while (ev := await out.get()) is not None:
            yield ev

    async def call(self, kind: str, **payload: Any) -> list[dict]:
        return [ev async for ev in self.stream(kind, **payload)]

    # ----- worker loop -----
    async def _run(self) -> None:
        while True:
            kind, payload, out = await self.jobs.get()
            try:
                if kind == "turn":
                    self.turns_waiting -= 1
                    if self.stop_requested:
                        await out.put({"type": "stopped"})
                    else:
                        self.turn_running = True
                        try:
                            await self._turn(out, **payload)
                        finally:
                            self.turn_running = False
                    if not self.turns_waiting:
                        self.stop_requested = False
                elif kind == "warmup":
                    await self._ensure(out)
                    await out.put({"type": "ready"})
                elif kind == "reset":
                    await self._disconnect()
                    self.session_id = None
                    self.mock_started = False
                    self.last_uuid = self.rewind_at = None
                elif kind == "settings":
                    await self._apply_settings(payload)
                elif kind == "open_note":
                    # each note is its own Claude conversation: switching notes resumes that one
                    changed = ((payload.get("session_id") or None) != self.session_id
                               or (payload.get("rewind") and self.rewind_at != (payload.get("last_uuid") or None)))
                    if payload.get("note_id") != self.note_id or changed:
                        await self._disconnect()
                        self.note_id = payload.get("note_id")
                        self.session_id = payload.get("session_id") or None
                        self.mock_started = False
                        self.mock_context = int(payload.get("context") or 0)
                        self.last_uuid = payload.get("last_uuid") or None
                        self.rewind_at = self.last_uuid if payload.get("rewind") else None
                elif kind == "side":
                    await out.put({"type": "side", "text": await self._side(payload.get("system", ""), payload.get("prompt", ""), payload.get("mock", ""))})
                elif kind == "summarize":
                    await out.put({"type": "summary", "text": await self._summarize(payload.get("session_id"), payload.get("fallback", ""))})
                elif kind == "disconnect":
                    await self._disconnect()
            except Exception as e:  # keep the worker alive; start fresh next time
                await self._disconnect()
                await out.put({"type": "error", "message": _friendly(e)})
            finally:
                await out.put(None)

    def _options(self) -> ClaudeAgentOptions:
        model = self.settings.get("model")
        return ClaudeAgentOptions(
            system_prompt=PROMPTS.get(self.settings.get("engine") or "script", PROMPTS["script"]),
            tools=[],  # no file, shell or web tools: a pure conversation
            max_turns=2,
            cwd=_WORKDIR,
            model=None if model in (None, "", "default") else model,
            effort=self.settings.get("effort") or None,
            include_partial_messages=True,  # lets us report "thinking" / "writing"
            resume=self.session_id,  # carry the conversation over after a reconnect
            # After a stopped message: carry on from the turn before it, as if it was never sent.
            resume_session_at=self.rewind_at if self.session_id else None,
            fork_session=bool(self.rewind_at and self.session_id),
            **ISOLATED,
        )

    async def _ensure(self, out: asyncio.Queue) -> int:
        """Start the Claude session if needed. Returns how long starting took (ms)."""
        if MOCK:
            if not self.session_id:
                self.session_id = f"mock-{uuid.uuid4().hex[:10]}"
            if self.mock_started:
                return 0
            await out.put({"type": "stage", "stage": "starting"})
            await asyncio.sleep(0.8)
            self.mock_started = True
            return 800
        if self.client is not None:
            return 0
        await out.put({"type": "stage", "stage": "starting"})
        t0 = time.perf_counter()
        client = ClaudeSDKClient(self._options())
        await client.connect()
        self.client = client
        info = await client.get_server_info() or {}
        if info.get("models"):
            self.models = info["models"]
        return int((time.perf_counter() - t0) * 1000)

    async def _disconnect(self) -> None:
        if self.client is not None:
            try:
                await self.client.disconnect()
            except Exception:
                pass
            self.client = None

    async def _apply_settings(self, new: dict) -> None:
        old = dict(self.settings)
        self.settings.update({k: v for k, v in new.items() if k in DEFAULT_SETTINGS and v is not None and v != ""})
        SETTINGS_PATH.write_text(json.dumps(self.settings, indent=2))
        if self.client is None:
            return
        if self.settings["effort"] != old["effort"] or self.settings.get("engine") != old.get("engine"):
            await self._disconnect()  # effort and the system prompt are fixed per session: reconnect (resuming) next turn
        elif self.settings["model"] != old["model"]:
            m = self.settings["model"]
            await self.client.set_model(None if m == "default" else m)

    async def _breakdown(self) -> list[dict] | None:
        """Where this conversation's tokens are, as Claude Code's /context counts them."""
        if self.client is None:
            return None
        try:
            u = await asyncio.wait_for(self.client.get_context_usage(), 4)
        except Exception:
            return None
        rows = [{"name": c.get("name", ""), "tokens": int(c.get("tokens") or 0)} for c in u.get("categories", [])
                if int(c.get("tokens") or 0) > 0 and "free" not in str(c.get("name", "")).lower() and "buffer" not in str(c.get("name", "")).lower()]
        mcp = len(u.get("mcpTools") or [])
        if mcp:
            rows.append({"name": f"({mcp} MCP tools loaded)", "tokens": 0})
        return rows

    def _small_model(self) -> str | None:
        """Small jobs (summaries, complexity explanations) use a cheaper model unless the student chose otherwise."""
        m = self.settings.get("small_model") or "haiku"
        if m == "same":
            m = self.settings.get("model")
        return None if m in (None, "", "default") else m

    async def _side(self, system: str, prompt: str, mock: str = "") -> str:
        """A one-off question outside the note's conversation, on the small model: it reads only what it's given."""
        if MOCK:
            await asyncio.sleep(0.4)
            return mock
        client = ClaudeSDKClient(ClaudeAgentOptions(system_prompt=system, tools=[], max_turns=1, cwd=_WORKDIR,
                                                    model=self._small_model(), effort="low", **ISOLATED))
        try:
            await client.connect()
            await client.query(prompt)
            text = ""
            async for msg in client.receive_response():
                if isinstance(msg, ResultMessage):
                    if msg.is_error:
                        raise RuntimeError(str(msg.result or msg.errors))
                    text = msg.result or ""
            return text
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass

    async def _summarize(self, session_id: str | None, fallback: str) -> str:
        """A summary of a note's conversation to carry into a fresh note. Runs on a fork of the
        session, so the note itself never sees the request."""
        if MOCK or not session_id:
            await asyncio.sleep(0.5 if MOCK else 0)
            return fallback
        client = ClaudeSDKClient(ClaudeAgentOptions(
            system_prompt="You summarise tutoring conversations so they can continue elsewhere.", tools=[], max_turns=1,
            cwd=_WORKDIR, model=self._small_model(), effort="low", resume=session_id, fork_session=True, **ISOLATED))
        try:
            await client.connect()
            await client.query(SUMMARY_REQUEST)
            text = ""
            async for msg in client.receive_response():
                if isinstance(msg, ResultMessage):
                    text = msg.result or ""
            text = re.sub(r"^```\w*\n|```$", "", text.strip()).strip()
            return text[:6000] or fallback
        except Exception:
            return fallback
        finally:
            try:
                await client.disconnect()
            except Exception:
                pass

    async def _nap(self, seconds: float) -> bool:
        """Mock mode: wait, unless the student stops the message. True if they did."""
        end = time.perf_counter() + seconds
        while time.perf_counter() < end:
            if self.stop_requested:
                return True
            await asyncio.sleep(0.05)
        return self.stop_requested

    async def _stopped(self, out: asyncio.Queue, sent: list[str]) -> None:
        """The student stopped this message: drop it from the conversation, as if never sent."""
        if self.session_id and sent:
            self.specs_sent.get(self.session_id, set()).difference_update(sent)
        await self._disconnect()
        if self.last_uuid and self.session_id:
            self.rewind_at = self.last_uuid      # resume from the turn before, next time
        else:
            self.session_id = None               # it was the first message: just start again
            self.mock_started = False
        await out.put({"type": "stopped", "rewind": bool(self.rewind_at)})

    async def _exchange(self, out: asyncio.Queue, prompt: str, images: list[str] | None, t0: float):
        """Send one message and read Claude's reply: (result, usage, last message id, ms to first token)."""
        assert self.client is not None
        if images:
            await self.client.query(_with_images(prompt, images))
        else:
            await self.client.query(prompt)
        first_ms: int | None = None
        stage = "waiting"
        result: ResultMessage | None = None
        last_usage: dict | None = None
        turn_uuid: str | None = None
        async for msg in self.client.receive_response():
            if isinstance(msg, StreamEvent):
                ev = msg.event or {}
                if first_ms is None:
                    first_ms = int((time.perf_counter() - t0) * 1000)
                if ev.get("type") == "content_block_start":
                    btype = (ev.get("content_block") or {}).get("type", "")
                    new = "thinking" if "thinking" in btype else "writing"
                    if new != stage:
                        stage = new
                        await out.put({"type": "stage", "stage": stage})
            elif isinstance(msg, RateLimitEvent):
                info = msg.rate_limit_info
                self.usage = {"status": info.status, "resets_at": info.resets_at,
                              "window": info.rate_limit_type, "utilization": info.utilization}
                await out.put({"type": "usage", **self.usage})
            elif isinstance(msg, AssistantMessage):
                if msg.usage:
                    last_usage = msg.usage
                turn_uuid = msg.uuid or turn_uuid
            elif isinstance(msg, ResultMessage):
                result = msg
        if result is not None and result.is_error and not self.stop_requested and "resum" in str(result.result or result.errors).lower():
            raise RuntimeError(str(result.result or result.errors))
        return result, last_usage, turn_uuid, first_ms

    async def _turn(self, out: asyncio.Queue, text: str, mode: str, diagram: str, images: list[str] | None = None,
                    scene: str = "", repair: dict | None = None, stage: str = "", files_note: str = "",
                    fresh: bool = False, seed: str = "", specs: list[str] | None = None, fallback_seed: str = "") -> None:
        if fresh:  # start a new, light conversation for this note, seeded with what it needs
            await self._disconnect()
            self.session_id = None
            self.mock_started = False
            self.mock_context = 0
            self.rewind_at = None
            self.last_uuid = None
        if self.rewind_at and self.client is not None:
            await self._disconnect()  # reconnect, resuming from before the stopped message
        try:
            start_ms = await self._ensure(out)
        except Exception:
            if not self.rewind_at:
                raise
            # Couldn't resume from before the stopped message: start a light conversation instead.
            await self._disconnect()
            self.session_id, self.rewind_at, self.last_uuid = None, None, None
            seed = seed or fallback_seed
            start_ms = await self._ensure(out)
        sent = [k for k in (specs or []) if k in SPECS and k not in self.specs_sent.get(self.session_id or "", set())]
        formats = _format_block(sent)
        await out.put({"type": "stage", "stage": "waiting"})
        t0 = time.perf_counter()

        if MOCK:
            if await self._nap(float(os.environ.get("CHALK_MOCK_WAIT", "0.6"))):
                return await self._stopped(out, sent)
            await out.put({"type": "stage", "stage": "thinking"})
            if await self._nap(0.9):
                return await self._stopped(out, sent)
            await out.put({"type": "stage", "stage": "writing"})
            if await self._nap(0.4):
                return await self._stopped(out, sent)
            prompt = formats + (seed + "\n\n" if seed else "") + _build_prompt(text, mode, diagram, scene, repair, stage, self.settings.get("code_language")) + files_note
            # Keep what would have gone to Claude, so tests can check attachments arrive intact.
            (DATA_DIR / "last_prompt.json").write_text(json.dumps({"prompt": prompt, "images": len(images or []),
                                                                   "image_bytes": sum(len(i) for i in images or [])}), "utf-8")
            reply = _mock_reply(text, self.settings.get("engine") or "script", repair, self.settings.get("code_language") or "python")
            if images:
                reply["margin"] = f"(Mock) I received {len(images)} image{'s' * (len(images) != 1)} ({sum(len(i) for i in images) // 1024} KB). " + reply["margin"]
            # Roughly what Claude would report: the system prompt, everything so far, this message and the reply.
            self.mock_context = (self.mock_context or len(PROMPTS["script"]) // 4) + len(prompt) // 4 + 1600 * len(images or []) \
                + len(json.dumps(reply)) // 4
            context = self.mock_context
            first_ms, num_turns = 600, 1
            system = len(PROMPTS["script"]) // 4
            breakdown = [{"name": "Chalk's instructions", "tokens": system},
                         {"name": "Conversation", "tokens": max(0, context - system)}]
            self.last_uuid = f"mock-{time.time()}"
            if self.rewind_at:
                self.rewind_at = None
        else:
            rewinding = bool(self.rewind_at)
            for attempt in (0, 1):
                assert self.client is not None
                prompt = formats + (seed + "\n\n" if seed else "") + _build_prompt(text, mode, diagram, scene, repair, stage if self.settings.get("engine") != "classic" else "", self.settings.get("code_language")) + files_note
                try:
                    result, last_usage, turn_uuid, first_ms = await self._exchange(out, prompt, images, t0)
                    break
                except Exception:
                    if attempt or not rewinding or self.stop_requested:
                        raise
                    # Resuming from before a stopped message failed: carry on in a light, seeded conversation.
                    await self._disconnect()
                    self.session_id, self.rewind_at, self.last_uuid = None, None, None
                    seed = seed or fallback_seed
                    sent = [k for k in (specs or []) if k in SPECS]
                    formats = _format_block(sent)
                    await self._ensure(out)
            if self.stop_requested:
                return await self._stopped(out, sent)
            if result is None:
                raise RuntimeError("Claude returned no result.")
            if result.session_id:
                self.session_id = result.session_id
            if result.is_error:
                raise RuntimeError(str(result.result or result.errors))
            reply = _parse_reply(result.result or "")
            num_turns = result.num_turns
            context = _context_tokens(last_usage or result.usage)
            self.last_uuid = turn_uuid or self.last_uuid
            self.rewind_at = None
            breakdown = await self._breakdown()

        if self.session_id:
            self.specs_sent.setdefault(self.session_id, set()).update(sent)
        model = self.settings["model"]
        await out.put({
            "type": "result",
            **reply,
            "session_id": self.session_id,
            "last_uuid": self.last_uuid,
            "context": context,
            "breakdown": breakdown,
            "timing": {
                "start_ms": start_ms,
                "first_token_ms": first_ms,
                "total_ms": int((time.perf_counter() - t0) * 1000) + start_ms,
                "model": model,
                "effort": self.settings["effort"],
                "api_calls": num_turns,
            },
        })


SUMMARY_REQUEST = """The student is continuing this topic in a fresh note, to keep their usage low. Write what you'd need to
carry on tutoring them seamlessly without this conversation: what they're working towards and at what level;
what they now understand; what they struggled with or got wrong (and the misconception behind it); choices
made (language, exam board, format, difficulty); any papers, exercises or files and the details that matter;
and what to do next. Under 350 words, plain text, no JSON and no code fences. Write it to yourself."""


def _context_tokens(usage: dict | None) -> int:
    """How much this note's conversation weighs: everything Claude read for the last call, plus what it wrote."""
    if not usage:
        return 0
    return int(sum(int(usage.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")))


def _mock_review(text: str) -> dict[str, Any]:
    """Mock mode: a complexity review from counting how deeply the loops nest."""
    m = re.search(r"```\w*\n(.*?)```", text, re.S)
    code = m.group(1) if m else ""
    depth, best, stack = 0, (0, 1), []
    for i, line in enumerate(code.split("\n"), 1):
        ind = len(line) - len(line.lstrip())
        while stack and ind <= stack[-1]:
            stack.pop()
        if re.match(r"\s*(for|while)\b", line):
            stack.append(ind)
            if len(stack) > best[0]:
                best = (len(stack), i)
    depth, line = best
    time_ = {0: "O(1)", 1: "O(n)", 2: "O(n²)"}.get(depth, f"O(n^{depth})")
    space = "O(n)" if re.search(r"new Map|\{\}|dict\(|new Set|set\(", code) else "O(1)"
    say = f"Your code is {time_} in time and {space} in memory: line {line} is where the work piles up."
    return {"say": say, "beats": [{"text": say, "highlight": [], "do": []}], "visual": None, "margin": "", "question": "",
            "awaiting": "answer", "note_title": "", "concepts": [],
            "complexity_review": {"time": time_, "space": space, "n": "n = the length of the list", "line": line,
                                  "because": f"Line {line} sits inside {depth} loop{'s' if depth != 1 else ''} over the list, so it runs about n{'²' if depth == 2 else ''} times."}}


def _mock_reply(text: str, engine: str = "script", repair: dict | None = None, code_language: str = "python") -> dict[str, Any]:
    _mock_reply.n = getattr(_mock_reply, "n", 0) + 1  # type: ignore[attr-defined]
    raw = os.environ.get("TUTOR_MOCK_REPLY")  # replay a saved raw Claude reply (for debugging what Claude sent)
    if raw and not repair:
        return _parse_reply(Path(raw).read_text(encoding="utf-8"))
    fx = re.search(r"\bfixture:([\w-]+)", text)  # tests: "fixture:name" replays tests/fixtures/replies/name.txt
    fx_dir = os.environ.get("CHALK_FIXTURES")
    if fx and fx_dir and (Path(fx_dir) / f"{fx.group(1)}.txt").exists():
        name = fx.group(1)
        if text.startswith("(Chalk: here are ") and (Path(fx_dir) / f"{name}_after.txt").exists():
            name += "_after"  # the reply once the pages Claude asked for have been sent
        return _parse_reply((Path(fx_dir) / f"{name}.txt").read_text(encoding="utf-8"))
    if re.search(r"explain (the|my) code's complexity", text, re.I) and not repair:
        return _mock_review(text)
    if re.search(r"\b(exercise|practice problem|coding problem|let me try|leetcode)\b", text, re.I) and not repair:
        lang = next((k for k, pat in (("javascript", r"javascript|\bjs\b"), ("java", r"\bjava\b"), ("sql", r"\bsql\b"), ("c", r"\bin c\b|\bc exercise\b"),
                                       ("python", r"\bpython\b")) if re.search(pat, text, re.I)), code_language)
        ex = exercises.clean(json.loads(json.dumps(exercises.MOCKS.get(lang, exercises.MOCK))))
        say = f"Here's an exercise: {ex['title'].lower()}. Think about the awkward inputs before you run it."
        return {"say": say, "beats": [{"text": say, "highlight": [], "do": []}], "visual": None,
                "margin": "Write your answer, then press **Run**. Hidden edge cases will nudge you if something breaks.",
                "question": "", "awaiting": "none", "note_title": ex["title"], "concepts": [{"name": "Hash maps", "status": "new"}],
                "exercise": ex}
    if re.search(r"\b(past|practice|mock) paper|worksheet|exam paper", text, re.I) and not repair:
        say = "I've written you a 45-minute practice paper on quadratics. Do it without notes, then open the mark scheme."
        return {"say": say, "beats": [{"text": say, "highlight": [], "do": []}], "visual": None,
                "margin": "Practice paper ready. Time yourself, then check the **mark scheme**.", "question": "",
                "awaiting": "none", "note_title": "Quadratics practice", "concepts": [],
                "document": docs.clean(docs.MOCK_PAPER)}
    if engine == "script":
        from mock_scripts import mock_script_reply
        reply = mock_script_reply(text, _mock_reply.n, repair)  # type: ignore[attr-defined]
    else:
        from mock_demos import mock_reply
        reply = mock_reply(text, _mock_reply.n)  # type: ignore[attr-defined]
    reply.setdefault("note_title", reply.get("title") or "")
    reply.setdefault("concepts", [{"name": w, "status": st} for w, st in
                                  (("Queue", "understood"), ("Level order", "shaky"), ("Shortest path", "new"))])
    return reply


worker = ClaudeWorker()
