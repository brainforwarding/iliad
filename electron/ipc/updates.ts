import { ipcMain } from "electron";
import { updateChannels } from "../updates/appUpdateState.js";
import type { AppUpdateController } from "../updates/appUpdater.js";
import type { RestartCoordinator } from "../updates/restartCoordinator.js";
import { isTrustedIpcSender } from "./trust.js";

export const updateCheckRequestedChannel = updateChannels.checkRequested;

interface RegisterUpdatesIpcOptions {
  controller: Pick<AppUpdateController, "getState" | "check" | "install">;
  coordinator: Pick<RestartCoordinator, "respond">;
  consumePendingCheckRequest?: () => boolean;
}

export function registerUpdatesIpc({ controller, coordinator, consumePendingCheckRequest }: RegisterUpdatesIpcOptions) {
  ipcMain.handle(updateChannels.getState, () => controller.getState());
  ipcMain.handle(updateChannels.check, () => controller.check({ manual: true }));
  ipcMain.handle(updateChannels.install, async (event) => {
    if (!isTrustedIpcSender(event)) {
      return;
    }

    await controller.install();
  });
  ipcMain.handle(updateChannels.consumePendingCheckRequest, () => consumePendingCheckRequest?.() ?? false);
  ipcMain.handle(updateChannels.prepareRestartResponse, (event, requestId: unknown, response: unknown) => {
    if (!isTrustedIpcSender(event)) {
      return;
    }

    coordinator.respond(event.sender.id, requestId, response);
  });
}
