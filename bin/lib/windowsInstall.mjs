import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execute = promisify(execFile);
const marker = "@rem Iliad managed command v1";
export function windowsCommandDirectory(env = process.env, home = os.homedir()) {
  return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Iliad", "bin");
}
const samePath = (a, b) => path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase();
export function updatePathValue(value, directory, add) {
  const entries = value ? value.split(";") : [];
  const present = entries.some(entry => samePath(entry, directory));
  if (add) return present ? value : [...entries, directory].join(";");
  return present ? entries.filter(entry => !samePath(entry, directory)).join(";") : value;
}

/** Registry values travel as environment data, never interpolated PowerShell code. */
export async function userPath(value) {
  const script = value === undefined
    ? '$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment"); $v = if ($k) { $k.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { "" }; ConvertTo-Json -Compress ([string]$v)'
    : '$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment"); $kind = if ($k.GetValueNames() -contains "Path") { $k.GetValueKind("Path") } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }; $k.SetValue("Path", $env:ILIAD_NEW_USER_PATH, $kind); $k.Close(); Add-Type -Namespace Iliad -Name EnvironmentNotify -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);\'; $r = [UIntPtr]::Zero; [void][Iliad.EnvironmentNotify]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, "Environment", 2, 1000, [ref]$r)';
  const encoded = Buffer.from('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ' + script, "utf16le").toString("base64");
  const { stdout } = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    windowsHide: true, timeout: 15000, env: { ...process.env, ...(value === undefined ? {} : { ILIAD_NEW_USER_PATH: value }) }
  });
  return value === undefined ? JSON.parse(stdout.replace(/^\uFEFF/, "").trim()) : value;
}

async function readOptional(file) {
  try { return await readFile(file, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function windowsShim(wrapperPath) {
  const bin = path.dirname(wrapperPath);
  const executable = path.resolve(bin, "..", "..", "Iliad MD.exe");
  const quote = value => value.replaceAll("%", "%%");
  return `${marker}\r\n@echo off\r\nsetlocal DisableDelayedExpansion\r\nfor /f "tokens=2 delims=:" %%C in ('chcp') do set "_ILIAD_CODEPAGE=%%C"\r\nchcp 65001 >nul\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"${quote(executable)}" "${quote(path.join(bin, "iliad.mjs"))}" %*\r\nset "_ILIAD_EXIT=%errorlevel%"\r\nchcp %_ILIAD_CODEPAGE% >nul\r\nexit /b %_ILIAD_EXIT%\r\n`;
}

export async function installWindowsCommand({ wrapperPath, directory = windowsCommandDirectory(), pathStore = userPath, pathValue = process.env.PATH ?? "" }) {
  await mkdir(directory, { recursive: true });
  const linkPath = path.join(directory, "iliad.cmd");
  const old = await readOptional(linkPath);
  if (old !== null && !old.startsWith(marker + "\r\n")) throw new Error(`Another command exists at ${linkPath}; it was not replaced.`);
  const contents = windowsShim(wrapperPath);
  const oldPath = await pathStore();
  const nextPath = updatePathValue(oldPath, directory, true);
  const ownershipPath = path.join(directory, ".iliad-path-owned");
  const oldOwnership = await readOptional(ownershipPath);
  // Record ownership only when Iliad adds the entry, so uninstall preserves a preexisting PATH.
  await writeFile(linkPath, contents, { flag: old === null ? "wx" : "w" });
  try {
    if (nextPath !== oldPath) await writeFile(ownershipPath, "1");
    if (nextPath !== oldPath) await pathStore(nextPath);
  } catch (error) {
    if (old === null) await unlink(linkPath); else await writeFile(linkPath, old);
    if (oldOwnership === null) await unlink(ownershipPath).catch(() => {}); else await writeFile(ownershipPath, oldOwnership);
    throw error;
  }
  let shadowedBy = null;
  search: for (const entry of pathValue.split(";").filter(Boolean)) {
    if (samePath(entry, directory)) break;
    for (const extension of [".com", ".exe", ".bat", ".cmd", ".ps1"]) {
      const candidate = path.join(entry, `iliad${extension}`);
      if (await stat(candidate).then(value => value.isFile(), () => false)) { shadowedBy = candidate; break search; }
    }
  }
  return { action: old === contents ? "unchanged" : "installed", linkPath, directory, target: wrapperPath, onPath: true, shadowedBy };
}

export async function uninstallWindowsCommand({ directories = [windowsCommandDirectory()], pathStore = userPath }) {
  const removed = [], skipped = [];
  for (const directory of directories) {
    const linkPath = path.join(directory, "iliad.cmd");
    const old = await readOptional(linkPath);
    if (old === null) continue;
    if (!old.startsWith(marker + "\r\n")) { skipped.push({ linkPath, reason: "not an Iliad command" }); continue; }
    const ownershipPath = path.join(directory, ".iliad-path-owned");
    if (await readOptional(ownershipPath) !== null) {
      const value = await pathStore();
      await pathStore(updatePathValue(value, directory, false));
      await unlink(ownershipPath);
    }
    await unlink(linkPath);
    removed.push(linkPath);
  }
  return { removed, skipped };
}
