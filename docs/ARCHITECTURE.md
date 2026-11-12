# Architecture

Chalk is three programs working together on one PC.

```
┌──────────────────────────── Electron (desktop/) ─────────────────────────────┐
│  first-run setup: uv → private Python 3.12 → pip install requirements        │
│  starts the backend, opens the window, prints PDFs (printToPDF)              │
│                                                                              │
│   ┌─────────── UI (frontend/, TypeScript + Vite) ───────────┐                │
│   │ notebook · animated canvas · exercise panel · viewer   │ ── HTTP/NDJSON ─┐│
│   └────────────────────────────────────────────────────────┘                ││
└─────────────────────────────────────────────────────────────────────────────┘│
                                                                               ▼
┌───────────────────────────── Backend (backend/, FastAPI) ─────────────────────┐
│ app.py      API: notes, turns (streamed), docs, uploads, exercises, settings  │
│ tutor.py    one long-lived Claude session per open note (Claude Agent SDK)   │
│ notes.py    SQLite: notes, turns, docs, exercises                            │
│ runner.py   Python · Java · C · SQLite runners (subprocess, time limits)     │
│ speech.py   Whisper (speech → text) · Kokoro (text → speech), on the GPU     │
└──────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼  Claude Agent SDK → bundled Claude Code CLI
                            the student's Claude account (Pro or Max plan)
```

## A turn

1. The UI posts the student's message to `/api/turn` (with any attachments, the canvas state, and the
   exercise being asked about).
2. `app.py` builds the context: attached pages (sent once), the documents in the note, the exercise's
   state. It decides which long format instructions the message might need (papers, exercises), and
   `tutor.py` sends each one at most once per conversation.
3. The worker sends it to Claude in that note's session and streams progress ("thinking", "writing")
   back as NDJSON.
4. Claude's reply holds:
   - a small JSON block (spoken text, note title, concepts) and a JavaScript **director script** that
     drives the canvas. The script runs in a sandboxed Web Worker (`frontend/src/anim/`);
   - optional ```chalk-doc (a practice paper), ```chalk-doc-edit (changes to one) or ```chalk-exercise
     blocks. These are parsed, repaired (LaTeX inside JSON is a common casualty) and validated.
5. The backend stores the reply, verifies a new exercise's tests against Claude's reference solution,
   and returns everything to the UI.

## Keeping conversations light

Every message re-sends the conversation so far, so Chalk keeps it small:

- Sessions are isolated from the user's own Claude Code setup (`setting_sources=[]`, strict MCP config).
- Page images are sent once. The next turn starts a fresh session seeded with a condensed record, Claude's
  notes on the files, and the current paper. Claude can ask for specific pages again.
- Papers are edited with question-level operations instead of being rewritten.
- A per-note context meter and a "continue in a fresh note" flow, with a summary written by Haiku.
- Stopping, editing or regenerating a message resumes the session from the reply before it
  (`resume_session_at`), so dropped messages really are forgotten.

## Code exercises

- **Runners** (`runner.py`): Python runs in a subprocess harness with a time limit per case. Java
  compiles, then a reflection harness (`harness/ChalkHarness.java`) calls the method. C gets a harness
  generated from the function signature. SQL runs on in-memory SQLite. JavaScript runs in a Web Worker
  in the UI.
- **Hidden edge cases** come with nudges. The student's own tests run first. `exercises.anticipated()`
  matches their tests to edge cases by input features (empty, duplicates, negatives…).
- **Complexity** (`complexity.py`) times passing code on doubling input sizes built by Claude's
  `args_expr`, fits the growth exponent, and compares it with the best possible complexity.
- **Walkthrough** (`tracer.py`) records every line of a Python run with `sys.settrace`, including the
  stack and variables, for the step player.

## Practice papers

`docs.py` defines the `chalk-doc` format (paper, worksheet, interview or notes; questions, parts,
marks, answer spaces, multiple-choice, mark scheme). Figures are drawn from a small description
language (plots, geometry, circuits). Figures are never copied from uploads. `frontend/src/paper/`
lays the document out on A4 pages, and the same pages are used for the on-screen preview and the PDF,
so they always match.
