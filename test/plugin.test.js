import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { OpencodeGoWorkspacePoolPlugin } from "../plugin/index.js";

test("plugin exposes workspace tools that can switch current workspace", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-plugin-"));
  process.env.GO_POOL_CONFIG_DIR = tempDir;

  const plugin = await OpencodeGoWorkspacePoolPlugin();
  assert.ok(plugin.tool);

  const listBefore = await plugin.tool.workspace_list.execute({});
  assert.match(listBefore, /No workspaces configured/);

  const repositoryPath = path.join(tempDir, "opencode-go-workspaces.json");
  await fs.writeFile(repositoryPath, JSON.stringify({
    version: 1,
    workspaces: [
      { id: "ws-main", label: "main", apiKey: "sk-main", enabled: true, lastUsedAt: null, cooldownUntil: null, lastError: "", lastSwitchReason: "" },
      { id: "ws-backup", label: "backup", apiKey: "sk-backup", enabled: true, lastUsedAt: null, cooldownUntil: null, lastError: "", lastSwitchReason: "" }
    ],
    activeIndexByFamily: {}
  }, null, 2));

  const listAfter = await plugin.tool.workspace_list.execute({});
  assert.match(listAfter, /ws-main/);
  assert.match(listAfter, /ws-backup/);

  const switched = await plugin.tool.workspace_use.execute({ workspace_id: "ws-backup" });
  assert.match(switched, /Current workspace set to ws-backup/);

  const current = await plugin.tool.workspace_current.execute({});
  assert.match(current, /ws-backup/);
  assert.match(current, /backup/);
});
