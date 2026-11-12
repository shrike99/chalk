# Chalk user guide

Everything Chalk does, and how to use it.

## Getting around

| | |
| --- | --- |
| **Talk** | Hold **Space** (when you're not typing) or **Ctrl+Space** anywhere, speak, let go. Esc cancels. |
| **Type** | Enter sends, Shift+Enter is a new line. |
| **Code** | The **{ }** button, typing ```` ``` ````, or just pasting code opens a code editor. Ctrl+Enter sends. |
| **Draw** | The pencil lets you draw on the canvas (over Claude's diagram) or a blank page. It's sent with your next message. |
| **Pace** | **Next** and **I'm stuck** under Claude's latest note. ← → step through the diagram; the dots jump to any step. |
| **Ask about anything** | Click something in a diagram, or select text in your notes, to ask Claude about it. |
| **Modes** | Tutor, Thinking partner, Quiz, Just answer: in the bottom bar, per note. |
| **Files** | The paperclip, dragging files onto the window, or pasting a screenshot gives Claude PDFs and images: past papers, worksheets, photos of your notes or a diagram. |
| **Practice papers** | Ask for a past paper, mock exam, worksheet, coding interview or revision notes ("make me a 1-hour GCSE-style paper on quadratics"), or use Ctrl+K → *Make a practice paper*. Attach past papers and say "follow the format of these" to get one laid out the same way. |
| **Ctrl+K** | Search notes and run any command (new note, export, theme, personas…). |
| **Ctrl+N / Ctrl+E** | New note / export this note as Markdown. |
| **Ctrl+\\ / Ctrl+.** | Show or hide the notes list / focus mode. |
| **Esc** | Stops Claude speaking. |

**The orb** in the bottom bar shows what's happening at a glance: white and still when idle, graphite
and pulsing while it listens to you (with a red dot: red only ever means recording), an indigo shimmer
while Claude thinks, and glowing indigo while Claude speaks. Click it while Claude speaks to stop.

**Notes** are kept on your PC. Each note is its own conversation with Claude, and reopening one rebuilds
its diagrams exactly. Claude names new notes and tracks the key ideas as chips under the title:
hollow = new, half = shaky, filled = understood.

**Practice papers and notes** appear as a card under Claude's reply. **Open** shows the A4 pages in
the viewer: switch between *Paper* and *Mark scheme*, zoom (Ctrl + / Ctrl − / Ctrl 0 to fit), **Print**,
or **Save PDF**. The preview and the PDF are made from the same pages, so they match exactly. Papers are
original questions written in the style of the exam you name; they're never official papers.

**Following a format.** Claude sees each PDF page as an image (so it can copy the layout) and reads
its text (so it gets the wording right). It matches the cover page and its fields, how questions are
numbered and parts labelled, how marks are shown, sections, answer spaces (lines, boxes, tables,
tick boxes, code boxes), the mark scheme's conventions, the length and the timing. The content is
always new: new questions, numbers and contexts, and figures Claude draws itself (it never reuses
a diagram from your file).

**Coding exercises.** Ask for practice ("give me a problem on hash maps"), or ask Claude to just write
code you should learn to write: in Tutor, Partner and Quiz modes it sets an exercise instead. The
exercise opens in the canvas panel with an editor. **Run** (Ctrl+Enter) checks your code against
Claude's tests on your own PC (Python runs in Chalk's own Python; JavaScript in a sandboxed worker).
Examples are shown in full; **edge cases are hidden**: inputs Claude picked to break code that only
handles the examples (empty input, duplicates, negatives, a huge input to catch slow solutions).
When one fails you get a nudge, a question about the input, not the fix; you can ask to see the
case, take a hint, or **Ask Claude**, which sends your code and results (and the hidden tests) so
it can help from exactly where you are without handing over the answer. Claude also writes a
reference solution you never see: Chalk runs it against Claude's own tests first and drops any
test it fails, so you're never marked wrong by a wrong expected answer.

In the exercise panel, drag the bar between your code and the test results to share the space
(double-click it to reset); the size is remembered.

**Your own tests first.** Before Chalk shows its hints for the hidden edge cases, it asks you to
think of tricky inputs yourself: add a few tests (an input and the answer you expect). They run
every time, before the hidden ones; Chalk checks your expected answers against Claude's reference
solution, and marks each hidden edge case "You thought of this" or "You didn't test this". You
can skip straight to the hints too.

**Code walkthrough.** On any example, your own test or a revealed edge case, **Walk through** runs
your Python step by step: the current line lights up in the editor, and every variable is drawn,
lists as numbered boxes and dicts as key → value, with changes highlighted. Use ← → (or play).
No Claude, no tokens. Python only for now.

**How fast is it?** Once every test passes, Chalk asks for your solution's time complexity: pick
O(n), O(n²) and so on. Then it times your code on inputs that keep doubling in size, plots how
the time grows against straight-line and n² growth, and tells you whether your guess was right.
If Claude knows a faster approach exists ("O(n) is possible"), you get a bonus round: change your
code, time it again, or ask for a nudge (a question about what your code repeats, never the
answer). Reach the best complexity and Chalk shows why it's the best. **Ask Claude to explain** sends
your code and the timing: Claude gives its exact time and memory complexity and highlights the
line responsible, without saying how to make it faster. Stopwatches can't tell
O(n) from O(n log n), so those count as the same. Timing works in every language except SQL.

**Languages.** Exercises can be in Python, JavaScript, Java, C or SQL. Pick your **default language**
in Settings → Coding: Claude uses it for exercises and for code in explanations and practice
papers, unless you ask for another or the topic needs one. Python, JavaScript and SQL (SQLite) are
built in. Java and C run with a compiler: Chalk uses one already on your PC (`javac`, `gcc`,
`clang`), or downloads one with one click, from Settings → Coding or straight from the exercise
(Java: Eclipse Temurin JDK 21, about 190 MB; C: TinyCC, under 1 MB). Downloads go to
`%LOCALAPPDATA%\Chalk\toolchains` and can be removed again. SQL exercises show the sample tables;
their hidden edge cases are extra rows (NULLs, ties, empty groups), and a wrong query shows the
rows you returned next to the expected ones. C exercises check return values and arrays changed in
place, and catch crashes (an out-of-range index) with a plain-English message.

**Changing a paper.** Ask for one question to be different ("make question 3 harder", "add a
multiple-choice question after 5", "take out 2(b)") and Claude sends just that change; Chalk
applies it, renumbers the questions after it and keeps the mark scheme in step. The changed paper
is saved as a new version (the card says what changed), and the old version still opens from its
own card.

**Edit and regenerate.** Hover one of your messages and click the pencil to change it and send it
again; **Regenerate** under Claude's last reply asks again. Either way Claude forgets the old
message and everything after it, and carries on from the reply before.

**Interrupting by voice.** While Claude speaks, just start talking: it stops, listens, and sends
when you pause (Settings → Claude & voice; best with headphones). Holding Space still works.

**Stopping a message.** While Claude is working on your message, the send button becomes a stop
button (or press Esc). The message is taken out of the note and put back in the box to fix, and
Claude's conversation carries on from before it, as if it was never sent.

**Keeping your usage down.** Every message in a note has Claude re-read that note's conversation,
so long notes cost more per message. Chalk keeps them light:
- The note's header shows how much each message there costs (for example "24k context"). Past
  about 50k tokens, Chalk suggests **continuing in a fresh note**: Claude writes a short summary of
  where you are, and the new note starts with it and your latest paper. The new note links back,
  and you can read exactly what was carried over.
- Attached files are sent to Claude once. On the next message, the note's conversation starts
  afresh, carrying a condensed record of what was said, Claude's own notes on your files and their
  text, but not the page images. If Claude needs a page again it asks, and Chalk sends just that
  page.
- Changing a paper sends only the change, not a second copy of the whole paper.
- Chalk's conversations with Claude ignore your own Claude Code setup (its settings, CLAUDE.md
  files, MCP servers, plugins and skills), which would otherwise ride along with every message.
- Small jobs run on Haiku (Settings → Claude & voice → Small jobs): the summary for a fresh note and
  "Ask Claude to explain" complexity checks. The explanation is a separate one-off question, so it
  doesn't add to the note's conversation either.
- The long instructions for writing papers and exercises go to Claude only when a message might
  need them, and only once per conversation. Click the context number to see where a note's
  tokens are.

**Predict, then check.** In step-by-step animations Claude sometimes stops and asks what happens
next (which node leaves the queue, what the pointer does). Click, press a key, or hold Space and
say it; you see straight away if you were right and why, then watch it happen. Your answers go to
Claude with your next message, so it builds on what you got right and revisits what you didn't.

**Figures.** Graphs (functions, line graphs, bar charts, graph paper), geometry (triangles,
polygons, circles, angles, right-angle marks, side lengths) and circuits (UK symbols, series and
parallel, voltmeters) are described by Claude and drawn by Chalk, so they're exact. Anything else
(apparatus, number lines, Venn diagrams) Claude draws as SVG. Big
PDFs: every page's text goes to Claude, plus up to 18 page images (the cover and first pages, some
from the middle, and the last page). Scans and photos work too; they're read from the images.

**Usage**: the bar at the bottom of the notes list is your current 5-hour session; hover it for the
weekly limits, or click it for all of them with their reset times (the same numbers as Claude's own
usage page).

**Settings** (bottom of the notes list, or Ctrl+,):
- *General*: theme (system, light, dark) and reduced motion.
- *Claude & voice*: account, model (Haiku, Sonnet, Opus), effort, your Pro usage, and microphone test.
  Also Kokoro voices (preview, download, remove) and speaking speed.
- *Visuals*: **Animated** (Claude writes an animation script, so things move) or **Classic** (28 ready-made diagram kinds).
- *Privacy*: keeping recordings, the data folder, and deleting everything.

## Where things are

| What | Where |
| --- | --- |
| Your notes and settings | `%APPDATA%\Chalk\data` (`notes.db`, `settings.json`) |
| Logs (for troubleshooting) | `%APPDATA%\Chalk\logs` |
| Private Python, libraries, voice pack | `%LOCALAPPDATA%\Chalk\runtime` |
| Java and C compilers Chalk downloaded | `%LOCALAPPDATA%\Chalk\toolchains` |
| Speech models (Whisper, Kokoro) | `%USERPROFILE%\.cache\huggingface` |

Uninstalling Chalk (Windows Settings → Apps) keeps your notes. Delete the folders above to remove everything.

## Troubleshooting

- **Setup failed:** check your internet connection and click **Try again**. **Start over** deletes the private
  Python and sets it up again. **Open logs** shows what happened.
- **"You're not signed in to Claude":** Settings → Claude & voice → Sign in with Claude.
- **Voice input does nothing:** install the voice pack. If Windows blocks the microphone, allow it in
  *Windows Settings → Privacy & security → Microphone* (for desktop apps).
- **Slow replies:** Settings → Claude & voice → Model **Sonnet**, Effort **Low** is the quickest for voice.
- **Something looks wrong:** F12 opens the developer tools; the logs folder has the backend's output.
