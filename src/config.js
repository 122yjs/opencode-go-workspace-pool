import os from "node:os";
import path from "node:path";

export const DEFAULT_LISTEN_HOST = "127.0.0.1";
export const DEFAULT_LISTEN_PORT = 8787;

export const ROUTES = {
  openai: {
    family: "openai",
    localPath: "/openai/v1/chat/completions",
    modelsPath: "/openai/v1/models",
    upstreamURL: "https://opencode.ai/zen/go/v1/chat/completions",
    models: ["glm-5", "glm-5.1", "kimi-k2.5", "mimo-v2-pro", "mimo-v2-omni"]
  },
  anthropic: {
    family: "anthropic",
    localPath: "/anthropic/v1/messages",
    upstreamURL: "https://opencode.ai/zen/go/v1/messages",
    models: ["minimax-m2.7", "minimax-m2.5"]
  },
  alibaba: {
    family: "alibaba",
    localPath: "/alibaba/v1/chat/completions",
    modelsPath: "/alibaba/v1/models",
    upstreamURL: "https://opencode.ai/zen/go/v1/chat/completions",
    models: ["qwen3.6-plus", "qwen3.5-plus"]
  }
};

export function getConfigDir(env = process.env) {
  return env.GO_POOL_CONFIG_DIR || env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode");
}

export function getStorePath(env = process.env) {
  return path.join(getConfigDir(env), "opencode-go-workspaces.json");
}

export function getPluginLoaderPath(env = process.env) {
  return path.join(getConfigDir(env), "plugins", "opencode-go-workspace-pool.js");
}

export function getListenURL() {
  return new URL(`http://${DEFAULT_LISTEN_HOST}:${DEFAULT_LISTEN_PORT}`);
}
