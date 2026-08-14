---
kind: build_system
name: pnpm monorepo 构建、测试与发布流水线
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - pnpm-workspace.yaml
    - tsdown.config.ts
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - .github/workflows/build-exe-for-python-sdk.yml
    - .gitlab-ci.yml
    - scripts/run-gates.ts
    - scripts/build-exe-for-python-sdk.ts
    - scripts/build-python-release.py
    - scripts/check-macos-deployment-target.py
    - scripts/wine-windows-gates.sh
    - scripts/prepare-ci-bubblewrap.sh
    - vitest.config.ts
    - vitest.e2e.config.ts
    - vitest.web.config.ts
    - vitest.web-stress.config.ts
    - patches/node-pty@1.1.0.patch
---

## 1. 体系总览

本仓库是一个基于 **pnpm workspace** 的 Node/TypeScript monorepo，通过根 `package.json` 的 `workspaces` 字段聚合 `vendor/*`、`packages/*/*`、`native/landlock-run`（及其子包）、`apps/*`、`website`、`examples`（仅依赖解析）和 `python/sdk-runtime`。Node 引擎要求 `^22.19.0 || >=24.0.0`，统一使用 pnpm `11.7.0`。

构建入口集中在根脚本：
- `build:lib/host` → `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`
- `build:lib/client` → `tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client`
- `build:web` → `pnpm --filter @deepseek-ai/dsh-web-frontend run build`
- `build` 串联 host+client 再触发 web 构建。

tsdown 配置 (`tsdown.config.ts`) 将工作区限定在 `vendor/*`、`packages/*/*`、`apps/cli`，输出到各包的 `lib/`，并通过 `DSH_BUILD_FACE` 环境变量区分 host/client 两种构建面；host 面额外启用 Typert 插件生成类型契约。

## 2. 质量门禁与测试编排

所有本地与 CI 门控由 `scripts/run-gates.ts` 集中定义，它实现了一个带依赖图、并发控制、结果汇总的 gate 调度器。支持的模式包括 `ci-primary`、`ci-linux-primary`、`ci-static`、`ci-coverage`、`ci-snapshot`、`ci-artifacts`、`ci-consumers`、`ci-windows-blocking|complete|observational`、`node-compat`、`check-all`、`doc-sync` 等，每个模式返回一组 Gate（id/label/command/needs/env），并自动校验无环依赖。

根 `package.json` 暴露的 `check:*` 脚本全部委托给 `run-gates.ts`，例如：
- `check:ci` → `run-gates ci-primary`（typecheck → lint → duplication → coverage → node-compat smoke → snapshot → doc-typecheck → module-graph → knip → build → publint → node-next-types → built-package-invariants → built-bin-smoke）
- `check:ci:consumers` → 构建 + publint + lint + snapshot + web-snapshot + doc-typecheck + node-next-types + built-bin-smoke
- `check:ci:static` → 静态检查（不触发完整 build）
- `check:ci:windows-blocking` → 仅 build + docs:build

测试工具链：
- 单元测试：Vitest (`vitest.config.ts` / `vitest.shared.ts`)
- E2E：`vitest.e2e.config.ts`（CLI e2e）
- Web 快照：`vitest.web.config.ts`（Playwright + Chromium，`DSH_SNAPSHOT=replay` 回放）
- 压力测试：`vitest.web-stress.config.ts`
- 覆盖率：`--coverage`，重型套件通过 `coverage-exempt.ts` 豁免并在独立进程运行
- 文档站点：VitePress (`website/package.json`)，通过 `docs:build:mpa` 构建多页应用

## 3. 依赖与安装约束

`pnpm-workspace.yaml` 中显式声明了严格的依赖策略：
- `linkWorkspacePackages: true`：本地包互相 link
- `overrides`：强制 `@deepseek-ai/cosmokit`、`@deepseek-ai/schemastery` 指向 `vendor/` 下的源码
- `peerDependencyRules.allowedVersions.typescript: '>=5 <7'`：锁定 TS 版本范围
- `allowBuilds`：默认拒绝任何依赖的 install/build 脚本，仅白名单放行 `esbuild`、`lefthook`、`node-pty`、`koffi`、`@deepseek-ai/dsh-subprocess-local@file:...`；未列出的如 `@google/genai`、`protobufjs` 被显式禁止但允许安装继续
- `patchedDependencies`：对 `node-pty@1.1.0` 应用 `patches/node-pty@1.1.0.patch`
- `minimumReleaseAgeExclude`：跳过部分新发布的依赖的最小发行年龄限制

## 4. 原生与 Python SDK 构建

Python SDK 构建由 `.gitlab-ci.yml` 驱动（GitLab Pipelines），分为 `build` 与 `publish` 两阶段：
- `sdk-wheel`：构建 `deepseek_harness_sdk` wheel
- `runtime-*`（linux-x64、linux-arm64、macos-arm64）：调用 `scripts/build-exe-for-python-sdk.ts` 用 `@napi-rs/cli`（通过 `targets=node24-*`）编译 Node 二进制，再用 `scripts/build-python-release.py` 打包为 manylinux/macosx wheel；Linux 产物通过 `readelf` 校验 glibc ≤ 2.28，并使用 `quay.io/pypa/manylinux_2_28_*` Docker 镜像做交叉验证；macOS 通过 `scripts/check-macos-deployment-target.py` 校验部署目标
- `publish-python`：使用 twine 上传至 GitLab PyPI，要求恰好存在 4 个 wheel

GitHub Actions 中的 `python-runtime` job 复用 `.github/workflows/build-exe-for-python-sdk.yml` 在 PR 上做一次 release-shaped 验证。

## 5. 发布流程

### dsh npm 包发布（`.github/workflows/release.yml`）
- `pack` job：`pnpm run release:verify --family dsh` → `pnpm run build` → `pnpm run release:pack --family dsh --out dist/npm`，同时打包 vendor 框架与 landlock entry 用于验证
- `release:verify-packed-install`：从 packed tarball 重新安装并验证可运行
- `publish` job：仅在 `workflow_dispatch` 且 `inputs.publish=true` 时执行，读取 GitHub Environment `npm-publish` 的审批保护，下载 artifact 后用 `pnpm run release:publish --family dsh` 发布到 npm

### Python SDK 发布（`.gitlab-ci.yml`）
- 仅当 tag 匹配 `python-v<version>` 且与 `package.json` 版本一致时才触发
- 通过 `TWINE_REPOSITORY_URL=$CI_API_V4_URL/projects/$CI_PROJECT_ID/packages/pypi` 上传到项目级 PyPI

### 其他发布
- `release-vendor.yml`：vendor 框架单独版本线
- `landlock-run-release.yml`：原生 Landlock 启动器按平台分发
- `python-release.yml`：Python SDK 发布

## 6. 约定与约束

- **Node 版本矩阵**：`engines.node` 要求 `^22.19.0 || >=24.0.0`；CI 主版本为 24，兼容测试覆盖 22.19 与 26
- **不可变安装**：CI 始终使用 `pnpm install --frozen-lockfile`，确保锁文件即真相
- **Telemetry 关闭**：CI 设置 `DSH_TELEMETRY_DISABLED=1`，避免上报生产端点
- **并发控制**：通过 `DSH_GATE_CONCURRENCY`、`DSH_COVERAGE_MAX_WORKERS`、`DSH_OXLINT_THREADS`、`DSH_PUBLINT_CONCURRENCY`、`DSH_SNAPSHOT_MAX_CONCURRENCY` 等环境变量调节不同 gate 的并行度
- **失败转移**：Linux 与 Windows 分别支持 `DSH_CI_FAILOVER_LINUX` / `DSH_CI_FAILOVER_WINDOWS=selfhosted` 变量切换至自托管 runner pool
- **Windows 兼容性**：PR 通过 Wine 在 Linux 上运行阻塞性 Windows gates；真实 Windows 作为非阻塞观测通道
- **Bubblewrap 沙箱**：CI 通过 `scripts/prepare-ci-bubblewrap.sh` 预装 bubblewrap 以支持受限环境测试
- **构建产物目录**：tsdown 输出到各包 `lib/`，Web 前端由 Vite 构建，Python SDK 产物位于 `release/<platform>/` 或 `dist-exe/`