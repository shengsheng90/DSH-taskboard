# 插件分发与 Harness 兼容策略

## Issue #26 的核实

报告的安装命令是 Git 来源，另尝试过 npm；宿主为 `0.1.7-rc.1`。报告没有附上完整 pnpm 日志，自动分类写的「prepare/build failed」不足以证明具体失败步骤。

在隔离临时 profile 中，使用真实 `@deepseek-ai/dsh@0.1.7-rc.1` 和 npm 已发布的插件 `0.1.6`，复测 `dsh plugin --profile web add -w <旧包.tgz>`。pnpm 安装后，Harness 输出 `installation rejected`：插件的 19 个 `@deepseek-ai/dsh-*` peer 都精确要求 `0.1.6-alpha.1`，宿主版本不匹配；随后恢复 package.json、lockfile 和 node_modules。这可复现 npm 渠道的版本兼容拒绝。旧 npm 包包含 `lib/`，且没有 prepare/install 脚本，因此不能把该渠道失败归因于构建脚本。

Git 渠道另有独立缺陷：旧仓库忽略 `lib/`，没有消费者构建脚本，Git 获取不到 package.json 的 main、bin、client、Typert exports 指向的产物。即使越过版本检查，也不能作为完整的可加载插件交付。

## 本次方案

1. **安装只消耗已构建产物。** 在源码仓库提交 `lib/`，npm 与 Git 使用同一份产物；不添加 prepare、prepack、install 等生命周期脚本。JS sourcemap 留作本地调试，不入库；声明文件和声明映射随包交付。
2. **开发依赖和运行时契约分开。** 开发 SDK 固定在 `0.1.6-alpha.1` 并由 lockfile 锁定。运行时 peer 为 `^0.1.6-alpha.1 || ^0.1.7-0`，允许 `0.1` 系列中兼容的小更新及 `0.1.7` 预发布版，排除 `0.2`。第二段显式接纳 rc/alpha，避免普通 SemVer 范围默认排除后续版本的预发布标签。
3. **依赖由宿主提供。** peer 标记 optional，表示包管理器不要自动下载另一套 Harness/React；不表示这些运行时 API 可以缺失。插件仍依赖完整的 Harness web profile。Harness 会依据 peer 的版本声明执行自己的兼容检查，optional 不绕过该检查。普通 pnpm 安装也不会自动装入 SDK 或重复的 Cordis。
4. **沿用协议兼容桥。** Typert codec 同时提供 `schema` 和 `create()`，两者共享惰性缓存。安装不重新生成 Typert 文件，也不修改上游 Harness。
5. **发布前拦截不完整或过期产物。** `lib/build-manifest.json` 记录输入与输出的 SHA-256，忽略 Git 对文本换行的规范化。`pnpm verify:package` 检查公开入口、bundle patch、Skill、产物指纹和源码指纹。CI 在重建前检查已提交产物，重建后检查 `git diff --exit-code -- lib`；删除源码时先清空 lib，避免残留旧可执行文件。

选择提交构建产物是为了修复插件市场现有的 Git 来源。仅新增 prepare 脚本仍受脚本批准、消费者工具链、SDK 解析和编译 API 漂移影响；仅发布 release tarball 则不能修复市场继续安装源码 Git URL 的路径。将来若市场支持固定版本的预构建 tarball，优先使用 npm/release，源码仓库可以改为独立的分发分支。

## 维护和发布

源码修改后：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm verify:package
pnpm test:package
pnpm pack:release
git add src generated scripts package.json pnpm-lock.yaml lib
```

提交源码和对应的 `lib/`，审核 CI 后再发布新版本。`pnpm pack:release` 会校验源码和产物；原始 `pnpm pack` 无生命周期钩子，维护者不应以此绕过发布校验。已发布的 npm `0.1.6`、旧 Git ref 和旧 release tarball 不会因这次修复自动改变；需要发布并安装新版本。

## 验证与边界

`pnpm test:package` 在临时目录安装实际 tarball，启用 peer 自动安装和严格校验，并禁用消费者脚本；确认没有额外下载 Harness/React。随后用一套宿主依赖加载已安装 Host，创建 SQLite 项目，验证新旧 codec 入口与浏览器 bundle 的注册。还通过临时 Git 仓库安装预构建树，允许正常脚本策略，确认没有消费者构建和开发依赖。负向检查删除和篡改 client 入口，确保发布校验拒绝。

设置 `DSH_SMOKE_RUNTIME` 为包含真实 `@deepseek-ai/dsh` 的安装目录时，还会运行真实 `dsh plugin add` 与 `--dump-config`，不设置版本豁免，再用该宿主的 SDK 执行模块冒烟。CI 覆盖固定开发基线，以及 Harness `0.1.7-rc.1` / `0.1.7-rc.2` 在 Node 22 / 24 下的安装与加载，消费者安装分别用 pnpm 11.15.1 / 12.6.0。真实 dsh CLI 使用其自带的 pnpm。

这不是所有未来 `0.1.x` 的功能兼容保证。上游若改动 API、浏览器注入契约或执行接口，仍应增加适配并扩展测试。冒烟不代替完整 GUI 操作和真实模型自动化验收。宿主升级时，先以新版本运行这套矩阵；跨 `0.2` 的更新必须专门验证后才扩展 peer 范围。不要自动执行 `allow-version --accept-risk`，也不要吞掉构建失败继续发布缺产物的包。
