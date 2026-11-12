"""Keeping a note's conversation light: files sent once, a context meter, continuing in a fresh note,
and changing a paper one question at a time. Runs the real server in mock mode."""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(HERE))

FIXTURES = {
    "digest": '```json\n{"say": "I\'ve read your paper.", "files_digest": "GCSE-style paper: boxed numbers, [n marks], 3 pages, algebra."}\n```',
    "edit_q2": '```chalk-doc-edit\n{"ops": [{"op": "replace", "question": 2, "with": {"text": "Solve $x^2 - 9x + 20 = 0$.", "marks": 3},'
               ' "mark_scheme": [{"q": "", "answer": "$x = 4, 5$", "marks": "3"}]}, {"op": "delete", "question": 5}]}\n```\n'
               '```json\n{"say": "Question two is harder now, and I took out question five."}\n```',
    "need_pages": '```json\n{"need_pages": [{"file": "gcse_maths_style.pdf", "pages": [2]}]}\n```',
    "need_pages_after": '```json\n{"say": "Page two uses lined answer space."}\n```',
}


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("light")
    fx = tmp / "fixtures"
    fx.mkdir()
    for k, v in FIXTURES.items():
        (fx / f"{k}.txt").write_text(v, "utf-8")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {**os.environ, "TUTOR_MOCK": "1", "CHALK_DATA": str(tmp / "data"), "CHALK_FIXTURES": str(fx)}
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", "--port", str(port)], cwd=BACKEND, env=env,
                         stdout=subprocess.DEVNULL, stderr=open(tmp / "server.log", "w"))
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/notes")
            break
        except OSError:
            time.sleep(0.1)
    yield base, tmp
    p.terminate()
    p.wait()


def call(base, path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
    if path == "/api/turn":
        evs = [json.loads(x) for x in raw.splitlines() if x.strip()]
        return next(e for e in evs if e["type"] in ("result", "error"))
    return json.loads(raw)


def upload(base, path: Path):
    boundary = "chalkboundary"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\n"
            "Content-Type: application/pdf\r\n\r\n").encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(base + "/api/uploads", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.loads(urllib.request.urlopen(req).read())


def last_prompt(tmp):
    return json.loads((tmp / "data" / "last_prompt.json").read_text("utf-8"))


def test_light_conversation(server, tmp_path):
    base, tmp = server
    import make_inputs
    pdf = make_inputs.make_all(tmp_path)  # the past papers used across the tests
    note = call(base, "/api/notes", {"mode": "tutor"})
    nid = note["id"]

    # 1. A paper: the context meter starts counting
    r = call(base, "/api/turn", {"text": "write me a practice paper on quadratics", "note_id": nid})
    assert r["document"]["kind"] == "paper"
    n1 = r["note"]
    assert n1["context"] > 5000 and n1["reseed"] == 0
    paper_id = r["document"]["id"]

    # 2. Attach a past paper: its pages go once, and the next turn will start light
    f = upload(base, pdf / "gcse_maths_style.pdf")
    r = call(base, "/api/turn", {"text": "fixture:digest have a look at this", "note_id": nid, "attachments": [f["id"]]})
    lp = last_prompt(tmp)
    assert lp["images"] == 3 and "files_digest" in lp["prompt"]
    assert r["note"]["reseed"] == 1 and r["note"]["context"] > n1["context"] + 3 * 1600

    # 3. The next turn: a fresh conversation, seeded with a record instead of the pages
    r = call(base, "/api/turn", {"text": "fixture:edit_q2 make question 2 harder and drop the last one", "note_id": nid})
    lp = last_prompt(tmp)
    assert lp["images"] == 0
    for s in ("CONVERSATION SO FAR", "Your notes on them", "GCSE-style paper: boxed numbers", "gcse_maths_style.pdf (3 pages)",
              "Expand and simplify", f"CURRENT VERSION of “Quadratic equations” (id {paper_id})", "DOCUMENTS IN THIS NOTE"):
        assert s in lp["prompt"], s
    assert r["note"]["reseed"] == 0
    assert r["note"]["context"] < n1["context"] + 3 * 1600   # lighter than carrying the page images
    doc = r["document"]
    assert doc["edited"] == ["Question 2 rewritten", "Question 5 removed"] and doc["id"] != paper_id
    full = call(base, f"/api/docs/{doc['id']}")
    assert full["parent"] == paper_id and len(full["doc"]["questions"]) == 5
    assert full["doc"]["questions"][1]["text"] == "Solve $x^2 - 9x + 20 = 0$."
    assert [e["q"] for e in full["doc"]["mark_scheme"]] == ["1", "2", "3(a)", "3(b)", "3(c)", "4", "5(a)", "5(b)"]

    # 4. The turn after an edit shows the new numbering once; no seed now
    r = call(base, "/api/turn", {"text": "thanks", "note_id": nid})
    lp = last_prompt(tmp)
    assert "CONVERSATION SO FAR" not in lp["prompt"] and "Its questions now, after your last change" in lp["prompt"]
    assert f"id {doc['id']}" in lp["prompt"] and f"id {paper_id}" not in lp["prompt"]
    call(base, "/api/turn", {"text": "and again", "note_id": nid})
    assert "Its questions now" not in last_prompt(tmp)["prompt"]

    # 5. Claude asks to see a page again: Chalk sends just that page and asks again
    r = call(base, "/api/turn", {"text": "fixture:need_pages what answer space does page 2 use?", "note_id": nid})
    lp = last_prompt(tmp)
    assert lp["images"] == 1 and lp["prompt"].count("(Chalk: here are the pages you asked for: gcse_maths_style.pdf page 2.)") == 1
    assert r["say"] == "Page two uses lined answer space." and "need_pages" not in r
    assert r["note"]["reseed"] == 1
    turns = call(base, f"/api/notes/{nid}")["turns"]
    assert sum(1 for t in turns if t["role"] == "tutor") == 6   # the page request itself isn't saved

    # 6. Continue in a fresh note: a summary and the newest paper come along
    new = call(base, f"/api/notes/{nid}/continue", {})["note"]
    assert new["title"].endswith("(continued)") and new["continued_from"] == nid and new["reseed"] == 1
    assert "Recent conversation" in new["carry"] and call(base, f"/api/notes/{nid}")["continued_in"] == new["id"]
    assert call(base, f"/api/notes/{nid}/continue", {})["note"]["id"] == new["id"]   # asking twice doesn't make two
    r = call(base, "/api/turn", {"text": "let's carry on", "note_id": new["id"]})
    lp = last_prompt(tmp)
    assert "CARRIED OVER from the student's earlier note" in lp["prompt"] and "CURRENT VERSION of “Quadratic equations”" in lp["prompt"]
    assert r["note"]["context"] < 20000
    docs_new = call(base, f"/api/notes/{new['id']}")
    assert docs_new["reseed"] == 0
