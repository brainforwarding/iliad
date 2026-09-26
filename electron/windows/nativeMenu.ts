import type { MenuItemConstructorOptions } from "electron";

export function windowsFileMenu(locale: string, actions: { newWindow: () => void; installCommand: () => void; updates: () => void }): MenuItemConstructorOptions {
  const es = locale.toLowerCase().startsWith("es");
  return {
    label: es ? "Archivo" : "File",
    submenu: [
      { label: es ? "Nueva ventana" : "New Window", accelerator: "Ctrl+Shift+N", click: actions.newWindow },
      { label: es ? "Instalar comando iliad…" : "Install iliad Command…", click: actions.installCommand },
      { label: es ? "Actualizaciones…" : "Updates…", click: actions.updates },
      { type: "separator" }, { role: "quit" }
    ]
  };
}
