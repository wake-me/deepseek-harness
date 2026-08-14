---
kind: logging_system
name: 基于 Cordis Context.logger 的日志系统
category: logging_system
scope:
    - '**'
source_files:
    - packages/boot/app-boot/src/index.ts
    - apps/cli/src/bin.ts
    - apps/cli/src/profile-boot.ts
    - packages/core/agent/src/dispatch.ts
    - packages/core/agent-loop/src/index.ts
    - packages/compaction/compaction-basic/src/index.ts
    - packages/context/tmux-context/src/index.ts
    - packages/client/hmr/src/client/index.ts
---

## 1. 使用的系统/方法

仓库没有引入独立的第三方日志框架（如 pino、winston、bunyan）。所有业务代码通过 **Cordis 框架提供的 `Context.logger`** 进行结构化日志输出，该 logger 由 Cordis 在启动时注入到每个插件 fiber 的上下文中。CLI 与 Web 运行时中出现的少量 `console.log/warn/error` 仅用于浏览器端错误兜底或测试辅助，不属于正式日志通道。

- 服务端 / 插件侧：统一使用 `ctx.logger.info(...)`、`ctx.logger.warn(...)`、`ctx.logger.error(...)` 等 API。
- CLI 启动阶段：通过 `installFailLoud` 将未处理的 rejection 写入 `process.stderr` 并退出，属于“致命诊断”而非业务日志。
- 配置 dump：`renderConfigDump` 把 Loader 内部警告收集到数组并通过 `warn` 回调输出，不依赖全局日志。

## 2. 关键文件与包

| 位置 | 作用 |
|---|---|
| `packages/boot/app-boot/src/index.ts` | 提供 `boot`、`installFailLoud`、`loadLayeredEnv`、`renderConfigDump`；负责安装 unhandledRejection 处理器并以 `binName: ...` 前缀写 stderr |
| `apps/cli/src/bin.ts` | dsh CLI 入口，解析参数后动态导入 profile/plugin/dump-config 模式 |
| `apps/cli/src/profile-boot.ts` | 组装 profile 补丁栈（bundle → profile.patch.yml → $DSH_HOME/cordis.patch.yml → --patch → 遥测开关），调用 boot |
| `packages/core/agent/src/dispatch.ts` | 事件监听器异常捕获，使用 `ctx.logger.warn` 记录被拒绝的事件 |
| `packages/core/agent-loop/src/index.ts` | Agent 循环中 config-driven 操作失败时使用 `ctx.logger.warn` |
| `packages/compaction/compaction-basic/src/index.ts` | 压缩步骤中使用 `ctx.logger.info` / `ctx.logger.warn` |
| `packages/context/tmux-context/src/index.ts` | 查询 tmux 位置时传入 `ctx.logger` 作为 sink |
| `packages/client/hmr/src/**/*.ts` | 前端 HMR 模块通过 `ctx.logger.warn/error` 报告重建失败 |

## 3. 架构与约定

- **上下文注入式 logger**：每个 Cordis fiber 的 `Context` 暴露 `logger` 属性，插件通过 `this.ctx.logger` 或函数参数中的 `ctx.logger` 获取。日志级别为 `info` / `warn` / `error`（从实际调用可见）。
- **结构化字段**：日志消息采用 printf 风格占位符（如 `` ctx.logger.warn(`step compaction failed: ${message}; continuing the turn`) ``、`` ctx.logger.warn(`agent event "${name}" listener rejected: ${String(error)}`) ``），便于在 stdout/stderr 中快速定位来源。
- **启动期诊断独立于业务日志**：`installFailLoud` 在 boot 之前注册 `unhandledRejection`，以 `${binName}: fatal load failure: ...` 格式直接写 `process.stderr` 并 exit(1)，确保插件加载失败不会被吞掉。
- **配置层诊断可插拔**：`loadEnv`、`renderConfigDump` 接受 `warn: (line: string) => void` 回调，默认落向 `process.stderr.write`，使测试和 dump 模式可以拦截诊断行。
- **Web 客户端降级**：浏览器端无法写 stderr，因此 `packages/client/connection`、`packages/client/runtime` 等直接使用 `console.warn/error` 作为兜底，这些是运行时错误告警，不是结构化日志。

## 4. 约定与约束

- **业务日志必须走 `ctx.logger`**：所有 Cordis 插件（core、context、compaction、client/hmr 等）均通过 `ctx.logger` 输出，禁止自行引入外部日志库。
- **CLI 启动失败不产生业务日志**：`installFailLoud` 只写 stderr 并退出，保证 ACP 模式的 stdout 不被污染（注释明确说明 “Stdout remains untouched for ACP”）。
- **`.env` 加载失败走 `warn` 回调**：`loadEnv` / `readEnvLayer` 对 ENOENT 之外的读取错误通过 `warn` 输出一行诊断，而不是抛错或静默忽略。
- **配置 dump 复用 Loader 警告机制**：`renderConfigDump` 将 include 的 `%C` printf 样式警告收集到数组，再按层标签前缀输出，保持与 Loader 启动警告一致的行为。
- **无全局日志级别开关**：仓库中没有发现环境变量控制日志级别（如 `LOG_LEVEL`、`DEBUG` 等）；日志行为由 Cordis 宿主决定，当前实现未见按级别过滤的代码。
- **测试中避免真实 I/O**：测试通过注入 `warn` 回调、fake `process` 对象来验证诊断输出，不依赖真实控制台。

总结：该仓库采用 Cordis 框架内置的 `Context.logger` 作为唯一业务日志通道，CLI 启动期使用独立的 `installFailLoud` 处理致命错误，浏览器端则回退到 `console.*` 作为兜底。没有统一的日志级别配置或集中式 sink 抽象，日志输出位置取决于运行环境（Node stderr vs 浏览器 console）。