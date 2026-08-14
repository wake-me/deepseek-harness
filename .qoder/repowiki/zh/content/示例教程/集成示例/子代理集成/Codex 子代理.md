# Codex 子代理

<cite>
**本文引用的文件**
- [index.ts](file://packages/subagent/subagent-codex/src/index.ts)
- [run.ts](file://packages/subagent/subagent-codex/src/run.ts)
- [wire.ts](file://packages/subagent/subagent-codex/src/wire.ts)
- [invariant.ts](file://packages/subagent/subagent-codex/src/invariant.ts)
- [package.json](file://packages/subagent/subagent-codex/package.json)
- [product-subagent-codex.cordis.yml](file://examples/acp-agent/product-subagent-codex.cordis.yml)
- [subagent-codex.spec.ts](file://packages/subagent/subagent-codex/tests/subagent-codex.spec.ts)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能与资源管理](#性能与资源管理)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)
10. [附录：配置与使用示例](#附录：配置与使用示例)

## 简介
本文件面向“Codex 子代理”的架构设计与实现原理，聚焦以下目标：
- 解释如何通过子代理机制启动并管理外部 Codex app-server 进程，完成一次性任务执行。
- 说明连接参数、认证与环境注入方式（通过环境变量与父会话工作目录）。
- 描述执行策略：生命周期、中断、终止、错误收敛与输出选择。
- 给出在 Cordis 装配中启用 Codex 子代理的配置示例与调用流程。
- 解释代码理解能力、文件操作机制与智能提示功能的边界（由外部 Codex 提供，本实现仅做协议适配与安全约束）。
- 提供性能监控与资源管理的实践建议，以及与 OpenAI Codex API（app-server 协议）集成的注意事项和排错方法。

## 项目结构
Codex 子代理位于 packages/subagent/subagent-codex，采用“提供者 + 运行器 + 协议适配器 + 不变量注册”的分层组织：
- index.ts：插件入口，注册名为 codex 的子代理提供者，负责配置校验与请求转发。
- run.ts：一次运行的生命周期编排，包括进程启动、初始化、线程创建、任务提交、结果收集与清理。
- wire.ts：与 Codex app-server 的 JSON-RPC 协议适配，处理握手、线程/回合、通知、审批请求与最终答案选择。
- invariant.ts：包级不变量注册占位，声明该包对宿主不变量服务的存在性要求。
- package.json：暴露导出、声明 peerDependencies 与 devDependencies（含 @openai/codex 版本信息用于文档参考）。
- examples/acp-agent/product-subagent-codex.cordis.yml：展示如何在 ACP 组合中插入 Codex 子代理及其工具包装。

```mermaid
graph TB
subgraph "Cordis 上下文"
Ctx["Context"]
Subagents["Subagent 服务"]
Subprocess["Subprocess 服务"]
end
subgraph "Codex 子代理"
Provider["CodexProvider<br/>注册提供者 'codex'"]
Runner["startCodexRun<br/>生命周期编排"]
Wire["CodexAppServerWire<br/>JSON-RPC 协议适配"]
end
subgraph "外部进程"
AppServer["codex app-server --stdio"]
end
Ctx --> Subagents
Ctx --> Subprocess
Provider --> Subagents
Provider --> Runner
Runner --> Subprocess
Runner --> Wire
Wire < --> AppServer
```

图表来源
- [index.ts:47-101](file://packages/subagent/subagent-codex/src/index.ts#L47-L101)
- [run.ts:116-200](file://packages/subagent/subagent-codex/src/run.ts#L116-L200)
- [wire.ts:83-235](file://packages/subagent/subagent-codex/src/wire.ts#L83-L235)

章节来源
- [index.ts:1-102](file://packages/subagent/subagent-codex/src/index.ts#L1-L102)
- [run.ts:1-201](file://packages/subagent/subagent-codex/src/run.ts#L1-L201)
- [wire.ts:1-375](file://packages/subagent/subagent-codex/src/wire.ts#L1-L375)
- [invariant.ts:1-31](file://packages/subagent/subagent-codex/src/invariant.ts#L1-L31)
- [package.json:1-63](file://packages/subagent/subagent-codex/package.json#L1-L63)
- [product-subagent-codex.cordis.yml:1-19](file://examples/acp-agent/product-subagent-codex.cordis.yml#L1-L19)

## 核心组件
- 提供者（CodexProvider）
  - 名称：codex
  - 能力：无启动能力（NO_START_CAPABILITIES），不继承父上下文
  - 职责：校验父会话工作目录，组装运行规格（cwd、env、disposeGraceMs、spawn、onError），委托给 startCodexRun
- 运行器（startCodexRun）
  - 任务校验：仅接受非空文本块序列
  - 进程启动：跨平台 argv 解析（Windows 走 cmd.exe 边界）
  - 初始化：initialize/initialized 握手；创建临时线程 thread/start
  - 执行：turn/start 提交文本任务，等待 turn/completed
  - 清理：关闭协议、终止进程树、等待退出
- 协议适配（CodexAppServerWire）
  - 固定最小协议集：initialize、thread/start、turn/start、turn/started、item/completed、turn/completed、turn/interrupt
  - 审批请求自动应答：命令执行、文件变更、权限、用户输入、MCP 询问等
  - 输出选择：优先 final_answer，否则回退到 nullable-phase 的最后一条
  - 错误映射：contextWindowExceeded 映射为 max-tokens
- 不变量（invariant）
  - 声明包名与注入项，当前为空安装器，交由宿主服务管理生命周期与进程树所有权

章节来源
- [index.ts:26-101](file://packages/subagent/subagent-codex/src/index.ts#L26-L101)
- [run.ts:24-83,116-200:24-83](file://packages/subagent/subagent-codex/src/run.ts#L24-L83)
- [wire.ts:83-235,294-373:83-235](file://packages/subagent/subagent-codex/src/wire.ts#L83-L235)
- [invariant.ts:10-29](file://packages/subagent/subagent-codex/src/invariant.ts#L10-L29)

## 架构总览
下图展示了从父会话发起一次 Codex 子代理调用的端到端时序：

```mermaid
sequenceDiagram
participant Parent as "父会话"
participant Provider as "CodexProvider"
participant Runner as "startCodexRun"
participant Proc as "Subprocess 服务"
participant Wire as "CodexAppServerWire"
participant Server as "codex app-server"
Parent->>Provider : 启动子代理(提示词, 信号)
Provider->>Runner : 组装运行规格并调用
Runner->>Proc : spawn(argv, cwd, env, stdio)
Proc-->>Runner : 返回子进程句柄
Runner->>Wire : 构造并启动传输
Runner->>Wire : initialize(客户端信息)
Wire->>Server : JSON-RPC initialize
Server-->>Wire : 响应
Wire-->>Runner : initialized 通知
Runner->>Wire : startThread(cwd, ephemeral=true)
Wire->>Server : thread/start
Server-->>Wire : {thread.id}
Runner->>Wire : runTurn(文本列表)
Wire->>Server : turn/start
Server-->>Wire : {turn.id}
Note over Wire,Server : item/completed 推送消息
Server-->>Wire : turn/completed
Wire-->>Runner : 结果{output, stopReason}
Runner-->>Parent : 返回 SubagentRun
```

图表来源
- [run.ts:116-200](file://packages/subagent/subagent-codex/src/run.ts#L116-L200)
- [wire.ts:132-204](file://packages/subagent/subagent-codex/src/wire.ts#L132-L204)

## 详细组件分析

### 提供者与配置（CodexProvider）
- 配置项
  - env：覆盖子进程环境（在共享凭据清洗后的父环境之上叠加）
  - disposeGraceMs：进程树优雅终止宽限（毫秒），需为正有限数且不超过最大定时器延迟
- 关键行为
  - 强制要求父会话携带工作目录（cwd），否则拒绝启动
  - 将 spawn 委托给宿主的 subprocess 服务，保证统一的生命周期管理
  - onError 回调用于记录子运行失败诊断信息

```mermaid
flowchart TD
Start(["开始"]) --> CheckCwd{"父会话有 cwd ?"}
CheckCwd --> |否| ErrCwd["抛出错误：缺少工作目录"]
CheckCwd --> |是| BuildSpec["构建运行规格<br/>cwd/env/disposeGraceMs/spawn/onError"]
BuildSpec --> CallRun["调用 startCodexRun"]
CallRun --> End(["返回 SubagentRun"])
```

图表来源
- [index.ts:57-80](file://packages/subagent/subagent-codex/src/index.ts#L57-L80)

章节来源
- [index.ts:29-101](file://packages/subagent/subagent-codex/src/index.ts#L29-L101)

### 运行生命周期（startCodexRun）
- 任务校验：仅允许非空文本块，空或包含非文本类型会直接拒绝
- 进程启动：根据平台生成固定 argv，避免将任务文本带入 shell 边界
- 初始化阶段：先 initialize，再创建 ephemeral 线程，确保后续消息可关联
- 执行阶段：提交 turn/start，监听 item/completed 与 turn/completed
- 清理阶段：关闭协议、结束 stdin、终止进程树、等待退出
- 取消与中断：支持本地取消与远端中断（turn/interrupt），并妥善处理竞态

```mermaid
flowchart TD
S(["进入 startCodexRun"]) --> V["校验任务文本"]
V --> Spawn["spawn 子进程"]
Spawn --> Init["initialize + startThread"]
Init --> Run["runTurn 提交任务"]
Run --> Wait{"收到 turn/completed ?"}
Wait --> |是| Collect["collectOutput 选择最终答案"]
Collect --> Done(["返回结果"])
Wait --> |否| Fail["进程提前退出或错误"]
Fail --> Cleanup["close/terminate/waitForExit"]
Cleanup --> Done
```

图表来源
- [run.ts:63-83,116-200:63-83](file://packages/subagent/subagent-codex/src/run.ts#L63-L83)
- [run.ts:116-200](file://packages/subagent/subagent-codex/src/run.ts#L116-L200)

章节来源
- [run.ts:24-200](file://packages/subagent/subagent-codex/src/run.ts#L24-L200)

### 协议适配（CodexAppServerWire）
- 握手与线程
  - initialize：上报客户端信息与能力
  - thread/start：创建临时线程，保存 threadId
- 回合执行
  - turn/start：提交文本输入，保存 turnId
  - 处理 item/completed：过滤 commentary，保留 final_answer 或最后一条 nullable-phase
  - 处理 turn/completed：状态校验，异常映射（contextWindowExceeded -> max-tokens）
- 审批请求自动应答
  - 命令执行、文件变更、权限、用户输入、MCP 询问等，默认拒绝或取消
- 中断与关闭
  - interrupt：向活跃回合发送 turn/interrupt
  - close：断开传输，释放事件监听

```mermaid
classDiagram
class CodexAppServerWire {
-transport
-fatal
-threadId
-turnId
-pendingTurnId
-turnCompleted
-earlyTurnNotifications
-lastFinalAnswer
-lastUnphasedAnswer
-closed
+start()
+initialize(signal)
+startThread(cwd, signal)
+runTurn(texts, signal)
+interrupt()
+collectOutput()
+close()
-guarded(pending, signal)
-fail(error)
-handleServerRequest(method, params)
-handleNotification(method, params)
}
```

图表来源
- [wire.ts:83-235](file://packages/subagent/subagent-codex/src/wire.ts#L83-L235)
- [wire.ts:294-373](file://packages/subagent/subagent-codex/src/wire.ts#L294-L373)

章节来源
- [wire.ts:1-375](file://packages/subagent/subagent-codex/src/wire.ts#L1-L375)

### 不变量与插件装配
- 包级不变量：声明包名与注入项，当前为空安装器，表示该包自身不附加运行时不变量
- 插件装配：通过 apply(ctx, config) 注册提供者；测试验证了 HMR 卸载时提供者会被移除

章节来源
- [invariant.ts:10-29](file://packages/subagent/subagent-codex/src/invariant.ts#L10-L29)
- [subagent-codex.spec.ts:288-315](file://packages/subagent/subagent-codex/tests/subagent-codex.spec.ts#L288-L315)

## 依赖关系分析
- 内部依赖
  - 子代理框架：@deepseek-ai/dsh-subagent（提供者接口、结果封装、生命周期）
  - 子进程：@deepseek-ai/dsh-subprocess（spawn、句柄、终止）
  - 会话：@deepseek-ai/dsh-session（会话 ID）
  - LLM 内容：@deepseek-ai/dsh-llm（ContentBlock）
  - 超时：@deepseek-ai/dsh-timeout（最大定时器延迟常量）
  - 协议：@deepseek-ai/dsh-sdk-protocol（JSON-RPC 行式传输）
  - 配置校验：@deepseek-ai/schemastery（Zod 风格 schema）
- 外部依赖
  - @openai/codex 0.147.0：作为开发依赖，表明协议基于该版本的 app-server

```mermaid
graph LR
Index["index.ts"] --> Run["run.ts"]
Run --> Wire["wire.ts"]
Index --> Invariant["invariant.ts"]
Run --> Dep1["@deepseek-ai/dsh-subagent"]
Run --> Dep2["@deepseek-ai/dsh-subprocess"]
Run --> Dep3["@deepseek-ai/dsh-session"]
Run --> Dep4["@deepseek-ai/dsh-llm"]
Run --> Dep5["@deepseek-ai/dsh-timeout"]
Wire --> Dep6["@deepseek-ai/dsh-sdk-protocol"]
Index --> Dep7["@deepseek-ai/schemastery"]
```

图表来源
- [package.json:34-60](file://packages/subagent/subagent-codex/package.json#L34-L60)
- [index.ts:9-24](file://packages/subagent/subagent-codex/src/index.ts#L9-L24)
- [run.ts:10-22](file://packages/subagent/subagent-codex/src/run.ts#L10-L22)
- [wire.ts:10-13](file://packages/subagent/subagent-codex/src/wire.ts#L10-L13)

章节来源
- [package.json:1-63](file://packages/subagent/subagent-codex/package.json#L1-L63)

## 性能与资源管理
- 进程生命周期
  - 一次性运行：每次启动新的 app-server 进程，隔离性强，适合短任务
  - 优雅终止：通过 disposeGraceMs 控制进程树终止宽限，避免孤儿进程
- 内存与 I/O
  - 协议流式处理：逐行 JSON-RPC，避免大对象驻留
  - 输出选择：仅保留最终答案，减少中间态数据
- 并发与中断
  - 支持本地取消与远端中断，防止长时间阻塞
  - 严格线程/回合关联，避免跨回合消息污染
- 监控建议
  - 利用 onError 回调记录失败原因与停止原�
  - 结合宿主日志与指标系统，统计启动耗时、运行时长、错误率
  - 关注 contextWindowExceeded 导致的 max-tokens 场景，必要时拆分任务

[本节为通用指导，无需特定文件引用]

## 故障排除指南
- 常见错误与定位
  - 缺少工作目录：父会话未提供 cwd，导致无法派生子进程
  - 任务非法：空任务或非文本块被拒绝
  - 协议错误：initialize/thread/start/turn/start 响应形状不符
  - 终端状态异常：turn/completed 状态非 completed/failed/interrupted
  - 无最终答案：completed 但未产出 final_answer 或可回退答案
  - 上下文窗口超限：映射为 max-tokens，需缩减输入或分步执行
- 调试步骤
  - 检查父会话是否设置了工作目录
  - 确认子进程已启动并能接收 JSON-RPC 帧
  - 观察 item/completed 与 turn/completed 的顺序与内容
  - 使用测试中的模拟子进程与协议对端进行断点验证
- 相关测试用例参考
  - 命令行参数与平台差异
  - 任务校验与空值拒绝
  - 握手、线程与回合的响应校验
  - 审批请求自动应答与未知请求拒绝
  - 中断与早期终止的竞态处理

章节来源
- [subagent-codex.spec.ts:262-315](file://packages/subagent/subagent-codex/tests/subagent-codex.spec.ts#L262-L315)
- [subagent-codex.spec.ts:363-551](file://packages/subagent/subagent-codex/tests/subagent-codex.spec.ts#L363-L551)
- [subagent-codex.spec.ts:553-790](file://packages/subagent/subagent-codex/tests/subagent-codex.spec.ts#L553-L790)

## 结论
Codex 子代理以“提供者 + 运行器 + 协议适配”的清晰分层，安全地桥接外部 Codex app-server。其设计强调：
- 严格的输入与协议校验，确保健壮性与可观测性
- 明确的生命周期管理与资源回收，避免泄漏
- 稳定的输出选择与错误映射，便于上层消费
- 通过环境变量与父会话工作目录实现配置与上下文传递
对于需要代码理解、文件操作与智能提示的场景，实际能力由外部 Codex 提供；本实现专注于可靠集成与治理。

[本节为总结性内容，无需特定文件引用]

## 附录：配置与使用示例
- 在 Cordis 中装配 Codex 子代理
  - 通过 include 插件插入 provider 与 tool 包装，指定 provider 为 codex，工具名为 subagent_codex
  - 可设置 enableRunInBackground 与 maxDepth 等策略开关
- 启动与传递上下文
  - 父会话需提供工作目录（cwd），子进程将在该目录下执行
  - 可通过 env 注入密钥与运行时变量（经共享凭据清洗后叠加）
- 执行与生命周期管理
  - 调用子代理即触发一次性运行：启动进程、初始化、创建线程、提交任务、等待完成
  - 支持取消与中断；完成后自动清理进程树
- 与 OpenAI Codex API 的集成细节
  - 协议基于 app-server 的 JSON-RPC 行式传输，版本参考 @openai/codex 0.147.0
  - 注意上下文窗口限制，遇到 contextWindowExceeded 会映射为 max-tokens
- 实用建议
  - 合理拆分任务以避免上下文溢出
  - 使用 onError 记录诊断信息，配合宿主监控
  - 在 CI/CD 中通过本地子进程模拟进行契约测试

章节来源
- [product-subagent-codex.cordis.yml:1-19](file://examples/acp-agent/product-subagent-codex.cordis.yml#L1-L19)
- [index.ts:29-101](file://packages/subagent/subagent-codex/src/index.ts#L29-L101)
- [run.ts:24-83,116-200:24-83](file://packages/subagent/subagent-codex/src/run.ts#L24-L83)
- [wire.ts:132-204](file://packages/subagent/subagent-codex/src/wire.ts#L132-L204)
- [package.json:59-60](file://packages/subagent/subagent-codex/package.json#L59-L60)