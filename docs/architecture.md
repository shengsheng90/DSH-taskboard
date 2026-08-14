# Architecture

The out-of-tree package keeps the proposal's owners as modules inside one publishable Harness bundle.

```text
native client page
  -> generated Typert Remote contribution
  -> TaskboardService (authenticated human intents)
  -> SqliteTaskboardProvider (sole task authority)
  -> SQLite + Host attachment directory

taskboard_* tools -> TaskboardService.provider
automation scheduler -> HarnessTaskboardWorker
HarnessTaskboardWorker -> Agent + Session + Goal + Workspace
```

`TaskboardService` is a `TypertRemoteService`. Official generator output is checked in under `generated/` and mounted by the browser contribution through `ctx.remote.$mount`. Snapshot and detail results cross as validated JSON text because stored source/activity metadata intentionally supports arbitrary JSON; mutation requests use a typed JSON-text carrier. Attachment bytes use dedicated one-time PUT/GET routes.

Provider mutations run under `BEGIN IMMEDIATE`, compare exact versions, append activity, increment the global revision, commit, and only then publish detached invalidation events. Subscriber failures cannot roll back committed state. The Web page treats data as invalidatable, refreshes after direct mutations and connection-generation changes, and keeps one bounded plugin-owned Typert long poll open against the last loaded global revision. A committed revision wakes the poll immediately; timeout, gap, reset, reconnect, and periodic snapshots converge through the same bounded snapshot baseline. The plugin does not extend or modify Harness's static Host-event allowlist.

The Agent driver never imports `agent-loop`. It creates or resumes a root Agent through public services, mounts the configured preset and model route, selects the Workspace/worktree cwd, creates a Goal, and persists a normal user message with a merge-extensible `taskboard` source. Goal completion submits review; it does not accept.

The workflow catalog preserves every reference node kind. `WorkflowNodeRegistry` labels nodes executable only when a Host provider with schema, validation, and execution has been registered through `ctx.taskboard.workflowNodes`; all others remain editable design-only nodes. The editor discovers installed Skills and MCP tools for node authoring without incorrectly promoting discovery alone to execution support.
