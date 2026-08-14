# Node.js SDK

<cite>
**本文引用的文件**
- [packages/sdk/README.md](file://packages/sdk/README.md)
- [packages/sdk/client/src/index.ts](file://packages/sdk/client/src/index.ts)
- [packages/sdk/client/src/api.ts](file://packages/sdk/client/src/api.ts)
- [packages/sdk/client/src/client.ts](file://packages/sdk/client/src/client.ts)
- [packages/sdk/client/src/types.ts](file://packages/sdk/client/src/types.ts)
- [packages/sdk/protocol/src/index.ts](file://packages/sdk/protocol/src/index.ts)
- [packages/sdk/protocol/src/types.ts](file://packages/sdk/protocol/src/types.ts)
- [packages/sdk/server/src/index.ts](file://packages/sdk/server/src/index.ts)
- [packages/sdk/server/src/server.ts](file://packages/sdk/server/src/server.ts)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能与超时配置](#性能与超时配置)
8. [错误处理与调试](#错误处理与调试)
9. [使用示例与最佳实践](#使用示例与最佳实践)
10. [结论](#结论)

## 简介
本 SDK 提供在 Node.js 中驱动 DeepSeek Harness 运行时（子进程）的客户端、协议层与服务端插件。通过标准输入输出上的 JSON-RPC 行式传输，客户端可创建会话、发送消息、订阅事件并管理生命周期；服务端插件将请求路由到 Cordis 上下文中的 Agent/Session/Subagent 等能力，并以通知形式回推运行期事件。该设计使 TypeScript 与 Python SDK 共享同一协议与运行时边界，便于跨语言集成与自动化编排。

## 项目结构
SDK 由三个协作包组成：
- protocol：定义跨进程通信的 JSON-RPC 类型与传输抽象
- client：封装子进程启动、握手、会话与通知订阅的高/低层 API
- server：作为 Cordis 插件暴露 JSON-RPC 服务，桥接到宿主运行时

```mermaid
graph TB
subgraph "调用方进程"
A["应用代码"]
B["DeepSeekHarness<br/>高层API"]
C["HarnessClient<br/>JSON-RPC客户端"]
end
subgraph "运行时进程"
D["Cordis Context"]
E["HarnessSdkJsonRpcServer<br/>JSON-RPC服务器"]
F["Agent/Session/Subagent<br/>运行时能力"]
end
A --> B --> C
C < --> |stdio JSON-RPC| E
E --> D --> F
```

图表来源
- [packages/sdk/client/src/api.ts:22-119](file://packages/sdk/client/src/api.ts#L22-L119)
- [packages/sdk/client/src/client.ts:184-458](file://packages/sdk/client/src/client.ts#L184-L458)
- [packages/sdk/server/src/index.ts:46-92](file://packages/sdk/server/src/index.ts#L46-L92)
- [packages/sdk/server/src/server.ts:53-241](file://packages/sdk/server/src/server.ts#L53-L241)

章节来源
- [packages/sdk/README.md:1-12](file://packages/sdk/README.md#L1-L12)

## 核心组件
- 协议层（protocol）
  - 传输：基于 stdio 的 JSON-RPC 行式传输
  - 方法：initialize、session/prompt、shutdown
  - 通知：session.event、session.status、subagent.started、subagent.finished
- 客户端（client）
  - 高层：DeepSeekHarness、HarnessSession
  - 低层：HarnessClient（子进程管理、请求/通知、超时与关闭）
  - 类型：Launch 选项、RunResult、NotificationFilter 等
- 服务端（server）
  - 插件入口：apply(ctx, config)
  - 服务器：HarnessSdkJsonRpcServer（会话创建、事件转发、关闭清理）

章节来源
- [packages/sdk/protocol/src/index.ts:1-26](file://packages/sdk/protocol/src/index.ts#L1-L26)
- [packages/sdk/protocol/src/types.ts:15-105](file://packages/sdk/protocol/src/types.ts#L15-L105)
- [packages/sdk/client/src/index.ts:1-30](file://packages/sdk/client/src/index.ts#L1-L30)
- [packages/sdk/client/src/types.ts:11-75](file://packages/sdk/client/src/types.ts#L11-L75)
- [packages/sdk/server/src/index.ts:1-93](file://packages/sdk/server/src/index.ts#L1-L93)
- [packages/sdk/server/src/server.ts:1-241](file://packages/sdk/server/src/server.ts#L1-L241)

## 架构总览
下图展示一次“发送消息并等待空闲”的端到端流程：客户端发起 prompt，服务端入队消息，随后以 session.event/session.status 等通知流回推，直到目标会话进入 idle。

```mermaid
sequenceDiagram
participant App as "应用"
participant H as "DeepSeekHarness/HarnessSession"
participant C as "HarnessClient"
participant T as "JSON-RPC传输"
participant S as "HarnessSdkJsonRpcServer"
participant R as "Cordis/Agent/Session"
App->>H : run(input, options)
H->>C : start()/initialize()
C->>T : initialize(params)
T-->>S : initialize
S-->>T : InitializeResult
T-->>C : InitializeResult
H->>C : prompt(sessionId, contentBlocks)
C->>T : session/prompt
T-->>S : session/prompt
S->>R : followup(user message)
R-->>S : session.event / session.status
S-->>T : notify(...)
T-->>C : notifications
C-->>H : 收集至idle
H-->>App : RunResult{sessionId, finalResponse, events, notifications}
```

图表来源
- [packages/sdk/client/src/api.ts:146-194](file://packages/sdk/client/src/api.ts#L146-L194)
- [packages/sdk/client/src/client.ts:268-333](file://packages/sdk/client/src/client.ts#L268-L333)
- [packages/sdk/server/src/server.ts:111-143](file://packages/sdk/server/src/server.ts#L111-L143)
- [packages/sdk/server/src/server.ts:71-103](file://packages/sdk/server/src/server.ts#L71-L103)

## 详细组件分析

### 协议层（protocol）
- 传输与错误
  - JsonRpcLineTransport：基于 stdio 的行式 JSON-RPC 传输
  - JsonRpcResponseError：表示远端返回的协议级错误
- 命名方法与通知
  - 请求：initialize、session/prompt、shutdown
  - 通知：session.event、session.status、subagent.started、subagent.finished
- 关键类型
  - InitializeParams/InitializeResult：握手参数与服务器身份
  - SessionPromptParams/SessionPromptResult：提示入队与回执
  - SdkRunStatus：ok/error
  - 各通知载荷：包含 sessionId、event、parent/child 关系、stopReason 等

章节来源
- [packages/sdk/protocol/src/index.ts:11-25](file://packages/sdk/protocol/src/index.ts#L11-L25)
- [packages/sdk/protocol/src/types.ts:15-105](file://packages/sdk/protocol/src/types.ts#L15-L105)

### 客户端（client）
- HarnessClient（低层）
  - 子进程生命周期：start/close，内部维护 stdin/stdout/stderr 管道，EOF→SIGTERM→SIGKILL 回收阶梯
  - 请求与超时：request(method, params?, timeoutMs?)，支持 per-call 超时与 AbortController 放弃
  - 通知订阅：subscribe(filter)、subscribeSessionTree(rootSessionId)，支持 next()/tryNext()/async iteration
  - 错误类型：TransportClosedError、RequestTimeoutError、SdkProtocolError
- DeepSeekHarness（高层）
  - 启动与握手：start() 懒启动子进程并执行 initialize，失败时自动重建客户端并重试（除非已 close）
  - 会话与运行：session(id?) 打开会话；run(input, options) 发送提示并收集到 idle，返回 RunResult
  - 资源清理：close() 或 await using 确保子进程被回收
- 类型与数据模型
  - HarnessClientOptions：command/args/cwd/env/requestTimeoutMs/shutdownTimeoutMs/disposeEofGraceMs/disposeGraceMs
  - DeepSeekHarnessOptions：launch + cwd/provider/model/maxTokens
  - RunResult：sessionId/finalResponse/events/notifications
  - NotificationFilter：过滤通知的谓词

```mermaid
classDiagram
class HarnessClient {
+constructor(options)
+start() void
+initialize(params) Promise
+prompt(sessionId, contentBlocks) Promise
+request(method, params?, timeoutMs?) Promise
+subscribe(filter?) NotificationSubscription
+subscribeSessionTree(sessionId) NotificationSubscription
+close() Promise
}
class NotificationSubscription {
+next() Promise
+tryNext() HarnessNotification|undefined
+close() void
}
class DeepSeekHarness {
+constructor(options)
+start() Promise
+session(id?) HarnessSession
+run(input, options?) Promise
+close() Promise
}
class HarnessSession {
+id string
+run(input, options?) Promise
}
DeepSeekHarness --> HarnessClient : "拥有"
DeepSeekHarness --> HarnessSession : "创建"
HarnessSession --> DeepSeekHarness : "持有"
```

图表来源
- [packages/sdk/client/src/client.ts:184-458](file://packages/sdk/client/src/client.ts#L184-L458)
- [packages/sdk/client/src/api.ts:22-194](file://packages/sdk/client/src/api.ts#L22-L194)

章节来源
- [packages/sdk/client/src/client.ts:184-458](file://packages/sdk/client/src/client.ts#L184-L458)
- [packages/sdk/client/src/api.ts:22-194](file://packages/sdk/client/src/api.ts#L22-L194)
- [packages/sdk/client/src/types.ts:22-75](file://packages/sdk/client/src/types.ts#L22-L75)

### 服务端（server）
- 插件入口 apply(ctx, config)
  - 建立 JsonRpcLineTransport 并启动
  - 注册 onRequest/onNotification，处理 shutdown 后 flush+dispose+exit
- HarnessSdkJsonRpcServer
  - initialize：记录 cwd/provider/model/maxTokens，按需挂载 LLM 适配器
  - prompt：查找或创建会话，校验存活后投递用户消息
  - 事件转发：session/event、agent/status、session/created、subagent/end
  - shutdown：有序释放订阅、会话句柄、可选 LLM Fiber，聚合异常

```mermaid
flowchart TD
Start(["收到请求"]) --> M{"方法名?"}
M --> |initialize| Init["初始化cwd/provider/model/maxTokens"]
M --> |session/prompt| Prompt["getOrCreateSession -> followup"]
M --> |shutdown| Shut["performShutdown: 释放订阅/会话/Fiber"]
Init --> End(["返回结果"])
Prompt --> End
Shut --> End
```

图表来源
- [packages/sdk/server/src/index.ts:46-92](file://packages/sdk/server/src/index.ts#L46-L92)
- [packages/sdk/server/src/server.ts:111-241](file://packages/sdk/server/src/server.ts#L111-L241)

章节来源
- [packages/sdk/server/src/index.ts:1-93](file://packages/sdk/server/src/index.ts#L1-L93)
- [packages/sdk/server/src/server.ts:1-241](file://packages/sdk/server/src/server.ts#L1-L241)

## 依赖关系分析
- 客户端依赖
  - node:child_process：子进程管理
  - @deepseek-ai/dsh-sdk-protocol：传输与类型
  - @deepseek-ai/dsh-llm：ContentBlock 类型
  - @deepseek-ai/dsh-session：SessionEvent 类型
- 服务端依赖
  - @deepseek-ai/cordis：Context、插件机制
  - @deepseek-ai/dsh-sdk-protocol：传输与类型
  - @deepseek-ai/dsh-agent/dsh-session/dsh-subagent：会话与子代理能力
  - @deepseek-ai/dsh-llm-deepseek：按需挂载默认 LLM 适配器

```mermaid
graph LR
Client["client.ts"] --> Proto["@deepseek-ai/dsh-sdk-protocol"]
Client --> LLM["@deepseek-ai/dsh-llm"]
Client --> Session["@deepseek-ai/dsh-session"]
Server["server.ts"] --> Cordis["@deepseek-ai/cordis"]
Server --> Proto
Server --> Agent["@deepseek-ai/dsh-agent"]
Server --> Subagent["@deepseek-ai/dsh-subagent"]
Server --> LLMDS["@deepseek-ai/dsh-llm-deepseek"]
```

图表来源
- [packages/sdk/client/src/client.ts:15-25](file://packages/sdk/client/src/client.ts#L15-L25)
- [packages/sdk/server/src/server.ts:8-16](file://packages/sdk/server/src/server.ts#L8-L16)

章节来源
- [packages/sdk/client/src/client.ts:15-25](file://packages/sdk/client/src/client.ts#L15-L25)
- [packages/sdk/server/src/server.ts:8-16](file://packages/sdk/server/src/server.ts#L8-L16)

## 性能与超时配置
- 请求超时
  - requestTimeoutMs：全局默认；request 支持 per-call 覆盖
  - 建议：为长任务设置合理上限，避免悬挂请求占用资源
- 关闭与回收
  - shutdownTimeoutMs：协议 shutdown 交换上限
  - disposeEofGraceMs/disposeGraceMs：stdin EOF 与 SIGTERM/SIGKILL 确认窗口
  - 建议：根据环境调整，确保子进程及时回收
- 事件收集
  - subscribeSessionTree：按根会话及子代理树过滤，减少无关事件处理开销
  - onNotification：在高吞吐场景下避免重计算，仅做必要落盘或指标上报
- 内存与缓冲
  - stderr 尾部限制：防止意外退出时日志过大
  - 通知队列：订阅实现内部队列，注意及时消费以避免积压

[本节为通用指导，不直接分析具体文件]

## 错误处理与调试
- 错误类型
  - TransportClosedError：子进程不可用（退出、管道关闭、未启动），附带退出码与 stderr 尾部
  - RequestTimeoutError：请求超过超时阈值
  - SdkProtocolError：响应不符合协议约定（如缺少 messageId）
  - JsonRpcResponseError：远端返回的协议错误（保留 code/data）
- 调试技巧
  - 捕获 stderr 尾部：TransportClosedError 中包含最近若干行 stderr，有助于定位崩溃原�
  - 打印事件流：订阅 session.event 并观察 agent/inbox/spliced 回执，确认消息入队成功
  - 会话状态：监听 session.status 变化，确认 idle/running 转换
  - 子代理链路：利用 subagent.started/finished 构建父子关系，排查子代理行为
- 资源清理
  - 始终调用 close() 或使用 await using，确保子进程被回收
  - 关闭订阅：不再需要时调用 subscription.close()，避免残留等待者

章节来源
- [packages/sdk/client/src/client.ts:38-65](file://packages/sdk/client/src/client.ts#L38-L65)
- [packages/sdk/client/src/client.ts:301-333](file://packages/sdk/client/src/client.ts#L301-L333)
- [packages/sdk/client/src/client.ts:436-457](file://packages/sdk/client/src/client.ts#L436-L457)
- [packages/sdk/server/src/server.ts:155-181](file://packages/sdk/server/src/server.ts#L155-L181)

## 使用示例与最佳实践
以下为常见使用模式与步骤指引（以路径引用代替代码片段）：

- 快速开始：启动、握手、运行一轮对话
  - 参考：[packages/sdk/client/src/api.ts:62-100](file://packages/sdk/client/src/api.ts#L62-L100)
  - 要点：构造 DeepSeekHarness，调用 run() 自动完成 start()/initialize()，返回 RunResult

- 异步会话与消息发送
  - 参考：[packages/sdk/client/src/client.ts:268-290](file://packages/sdk/client/src/client.ts#L268-L290)
  - 要点：prompt() 立即返回 messageId，后续通过事件流确认入队与处理

- 工具调用与事件处理
  - 参考：[packages/sdk/server/src/server.ts:71-103](file://packages/sdk/server/src/server.ts#L71-L103)
  - 要点：订阅 session.event 获取工具执行细节；通过 subagent.* 跟踪子代理

- 文件操作与代码执行（通过运行时工具）
  - 说明：文件与代码执行由运行时插件提供（如 Bash、FS、PTY），SDK 侧通过事件与最终响应观察结果
  - 参考：[packages/sdk/server/src/server.ts:111-143](file://packages/sdk/server/src/server.ts#L111-L143)

- 子代理调用
  - 参考：[packages/sdk/server/src/server.ts:78-103](file://packages/sdk/server/src/server.ts#L78-L103)
  - 要点：利用 subagent.started/finished 与父/子会话关系进行追踪与聚合

- 错误处理与超时
  - 参考：[packages/sdk/client/src/client.ts:301-333](file://packages/sdk/client/src/client.ts#L301-L333)
  - 要点：捕获 RequestTimeoutError/TransportClosedError/SdkProtocolError，结合 stderr 尾部诊断

- 资源清理
  - 参考：[packages/sdk/client/src/api.ts:107-118](file://packages/sdk/client/src/api.ts#L107-L118)
  - 参考：[packages/sdk/client/src/client.ts:380-401](file://packages/sdk/client/src/client.ts#L380-L401)
  - 要点：使用 close() 或 await using；确保所有订阅被关闭

- 类型定义速查
  - 客户端选项与结果：[packages/sdk/client/src/types.ts:22-75](file://packages/sdk/client/src/types.ts#L22-L75)
  - 协议类型与方法：[packages/sdk/protocol/src/types.ts:15-105](file://packages/sdk/protocol/src/types.ts#L15-L105)

[本节为使用指南，不直接分析具体文件]

## 结论
本 SDK 通过清晰的三层设计（协议/客户端/服务端）实现了跨进程的 Harness 运行时控制。客户端提供高层易用 API 与低层灵活控制，服务端插件将请求安全地映射到 Cordis 上下文的能力。借助完善的错误类型、超时与资源管理机制，开发者可以稳定地构建自动化工作流、子代理编排与事件驱动的交互系统。建议在工程中统一配置超时与清理策略，并通过事件流进行观测与调试，以获得更好的可维护性与可观测性。