import { ensureWorkspacePoolServer } from "../src/server.js";

export async function OpencodeGoWorkspacePoolPlugin() {
  await ensureWorkspacePoolServer();
  return {};
}

export default OpencodeGoWorkspacePoolPlugin;
