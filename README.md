# DSH Taskboard

English | [简体中文](README.zh.md)

Native, local project task management for DeepSeek Harness. SQLite is the sole task authority. Harness Agent Sessions, Goals, Workspaces, tools, permissions, and the Web Client remain the execution and conversation owners.

This README is written so a human **or another coding agent** can install the plugin into a live Harness profile, verify it, and start using it without guessing.

**Package:** `@shengsheng/dsh-taskboard`  
**Repository:** https://github.com/shengsheng90/DSH-taskboard  
**License:** Apache-2.0  
**Compatible Host:** DeepSeek Harness `0.1.0-rc.5`

![Native Taskboard board, task detail, and workflow views](docs/assets/taskboard-demo.gif)

If you are an installing agent, jump to [Install into DeepSeek Harness](#install-into-deepseek-harness) and follow every step in order. Do **not** add this Git repository as a raw plugin source: `lib/` is gitignored, so a git install has no compiled Host/Client bundle.

## What you get

After a successful install, Harness gains:

- A **Taskboard** sidebar button and a native overlay page (not an iframe, not a second chat runtime)
- Local SQLite projects, tasks, comments, relations, attachments, workflows, and automation
- Stable readable keys such as `DSH-42` plus opaque ids and optimistic versions
- Seven statuses: `backlog` → `todo` → `in_progress` → `in_review` → `done`, plus `blocked` and `canceled`
- In-process Agent tools `taskboard_*` (no accept / no generic status mutation)
- Headless JSON CLI `dsh-taskboard`
- Packaged Skill `manage-taskboard`

Agents can submit verified work to `in_review`. Only an authenticated human UI or CLI operation can accept it as `done`.

Further design docs: [Architecture](docs/architecture.md), [Security and recovery](docs/security.md), [CLI reference](docs/cli.md), [Acceptance audit](docs/acceptance-audit.md). Attribution shipped to package consumers is in `THIRD_PARTY_NOTICES.md`.

## Requirements

| Requirement | Value |
|---|---|
| Node.js | `^22.19.0` or `>=24.0.0` (24 recommended; built-in `node:sqlite`) |
| pnpm | `11` (`packageManager` is `pnpm@11.15.1`) |
| DeepSeek Harness | `0.1.0-rc.5` checkout or installation, **web** profile |
| Network | only needed to clone this repo and install Node dependencies |
| Permissions | write access to `$DSH_HOME` (default `~/.dsh`) and the ability to restart the Harness process |

Confirm the toolchain before installing:

```sh
node -v    # v22.19+ or v24+
pnpm -v    # 11.x
```

## Install into DeepSeek Harness

Use these constants. Read live values from disk; do not invent a different package name.

| Name | Value |
|---|---|
| Package name | `@shengsheng/dsh-taskboard` |
| Default profile | `web` |
| Default Web port | `3080` (detect; do not assume) |
| Profile directory | `$DSH_HOME/profiles/<profile>` , usually `~/.dsh/profiles/web` |
| Packed tarball name | `shengsheng-dsh-taskboard-<version>.tgz` |

`<version>` comes from this repo's `package.json` (`0.1.0` at the time of writing). After `pnpm pack`, use the tarball that was actually written.

A longer copy-paste prompt for a Harness-side agent is in [docs/install-plugin-prompt.zh.md](docs/install-plugin-prompt.zh.md). The steps below are the normative English procedure.

### 1. Detect the running Harness

Find the Web listener and its working directory:

```sh
PORT=3080
lsof -iTCP:"$PORT" -sTCP:LISTEN
# then, with the listener PID:
lsof -p <PID> -a -d cwd
```

If nothing is listening on `3080`, search other common ports or ask the operator for the URL they use (`http://127.0.0.1:<port>`).

Decide how to invoke the `dsh` CLI:

- If the Harness cwd is a source checkout (repo root has `pnpm-workspace.yaml` and `package.json` contains a `"dsh"` script), run every later command from that checkout root as `pnpm dsh ...`.
- Else if `command -v dsh` succeeds, use `dsh ...` directly.

In the commands below, `dsh` means whichever of those two forms you just chose. First use of a profile may initialize it and install `@deepseek-ai/dsh-base`.

### 2. Build a packed plugin (required)

`lib/` is not in git. Always build, then pack. Installing the raw git tree or an unbuilt working copy will produce a package without Host/Client output.

```sh
git clone https://github.com/shengsheng90/DSH-taskboard.git
cd DSH-taskboard
pnpm install
pnpm build
pnpm pack
```

Expected artifacts:

- `lib/index.js`, `lib/cli.js`, `lib/client.js` (and sibling declarations)
- `shengsheng-dsh-taskboard-<version>.tgz` in the repo root

Record the absolute tarball path. Example:

```text
/absolute/path/to/DSH-taskboard/shengsheng-dsh-taskboard-0.1.0.tgz
```

If this repository is already cloned and dependencies are installed, `pnpm build && pnpm pack` is enough. Optional local checks: `pnpm typecheck`, `pnpm test`, `pnpm example`.

### 3. Add the plugin to the profile

The profile directory is a pnpm workspace root (`packages: [.]`). The `-w` / workspace-root flag is **mandatory**. Without it, pnpm fails with `ERR_PNPM_ADDING_TO_ROOT`.

```sh
dsh plugin --profile web add -w /absolute/path/to/shengsheng-dsh-taskboard-0.1.0.tgz
```

Prefer the packed tarball over the source directory. A source-directory add can miss `lib/` if the tree was not built.

This command may rewrite the profile `package.json`, lockfile, and `node_modules`. That is expected.

Install succeeded only when **all** of the following are true:

1. `$DSH_HOME/profiles/web/package.json` `dependencies` contains `@shengsheng/dsh-taskboard`.
2. The same file's `dsh.profile.bundles` lists `@shengsheng/dsh-taskboard` **after** `@deepseek-ai/dsh-base`.
3. `$DSH_HOME/profiles/web/node_modules/@shengsheng/dsh-taskboard/` exists and contains `lib/` plus `cordis.patch.yml`.

If the CLI warns `declares no dsh.bundle`, the package is missing `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` in `package.json`. This repository already declares that; rebuild and reinstall rather than editing the installed copy by hand.

### 4. Verify composition (does not start the server)

```sh
dsh --profile web --dump-config
```

Pass when the dump ends with a `# == @shengsheng/dsh-taskboard` layer and the `taskboard` plugin config (`databasePath`, `attachmentRoot`, worker limits, and the other keys listed in [Configuration](#configuration)).

`--dump-config` idempotently rewrites the profile-root `cordis.yml`. If a sandbox returns `EPERM` while writing `~/.dsh`, ask the operator for full filesystem permission and retry. That rewrite is expected, not a failure.

### 5. Smoke-test module resolution

```sh
cd ~/.dsh/profiles/web && node --input-type=module -e \
  "import('@shengsheng/dsh-taskboard').then(m=>console.log('OK', m.name, typeof m.apply)).catch(e=>{console.error(e.message);process.exit(1)})"
```

Pass: `OK taskboard function`.

Fail is usually a missing peer (`@deepseek-ai/*` or `react`). Those resolve through the install-fallback links under `~/.dsh/profiles/node_modules`, which Harness heals on boot. Re-run step 4, then retry this import.

### 6. See whether the running process already loaded the plugin

Plugin composition and client-module scanning happen **only at boot**. Installing into the profile does not hot-load the UI.

```sh
curl -s http://127.0.0.1:3080/ | grep -c '@shengsheng/dsh-taskboard'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/plugins/@shengsheng/dsh-taskboard/client.js
```

- Manifest count `> 0` **and** bundle HTTP `200` → already active; skip the restart and go to [Confirm activation](#7-confirm-activation).
- Otherwise restart Harness.

### 7. Restart Harness

Restart stops the process that hosts the current session. Session data lives in `$DSH_HOME/sessions` and is not deleted; in-flight Agent turns are interrupted. Tell the operator before restarting.

From a Harness source checkout, a typical restart is:

```sh
# stop the current listener
OLD_PID=$(lsof -tiTCP:3080 -sTCP:LISTEN | head -1)
if [ -n "$OLD_PID" ]; then kill -TERM "$OLD_PID"; fi

# wait until the port is free, then start again from the checkout root
cd /absolute/path/to/deepseek-harness
nohup pnpm dsh --profile web >> /tmp/dsh-harness-restart.log 2>&1 &
```

Do not treat the first successful `GET /` as “plugin ready”. The Web server can accept connections before the boot manifest injects the plugin. Poll until the package name appears:

```sh
for _ in $(seq 1 30); do
  if curl -s http://127.0.0.1:3080/ | grep -q '@shengsheng/dsh-taskboard'; then echo ready; break; fi
  sleep 2
done
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/plugins/@shengsheng/dsh-taskboard/client.js
```

A detached restart script used in a real install is documented in [docs/install-plugin-prompt.zh.md](docs/install-plugin-prompt.zh.md) (step 6). Prefer that script when the installing agent would be killed with the old Harness process group.

### 8. Confirm activation

All of these must pass:

| Check | Expected |
|---|---|
| `GET /` contains `@shengsheng/dsh-taskboard` | count ≥ 1 |
| `GET /plugins/@shengsheng/dsh-taskboard/client.js` | HTTP 200 |
| Harness boot log | no plugin import / apply error |
| Browser | refresh `http://127.0.0.1:<port>`; a Taskboard control appears in the sidebar footer |

Default data files (created on first use, Host-resolved paths):

```text
.dsh/taskboard.sqlite
.dsh/taskboard-attachments
```

### Install troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `dsh: command not found` | CLI not on `PATH` | From a Harness checkout root, use `pnpm dsh ...` |
| `ERR_PNPM_ADDING_TO_ROOT` | profile is a pnpm workspace root | Add `-w` |
| git / directory install has no `lib/` | `lib/` is gitignored | `pnpm build && pnpm pack`, then add the `.tgz` |
| `EPERM` writing `~/.dsh` | sandbox | Ask the operator for full permissions; the write is idempotent |
| Manifest / `client.js` still 404 | no restart, or checked too early | Restart, then poll (step 7) |
| Import / apply error | missing peers or missing bundle entry | Heal fallbacks with `--dump-config`; confirm `dsh.profile.bundles` |
| `declares no dsh.bundle` | package missing bundle patch | Rebuild this repo; do not hand-edit the installed tree |
| GUI down after restart | Harness failed to boot | Read `/tmp/dsh-harness-restart.log` or the process log; confirm checkout path and `pnpm dsh` |

Install only packages you trust. `pnpm` runs package lifecycle scripts, and Harness then loads the plugin.

## Use the Taskboard

### Human UI

1. Open the Harness Web Client and click the **Taskboard** control in the sidebar footer.
2. Create a project: name, short key (used for readable ids such as `DSH-1`), optional Harness Workspace id. Leave Workspace blank for a global project.
3. Create a task. New work starts in `backlog` unless you create it already as `todo`.
4. Write the description in Markdown. Attach files by paste, drop, or file picker.
5. **Approve for work** moves `backlog` → `todo`. Agents and automation may claim only eligible `todo` items.
6. Use **Board**, **List**, **Gantt**, **Workflows**, and the Dashboard as needed. The page follows the Harness locale (Chinese or English).
7. When an Agent submits review, open the task, read the result comment and verification, then **Accept** (`done`) or **Return for rework**.
8. Map a Workspace before using **Open in new session**. That action opens a native blank Session with an unsent draft that carries the exact task id and revision.

Human-only actions (UI or CLI, never model tools): approve, accept, return, archive, restore, cancel, reopen, force takeover, permanent delete.

### Task lifecycle

```text
human creates backlog
  -> human approves to todo
  -> Agent or automation claims (dependency recheck + exclusive claim + Session)
  -> Agent works in the bound Workspace / branch / worktree
  -> Agent verifies and submits in_review
  -> human accepts done, or returns to todo / in_progress
```

Rules every caller must keep:

- Every mutation except create carries the **exact current `version`**.
- `TASK_STALE_VERSION` means reread and reconcile; do not retry the stale version.
- Never derive an opaque task id from a display key such as `DSH-42`. Use the id the API returned.
- Goal completion never accepts a task. Agent success ends at `in_review`.
- Returning or resuming to `todo` releases the claim. Direct `in_progress` rework must create a fresh explicit claim.
- Orphaned claims stay visible. They are not silently stolen.

### Agent tools

Models must use the in-process tools. Do not shell out to `dsh-taskboard` from a model turn when a tool exists.

| Tool | Purpose |
|---|---|
| `taskboard_list` | Bounded list for one exact `project_id` |
| `taskboard_get` | Full detail, version, comments, relations, claim |
| `taskboard_claim` | Claim one eligible `todo` with `expected_version` |
| `taskboard_comment` | Append a Markdown comment |
| `taskboard_submit_review` | Move owned `in_progress` work to `in_review` |
| `taskboard_block` | Block with a concrete reason |
| `taskboard_release_claim` | Release only the current Agent's claim |
| `taskboard_relate` | Add `parent`, `blocks`, or `related` in the same project |

There is no accept tool and no generic status tool. Follow the packaged Skill at [`skills/manage-taskboard/SKILL.md`](skills/manage-taskboard/SKILL.md):

1. `taskboard_list` → pick an eligible `todo`.
2. `taskboard_get` immediately before the write.
3. `taskboard_claim` with the exact version.
4. Do the work in the task's declared development context.
5. Verify, then `taskboard_submit_review` with evidence. Never edit the task description to record the result.

### JSON CLI

The CLI emits schema-versioned JSON. Use it for human scripts and interoperability, not as the model's primary API.

```sh
dsh-taskboard --database .dsh/taskboard.sqlite project list
dsh-taskboard --database .dsh/taskboard.sqlite project create --key DSH --name "My project"
dsh-taskboard --database .dsh/taskboard.sqlite task create --project <project-id> --title "Ship the plugin"
dsh-taskboard --database .dsh/taskboard.sqlite task get --task DSH-1
dsh-taskboard --database .dsh/taskboard.sqlite task approve --task <opaque-id> --version 1
dsh-taskboard --database .dsh/taskboard.sqlite task accept --task <opaque-id> --version 7
```

Structured writes accept JSON:

```sh
dsh-taskboard task create --request-json '{"projectId":"project-...","title":"Ship","creator":"human:cli","priority":"high"}'
dsh-taskboard task update --task task-... --version 3 --request-json '{"labels":["release"]}'
dsh-taskboard task return --task task-... --version 4 --comment "Fix the failing test"
```

Groups: `project`, `task`, `relation`, `attachment`, `workflow`, `automation`, `storage`. Full command list: [docs/cli.md](docs/cli.md).

Exit codes: `0` success, `2` usage, `3` storage/service unavailable, `4` domain/API error, `5` optimistic conflict (`TASK_STALE_VERSION`).

If the binary is not on `PATH`, run the installed file:

```sh
node ~/.dsh/profiles/web/node_modules/@shengsheng/dsh-taskboard/lib/cli.js --database .dsh/taskboard.sqlite storage status
```

### Automation

On the Taskboard page, create an automation for a project: interval, Agent preset, model route, worker count, and quota policy. When enabled, the Host scheduler claims eligible `todo` work, drives a root Agent Session and Goal, and stops at `in_review`. Quota uncertainty pauses new claims without cancelling running work.

## Configuration

`cordis.patch.yml` mounts one Host plugin id `taskboard`. Override values in the profile composition or with environment variables. Paths are resolved by the Host. The browser cannot choose the database or attachment root.

| Key | Default | Notes |
|---|---|---|
| `databasePath` | `.dsh/taskboard.sqlite` | `DSH_TASKBOARD_DATABASE` |
| `attachmentRoot` | `.dsh/taskboard-attachments` | `DSH_TASKBOARD_ATTACHMENTS` |
| `pageSize` | `100` | Bounded list page |
| `maxAttachmentBytes` | `26214400` | Per file (25 MiB) |
| `maxTaskAttachmentBytes` | `104857600` | Per task (100 MiB) |
| `minAutomationIntervalMs` | `30000` | Floor for automation interval |
| `maxProjectWorkers` | `2` | Concurrent claims per project |
| `maxGlobalWorkers` | `4` | Concurrent claims globally |
| `allowSharedWorktrees` | `false` | Exclusive development context |
| `clientRefreshIntervalMs` | `15000` | Snapshot recovery interval |
| `maxChangeWaiters` | `128` | Long-poll waiter cap |
| `maxChangeWatchMs` | `30000` | Long-poll timeout |
| `defaultAgentPreset` | `standard` | Worker preset |

Attachment content types and sizes are validated before publication. Dashboard and `storage status` share the same bounded SQLite integrity, revision, count, attachment-cleanup, and orphaned-claim diagnostics.

While the page is open, the plugin waits on the next committed global revision over the existing Typert connection. Timeout polling and periodic snapshots are recovery paths. This does not require changing the Harness Host-event allowlist.

Backup both the SQLite file (and WAL, if live) and the attachment directory. For a consistent offline backup, stop Harness first.

## Develop this repository

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm example
```

`pnpm build` compiles Host declarations and runtime, copies the checked official Typert generator artifacts, and produces the browser bundle. Generated Remote files stay in `generated/` so an out-of-tree build does not need an adjacent Harness checkout.

`pnpm check` runs typecheck, tests, and build.

## Further documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Module owners and refresh model |
| [docs/security.md](docs/security.md) | Authority split, attachments, recovery |
| [docs/cli.md](docs/cli.md) | JSON CLI groups and exits |
| [docs/acceptance-audit.md](docs/acceptance-audit.md) | Row-by-row acceptance evidence |
| [docs/browser-e2e.md](docs/browser-e2e.md) | Deterministic browser lifecycle |
| [docs/install-plugin-prompt.zh.md](docs/install-plugin-prompt.zh.md) | Chinese copy-paste install prompt for a Harness agent |
| [skills/manage-taskboard/SKILL.md](skills/manage-taskboard/SKILL.md) | Agent operating procedure |

## License

Apache-2.0. See `LICENSE` and `THIRD_PARTY_NOTICES.md`.
