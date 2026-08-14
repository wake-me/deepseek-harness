# 客户端 API

<cite>
**本文引用的文件**
- [packages/sdk/client/src/client.ts](file://packages/sdk/client/src/client.ts)
- [packages/sdk/client/src/types.ts](file://packages/sdk/client/src/types.ts)
- [packages/sdk/client/src/api.ts](file://packages/sdk/client/src/api.ts)
- [packages/sdk/protocol/src/types.ts](file://packages/sdk/protocol/src/types.ts)
- [packages/sdk/protocol/src/transport.ts](file://packages/sdk/protocol/src/transport.ts)
- [packages/sdk/client/src/dispose.ts](file://packages/sdk/client/src/dispose.ts)
- [packages/sdk/client/README.zh.md](file://packages/sdk/client/README.zh.md)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能与超时配置](#性能与超时配置)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录：类型定义与使用示例](#附录类型定义与使用示例)

## 简介
本文件面向 Node.js SDK 客户端，系统性说明 DeepSeekHarnessClient（即 HarnessClient）与高层封装 DeepSeekHarness 的构造、配置、生命周期管理、异步会话创建、消息发送、工具调用与事件处理机制。同时覆盖连接管理、错误处理、资源清理策略，并提供完整的类型定义说明与常见使用模式示例路径，帮助开发者在子进程运行时之上构建稳定可靠的 Agent 工作流。

## 项目结构
SDK 客户端由三层组成：
- 协议层：JSON-RPC 行式传输与协议类型定义
- 客户端层：低层 JSON-RPC 客户端 HarnessClient，负责子进程生命周期、请求/通知、订阅
- 高层 API：DeepSeekHarness/HarnessSession，提供 run() 等易用接口，封装会话与事件收集

```mermaid
graph TB
subgraph "应用"
App["你的应用代码"]
end
subgraph "SDK 客户端"
HSH["DeepSeekHarness<br/>高层API"]
HS["HarnessSession<br/>会话句柄"]
HC["HarnessClient<br/>低层客户端"]
TR["JsonRpcLineTransport<br/>JSON-RPC 传输"]
end
subgraph "运行时"
RT["子进程运行时<br/>dsh-jsonrpc-agent"]
end
App --> HSH
HSH --> HS
HSH --> HC
HS --> HC
HC --> TR
TR < --> RT
```

图表来源
- [packages/sdk/client/src/api.ts:22-119](file://packages/sdk/client/src/api.ts#L22-L119)
- [packages/sdk/client/src/client.ts:184-458](file://packages/sdk/client/src/client.ts#L184-L458)
- [packages/sdk/protocol/src/transport.ts:62-173](file://packages/sdk/protocol/src/transport.ts#L62-L173)

章节来源
- [packages/sdk/client/src/api.ts:22-119](file://packages/sdk/client/src/api.ts#L22-L119)
- [packages/sdk/client/src/client.ts:184-458](file://packages/sdk/client/src/client.ts#L184-L458)
- [packages/sdk/protocol/src/transport.ts:62-173](file://packages/sdk/protocol/src/transport.ts#L62-L173)

## 核心组件
- HarnessClient：低层 JSON-RPC 客户端，拥有子进程生命周期，实现 initialize/prompt/request/subscribe/close 等能力
- DeepSeekHarness：高层自有运行 API，封装启动、握手、会话创建与 run() 活动区间
- HarnessSession：会话句柄，封装一次 prompt 到 idle 的活动区间，收集事件与通知
- JsonRpcLineTransport：基于 stdio 的 JSON-RPC 2.0 行式传输，支持 request/notify/flush
- disposeRuntimeProcess：子进程优雅关闭阶梯（EOF → SIGTERM → SIGKILL）

章节来源
- [packages/sdk/client/src/client.ts:184-458](file://packages/sdk/client/src/client.ts#L184-L458)
- [packages/sdk/client/src/api.ts:22-195](file://packages/sdk/client/src/api.ts#L22-L195)
- [packages/sdk/protocol/src/transport.ts:62-173](file://packages/sdk/protocol/src/transport.ts#L62-L173)
- [packages/sdk/client/src/dispose.ts:82-99](file://packages/sdk/client/src/dispose.ts#L82-L99)

## 架构总览
下图展示从应用调用到运行时响应的完整流程，包括会话创建、提示入队、事件订阅与空闲收敛。

```mermaid
sequenceDiagram
participant A as "应用"
participant H as "DeepSeekHarness"
participant S as "HarnessSession"
participant C as "HarnessClient"
participant T as "JsonRpcLineTransport"
participant R as "运行时子进程"
A->>H : start()
H->>C : start()
H->>C : initialize({cwd, provider, model, maxTokens?})
C->>T : request("initialize", params)
T-->>R : 写入请求帧
R-->>T : 返回 InitializeResult
T-->>C : resolve(result)
C-->>H : 完成握手
A->>S : run(input, options?)
S->>C : prompt(sessionId, contentBlocks)
C->>T : request("session/prompt", params)
T-->>R : 写入 session/prompt
R-->>T : 返回 {messageId}
T-->>C : resolve(messageId)
C-->>S : messageId
S->>C : subscribeSessionTree(sessionId)
loop 等待事件直到 idle
C-->>S : 推送 session.event / session.status
S->>S : 过滤并收集 events/notifications
end
S-->>A : RunResult{sessionId, finalResponse, events, notifications}
```

图表来源
- [packages/sdk/client/src/api.ts:62-119](file://packages/sdk/client/src/api.ts#L62-L119)
- [packages/sdk/client/src/api.ts:146-195](file://packages/sdk/client/src/api.ts#L146-L195)
- [packages/sdk/client/src/client.ts:268-333](file://packages/sdk/client/src/client.ts#L268-L333)
- [packages/sdk/protocol/src/transport.ts:121-156](file://packages/sdk/protocol/src/transport.ts#L121-L156)

## 详细组件分析

### HarnessClient：低层客户端
- 构造与选项
  - 通过 HarnessClientOptions 指定 command/args/cwd/env 及各类超时
  - 内部维护子进程、传输、stderr 尾部、订阅集合、会话父子关系映射
- 生命周期
  - start()：惰性启动子进程，建立 JSON-RPC 传输，监听 stderr/exit/close，分发通知
  - initialize(params)：执行握手，校验 serverInfo
  - close()：幂等关闭，先请求 shutdown，再走 EOF→SIGTERM→SIGKILL 阶梯
- 会话与消息
  - prompt(sessionId, contentBlocks)：提交用户消息，返回 messageId
  - request(method, params?, timeoutMs?)：通用 JSON-RPC 请求，支持 per-call 超时与中止信号
- 事件订阅
  - subscribe(filter?)：按过滤器接收通知
  - subscribeSessionTree(sessionId)：限定到某会话及其后代（基于 subagent.started/finished 血缘）
- 错误与诊断
  - TransportClosedError：运行时不可用（退出、stdio 关闭或无法启动）
  - RequestTimeoutError：请求超时
  - SdkProtocolError：响应不符合文档化协议
  - closedError：聚合 spawn error、exit code、stderr 尾部用于诊断

```mermaid
classDiagram
class HarnessClient {
+constructor(options)
+start() void
+initialize(params) Promise~InitializeResult~
+prompt(sessionId, contentBlocks) Promise~string~
+request(method, params?, timeoutMs?) Promise~unknown~
+subscribe(filter?) NotificationSubscription
+subscribeSessionTree(sessionId) NotificationSubscription
+close() Promise~void~
}
class JsonRpcLineTransport {
+start() void
+request(method, params, signal?) Promise~unknown~
+notify(method, params?) void
+flush() Promise~void~
+close() void
}
class Dispose {
+disposeRuntimeProcess(child, graces) Promise~void~
}
HarnessClient --> JsonRpcLineTransport : "使用"
HarnessClient --> Dispose : "关闭时调用"
```

图表来源
- [packages/sdk/client/src/client.ts:184-458](file://packages/sdk/client/src/client.ts#L184-L458)
- [packages/sdk/protocol/src/transport.ts:62-173](file://packages/sdk/protocol/src/transport.ts#L62-L173)
- [packages/sdk/client/src/dispose.ts:82-99](file://packages/sdk/client/src/dispose.ts#L82-L99)

章节来源
- [packages/sdk/client/src/client.ts:184-458](file://packages/sdk/client/src/client.ts#L184-L458)

### DeepSeekHarness 与 HarnessSession：高层 API
- DeepSeekHarness
  - 构造：记录 launch 规格、cwd/provider/model/maxTokens
  - start()：惰性启动子进程并完成 initialize；失败则回收并重试新实例
  - session(id?)：创建会话句柄
  - run(input, options?)：委托给 session.run()
  - close()/Symbol.asyncDispose：终结性关闭
- HarnessSession
  - run(input, options?)：
    - 标准化输入为 ContentBlock[]
    - 发起 prompt，获取 messageId
    - 订阅会话树，收集 session.event/session.status
    - 等待 agent/inbox/spliced 回执确认入队，直至 session.status=idle
    - 返回 RunResult{sessionId, finalResponse, events, notifications}

```mermaid
flowchart TD
Start(["开始"]) --> Normalize["标准化输入为内容块"]
Normalize --> Prompt["调用 prompt(sessionId, blocks)"]
Prompt --> Subscribe["订阅会话树"]
Subscribe --> Loop{"收到回执?"}
Loop --> |否| WaitEvent["等待下一个通知"]
WaitEvent --> Loop
Loop --> |是| Collect["收集事件与通知"]
Collect --> CheckIdle{"状态为 idle?"}
CheckIdle --> |否| WaitEvent
CheckIdle --> |是| Return["返回 RunResult"]
```

图表来源
- [packages/sdk/client/src/api.ts:146-195](file://packages/sdk/client/src/api.ts#L146-L195)

章节来源
- [packages/sdk/client/src/api.ts:22-195](file://packages/sdk/client/src/api.ts#L22-L195)

### 协议与传输
- 协议类型
  - InitializeParams/InitializeResult：进程级握手参数与结果
  - SessionPromptParams/SessionPromptResult：会话提示与回执
  - 通知：session.event、session.status、subagent.started、subagent.finished
- 传输
  - JsonRpcLineTransport：行式 JSON-RPC，支持 request/notify/flush/close
  - 错误：JsonRpcResponseError 携带 code/message/data

```mermaid
erDiagram
InitializeParams {
string cwd
string provider
string model
number maxTokens
}
InitializeResult {
object serverInfo
}
SessionPromptParams {
string sessionId
array contentBlocks
}
SessionPromptResult {
string messageId
}
SessionEventNotification {
string sessionId
object event
}
SessionStatusNotification {
string sessionId
enum status
}
SubagentStartedNotification {
string parentSessionId
string childSessionId
}
SubagentFinishedNotification {
string provider
string agentId
string parentSessionId
string childSessionId
enum status
enum stopReason
array lastAssistantMessage
}
```

图表来源
- [packages/sdk/protocol/src/types.ts:16-98](file://packages/sdk/protocol/src/types.ts#L16-L98)

章节来源
- [packages/sdk/protocol/src/types.ts:16-98](file://packages/sdk/protocol/src/types.ts#L16-L98)
- [packages/sdk/protocol/src/transport.ts:18-28](file://packages/sdk/protocol/src/transport.ts#L18-L28)

### 事件与工具调用
- 事件模型
  - session.event：会话日志事件，包含 assistant/message 等
  - session.status：会话状态 idle/running
  - subagent.started/finished：子代理生命周期与结果
- 工具调用
  - 工具由运行时插件提供，客户端通过事件观察工具调用过程与结果
  - 可通过 onNotification 回调或 RunResult.notifications 获取原始通知序列

章节来源
- [packages/sdk/protocol/src/types.ts:50-98](file://packages/sdk/protocol/src/types.ts#L50-L98)
- [packages/sdk/client/src/api.ts:146-195](file://packages/sdk/client/src/api.ts#L146-L195)

## 依赖关系分析
- 模块耦合
  - api.ts 依赖 client.ts 暴露的高层 API
  - client.ts 依赖 protocol transport 与 dispose 模块
  - protocol 层独立于具体实现，仅定义传输与类型
- 外部依赖
  - node:child_process：子进程管理
  - @deepseek-ai/dsh-session：SessionEvent 类型
  - @deepseek-ai/dsh-subagent：SubagentStopReason 等

```mermaid
graph LR
API["api.ts"] --> Client["client.ts"]
Client --> Transport["protocol/transport.ts"]
Client --> Dispose["client/dispose.ts"]
Client --> Types["client/types.ts"]
ProtocolTypes["protocol/types.ts"] --> Client
SessionTypes["@deepseek-ai/dsh-session"] --> Client
SubagentTypes["@deepseek-ai/dsh-subagent"] --> ProtocolTypes
```

图表来源
- [packages/sdk/client/src/api.ts:1-20](file://packages/sdk/client/src/api.ts#L1-L20)
- [packages/sdk/client/src/client.ts:15-25](file://packages/sdk/client/src/client.ts#L15-L25)
- [packages/sdk/protocol/src/types.ts:11-14](file://packages/sdk/protocol/src/types.ts#L11-L14)

章节来源
- [packages/sdk/client/src/api.ts:1-20](file://packages/sdk/client/src/api.ts#L1-L20)
- [packages/sdk/client/src/client.ts:15-25](file://packages/sdk/client/src/client.ts#L15-L25)
- [packages/sdk/protocol/src/types.ts:11-14](file://packages/sdk/protocol/src/types.ts#L11-L14)

## 性能与超时配置
- 请求超时
  - HarnessClientOptions.requestTimeoutMs：全局默认
  - request(method, params, timeoutMs?)：可覆盖单次超时
  - 超时以 AbortController 放弃 pending 请求，避免累积状态
- 关闭超时
  - shutdownTimeoutMs：协议 shutdown 交换上限
  - disposeEofGraceMs：stdin EOF 后等待进程退出的宽限期
  - disposeGraceMs：SIGTERM/SIGKILL 后的确认窗口
- 调试技巧
  - 捕获 stderr 尾部（最多保留固定行数），便于定位运行时异常
  - 使用 subscribeSessionTree 收集完整事件序列，辅助定位问题
  - 对长时间运行的轮次，合理设置 requestTimeoutMs，避免阻塞

章节来源
- [packages/sdk/client/src/client.ts:301-333](file://packages/sdk/client/src/client.ts#L301-L333)
- [packages/sdk/client/src/client.ts:380-401](file://packages/sdk/client/src/client.ts#L380-L401)
- [packages/sdk/client/src/dispose.ts:82-99](file://packages/sdk/client/src/dispose.ts#L82-L99)

## 故障排查指南
- 常见错误
  - TransportClosedError：运行时已退出或无法启动，错误信息包含 exit code 与 stderr 尾部
  - RequestTimeoutError：请求超过配置的超时时间
  - SdkProtocolError：服务端响应不符合文档化协议
  - JsonRpcResponseError：服务端返回的错误帧，携带 code/message/data
- 排查步骤
  - 检查子进程是否成功启动（spawn 错误会立即传播）
  - 查看 stderr 尾部，定位运行时崩溃原�
  - 使用 subscribeSessionTree 收集事件，确认是否收到 session.status=idle
  - 调整 requestTimeoutMs/shutdownTimeoutMs/dispose* 参数，观察行为变化

章节来源
- [packages/sdk/client/src/client.ts:38-65](file://packages/sdk/client/src/client.ts#L38-L65)
- [packages/sdk/client/src/client.ts:436-457](file://packages/sdk/client/src/client.ts#L436-L457)
- [packages/sdk/protocol/src/transport.ts:18-28](file://packages/sdk/protocol/src/transport.ts#L18-L28)

## 结论
本 SDK 客户端通过分层设计将子进程生命周期、JSON-RPC 传输与会话语义解耦：底层 HarnessClient 提供稳定的连接与事件通道，高层 DeepSeekHarness/HarnessSession 封装常用工作流。借助完善的超时、重试（握手失败自动重试）、错误分类与资源清理策略，开发者可以可靠地驱动 Agent 完成文件操作、代码执行、子代理调用等任务。建议在生产环境中显式配置超时与关闭策略，并通过事件订阅进行可观测性与调试。

## 附录：类型定义与使用示例

### 类型定义速览
- HarnessClientOptions：command/args/cwd/env/requestTimeoutMs/shutdownTimeoutMs/disposeEofGraceMs/disposeGraceMs
- DeepSeekHarnessOptions：launch/cwd/provider/model/maxTokens
- RunResult：sessionId/finalResponse/events/notifications
- 协议类型：InitializeParams/InitializeResult/SessionPromptParams/SessionPromptResult/各种通知

章节来源
- [packages/sdk/client/src/types.ts:22-74](file://packages/sdk/client/src/types.ts#L22-L74)
- [packages/sdk/protocol/src/types.ts:16-98](file://packages/sdk/protocol/src/types.ts#L16-L98)

### 常见使用模式（示例路径）
- 基本会话与消息发送
  - 参考：[packages/sdk/client/README.zh.md:14-22](file://packages/sdk/client/README.zh.md#L14-L22)
- 文件操作（通过运行时工具）
  - 参考：[examples/headless-agent/tests/harness.ts:26-35](file://examples/headless-agent/tests/harness.ts#L26-L35)
- 代码执行（bash 工具链）
  - 参考：[examples/headless-agent/tests/harness.ts:66-69](file://examples/headless-agent/tests/harness.ts#L66-L69)
- 子代理调用与事件观察
  - 参考：[packages/sdk/client/src/api.ts:146-195](file://packages/sdk/client/src/api.ts#L146-L195)
  - 参考：[packages/sdk/protocol/src/types.ts:66-90](file://packages/sdk/protocol/src/types.ts#L66-L90)
- 超时与重试
  - 参考：[packages/sdk/client/src/client.ts:301-333](file://packages/sdk/client/src/client.ts#L301-L333)
  - 参考：[packages/sdk/client/src/api.ts:62-80](file://packages/sdk/client/src/api.ts#L62-L80)