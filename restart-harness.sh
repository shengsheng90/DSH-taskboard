#!/bin/bash
# 一键重启 dsh web harness 并验证新插件激活（由安装提示词生成或手动使用）。
# 用法: restart-harness.sh [PORT] [CHECKOUT] [PROFILE] [PLUGIN]
#   PORT      监听端口，默认 3080
#   CHECKOUT  可选。DSH 源码 checkout 根目录；省略时按下面顺序自适应：
#             1. 环境变量 DSH_CHECKOUT
#             2. 当前端口监听进程的 cwd（若像 Harness 源码树）
#             3. PATH 上的 dsh
#   PROFILE   目标 profile，默认 web
#   PLUGIN    插件 npm 包名（用于 manifest 验证），默认 @shengsheng/dsh-taskboard
# 必须用分离会话运行（否则会随代理进程组被杀）:
#   python3 -c "import subprocess; subprocess.Popen(['bash','restart-harness.sh'], start_new_session=True, stdout=open('/tmp/dsh-restart-launch.out','w'), stderr=subprocess.STDOUT)"

PORT="${1:-3080}"
CHECKOUT="${2:-${DSH_CHECKOUT:-}}"
PROFILE="${3:-web}"
PLUGIN="${4:-@shengsheng/dsh-taskboard}"
STATUS=/tmp/dsh-harness-restart-status.txt
LOG=/tmp/dsh-harness-restart.log
DSH_CMD=""

is_harness_checkout() {
  local dir="$1"
  [ -n "$dir" ] && [ -f "$dir/pnpm-workspace.yaml" ] && [ -f "$dir/package.json" ] && grep -q '"dsh"' "$dir/package.json"
}

listener_cwd() {
  local pid="$1"
  local cwd=""
  cwd=$(lsof -p "$pid" -a -d cwd -Fn 2>/dev/null | awk '/^n/ { print substr($0, 2); exit }')
  if [ -z "$cwd" ] && [ -e "/proc/$pid/cwd" ]; then
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
  fi
  printf '%s' "$cwd"
}

resolve_launch() {
  if [ -n "$CHECKOUT" ]; then
    DSH_CMD="pnpm dsh"
    echo "launch: pnpm dsh from explicit checkout $CHECKOUT"
    return 0
  fi

  if [ -n "${OLD_PID:-}" ]; then
    local cwd
    cwd=$(listener_cwd "$OLD_PID")
    if is_harness_checkout "$cwd"; then
      CHECKOUT="$cwd"
      DSH_CMD="pnpm dsh"
      echo "launch: pnpm dsh from listener cwd $CHECKOUT"
      return 0
    fi
    echo "listener cwd is not a Harness checkout: ${cwd:-unknown}"
  fi

  if command -v dsh >/dev/null 2>&1; then
    DSH_CMD="dsh"
    echo "launch: dsh on PATH ($(command -v dsh))"
    return 0
  fi

  echo "FATAL: cannot find DeepSeek Harness."
  echo "Pass CHECKOUT as the second argument, set DSH_CHECKOUT, keep a listener on :$PORT whose cwd is a Harness checkout, or put dsh on PATH."
  return 1
}

exec > "$STATUS" 2>&1
echo "=== dsh harness restart @ $(date '+%F %T') (profile=$PROFILE port=$PORT) ==="

# 给调用方（代理）几秒时间发完最终消息再杀进程。
sleep 8

OLD_PID=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
echo "old :$PORT listener: ${OLD_PID:-none}"

resolve_launch || exit 1

if [ -n "$OLD_PID" ]; then
  kill -TERM "$OLD_PID" 2>/dev/null
  for _ in $(seq 1 40); do
    if ! lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  STILL=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
  if [ -n "$STILL" ]; then
    echo "port still held by $STILL after TERM; sending KILL"
    kill -9 "$STILL" 2>/dev/null
    sleep 2
  fi
fi

if [ "$DSH_CMD" = "pnpm dsh" ]; then
  cd "$CHECKOUT" || { echo "FATAL: cannot cd $CHECKOUT"; exit 1; }
  nohup pnpm dsh --profile "$PROFILE" >> "$LOG" 2>&1 &
else
  nohup dsh --profile "$PROFILE" >> "$LOG" 2>&1 &
fi
NEW_PID=$!
echo "launched new harness pid $NEW_PID (log: $LOG)"

UP=0
for _ in $(seq 1 150); do
  if curl -sf "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then UP=1; break; fi
  if ! kill -0 "$NEW_PID" 2>/dev/null; then echo "FATAL: new harness process exited early"; break; fi
  sleep 1
done
echo "index up: $([ "$UP" = 1 ] && echo yes || echo no)"

# 轮询直到 boot manifest 出现插件（webserver 可能先于 manifest 注入就绪，
# 第一次立即检查会误报未激活——真实踩坑）。
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
