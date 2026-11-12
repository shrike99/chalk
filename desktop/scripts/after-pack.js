// Puts icon F and Chalk's name and version into Chalk.exe. electron-builder does this with rcedit,
// which needs Windows (or Wine); resedit is pure JavaScript, so this also works when building on Linux.
const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;
  const ResEdit = require("resedit");
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, "..", "build", "icon.ico")));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, iconFile.icons.map((i) => i.data));
  const version = context.packager.appInfo.version;
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const parts = version.split(".").map(Number).concat([0, 0, 0]).slice(0, 4);
    vi.setFileVersion(...parts, 1033);
    vi.setProductVersion(...parts, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: "Chalk", FileDescription: "Chalk", CompanyName: "Chalk", LegalCopyright: "Copyright © 2026 The Chalk authors",
      OriginalFilename: "Chalk.exe", InternalName: "Chalk", FileVersion: version, ProductVersion: version,
    });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log("  • icon F and version info written to", path.basename(exePath));
};
