# Native Taskboard 插件：阻塞项与续接任务交接

更新日期：2026-08-14  
插件工作区：`/Users/shengxy/Data/work/persional/DSH-taskboard`  
Harness 源码仓库：`/Users/shengxy/Data/work/persional/deepseek-harness`

## 1. 原始目标与完成标准

原始目标是按照以下双语提案完整开发 Native Taskboard 插件，而不是只交付一个可用子集：

- `2026-08-14-native-taskboard-plugin.md`
- `2026-08-14-native-taskboard-plugin.zh.md`

提案明确规定：本地功能验收矩阵的 13 行必须全部有直接、当前状态证据；存在缺失、间接证据或仅由 mock 证明的要求时，项目仍属于未完成。

## 2. 当前可交付状态

插件主体已经实现并通过本地检查，主要包括：

- SQLite 唯一任务权威、迁移、乐观版本、任务关系、评论、活动、附件及清理队列。
- 项目、七种任务状态、重复规则、归档/恢复/删除和 human-only 验收策略。
- Harness Agent、Session、Goal、Workspace、分支/worktree、自动化认领和孤儿 Session 恢复。
- 模型工具、版本化 JSON CLI、`manage-taskboard` Skill。
- 原生 React Taskboard 页面、Dashboard、Board、List、Gantt、工作流编辑器、中英文主要产品文案。
- 显式“在新会话中打开”：通过 Harness 公共 Workspace/Session/conversation 服务进入原生空白 Session，并写入未发送的精确任务草稿。
- 确定性生产 bundle 浏览器流程：批准 → 首次评审 → 人工退回 → 第二次评审 → 人工验收 → `done`。
- Cordis 卸载关闭 SQLite、重连订阅清理、revision gap/reset 分类及 Session task/claim/revision trace。

最近一次完整检查：

```text
pnpm check
53 tests passed, 0 failed
TypeScript typecheck passed
production build passed
```

无模型示例也已通过：

```text
pnpm example
```

当前候选包：

```text
/Users/shengxy/Data/work/persional/DSH-taskboard/shengsheng-dsh-taskboard-0.1.0.tgz
```

SHA-256 必须在最后一次文档更新和重新打包后从实际 tarball 计算，并随交付结果记录；不要把打包前的自引用 hash 固化进包内文档。

重要证据：

- `docs/acceptance-audit.md`：13 行验收矩阵的诚实状态。
- `docs/browser-e2e.md`：确定性完整浏览器生命周期及真实模型 gate。
- `docs/implementation-plan.md`：架构与交付台账。
- `docs/assets/taskboard-real-harness.jpg`：较早版本的真实 Host、无密钥 smoke；它早于最终 Session 按钮改动，不能证明当前候选包的最终行为。
- `examples/taskboard/browser-fixture.html`：加载生产 `lib/client.js` 的状态化浏览器 fixture。

## 3. 为什么目标被标记为 blocked

### 3.1 实时刷新必须保持为纯插件实现

提案要求 authoritative transaction 提交后及时通知 Client，并由 global revision、gap/reset 和重连 snapshot 保证收敛。Harness 的 Host 事件白名单没有外置插件注册扩展点，但本项目的边界是不修改 DeepSeek Harness 源码。

采用的插件内方案是通过已有 Typert Remote 执行有界 `changes.watch` 长轮询：每个打开页面最多保持一个等待，Provider 仅在事务提交后唤醒；超时、revision gap/reset、重连和周期 snapshot 走同一有界恢复路径。卸载会先结清等待再关闭 SQLite。该方案不注册或冒用 Harness 内置事件，也不要求修改 Harness 源码。

### 3.2 真实模型浏览器 E2E 尚未运行

提案明确要求至少一次使用实际配置的 Harness 模型完成：

1. 原生页面创建任务。
2. 批准或启用自动化。
3. 证明正确 Workspace 与 branch/worktree cwd。
4. 观察真实 Agent、Goal、todo 和权限行为。
5. Agent 提交 verification comment 并进入 `in_review`。
6. 人工退回一次。
7. 原 Session 或规定恢复路径继续工作并再次进入 `in_review`。
8. 人工明确验收为 `done`。

确定性 fixture 和无密钥 Host smoke 均不能替代这一 gate。安装最新版候选包会通过 `dsh plugin --profile web ...` 转发给 pnpm，并可能重建 profile 的 `node_modules`；此前自动权限审查拒绝了这一广泛副作用。真实模型运行还可能产生 API 费用，因此需要明确授权。

## 4. 重新开启任务前需要给出的授权

请在新对话中明确写出以下授权，避免执行到一半再次停住：

1. DeepSeek Harness 源码、测试、文档和配置保持只读，不授权任何修改。
2. 允许执行候选包的 `dsh plugin --profile web add <absolute-tarball>` / `install`，并知晓该操作可能重建对应 profile 的 `node_modules` 和更新 profile lockfile。
3. 允许使用 Harness 已配置的模型凭据执行一次真实模型 E2E，并接受该次测试产生的合理 API 费用；不得显示、复制或记录凭据值。
4. 若需要启动本地 Host、浏览器或 loopback server，允许相应的本地进程和端口操作。

如果只授权其中一部分，新的任务必须继续把未授权项标为未完成，不能把目标缩减后宣布完成。

## 5. Harness 仓库当前状态：必须保留

最近只读检查显示：

```text
branch: master
modified: pnpm-lock.yaml
untracked: .agents/notes/proposed/feature/2026-08-14-native-taskboard-plugin.i18n.yaml
```

这些改动不能假定属于新任务，也不能用 `git reset --hard`、`git checkout --` 或删除操作清理。Harness 源码树只读；候选包安装只允许影响 Harness profile 目录，不得触碰该源码仓库的 `pnpm-lock.yaml` 或 sidecar。

插件仓库本身也处于大量未跟踪文件状态，这是当前实现的真实状态。不要因为它们未提交就重新生成、覆盖或删除。

## 6. 剩余实施工作

### A. 完成插件内 revision 长轮询

- `TaskboardService` 通过现有 Typert Remote 提供有界 `changes.watch(afterRevision, timeoutMs)`。
- `SqliteTaskboardProvider.subscribe` 只在 post-commit 后唤醒等待；rollback/stale write 不唤醒。
- Client 收到不同 revision 后刷新有界 snapshot；gap、reset、reconnect 和周期刷新仍以 SQLite revision 为基线。
- 页面关闭、连接代际变化和插件 unload 不留下永久等待；Client 事件投影不成为第二任务权威。
- 不修改 `/Users/shengxy/Data/work/persional/deepseek-harness` 中任何文件。

### B. 补齐实时刷新集成证据

至少新增：

- post-commit revision 立即结清等待。
- rollback/stale write 只允许等待超时，不产生伪 revision。
- 连续 revision、revision gap、Host reset、timeout 和 reconnect 行为。
- 插件 unload 在 SQLite 关闭前结清等待。
- 多 Client 等待隔离，单个 Client 取消或失败不影响提交。

### C. 重新安装精确候选包并跑真实模型 E2E

执行前先重新构建和打包，记录新的 SHA-256；不要继续使用本文件中的旧 hash 作为最终候选证明。安装必须使用绝对 tarball 路径，随后确认：

- profile 解析到的确实是该 tarball 版本；
- `cordis.patch.yml` 已进入 bundle layer；
- Host 和 Client half 均为新 build；
- Taskboard 页面显示且 generated Typert Remote 可调用；
- 没有引用旧 checkout 或旧 profile cache。

真实模型 E2E 记录中至少保存以下非敏感信息：

- candidate tarball SHA-256；
- model route 名称，不记录密钥；
- project/task opaque id 与 readable identifier；
- Workspace id、预期 cwd 类型及实际验证结果；
- Session id、claim id、claimed revision；
- 首次和第二次 verification evidence；
- 人工 return comment；
- 最终 human acceptance activity 与 final task revision；
- 浏览器截图或优化 GIF。

### D. 重新录制当前 GUI 证据

现有真实 Host 截图和 `docs/assets/taskboard-demo.gif` 早于最终 Session 按钮及完整退回流程，不能作为最终当前状态证据。完成真实 Host E2E 后：

- 录制优化后的浏览器 GIF，覆盖新建/打开 Session、实时 Agent/todo、评审、退回和人工验收关键路径。
- 更新必要截图，至少包含 Workspace/development context、Session trace 和最终 `done` activity。
- 不得在图片/GIF 中泄露凭据、私有路径、私人会话或无关任务。

### E. 固化“首次 Session 导入”语义

提案交付阶段 6 使用“首次 Session 导入”作为施工简称；同一提案第 77 行给出的规范行为是：仅在用户明确请求新会话时创建或导航原生 Harness Session，并插入未发送任务指令，任务读取或变更确认关联后才开始归属记录。

当前 `renderTaskSessionDraft` / `openNewSession` 实现就是该显式 Session handoff；它不是 Taskboard 数据库导入。`docs/acceptance-audit.md` 记录该直接映射，最终真实 Host E2E 仍需证明 Workspace、草稿 task id/revision、导航和后续关联。

### F. 最终全矩阵审计与交付

- 逐行重新核对 `docs/acceptance-audit.md` 的 13 行。
- `PARTIAL` 和 `OPERATOR` 全部必须由当前候选包的直接证据关闭，才能宣布完成。
- 运行完整 checks、headless example、真实 Host smoke、真实模型浏览器 E2E、package contents audit。
- 重新生成 tarball、记录最终 SHA-256，并更新文档里的测试数量和证据日期。
- 未经用户明确要求，不 commit、不 push、不创建 PR。

## 7. 建议验证命令

插件要求 Node `^22.19.0 || >=24.0.0`，因为使用 `node:sqlite`。不要用当前默认 Node 20 解释测试结果。

在插件工作区执行：

```bash
pnpm check
pnpm example
pnpm pack
shasum -a 256 shengsheng-dsh-taskboard-0.1.0.tgz
```

DeepSeek Harness 源码树保持只读；只执行候选包安装和运行时验证，不执行会修改 Harness 源码、测试、文档或配置的生成、格式化或修复命令。

安装命令应按当前 Harness CLI 文档确认。已知语义是：

```bash
dsh plugin --profile web add /absolute/path/to/shengsheng-dsh-taskboard-0.1.0.tgz
```

它会把后续参数转发给 profile 目录中的 pnpm，可能修改 profile 依赖与 lockfile。

## 8. 完成判定

只有同时满足以下条件才可把目标标记为 complete：

- 插件内有界 revision 长轮询、post-commit/rollback、timeout、gap/reconnect 和 unload 行为有直接集成证据，且不修改 Harness 源码。
- 当前精确 tarball 已在真实 Harness profile 安装并完成 keyless smoke。
- 同一候选包已完成真实配置模型的完整浏览器 E2E，包括一次人工退回和最终人工验收。
- 当前 GUI GIF/截图与最终行为一致。
- 显式新 Session handoff 与提案“首次 Session 导入”施工简称的映射已有直接结论和真实 Host 证据。
- 13 行验收矩阵全部有当前直接证据，无 `PARTIAL`、`OPERATOR` 或未核实项。
- 最终 checks、example、pack contents 和 SHA-256 均重新记录。

## 9. 可直接粘贴到新对话的续接提示词

```text
请恢复 Native Taskboard 插件的完整开发目标。先完整阅读：

1. /Users/shengxy/Data/work/persional/DSH-taskboard/2026-08-14-native-taskboard-plugin.md
2. /Users/shengxy/Data/work/persional/DSH-taskboard/2026-08-14-native-taskboard-plugin.zh.md
3. /Users/shengxy/Data/work/persional/DSH-taskboard/docs/blocked-goal-handoff.zh.md
4. /Users/shengxy/Data/work/persional/DSH-taskboard/docs/acceptance-audit.md

继续原始完整目标，不要把当前可用子集重新定义为完成。DeepSeek Harness 源码、测试、文档和配置必须保持只读，不允许修改。当前明确授权你：

- 通过 dsh plugin --profile web 安装精确候选 tarball，即使该操作会重建 profile node_modules 或更新 profile lockfile；
- 使用 Harness 已配置的模型凭据执行一次真实浏览器 E2E，并接受合理 API 费用，但不得读取、输出或记录凭据值；
- 启动验证所需的本地 Host、浏览器和 loopback server。

开始前检查两个仓库的 AGENTS.md、git status 和现有 diff，保留所有用户改动。Harness 当前已知 master 上 pnpm-lock.yaml 被修改，并有未跟踪的 Taskboard i18n sidecar，禁止 reset、checkout 或删除它们。

按交接文档第 6 节依次完成：插件内 revision 长轮询及 gap/reconnect/unload 测试、精确 tarball 重装、真实模型完整浏览器 E2E、当前 GUI GIF/截图、显式 Session handoff 证据、13 行最终验收。只在所有直接证据齐全时标记目标 complete。
```
