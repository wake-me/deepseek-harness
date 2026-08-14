---
kind: dependency_management
name: pnpm Workspace + Vendor 源码内联与 @deepseek-ai 重命名策略
category: dependency_management
scope:
    - '**'
source_files:
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - package.json
    - .github/dependabot.yml
    - scripts/rescope-vendor.ts
    - scripts/verify-vendored-links.ts
    - scripts/gen-third-party-notices.ts
    - patches/node-pty@1.1.0.patch
    - python/sdk/pyproject.toml
    - python/sdk/uv.lock
---

## 1. 使用的系统与工具

本仓库是一个 **pnpm monorepo**，通过根 `package.json` 的 `workspaces` 字段聚合 `vendor/*`、`packages/*/*`、`native/landlock-run*`、`apps/*`、`website`、`examples`、`python/sdk-runtime` 等子包。根 `package.json` 声明 `"packageManager": "pnpm@11.7.0"` 并限制 Node 版本为 `^22.19.0 || >=24.0.0`，所有子工作区共享同一 pnpm 实例。

Python 侧使用 **uv**（`pyproject.toml` + `uv.lock`）管理 `python/sdk` 依赖，并通过 `[tool.uv.sources]` 将本地 `sdk-runtime` 以 `editable = true` 方式链接，实现 Python SDK 与 Node 运行时之间的本地开发联动。

## 2. 关键文件与位置

- `pnpm-workspace.yaml`：定义 workspace 成员、`linkWorkspacePackages: true`、`overrides`（将 `@deepseek-ai/cosmokit`、`@deepseek-ai/schemastery` 指向 `link:vendor/...`）、`peerDependencyRules`、`allowBuilds`（白名单式允许构建脚本）、`minimumReleaseAgeExclude`、`patchedDependencies`（`node-pty@1.1.0` 指向 `patches/node-pty@1.1.0.patch`）。
- `pnpm-lock.yaml`：锁定的依赖树，由 `verify-vendored-links.ts` 校验所有 vendor 包必须解析为 `link:`。
- `vendor/`：存放 vendored 源码（当前为空目录，但配置和脚本已就绪），配合 `pnpm-workspace.yaml#linkWorkspacePackages` 让上游 semver 范围解析到本地 pinned 源。
- `patches/node-pty@1.1.0.patch`：对第三方包的补丁。
- `.github/dependabot.yml`：按 cron 定时扫描 npm、uv、GitHub Actions 生态，排除 `vendor/**`（vendor 遵循 `vendor/README.md` 而非 registry 更新），冷却期 30 天。
- `scripts/rescope-vendor.ts`：将 vendor 中的 Cordis 框架及其插件从上游名（`cordis`、`@cordisjs/plugin-*`、`cosmokit`、`schemastery`）**重写为 `@deepseek-ai` scope**（如 `@deepseek-ai/cordis`、`@deepseek-ai/cordis-plugin-timer`），并提供 `--apply` / `--check` / `--reverse` 模式，维护 RENAMES 映射表与 EXACT_EDITS 清单。
- `scripts/verify-vendored-links.ts`：CI 门禁，校验 `pnpm-lock.yaml` 中每个 vendor 包名称都解析为 `link:`，禁止出现 registry 副本。
- `scripts/gen-third-party-notices.ts`：基于 vendor manifest 生成 `THIRD_PARTY_NOTICES.md`，记录上游来源与许可证。
- `python/sdk/pyproject.toml` + `python/sdk/uv.lock`：Python SDK 依赖声明与锁定。

## 3. 架构与设计决策

### 3.1 源码 vendoring + 名称重命名（rescope）

仓库采用 **源码级 vendoring** 而非二进制预打包：Cordis 框架及其插件被拷贝进 `vendor/`，并通过 `scripts/rescope-vendor.ts` 将其 `package.json` 的 `name` 改写为 `@deepseek-ai/*` 下的 scoped name。这样做的动机是：每个 harness 包将 `cordis` 作为 peer dependency 声明，发布 harness 时会连带发布该框架层；若保留上游名会占用公共 npm 命名空间，因此统一重命名为 `@deepseek-ai` scope 避免 squatting。

`pnpm-workspace.yaml` 中 `linkWorkspacePackages: true` 使得任何匹配 vendor 中上游 semver 范围的依赖解析都会落到本地 `vendor/` 源码，而不是 npm registry。同时 `overrides` 显式把 `@deepseek-ai/cosmokit`、`@deepseek-ai/schemastery` 指向 `link:vendor/...`，确保即使其他包直接引用这些库也走本地源码。

### 3.2 严格的构建脚本白名单

pnpm 10+ 默认阻止带 install/build 脚本的依赖安装。仓库通过 `allowBuilds` 白名单仅放行必要的原生构建：`esbuild`、`lefthook`、`node-pty`、`koffi`、以及 `@deepseek-ai/dsh-subprocess-local@file:...`。其余如 `@google/genai`、`protobufjs`、`node-addon-require-builtin` 等被显式 `false` 拒绝——即使它们只是可选依赖且脚本为 no-op，也必须显式列入。

### 3.3 多语言依赖管理

- **Node/TypeScript**：pnpm workspace + lockfile，依赖版本在各自 `package.json` 中声明，workspace 内部通过 `workspace:^` 引用。
- **Python**：`python/sdk` 使用 uv 管理依赖，`pyproject.toml` 声明 `pydantic`、`deepseek-harness-runtime-bin`，并通过 `[tool.uv.sources]` 将 `sdk-runtime` 以 editable 方式链接到本地路径。
- **原生二进制**：`native/landlock-run` 独立维护其 own package 与构建脚本，作为 workspace 成员参与解析但不参与主构建目标。

### 3.4 补丁机制

通过 `pnpm-workspace.yaml#patchedDependencies` 声明 `node-pty@1.1.0` 的补丁位于 `patches/node-pty@1.1.0.patch`，由 pnpm 自动应用。

## 4. 约定与约束

- **Vendor 包保持上游 semver 范围**：`vendor/` 内的包保留原始 `version` 与 `exports/type`，仅改 `name` 为 `@deepseek-ai/*`，以便 manifest 仍可追踪上游快照。
- **禁止 registry 副本**：`verify-vendored-links.ts` 在 CI 中检查 `pnpm-lock.yaml`，若发现 vendor 包名称解析为非 `link:` 或出现在 `packages`/`snapshots` 段中，即报错。
- **Dependabot 跳过 vendor**：`.github/dependabot.yml` 明确 `exclude-paths: ["vendor/**"]`，vendor 更新通过 `vendor/README.md` 与 rescope 流程手动同步。
- **Peer dependency 一致性**：`scripts/check-workspace-constraints.ts` 要求每个 harness 包将 `@deepseek-ai/cordis` 同时声明为 `peerDependencies` 与 `devDependencies`，且两者版本范围一致。
- **最小发布年龄豁免**：`minimumReleaseAgeExclude` 仅针对确需立即拉取的新模型目录的 `@earendil-works/pi-ai` 及若干 node-addon 平台包，其余依赖仍受 pnpm 默认冷却保护。
- **Python SDK 可编辑安装**：`python/sdk/pyproject.toml` 通过 `[tool.uv.sources]` 将 `deepseek-harness-runtime-bin` 指向 `../sdk-runtime` 并以 `editable = true` 安装，使本地修改即时生效。
- **第三方通知自动生成**：`gen-third-party-notices.ts` 从 vendor manifest 表生成 `THIRD_PARTY_NOTICES.md`，新增 vendor 包需同步更新该表。
- **Node 版本锁定**：根 `package.json` 的 `engines.node` 限定 `^22.19.0 || >=24.0.0`，配合 `packageManager` 字段保证团队与 CI 使用相同 pnpm 与 Node 版本。