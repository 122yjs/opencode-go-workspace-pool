import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getStorePath } from "./config.js";

const CURRENT_VERSION = 1;

export class SelectionError extends Error {
  constructor({ blockedCount, earliestRetry, lastError }) {
    const suffix = earliestRetry
      ? `blocked=${blockedCount} earliest_retry=${earliestRetry} last_error=${lastError || ""}`
      : `blocked=${blockedCount} last_error=${lastError || ""}`;
    super(`all workspaces unavailable: ${suffix}`);
    this.name = "SelectionError";
    this.blockedCount = blockedCount;
    this.earliestRetry = earliestRetry;
    this.lastError = lastError;
  }
}

export class WorkspaceRepository {
  constructor(storePath = getStorePath()) {
    this.storePath = storePath;
    this.state = {
      version: CURRENT_VERSION,
      workspaces: [],
      activeIndexByFamily: {}
    };
  }

  async load() {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.storePath, "utf8");
      if (!raw.trim()) {
        return this;
      }
      const parsed = JSON.parse(raw);
      this.state = {
        version: parsed.version || CURRENT_VERSION,
        workspaces: parsed.workspaces || parsed.accounts || [],
        activeIndexByFamily: parsed.activeIndexByFamily || {}
      };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        await this.save();
        return this;
      }
      throw error;
    }
    return this;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  listWorkspaces() {
    return structuredClone(this.state.workspaces);
  }

  status() {
    const activeByWorkspace = new Map();
    for (const [family, workspaceID] of Object.entries(this.state.activeIndexByFamily)) {
      const existing = activeByWorkspace.get(workspaceID) || [];
      existing.push(family);
      activeByWorkspace.set(workspaceID, existing);
    }

    return this.state.workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      enabled: workspace.enabled,
      lastUsedAt: workspace.lastUsedAt || null,
      cooldownUntil: workspace.cooldownUntil || null,
      lastError: workspace.lastError || "",
      lastSwitchReason: workspace.lastSwitchReason || "",
      activeFor: activeByWorkspace.get(workspace.id) || []
    }));
  }

  async addWorkspace(label, apiKey) {
    if (!label) throw new Error("label is required");
    if (!apiKey) throw new Error("api key is required");
    const workspace = {
      id: `ws-${crypto.randomBytes(4).toString("hex")}`,
      label,
      apiKey,
      enabled: true,
      lastUsedAt: null,
      cooldownUntil: null,
      lastError: "",
      lastSwitchReason: ""
    };
    this.state.workspaces.push(workspace);
    await this.save();
    return structuredClone(workspace);
  }

  async enableWorkspace(id) {
    return this.setEnabled(id, true);
  }

  async disableWorkspace(id) {
    return this.setEnabled(id, false);
  }

  async deleteWorkspace(id) {
    const index = this.indexByID(id);
    if (index === -1) throw new Error(`workspace "${id}" not found`);
    this.state.workspaces.splice(index, 1);
    for (const [family, activeID] of Object.entries(this.state.activeIndexByFamily)) {
      if (activeID === id) {
        delete this.state.activeIndexByFamily[family];
      }
    }
    await this.save();
  }

  async selectWorkspace(family, now = new Date()) {
    if (!family) throw new Error("family is required");

    const activeID = this.state.activeIndexByFamily[family];
    if (activeID) {
      const sticky = this.getByID(activeID);
      if (sticky && sticky.enabled && !isCoolingDown(sticky, now)) {
        return structuredClone(sticky);
      }
    }

    const available = this.state.workspaces.filter((workspace) => workspace.enabled && !isCoolingDown(workspace, now));
    if (available.length === 0) {
      throw this.buildSelectionError(now);
    }

    let selected = available[0];
    if (activeID) {
      const activeIndex = this.indexByID(activeID);
      if (activeIndex !== -1) {
        for (let offset = 1; offset <= this.state.workspaces.length; offset += 1) {
          const candidate = this.state.workspaces[(activeIndex + offset) % this.state.workspaces.length];
          if (candidate.enabled && !isCoolingDown(candidate, now)) {
            selected = candidate;
            break;
          }
        }
      }
    }

    this.state.activeIndexByFamily[family] = selected.id;
    await this.save();
    return structuredClone(selected);
  }

  async markSuccess(workspaceID, family, when = new Date()) {
    const workspace = this.requireWorkspace(workspaceID);
    workspace.lastUsedAt = when.toISOString();
    workspace.cooldownUntil = null;
    workspace.lastError = "";
    workspace.lastSwitchReason = "sticky";
    if (family) {
      this.state.activeIndexByFamily[family] = workspaceID;
    }
    await this.save();
  }

  async markFailure(workspaceID, family, reason, cooldownMs, when = new Date()) {
    const workspace = this.requireWorkspace(workspaceID);
    workspace.lastError = reason || "upstream-error";
    workspace.lastSwitchReason = "failover";
    workspace.cooldownUntil = cooldownMs > 0 ? new Date(when.getTime() + cooldownMs).toISOString() : null;
    if (family && this.state.activeIndexByFamily[family] === workspaceID) {
      delete this.state.activeIndexByFamily[family];
    }
    await this.save();
  }

  async save() {
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    const tempPath = `${this.storePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    await fs.chmod(tempPath, 0o600);
    await fs.rename(tempPath, this.storePath);
  }

  buildSelectionError(now) {
    let blockedCount = 0;
    let earliestRetry = null;
    let lastError = "";

    for (const workspace of this.state.workspaces) {
      if (!workspace.enabled) continue;
      blockedCount += 1;
      if (workspace.lastError) {
        lastError = workspace.lastError;
      }
      if (workspace.cooldownUntil) {
        const retryAt = new Date(workspace.cooldownUntil);
        if (retryAt > now && (!earliestRetry || retryAt < earliestRetry)) {
          earliestRetry = retryAt;
        }
      }
    }

    if (blockedCount === 0) {
      throw new Error("no enabled workspaces available");
    }

    return new SelectionError({
      blockedCount,
      earliestRetry: earliestRetry ? earliestRetry.toISOString() : null,
      lastError
    });
  }

  async setEnabled(id, enabled) {
    const workspace = this.requireWorkspace(id);
    workspace.enabled = enabled;
    if (!enabled) {
      for (const [family, activeID] of Object.entries(this.state.activeIndexByFamily)) {
        if (activeID === id) {
          delete this.state.activeIndexByFamily[family];
        }
      }
    }
    await this.save();
  }

  requireWorkspace(id) {
    const workspace = this.getByID(id);
    if (!workspace) throw new Error(`workspace "${id}" not found`);
    return workspace;
  }

  getByID(id) {
    return this.state.workspaces.find((workspace) => workspace.id === id);
  }

  indexByID(id) {
    return this.state.workspaces.findIndex((workspace) => workspace.id === id);
  }
}

function isCoolingDown(workspace, now) {
  return Boolean(workspace.cooldownUntil && new Date(workspace.cooldownUntil) > now);
}
