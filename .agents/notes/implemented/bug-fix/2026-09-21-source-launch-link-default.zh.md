# Agent Note: 源码启动默认恢复 link 解析

Status: retired (v0.1.7-alpha.2)

[English](2026-09-21-source-launch-link-default.md) | 中文

上游删除了解析模式选项（runtime-only profile resolution，9fd0a5ad52），且 runtime 解析器在 tsx 源码启动下已正常——v0.1.7-alpha.2 合并（9116b1be64）上以 headless bash 冒烟验证。本地默认值覆盖随选项一起消亡，无需保留或重放。以下记录本补丁在 v0.1.6-alpha.2 期间承载的回归。

## 问题

v0.1.6-alpha.2 把非打包启动的 profile 解析默认从 `link` 翻转为 `runtime`（上游 9ddef327a4）。tsx 源码启动下，runtime 路由器把 Loader 插件行经 package exports 解析到 `lib/index.js`，而 CLI 自身模块图经 tsconfig paths 投影到 `src/`，一个进程加载两份 `dsh-tools`。两个 `TOOL_RUNTIME_SCHEDULER` symbol 不匹配，每次工具派发在 `tool-calls.ts` 抛 `Cannot read properties of undefined (reading 'prepare')`。没有构建 `lib/` 时同一模式改为启动响亮失败（`dsh-tools failed to import`）。上游已在讨论 #7273 确认该回归；其门槛漏掉它，因为真 API e2e 走构建产物，源码启动冒烟只断言 TTY 拒绝。

## 决策

`apps/cli/src/profile-boot.ts` 保留打包默认 `runtime`，但非打包默认恢复为 `link`——与 #7273 推荐的本地补丁相同。以 headless bash 冒烟验证：`runtime` 默认每次工具调用失败，`link` 默认运行干净；无构建 `lib/` 的全新检出在 `runtime` 下启动失败。

## 考虑过的替代方案

**跑编译入口（`node apps/cli/lib/bin.js web`）。** 否决：桌面壳直接源码启动 `bin.ts`，本修复让该启动向量继续可用。

**降级到 v0.1.6-alpha.1。** 否决：丢失本仓库携带的 v0.1.6 同步。

## 后果

源码启动恢复到 v0.1.5 之前的解析方式。此行偏离上游：上游发布 #7273 所指正式修复（统一路径解析或跨实例 symbol）后移除本行。回归发生前被中止的会话可能保留受损轮次历史；开新对话而非续用它们。
