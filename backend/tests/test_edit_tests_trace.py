"""Editing/regenerating messages, the student's own tests, the code walkthrough and side jobs."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_stop_and_formats import server, post, get, last, prompt  # noqa: E402,F401

NAIVE = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return None\n"


def put(base, path, body):
    import urllib.request
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="PUT", headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())


def exercise(base):
    nid = post(base, "/api/notes", {"mode": "tutor"})["id"]
    r = last(post(base, "/api/turn", {"text": "give me a python coding exercise", "note_id": nid}))
    return nid, r["exercise"]["id"]


def test_regenerate_and_edit(server):
    base, tmp = server
    nid = post(base, "/api/notes", {"mode": "tutor"})["id"]
    r1 = last(post(base, "/api/turn", {"text": "what is recursion?", "note_id": nid}))
    assert r1["user_turn"] and r1["tutor_turn"] > r1["user_turn"]
    r2 = last(post(base, "/api/turn", {"text": "and a base case?", "note_id": nid}))
    # regenerate the last reply: drop the last message and its reply, then send it again
    t = post(base, f"/api/notes/{nid}/truncate", {"turn_id": r2["user_turn"]})
    assert [x["text"][:18] for x in t["turns"]][:1] == ["what is recursion?"] and len(t["turns"]) == 2
    assert t["note"]["rewind"] == 1 and t["note"]["last_uuid"]
    r3 = last(post(base, "/api/turn", {"text": "and a base case, simply?", "note_id": nid}))
    assert r3["type"] == "result" and get(base, f"/api/notes/{nid}")["rewind"] == 0
    # edit the very first message: nothing to resume from, so it starts again
    t = post(base, f"/api/notes/{nid}/truncate", {"turn_id": r1["user_turn"]})
    assert t["turns"] == [] and not t["note"]["session_id"] and t["note"]["reseed"] == 0


def test_own_tests_gate_and_anticipation(server):
    base, tmp = server
    nid, eid = exercise(base)
    run = post(base, f"/api/exercises/{eid}/run", {"code": NAIVE})
    assert run["gated"] and all(e["nudge"] == "" for e in run["edge_cases"])          # think first
    out = put(base, f"/api/exercises/{eid}/tests", {"tests": [{"args": [[3, 3], 6], "expected": [0, 1]},
                                                             {"args": [[1, 2], 7], "expected": [0, 0]}]})
    assert [c["agrees"] for c in out["checks"]] == [True, False] and out["checks"][1]["reference"] in ("None", "null")
    assert not out["last"].get("gated") and out["last"]["edge_cases"][0]["nudge"]       # the nudges are back
    run = post(base, f"/api/exercises/{eid}/run", {"code": NAIVE})
    assert len(run["mine"]) == 2 and run["mine"][0]["status"] == "fail"                 # [3,3]: i == j finds 3 + 3 twice
    assert run["edge_cases"][0]["anticipated"] and run["edge_cases"][1]["anticipated"]
    assert not run["edge_cases"][2]["anticipated"]                                      # negatives: not thought of
    ctx_turn = post(base, "/api/turn", {"text": "help", "note_id": nid, "exercise_id": eid})
    assert "wrote 2 tests of their own" in prompt(tmp) and "anticipated 2 of" in prompt(tmp)
    # skipping keeps the gate open without tests
    nid2, eid2 = exercise(base)
    put(base, f"/api/exercises/{eid2}/tests", {"tests": [], "skipped": True})
    assert not post(base, f"/api/exercises/{eid2}/run", {"code": NAIVE}).get("gated")


def test_walkthrough_and_review(server):
    base, tmp = server
    nid, eid = exercise(base)
    tr = post(base, f"/api/exercises/{eid}/trace", {"code": NAIVE, "source": "example", "index": 0})
    assert tr["result"] == [0, 1] and tr["steps"][0]["event"] == "call"
    assert any(s["stack"][-1]["vars"].get("j") == 1 for s in tr["steps"])
    import urllib.error
    try:
        post(base, f"/api/exercises/{eid}/trace", {"code": NAIVE, "source": "edge", "index": 0})
        assert False, "hidden edge cases can't be walked through"
    except urllib.error.HTTPError as e:
        assert e.code == 400
    before = get(base, f"/api/notes/{nid}")["turns"]
    rv = post(base, f"/api/exercises/{eid}/review", {"code": NAIVE})
    assert rv["time"] == "O(n²)" and rv["line"] == 3 and rv["exercise_id"] == eid
    assert get(base, f"/api/notes/{nid}")["turns"] == before             # a side job: the note's conversation is untouched
    assert get(base, f"/api/exercises/{eid}")["cx"]["review"]["time"] == "O(n²)"
