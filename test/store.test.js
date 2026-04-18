import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { WorkspaceRepository } from "../src/store.js";

test("repository persists cooldown and active family state", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-store-"));
  const storePath = path.join(tempDir, "opencode-go-workspaces.json");
  const repository = await new WorkspaceRepository(storePath).load();

  const first = await repository.addWorkspace("main", "key-main");
  const second = await repository.addWorkspace("backup", "key-backup");

  const at = new Date("2026-04-18T10:00:00.000Z");
  const selected = await repository.selectWorkspace("openai", at);
  assert.equal(selected.id, first.id);

  await repository.markFailure(first.id, "openai", "rate-limit", 120000, at);
  const next = await repository.selectWorkspace("openai", new Date("2026-04-18T10:00:05.000Z"));
  assert.equal(next.id, second.id);

  const reloaded = await new WorkspaceRepository(storePath).load();
  const snapshot = reloaded.snapshot();
  assert.equal(snapshot.workspaces.length, 2);
  assert.equal(snapshot.activeIndexByFamily.openai, second.id);
  const cooled = snapshot.workspaces.find((workspace) => workspace.id === first.id);
  assert.ok(cooled.cooldownUntil);
  assert.equal(cooled.lastError, "rate-limit");
});

test("repository is sticky until failure and skips disabled workspaces", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-store-"));
  const storePath = path.join(tempDir, "opencode-go-workspaces.json");
  const repository = await new WorkspaceRepository(storePath).load();

  const first = await repository.addWorkspace("main", "key-main");
  const second = await repository.addWorkspace("backup", "key-backup");

  const at = new Date("2026-04-18T10:00:00.000Z");
  assert.equal((await repository.selectWorkspace("anthropic", at)).id, first.id);
  await repository.markSuccess(first.id, "anthropic", new Date("2026-04-18T10:00:02.000Z"));
  assert.equal((await repository.selectWorkspace("anthropic", new Date("2026-04-18T10:00:04.000Z"))).id, first.id);

  await repository.disableWorkspace(first.id);
  assert.equal((await repository.selectWorkspace("anthropic", new Date("2026-04-18T10:00:06.000Z"))).id, second.id);
});

test("repository prefers current workspace when manually selected", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-store-"));
  const storePath = path.join(tempDir, "opencode-go-workspaces.json");
  const repository = await new WorkspaceRepository(storePath).load();

  const first = await repository.addWorkspace("main", "key-main");
  const second = await repository.addWorkspace("backup", "key-backup");

  await repository.useWorkspace(second.id);

  const selected = await repository.selectWorkspace("openai", new Date("2026-04-18T10:00:00.000Z"));
  assert.equal(selected.id, second.id);

  const current = repository.currentWorkspace();
  assert.equal(current.id, second.id);

  const snapshot = repository.snapshot();
  assert.equal(snapshot.currentWorkspaceID, second.id);
  assert.equal(snapshot.activeIndexByFamily.openai, second.id);

  await repository.disableWorkspace(second.id);
  const fallback = await repository.selectWorkspace("openai", new Date("2026-04-18T10:00:10.000Z"));
  assert.equal(fallback.id, first.id);
});
