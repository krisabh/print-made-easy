/**
 * Embed PrintYantra icon.ico into the packaged Windows executable.
 * Needed because electron-builder's signAndEditExecutable path pulls
 * winCodeSign (symlink privileges) which fails on typical Windows setups.
 */
const fs = require("fs");
const path = require("path");
const ResEdit = require("resedit");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(__dirname, "icon.ico");
  const version = String(context.packager.appInfo.version || "");

  if (!fs.existsSync(exePath)) {
    throw new Error(`afterPack: executable not found: ${exePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`afterPack: icon not found: ${iconPath}`);
  }

  const exeBuffer = fs.readFileSync(exePath);
  const exe = ResEdit.NtExecutable.from(exeBuffer, true);
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);

  if (iconGroups.length === 0) {
    throw new Error("afterPack: no existing icon group in executable to replace");
  }

  for (const group of iconGroups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      group.id,
      group.lang,
      iconFile.icons.map((icon) => icon.data),
    );
  }

  const versionInfos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  for (const ver of versionInfos) {
    for (const langInfo of ver.getAvailableLanguages()) {
      const next = {
        ProductName: "PrintYantra Agent",
        FileDescription: "PrintYantra Agent",
        CompanyName: "PrintYantra",
        InternalName: "PrintYantra Agent",
        OriginalFilename: "PrintYantra Agent.exe",
        LegalCopyright: "Copyright © PrintYantra",
      };
      if (version) {
        next.ProductVersion = version;
        next.FileVersion = version;
      }
      ver.setStringValues(langInfo, next);

      if (version) {
        const parts = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
        while (parts.length < 4) parts.push(0);
        ver.setFileVersion(parts[0], parts[1], parts[2], parts[3], langInfo.lang);
        ver.setProductVersion(parts[0], parts[1], parts[2], parts[3], langInfo.lang);
      }
    }
    ver.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`afterPack: embedded PrintYantra icon into ${exeName}`);
};
