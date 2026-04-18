import path from "node:path";
import process from "node:process";
import { getConfigDir, getListenURL, getPluginLoaderPath, getStorePath, ROUTES } from "./config.js";
import { WorkspaceRepository } from "./store.js";

export async function runCLI(argv, { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, env = process.env } = {}) {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    stderr.write(`${usageText}\n`);
    return 0;
  }

  const repository = await new WorkspaceRepository(getStorePath(env)).load();

  switch (command) {
    case "add":
      return runAdd(args, { repository, stdout, stderr, stdin, env });
    case "list":
      return runList({ repository, stdout });
    case "status":
      return runStatus({ repository, stdout });
    case "enable":
      return runToggle(args, { repository, stdout }, true);
    case "disable":
      return runToggle(args, { repository, stdout }, false);
    case "delete":
      return runDelete(args, { repository, stdout });
    case "use":
      return runUse(args, { repository, stdout });
    case "current":
      return runCurrent({ repository, stdout });
    case "config":
      return runConfig({ stdout });
    default:
      throw new Error(`unknown command "${command}"`);
  }
}

const usageText = `go-pool commands:
  add --label main [--api-key sk-...]
  list
  status
  enable <workspace-id>
  disable <workspace-id>
  delete <workspace-id>
  use <workspace-id>
  current
  config`;

async function runAdd(args, { repository, stdout, stderr, stdin, env }) {
  const parsed = parseFlags(args);
  const label = parsed.label;
  if (!label) {
    throw new Error("add requires --label");
  }

  let apiKey = parsed["api-key"] || env.GO_POOL_API_KEY || env.OPENCODE_API_KEY;
  if (!apiKey) {
    stderr.write("API key: ");
    apiKey = await readLine(stdin);
  }
  if (!apiKey) {
    throw new Error("api key is required via --api-key, GO_POOL_API_KEY, OPENCODE_API_KEY, or stdin prompt");
  }

  const workspace = await repository.addWorkspace(label, apiKey.trim());
  stdout.write(`added workspace ${workspace.label} (${workspace.id})\n`);
  return 0;
}

async function runList({ repository, stdout }) {
  const workspaces = repository.listWorkspaces();
  stdout.write(formatTable(["ID", "WORKSPACE", "ENABLED"], workspaces.map((workspace) => [
    workspace.id,
    workspace.label,
    String(workspace.enabled)
  ])));
  return 0;
}

async function runStatus({ repository, stdout }) {
  const statuses = repository.status();
  stdout.write(formatTable(
    ["ID", "WORKSPACE", "CURRENT", "ENABLED", "ACTIVE_FOR", "COOLDOWN_UNTIL", "LAST_USED_AT", "LAST_ERROR"],
    statuses.map((status) => [
      status.id,
      status.label,
      status.current ? "*" : "",
      String(status.enabled),
      status.activeFor.join(","),
      status.cooldownUntil || "",
      status.lastUsedAt || "",
      status.lastError || ""
    ])
  ));
  return 0;
}

async function runToggle(args, { repository, stdout }, enabled) {
  const [workspaceID] = args;
  if (!workspaceID) throw new Error("command requires exactly one workspace id");
  if (enabled) {
    await repository.enableWorkspace(workspaceID);
  } else {
    await repository.disableWorkspace(workspaceID);
  }
  stdout.write(`${workspaceID} ${enabled ? "enabled" : "disabled"}\n`);
  return 0;
}

async function runDelete(args, { repository, stdout }) {
  const [workspaceID] = args;
  if (!workspaceID) throw new Error("delete requires exactly one workspace id");
  await repository.deleteWorkspace(workspaceID);
  stdout.write(`${workspaceID} deleted\n`);
  return 0;
}

async function runUse(args, { repository, stdout }) {
  const [workspaceID] = args;
  if (!workspaceID) throw new Error("use requires exactly one workspace id");
  await repository.useWorkspace(workspaceID);
  stdout.write(`current workspace ${workspaceID}\n`);
  return 0;
}

async function runCurrent({ repository, stdout }) {
  const current = repository.currentWorkspace();
  if (!current) {
    stdout.write("No current workspace selected\n");
    return 0;
  }

  stdout.write(formatTable(
    ["ID", "WORKSPACE", "CURRENT", "ENABLED"],
    [[current.id, current.label, "*", String(current.enabled)]]
  ));
  return 0;
}

async function runConfig({ stdout }) {
  const configDir = getConfigDir(process.env);
  const loaderPath = getPluginLoaderPath(process.env);
  const listenURL = getListenURL();
  const snippet = `{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode-go": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenCode Go",
      "options": {
        "baseURL": "${listenURL.origin}/openai/v1",
        "apiKey": "dummy-local-key"
      },
      "models": {
        "glm-5": { "name": "GLM-5" },
        "glm-5.1": { "name": "GLM-5.1" },
        "kimi-k2.5": { "name": "Kimi K2.5" },
        "mimo-v2-pro": { "name": "MiMo-V2-Pro" },
        "mimo-v2-omni": { "name": "MiMo-V2-Omni" }
      }
    },
    "opencode-go-minimax": {
      "npm": "@ai-sdk/anthropic",
      "name": "OpenCode Go MiniMax",
      "options": {
        "baseURL": "${listenURL.origin}/anthropic/v1",
        "apiKey": "dummy-local-key"
      },
      "models": {
        "minimax-m2.7": { "name": "MiniMax M2.7" },
        "minimax-m2.5": { "name": "MiniMax M2.5" }
      }
    },
    "opencode-go-qwen": {
      "npm": "@ai-sdk/alibaba",
      "name": "OpenCode Go Qwen",
      "options": {
        "baseURL": "${listenURL.origin}/alibaba/v1",
        "apiKey": "dummy-local-key"
      },
      "models": {
        "qwen3.6-plus": { "name": "Qwen3.6 Plus" },
        "qwen3.5-plus": { "name": "Qwen3.5 Plus" }
      }
    }
  },
  "model": "opencode-go/glm-5.1",
  "small_model": "opencode-go-qwen/qwen3.5-plus"
}`;

  stdout.write(`${snippet}\n`);
  stdout.write(`\nplugin loader: ${loaderPath}\n`);
  stdout.write(`store file: ${path.join(configDir, "opencode-go-workspaces.json")}\n`);
  stdout.write(`models: ${Object.values(ROUTES).flatMap((route) => route.models).join(", ")}\n`);
  return 0;
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    flags[key] = args[index + 1];
    index += 1;
  }
  return flags;
}

function readLine(stdin) {
  return new Promise((resolve, reject) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n")) {
        resolve(data.trim());
      }
    });
    stdin.on("end", () => resolve(data.trim()));
    stdin.on("error", reject);
  });
}

function formatTable(headers, rows) {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => (row[index] || "").length)
  ));

  const formatRow = (row) => row.map((cell, index) => (cell || "").padEnd(widths[index])).join("  ").trimEnd();
  return `${formatRow(headers)}\n${rows.map(formatRow).join("\n")}${rows.length ? "\n" : ""}`;
}
