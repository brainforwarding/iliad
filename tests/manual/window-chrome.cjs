// macOS only. Run after npm run build; uses the built app and its real IPC.
const { app, BrowserWindow, systemPreferences } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const project = path.resolve(__dirname, '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'iliad-window-chrome-'));
const workspace = path.join(temporary, 'documents');
const screenshots = process.argv.includes('--screenshots');
fs.mkdirSync(workspace);
for (const name of ['Draft A', 'Outline B', 'Notes C']) {
  fs.writeFileSync(path.join(workspace, `${name}.md`), `# ${name}\n\nWindow chrome regression fixture.`);
}
delete process.env.VITE_DEV_SERVER_URL;
process.env.ILIAD_USER_DATA = path.join(temporary, 'profile');
app.setAppPath(project);
process.argv = [process.argv[0], project, workspace];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
const js = (expression) => window.webContents.executeJavaScript(expression);
async function waitFor(expression, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await js(expression)) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function open(name) {
  await js(`[...document.querySelectorAll('.tree-open-button')].find(b => b.querySelector('.tree-name')?.innerText.trim() === ${JSON.stringify(name)}).click()`);
  await waitFor(`document.querySelector('.cm-content')?.innerText.includes(${JSON.stringify(name)})`, `open ${name}`);
}
async function geometry() {
  return js(`(() => {
    const rect = selector => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? {left:r.left,right:r.right,width:r.width,height:r.height} : null; };
    const overlay = navigator.windowControlsOverlay;
    return {overlay:{visible:overlay.visible,rect:overlay.getTitlebarAreaRect().toJSON()},
      toggle:rect('.topbar-navigation .icon-button'), document:rect('.topbar-document-navigation'),
      header:rect('.app-topbar'), sidebar:rect('#file-tree-sidebar'),
      drag:getComputedStyle(document.querySelector('.app-topbar')).getPropertyValue('-webkit-app-region'),
      buttons:[...document.querySelectorAll('.topbar-navigation .icon-button')].map(b => ({right:b.getBoundingClientRect().right,width:b.getBoundingClientRect().width,drag:getComputedStyle(b).getPropertyValue('-webkit-app-region')})),
      padding:getComputedStyle(document.querySelector('.topbar-sidebar-zone')).paddingLeft,
      tabs:document.querySelectorAll('.document-tab').length};
  })()`);
}
function check(g, label, sidebar) {
  assert.ok(g.overlay.visible, `${label}: native overlay visible`);
  assert.ok(g.toggle.left >= g.overlay.rect.x - 1, `${label}: native horizontal clearance`);
  assert.ok(g.header.height >= g.overlay.rect.height - 1, `${label}: native vertical clearance`);
  assert.equal(g.tabs, 3, `${label}: three open documents`);
  assert.equal(g.buttons.length, 3, `${label}: toggle and both history controls`);
  assert.ok(g.buttons.every((b, index) => b.width >= (index ? 24 : 28) - 1), `${label}: buttons retain width`);
  assert.ok(g.buttons.every(b => b.right <= g.document.left + 1), `${label}: full button edges clear documents`);
  assert.equal(g.drag, 'drag'); assert.ok(g.buttons.every(b => b.drag === 'no-drag'), `${label}: controls remain clickable`);
  if (sidebar) assert.ok(Math.abs(g.sidebar.width - 220) < 1, `${label}: actual sidebar remains 220px`);
  console.log('PASS', label, JSON.stringify(g));
}
async function zoomTo(zoom) {
  window.webContents.setZoomFactor(zoom);
  await waitFor(`Math.abs(innerWidth - ${window.getContentBounds().width / zoom}) < 2`, `viewport at ${zoom}`);
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(100);
}
async function fullscreen(enabled) {
  window.setFullScreen(enabled);
  await waitFor(`document.querySelector('.app-shell').classList.contains('is-fullscreen') === ${enabled}`, 'fullscreen state');
  await waitFor(`navigator.windowControlsOverlay.visible === ${!enabled}`, 'fullscreen native geometry');
  await sleep(300);
}
function capture(name) {
  if (!screenshots || systemPreferences.getMediaAccessStatus('screen') !== 'granted') return;
  try { execFileSync('screencapture', ['-x', '-o', '-l', window.getMediaSourceId().split(':')[1], path.join(temporary, `${name}.png`)]); }
  catch (error) { console.warn('Optional screenshot unavailable:', error.message); }
}
(async () => {
  if (process.platform !== 'darwin') { console.log('Skip: native window chrome QA requires macOS.'); app.exit(0); return; }
  assert.ok(fs.existsSync(path.join(project, 'dist/index.html')), 'Run npm run build first');
  await import(pathToFileURL(path.join(project, 'dist-electron/main.js')).href);
  for (let attempt = 0; attempt < 200; attempt++) {
    window = BrowserWindow.getAllWindows()[0];
    if (window && !window.webContents.isLoading() && window.webContents.getURL().startsWith('file:')) break;
    await sleep(50);
  }
  assert.ok(window, 'Built app created a window');
  window.setSize(960, 760); window.webContents.setBackgroundThrottling(false); window.show(); window.focus();
  assert.ok(window.webContents.getURL().startsWith('file:'), 'Built renderer, without Vite');
  await waitFor('Boolean(document.querySelector(".tree-open-button"))', 'workspace tree');
  await open('Draft A'); await open('Outline B'); await open('Notes C');
  await js('document.querySelector(".topbar-history-button").click()');
  await waitFor('document.querySelectorAll(".topbar-history-button").length === 2', 'both history controls');
  await js('document.querySelector(".sidebar-resize-handle").focus()');
  window.webContents.sendInputEvent({type:'keyDown', keyCode:'Home'});
  window.webContents.sendInputEvent({type:'keyUp', keyCode:'Home'});
  await waitFor('document.querySelector(".sidebar-resize-handle").getAttribute("aria-valuenow") === "220"', 'minimum sidebar');
  for (const zoom of [1, .8, .67, .5, 1.25]) {
    await zoomTo(zoom); check(await geometry(), `windowed ${zoom}`, true); capture(`windowed-${zoom}`);
    await js('document.querySelector(".topbar-navigation .icon-button").click()');
    await waitFor('document.querySelector(".app-shell").classList.contains("sidebar-is-collapsed")', 'collapsed');
    check(await geometry(), `collapsed ${zoom}`, false);
    await js('document.querySelector(".topbar-navigation .icon-button").dispatchEvent(new PointerEvent("pointerover", {bubbles:true,pointerType:"mouse",relatedTarget:null}))');
    await waitFor('document.querySelector(".app-shell").classList.contains("sidebar-is-peeking")', 'peek');
    check(await geometry(), `peek ${zoom}`, true);
    await js('document.querySelector(".topbar-navigation .icon-button").click()');
    await waitFor('!document.querySelector(".app-shell").classList.contains("sidebar-is-collapsed")', 'pin sidebar');
  }
  await zoomTo(.67); await fullscreen(true); const full = await geometry();
  assert.equal(full.padding, '10px'); assert.ok(Math.abs(full.header.height - 52) < 1); capture('fullscreen');
  await fullscreen(false); check(await geometry(), 'fullscreen return', true); capture('fullscreen-return');
  window.minimize(); await sleep(300); assert.ok(window.isMinimized(), 'native minimize');
  window.restore(); await sleep(300); assert.ok(!window.isMinimized(), 'native restore'); window.focus();
  console.log('ALL NATIVE WINDOW CHROME CHECKS PASSED', temporary); app.exit(0);
})().catch(error => { console.error(error); if (window) capture('failure'); console.error('QA files:', temporary); app.exit(1); });
