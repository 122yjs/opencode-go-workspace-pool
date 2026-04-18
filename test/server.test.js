import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";
import { createServer } from "../src/server.js";
import { WorkspaceRepository } from "../src/store.js";

test("server fails over and stays sticky on replacement workspace", async () => {
  const repository = await createRepository();
  const first = await repository.addWorkspace("main", "key-main");
  const second = await repository.addWorkspace("backup", "key-backup");

  const authHeaders = [];
  let firstCalls = 0;

  const server = createServer({
    repository,
    now: () => new Date("2026-04-18T10:00:00.000Z"),
    sleep: async () => {},
    fetchImpl: async (url, options) => {
      authHeaders.push(options.headers.get("authorization"));
      if (options.headers.get("authorization") === `Bearer ${first.apiKey}`) {
        firstCalls += 1;
        return new Response(JSON.stringify({ error: { message: "rate limit exceeded" } }), {
          status: 429,
          headers: { "retry-after": "0" }
        });
      }
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    },
    logger: { warn() {} }
  });

  await withListeningServer(server, async (port) => {
    const body = JSON.stringify({ model: "glm-5", messages: [{ role: "user", content: "hi" }] });
    const firstResponse = await postJSON(port, "/openai/v1/chat/completions", body);
    const secondResponse = await postJSON(port, "/openai/v1/chat/completions", body);

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 200);
    assert.equal(firstCalls, 1);
    assert.deepEqual(authHeaders, [
      `Bearer ${first.apiKey}`,
      `Bearer ${second.apiKey}`,
      `Bearer ${second.apiKey}`
    ]);
  });
});

test("server retries same workspace once on short retry-after", async () => {
  const repository = await createRepository();
  const first = await repository.addWorkspace("main", "key-main");
  const second = await repository.addWorkspace("backup", "key-backup");

  const authHeaders = [];
  let sleepCalls = 0;
  let workCalls = 0;

  const server = createServer({
    repository,
    now: () => new Date("2026-04-18T10:00:00.000Z"),
    sleep: async () => { sleepCalls += 1; },
    fetchImpl: async (_url, options) => {
      authHeaders.push(options.headers.get("authorization"));
      if (options.headers.get("authorization") === `Bearer ${first.apiKey}`) {
        workCalls += 1;
        return new Response(JSON.stringify({ error: { message: "rate limit exceeded" } }), {
          status: 429,
          headers: { "retry-after": workCalls === 1 ? "1" : "0" }
        });
      }
      return new Response(JSON.stringify({ id: "ok" }), { status: 200 });
    },
    logger: { warn() {} }
  });

  await withListeningServer(server, async (port) => {
    const body = JSON.stringify({ model: "glm-5", messages: [{ role: "user", content: "hi" }] });
    const response = await postJSON(port, "/openai/v1/chat/completions", body);
    assert.equal(response.statusCode, 200);
    assert.equal(sleepCalls, 1);
    assert.deepEqual(authHeaders, [
      `Bearer ${first.apiKey}`,
      `Bearer ${first.apiKey}`,
      `Bearer ${second.apiKey}`
    ]);
  });
});

test("server returns blocked summary when all workspaces cooldown", async () => {
  const repository = await createRepository();
  const workspace = await repository.addWorkspace("main", "key-main");
  const now = new Date("2026-04-18T10:00:00.000Z");
  await repository.markFailure(workspace.id, "openai", "rate-limit", 60000, now);

  const server = createServer({
    repository,
    now: () => new Date("2026-04-18T10:00:02.000Z"),
    logger: { warn() {} }
  });

  await withListeningServer(server, async (port) => {
    const body = JSON.stringify({ model: "glm-5", messages: [{ role: "user", content: "hi" }] });
    const response = await postJSON(port, "/openai/v1/chat/completions", body);
    assert.equal(response.statusCode, 429);
    assert.match(response.body, /blocked_key_count=1/);
    assert.match(response.body, /earliest_retry=/);
    assert.match(response.body, /last_upstream_error=rate-limit/);
  });
});

async function createRepository() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "go-pool-server-"));
  const storePath = path.join(tempDir, "opencode-go-workspaces.json");
  return new WorkspaceRepository(storePath).load();
}

async function withListeningServer(server, callback) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await callback(address.port);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function postJSON(port, route, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: route,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}
