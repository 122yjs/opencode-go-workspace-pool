#!/usr/bin/env node
import process from "node:process";
import { runCLI } from "../src/cli.js";

try {
  const exitCode = await runCLI(process.argv.slice(2));
  process.exitCode = exitCode;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
