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

test("plugin exposes auth methods for workspace management", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-plugin-auth-"));
  process.env.GO_POOL_CONFIG_DIR = tempDir;

  const plugin = await OpencodeGoWorkspacePoolPlugin();
  assert.ok(plugin.auth);
  assert.equal(plugin.auth.provider, "opencode-go-workspace-pool");

  const addMethod = plugin.auth.methods.find((method) => method.label === "Add OpenCode Go Workspace");
  assert.ok(addMethod);

  const addResult = await addMethod.authorize({
    label: "main",
    api_key: "sk-main"
  });
  assert.deepEqual(addResult, {
    type: "success",
    key: "workspace-pool-managed"
  });

  const repositoryPath = path.join(tempDir, "opencode-go-workspaces.json");
  const stored = JSON.parse(await fs.readFile(repositoryPath, "utf8"));
  const workspaceID = stored.workspaces[0].id;

  const reloadedPlugin = await OpencodeGoWorkspacePoolPlugin();
  const useMethod = reloadedPlugin.auth.methods.find((method) => method.label === "Use OpenCode Go Workspace");
  assert.ok(useMethod);
  assert.equal(useMethod.prompts[0].type, "select");
  assert.equal(useMethod.prompts[0].options.length, 1);
  assert.match(useMethod.prompts[0].options[0].label, /main/);
  const useResult = await useMethod.authorize({
    workspace_id: workspaceID
  });
  assert.deepEqual(useResult, {
    type: "success",
    key: "workspace-pool-managed"
  });

  const updated = JSON.parse(await fs.readFile(repositoryPath, "utf8"));
  assert.equal(updated.currentWorkspaceID, workspaceID);
});

test("plugin auth methods expose select choices for existing workspaces", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-plugin-auth-select-"));
  process.env.GO_POOL_CONFIG_DIR = tempDir;

  await fs.writeFile(path.join(tempDir, "opencode-go-workspaces.json"), JSON.stringify({
    version: 1,
    workspaces: [
      { id: "ws-main", label: "main", apiKey: "sk-main", enabled: true, lastUsedAt: null, cooldownUntil: null, lastError: "", lastSwitchReason: "" },
      { id: "ws-backup", label: "backup", apiKey: "sk-backup", enabled: false, lastUsedAt: null, cooldownUntil: null, lastError: "", lastSwitchReason: "" }
    ],
    activeIndexByFamily: {},
    currentWorkspaceID: null
  }, null, 2));

  const plugin = await OpencodeGoWorkspacePoolPlugin();
  const useMethod = plugin.auth.methods.find((method) => method.label === "Use OpenCode Go Workspace");
  const enableMethod = plugin.auth.methods.find((method) => method.label === "Enable OpenCode Go Workspace");
  const disableMethod = plugin.auth.methods.find((method) => method.label === "Disable OpenCode Go Workspace");
  const deleteMethod = plugin.auth.methods.find((method) => method.label === "Delete OpenCode Go Workspace");

  assert.deepEqual(useMethod.prompts[0].options.map((option) => option.value), ["ws-main"]);
  assert.deepEqual(enableMethod.prompts[0].options.map((option) => option.value), ["ws-backup"]);
  assert.deepEqual(disableMethod.prompts[0].options.map((option) => option.value), ["ws-main"]);
  assert.deepEqual(deleteMethod.prompts[0].options.map((option) => option.value), ["ws-main", "ws-backup"]);
});
