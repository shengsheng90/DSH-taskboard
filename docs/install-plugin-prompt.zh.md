# DSH 插件一键安装提示词

> 把本文档**全文**复制，作为一条消息发给 DeepSeek Harness 中的任意代理（新会话或当前会话均可），代理会自动完成：**探测环境 → 安装 → 组成验证 → 模块冒烟 → 重启激活 → 验证报告**。
>
> 规范安装说明（中英双语、可被其他模型直接执行）见仓库 [README.md](../README.md) 与 [README.zh.md](../README.zh.md)。本提示词沉淀自一次真实的完整安装过程（`@shengsheng/dsh-taskboard` 安装到 `web` profile），包含过程中踩到的全部坑与对策。

---

## 一、需要替换的参数

| 占位符 | 含义 | 示例 |
|---|---|---|
| `{{PLUGIN_SOURCE}}` | 插件包路径（tarball 或源码目录） | `/path/to/my-plugin-0.1.0.tgz` |
| `{{PKG_NAME}}` | 插件的 npm 包名 | `@shengsheng/dsh-taskboard` |
| `{{PROFILE}}` | 目标 profile 名 | `web` |
| `{{PORT}}` | harness Web 监听端口 | `3080` |

其余环境信息（dsh CLI 位置、harness 启动方式）由代理自动探测。

---

## 二、执行步骤

### 第 1 步：探测环境

1. 找到运行中的 harness：`lsof -iTCP:{{PORT}} -sTCP:LISTEN`，记下 PID；再用 `lsof -p <PID> -a -d cwd` 查看其工作目录。
2. 判定 dsh 调用方式：
   - 若 harness 的 cwd 是 DSH 源码 checkout（根目录含 `pnpm-workspace.yaml`，package.json 有 `"dsh"` script）→ 后续命令在 checkout 根目录用 `pnpm dsh ...`；
   - 若 `which dsh` 有结果 → 直接 `dsh ...`。
3. 确认插件源存在：`ls -la {{PLUGIN_SOURCE}}`。
   - 若是**源码目录**且还没有打包产物：在插件目录执行 `pnpm build && pnpm pack` 生成 tgz（安装预构建产物，避免 git 安装缺 `lib/` 的坑）；已有 tgz 直接用。

### 第 2 步：安装到 profile

> 以下 `dsh` 均指第 1 步判定的调用方式：源码 checkout 时在 checkout 根目录改用 `pnpm dsh plugin --profile {{PROFILE}} add ...`。

```sh
dsh plugin --profile {{PROFILE}} add -w {{PLUGIN_SOURCE}}
```

> `-w`（workspace root）必需：profile 目录是 pnpm workspace 根（`packages: [.]`），不加 `-w` 时 pnpm 会报 `ERR_PNPM_ADDING_TO_ROOT`。

成功标志（全部满足）：
- `~/.dsh/profiles/{{PROFILE}}/package.json` 的 `dependencies` 出现 `{{PKG_NAME}}`；
- 同一文件的 `dsh.profile.bundles` 追加了 `{{PKG_NAME}}`（排在 `@deepseek-ai/dsh-base` 之后）；
- `~/.dsh/profiles/{{PROFILE}}/node_modules/{{PKG_NAME}}/` 存在且含 `lib/`。

注意：
- 首次使用该 profile 时会自动初始化（含 `@deepseek-ai/dsh-base` 打底）。
- 若输出 `declares no dsh.bundle` 警告 → 插件包缺 `dsh.bundle` 声明，只装了依赖、没装配置层；需在插件 package.json 补 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 后重装。

### 第 3 步：验证组成层（不启动服务）

```sh
dsh --profile {{PROFILE}} --dump-config
```

- 输出尾部应有 `# == {{PKG_NAME}}` 注释层及插件行（含完整 config）即通过。
- ⚠️ 该命令会**幂等重写** profile 根 `cordis.yml`（内容不变）。若沙箱报 `EPERM: operation not permitted`（写 `~/.dsh` 被拦截）：向用户说明后，申请一次性完整文件权限再执行——这是正常流程，不是错误。

### 第 4 步：模块解析冒烟测试

```sh
cd ~/.dsh/profiles/{{PROFILE}} && node --input-type=module -e \
  "import('{{PKG_NAME}}').then(m=>console.log('OK', m.name, typeof m.apply)).catch(e=>{console.error(e.message);process.exit(1)})"
```

- 输出 `OK <name> function` 即通过（`apply` 是 Cordis 插件入口）。
- 失败多为 peer 依赖（`@deepseek-ai/*`、`react` 等）解析不到：它们经 `~/.dsh/profiles/node_modules` 的**安装回退链接**解析（每次 boot 由 `healProfilesModuleFallback` 自动维护）。若缺失，先跑一次第 3 步的 `--dump-config` 即可重建，再重试本步。

### 第 5 步：判断当前 harness 是否已激活

```sh
curl -s http://127.0.0.1:{{PORT}}/ | grep -c "{{PKG_NAME}}"          # boot manifest 中出现的次数
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:{{PORT}}/plugins/{{PKG_NAME}}/client.js  # 期望 200
```

- manifest 计数 > 0 且 bundle 为 200 → 已激活，跳到第 7 步。
- 否则 → 插件集在**启动时固定**（loader 组成 + client-modules 扫描均只在 boot 时执行），必须重启，进入第 6 步。

### 第 6 步：重启 harness（会短暂中断当前会话！）

> 重启会终止托管当前会话的进程；会话已持久化在 `$DSH_HOME/sessions`，重启后刷新 GUI 即可恢复，数据不丢失。向用户说明后再执行。

- 把下面的脚本原样保存为 `/tmp/restart-harness.sh`（或复用插件仓库中的 `restart-harness.sh`）：

```bash
#!/bin/bash
# 一键重启 dsh harness 并验证新插件激活（由安装提示词生成）
# 用法: restart-harness.sh [PORT] [CHECKOUT] [PROFILE] [PLUGIN]
PORT="${1:-{{PORT}}}"
CHECKOUT="${2:-/path/to/deepseek-harness-checkout}"
PROFILE="${3:-{{PROFILE}}}"
PLUGIN="${4:-{{PKG_NAME}}}"
STATUS=/tmp/dsh-harness-restart-status.txt
LOG=/tmp/dsh-harness-restart.log
exec > "$STATUS" 2>&1
echo "=== dsh harness restart @ $(date '+%F %T') (profile=$PROFILE port=$PORT) ==="
sleep 8   # 给代理发完最终消息的时间
OLD_PID=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
echo "old :$PORT listener: ${OLD_PID:-none}"
if [ -n "$OLD_PID" ]; then
  kill -TERM "$OLD_PID" 2>/dev/null
  for _ in $(seq 1 40); do
    if ! lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  STILL=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
  if [ -n "$STILL" ]; then echo "port still held; KILL"; kill -9 "$STILL" 2>/dev/null; sleep 2; fi
fi
cd "$CHECKOUT" || { echo "FATAL: cannot cd $CHECKOUT"; exit 1; }
nohup pnpm dsh --profile "$PROFILE" >> "$LOG" 2>&1 &
NEW_PID=$!
echo "launched new harness pid $NEW_PID (log: $LOG)"
UP=0
for _ in $(seq 1 150); do
  if curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then UP=1; break; fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then echo "FATAL: harness exited early"; break; fi
  sleep 1
done
echo "index up: $([ "$UP" = 1 ] && echo yes || echo no)"
# 轮询直到 boot manifest 出现插件：webserver 可能先于 manifest 注入就绪，
# 立即检查会误报未激活（真实踩坑）。
FOUND=0
for _ in $(seq 1 30); do
  if curl -s "http://127.0.0.1:$PORT/" | grep -q "$PLUGIN"; then FOUND=1; break; fi
  sleep 2
done
echo "manifest contains $PLUGIN: $([ "$FOUND" = 1 ] && echo yes || echo no)"
echo "bundle http: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/plugins/$PLUGIN/client.js")"
echo "--- new boot log tail ---"
tail -20 "$LOG"
echo "=== done @ $(date '+%F %T') ==="
```

- 用**分离会话**启动（保证脚本不随代理进程组被杀，kill 与重启一气呵成）：

```sh
chmod +x /tmp/restart-harness.sh && python3 -c "
import subprocess
subprocess.Popen(['bash','/tmp/restart-harness.sh'], start_new_session=True,
                 stdout=open('/tmp/dsh-restart-launch.out','w'), stderr=subprocess.STDOUT)
print('detached restart script launched')
"
```

- 若沙箱拦截（脚本要写 `~/.dsh`、监听端口）：向用户说明后申请一次性完整权限执行。
- 命令返回后代理应立即发出最终报告消息，随后本会话中断属预期行为；结果以 `/tmp/dsh-harness-restart-status.txt` 为准。

### 第 7 步：最终验证与报告

重启完成后复查（脚本已自动验证，代理应复核一遍）：

```sh
curl -s http://127.0.0.1:{{PORT}}/ | grep -c "{{PKG_NAME}}"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:{{PORT}}/plugins/{{PKG_NAME}}/client.js
grep -iE 'failed|error' /tmp/dsh-harness-restart.log
```

向用户报告：
1. 安装位置与 `dsh.profile.bundles` 顺序；
2. `--dump-config` 的插件层名与冒烟测试结果；
3. 重启状态文件路径（`/tmp/dsh-harness-restart-status.txt`）与三项验证结果（manifest / bundle / 日志）；
4. 用户侧确认方式：刷新 `http://127.0.0.1:{{PORT}}`，插件提供的 UI（侧栏/面板/设置项）应已出现。

---

## 三、常见问题速查

| 现象 | 原因 | 对策 |
|---|---|---|
| `dsh: command not found` | CLI 未入 PATH | 在源码 checkout 根目录用 `pnpm dsh ...` |
| `EPERM: operation not permitted`（写 `~/.dsh/...`） | 文件沙箱限制 | 一次性申请完整权限（该写为幂等重写，安全） |
| 安装后 manifest / bundle 仍 404 | 未重启，或验证过早 | 执行第 6 步；重启后**轮询**验证（manifest 注入晚于 webserver 就绪） |
| 插件行加载失败 / 模块导入报错 | peer 依赖缺失 | 检查 `~/.dsh/profiles/node_modules` 回退链接；确认插件在 `bundles` 列表 |
| 警告 `declares no dsh.bundle` | 包缺 bundle 声明 | 插件 package.json 补 `dsh.bundle.patch` 后重装 |
| `pnpm add` 失败 | 网络 / pnpm 版本 | 检查 pnpm 版本与 registry 配置 |
| `ERR_PNPM_ADDING_TO_ROOT` | profile 是 pnpm workspace 根，`add` 未带 `-w` | 命令加 `-w`：`dsh plugin --profile {{PROFILE}} add -w <源>` |
| 重启后 GUI 打不开 | 启动失败 | 看 `/tmp/dsh-harness-restart.log`；确认 CHECKOUT 路径与 `pnpm dsh` 可用 |

---

## 四、安全须知

- 安装会执行插件包代码（pnpm 安装阶段）并加载其插件——**只安装信任来源的包**。
- 重启会中断正在运行的会话（数据已持久化，不丢失），但正在执行的代理任务会中止。
- 若代理在沙箱环境中运行，涉及 `~/.dsh` 的写操作和端口监听需要用户批准，属正常流程。
