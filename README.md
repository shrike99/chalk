<p align="center">
  <img src="brand/png/icon-128.png" width="96" height="96" alt="Chalk logo">
</p>

<h1 align="center">Chalk</h1>

<p align="center"><em>Think out loud. Learn it one step at a time.</em></p>

<p align="center">
  A voice-first tutoring notebook for Windows. Talk or type what you're stuck on, and Claude teaches it
  step by step while it draws on a canvas beside your notes. It runs on your own Claude plan, with no API key.
</p>

<p align="center">
  <a href="../../releases/latest"><img alt="Download" src="https://img.shields.io/badge/download-Windows%20installer-4f46e5"></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-555">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-2f7a3c">
</p>

<p align="center">
  <img src="docs/screenshots/canvas.png" width="720" alt="Claude explaining breadth-first search on the canvas, one step at a time">
</p>

---

## Why Chalk?

Asking a chatbot for help usually means getting the answer and learning nothing. Chalk is built the
other way round. It explains one step at a time, it makes you predict before it shows you, and when
you write code it tests your code instead of writing it for you.

- **Voice first.** Hold Space and talk. Claude answers out loud while it animates the explanation:
  graphs, arrays, trees, maths, your own code.
- **Practice papers.** "Make me a 1-hour GCSE-style paper on quadratics", or attach past papers and
  say "follow this format". You get print-ready A4 pages with a mark scheme, as a PDF.
- **Coding practice that makes you think.** Exercises run in Chalk in Python, JavaScript, Java, C or
  SQL, against hidden edge cases. You write your own tests first, step through your code line by line,
  and once it passes, find out how fast it really is.
- **Uses your Claude plan.** Chalk signs in to your Claude account (Pro or Max). There's no API key to
  set up and no extra bill, and Chalk works hard to keep each message light on your usage limits.
- **Private and local.** Notes live on your PC. Speech recognition (Whisper) and Claude's voice (Kokoro)
  run on your own graphics card.

## Features

| | |
| --- | --- |
| **Step-by-step canvas** | Explanations play as animated steps you can pause, rewind and replay. Click anything in a diagram to ask about it. |
| **Four modes** | Tutor, Thinking partner, Quiz, Just answer, chosen per note. |
| **Predict, then check** | Claude stops mid-explanation and asks what happens next before it shows you. |
| **Files** | Drop in PDFs, photos of notes or screenshots. Claude sees every page. |
| **Practice papers** | Papers, worksheets, interview sets and revision notes with drawn graphs, geometry and circuits. You can edit one question at a time. |
| **Coding exercises** | Five languages, hidden edge cases with hints, your own tests, and a code walkthrough with a live variable view. |
| **"How fast is it?"** | Once every test passes, predict the complexity and Chalk times your code as the input doubles. Claude can explain which line costs the most. |
| **Conversation control** | Stop a message, edit and resend it, regenerate a reply, or interrupt Claude just by talking. |
| **Usage aware** | See your 5-hour and weekly limits, how heavy each note is, and continue in a fresh note when one gets long. Small jobs run on Haiku. |

<table>
  <tr>
    <td><img src="docs/screenshots/practice-paper.png" alt="A practice paper in the viewer"></td>
    <td><img src="docs/screenshots/own-tests.png" alt="Writing your own tests for an exercise"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/walkthrough.png" alt="Stepping through code with the variables drawn"></td>
    <td><img src="docs/screenshots/complexity.png" alt="Timing a solution as the input doubles"></td>
  </tr>
</table>

## Install

1. Download **`Chalk-Setup-<version>.exe`** from the [latest release](../../releases/latest) and run it.
   The installer isn't code-signed, so Windows SmartScreen may warn you: click **More info → Run anyway**.
   Chalk installs for your user account only, so no administrator rights are needed.
2. **The first launch takes a couple of minutes.** Chalk sets up a private Python in `%LOCALAPPDATA%\Chalk`.
   You don't need Python installed, and Chalk won't touch a copy you already have.
3. **Sign in with Claude** in the browser tab that opens.
4. *Optional:* install the **voice pack** (about 3 GB) from the welcome screen for speech recognition and
   a natural voice. It uses an NVIDIA GPU if you have one.

**Requirements:** Windows 10 or 11 (64-bit) and a Claude Pro or Max subscription. An NVIDIA GPU is
recommended for the voice pack. Java and C exercises need a compiler; Chalk can download one for you
from **Settings → Coding**.

See the **[user guide](docs/USER_GUIDE.md)** for everything Chalk can do, its shortcuts, and troubleshooting.

## Build it yourself

You need **Windows 10/11**, **[Node.js 20+](https://nodejs.org)** and **Git**. Python isn't needed to
build the installer.

```powershell
git clone https://github.com/<your-username>/chalk.git
cd chalk
.\scripts\build-windows.ps1
```

The installer is written to `desktop\dist\Chalk-Setup-<version>.exe`. The script builds the interface,
downloads `uv` (the single-file Python manager Chalk uses on first launch), and packages everything
with electron-builder. You can also double-click `scripts\build-windows.bat`.

Pushing a version tag (`git tag v2.0.0 && git push --tags`) makes GitHub Actions build the installer and
attach it to a release. See [`.github/workflows/release.yml`](.github/workflows/release.yml).

For development setup, the project layout and running the tests, see **[docs/BUILDING.md](docs/BUILDING.md)**.
For how the pieces fit together, see **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## How it works, briefly

```
Electron shell ──► FastAPI backend (Python) ──► Claude Agent SDK ──► your Claude account
      │                    │
      │                    ├─ SQLite notes, uploads, practice papers
      │                    ├─ code runners: Python · JavaScript · Java · C · SQLite
      │                    └─ Whisper (speech in) · Kokoro (speech out)
      └─ TypeScript UI (Vite): notebook, animated canvas, exercise panel, paper viewer
```

Claude replies with a short script that drives the canvas animation, plus structured blocks for papers
and exercises. Chalk validates and repairs these blocks before showing them. Code runs on your PC with
time limits, never through Claude.

## Privacy

- Notes, uploads and settings stay on your PC (`%APPDATA%\Chalk`).
- What you say and type, and the files you attach, go to Claude to answer you, under your own Claude
  account's terms.
- Speech-to-text and text-to-speech run locally once the voice pack is installed.
- Chalk ignores your Claude Code configuration (MCP servers, plugins, CLAUDE.md), so none of it is sent
  with your messages.

## Contributing

Issues and pull requests are welcome. Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** first.

## License

[MIT](LICENSE). Chalk is an independent project, not affiliated with or endorsed by Anthropic. "Claude"
is a trademark of Anthropic. Bundled fonts and third-party components are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
