import { ensureWorkspacePoolServer } from "../src/server.js";
import { WorkspaceRepository } from "../src/store.js";

const DUMMY_AUTH_KEY = "workspace-pool-managed";

export async function OpencodeGoWorkspacePoolPlugin() {
  await ensureWorkspacePoolServer();
  const getRepository = async () => new WorkspaceRepository().load();

  return {
    tool: {
      workspace_list: {
        description: "List configured OpenCode Go workspaces without exposing API keys.",
        args: {},
        execute: async () => {
          const repository = await getRepository();
          const workspaces = repository.listWorkspaces();
          if (workspaces.length === 0) {
            return "No workspaces configured.";
          }
          return formatTable(
            ["ID", "WORKSPACE", "ENABLED"],
            workspaces.map((workspace) => [workspace.id, workspace.label, String(workspace.enabled)])
          );
        }
      },
      workspace_status: {
        description: "Show workspace status including current workspace and cooldown state.",
        args: {},
        execute: async () => {
          const repository = await getRepository();
          const statuses = repository.status();
          if (statuses.length === 0) {
            return "No workspaces configured.";
          }
          return formatTable(
            ["ID", "WORKSPACE", "CURRENT", "ENABLED", "ACTIVE_FOR", "COOLDOWN_UNTIL", "LAST_ERROR"],
            statuses.map((status) => [
              status.id,
              status.label,
              status.current ? "*" : "",
              String(status.enabled),
              status.activeFor.join(","),
              status.cooldownUntil || "",
              status.lastError || ""
            ])
          );
        }
      },
      workspace_current: {
        description: "Show the currently pinned workspace, if any.",
        args: {},
        execute: async () => {
          const repository = await getRepository();
          const current = repository.currentWorkspace();
          if (!current) {
            return "No current workspace selected.";
          }
          return formatTable(
            ["ID", "WORKSPACE", "CURRENT", "ENABLED"],
            [[current.id, current.label, "*", String(current.enabled)]]
          );
        }
      },
      workspace_use: {
        description: "Pin a workspace as the current preferred workspace for future requests.",
        args: {
          workspace_id: {
            type: "string",
            description: "Workspace ID to pin as current."
          }
        },
        execute: async ({ workspace_id }) => {
          const repository = await getRepository();
          if (!workspace_id) {
            return "workspace_id is required.";
          }
          const workspace = await repository.useWorkspace(workspace_id);
          return `Current workspace set to ${workspace.id} (${workspace.label}).`;
        }
      }
    },
    auth: {
      provider: "opencode-go-workspace-pool",
      loader: async () => ({}),
      methods: [
        {
          type: "api",
          label: "Add OpenCode Go Workspace",
          prompts: [
            {
              type: "text",
              key: "label",
              message: "Workspace label",
              placeholder: "main"
            },
            {
              type: "text",
              key: "api_key",
              message: "Workspace API key",
              placeholder: "sk-...",
              validate: (value) => value ? undefined : "api_key is required"
            }
          ],
          authorize: async (inputs = {}) => {
            const repository = await getRepository();
            if (!inputs.label || !inputs.api_key) {
              return { type: "failed" };
            }
            await repository.addWorkspace(inputs.label, inputs.api_key);
            return { type: "success", key: DUMMY_AUTH_KEY };
          }
        },
        {
          type: "api",
          label: "Use OpenCode Go Workspace",
          prompts: [
            {
              type: "text",
              key: "workspace_id",
              message: "Workspace ID",
              placeholder: "ws-..."
            }
          ],
          authorize: async (inputs = {}) => {
            const repository = await getRepository();
            if (!inputs.workspace_id) {
              return { type: "failed" };
            }
            await repository.useWorkspace(inputs.workspace_id);
            return { type: "success", key: DUMMY_AUTH_KEY };
          }
        },
        {
          type: "api",
          label: "Enable OpenCode Go Workspace",
          prompts: [
            {
              type: "text",
              key: "workspace_id",
              message: "Workspace ID",
              placeholder: "ws-..."
            }
          ],
          authorize: async (inputs = {}) => {
            const repository = await getRepository();
            if (!inputs.workspace_id) {
              return { type: "failed" };
            }
            await repository.enableWorkspace(inputs.workspace_id);
            return { type: "success", key: DUMMY_AUTH_KEY };
          }
        },
        {
          type: "api",
          label: "Disable OpenCode Go Workspace",
          prompts: [
            {
              type: "text",
              key: "workspace_id",
              message: "Workspace ID",
              placeholder: "ws-..."
            }
          ],
          authorize: async (inputs = {}) => {
            const repository = await getRepository();
            if (!inputs.workspace_id) {
              return { type: "failed" };
            }
            await repository.disableWorkspace(inputs.workspace_id);
            return { type: "success", key: DUMMY_AUTH_KEY };
          }
        },
        {
          type: "api",
          label: "Delete OpenCode Go Workspace",
          prompts: [
            {
              type: "text",
              key: "workspace_id",
              message: "Workspace ID",
              placeholder: "ws-..."
            }
          ],
          authorize: async (inputs = {}) => {
            const repository = await getRepository();
            if (!inputs.workspace_id) {
              return { type: "failed" };
            }
            await repository.deleteWorkspace(inputs.workspace_id);
            return { type: "success", key: DUMMY_AUTH_KEY };
          }
        }
      ]
    }
  };
}

export default OpencodeGoWorkspacePoolPlugin;

function formatTable(headers, rows) {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => (row[index] || "").length)
  ));

  const formatRow = (row) => row.map((cell, index) => (cell || "").padEnd(widths[index])).join("  ").trimEnd();
  return `${formatRow(headers)}\n${rows.map(formatRow).join("\n")}${rows.length ? "\n" : ""}`;
}
