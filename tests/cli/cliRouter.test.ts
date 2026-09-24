import { mkdtemp, readFile, realpath, symlink, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exitCodes, formatStatus, routeArgv, runCli } from "../../bin/lib/cli.mjs";
import { cliSocketPath, userDataDirectory } from "../../bin/lib/paths.mjs";
import { NotRunningError } from "../../bin/lib/protocol.mjs";

const repoBin = path.resolve(__dirname, "../../bin");

describe("routeArgv", () => {
  it("keeps `iliad` and `iliad <folder>` as launches", () => {
    expect(routeArgv([])).toEqual({ kind: "launch", args: [] });
    expect(routeArgv(["."])).toEqual({ kind: "launch", args: ["."] });
    expect(routeArgv(["./status"])).toEqual({ kind: "launch", args: ["./status"] });
    expect(routeArgv(["~/book", "--flag"])).toEqual({ kind: "launch", args: ["~/book", "--flag"] });
  });

  it("routes status with an optional --json", () => {
    expect(routeArgv(["status"])).toEqual({ kind: "status", json: false });
    expect(routeArgv(["status", "--json"])).toEqual({ kind: "status", json: true });
    expect(routeArgv(["status", "--nope"]).kind).toBe("usage");
  });

  it("routes open with a file and an optional line", () => {
    expect(routeArgv(["open", "a.md"])).toEqual({ kind: "open", file: "a.md", line: null });
    expect(routeArgv(["open", "a.md", "--line", "42"])).toEqual({ kind: "open", file: "a.md", line: 42 });
    expect(routeArgv(["open", "--line=7", "a.md"])).toEqual({ kind: "open", file: "a.md", line: 7 });
    expect(routeArgv(["open"]).kind).toBe("usage");
    expect(routeArgv(["open", "a.md", "--line"]).kind).toBe("usage");
    expect(routeArgv(["open", "a.md", "--line", "0"]).kind).toBe("usage");
    expect(routeArgv(["open", "a.md", "--line", "x"]).kind).toBe("usage");
    expect(routeArgv(["open", "a.md", "--line", "9".repeat(400)]).kind).toBe("usage");
    expect(routeArgv(["open", "a.md", "--line", "9007199254740992"]).kind).toBe("usage");
    expect(routeArgv(["open", "a.md", "--line", "9007199254740991"])).toMatchObject({ line: 9007199254740991 });
    expect(routeArgv(["open", "a.md", "b.md"]).kind).toBe("usage");
  });

  it("routes skill install / print and rejects anything else", () => {
    expect(routeArgv(["skill", "install"])).toEqual({ kind: "skill-install" });
    expect(routeArgv(["skill", "print"])).toEqual({ kind: "skill-print" });
    expect(routeArgv(["skill"]).kind).toBe("usage");
    expect(routeArgv(["skill", "remove"]).kind).toBe("usage");
    expect(routeArgv(["--help"])).toEqual({ kind: "help" });
  });
});

describe("paths", () => {
  it("uses the packaged userData by default, iliad-dev for dev runs, and ILIAD_USER_DATA over both", () => {
    const home = "/Users/w";
    expect(userDataDirectory({ env: {}, platform: "darwin", home })).toBe("/Users/w/Library/Application Support/Iliad MD");
    expect(userDataDirectory({ env: { VITE_DEV_SERVER_URL: "http://x" }, platform: "darwin", home })).toBe(
      "/Users/w/Library/Application Support/iliad-dev"
    );
    // Same rule as electron/main.ts: only VITE_DEV_SERVER_URL selects the dev profile.
    expect(userDataDirectory({ env: { ILIAD_DEV: "1" }, platform: "darwin", home })).toBe(
      "/Users/w/Library/Application Support/Iliad MD"
    );
    expect(cliSocketPath({ env: { ILIAD_USER_DATA: "/tmp/p" }, platform: "darwin", home })).toBe("/tmp/p/iliad.sock");
    expect(userDataDirectory({ env: {}, platform: "linux", home })).toBe("/Users/w/.config/Iliad MD");
  });
});

describe("formatStatus", () => {
  it("prints one line per window with ~ paths", () => {
    expect(
      formatStatus(
        [
          { workspace: "/Users/w/dev/book", document: "/Users/w/dev/book/chapters/03.md", relativePath: "chapters/03.md", focused: true },
          { workspace: "/Users/w/notes", document: null, relativePath: null, focused: false },
          { workspace: null, document: null, relativePath: null, focused: false }
        ],
        "/Users/w"
      )
    ).toBe(["~/dev/book  chapters/03.md  (focused)", "~/notes  no document open", "no folder open  no document open"].join("\n"));
    expect(formatStatus([], "/Users/w")).toBe("Iliad is open with no windows.");
  });
});

describe("runCli", () => {
  let dir: string;
  let out: string[];
  let err: string[];

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "iliad-cli-")));
    out = [];
    err = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const io = () => ({ stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t), cwd: dir, home: dir });

  it("status: not running → message and exit 3", async () => {
    const send = vi.fn().mockRejectedValue(new NotRunningError());
    expect(await runCli(["status"], { ...io(), send })).toBe(exitCodes.notRunning);
    expect(out).toEqual(["Iliad is not open."]);
  });

  it("status: prints windows, or JSON with --json", async () => {
    const windows = [{ workspace: `${dir}/book`, document: `${dir}/book/a.md`, relativePath: "a.md", focused: true }];
    const send = vi.fn().mockResolvedValue({ ok: true, windows });
    expect(await runCli(["status"], { ...io(), send })).toBe(0);
    expect(out).toEqual(["~/book  a.md  (focused)"]);
    expect(send).toHaveBeenCalledWith({ cmd: "status" }, expect.any(Number));

    out.length = 0;
    expect(await runCli(["status", "--json"], { ...io(), send })).toBe(0);
    expect(JSON.parse(out[0])).toEqual({ windows });
  });

  it("open: sends the canonical path and line, silent on success", async () => {
    await writeFile(path.join(dir, "a.md"), "# A\n");
    const send = vi.fn().mockResolvedValue({ ok: true });
    expect(await runCli(["open", "a.md", "--line", "3"], { ...io(), send })).toBe(0);
    expect(send).toHaveBeenCalledWith({ cmd: "open", path: path.join(dir, "a.md"), line: 3 }, expect.any(Number));
    expect(out).toEqual([]);
    expect(err).toEqual([]);
  });

  it("open: reports the app's failure and exits 1", async () => {
    await writeFile(path.join(dir, "a.md"), "# A\n");
    const send = vi.fn().mockResolvedValue({ ok: false, error: "Nope." });
    expect(await runCli(["open", "a.md"], { ...io(), send })).toBe(1);
    expect(err).toEqual(["iliad: Nope."]);
  });

  it("open: rejects missing and non-Markdown files without contacting the app", async () => {
    await writeFile(path.join(dir, "a.txt"), "x");
    const send = vi.fn();
    expect(await runCli(["open", "missing.md"], { ...io(), send })).toBe(1);
    expect(await runCli(["open", "a.txt"], { ...io(), send })).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(err[0]).toMatch(/File not found/);
    expect(err[1]).toMatch(/Not a Markdown file/);
  });

  it("open: cold start launches the file's folder (not the file) and retries the socket", async () => {
    await mkdir(path.join(dir, "book"));
    await writeFile(path.join(dir, "book", "a.md"), "# A\n");
    let clock = 0;
    const send = vi
      .fn()
      .mockRejectedValueOnce(new NotRunningError())
      .mockRejectedValueOnce(new NotRunningError())
      .mockResolvedValueOnce({ ok: true });
    const launch = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn(async (ms: number) => {
      clock += ms;
    });

    expect(await runCli(["open", "book/a.md"], { ...io(), send, launch, sleep, now: () => clock })).toBe(0);
    expect(launch).toHaveBeenCalledWith([path.join(dir, "book")]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("open: gives up after 10 s when the app never answers", async () => {
    await writeFile(path.join(dir, "a.md"), "# A\n");
    let clock = 0;
    const send = vi.fn().mockRejectedValue(new NotRunningError());
    const sleep = async (ms: number) => {
      clock += ms;
    };

    expect(await runCli(["open", "a.md"], { ...io(), send, launch: vi.fn(), sleep, now: () => clock })).toBe(1);
    expect(err).toEqual(["iliad: Iliad did not start in time."]);
    expect(clock).toBeGreaterThanOrEqual(10_000);
  });

  it("open: never cold-starts on a hidden or ignored folder", async () => {
    await mkdir(path.join(dir, ".private"));
    await writeFile(path.join(dir, ".private", "draft.md"), "# D\n");
    await mkdir(path.join(dir, "node_modules"));
    await writeFile(path.join(dir, "node_modules", "x.md"), "# X\n");
    const send = vi.fn().mockRejectedValue(new NotRunningError());
    const launch = vi.fn();

    expect(await runCli(["open", ".private/draft.md"], { ...io(), send, launch })).toBe(1);
    expect(await runCli(["open", "node_modules/x.md"], { ...io(), send, launch })).toBe(1);
    expect(launch).not.toHaveBeenCalled();
    expect(err[0]).toMatch(/hidden or ignored/);
  });

  it("open: refuses a visible symlink that resolves into a hidden folder", async () => {
    await mkdir(path.join(dir, ".private"));
    await writeFile(path.join(dir, ".private", "draft.md"), "# D\n");
    await symlink(path.join(dir, ".private"), path.join(dir, "visible"));
    const launch = vi.fn();

    expect(
      await runCli(["open", "visible/draft.md"], { ...io(), send: vi.fn().mockRejectedValue(new NotRunningError()), launch })
    ).toBe(1);
    expect(launch).not.toHaveBeenCalled();
  });

  it("launch: passes folder arguments through", async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    expect(await runCli(["."], { ...io(), launch })).toBe(0);
    expect(launch).toHaveBeenCalledWith(["."]);
  });

  it("skill install copies the bundled skill into ~/.claude/skills/iliad", async () => {
    expect(await runCli(["skill", "install"], { ...io(), scriptDirectory: repoBin })).toBe(0);
    const target = path.join(dir, ".claude", "skills", "iliad", "SKILL.md");
    expect(out).toEqual([`Installed skill: ${target}`]);
    const bundled = await readFile(path.resolve(repoBin, "../resources/skill/iliad/SKILL.md"), "utf8");
    expect(await readFile(target, "utf8")).toBe(bundled);

    // Overwrites on reinstall.
    await writeFile(target, "old");
    expect(await runCli(["skill", "install"], { ...io(), scriptDirectory: repoBin })).toBe(0);
    expect(await readFile(target, "utf8")).toBe(bundled);
  });

  it("skill print writes the skill to stdout", async () => {
    expect(await runCli(["skill", "print"], { ...io(), scriptDirectory: repoBin })).toBe(0);
    expect(out[0]).toMatch(/^---\nname: iliad\n/);
  });

  it("finds the skill next to the script in a packaged layout", async () => {
    const resources = path.join(dir, "Iliad MD.app", "Contents", "Resources");
    await mkdir(path.join(resources, "bin"), { recursive: true });
    await mkdir(path.join(resources, "skill", "iliad"), { recursive: true });
    await writeFile(path.join(resources, "skill", "iliad", "SKILL.md"), "packaged skill\n");
    expect(await runCli(["skill", "print"], { ...io(), scriptDirectory: path.join(resources, "bin") })).toBe(0);
    expect(out).toEqual(["packaged skill"]);
  });
});
