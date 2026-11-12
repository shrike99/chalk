"""Chalk: the backend.

The desktop app starts this itself. To run it by hand:  uvicorn app:app --port 8000
"""

from __future__ import annotations

import asyncio
import tutor
import re
import subprocess
import json
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import claude_cli
import speech
import docs
import docedit
import complexity
import exercises
import runner
import toolchains
from uploads import Uploads, UploadError
import usage as plan_usage
import voice_store
from notes import NoteStore
from tutor import DATA_DIR, EFFORTS, ENGINES, MOCK, worker

VERSION = "2.0.0"
store = NoteStore(DATA_DIR / "notes.db")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    worker.start()
    yield
    await worker.call("disconnect")


app = FastAPI(title="Chalk", lifespan=lifespan)


class TurnRequest(BaseModel):
    text: str
    note_id: str | None = None  # the note this turn belongs to (saved there)
    via: str = "text"  # "voice" or "text"
    mode: str = "tutor"
    diagram: str = ""
    images: list[str] = []  # data URLs of drawings
    attachments: list[str] = []  # ids of uploaded PDFs / images (POST /api/uploads)
    exercise_id: str = ""        # the exercise the student is asking about (its hidden tests go to Claude)
    predictions: list[dict] = [] # what the student predicted during the last walkthrough
    review_code: str = ""        # "Ask Claude to explain" the complexity: the student's code as it is now
    scene: str = ""  # the animated scene on screen, described for Claude
    stage: str = ""  # the world's size for scripts, e.g. "1000 x 930"
    repair: dict | None = None  # {"error", "line", "code"}: the last script failed, ask for a fix




class SettingsRequest(BaseModel):
    model: str | None = None
    effort: str | None = None
    engine: str | None = None
    keep_recordings: bool | None = None
    default_mode: str | None = None
    code_language: str | None = None
    small_model: str | None = None


class NoteCreate(BaseModel):
    mode: str = "tutor"


class NotePatch(BaseModel):
    title: str | None = None
    mode: str | None = None


class CodeRequest(BaseModel):
    code: str


class SpeakRequest(BaseModel):
    text: str
    speed: float = 1.0
    voice: str | None = None


# ---------- status & account ----------
@app.get("/api/status")
def status():
    return {
        "mock": MOCK,
        "stt": speech.stt_available() or MOCK,
        "tts": speech.tts_available() or MOCK,
        "whisper_model": speech.WHISPER_MODEL,
        "version": VERSION,
        "data_dir": str(DATA_DIR),
    }


@app.get("/api/account")
async def account():
    auth = await asyncio.to_thread(claude_cli.auth_status)
    limits = await asyncio.to_thread(plan_usage.get)
    return {"auth": auth, "usage": worker.usage, "limits": limits, "login": claude_cli.login_flow.state()}


@app.get("/api/usage")
async def get_usage(fresh: bool = False):
    """Plan limits per window (session, week, per-model week). limits is null when unavailable."""
    return {"limits": await asyncio.to_thread(plan_usage.get, fresh)}


@app.post("/api/account/login")
async def login():
    try:
        return await asyncio.to_thread(claude_cli.login_flow.start)
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post("/api/account/code")
async def login_code(req: CodeRequest):
    state = await asyncio.to_thread(claude_cli.login_flow.submit_code, req.code)
    await worker.call("disconnect")  # pick up the new login on the next turn
    return state


@app.post("/api/account/logout")
async def logout():
    await worker.call("reset")
    return await asyncio.to_thread(claude_cli.logout)


# ---------- Claude settings & session ----------
@app.get("/api/settings")
async def get_settings():
    if worker.models is None:  # starting the session also fetches the model list
        await worker.call("warmup")
    return {"settings": worker.settings, "models": worker.models or [], "efforts": EFFORTS, "engines": ENGINES}


@app.post("/api/settings")
async def set_settings(req: SettingsRequest):
    if req.effort and req.effort not in EFFORTS:
        raise HTTPException(400, f"effort must be one of {EFFORTS}")
    if req.engine and req.engine not in ENGINES:
        raise HTTPException(400, f"engine must be one of {ENGINES}")
    if req.small_model and req.small_model not in ("haiku", "same"):
        raise HTTPException(400, "small_model must be haiku or same")
    if req.code_language and req.code_language not in exercises.LANGS:
        raise HTTPException(400, f"code_language must be one of {exercises.LANGS}")
    await worker.call("settings", **req.model_dump(exclude_none=True))
    return {"settings": worker.settings}


@app.post("/api/warmup")
async def warmup():
    events = await worker.call("warmup")
    errors = [e for e in events if e["type"] == "error"]
    return {"ok": not errors, "error": errors[0]["message"] if errors else None}


@app.post("/api/session/reset")
async def reset():
    await worker.call("reset")
    await worker.call("warmup")
    return {"ok": True}


@app.post("/api/turn/stop")
async def stop_turn():
    """Stop the message Claude is replying to. The reply stream then ends with a "stopped" event."""
    return {"stopped": await worker.interrupt()}


@app.post("/api/turn")
async def turn(req: TurnRequest):
    """Streams newline-delimited JSON events: stage changes, then the result (or an error)."""
    files = [m for m in (uploads.meta(i) for i in req.attachments[:10]) if m]
    if not req.text.strip() and not req.repair and not files:
        raise HTTPException(400, "Empty message")

    note = store.get(req.note_id) if req.note_id else None
    images = [i for i in req.images[:3] if i.startswith("data:image/") and len(i) < 8_000_000]
    files_note, page_images = await asyncio.to_thread(uploads.for_claude, [m["id"] for m in files])
    files_note += _exercise_context(req.exercise_id) + _prediction_context(req.predictions)
    review_row = store.get_exercise(req.exercise_id) if req.exercise_id and req.review_code.strip() else None
    if review_row:
        files_note += complexity.review_context(review_row["ex"], req.review_code[:100_000], review_row.get("cx"))
    fresh = bool(note and note.get("reseed") and not req.repair)
    seed = await asyncio.to_thread(_seed, note) if fresh else ""
    # If resuming from before a stopped message fails, this light start is the fallback.
    fallback_seed = await asyncio.to_thread(_seed, note) if note and note.get("rewind") and not fresh else ""
    specs = _specs_for(req, note, files)
    user_turn = 0
    if note:
        files_note += _docs_context(note)
        await worker.call("open_note", note_id=note["id"], session_id=note.get("session_id"), context=note.get("context"),
                          last_uuid=note.get("last_uuid"), rewind=note.get("rewind"))
        if not req.repair:
            data: dict = {}
            if images:
                data["images"] = images
            if files:
                data["files"] = [uploads.public(m) for m in files]
            user_turn = store.add_turn(note["id"], "user", req.text, data, via=req.via)
            if req.mode and req.mode != note["mode"]:
                store.update(note["id"], mode=req.mode)

    async def events():
        text = req.text or "(see the attached files)"
        kw = dict(text=text, mode=req.mode, diagram=req.diagram, images=images + page_images, files_note=files_note,
                  scene=req.scene, stage=req.stage, repair=req.repair, fresh=fresh, seed=seed, specs=specs, fallback_seed=fallback_seed)
        sent_images = bool(images or page_images)
        evs = worker.stream("turn", **kw)
        asked_again = False
        async for ev in evs:
            if ev.get("type") == "result" and (ev.get("need_pages") or ev.get("need_format")) and not asked_again:
                # Claude asked to see some pages again, or a format it wasn't given: send them and ask again.
                pages, desc = await asyncio.to_thread(_pages_for, note, ev["need_pages"]) if note and ev.get("need_pages") else ([], "")
                more = [k for k in ev.get("need_format") or [] if k in tutor.SPECS]
                if pages or more:
                    asked_again = True
                    sent_images = sent_images or bool(pages)
                    yield json.dumps({"type": "stage", "stage": "reading" if pages else "writing"}) + "\n"
                    what = "; ".join(x for x in (f"the pages you asked for: {desc}" if pages else "", "the formats you asked for" if more else "") if x)
                    async for ev2 in worker.stream("turn", **{**kw, "fresh": False, "seed": "", "images": pages, "specs": more,
                                                             "text": f"(Chalk: here are {what}.) {text}"}):
                        if ev2.get("type") in ("result", "stopped"):
                            ev = ev2
                            break
                        yield json.dumps(ev2) + "\n"
            if ev.get("type") == "stopped":
                # The student stopped it: forget the message, here and (next turn) in Claude's conversation.
                if note and user_turn:
                    store.delete_turn(user_turn)
                if note:
                    fields: dict = {"rewind": 1 if ev.get("rewind") else 0}
                    if not ev.get("rewind"):
                        fields["session_id"] = ""
                        if any(t for t in store.turns(note["id"])):
                            fields["reseed"] = 1   # there was a conversation before it: start a light one carrying it
                    store.update(note["id"], **fields)
                yield json.dumps(ev) + "\n"
                continue
            if ev.get("type") == "result":
                ev.pop("need_pages", None)
                ev.pop("need_format", None)
            if ev.get("type") == "result" and isinstance(ev.get("doc_edit"), dict):
                ev = {k: v for k, v in ev.items() if k != "doc_edit"} | _apply_edit(note, ev["doc_edit"])
            if ev.get("type") == "result" and isinstance(ev.get("document"), dict) and "kind" in ev["document"] and "id" not in ev["document"]:
                # Keep the document itself in the docs table; the reply only carries a reference.
                d = store.add_doc(note["id"] if note else None, ev["document"])
                ev = {**ev, "document": {"id": d["id"], "kind": d["kind"], "title": d["title"], "summary": docs.summary(d["doc"])}}
            if ev.get("type") == "result" and isinstance(ev.get("exercise"), dict) and "examples" in ev["exercise"]:
                ex = ev["exercise"]
                check = await asyncio.to_thread(exercises.verify, ex)
                eid = store.add_exercise(note["id"] if note else None, ex)
                ev = {**ev, "exercise": {"id": eid, "title": ex["title"], "language": ex["language"], "summary": exercises.summary(ex),
                                         "dropped": len(check.get("dropped", []))}}
            if ev.get("type") == "result" and "complexity_review" in ev:
                review = complexity.clean_review(ev.pop("complexity_review"), req.review_code.count("\n") + 1) if review_row else None
                if review:
                    cx = dict(store.get_exercise(review_row["id"]).get("cx") or {})
                    cx["review"] = {**review, "code": req.review_code[:100_000]}
                    store.update_exercise(review_row["id"], cx=cx)
                    ev = {**ev, "complexity_review": {**review, "exercise_id": review_row["id"]}}
            if ev.get("type") == "result" and note:
                ev = dict(ev)
                _save_reply(note, ev, repaired=bool(req.repair), sent_images=sent_images, fresh=fresh)
                ev = {**ev, "note": store.get(note["id"]), "user_turn": user_turn}
            yield json.dumps(ev) + "\n"
        # The reply just spent some of the plan: send fresh numbers for the usage bars.
        limits = await asyncio.to_thread(plan_usage.get, True)
        if limits:
            yield json.dumps({"type": "limits", **limits}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


_SAY = __import__("re").compile(r"""\bsay\(\s*(["'`])((?:\\.|(?!\1).)*)\1""", __import__("re").S)


def _save_reply(note: dict, ev: dict, repaired: bool, sent_images: bool = False, fresh: bool = False) -> None:
    reply = {k: v for k, v in ev.items() if k not in ("type", "session_id", "note", "last_uuid")}
    spoken = " ".join(b.get("text", "") for b in reply.get("beats") or []) or reply.get("say") or ""
    if not spoken and reply.get("script"):  # an animation: its words are the say("...") calls
        spoken = " ".join(m[1] for m in _SAY.findall(reply["script"]))
    if repaired:
        store.replace_last_tutor(note["id"], spoken, reply)
    else:
        ev["tutor_turn"] = store.add_turn(note["id"], "tutor", spoken, {**reply, "uuid": ev.get("last_uuid")})
    fields: dict = {}
    if ev.get("session_id"):
        fields["session_id"] = ev["session_id"]
    if reply.get("note_title") and not note.get("title_locked"):
        fields["title"] = reply["note_title"]
    elif not note.get("title"):
        first = next((t["text"] for t in store.turns(note["id"]) if t["role"] == "user"), "")
        fields["title"] = (first[:48] + "…") if len(first) > 48 else first
    if reply.get("concepts"):
        fields["concepts"] = reply["concepts"]
    if ev.get("context"):
        fields["context"] = int(ev["context"])
    if ev.get("last_uuid"):
        fields["last_uuid"] = ev["last_uuid"]
    fields["rewind"] = 0
    # Page images and pictures stay in a conversation for good: after a turn that sent some, the next
    # turn starts a light one carrying a record of this one instead.
    if sent_images:
        fields["reseed"] = 1
    elif fresh:
        fields["reseed"] = 0
    store.update(note["id"], **fields)


# ---------- keeping each note's conversation light ----------
_DOC_WORDS = re.compile(r"\b(papers?|exams?|mocks?|worksheets?|mark ?scheme|past papers?|test me|assessments?|interviews?|revision|"
                        r"notes|pdf|print|documents?|questions?|quiz)\b", re.I)
_EXERCISE_WORDS = re.compile(r"\b(exercises?|practi[cs]e|problems?|leetcode|hackerrank|interviews?|coding|code|programs?|functions?|"
                             r"algorithms?|implement|let me try|challenge|python|javascript|java|sql)\b", re.I)


def _specs_for(req: "TurnRequest", note: dict | None, files: list) -> list[str]:
    """Which long format instructions this message might need (Claude gets each once per conversation)."""
    text = req.text or ""
    specs = []
    if files or _DOC_WORDS.search(text) or (note and _current_docs(note["id"])):
        specs.append("doc")
    if req.exercise_id or _EXERCISE_WORDS.search(text):
        specs.append("exercise")
    if files:
        specs.append("files")
    return specs
CONTEXT_NUDGE = 50_000  # tokens: past this, the app suggests continuing in a fresh note


def _clip(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _current_docs(nid: str) -> list[dict]:
    """The newest version of each document in a note, newest first."""
    ds = store.list_docs(nid)
    parents = {d["parent"] for d in ds if d.get("parent")}
    return [d for d in ds if d["id"] not in parents]


def _newest_version(did: str, nid: str) -> str:
    ds = store.list_docs(nid)
    child = {d["parent"]: d["id"] for d in sorted(ds, key=lambda d: d["created"]) if d.get("parent")}
    seen = set()
    while did in child and did not in seen:
        seen.add(did)
        did = child[did]
    return did


def _docs_context(note: dict) -> str:
    cur = _current_docs(note["id"])
    if not cur:
        return ""
    lines = ["", "DOCUMENTS IN THIS NOTE (newest versions; change one with a chalk-doc-edit block):"]
    for d in cur[:4]:
        full = store.get_doc(d["id"])
        if full:
            lines.append(f'- “{full["title"]}” ({full["kind"]}, id {full["id"]}): {docs.summary(full["doc"])}')
    # Right after an edit, the numbering may have moved: show the questions as they are now.
    last = next((t for t in reversed(store.turns(note["id"])) if t["role"] == "tutor"), None)
    edited = ((last or {}).get("data") or {}).get("document") or {}
    if edited.get("edited") and edited.get("id") == cur[0]["id"]:
        full = store.get_doc(cur[0]["id"])
        if full and full["doc"].get("questions"):
            lines += [f'  Its questions now, after your last change:', docedit.outline(full["doc"])]
    return "\n".join(lines) + "\n"


def _apply_edit(note: dict | None, edit: dict) -> dict:
    """Apply Claude's changes to a document; returns fields for the reply (a new document reference or an error)."""
    if not note:
        return {"doc_error": "There's no paper here to change."}
    cur = _current_docs(note["id"])
    did = edit.get("doc") or ""
    target = store.get_doc(_newest_version(did, note["id"])) if did else None
    if not target or target.get("note_id") != note["id"]:
        target = store.get_doc(cur[0]["id"]) if cur else None
    if not target:
        return {"doc_error": "There's no paper in this note to change yet."}
    new, changes, failed = docedit.apply(target["doc"], edit)
    if not new:
        return {"doc_error": "The paper wasn't changed: " + ("; ".join(failed) or "nothing to change") + "."}
    d = store.add_doc(note["id"], new, parent=target["id"], changes=changes)
    out = {"document": {"id": d["id"], "kind": d["kind"], "title": d["title"], "summary": docs.summary(new), "edited": changes}}
    if failed:
        out["doc_error"] = "Some changes couldn't be made: " + "; ".join(failed) + "."
    return out


def _note_files(nid: str) -> list[dict]:
    seen, out = set(), []
    for t in store.turns(nid):
        for f in (t.get("data") or {}).get("files") or []:
            if f.get("id") not in seen:
                seen.add(f.get("id"))
                out.append(f)
    return out


def _pages_for(note: dict, reqs: list[dict]) -> tuple[list[str], str]:
    files = _note_files(note["id"])
    pages, desc = [], []
    for r in reqs:
        name = str(r.get("file", "")).strip().lower()
        f = next((f for f in files if f["name"].lower() == name), None) or next(
            (f for f in files if name and (name in f["name"].lower() or f["name"].lower() in name)), None)
        if not f:
            continue
        got = uploads.page_images(f["id"], r.get("pages") or [1], limit=6 - len(pages))
        if got:
            pages += got
            desc.append(f'{f["name"]} page{"s" if len(got) > 1 else ""} {", ".join(str(p) for p in (r.get("pages") or [1])[:len(got)])}')
        if len(pages) >= 6:
            break
    return pages, "; ".join(desc)


def _record(nid: str, budget: int = 24_000) -> tuple[list[str], list[str]]:
    """(the conversation as a condensed record, Claude's digests of attached files)."""
    lines, digests = [], []
    for t in store.turns(nid):
        d = t.get("data") or {}
        if t["role"] == "user":
            line = "Student: " + _clip(t["text"], 1500)
            for f in d.get("files") or []:
                line += f' [attached {f["name"]}]'
            if d.get("images"):
                line += f' [{len(d["images"])} drawing{"s" if len(d["images"]) > 1 else ""}]'
        else:
            parts = [_clip(t["text"], 1200)] if t["text"].strip() else []
            if d.get("margin"):
                parts.append("(margin) " + _clip(d["margin"], 600))
            doc = d.get("document") or {}
            if doc.get("edited"):
                parts.append(f'[changed “{doc.get("title", "")}”: {"; ".join(doc["edited"])}]')
            elif doc.get("id"):
                parts.append(f'[wrote “{doc.get("title", "")}” ({doc.get("kind", "")})]')
            ex = d.get("exercise") or {}
            if ex.get("title"):
                parts.append(f'[set a {ex.get("language", "")} exercise “{ex["title"]}”]')
            if d.get("script") and not parts:
                parts.append("[an animation]")
            if d.get("files_digest"):
                digests.append(d["files_digest"])
            line = "You: " + " ".join(parts)
        lines.append(line)
    total, kept = 0, []
    for line in reversed(lines):
        total += len(line)
        if total > budget:
            kept.append(f"(… {len(lines) - len(kept)} earlier turns not shown)")
            break
        kept.append(line)
    return list(reversed(kept)), digests


def _seed(note: dict) -> str:
    """What a fresh conversation for this note starts with, instead of replaying the old one."""
    lines = ["[Chalk] This note's conversation continues below. To keep the student's usage low, earlier turns",
             "are carried over as a condensed record instead of being replayed (and files aren't re-sent).",
             "Carry on naturally; don't mention this.", ""]
    if note.get("carry"):
        src = store.get(note["continued_from"]) if note.get("continued_from") else None
        lines += [f'CARRIED OVER from the student\'s earlier note{" “" + src["title"] + "”" if src and src.get("title") else ""}'
                  " (your own summary):", note["carry"].strip(), ""]
    record, digests = _record(note["id"])
    files = _note_files(note["id"])
    if files:
        lines.append("FILES the student attached earlier (you saw every page then):")
        if digests:
            lines += ["Your notes on them:", *[_clip(x, 4000) for x in digests[-3:]]]
        left = 6_000 if digests else 12_000
        for f in files[:6]:
            m = uploads.meta(f["id"])
            lines.append(f'- {f["name"]} ({f.get("pages", 1)} page{"s" if f.get("pages", 1) != 1 else ""})')
            text = "\n".join(t for t in (m or {}).get("text", []) if t.strip())
            if text and left > 0:
                chunk = text[:left]
                left -= len(chunk)
                lines.append("  text: " + chunk.replace("\n", "\n  ") + ("…" if len(chunk) < len(text) else ""))
        lines += ['To see particular pages again, reply with only {"need_pages": [{"file": "<name>", "pages": [n]}]}.', ""]
    if record:
        lines += ["CONVERSATION SO FAR (condensed):", *record, ""]
    cur = _current_docs(note["id"])
    if cur:
        full = store.get_doc(cur[0]["id"])
        if full:
            lines += [f'CURRENT VERSION of “{full["title"]}” (id {full["id"]}); change it with chalk-doc-edit:',
                      docedit.compact(full["doc"]), ""]
    lines.append("[Chalk] The student's new message follows.")
    return "\n".join(lines)


def _local_summary(note: dict) -> str:
    """A plain record to carry over when Claude can't write a summary (or in tests)."""
    record, digests = _record(note["id"], budget=5_000)
    out = (["Topic: " + (note.get("title") or "untitled")]
           + (["Concepts: " + ", ".join(f'{c["name"]} ({c["status"]})' for c in note.get("concepts") or [])] if note.get("concepts") else [])
           + ["Recent conversation:"] + record + (["Notes on attached files:"] + digests[-2:] if digests else []))
    return "\n".join(out)


# ---------- notes ----------
class TruncateBody(BaseModel):
    turn_id: int


@app.post("/api/notes/{nid}/truncate")
async def truncate_note(nid: str, body: TruncateBody):
    """Edit or regenerate: remove a message and everything after it, here and in Claude's conversation
    (the next turn resumes from the reply before it)."""
    note = store.get(nid)
    if not note:
        raise HTTPException(404, "No such note")
    turns = store.turns(nid)
    if not any(t["id"] == body.turn_id for t in turns):
        raise HTTPException(404, "That message is gone.")
    keep = [t for t in turns if t["id"] < body.turn_id]
    store.delete_turns_from(nid, body.turn_id)
    prev = next((t for t in reversed(keep) if t["role"] == "tutor"), None)
    uuid = (prev or {}).get("data", {}).get("uuid")
    if prev and uuid and note.get("session_id"):
        store.update(nid, last_uuid=uuid, rewind=1, reseed=0)
    else:  # nothing to resume from: start again, carrying whatever's left as a condensed record
        store.update(nid, session_id="", rewind=0, last_uuid="", reseed=1 if keep else 0)
    return {"note": store.get(nid), "turns": store.turns(nid)}


@app.post("/api/notes/{nid}/continue")
async def continue_note(nid: str):
    """Start a fresh note that carries a summary of this one (and its newest document)."""
    note = store.get(nid)
    if not note:
        raise HTTPException(404, "No such note")
    if note.get("continued_in") and store.get(note["continued_in"]):
        return {"note": store.get(note["continued_in"])}
    fallback = await asyncio.to_thread(_local_summary, note)
    evs = await worker.call("summarize", session_id=note.get("session_id"), fallback=fallback)
    summary = next((e["text"] for e in evs if e.get("type") == "summary"), fallback)
    title = note.get("title") or "Untitled"
    new = store.create(mode=note["mode"], title=title if title.endswith("(continued)") else f"{title} (continued)")
    cur = _current_docs(nid)
    if cur:
        full = store.get_doc(cur[0]["id"])
        if full:
            store.add_doc(new["id"], full["doc"])
    store.update(new["id"], carry=summary, continued_from=nid, reseed=1, concepts=note.get("concepts") or None)
    store.update(nid, continued_in=new["id"])
    return {"note": store.get(new["id"])}


@app.get("/api/notes")
def notes_list():
    return {"notes": store.list()}


@app.post("/api/notes")
def notes_create(req: NoteCreate):
    return store.create(mode=req.mode)


@app.get("/api/notes/{nid}")
def notes_get(nid: str):
    note = store.get(nid)
    if not note:
        raise HTTPException(404, "No such note")
    return {**note, "turns": store.turns(nid)}


@app.patch("/api/notes/{nid}")
def notes_patch(nid: str, req: NotePatch):
    fields = req.model_dump(exclude_none=True)
    if "title" in fields:
        fields["title_locked"] = 1  # your title wins over Claude's suggestions
    note = store.update(nid, **fields)
    if not note:
        raise HTTPException(404, "No such note")
    return note


@app.delete("/api/notes/{nid}")
async def notes_delete(nid: str):
    store.delete(nid)
    if worker.note_id == nid:
        await worker.call("open_note", note_id=None, session_id=None)
    return {"ok": True}


@app.post("/api/notes/delete-all")
async def notes_delete_all():
    store.delete_all()
    import shutil
    await asyncio.to_thread(shutil.rmtree, uploads.root, True)
    uploads.root.mkdir(parents=True, exist_ok=True)
    await worker.call("open_note", note_id=None, session_id=None)
    return {"ok": True}


@app.get("/api/notes/{nid}/export")
def notes_export(nid: str):
    md = store.export_markdown(nid)
    if not md:
        raise HTTPException(404, "No such note")
    return Response(md, media_type="text/markdown; charset=utf-8")


# ---------------------------------------------------------------- coding exercises
def _exercise_context(eid: str) -> str:
    """When the student asks about an exercise, Claude gets the tests it wrote (including the hidden
    ones) and the latest results, so it can nudge from exactly where they are."""
    row = store.get_exercise(eid) if eid else None
    if not row:
        return ""
    ex, last = row["ex"], row["last"] or {}
    lines = ["", f"EXERCISE CONTEXT (from Chalk, not typed by the student): the exercise \"{ex['title']}\" you set.",
             "Hidden edge cases (the student sees only the nudge unless revealed):"]
    for j, c in enumerate(ex["edge_cases"]):
        edges = last.get("edge_cases") or []
        st = edges[j].get("status", "not run") if j < len(edges) else "not run"
        inp = c.get("args_expr") or json.dumps(c.get("args", c.get("calls", c.get("stdin"))))[:300]
        lines.append(f"  {j + 1}. input {inp} → expected {json.dumps(c.get('expected', c.get('expected_stdout')))[:200]} · latest: {st}"
                     f"{' · revealed' if j in row['revealed'] else ''} · nudge: {c.get('nudge', '')}")
    lines.append("Talk about the first failing case without giving the fix away; the student already sees each nudge.")
    mine = _mine(row)
    if mine:
        hits = exercises.anticipated(ex, mine)
        lines.append(f"The student wrote {len(mine)} test{'s' if len(mine) != 1 else ''} of their own: "
                     + "; ".join(json.dumps(t.get("args", t.get("stdin")))[:120] for t in mine[:6])
                     + f". They anticipated {sum(hits)} of {len(hits)} hidden edge cases.")
    elif _gated(row):
        lines.append("The student hasn't written tests of their own yet, so the nudges are hidden: encourage them to think of tricky inputs.")
    rv = (row.get("cx") or {}).get("review")
    if rv:
        lines.append(f"An earlier complexity check of their code found time {rv.get('time')}, memory {rv.get('space', '?')} (line {rv.get('line', '?')}).")
    cx = (ex.get("complexity") or {})
    line = complexity.context_line(row.get("cx"))
    if line:
        lines.append(line + (f" (Best possible: {cx['time']}" + (f", because: {cx['why']}" if cx.get("why") else "") + ")" if cx.get("time") else ""))
    return "\n".join(lines) + "\n"


def _prediction_context(preds: list[dict]) -> str:
    if not preds:
        return ""
    lines = ["", "PREDICTIONS (from Chalk): during your last walkthrough the student answered:"]
    for p in preds[:12]:
        lines.append(f"  - {str(p.get('question', ''))[:200]} → they said {str(p.get('picked', ''))[:120]}"
                     f" ({'right' if p.get('correct') else 'wrong; the answer was ' + str(p.get('answer', ''))[:120]})")
    lines.append("Use this: build on what they got right, and revisit what they got wrong.")
    return "\n".join(lines) + "\n"


class RunBody(BaseModel):
    code: str = ""


class ShapeBody(BaseModel):
    code: str = ""
    run: dict = {}


class ScratchBody(BaseModel):
    language: str = "python"
    code: str = ""
    stdin: str = ""


def _exercise_out(row: dict) -> dict:
    ex = row["ex"]
    last = row["last"]
    return {"id": row["id"], "note_id": row["note_id"], "exercise": exercises.public(ex, row["revealed"]),
            "summary": exercises.summary(ex), "code": row["code"], "last": _public_last(last),
            "cx": _public_cx(row.get("cx")), "tests": row.get("tests")}


def _public_cx(cx: dict | None) -> dict | None:
    """The complexity check as the student sees it: the best possible big-O only once they ask or reach it."""
    if not cx or not cx.get("result"):
        return cx
    return {**cx, "result": {k: v for k, v in cx["result"].items() if k != "ref"}}


def _public_last(last: dict | None) -> dict | None:
    return {k: v for k, v in last.items() if k != "_raw"} if last else None


@app.get("/api/exercises/{eid}")
async def get_exercise(eid: str):
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404, "That exercise was deleted.")
    return _exercise_out(row)


@app.patch("/api/exercises/{eid}")
async def save_exercise_code(eid: str, body: RunBody):
    if not store.get_exercise(eid):
        raise HTTPException(404)
    store.update_exercise(eid, code=body.code[:100_000])
    return {"ok": True}


class ComplexityBody(BaseModel):
    code: str = ""
    prediction: str = ""
    sizes: list[int] = []
    results: list[dict] = []   # JavaScript: the timings the app measured in its worker


def _reference_band(row: dict) -> int | None:
    """How Claude's own solution measures on these inputs (once, then remembered): a student can't be
    asked to beat what the reference itself shows."""
    ex = row["ex"]
    cx = ex.get("complexity") or {}
    if "ref_band" in cx:
        return cx["ref_band"]
    if ex["language"] == "javascript" or not ex.get("solution"):
        return None
    a = complexity.measure(ex, ex["solution"])
    ex = {**ex, "complexity": {**cx, "ref_band": a.get("band")}}
    store.update_exercise(row["id"], data=ex)
    row["ex"] = ex
    return a.get("band")


def _finish_cx(row: dict, result: dict, prediction: str, code: str) -> dict:
    ref = _reference_band(row) if not result.get("error") and not result.get("missing") else None
    target = complexity.band_of((row["ex"].get("complexity") or {}).get("time", ""))
    if ref is not None and result.get("band") is not None and target is not None and ref > target:
        # Claude's own solution didn't reach its claimed target on these inputs: judge against what it did reach.
        result["can_beat"] = result["band"] > ref
        if not result["can_beat"]:
            cx = row["ex"].get("complexity") or {}
            result.setdefault("why", cx.get("why", ""))
    prev = row.get("cx") or {}
    state = {"prediction": prediction, "result": result, "attempts": int(prev.get("attempts", 0)) + 1,
             "first": prev.get("first") or result, "code": code[:100_000]}
    if not result.get("error") and not result.get("missing"):
        store.update_exercise(row["id"], cx=state)
    return _public_cx(state)  # type: ignore[return-value]


@app.post("/api/exercises/{eid}/complexity")
async def measure_complexity(eid: str, body: ComplexityBody):
    """Time the student's (passing) code on growing inputs and say how it grows."""
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404, "That exercise was deleted.")
    ex = row["ex"]
    if not (ex.get("complexity") or {}).get("sizes"):
        raise HTTPException(400, "This exercise can't be timed.")
    if ex["language"] == "javascript":
        if not body.sizes or not body.results:
            raise HTTPException(400, "JavaScript is timed in the app: send its results.")
        result = complexity.analyse(ex, body.sizes, complexity.collect(body.sizes, body.results), body.prediction)
    else:
        code = body.code[:100_000] or row["code"]
        result = await asyncio.to_thread(complexity.measure, ex, code, body.prediction)
        if result.get("missing"):
            lang = result["missing"]
            raise HTTPException(409, {"missing": lang, "message": f"{exercises.NAMES[lang]} isn't set up on this PC yet."})
    return await asyncio.to_thread(_finish_cx, row, result, body.prediction, body.code)


@app.get("/api/exercises/{eid}/complexity/plan")
async def complexity_plan(eid: str, scale: float = 1):
    """The inputs to time a JavaScript exercise with, built here in Python."""
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404, "That exercise was deleted.")
    try:
        p = await asyncio.to_thread(complexity.plan, row["ex"], max(1 / 64, min(64.0, scale)))
    except (ValueError, subprocess.TimeoutExpired) as e:
        raise HTTPException(400, f"Couldn't build the inputs: {e}")
    if not p:
        raise HTTPException(400, "This exercise can't be timed.")
    return p


def _mine(row: dict) -> list[dict]:
    return (row.get("tests") or {}).get("tests") or []


def _gated(row: dict) -> bool:
    """Hidden edge cases keep their nudges back until the student has tried writing tests of their own."""
    t = row.get("tests") or {}
    return bool(row["ex"]["edge_cases"]) and not t.get("tests") and not t.get("skipped")


def _shape(row: dict, run: dict, revealed: set[int] | None = None) -> dict:
    return exercises.shape_results(row["ex"], run, row["revealed"] if revealed is None else revealed, _mine(row), _gated(row))


class TestsBody(BaseModel):
    tests: list[dict] = []
    skipped: bool | None = None


@app.put("/api/exercises/{eid}/tests")
async def save_tests(eid: str, body: TestsBody):
    """The student's own tests: kept, checked against Claude's reference answer where it can run here."""
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404, "That exercise was deleted.")
    ex = row["ex"]
    mine = exercises.clean_tests(ex, body.tests)
    prev = row.get("tests") or {}
    state = {"tests": mine, "skipped": prev.get("skipped", False) if body.skipped is None else body.skipped}
    store.update_exercise(eid, tests=state)
    checks: list[dict] = []
    if mine and ex.get("solution") and ex["language"] != "javascript":
        r = await asyncio.to_thread(runner.run, ex["language"], ex["solution"], {**exercises.spec(ex, "none", mine), "cases": mine})
        by = {x["i"]: x for x in r.get("results", [])}
        checks = [{"agrees": by.get(k, {}).get("status") == "pass", "reference": by.get(k, {}).get("got")} if k in by else {}
                  for k in range(len(mine))]
    last = row["last"]
    if last:  # re-shape the saved results: the gate may have lifted
        raw = last.get("_raw") or _unshape(ex, last)
        row = {**row, "tests": state}
        last = {**_shape(row, raw), "_raw": raw}
        store.update_exercise(eid, last=last)
    return {"tests": mine, "skipped": state["skipped"], "checks": checks, "last": _public_last(last)}


class TraceBody(BaseModel):
    code: str
    source: str = "example"   # example, mine or edge (revealed ones only)
    index: int = 0


@app.post("/api/exercises/{eid}/trace")
async def trace_exercise(eid: str, body: TraceBody):
    """Step-by-step record of the student's Python on one test, for the code walkthrough."""
    import tracer
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404, "That exercise was deleted.")
    ex = row["ex"]
    if ex["language"] != "python":
        raise HTTPException(400, "The walkthrough works for Python exercises for now.")
    pool = {"example": ex["examples"], "mine": _mine(row), "edge": ex["edge_cases"]}.get(body.source) or []
    if not 0 <= body.index < len(pool) or (body.source == "edge" and body.index not in row["revealed"]):
        raise HTTPException(400, "Pick a test you can see.")
    case = pool[body.index]
    if "args_expr" in case:
        raise HTTPException(400, "That test's input is too big to walk through.")
    return await asyncio.to_thread(tracer.trace_python, body.code[:100_000], ex, case)


REVIEW_SYSTEM = ("You analyse the time and memory complexity of a student's code for a tutoring app. Be exact and brief. "
                 "Never describe a faster approach or what to change.")


@app.post("/api/exercises/{eid}/review")
async def review_complexity(eid: str, body: RunBody):
    """"Ask Claude to explain": a one-off question on the small model, outside the note's conversation."""
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404, "That exercise was deleted.")
    code = body.code[:100_000]
    prompt = (complexity.review_context(row["ex"], code, row.get("cx")) +
              '\nReply with only this JSON: {"time": "O(...)", "space": "O(...)", "n": "what n is", "line": <the line number '
              'doing the costly work>, "because": "one or two sentences about that line", "matches_timing": true|false}')
    mock = json.dumps(tutor._mock_review("explain my code's complexity\n```\n" + code + "\n```")["complexity_review"])
    evs = await worker.call("side", system=REVIEW_SYSTEM, prompt=prompt, mock=mock)
    err = next((e["message"] for e in evs if e.get("type") == "error"), None)
    text = next((e["text"] for e in evs if e.get("type") == "side"), "")
    if err:
        raise HTTPException(502, err)
    m = re.search(r"\{.*\}", text, re.S)
    try:
        raw = json.loads(m.group(0)) if m else None
    except ValueError:
        raw = None
    review = complexity.clean_review(raw, code.count("\n") + 1)
    if not review:
        raise HTTPException(502, "Claude's answer didn't come through. Try again.")
    cx = dict(row.get("cx") or {})
    cx["review"] = {**review, "code": code}
    store.update_exercise(eid, cx=cx)
    return {**review, "exercise_id": eid}


@app.post("/api/exercises/{eid}/run")
async def run_exercise(eid: str, body: RunBody):
    """Python exercises run here, against every test (examples first, then the hidden edge cases)."""
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404, "That exercise was deleted.")
    ex = row["ex"]
    if ex["language"] == "javascript":
        raise HTTPException(400, "JavaScript exercises run in the app.")
    run = await asyncio.to_thread(runner.run, ex["language"], body.code[:100_000], exercises.spec(ex, mine=_mine(row)))
    run["mine_n"] = len(_mine(row))
    if run.get("missing"):
        lang = run["missing"]
        raise HTTPException(409, {"missing": lang, "message": f"{exercises.NAMES[lang]} isn't set up on this PC yet."})
    shaped = _shape(row, run)
    store.update_exercise(eid, code=body.code[:100_000], last={**shaped, "_raw": run})  # raw kept for reveals
    return shaped


@app.get("/api/exercises/{eid}/cases")
async def exercise_cases(eid: str):
    """JavaScript exercises run in the app, so the app needs the cases (not the solution)."""
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404)
    return exercises.spec(row["ex"], mine=_mine(row))


@app.post("/api/exercises/{eid}/results")
async def exercise_results(eid: str, body: ShapeBody):
    """Results of a run done in the app (JavaScript): shaped like a Python run and saved."""
    row = store.get_exercise(eid)
    if not row:
        raise HTTPException(404)
    raw = {**body.run, "mine_n": body.run.get("mine_n", len(_mine(row)))}
    shaped = _shape(row, raw)
    store.update_exercise(eid, code=body.code[:100_000], last={**shaped, "_raw": raw})
    return shaped


@app.post("/api/exercises/{eid}/reveal/{j}")
async def reveal_edge_case(eid: str, j: int):
    row = store.get_exercise(eid)
    if not row or not 0 <= j < len(row["ex"]["edge_cases"]):
        raise HTTPException(404)
    revealed = row["revealed"] | {j}
    last = row["last"]
    if last:  # re-shape the saved results so the revealed case shows its details
        raw = last.get("_raw") or _unshape(row["ex"], last)
        last = {**_shape(row, raw, revealed), "_raw": raw}
    store.update_exercise(eid, revealed=revealed, last=last)
    return {"exercise": exercises.public(row["ex"], revealed), "last": _public_last(last)}


def _unshape(ex: dict, shaped: dict) -> dict:
    """Saved results back into runner form (statuses and whatever details were kept)."""
    res = []
    for i, r in enumerate(shaped.get("examples", [])):
        res.append({"i": i, **{k: r[k] for k in ("status", "got", "error", "line", "stdout", "ms", "bad_call") if k in r}})
    n = len(shaped.get("examples", []))
    for j, r in enumerate(shaped.get("edge_cases", [])):
        res.append({"i": n + j, **{k: r[k] for k in ("status", "got", "error", "line", "stdout", "ms", "bad_call") if k in r}})
    out = {"results": res, "stdout": shaped.get("stdout", ""), "ms": shaped.get("ms"), "mine_n": 0}
    if shaped.get("compile_error"):
        out["compile_error"] = shaped["compile_error"]
    return out


@app.get("/api/toolchains")
async def toolchain_status():
    return {"languages": await asyncio.to_thread(toolchains.status)}


@app.post("/api/toolchains/{lang}")
async def toolchain_install(lang: str):
    try:
        toolchains.install(lang)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.delete("/api/toolchains/{lang}")
async def toolchain_remove(lang: str):
    await asyncio.to_thread(toolchains.remove, lang)
    return {"ok": True}


@app.post("/api/run")
async def run_scratch(body: ScratchBody):
    """Run some Python once (no tests): the editor's scratch mode."""
    if body.language != "python":
        raise HTTPException(400, "Only Python runs here; JavaScript runs in the app.")
    return await asyncio.to_thread(runner.run_python, body.code[:100_000], {"kind": "script", "cases": [{"stdin": body.stdin, "expected_stdout": None}]})


# ---------------------------------------------------------------- uploads (PDFs and images for Claude)
uploads = Uploads(DATA_DIR / "uploads")


@app.post("/api/uploads")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    try:
        meta = await asyncio.to_thread(uploads.add, file.filename or "file", data)
    except UploadError as e:
        raise HTTPException(400, str(e))
    return uploads.public(meta)


@app.get("/api/uploads/{uid}")
async def upload_meta(uid: str):
    m = uploads.meta(uid)
    if not m:
        raise HTTPException(404, "That file was deleted.")
    return uploads.public(m)


@app.get("/api/uploads/{uid}/thumb.png")
async def upload_thumb(uid: str):
    if not uploads.meta(uid):
        raise HTTPException(404)
    return FileResponse(uploads.root / uid / "thumb.png", headers={"Cache-Control": "max-age=86400"})


@app.get("/api/uploads/{uid}/page/{n}.png")
async def upload_page(uid: str, n: int):
    """A page of a file you gave Claude, as an image (for previewing it in Chalk)."""
    p = uploads.page_path(uid, n)
    if not p:
        raise HTTPException(404)
    return FileResponse(p, headers={"Cache-Control": "max-age=86400"})


@app.delete("/api/uploads/{uid}")
async def upload_delete(uid: str):
    uploads.delete(uid)
    return {"ok": True}


@app.get("/api/docs/{did}")
async def get_doc(did: str):
    d = store.get_doc(did)
    if not d:
        raise HTTPException(404, "That document was deleted.")
    return {**d, "summary": docs.summary(d["doc"])}


@app.get("/api/docs")
async def list_docs(note_id: str | None = None):
    return {"docs": [{**d, "summary": ""} for d in store.list_docs(note_id)]}


@app.delete("/api/docs/{did}")
async def delete_doc(did: str):
    store.delete_doc(did)
    return {"ok": True}


@app.get("/api/search")
def search(q: str = ""):
    return {"notes": store.search(q) if q.strip() else store.list()[:20]}


# ---------- speech ----------
@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...), hint: str = Form("")):
    data = await audio.read()
    if worker.settings.get("keep_recordings") and len(data) > 1000:
        rec = DATA_DIR / "recordings"
        rec.mkdir(exist_ok=True)
        (rec / time.strftime("%Y-%m-%d %H-%M-%S.webm")).write_bytes(data)
    if MOCK and not speech.stt_available():  # lets you test the mic path without Whisper
        return {"text": f"(mock transcript of {len(data)} bytes) explain recursion", "stt_ms": 0, "device": "mock"}
    if not speech.stt_available():
        raise HTTPException(503, "faster-whisper is not installed (see README, step 4).")
    if len(data) < 1000:
        return {"text": "", "stt_ms": 0}
    try:
        return await asyncio.to_thread(speech.transcribe, data, hint)
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {e}")


class VoiceRequest(BaseModel):
    voice: str


_mock_voices: dict | None = None


@app.get("/api/voices")
async def voices():
    """Kokoro voices (installed or not) with sizes, plus the speech models on disk."""
    global _mock_voices
    if MOCK and not speech.tts_available():
        _mock_voices = _mock_voices or voice_store.mock_inventory()
        return _mock_voices
    if not speech.tts_available():
        return {"available": False, "voices": [], "models": []}
    return await asyncio.to_thread(voice_store.inventory)


@app.post("/api/voices/download")
async def voice_download(req: VoiceRequest):
    if MOCK and not speech.tts_available():
        for v in (await voices())["voices"]:
            if v["id"] == req.voice: v.update(installed=True, bytes=523_436)
        return await voices()
    try:
        await asyncio.to_thread(voice_store.download, req.voice)
    except Exception as e:
        raise HTTPException(500, f"Download failed: {e}")
    return await voices()


@app.post("/api/voices/delete")
async def voice_delete(req: VoiceRequest):
    if MOCK and not speech.tts_available():
        for v in (await voices())["voices"]:
            if v["id"] == req.voice: v.update(installed=False, bytes=0)
        return await voices()
    await asyncio.to_thread(voice_store.delete, req.voice)
    return await voices()


def _mock_wav(seconds: float = 0.6) -> bytes:
    """A short soft tone, so previews make a sound in mock mode without Kokoro."""
    import io, math, struct, wave
    rate = 24000
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 523 * i / rate) * min(1, (rate * seconds - i) / 2000)))
                               for i in range(int(rate * seconds))))
    return buf.getvalue()


@app.post("/api/speak")
async def speak(req: SpeakRequest):
    if MOCK and not speech.tts_available():
        return Response(_mock_wav(), media_type="audio/wav", headers={"X-TTS-ms": "0"})
    if not speech.tts_available():
        raise HTTPException(503, "Kokoro is not installed (see README, step 4).")
    t0 = time.perf_counter()
    try:
        wav = await asyncio.to_thread(speech.speak, req.text, max(0.5, min(2.0, req.speed)), req.voice)
    except Exception as e:
        raise HTTPException(500, f"Speech synthesis failed: {e}")
    return Response(wav, media_type="audio/wav",
                    headers={"X-TTS-ms": str(int((time.perf_counter() - t0) * 1000))})


# ---------- the interface (built frontend), for the desktop app ----------
_DIST = Path(os.environ.get("CHALK_UI") or Path(__file__).resolve().parent.parent / "frontend" / "dist")
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="ui")
