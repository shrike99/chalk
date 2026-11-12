# Contributing to Chalk

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an issue with:

- what you did, what you expected, and what happened;
- your Windows version and Chalk version (**Settings → About**);
- the relevant lines from `%APPDATA%\Chalk\logs` if the backend misbehaved.

Please don't paste anything from your Claude account (tokens, emails) into an issue.

## Making a change

1. Fork the repo and create a branch: `git checkout -b fix/short-description`.
2. Set up the development environment: see [docs/BUILDING.md](docs/BUILDING.md).
3. Make your change. Keep to the style around it: plain names, short functions, and a comment saying
   *why* when it isn't obvious.
4. Run the checks:
   ```bash
   cd backend && python -m pytest tests -q
   cd ../frontend && npx tsc --noEmit
   ```
   Most of the backend can be tested without using Claude at all: set `TUTOR_MOCK=1` (see BUILDING.md).
5. Open a pull request describing what changed and how you tested it. Screenshots help for anything visual.

## Where things live

| Area | Files |
| --- | --- |
| Claude conversation, prompts | `backend/tutor.py`, `backend/script_prompt.md` |
| Practice papers | `backend/docs.py`, `backend/docedit.py`, `frontend/src/paper/` |
| Coding exercises and runners | `backend/exercises.py`, `backend/runner.py`, `backend/complexity.py`, `backend/tracer.py`, `frontend/src/exercise.ts` |
| Animated canvas | `frontend/src/anim/` |
| Desktop shell and installer | `desktop/` |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the bigger picture.
