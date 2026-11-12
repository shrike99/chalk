// The setup screen: follows the main process's progress events.
const $ = (id) => document.getElementById(id);
const dark = matchMedia("(prefers-color-scheme: dark)").matches;
if (dark) { $("icon").src = "assets/icon-f-dark.svg"; $("mark").src = "assets/icon-f-dark.svg"; }
const ORDER = ["python", "libraries", "starting"];
const lines = [];

function setStep(step) {
  const i = ORDER.indexOf(step);
  document.querySelectorAll(".steps li").forEach((li) => {
    const j = ORDER.indexOf(li.dataset.step);
    li.className = j < i ? "done" : j === i ? "now" : "";
  });
}

window.chalk?.setup.onEvent((ev) => {
  if (ev.phase === "start") {
    $("quick").hidden = true;
    $("panel").hidden = false;
    $("actions").hidden = true;
    if (!ev.fresh) {
      $("title").textContent = "Updating Chalk";
      $("sub").textContent = "Installing what changed in this version. This only takes a moment.";
      document.querySelector('[data-step="python"]').className = "done";
    }
  }
  if (ev.phase === "step") {
    setStep(ev.step);
    if (ev.pct) $("bar").firstElementChild.style.width = `${ev.pct}%`;
  }
  if (ev.phase === "log" && ev.line) {
    lines.push(ev.line);
    if (lines.length > 300) lines.shift();
    $("log").textContent = lines.join("\n");
    $("log").scrollTop = $("log").scrollHeight;
  }
  if (ev.phase === "done") {
    document.querySelectorAll(".steps li").forEach((li) => (li.className = "done"));
    $("bar").firstElementChild.style.width = "100%";
  }
  if (ev.phase === "error") {
    $("quick").hidden = true;
    $("panel").hidden = false;
    $("title").textContent = "Chalk couldn't start";
    $("sub").textContent = ev.message || "Something went wrong.";
    $("actions").hidden = false;
    document.querySelectorAll(".steps li.now").forEach((li) => (li.className = ""));
    if (ev.detail) { lines.push(ev.detail); $("log").textContent = lines.join("\n"); document.querySelector("details").open = true; }
  }
});

$("retry").onclick = () => { $("actions").hidden = true; $("title").textContent = "Trying again…"; window.chalk.setup.retry(); };
$("reset").onclick = () => { $("actions").hidden = true; $("title").textContent = "Starting over…"; lines.length = 0; window.chalk.setup.reset(); };
$("logs").onclick = () => window.chalk.setup.openLogs();
