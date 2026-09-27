import { BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const electronOutDirectory = path.dirname(moduleDirectory);
const appIconPath = path.join(electronOutDirectory, "../build/icon.png");

export function createWindow() {
  const window = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: "Iliad MD",
    icon: process.platform === "darwin" ? undefined : appIconPath,
    backgroundColor: "#fdfcf8",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Centered on the 52px top row (--topbar-height) with the 16px icons beside them.
    trafficLightPosition: { x: 20, y: 19 },
    webPreferences: {
      preload: path.join(electronOutDirectory, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(electronOutDirectory, "../dist/index.html"));
  }

  return window;
}
