# DSH Taskboard

Native, local project task management for DeepSeek Harness. SQLite is the sole task authority; Harness Agent Sessions, Goals, Workspaces, tools, permissions, and the Web Client remain the execution and conversation owners.

The plugin provides stable project issue numbers, optimistic versions, seven task states, dependency-aware exclusive claims, comments, activity, safe Host-owned attachments, recurrence-aware Gantt planning, storage health, visual workflows with installed Skill/MCP discovery, persistent automation, a generated Typert Remote client, a native page, JSON CLI, and the `manage-taskboard` Skill. Agents can submit verified work to `in_review`; only authenticated human UI/CLI operations can accept it as `done`.

![Native Taskboard board, task detail, and workflow views](docs/assets/taskboard-demo.gif)

See [Architecture](docs/architecture.md), [Security and recovery](docs/security.md), [CLI reference](docs/cli.md), and the [row-by-row acceptance audit](docs/acceptance-audit.md). The repository-root bilingual proposal notes remain the scope authority; attribution shipped to package consumers is preserved in `THIRD_PARTY_NOTICES.md`.

## Requirements and development

- Node.js 22.19 or newer (Node.js 24 recommended)
- A compatible DeepSeek Harness `0.1.0-rc.5` checkout or installation
- pnpm 11

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm example
```

`pnpm build` compiles Host declarations and runtime code, copies the checked official Typert generator artifacts, and produces the browser bundle. Generated Remote files are kept in `generated/` so a clean out-of-tree build does not depend on an adjacent Harness source checkout.

## Install in Harness

```sh
pnpm pack
dsh plugin --profile web add ./shengsheng-dsh-taskboard-0.1.0.tgz
```

The package's `cordis.patch.yml` mounts one `taskboard` Host plugin. The native client contribution mounts its generated `taskboard` Remote namespace and registers a sidebar entry plus a shell overlay page; it does not use an iframe or a second chat runtime.

Default configuration:

```yaml
databasePath: .dsh/taskboard.sqlite
attachmentRoot: .dsh/taskboard-attachments
pageSize: 100
maxAttachmentBytes: 26214400
maxTaskAttachmentBytes: 104857600
minAutomationIntervalMs: 30000
maxProjectWorkers: 2
maxGlobalWorkers: 4
allowSharedWorktrees: false
clientRefreshIntervalMs: 15000
maxChangeWaiters: 128
maxChangeWatchMs: 30000
defaultAgentPreset: standard
```

Paths are resolved by the Host. Browser input cannot select a database or attachment root. Attachment content types and size limits are validated before publication.

The Dashboard reports bounded SQLite integrity/revision/count diagnostics and recoverable attachment-cleanup/orphaned-claim counts. `storage status` exposes the same operator view as schema-versioned JSON.

## Authority and lifecycle

1. A human creates a backlog task and explicitly approves it to `todo`.
2. An Agent or automation transaction rechecks dependencies, creates one exclusive claim, records the Session, and moves it to `in_progress`.
3. The driver persists the task input in the owning root Agent Session and creates a Goal. Committed human requirement changes are appended as new task-sourced user messages.
4. The owner records verification and submits `in_review`; Goal completion never accepts the task.
5. A human accepts to `done`, returns it to `todo`, or explicitly establishes a fresh claim for immediate `in_progress` rework.

Every mutation uses the exact current version. A `TASK_STALE_VERSION` response means reread and reconcile. Orphaned claims remain visible and cannot be silently stolen.

The client refreshes immediately after direct mutations and connection generation changes. While the page is open, a bounded plugin-owned Typert long poll waits for the next committed global revision and triggers a snapshot refresh; timeout polling and periodic snapshots remain recovery paths. This keeps realtime delivery inside the plugin and does not require changes to the Harness Host-event allowlist.

## Headless use

The CLI emits schema-versioned JSON and uses distinct exit codes: `2` usage, `3` unavailable storage/service, `4` domain/API error, and `5` optimistic conflict.

```sh
dsh-taskboard --database .dsh/taskboard.sqlite project list
dsh-taskboard --database .dsh/taskboard.sqlite task get --task DSH-42
dsh-taskboard --database .dsh/taskboard.sqlite task accept --task <opaque-id> --version 7
```

Model code should use the in-process `taskboard_*` tools, not shell out to the CLI. The model tool set deliberately omits acceptance and generic status mutation.
