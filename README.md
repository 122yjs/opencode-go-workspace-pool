# opencode-go-workspace-pool

OpenCode Go workspace failover plugin.

## Quick start

1. Clone this repo.
2. Install the local plugin loader:

```bash
./scripts/install-local.sh
```

3. Add one or more Go workspaces:

```bash
node ./bin/go-pool.js add --label main --api-key "YOUR_GO_KEY"
node ./bin/go-pool.js add --label backup --api-key "YOUR_OTHER_GO_KEY"
```

4. Print the config snippet:

```bash
node ./bin/go-pool.js config
```

5. Paste that snippet into `~/.config/opencode/opencode.json`.

## What it does

- Starts a local proxy inside OpenCode through a plugin
- Stores Go workspace API keys in `~/.config/opencode/opencode-go-workspaces.json`
- Keeps one workspace sticky until it rate-limits
- Fails over automatically on `429`, `503`, `529`, usage-limit, and credit-exhausted style errors
- Never prints raw API keys in `list` or `status`

## Commands

```bash
node ./bin/go-pool.js add --label main --api-key "YOUR_GO_KEY"
node ./bin/go-pool.js list
node ./bin/go-pool.js status
node ./bin/go-pool.js enable <workspace-id>
node ./bin/go-pool.js disable <workspace-id>
node ./bin/go-pool.js delete <workspace-id>
node ./bin/go-pool.js config
```

Environment variables also work:

- `GO_POOL_API_KEY`
- `GO_POOL_CONFIG_DIR`

## Security

- Workspace keys are stored only in the plugin store file, not in OpenCode's default auth store
- The store file is written with `0600` permissions
- Logs, `list`, `status`, and README examples never echo raw keys
- The generated OpenCode config uses a dummy local provider key because the real Go keys stay in the workspace store
