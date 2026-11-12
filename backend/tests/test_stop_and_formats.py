"""Stopping a message, and sending the long format instructions only when (and once) they're needed."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import tutor  # noqa: E402

FIXTURES = {
    "ask_format": '```json\n{"need_format": ["exercise"]}\n```',
    "ask_format_after": '```json\n{"say": "Here is your exercise."}\n```',
}


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("stop")
    fx = tmp / "fixtures"
    fx.mkdir()
    for k, v in FIXTURES.items():
        (fx / f"{k}.txt").write_text(v, "utf-8")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {**os.environ, "TUTOR_MOCK": "1", "CHALK_DATA": str(tmp / "data"), "CHALK_FIXTURES": str(fx), "CHALK_MOCK_WAIT": "1.5"}
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", "--port", str(port)], cwd=HERE.parent, env=env,
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


def post(base, path, body=None):
    req = urllib.request.Request(base + path, data=json.dumps(body or {}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
    return [json.loads(x) for x in raw.splitlines() if x.strip()] if path == "/api/turn" else json.loads(raw)


def get(base, path):
    return json.loads(urllib.request.urlopen(base + path).read())


def prompt(tmp):
    return json.loads((tmp / "data" / "last_prompt.json").read_text("utf-8"))["prompt"]


def last(evs):
    return next(e for e in reversed(evs) if e["type"] in ("result", "stopped", "error"))


def test_system_prompt_is_small_and_sessions_are_isolated():
    assert len(tutor.PROMPTS["script"]) // 4 < 3500
    assert "chalk-doc" in tutor.PROMPTS["script"] and "need_format" in tutor.PROMPTS["script"]
    assert "Following a format" not in tutor.PROMPTS["script"]          # the long paper format isn't in every message
    w = tutor.ClaudeWorker()
    o = w._options()
    assert o.setting_sources == [] and o.strict_mcp_config and o.mcp_servers == {} and o.tools == []


def test_formats_go_once_and_only_when_needed(server):
    base, tmp = server
    nid = post(base, "/api/notes", {"mode": "tutor"})["id"]
    post(base, "/api/turn", {"text": "what's a hash map?", "note_id": nid})
    assert "FORMAT INSTRUCTIONS" not in prompt(tmp)
    post(base, "/api/turn", {"text": "give me a coding exercise on it", "note_id": nid})
    p = prompt(tmp)
    assert "FORMAT INSTRUCTIONS" in p and "chalk-exercise" in p and "Following a format" not in p
    post(base, "/api/turn", {"text": "another exercise please", "note_id": nid})
    assert "FORMAT INSTRUCTIONS" not in prompt(tmp)                       # already in this conversation
    post(base, "/api/turn", {"text": "now write me a practice paper", "note_id": nid})
    assert "Following a format" in prompt(tmp)


def test_claude_can_ask_for_a_format(server):
    base, tmp = server
    nid = post(base, "/api/notes", {"mode": "tutor"})["id"]
    evs = post(base, "/api/turn", {"text": "fixture:ask_format hmm", "note_id": nid})
    r = last(evs)
    assert r["type"] == "result" and r["say"] == "Here is your exercise." and "need_format" not in r
    p = prompt(tmp)
    assert p.startswith("FORMAT INSTRUCTIONS") and "(Chalk: here are the formats you asked for.)" in p


def stop_soon(base, delay=0.6):
    def go():
        time.sleep(delay)
        post(base, "/api/turn/stop")
    threading.Thread(target=go, daemon=True).start()


def test_stopping_drops_the_message(server):
    base, tmp = server
    nid = post(base, "/api/notes", {"mode": "tutor"})["id"]
    post(base, "/api/turn", {"text": "what's recursion?", "note_id": nid})
    before = get(base, f"/api/notes/{nid}")
    stop_soon(base)
    evs = post(base, "/api/turn", {"text": "oops wrong thing", "note_id": nid})
    assert last(evs) == {"type": "stopped", "rewind": True}
    after = get(base, f"/api/notes/{nid}")
    assert [t["text"] for t in after["turns"]] == [t["text"] for t in before["turns"]]   # the stopped message is gone
    assert after["rewind"] == 1
    # the next message carries on from before it
    evs = post(base, "/api/turn", {"text": "what's a base case?", "note_id": nid})
    assert last(evs)["type"] == "result"
    n = get(base, f"/api/notes/{nid}")
    assert n["rewind"] == 0 and [t["role"] for t in n["turns"]] == ["user", "tutor", "user", "tutor"]
    assert post(base, "/api/turn/stop") == {"stopped": False}           # nothing running: nothing to stop


def test_stopping_the_first_message_starts_clean(server):
    base, tmp = server
    nid = post(base, "/api/notes", {"mode": "tutor"})["id"]
    stop_soon(base, 0.3)
    evs = post(base, "/api/turn", {"text": "first thing", "note_id": nid})
    assert last(evs) == {"type": "stopped", "rewind": False}
    n = get(base, f"/api/notes/{nid}")
    assert n["turns"] == [] and not n["session_id"] and n["reseed"] == 0
