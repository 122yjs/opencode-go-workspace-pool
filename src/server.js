import http from "node:http";
import { Readable } from "node:stream";
import { DEFAULT_LISTEN_HOST, DEFAULT_LISTEN_PORT, ROUTES } from "./config.js";
import { WorkspaceRepository, SelectionError } from "./store.js";

const GLOBAL_SERVER_KEY = Symbol.for("opencode-go-workspace-pool.server");

export async function ensureWorkspacePoolServer() {
  if (globalThis[GLOBAL_SERVER_KEY]) {
    return globalThis[GLOBAL_SERVER_KEY];
  }

  const repository = await new WorkspaceRepository().load();
  const server = createServer({ repository });

  try {
    await listen(server, DEFAULT_LISTEN_PORT, DEFAULT_LISTEN_HOST);
    globalThis[GLOBAL_SERVER_KEY] = { server, repository, external: false };
    return globalThis[GLOBAL_SERVER_KEY];
  } catch (error) {
    if (error && error.code === "EADDRINUSE") {
      const health = await fetch(`http://${DEFAULT_LISTEN_HOST}:${DEFAULT_LISTEN_PORT}/healthz`).catch(() => null);
      if (health?.ok) {
        globalThis[GLOBAL_SERVER_KEY] = { server: null, repository, external: true };
        return globalThis[GLOBAL_SERVER_KEY];
      }
    }
    throw error;
  }
}

export function createServer({ repository, now = () => new Date(), sleep = defaultSleep, fetchImpl = fetch, logger = console }) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const route = getRoute(req.method, req.url);
      if (!route) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "route not found", status: 404 } }));
        return;
      }

      if (route.kind === "models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          object: "list",
          data: route.definition.models.map((model) => ({
            id: model,
            object: "model",
            owned_by: "opencode-go-workspace-pool"
          }))
        }));
        return;
      }

      const body = await readRequestBody(req);
      let lastUpstreamError = "";

      while (true) {
        let workspace;
        try {
          workspace = await repository.selectWorkspace(route.definition.family, now());
        } catch (error) {
          if (error instanceof SelectionError) {
            res.writeHead(429, { "content-type": "application/json" });
            res.end(JSON.stringify({
              error: {
                message: buildBlockedMessage(error, lastUpstreamError),
                status: 429
              }
            }));
            return;
          }
          throw error;
        }

        const result = await proxyRequest({
          body,
          originalRequest: req,
          route: route.definition,
          workspace,
          fetchImpl
        });

        if (result.kind === "network-error") {
          lastUpstreamError = result.reason;
          await repository.markFailure(workspace.id, route.definition.family, result.reason, 15_000, now());
          continue;
        }

        if (result.kind === "retry-same-workspace") {
          logger.warn?.("short retry-after received; retrying same workspace once", {
            workspace_id: workspace.id,
            family: route.definition.family,
            cooldown_ms: result.retryAfterMs
          });
          await sleep(result.retryAfterMs);

          const retryResult = await proxyRequest({
            body,
            originalRequest: req,
            route: route.definition,
            workspace,
            fetchImpl
          });

          if (retryResult.kind === "network-error") {
            lastUpstreamError = retryResult.reason;
            await repository.markFailure(workspace.id, route.definition.family, retryResult.reason, 15_000, now());
            continue;
          }

          if (retryResult.kind === "failover") {
            lastUpstreamError = retryResult.reason;
            await repository.markFailure(workspace.id, route.definition.family, retryResult.reason, retryResult.cooldownMs, now());
            continue;
          }

          await repository.markSuccess(workspace.id, route.definition.family, now());
          await writeProxyResponse(res, retryResult.response);
          return;
        }

        if (result.kind === "failover") {
          lastUpstreamError = result.reason;
          await repository.markFailure(workspace.id, route.definition.family, result.reason, result.cooldownMs, now());
          logger.warn?.("failing over to next workspace", {
            workspace_id: workspace.id,
            family: route.definition.family,
            reason: result.reason,
            cooldown_ms: result.cooldownMs
          });
          continue;
        }

        await repository.markSuccess(workspace.id, route.definition.family, now());
        await writeProxyResponse(res, result.response);
        return;
      }
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : String(error),
          status: 500
        }
      }));
    }
  });
}

function getRoute(method, rawURL) {
  if (!rawURL) return null;
  for (const definition of Object.values(ROUTES)) {
    if (definition.modelsPath && method === "GET" && rawURL === definition.modelsPath) {
      return { kind: "models", definition };
    }
    if (method === "POST" && rawURL === definition.localPath) {
      return { kind: "proxy", definition };
    }
  }
  return null;
}

async function proxyRequest({ body, originalRequest, route, workspace, fetchImpl }) {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(originalRequest.headers)) {
      if (!value) continue;
      const lower = key.toLowerCase();
      if (lower === "authorization" || lower === "content-length" || lower === "host") continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("authorization", `Bearer ${workspace.apiKey}`);

    const response = await fetchImpl(route.upstreamURL, {
      method: "POST",
      headers,
      body,
      duplex: "half"
    });

    if (!isRetryableStatus(response.status)) {
      return { kind: "success", response };
    }

    const responseText = await response.text();
    const retryAfterMs = parseRetryAfter(response.headers);
    const reason = classifyRetryableError(response.status, responseText);
    const bufferedResponse = new Response(responseText, {
      status: response.status,
      headers: response.headers
    });

    if (retryAfterMs > 0 && retryAfterMs <= 5000) {
      return { kind: "retry-same-workspace", retryAfterMs, response: bufferedResponse, reason };
    }

    return {
      kind: "failover",
      cooldownMs: boundedCooldown(retryAfterMs, 300_000),
      response: bufferedResponse,
      reason
    };
  } catch (error) {
    return {
      kind: "network-error",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildBlockedMessage(selectionError, lastUpstreamError) {
  const lastError = lastUpstreamError || selectionError.lastError || "all workspaces are cooling down";
  if (selectionError.earliestRetry) {
    return `all workspaces blocked: blocked_key_count=${selectionError.blockedCount} earliest_retry=${selectionError.earliestRetry} last_upstream_error=${lastError}`;
  }
  return `all workspaces blocked: blocked_key_count=${selectionError.blockedCount} last_upstream_error=${lastError}`;
}

async function writeProxyResponse(res, response) {
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === "content-length") continue;
    res.setHeader(key, value);
  }
  res.writeHead(response.status);
  if (!response.body) {
    res.end();
    return;
  }
  await new Promise((resolve, reject) => {
    Readable.fromWeb(response.body).pipe(res);
    response.body.on?.("error", reject);
    res.on("finish", resolve);
    res.on("error", reject);
  });
}

function isRetryableStatus(status) {
  return status === 429 || status === 503 || status === 529;
}

function parseRetryAfter(headers) {
  if (headers.has("retry-after-ms")) {
    const value = Number.parseInt(headers.get("retry-after-ms"), 10);
    if (Number.isFinite(value) && value > 0) return value;
  }
  if (headers.has("retry-after")) {
    const value = Number.parseInt(headers.get("retry-after"), 10);
    if (Number.isFinite(value) && value > 0) return value * 1000;
  }
  return 15_000;
}

function boundedCooldown(value, max) {
  if (!value || value <= 0) return max;
  return Math.min(value, max);
}

function classifyRetryableError(status, body) {
  const lower = body.toLowerCase();
  if (lower.includes("usage")) return "usage-limit";
  if (lower.includes("credit")) return "credit-exhausted";
  if (lower.includes("temporary")) return "temporary-upstream-block";
  if (status === 429) return "rate-limit";
  return "temporary-upstream-block";
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
