import { ipcMain } from "electron";
import type { UpdateService } from "../updates/updateService.js";

export const updateCheckRequestedChannel = "updates:check-requested";

interface RegisterUpdatesIpcOptions {
  service: UpdateService;
  consumePendingCheckRequest?: () => boolean;
}

export function registerUpdatesIpc({ service, consumePendingCheckRequest }: RegisterUpdatesIpcOptions) {
  ipcMain.handle("updates:check", () => service.checkForUpdates());
  ipcMain.handle("updates:consume-pending-check-request", () => consumePendingCheckRequest?.() ?? false);
}
