---
kind: error_handling
name: 基于 HarnessError 的错误体系与错误链渲染
category: error_handling
scope:
    - '**'
source_files:
    - packages/llm/llm/src/error.ts
    - packages/core/tools/src/index.ts
    - packages/core/tools/src/ts-types.ts
    - packages/fs/fs/src/types.ts
    - packages/subagent/subagent/src/error.ts
    - packages/workflow/workflow/src/index.ts
    - packages/sandbox/sandbox/src/index.ts
    - packages/llm/llm/src/index.ts
    - packages/attachment/attachment/src/error.ts
    - python/sdk/src/deepseek_harness/errors.py
    - packages/host/apiproxy/src/api-proxy.ts
    - packages/acp/acp/src/index.ts
---

## 1. 系统/方法概述

仓库采用统一的 `@deepseek-ai/dsh-llm` 包中的 `HarnessError` 作为所有领域错误的基类，通过稳定的 `code`（如 `CONTEXT_WINDOW_EXCEEDED`、`QUOTA`、`EMPTY_RESPONSE`、`INVALID_CREDENTIAL`）进行机器路由，而非解析人类可读的 `message`。跨进程/跨语言边界（Python SDK、Web RPC、ACP、子代理）统一以 `{ code, message }` 结构传递错误。

核心工具函数集中在 `packages/llm/llm/src/error.ts`：
- `errorChain(value)`：将任意抛出的值（含 `cause` 链、`AggregateError`、循环引用、hostile 对象）安全渲染为单行诊断字符串，用于日志/通知/快照，**不用于程序分支**。
- `isContextWindowExceededError(detail)` / `isQuotaExceededError(detail)`：基于正则识别 provider 返回的上下文溢出与配额耗尽语义，供重试策略使用。
- `isHarnessError(value)`：运行时 `instanceof` 守卫，用于跨 realm 边界判断。

Python SDK (`python/sdk/src/deepseek_harness/errors.py`) 提供等价基类 `HarnessError` 及 `TransportClosedError`、`SdkProtocolError`、`JsonRpcError(code, message, data)`，与 JS 侧保持对称。

## 2. 关键文件与包

| 文件 | 作用 |
|---|---|
| `packages/llm/llm/src/error.ts` | 定义 `HarnessError`、常量代码、`errorChain`、`is*` 分类器 |
| `packages/core/tools/src/index.ts` | 抛出 `ToolNotFoundError`、`ToolOutputError`（均继承 `HarnessError`） |
| `packages/core/tools/src/ts-types.ts` | 通过代码生成向 Agent 暴露 `ToolCallError extends Error { toolName }` |
| `packages/fs/fs/src/types.ts` | `FsError extends HarnessError` |
| `packages/subagent/subagent/src/error.ts` | `SubagentError extends HarnessError` |
| `packages/workflow/workflow/src/index.ts` | `WorkflowError extends HarnessError` |
| `packages/sandbox/sandbox/src/index.ts` | `SandboxUnavailableError extends HarnessError` |
| `packages/llm/llm/src/index.ts` | `LlmError extends HarnessError` |
| `packages/attachment/attachment/src/error.ts` | 独立 `AttachmentError`（为避免依赖循环而重实现相同 shape） |
| `python/sdk/src/deepseek_harness/errors.py` | Python 侧 `HarnessError` 及其子类 |
| `packages/host/apiproxy/src/api-proxy.ts` | 捕获宿主层异常并转为 `host/agent-error` 事件（含 `errorChain`） |
| `packages/acp/acp/src/index.ts` | ACP 调用失败时通过 `errorChain` 输出到 turn 结果 |

## 3. 架构与约定

- **错误类型分层**：每个领域包定义自己的 `XxxError extends HarnessError`（tools、fs、subagent、workflow、sandbox、llm、session-query、interaction、web），携带领域特定的字段（如 `ToolOutputError` 带 violations 数组、`ToolNotFoundError` 带 `toolName`）。跨包边界统一通过 `code` 路由。
- **跨包依赖规避**：`attachment` 包因被 `dsh-llm` 反向依赖，无法直接 `extends HarnessError`，故在注释中明确“重新实现相同 shape”——只要拥有 `code`、`message`、`name` 三字段即可被上层按结构匹配。
- **错误传播路径**：底层工具/LLM/FS 抛出 `HarnessError` → 中间层用 `errorChain` 渲染为字符串写入日志/会话事件 → 顶层 API（ACP、API Gateway、Host Proxy）将 `{ code, message }` 序列化回客户端或转为 JSON-RPC error。
- **重试/恢复策略**：由 `isContextWindowExceededError` / `isQuotaExceededError` 等分类器决定，而非解析 message；`INVALID_CREDENTIAL` 被显式排除出可重试集合（每次尝试都会失败）。
- **Agent 工具错误**：工具执行失败统一抛出 `ToolCallError`（通过代码生成注入到 Agent 运行时的 `tools` 命名空间），使 Agent 能区分工具内部错误与框架错误。
- **Python 侧**：JSON-RPC 错误映射为 `JsonRpcError(code, message, data)`，传输关闭映射为 `TransportClosedError`，协议违规映射为 `SdkProtocolError`，均继承自 `HarnessError`。

## 4. 约定与约束

- **必须使用稳定 `code` 做分支**：`HarnessError` 文档明确要求“route on this, never by parsing message”。测试中也断言 `errorChain` 仅用于诊断表面，不用于逻辑判断。
- **错误消息不含敏感信息**：`AttachmentError` 构造参数注释要求 message “without raw bytes or host paths”，其他领域错误也遵循此约定。
- **错误链必须可安全渲染**：`errorChain` 对 hostile `toString`/`Symbol.toPrimitive`、循环 cause、diamond 共享 cause 做了防御，任何渲染失败都降级为 `<unrenderable value>` 或 `<circular cause>`，确保 UI/日志不会崩溃。
- **跨 realm 判断使用 `isHarnessError`**：避免 `instanceof` 在跨 worker/iframe/VM 场景失效。
- **无全局 panic/recover 机制**：Node.js 侧未使用 `process.on('uncaughtException')` 或 `try/catch` 包裹整个应用；错误通过返回值 `{ ok, error: { code, message } }`（client/connection）或抛出结构化错误向上冒泡。
- **测试覆盖错误渲染**：`packages/llm/llm/tests/service.spec.ts` 覆盖了 `errorChain` 对 fetch 失败、包装错误、plain string、structured provider failure、hostile object、circular cause、AggregateError、diamond 共享 cause 的所有分支，是错误渲染行为的单一事实来源。
- **Python SDK 与 JS SDK 对称**：两端各自维护独立的 `HarnessError` 基类，但错误码与语义保持一致，便于端到端调试。