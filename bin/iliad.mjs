#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./lib/cli.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

process.exitCode = await runCli(process.argv.slice(2), { scriptDirectory });
