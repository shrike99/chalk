// Downloads uv (a single-file Python manager, from astral-sh/uv on GitHub) for Windows into vendor/uv.
// Chalk uses it on first launch to set up a private Python, so you don't need Python installed.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const https = require("https");

const VERSION = process.env.UV_VERSION || "latest";
const target = process.argv[2] || "x86_64-pc-windows-msvc";
const url = VERSION === "latest"
  ? `https://github.com/astral-sh/uv/releases/latest/download/uv-${target}.zip`
  : `https://github.com/astral-sh/uv/releases/download/${VERSION}/uv-${target}.zip`;
const outDir = path.join(__dirname, "..", "vendor", "uv");
const exe = path.join(outDir, target.includes("windows") ? "uv.exe" : "uv");
if (fs.existsSync(exe) && !process.env.UV_FORCE) { console.log("uv already present:", exe); process.exit(0); }
fs.mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, "uv.zip");

function get(u, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(u, { headers: { "User-Agent": "chalk-build" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) return resolve(get(res.headers.location, dest, redirects + 1));
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on("finish", () => f.close(resolve));
    }).on("error", reject);
  });
}

(async () => {
  console.log("Downloading", url);
  await get(url, zip);
  // unzip without extra dependencies: PowerShell on Windows, unzip elsewhere
  if (process.platform === "win32") execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force '${zip}' '${outDir}'`]);
  else execFileSync("unzip", ["-o", "-j", zip, "-d", outDir]);
  fs.rmSync(zip);
  for (const f of fs.readdirSync(outDir)) if (!["uv.exe", "uv", "uvx.exe", "uvx"].includes(f)) fs.rmSync(path.join(outDir, f), { recursive: true, force: true });
  console.log("uv ready:", exe);
  process.exit(0); // don't wait for idle network connections
})().catch((e) => { console.error(e); process.exit(1); });
