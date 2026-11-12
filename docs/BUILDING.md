# Building and developing Chalk

## Project layout

```
chalk/
├── backend/       Python (FastAPI): the API, the Claude session, notes, runners, speech
│   ├── app.py           HTTP API and streaming turns
│   ├── tutor.py         Claude session worker, prompts, reply parsing
│   ├── docs.py          practice papers (chalk-doc), docedit.py question-level edits
│   ├── exercises.py     coding exercises, runner.py code runners, toolchains.py Java/C downloads
│   ├── complexity.py    "how fast is it?" timing, tracer.py code walkthrough
│   ├── uploads.py       PDFs and images, notes.py SQLite store, usage.py plan limits
│   ├── speech.py        Whisper and Kokoro (optional voice pack)
│   └── tests/           pytest suite and the end-to-end paper scenarios
├── frontend/      TypeScript + Vite: the interface
│   └── src/             main.ts, exercise.ts, settingsView.ts, anim/ (canvas), paper/ (A4 pages)
├── desktop/       Electron shell: window, first-run setup, packaging (electron-builder)
├── brand/         logo and icons
├── docs/          user guide, architecture, this file
└── scripts/       build scripts
```

## Prerequisites

| To… | You need |
| --- | --- |
| Build the Windows installer | Windows 10/11, Node.js 20+ |
| Develop the app | the above, plus Python 3.12 |
| Use Claude while developing | a Claude Pro or Max account (or mock mode, below) |

## Build the installer

```powershell
.\scripts\build-windows.ps1            # or double-click scripts\build-windows.bat
```

The script runs these steps, which you can also run yourself:

```powershell
cd frontend; npm ci; npm run build; cd ..
cd desktop;  npm ci; npm run fetch-uv
npx electron-builder --win nsis --x64 --publish never
```

Output: `desktop\dist\Chalk-Setup-<version>.exe`. The version comes from `desktop/package.json`; keep
`VERSION` in `backend/app.py` in step with it.

| Flag | What it does |
| --- | --- |
| `-SkipInstall` | Don't run `npm ci` (faster rebuilds). |
| `-Unpacked` | Build an unpacked folder (`desktop\dist\win-unpacked\Chalk.exe`) instead of an installer: handy for testing. |

### Building on Linux or macOS

electron-builder can make the Windows installer on other systems using Wine:

```bash
cd frontend && npm ci && npm run build && cd ..
cd desktop && npm ci && npm run fetch-uv
npx electron-builder --win nsis --x64 --publish never      # needs wine (wine64) installed
```

### Releases from GitHub

`.github/workflows/release.yml` builds the installer on a Windows runner whenever you push a tag
starting with `v`, and attaches it to a GitHub release:

```bash
git tag v2.0.0
git push origin v2.0.0
```

`.github/workflows/ci.yml` runs the backend tests and the TypeScript type check on every push and pull request.

### Code signing

The installer isn't signed, so SmartScreen warns on first run. To sign it, set electron-builder's
`CSC_LINK` and `CSC_KEY_PASSWORD` environment variables (a code-signing certificate) and remove
`"signAndEditExecutable": false` from `desktop/package.json`.

## Develop

### In a browser (quickest)

```powershell
.\start.bat
```

This starts the backend on http://127.0.0.1:8000 (creating `backend\.venv` the first time) and the Vite
dev server on http://localhost:5173, then opens it.

Or run them separately:

```bash
cd backend && python -m venv .venv && .venv/Scripts/activate   # source .venv/bin/activate elsewhere
pip install -r requirements-dev.txt     # the app's packages plus pytest
python -m uvicorn app:app --port 8000

cd frontend && npm install && npm run dev
```

### The desktop shell

With the backend and Vite running as above:

```bash
cd desktop && npm install && npm run dev
```

Electron loads the Vite dev server, so UI changes reload live.

### Mock mode (no Claude needed)

Set `TUTOR_MOCK=1` before starting the backend and it answers with canned replies instead of calling
Claude. That's how the test suite works, and it's ideal for UI work.

- Type `bfs`, `sort`, `bst`, `showcase`, `graph`, `maths` or `broken` for animated demos, or send any code block.
- "Give me a python coding exercise" (or javascript, java, c, sql) opens an exercise. "Write me a practice paper" makes a paper.
- `TUTOR_MOCK_REPLY=path\to\reply.txt` replays a saved raw reply.
- `CHALK_FIXTURES=dir` plus a message containing `fixture:name` replays `dir/name.txt`.

## Tests

```bash
cd backend
python -m pytest tests -q                       # unit and API tests (mock mode, no Claude)
python tests/e2e_assessments.py /tmp/chalk-e2e  # end-to-end practice-paper scenarios
```

- The Java and C tests skip themselves if `javac` or a C compiler isn't installed.
- The end-to-end run needs the frontend built, Playwright (`pip install playwright && playwright install chromium`;
  set `CHALK_CHROME` to use another Chrome), poppler and reportlab. It
  uploads realistic past papers, checks what reaches Claude, and renders every generated paper to PDF,
  checking for clipped pages, broken maths and missing figures.

## Configuration (environment variables)

| Variable | Used for |
| --- | --- |
| `CHALK_DATA` | where notes, settings and uploads are kept (the desktop app uses `%APPDATA%\Chalk\data`) |
| `CHALK_UI` | the built frontend folder the backend serves |
| `CHALK_TOOLCHAINS` | where downloaded Java and C compilers go |
| `TUTOR_MOCK` | `1` = canned replies instead of Claude |
| `TUTOR_MOCK_REPLY`, `CHALK_FIXTURES` | replay saved replies in mock mode |
| `CHALK_MOCK_WAIT` | how long a mock reply "thinks" (seconds; tests use it to try stopping) |
| `CHALK_USAGE_MOCK` | fake plan usage for the usage meter: the usage endpoint's JSON, inline |
| `CHALK_TOOLCHAIN_URL_JAVA`, `CHALK_TOOLCHAIN_URL_C` | download compilers from a mirror (or a local file in tests) |
| `CHALK_DEV_URL` | the desktop shell loads this URL instead of the bundled UI |
| `UV_VERSION`, `UV_FORCE` | which `uv` the build downloads, and whether to re-download it |
