import { _electron as electron } from "playwright";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const run = promisify(execFile);
const executablePath = path.resolve(process.argv[2] || path.join(process.env.LOCALAPPDATA, "Programs", "Iliad MD", "Iliad MD.exe"));
const artifacts = path.resolve("test-artifacts", `smoke-${Date.now()}`);
const workspace = path.join(artifacts, "Libro de prueba á 🦉");
await mkdir(workspace, { recursive: true });
const root = await realpath(workspace);
const document = path.join(root, "Capítulo 1 🦉.md");
const initial = "# Prueba de Windows\n\nTexto inicial.\n";
await writeFile(document, initial);
const env = { ...process.env, ILIAD_USER_DATA: path.join(artifacts, "profile"), ILIAD_UPDATE_URL: "" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
delete env.GEMINI_API_KEY;
delete env.GOOGLE_API_KEY;
const cli = path.join(path.dirname(executablePath), "resources", "bin", "iliad.cmd");
const results = [];
let app, page;
const pass = name => { results.push(name); console.log(`PASS ${name}`); };
async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error(`Timed out: ${label}`);
}
async function launch() {
  app = await electron.launch({ executablePath, args: [root], env, timeout: 30000 });
  page = await app.firstWindow();
  // Electron handles beforeunload natively; Playwright must not auto-accept its
  // synthetic CDP dialog event (there is no Chromium dialog to accept).
  page.on("dialog", dialog => { if (dialog.type() !== "beforeunload") void dialog.dismiss().catch(() => {}); });
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => Boolean(window.iliad));
  await waitFor(async () => Boolean((await page.evaluate(() => window.iliad.getLaunchWorkspace()))?.sessionId), "workspace session");
}
async function open(shell = "powershell") {
  const commandEnv = { ...env, ILIAD_TEST_CLI: cli, ILIAD_TEST_DOC: document };
  if (shell === "powershell") await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "& $env:ILIAD_TEST_CLI open $env:ILIAD_TEST_DOC; exit $LASTEXITCODE"], { env: commandEnv, windowsHide: true });
  else await run("cmd.exe", ["/d", "/s", "/c", '""%ILIAD_TEST_CLI%" open "%ILIAD_TEST_DOC%""'], { env: commandEnv, windowsHide: true, windowsVerbatimArguments: true });
  await page.locator(".cm-content").waitFor();
}
try {
  await launch();
  await open();
  pass("Installed CLI opens a Unicode path from PowerShell");
  await open("cmd");
  pass("Installed CLI opens a Unicode path from CMD");
  const editor = page.locator(".cm-content");
  await editor.click();
  await editor.press("Control+End");
  await editor.press("Enter");
  await editor.pressSequentially("Texto guardado desde el editor.");
  await waitFor(async () => (await readFile(document, "utf8")).includes("Texto guardado desde el editor."), "autosave");
  let saved = await readFile(document, "utf8");
  pass("Real editor autosaves to disk");
  await page.evaluate(() => localStorage.setItem("iliad-windows-smoke", "persisted"));
  await app.close(); app = null;
  await launch(); await open();
  assert.equal(await page.evaluate(() => localStorage.getItem("iliad-windows-smoke")), "persisted");
  assert.equal(await readFile(document, "utf8"), saved);
  assert.match(await page.locator(".cm-content").textContent(), /Texto guardado/);
  pass("Restart preserves document and preferences");
  const locker = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    '$f = [IO.File]::Open($env:ILIAD_TEST_DOC, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); Write-Output "LOCKED"; [Console]::ReadLine() | Out-Null; $f.Dispose()'],
    { env: { ...env, ILIAD_TEST_DOC: document }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let lockOutput = "";
  locker.stdout.on("data", chunk => { lockOutput += chunk; });
  try {
    await waitFor(async () => lockOutput.includes("LOCKED"), "file lock");
    await page.locator(".cm-content").click();
    await page.locator(".cm-content").press("Control+End");
    await page.locator(".cm-content").pressSequentially(" Texto conservado tras bloqueo.");
    await page.waitForFunction(() => /EBUSY|EACCES|EPERM|locked|permission denied/i.test(document.body.innerText));
    assert.equal(await readFile(document, "utf8"), saved);
    await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
    await new Promise(resolve => setTimeout(resolve, 700));
    assert.equal(page.isClosed(), false);
    assert.match(await page.locator(".cm-content").textContent(), /Texto conservado tras bloqueo/);
    pass("Locked file preserves unsaved text and prevents window closure");
  } finally {
    const released = new Promise(resolve => locker.once("exit", resolve));
    locker.stdin.end("\n");
    await released;
  }
  const recovered = new Promise(resolve => app.process().once("exit", resolve));
  await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
  await Promise.race([recovered, new Promise((_, reject) => setTimeout(() => reject(new Error("Recovery close did not finish")), 15000))]);
  app = null;
  saved = await readFile(document, "utf8");
  assert.match(saved, /Texto conservado tras bloqueo/);
  await launch(); await open();
  pass("Retry after releasing the file lock saves the preserved text");
  const session = await page.evaluate(() => window.iliad.getLaunchWorkspace());
  async function outsideReview() {
    return page.evaluate(id => window.iliad.agent.getExternalReview({ workspaceSessionId: id }), session.sessionId);
  }
  await writeFile(document, saved + "\nCambio externo para restaurar.\n");
  await waitFor(async () => (await outsideReview()).proposal?.files?.some(f => f.relativePath === path.basename(document)), "outside change detected");
  let snapshot = await outsideReview();
  let file = snapshot.proposal.files.find(f => f.relativePath === path.basename(document));
  await page.screenshot({ path: path.join(artifacts, "outside-review.png") });
  await page.evaluate(request => window.iliad.agent.rejectProposalFile(request), { workspaceSessionId: session.sessionId, proposalId: snapshot.proposal.id, fileId: file.id });
  assert.equal(await readFile(document, "utf8"), saved);
  pass("Outside edits are detected and Restore recovers the saved document");
  await writeFile(document, saved + "\nCambio externo para conservar.\n");
  await waitFor(async () => (await outsideReview()).proposal?.files?.some(f => f.relativePath === path.basename(document)), "second outside change");
  snapshot = await outsideReview();
  file = snapshot.proposal.files.find(f => f.relativePath === path.basename(document));
  await page.evaluate(request => window.iliad.agent.applyProposalFile(request), { workspaceSessionId: session.sessionId, proposalId: snapshot.proposal.id, fileId: file.id });
  assert.match(await readFile(document, "utf8"), /Cambio externo para conservar/);
  pass("Keep accepts an outside edit");
  const image = await page.evaluate(({ root, document }) => window.iliad.saveImageAsset({ workspaceRoot: root, documentPath: document, originalName: "prueba.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=" }), { root, document });
  assert.ok((await stat(image.filePath)).size > 0);
  assert.equal(await page.evaluate(file => new Promise(resolve => {
    const image = new Image(); image.onload = () => resolve(image.naturalWidth); image.onerror = () => resolve(0);
    image.src = window.iliad.assetUrl(file);
  }), image.filePath), 1);
  pass("Images save and load through the packaged asset protocol");
  const created = await page.evaluate(root => window.iliad.createMarkdown(root, root, "Documento temporal"), root);
  await writeFile(created.path.replace(/\.md$/, ".notes.md"), "# Notes\n\nKeep the narrator's voice.\n");
  await writeFile(created.path.replace(/\.md$/, ".comments.md"), "# Comments\n\nA synthetic selection comment.\n");
  const renamed = await page.evaluate(({ root, file }) => window.iliad.renamePath(root, file, "documento temporal.md"), { root, file: created.path });
  assert.equal(path.basename(renamed.path), "documento temporal.md");
  assert.match(await readFile(renamed.path.replace(/\.md$/, ".notes.md"), "utf8"), /narrator/);
  assert.match(await readFile(renamed.path.replace(/\.md$/, ".comments.md"), "utf8"), /synthetic/);
  pass("Notes and comments follow a case-only document rename");
  const trashed = await page.evaluate(({ root, file }) => window.iliad.moveToTrash(root, file), { root, file: renamed.path });
  assert.deepEqual(trashed.companionFailures, []);
  await assert.rejects(stat(renamed.path), { code: "ENOENT" });
  await assert.rejects(stat(renamed.path.replace(/\.md$/, ".notes.md")), { code: "ENOENT" });
  await assert.rejects(stat(renamed.path.replace(/\.md$/, ".comments.md")), { code: "ENOENT" });
  pass("Case-only rename and real Windows Recycle Bin work");
  const update = await page.evaluate(() => window.iliad.updates.check());
  assert.equal(update.message, "Local build");
  pass("Local builds do not offer upstream Mac updates");
  const aiState = await page.evaluate(() => window.iliad.getGeminiKeyState());
  assert.equal(aiState.hasKey, false);
  const ai = await page.evaluate(() => window.iliad.tightenSelection({ requestId: "windows-smoke", text: "A short test sentence.", language: "en" }));
  assert.equal(ai.ok, false);
  pass("AI without credentials returns a controlled error");
  await open();
  await page.locator(".cm-content").click();
  await page.locator(".cm-content").press("Control+End");
  await page.locator(".cm-content").pressSequentially(" Cierre inmediato.");
  const exited = new Promise(resolve => app.process().once("exit", resolve));
  await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("Close did not finish")), 15000))]);
  app = null;
  assert.match(await readFile(document, "utf8"), /Cierre inmediato/);
  pass("Closing immediately after typing flushes the last edit");
  await launch(); await open();
  await page.screenshot({ path: path.join(artifacts, "editor.png") });
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ executablePath, results, aiLiveTest: "Not run: no Gemini key in isolated profile" }, null, 2));
  console.log(`Artifacts: ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally { if (app) await app.close(); }
