import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { PassThrough } from "node:stream";
import { runCLI } from "../src/cli.js";

test("status and list do not leak workspace keys", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-cli-"));
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });

  await runCLI(["add", "--label", "work"], {
    stdout,
    stderr,
    env: {
      GO_POOL_CONFIG_DIR: tempDir,
      GO_POOL_API_KEY: "sk-secret-value"
    }
  });

  assert.match(output, /added workspace/);

  output = "";
  await runCLI(["list"], {
    stdout,
    stderr,
    env: { GO_POOL_CONFIG_DIR: tempDir }
  });
  assert.doesNotMatch(output, /sk-secret-value/);

  output = "";
  await runCLI(["status"], {
    stdout,
    stderr,
    env: { GO_POOL_CONFIG_DIR: tempDir }
  });
  assert.doesNotMatch(output, /sk-secret-value/);
  assert.match(output, /WORKSPACE/);
  assert.match(output, /work/);
});

test("cli supports use and current commands", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-cli-"));
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });

  await runCLI(["add", "--label", "main"], {
    stdout,
    stderr,
    env: {
      GO_POOL_CONFIG_DIR: tempDir,
      GO_POOL_API_KEY: "sk-main"
    }
  });

  output = "";
  await runCLI(["add", "--label", "backup"], {
    stdout,
    stderr,
    env: {
      GO_POOL_CONFIG_DIR: tempDir,
      GO_POOL_API_KEY: "sk-backup"
    }
  });

  const ids = output.match(/ws-[a-f0-9]+/g);
  assert.ok(ids && ids.length === 1);
  const backupID = ids[0];

  output = "";
  await runCLI(["use", backupID], {
    stdout,
    stderr,
    env: { GO_POOL_CONFIG_DIR: tempDir }
  });
  assert.match(output, new RegExp(`current workspace ${backupID}`));

  output = "";
  await runCLI(["current"], {
    stdout,
    stderr,
    env: { GO_POOL_CONFIG_DIR: tempDir }
  });
  assert.match(output, /CURRENT/);
  assert.match(output, new RegExp(backupID));
  assert.match(output, /backup/);
});
