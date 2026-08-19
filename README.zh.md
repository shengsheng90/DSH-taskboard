# DSH Taskboard

[English](README.md) | 简体中文

这是 DeepSeek Harness 的原生本地项目任务板插件。SQLite 是任务共享状态的唯一权威；Agent Session、Goal、Workspace、工具、权限和对话历史仍由 Harness 管理。

本文同时写给操作者和**其他大模型**：按顺序执行「安装到 DeepSeek Harness」即可完成探测、打包、安装、组成验证、重启激活，无需猜测命令。

**包名：** `@shengsheng/dsh-taskboard`  
**仓库：** https://github.com/shengsheng90/DSH-taskboard  
**许可证：** Apache-2.0  
**兼容 Host：** DeepSeek Harness `0.1.0-rc.5`

![原生任务板的看板、任务详情和工作流视图](docs/assets/taskboard-demo.gif)

若你是负责安装的代理，直接从 [安装到 DeepSeek Harness](#安装到-deepseek-harness) 按步执行。**不要**把本仓库当作未构建的 git 依赖安装：`lib/` 已被 gitignore，git 安装不会带上编译后的 Host/Client 产物。

## 安装后会得到什么

安装成功后，Harness 会增加：

- 侧栏 **任务板** 按钮和原生 overlay 页面（不是 iframe，也不建立第二套聊天运行时）
- 本地 SQLite 项目、任务、评论、关系、附件、工作流和自动化
- 稳定可读编号（如 `DSH-42`）、不透明 id，以及乐观版本
- 七种状态：`backlog` → `todo` → `in_progress` → `in_review` → `done`，另有 `blocked`、`canceled`
- 进程内 Agent 工具 `taskboard_*`（不含验收，也不含通用改状态）
- 无头 JSON CLI `dsh-taskboard`
- 随包 Skill `manage-taskboard`

Agent 只能把已验证工作提交到 `in_review`；只有经过认证的用户 UI/CLI 操作才能验收为 `done`。

更多设计文档：[架构](docs/architecture.md)、[安全与恢复](docs/security.md)、[CLI 参考](docs/cli.md)、[逐项验收审计](docs/acceptance-audit.md)。随包来源说明见 `THIRD_PARTY_NOTICES.md`。

## 环境要求

| 要求 | 取值 |
|---|---|
| Node.js | `^22.19.0` 或 `>=24.0.0`（推荐 24；使用内置 `node:sqlite`） |
| pnpm | `11`（`packageManager` 为 `pnpm@11.15.1`） |
| DeepSeek Harness | `0.1.0-rc.5` 的 checkout 或安装，**web** profile |
| 网络 | 仅克隆本仓库和安装 Node 依赖时需要 |
| 权限 | 可写 `$DSH_HOME`（默认 `~/.dsh`），并能重启 Harness 进程 |

安装前先确认工具链：

```sh
node -v    # v22.19+ 或 v24+
pnpm -v    # 11.x
```

## 安装到 DeepSeek Harness

使用下列常量。从磁盘读取真实取值，不要自造包名。

| 名称 | 取值 |
|---|---|
| 包名 | `@shengsheng/dsh-taskboard` |
| 默认 profile | `web` |
| 默认 Web 端口 | `3080`（先探测，不要假定） |
| Profile 目录 | `$DSH_HOME/profiles/<profile>`，通常是 `~/.dsh/profiles/web` |
| 打包文件名 | `shengsheng-dsh-taskboard-<version>.tgz` |

`<version>` 以本仓库 `package.json` 为准（撰写时为 `0.1.0`）。`pnpm pack` 之后使用实际生成的 tarball。

给 Harness 内代理使用的一键粘贴提示词见 [docs/install-plugin-prompt.zh.md](docs/install-plugin-prompt.zh.md)。下面是规范安装步骤。

### 1. 探测正在运行的 Harness

查找 Web 监听进程及其工作目录：

```sh
PORT=3080
lsof -iTCP:"$PORT" -sTCP:LISTEN
# 再用监听 PID：
lsof -p <PID> -a -d cwd
```

若 `3080` 上没有监听，换其他常见端口，或向操作者确认正在使用的 URL（`http://127.0.0.1:<port>`）。

判定 `dsh` 的调用方式：

- 若 Harness 的 cwd 是源码 checkout（根目录有 `pnpm-workspace.yaml`，且 `package.json` 含 `"dsh"` script）→ 后续命令都在 checkout 根目录用 `pnpm dsh ...`。
- 否则若 `command -v dsh` 有结果 → 直接用 `dsh ...`。

下文的 `dsh` 均指上一步判定的那种形式。首次使用某个 profile 时会自动初始化，并打底 `@deepseek-ai/dsh-base`。

### 2. 构建并打包（必须）

`lib/` 不在 git 中。必须先 build，再 pack。把未构建的 git 树或工作副本直接加进 profile，会得到没有 Host/Client 产物的包。

```sh
git clone https://github.com/shengsheng90/DSH-taskboard.git
cd DSH-taskboard
pnpm install
pnpm build
pnpm pack
```

预期产物：

- `lib/index.js`、`lib/cli.js`、`lib/client.js`（及对应声明文件）
- 仓库根目录的 `shengsheng-dsh-taskboard-<version>.tgz`

记下 tarball 的绝对路径，例如：

```text
/absolute/path/to/DSH-taskboard/shengsheng-dsh-taskboard-0.1.0.tgz
```

若仓库已经克隆且依赖已安装，执行 `pnpm build && pnpm pack` 即可。可选本地检查：`pnpm typecheck`、`pnpm test`、`pnpm example`。

### 3. 把插件加到 profile

profile 目录是 pnpm workspace 根（`packages: [.]`）。**必须**带 `-w`（workspace root）。不加时 pnpm 会报 `ERR_PNPM_ADDING_TO_ROOT`。

```sh
dsh plugin --profile web add -w /absolute/path/to/shengsheng-dsh-taskboard-0.1.0.tgz
```

优先安装打包后的 tarball，不要直接加源码目录。源码目录若未 build，会缺 `lib/`。

该命令可能改写 profile 的 `package.json`、lockfile 和 `node_modules`，这是预期行为。

同时满足以下全部条件才算安装成功：

1. `$DSH_HOME/profiles/web/package.json` 的 `dependencies` 出现 `@shengsheng/dsh-taskboard`。
2. 同一文件的 `dsh.profile.bundles` 在 `@deepseek-ai/dsh-base` **之后**列出 `@shengsheng/dsh-taskboard`。
3. `$DSH_HOME/profiles/web/node_modules/@shengsheng/dsh-taskboard/` 存在，且含 `lib/` 和 `cordis.patch.yml`。

若 CLI 警告 `declares no dsh.bundle`，说明包缺少 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。本仓库已经声明该项；应重新构建并重装，不要手改已安装副本。

### 4. 验证组成层（不启动服务）

```sh
dsh --profile web --dump-config
```

输出尾部出现 `# == @shengsheng/dsh-taskboard` 注释层，以及 `taskboard` 插件配置（`databasePath`、`attachmentRoot`、工作器上限等，见 [配置](#配置)）即通过。

`--dump-config` 会幂等重写 profile 根目录的 `cordis.yml`。若沙箱写 `~/.dsh` 报 `EPERM`，向操作者申请完整文件权限后重试。这次重写是正常流程，不是错误。

### 5. 模块解析冒烟测试

```sh
cd ~/.dsh/profiles/web && node --input-type=module -e \
  "import('@shengsheng/dsh-taskboard').then(m=>console.log('OK', m.name, typeof m.apply)).catch(e=>{console.error(e.message);process.exit(1)})"
```

通过：`OK taskboard function`。

失败多为找不到 peer（`@deepseek-ai/*` 或 `react`）。它们经 `~/.dsh/profiles/node_modules` 的安装回退链接解析，Harness 启动时会自动修复。先重做第 4 步，再重试本导入。

### 6. 判断当前进程是否已经加载插件

插件组成和 client-modules 扫描**只在启动时**执行。装进 profile 不会热加载 UI。

```sh
curl -s http://127.0.0.1:3080/ | grep -c '@shengsheng/dsh-taskboard'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/plugins/@shengsheng/dsh-taskboard/client.js
```

- manifest 计数 `> 0` **且** bundle HTTP `200` → 已激活，跳过重启，进入 [确认激活](#7-确认激活)。
- 否则必须重启 Harness。

### 7. 重启 Harness

重启会终止托管当前会话的进程。会话数据在 `$DSH_HOME/sessions`，不会丢失；正在执行的 Agent 回合会被中断。重启前先告知操作者。

若 Harness 来自源码 checkout，典型重启如下：

```sh
# 停掉当前监听
OLD_PID=$(lsof -tiTCP:3080 -sTCP:LISTEN | head -1)
if [ -n "$OLD_PID" ]; then kill -TERM "$OLD_PID"; fi

# 等端口释放后，在 checkout 根目录重新启动
cd /absolute/path/to/deepseek-harness
nohup pnpm dsh --profile web >> /tmp/dsh-harness-restart.log 2>&1 &
```

不要把第一次成功的 `GET /` 当成「插件已就绪」。Web 服务可能先于 boot manifest 注入而开始接受连接。应轮询直到包名出现：

```sh
for _ in $(seq 1 30); do
  if curl -s http://127.0.0.1:3080/ | grep -q '@shengsheng/dsh-taskboard'; then echo ready; break; fi
  sleep 2
done
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/plugins/@shengsheng/dsh-taskboard/client.js
```

一次真实安装用过的分离会话重启脚本见 [docs/install-plugin-prompt.zh.md](docs/install-plugin-prompt.zh.md) 第 6 步。若安装代理会随旧 Harness 进程组一起被杀掉，应使用该脚本。

### 8. 确认激活

以下全部通过才算完成：

| 检查 | 期望 |
|---|---|
| `GET /` 含 `@shengsheng/dsh-taskboard` | 计数 ≥ 1 |
| `GET /plugins/@shengsheng/dsh-taskboard/client.js` | HTTP 200 |
| Harness 启动日志 | 无插件 import / apply 错误 |
| 浏览器 | 刷新 `http://127.0.0.1:<port>`，侧栏底部出现任务板入口 |

默认数据文件（首次使用时由 Host 解析路径后创建）：

```text
.dsh/taskboard.sqlite
.dsh/taskboard-attachments
```

### 安装排错

| 现象 | 原因 | 对策 |
|---|---|---|
| `dsh: command not found` | CLI 未入 `PATH` | 在 Harness checkout 根目录用 `pnpm dsh ...` |
| `ERR_PNPM_ADDING_TO_ROOT` | profile 是 pnpm workspace 根 | 命令加 `-w` |
| git / 目录安装没有 `lib/` | `lib/` 被 gitignore | `pnpm build && pnpm pack`，再添加 `.tgz` |
| 写 `~/.dsh` 报 `EPERM` | 沙箱限制 | 向操作者申请完整权限；该写作为幂等重写 |
| manifest / `client.js` 仍 404 | 未重启，或验证过早 | 重启后按第 7 步轮询 |
| 导入 / apply 报错 | peer 缺失或未进入 bundles | 用 `--dump-config` 修复回退链接；确认 `dsh.profile.bundles` |
| `declares no dsh.bundle` | 包缺少 bundle patch | 重新构建本仓库，不要手改已安装树 |
| 重启后 GUI 打不开 | Harness 启动失败 | 看 `/tmp/dsh-harness-restart.log` 或进程日志；确认 checkout 路径和 `pnpm dsh` |

只安装信任来源的包。`pnpm` 会执行包生命周期脚本，随后 Harness 会加载该插件。

## 使用任务板

### 人工界面

1. 打开 Harness Web Client，点击侧栏底部的 **任务板**。
2. 新建项目：名称、短代号（用于 `DSH-1` 这类可读编号）、可选的 Harness Workspace id。Workspace 留空表示全局项目。
3. 新建任务。默认进入 `backlog`，也可以直接建成 `todo`。
4. 用 Markdown 写描述。可通过粘贴、拖放或选择文件添加附件。
5. **批准开工** 把 `backlog` 变为 `todo`。Agent 和自动化只能认领符合条件的 `todo`。
6. 按需使用 **看板**、**列表**、**甘特**、**工作流** 和概览。页面跟随 Harness 语言（中文或英文）。
7. Agent 提交评审后，打开任务，阅读结果评论和验证证据，然后 **验收完成**（`done`）或 **退回修改**。
8. 使用 **在新会话中打开** 前，先为项目映射 Workspace。该操作会打开原生空白 Session，并写入带有精确任务 id 与版本的未发送草稿。

仅限人工（UI 或 CLI，模型工具没有这些能力）：批准、验收、退回、归档、恢复、取消、重新打开、强制接管、永久删除。

### 任务生命周期

```text
人工创建 backlog
  -> 人工批准到 todo
  -> Agent 或自动化认领（依赖重检 + 排他认领 + Session）
  -> Agent 在绑定的 Workspace / 分支 / worktree 中工作
  -> Agent 验证后提交 in_review
  -> 人工验收 done，或退回到 todo / in_progress
```

所有调用方必须遵守：

- 除创建外，每次写入都要带上**当前精确 `version`**。
- 遇到 `TASK_STALE_VERSION` 必须重新读取再调和，不要用旧版本重试。
- 不要从 `DSH-42` 这类显示编号推导不透明 id，只用 API 返回的 id。
- Goal 完成不会验收任务。Agent 的成功终态是 `in_review`。
- 退回或恢复到 `todo` 会释放认领。直接回到 `in_progress` 必须原子建立新的明确认领。
- 孤儿认领保持可见，不能被静默抢走。

### Agent 工具

模型必须使用进程内工具。当工具存在时，不要在模型回合里再 shell 出 `dsh-taskboard`。

| 工具 | 用途 |
|---|---|
| `taskboard_list` | 按精确 `project_id` 做有界列表 |
| `taskboard_get` | 读取详情、版本、评论、关系、认领 |
| `taskboard_claim` | 用 `expected_version` 认领一条合格 `todo` |
| `taskboard_comment` | 追加 Markdown 评论 |
| `taskboard_submit_review` | 把持有的 `in_progress` 工作提交到 `in_review` |
| `taskboard_block` | 用具体原因阻塞 |
| `taskboard_release_claim` | 只释放当前 Agent 的认领 |
| `taskboard_relate` | 在同一项目内添加 `parent`、`blocks` 或 `related` |

没有验收工具，也没有通用改状态工具。按随包 Skill [`skills/manage-taskboard/SKILL.md`](skills/manage-taskboard/SKILL.md) 执行：

1. `taskboard_list` → 选一条合格 `todo`。
2. 写入前立刻 `taskboard_get`。
3. 用精确版本调用 `taskboard_claim`。
4. 只在任务声明的开发上下文中改代码。
5. 验证后用证据调用 `taskboard_submit_review`。不要改任务描述来记录结果。

### JSON CLI

CLI 输出带 schema 版本的 JSON。供人工脚本和互操作使用，不是模型的主 API。

```sh
dsh-taskboard --database .dsh/taskboard.sqlite project list
dsh-taskboard --database .dsh/taskboard.sqlite project create --key DSH --name "我的项目"
dsh-taskboard --database .dsh/taskboard.sqlite task create --project <project-id> --title "发布插件"
dsh-taskboard --database .dsh/taskboard.sqlite task get --task DSH-1
dsh-taskboard --database .dsh/taskboard.sqlite task approve --task <opaque-id> --version 1
dsh-taskboard --database .dsh/taskboard.sqlite task accept --task <opaque-id> --version 7
```

结构化写入可走 JSON：

```sh
dsh-taskboard task create --request-json '{"projectId":"project-...","title":"发布","creator":"human:cli","priority":"high"}'
dsh-taskboard task update --task task-... --version 3 --request-json '{"labels":["release"]}'
dsh-taskboard task return --task task-... --version 4 --comment "修复失败的测试"
```

命令组：`project`、`task`、`relation`、`attachment`、`workflow`、`automation`、`storage`。完整列表见 [docs/cli.md](docs/cli.md)。

退出码：`0` 成功，`2` 用法错误，`3` 存储/服务不可用，`4` 领域/API 拒绝，`5` 乐观冲突（`TASK_STALE_VERSION`）。

若 `PATH` 里没有该命令，直接跑已安装文件：

```sh
node ~/.dsh/profiles/web/node_modules/@shengsheng/dsh-taskboard/lib/cli.js --database .dsh/taskboard.sqlite storage status
```

### 自动化

在任务板页面为项目新建自动化：间隔、Agent 预设、模型路由、工作器数量和配额策略。启用后，Host 调度器会认领合格 `todo`，驱动根 Agent Session 与 Goal，并停在 `in_review`。配额不确定时会暂停新认领，但不取消已在跑的工作。

## 配置

`cordis.patch.yml` 挂载一个 Host 插件，id 为 `taskboard`。可在 profile 组成层或环境变量中覆盖。路径由 Host 解析，浏览器不能选择数据库或附件根目录。

| 键 | 默认值 | 说明 |
|---|---|---|
| `databasePath` | `.dsh/taskboard.sqlite` | `DSH_TASKBOARD_DATABASE` |
| `attachmentRoot` | `.dsh/taskboard-attachments` | `DSH_TASKBOARD_ATTACHMENTS` |
| `pageSize` | `100` | `taskboard_list` 单页大小，结果会带上匹配总数 |
| `snapshotTaskLimit` | `1000` | 单次网页快照的任务数上限，被截断时页面会给出提示 |
| `maxAttachmentBytes` | `26214400` | 单文件 25 MiB |
| `maxTaskAttachmentBytes` | `104857600` | 单任务 100 MiB |
| `minAutomationIntervalMs` | `30000` | 自动化间隔下限 |
| `maxProjectWorkers` | `2` | 每项目并发认领 |
| `maxGlobalWorkers` | `4` | 全局并发认领 |
| `allowSharedWorktrees` | `false` | 开发上下文排他 |
| `clientRefreshIntervalMs` | `15000` | snapshot 恢复间隔 |
| `maxChangeWaiters` | `128` | 长轮询等待上限 |
| `maxChangeWatchMs` | `30000` | 长轮询超时 |
| `defaultAgentPreset` | `standard` | 工作器预设 |

附件类型和大小在发布前校验。Dashboard 与 `storage status` 使用同一组有界 SQLite 完整性、revision、数量、附件清理队列和孤儿认领诊断。

页面打开期间，插件通过现有 Typert 连接等待下一次已提交的全局 revision。超时轮询和周期 snapshot 是恢复路径。这不要求修改 Harness 的 Host 事件白名单。

备份时同时带上 SQLite（若在线还含 WAL）和附件目录。要做一致的离线备份，先停 Harness。

## 开发本仓库

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm example
```

`pnpm build` 会编译 Host 声明与运行时、复制已入库的官方 Typert 生成物，并产出浏览器 bundle。生成的 Remote 文件留在 `generated/`，因此树外构建不依赖旁边的 Harness checkout。

`pnpm check` 会连续跑 typecheck、测试和构建。

## 更多文档

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](docs/architecture.md) | 模块归属与刷新模型 |
| [docs/security.md](docs/security.md) | 权威划分、附件与恢复 |
| [docs/cli.md](docs/cli.md) | JSON CLI 命令组与退出码 |
| [docs/acceptance-audit.md](docs/acceptance-audit.md) | 逐项验收证据 |
| [docs/browser-e2e.md](docs/browser-e2e.md) | 确定性浏览器生命周期 |
| [docs/install-plugin-prompt.zh.md](docs/install-plugin-prompt.zh.md) | 给 Harness 代理的中文一键安装提示词 |
| [skills/manage-taskboard/SKILL.md](skills/manage-taskboard/SKILL.md) | Agent 操作规程 |

## 许可证

Apache-2.0。见 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。
