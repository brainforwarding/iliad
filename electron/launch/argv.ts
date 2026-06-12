import path from "node:path";

export interface ParseLaunchArgvOptions {
  appRoot: string;
  argv: string[];
  cwd: string;
}

function isAppRootArgument(argument: string, cwd: string, appRoot: string) {
  return path.resolve(cwd, argument) === path.resolve(appRoot);
}

export function parseLaunchWorkspacePath({ appRoot, argv, cwd }: ParseLaunchArgvOptions) {
  let appRootSkipped = false;
  let optionsEnded = false;

  for (const argument of argv.slice(1)) {
    if (!appRootSkipped && isAppRootArgument(argument, cwd, appRoot)) {
      appRootSkipped = true;
      continue;
    }

    if (!optionsEnded && argument === "--") {
      optionsEnded = true;
      continue;
    }

    if (!optionsEnded && argument.startsWith("-")) {
      continue;
    }

    return path.resolve(cwd, argument);
  }

  return null;
}
