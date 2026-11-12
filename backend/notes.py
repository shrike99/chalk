"""Notes: everything you and Claude wrote, kept in one local SQLite file.

A note is one conversation (with its own resumed Claude session). Its turns are what you said
(typed or spoken, plus any drawing) and Claude's replies (including the animation scripts, so
the visuals can be rebuilt exactly when you reopen the note).
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'tutor',
  session_id TEXT,
  concepts TEXT NOT NULL DEFAULT '[]',
  title_locked INTEGER NOT NULL DEFAULT 0, -- you renamed it: Claude stops suggesting titles
  created REAL NOT NULL,
  updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  role TEXT NOT NULL,           -- 'user' | 'tutor'
  via TEXT NOT NULL DEFAULT '', -- 'voice' | 'text' (user turns)
  text TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}', -- user: {"images": [...]}; tutor: the reply object
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_note ON turns(note_id, id);
CREATE TABLE IF NOT EXISTS docs (
  id TEXT PRIMARY KEY,
  note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,           -- 'paper' | 'worksheet' | 'notes'
  title TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,           -- the document Claude wrote (questions, mark scheme, sections)
  created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_note ON docs(note_id, created);
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
  data TEXT NOT NULL,              -- the exercise, including Claude's hidden tests and reference solution
  code TEXT,                       -- the student's latest code
  revealed TEXT NOT NULL DEFAULT '[]',  -- edge cases the student asked to see
  last TEXT,                       -- the latest run's results
  created REAL NOT NULL,
  updated REAL NOT NULL
);
"""


class NoteStore:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(_SCHEMA)
        self._migrate()
        self.lock = threading.Lock()

    # Columns added after 1.0; older databases get them on first start.
    _ADDED = {
        "notes": {"context": "INTEGER NOT NULL DEFAULT 0",   # tokens Claude read on this note's last turn
                  "reseed": "INTEGER NOT NULL DEFAULT 0",    # next turn starts a fresh, light conversation
                  "carry": "TEXT",                           # summary carried over from the note it continues
                  "continued_from": "TEXT", "continued_in": "TEXT",
                  "last_uuid": "TEXT",                       # the last message of the last finished turn in Claude's conversation
                  "rewind": "INTEGER NOT NULL DEFAULT 0"},   # a message was stopped: resume from last_uuid, without it
        "docs": {"parent": "TEXT", "changes": "TEXT"},
        "exercises": {"cx": "TEXT", "tests": "TEXT"},           # the complexity check; the student's own tests                         # the complexity check: prediction and measurement       # an edited version: the one it came from, and what changed
    }

    def _migrate(self) -> None:
        for table, cols in self._ADDED.items():
            have = {r[1] for r in self.db.execute(f"PRAGMA table_info({table})")}
            for name, decl in cols.items():
                if name not in have:
                    self.db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
        self.db.commit()

    # ----- notes -----
    def create(self, mode: str = "tutor", title: str = "") -> dict:
        now = time.time()
        nid = uuid.uuid4().hex[:12]
        with self.lock, self.db:
            self.db.execute("INSERT INTO notes (id, title, mode, created, updated) VALUES (?, ?, ?, ?, ?)", (nid, title, mode, now, now))
        return self.get(nid)  # type: ignore[return-value]

    def get(self, nid: str) -> dict | None:
        row = self.db.execute("SELECT * FROM notes WHERE id = ?", (nid,)).fetchone()
        return self._note(row) if row else None

    def list(self) -> list[dict]:
        rows = self.db.execute(
            "SELECT n.*, (SELECT text FROM turns t WHERE t.note_id = n.id AND t.role = 'user' ORDER BY t.id LIMIT 1) AS first "
            "FROM notes n ORDER BY n.updated DESC").fetchall()
        return [self._note(r) for r in rows]

    def update(self, nid: str, **fields: Any) -> dict | None:
        allowed = {k: v for k, v in fields.items() if k in ("title", "mode", "session_id", "concepts", "title_locked", "context", "reseed",
                                                            "carry", "continued_from", "continued_in", "last_uuid", "rewind") and v is not None}
        if "concepts" in allowed:
            allowed["concepts"] = json.dumps(allowed["concepts"])
        if allowed:
            sets = ", ".join(f"{k} = ?" for k in allowed)
            with self.lock, self.db:
                self.db.execute(f"UPDATE notes SET {sets}, updated = ? WHERE id = ?", (*allowed.values(), time.time(), nid))
        return self.get(nid)

    def delete(self, nid: str) -> None:
        with self.lock, self.db:
            self.db.execute("DELETE FROM notes WHERE id = ?", (nid,))

    def delete_all(self) -> None:
        with self.lock, self.db:
            self.db.execute("DELETE FROM exercises")
            self.db.execute("DELETE FROM docs")
            self.db.execute("DELETE FROM turns")
            self.db.execute("DELETE FROM notes")

    # ----- documents (practice papers, worksheets, revision notes) -----
    def add_doc(self, nid: str | None, doc: dict, parent: str | None = None, changes: list[str] | None = None) -> dict:
        did = uuid.uuid4().hex[:12]
        with self.lock, self.db:
            self.db.execute("INSERT INTO docs (id, note_id, kind, title, data, created, parent, changes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (did, nid, doc.get("kind", "notes"), doc.get("title", ""), json.dumps(doc), time.time(), parent,
                             json.dumps(changes) if changes else None))
        return self.get_doc(did)  # type: ignore[return-value]

    def get_doc(self, did: str) -> dict | None:
        r = self.db.execute("SELECT * FROM docs WHERE id = ?", (did,)).fetchone()
        if not r:
            return None
        return {"id": r["id"], "note_id": r["note_id"], "kind": r["kind"], "title": r["title"], "created": r["created"],
                "parent": r["parent"], "changes": json.loads(r["changes"] or "[]"), "doc": json.loads(r["data"])}

    def list_docs(self, nid: str | None = None) -> list[dict]:
        q = "SELECT id, note_id, kind, title, created, parent FROM docs"
        rows = self.db.execute(q + (" WHERE note_id = ? ORDER BY created DESC" if nid else " ORDER BY created DESC"),
                               (nid,) if nid else ()).fetchall()
        return [dict(r) for r in rows]

    def delete_doc(self, did: str) -> None:
        with self.lock, self.db:
            self.db.execute("DELETE FROM docs WHERE id = ?", (did,))

    # ----- coding exercises -----
    def add_exercise(self, nid: str | None, ex: dict) -> str:
        eid = uuid.uuid4().hex[:12]
        now = time.time()
        with self.lock, self.db:
            self.db.execute("INSERT INTO exercises (id, note_id, data, code, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
                            (eid, nid, json.dumps(ex), ex.get("starter", ""), now, now))
        return eid

    def get_exercise(self, eid: str) -> dict | None:
        r = self.db.execute("SELECT * FROM exercises WHERE id = ?", (eid,)).fetchone()
        if not r:
            return None
        return {"id": r["id"], "note_id": r["note_id"], "ex": json.loads(r["data"]), "code": r["code"] or "",
                "revealed": set(json.loads(r["revealed"] or "[]")), "last": json.loads(r["last"]) if r["last"] else None,
                "cx": json.loads(r["cx"]) if r["cx"] else None,
                "tests": json.loads(r["tests"]) if r["tests"] else {"tests": [], "skipped": False}}

    def update_exercise(self, eid: str, code: str | None = None, revealed: set[int] | None = None, last: dict | None = None,
                        cx: dict | None = None, data: dict | None = None, tests: dict | None = None) -> None:
        sets, vals = ["updated = ?"], [time.time()]
        if tests is not None:
            sets.append("tests = ?"); vals.append(json.dumps(tests))
        if cx is not None:
            sets.append("cx = ?"); vals.append(json.dumps(cx))
        if data is not None:
            sets.append("data = ?"); vals.append(json.dumps(data))
        if code is not None:
            sets.append("code = ?"); vals.append(code)
        if revealed is not None:
            sets.append("revealed = ?"); vals.append(json.dumps(sorted(revealed)))
        if last is not None:
            sets.append("last = ?"); vals.append(json.dumps(last))
        with self.lock, self.db:
            self.db.execute(f"UPDATE exercises SET {', '.join(sets)} WHERE id = ?", (*vals, eid))

    # ----- turns -----
    def delete_turns_from(self, nid: str, tid: int) -> None:
        """Remove a turn and everything after it in that note (editing or regenerating a message)."""
        with self.lock, self.db:
            self.db.execute("DELETE FROM turns WHERE note_id = ? AND id >= ?", (nid, tid))

    def delete_turn(self, tid: int) -> None:
        with self.lock, self.db:
            self.db.execute("DELETE FROM turns WHERE id = ?", (tid,))

    def add_turn(self, nid: str, role: str, text: str, data: dict | None = None, via: str = "") -> int:
        now = time.time()
        with self.lock, self.db:
            cur = self.db.execute("INSERT INTO turns (note_id, role, via, text, data, created) VALUES (?, ?, ?, ?, ?, ?)",
                                  (nid, role, via, text, json.dumps(data or {}), now))
            self.db.execute("UPDATE notes SET updated = ? WHERE id = ?", (now, nid))
            return int(cur.lastrowid or 0)

    def replace_last_tutor(self, nid: str, text: str, data: dict) -> None:
        """A fixed animation replaces the reply it repairs, rather than adding a second one."""
        row = self.db.execute("SELECT id FROM turns WHERE note_id = ? AND role = 'tutor' ORDER BY id DESC LIMIT 1", (nid,)).fetchone()
        if not row:
            self.add_turn(nid, "tutor", text, data)
            return
        with self.lock, self.db:
            self.db.execute("UPDATE turns SET text = ?, data = ? WHERE id = ?", (text, json.dumps(data), row["id"]))

    def turns(self, nid: str) -> list[dict]:
        rows = self.db.execute("SELECT * FROM turns WHERE note_id = ? ORDER BY id", (nid,)).fetchall()
        return [{"id": r["id"], "role": r["role"], "via": r["via"], "text": r["text"], "data": json.loads(r["data"] or "{}"),
                 "created": r["created"]} for r in rows]

    def search(self, q: str, limit: int = 20) -> list[dict]:
        like = f"%{q.strip()}%"
        rows = self.db.execute(
            "SELECT n.*, (SELECT text FROM turns t WHERE t.note_id = n.id AND t.text LIKE ? ORDER BY t.id LIMIT 1) AS hit "
            "FROM notes n WHERE n.title LIKE ? OR EXISTS (SELECT 1 FROM turns t WHERE t.note_id = n.id AND t.text LIKE ?) "
            "ORDER BY n.updated DESC LIMIT ?", (like, like, like, limit)).fetchall()
        return [{**self._note(r), "hit": r["hit"] or ""} for r in rows]

    def export_markdown(self, nid: str) -> str:
        note = self.get(nid)
        if not note:
            return ""
        out = [f"# {note['title'] or 'Untitled'}", ""]
        for t in self.turns(nid):
            if t["role"] == "user":
                out += [t["text"], ""]
            else:
                d = t["data"]
                spoken = " ".join(b.get("text", "") for b in d.get("beats") or []) or d.get("say") or t["text"]
                out += ["> **Claude:** " + spoken.replace("\n", "\n> ")]
                if d.get("margin"):
                    out += [">", "> " + str(d["margin"]).replace("\n", "\n> ")]
                if d.get("script"):
                    out += ["", "<details><summary>Animation script</summary>", "", "```js", d["script"], "```", "", "</details>"]
                out += [""]
        return "\n".join(out)

    @staticmethod
    def _note(r: sqlite3.Row) -> dict:
        d = dict(r)
        d["concepts"] = json.loads(d.get("concepts") or "[]")
        first = d.pop("first", None)
        d["preview"] = (first or "")[:120]
        return d
