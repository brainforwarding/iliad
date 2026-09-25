import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchApp, resolveLauncher } from "./launcher.mjs";
import { abbreviateHome, cliSocketPath } from "./paths.mjs";
import { NotRunningError, sendRequest } from "./protocol.mjs";
import {
  bundleWrapperPath,
  commandInstallDirectories,
  InstallError,
  installCliCommand,
  uninstallCliCommand
} from "./install.mjs";
import { installSkill, readSkill } from "./skill.mjs";

export const exitCodes = { ok: 0, error: 1, usage: 2, notRunning: 3 };
export const markdownExtensions = new Set([".md", ".markdown", ".mdown", ".mkd"]);

const coldStartTimeoutMs = 10_000;
const coldStartRetryMs = 250;
const openReplyTimeoutMs = 20_000;
const statusReplyTimeoutMs = 5_000;

export const usage = `Usage:
  iliad [folder]                 Open a folder in Iliad (the last one if omitted)
  iliad status [--json]          Show each Iliad window's folder and open document
  iliad open <file> [--line N]   Show a Markdown file in Iliad, at line N
  iliad skill install            Install the Iliad skill for Claude Code
  iliad skill print              Print the Iliad skill (for AGENTS.md or other agents)
  iliad install [--dir <folder>] [--json]
                                 Put \`iliad\` on PATH (run it from the Iliad MD app:
                                 "/Applications/Iliad MD.app/Contents/Resources/bin/iliad" install)
  iliad uninstall [--json]       Remove the \`iliad\` links that install created

A folder named like a command must be written as a path (iliad ./status).`;

function usageError(error) {
  return { kind: "usage", error };
}

function parseLine(value) {
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }

  const line = Number(value);
  return Number.isSafeInteger(line) && line >= 1 ? line : null;
}

// Mirrors isIgnoredWorkspaceName in electron/fs/pathSafety.ts.
const ignoredNames = new Set(["node_modules", "dist", "dist-electron"]);

export function isIgnoredName(name) {
  return (
    name.startsWith(".") ||
    ignoredNames.has(name) ||
    /^__tmp(?:[-_.]|$)/i.test(name) ||
    name.endsWith(".tmp") ||
    name.endsWith("~")
  );
}

/** True when any folder or file name along an absolute path is hidden or ignored. */
export function hasIgnoredSegment(absolutePath) {
  return absolutePath.split(path.sep).filter(Boolean).some(isIgnoredName);
}

/**
 * Maps CLI arguments to a command. Subcommand names win over folder names;
 * anything else keeps the historical `iliad <folder>` launch behavior.
 */
export function routeArgv(args) {
  if (args.length === 0) {
    return { kind: "launch", args: [] };
  }

  const [command, ...rest] = args;

  if (command === "help" || command === "--help" || command === "-h") {
    return { kind: "help" };
  }

  if (command === "status") {
    const unknown = rest.find((argument) => argument !== "--json");
    return unknown ? usageError(`Unknown option for status: ${unknown}`) : { kind: "status", json: rest.includes("--json") };
  }

  if (command === "open") {
    let file = null;
    let line = null;

    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];

      if (argument === "--line" || argument.startsWith("--line=")) {
        const value = argument === "--line" ? rest[(index += 1)] : argument.slice("--line=".length);
        line = parseLine(value);

        if (line === null) {
          return usageError("--line needs a line number (1 or more).");
        }
      } else if (argument.startsWith("-") && argument !== "-") {
        return usageError(`Unknown option for open: ${argument}`);
      } else if (file === null) {
        file = argument;
      } else {
        return usageError("open takes one file.");
      }
    }

    return file ? { kind: "open", file, line } : usageError("open needs a Markdown file.");
  }

  if (command === "install") {
    let directory = null;
    let json = false;

    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];

      if (argument === "--json") {
        json = true;
      } else if (argument === "--dir" || argument.startsWith("--dir=")) {
        const value = argument === "--dir" ? rest[(index += 1)] : argument.slice("--dir=".length);

        if (!value || value.startsWith("-")) {
          return usageError("--dir needs a folder.");
        }

        directory = value;
      } else {
        return usageError(`Unknown option for install: ${argument}`);
      }
    }

    return { kind: "install", directory, json };
  }

  if (command === "uninstall") {
    const unknown = rest.find((argument) => argument !== "--json");
    return unknown ? usageError(`Unknown option for uninstall: ${unknown}`) : { kind: "uninstall", json: rest.includes("--json") };
  }

  if (command === "skill") {
    if (rest.length === 1 && rest[0] === "install") {
      return { kind: "skill-install" };
    }

    if (rest.length === 1 && rest[0] === "print") {
      return { kind: "skill-print" };
    }

    return usageError("Use `iliad skill install` or `iliad skill print`.");
  }

  return { kind: "launch", args };
}

export function formatStatus(windows, home = os.homedir()) {
  if (!windows.length) {
    return "Iliad is open with no windows.";
  }

  return windows
    .map((window) => {
      const parts = [
        window.workspace ? abbreviateHome(window.workspace, home) : "no folder open",
        window.relativePath ?? (window.document ? abbreviateHome(window.document, home) : "no document open")
      ];

      if (window.focused) {
        parts.push("(focused)");
      }

      return parts.join("  ");
    })
    .join("\n");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runStatus(route, context) {
  let response;

  try {
    response = await context.send({ cmd: "status" }, statusReplyTimeoutMs);
  } catch (error) {
    if (error instanceof NotRunningError) {
      (route.json ? context.stderr : context.stdout)("Iliad is not open.");
      return exitCodes.notRunning;
    }

    context.stderr(`iliad: ${errorMessage(error)}`);
    return exitCodes.error;
  }

  if (!response.ok) {
    context.stderr(`iliad: ${response.error}`);
    return exitCodes.error;
  }

  const windows = Array.isArray(response.windows) ? response.windows : [];
  context.stdout(route.json ? JSON.stringify({ windows }, null, 2) : formatStatus(windows, context.home));
  return exitCodes.ok;
}

async function runOpen(route, context) {
  const requestedPath = path.resolve(context.cwd, route.file);
  let filePath;

  try {
    filePath = await realpath(requestedPath);
  } catch {
    context.stderr(`iliad: File not found: ${route.file}`);
    return exitCodes.error;
  }

  if (!markdownExtensions.has(path.extname(filePath).toLowerCase())) {
    context.stderr(`iliad: Not a Markdown file: ${route.file}`);
    return exitCodes.error;
  }

  // Send both spellings: the requested one (resolved against cwd, symlinks
  // kept) so main can refuse a hidden symlink spelling of a visible target,
  // and the canonical one it opens.
  const request = {
    cmd: "open",
    path: requestedPath,
    canonicalPath: filePath,
    ...(route.line ? { line: route.line } : {})
  };
  let response;

  try {
    response = await context.send(request, openReplyTimeoutMs);
  } catch (error) {
    if (!(error instanceof NotRunningError)) {
      context.stderr(`iliad: ${errorMessage(error)}`);
      return exitCodes.error;
    }

    // With the app closed no window can contain the file, so it would open
    // the file's own folder: refuse hidden/ignored paths like main does.
    if (hasIgnoredSegment(requestedPath) || hasIgnoredSegment(filePath)) {
      context.stderr(`iliad: Iliad does not show hidden or ignored files: ${route.file}`);
      return exitCodes.error;
    }

    try {
      // Cold start: launch the app on the file's folder (never the file or a
      // subcommand as argv), then wait for its socket.
      await context.launch([path.dirname(filePath)]);
      response = await sendWhenRunning(context, request);
    } catch (launchError) {
      context.stderr(`iliad: ${errorMessage(launchError)}`);
      return exitCodes.error;
    }
  }

  if (!response.ok) {
    context.stderr(`iliad: ${response.error}`);
    return exitCodes.error;
  }

  return exitCodes.ok;
}

async function sendWhenRunning(context, request) {
  const deadline = context.now() + coldStartTimeoutMs;

  for (;;) {
    try {
      return await context.send(request, openReplyTimeoutMs);
    } catch (error) {
      if (!(error instanceof NotRunningError)) {
        throw error;
      }

      if (context.now() >= deadline) {
        throw new Error("Iliad did not start in time.");
      }

      await context.sleep(coldStartRetryMs);
    }
  }
}

async function runLaunch(route, context) {
  try {
    await context.launch(route.args);
    return exitCodes.ok;
  } catch (error) {
    context.stderr(`iliad: ${errorMessage(error)}`);
    return exitCodes.error;
  }
}

/** Stable `code` for JSON failures: the InstallError code, or "error". */
function errorCode(error) {
  return error instanceof InstallError && error.code ? error.code : "error";
}

function reportJson(context, value) {
  context.stdout(JSON.stringify(value, null, 2));
}

async function runInstall(route, context) {
  let result;

  try {
    const wrapperPath = await context.wrapperPath();
    result = await installCliCommand({
      wrapperPath,
      directories: context.installDirectories,
      exactDirectory: route.directory ? path.resolve(context.cwd, route.directory) : null,
      pathValue: context.pathValue,
      createMissingDirectory: context.createMissingDirectory
    });
  } catch (error) {
    const message = errorMessage(error);

    if (route.json) {
      reportJson(context, { ok: false, code: errorCode(error), error: message });
    } else {
      context.stderr(`iliad: ${message}`);
    }

    return exitCodes.error;
  }

  if (route.json) {
    reportJson(context, { ok: true, ...result });
    return exitCodes.ok;
  }

  const lines = [
    `${result.action === "unchanged" ? "Already installed" : "Installed"}: ${result.linkPath} -> ${result.target}`
  ];

  if (!result.onPath) {
    lines.push(
      `${result.directory} is not on your PATH. Add it to your shell profile, for example:`,
      `  export PATH="${result.directory}:$PATH"`
    );
  }

  if (result.shadowedBy) {
    lines.push(`Another \`iliad\` comes first on your PATH: ${result.shadowedBy}`);
  }

  if (result.action === "installed") {
    lines.push("Next: `iliad skill install` adds the Iliad skill for Claude Code; other agents can use `iliad skill print`.");
  }

  context.stdout(lines.join("\n"));
  return exitCodes.ok;
}

async function runUninstall(route, context) {
  let result;

  try {
    result = await uninstallCliCommand({ directories: context.installDirectories });
  } catch (error) {
    if (route.json) {
      reportJson(context, { ok: false, code: "error", error: errorMessage(error) });
    } else {
      context.stderr(`iliad: ${errorMessage(error)}`);
    }

    return exitCodes.error;
  }

  if (route.json) {
    reportJson(context, { ok: true, ...result });
    return exitCodes.ok;
  }

  const lines = [
    ...result.removed.map((linkPath) => `Removed: ${linkPath}`),
    ...result.skipped.map((entry) => `Kept: ${entry.linkPath} (${entry.reason})`)
  ];
  context.stdout(lines.length ? lines.join("\n") : "No Iliad command link found.");
  return exitCodes.ok;
}

/**
 * Runs one CLI invocation. Every side effect goes through `deps` so tests can
 * drive it without a running app.
 */
export async function runCli(args, deps = {}) {
  const env = deps.env ?? process.env;
  const home = deps.home ?? env.HOME ?? os.homedir();
  const scriptDirectory = deps.scriptDirectory;
  const cwd = deps.cwd ?? process.cwd();
  const socketPath = deps.socketPath ?? cliSocketPath({ env, home });
  const context = {
    cwd,
    home,
    stdout: deps.stdout ?? ((text) => process.stdout.write(`${text}\n`)),
    stderr: deps.stderr ?? ((text) => process.stderr.write(`${text}\n`)),
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? delay,
    send: deps.send ?? ((request, timeoutMs) => sendRequest(socketPath, request, { timeoutMs })),
    pathValue: deps.pathValue ?? env.PATH ?? "",
    installDirectories: deps.installDirectories ?? commandInstallDirectories(home),
    createMissingDirectory:
      deps.createMissingDirectory !== undefined ? deps.createMissingDirectory : path.join(home, ".local", "bin"),
    wrapperPath: deps.wrapperPath ?? (() => bundleWrapperPath(scriptDirectory)),
    launch:
      deps.launch ??
      ((launchArgs) => launchApp(resolveLauncher({ scriptDirectory, env, home }), launchArgs, { cwd, env }))
  };
  const route = routeArgv(args);

  switch (route.kind) {
    case "help":
      context.stdout(usage);
      return exitCodes.ok;
    case "usage":
      // install/uninstall promise one JSON object for every outcome.
      if ((args[0] === "install" || args[0] === "uninstall") && args.includes("--json")) {
        reportJson(context, { ok: false, code: "usage", error: route.error });
      } else {
        context.stderr(`iliad: ${route.error}\n\n${usage}`);
      }

      return exitCodes.usage;
    case "status":
      return runStatus(route, context);
    case "open":
      return runOpen(route, context);
    case "install":
      return runInstall(route, context);
    case "uninstall":
      return runUninstall(route, context);
    case "skill-install":
      try {
        const target = await installSkill({ scriptDirectory, home });
        context.stdout(`Installed skill: ${target}`);
        return exitCodes.ok;
      } catch (error) {
        context.stderr(`iliad: ${errorMessage(error)}`);
        return exitCodes.error;
      }
    case "skill-print":
      try {
        const text = await readSkill({ scriptDirectory });
        context.stdout(text.endsWith("\n") ? text.slice(0, -1) : text);
        return exitCodes.ok;
      } catch (error) {
        context.stderr(`iliad: ${errorMessage(error)}`);
        return exitCodes.error;
      }
    case "launch":
    default:
      return runLaunch(route, context);
  }
}
