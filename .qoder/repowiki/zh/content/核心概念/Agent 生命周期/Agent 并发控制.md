# Agent 并发控制

<cite>
**本文引用的文件**
- [agent.ts](file://packages/core/agent-loop/src/agent.ts)
- [tool-calls.ts](file://packages/core/agent-loop/src/tool-calls.ts)
- [runtime-context.ts](file://packages/core/agent-loop/src/runtime-context.ts)
- [scope.ts](file://packages/client/runtime/src/client/agents/scope.ts)
- [scope.spec.ts](file://packages/core/scope/tests/scope.spec.ts)
- [agent-initiator.spec.ts](file://packages/core/agent-loop/tests/agent-initiator.spec.ts)
- [agent.spec.ts](file://packages/core/agent-loop/tests/agent.spec.ts)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件聚焦于 Agent 的并发控制与异步处理机制，围绕以下关键点展开：
- 使用 AsyncLocalStorage（通过 Context 作用域）在 Agent 上下文中传播，确保异步操作继承发起者 Agent 上下文。
- InitiatorRun 嵌套链管理、activeInitiatorRuns 计数与递归边界处理。
- 注册表访问的线程安全与状态一致性维护。
- 取消机制：AbortSignal 的使用与取消传播。
- 工作队列与任务调度：高并发下的资源竞争与死锁预防。
- 并发调试与性能分析方法论。

## 项目结构
Agent 驱动位于 agent-loop 包中，核心由 ReactLoopAgent 实现，负责轮询式地推进“轮次（turn）”和“步骤（step）”，并通过 Inbox 接收外部输入、通过 LLM 流式调用生成响应、执行工具调用并回写会话日志。上下文与作用域通过 Context/Scope 体系注入，取消信号贯穿整个执行链路。

```mermaid
graph TB
A["ReactLoopAgent<br/>轮次/步骤驱动"] --> B["Inbox<br/>消息入队/唤醒"]
A --> C["LLM 适配器<br/>流式请求/重试"]
A --> D["工具执行器<br/>executeToolCalls"]
A --> E["会话日志<br/>append/deriveMessages"]
A --> F["Context/Scope<br/>作用域与事件分发"]
F --> G["AsyncLocalStorage<br/>上下文传播"]
```

图表来源
- [agent.ts:64-193](file://packages/core/agent-loop/src/agent.ts#L64-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-495](file://packages/core/agent-loop/src/agent.ts#L332-L495)

章节来源
- [agent.ts:64-193](file://packages/core/agent-loop/src/agent.ts#L64-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-495](file://packages/core/agent-loop/src/agent.ts#L332-L495)

## 核心组件
- ReactLoopAgent：单实例驱动一个会话的生命周期，维护 phase（idle/maintenance/running）、AbortController、轮次/步骤计数器，以及活动完成 Promise。
- Inbox：消息入队、按目标（next-turn/next-step）取用、唤醒驱动。
- LLM 适配层：构建请求、流式读取、错误处理与重试策略。
- 工具执行器：并行或串行执行工具调用，必要时将上下文回写 next-step。
- Context/Scope：提供事件分发、系统提示组装、运行时上下文投影，以及通过 AsyncLocalStorage 实现的上下文传播。

章节来源
- [agent.ts:64-193](file://packages/core/agent-loop/src/agent.ts#L64-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-495](file://packages/core/agent-loop/src/agent.ts#L332-L495)

## 架构总览
下图展示一次用户输入到最终回复的完整流程，包括上下文传播、取消信号传递、工具调用与结果回写。

```mermaid
sequenceDiagram
participant U as "调用方"
participant A as "ReactLoopAgent"
participant I as "Inbox"
participant S as "Session"
participant L as "LLM 适配器"
participant T as "工具执行器"
participant C as "Context/Scope"
U->>A : send/followup/steer/inject
A->>I : splice(目标, 插入位置, 消息)
A->>A : wakeDriver()
A->>C : withInitiator(agent)
A->>A : kick() -> turn() -> preStep()
A->>S : append("turn/start")
A->>A : step()
A->>L : stream(request + signal)
L-->>A : chunk* (持续追加到 Session)
A->>T : executeToolCalls(toolCalls, signal)
T-->>A : concluded?
A->>S : append("assistant/message", usage)
A->>S : append("step/end", "turn/end")
A-->>U : whenIdle()/status
```

图表来源
- [agent.ts:113-193](file://packages/core/agent-loop/src/agent.ts#L113-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-495](file://packages/core/agent-loop/src/agent.ts#L332-L495)

## 详细组件分析

### 上下文传播与 AsyncLocalStorage
- 作用域入口：wakeDriver 中使用 loopCtx.agents.withInitiator(this, () => this.kick()) 将当前 Agent 作为 Initiator 推入作用域栈，确保后续所有异步分支（LLM 调用、工具执行、事件回调等）都能通过 Context 获取到发起者 Agent。
- 上下文装配：preStep 中通过 loopCtx.systemPrompt.assemble(assembleContextFor(this, signal)) 组装系统提示与上下文，并在决策阶段合并为消息序列。
- 运行时上下文投影：RuntimeContextProjection 基于 session 与 ctx 派生运行时视图，供插件与工具消费。

```mermaid
flowchart TD
Start(["进入 withInitiator"]) --> Push["推入 Initiator 栈"]
Push --> Exec["执行 kick/turn/step"]
Exec --> UseCtx["assembleContextFor / RuntimeContextProjection"]
UseCtx --> AsyncOps["LLM 流/工具调用/事件回调"]
AsyncOps --> Pop["退出时弹出 Initiator"]
Pop --> End(["恢复外层上下文"])
```

图表来源
- [agent.ts:172-193](file://packages/core/agent-loop/src/agent.ts#L172-L193)
- [agent.ts:225-243](file://packages/core/agent-loop/src/agent.ts#L225-L243)
- [runtime-context.ts](file://packages/core/agent-loop/src/runtime-context.ts)

章节来源
- [agent.ts:172-193](file://packages/core/agent-loop/src/agent.ts#L172-L193)
- [agent.ts:225-243](file://packages/core/agent-loop/src/agent.ts#L225-L243)
- [runtime-context.ts](file://packages/core/agent-loop/src/runtime-context.ts)

### InitiatorRun 嵌套链与 activeInitiatorRuns 计数
- 嵌套链：withInitiator 以栈形式维护 Initiator 链，支持子 Agent/子作用域嵌套调用，保证每个异步分支都能正确回溯到其直接发起者。
- 计数与边界：activeInitiatorRuns 用于统计当前活跃 Initiator 数量，防止重复启动或泄漏；当计数归零时清理资源。
- 递归边界：在 preStep/step 等关键路径上检查 AbortSignal 与 phase，避免在已中止或空闲状态下继续推进。

```mermaid
classDiagram
class Scope {
+withInitiator(agent, fn)
+ctx
}
class ReactLoopAgent {
-phase
-activityDone
+send()
+followup()
+steer()
+inject()
+cancel()
+runMaintenance()
+whenIdle()
-kick()
-turn()
-step()
}
Scope --> ReactLoopAgent : "withInitiator 包装执行"
```

图表来源
- [scope.ts](file://packages/client/runtime/src/client/agents/scope.ts)
- [agent.ts:172-193](file://packages/core/agent-loop/src/agent.ts#L172-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)

章节来源
- [scope.ts](file://packages/client/runtime/src/client/agents/scope.ts)
- [agent.ts:172-193](file://packages/core/agent-loop/src/agent.ts#L172-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)

### 并发安全与状态一致性
- 单驱动模型：ReactLoopAgent 在同一时刻仅有一个 running 驱动（kick），通过 activityDone 串联多次唤醒，避免重入导致的竞态。
- 阶段机：phase 严格区分 idle/maintenance/running，任何非法转换都会抛出错误，保障状态一致性。
- 注册表访问：事件分发与系统提示组装通过 Context 提供的受控接口进行，避免全局可变状态被并发修改。
- 会话写入：所有对 Session 的写入均通过 append，且附带 surfaceOp/sourceEventSeqs 等元数据，便于回放与一致性校验。

```mermaid
stateDiagram-v2
[*] --> Idle
Idle --> Running : "wakeDriver()"
Running --> Idle : "turn 结束/无待处理消息"
Idle --> Maintenance : "runMaintenance()"
Maintenance --> Idle : "job 完成"
```

图表来源
- [agent.ts:64-193](file://packages/core/agent-loop/src/agent.ts#L64-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)

章节来源
- [agent.ts:64-193](file://packages/core/agent-loop/src/agent.ts#L64-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)

### 取消机制与 AbortSignal 传播
- 统一信号源：每个 running 阶段持有独立的 AbortController，cancel 会清空收件箱并触发 abort。
- 全链路传播：preStep、step、LLM 流迭代、工具执行前均调用 signal.throwIfAborted()，确保取消立即生效。
- 粘性终止：max-tokens 标记在 turn 内保持，即使后续步骤正常完成也不降级 turn 结果。
- 维护模式隔离：maintenance 模式下 cancel 不影响 inbox 保留策略（keepInbox）。

```mermaid
sequenceDiagram
participant U as "调用方"
participant A as "ReactLoopAgent"
participant L as "LLM 流"
participant T as "工具执行器"
U->>A : cancel(cause)
A->>A : phase.abort.abort(cause)
A->>L : throwIfAborted()
L-->>A : 停止消费
A->>T : throwIfAborted()
T-->>A : 中断执行
A-->>U : 返回/抛出取消原�
```

图表来源
- [agent.ts:134-140](file://packages/core/agent-loop/src/agent.ts#L134-L140)
- [agent.ts:225-243](file://packages/core/agent-loop/src/agent.ts#L225-L243)
- [agent.ts:332-400](file://packages/core/agent-loop/src/agent.ts#L332-L400)

章节来源
- [agent.ts:134-140](file://packages/core/agent-loop/src/agent.ts#L134-L140)
- [agent.ts:225-243](file://packages/core/agent-loop/src/agent.ts#L225-L243)
- [agent.ts:332-400](file://packages/core/agent-loop/src/agent.ts#L332-L400)

### 工作队列与任务调度
- 入队与唤醒：send/followup/steer/inject 将消息插入 Inbox 指定目标（next-turn/next-step），wakeup=true 时触发 wakeDriver。
- 串行推进：turn 循环内依次处理 step，直到满足终止条件（空消息、blocked、max-tokens、aborted）。
- 防死锁设计：
  - 每次 turn 结束后若仍有待处理消息，创建新的 AbortController 并重置 step，避免旧控制器导致的状态不一致。
  - maintenance 与 aborted 活动中的唤醒会被 latch 到 wakeRequested，收敛后再 replay，避免重复唤醒。
- 工具上下文回写：工具执行后可将上下文追加到 next-step，形成“工具输出→下一步输入”的闭环。

```mermaid
flowchart TD
Q(["Inbox 有消息?"]) --> |是| P["claim(target, turn)"]
P --> D{"决策: reject?"}
D --> |是| B["turn 结束(blocked)"]
D --> |否| S["step() 执行"]
S --> R{"是否 max-tokens?"}
R --> |是| M["记录粘性终止"]
R --> |否| T{"是否有工具调用?"}
T --> |是| X["executeToolCalls(signal)"]
X --> C{"concluded?"}
C --> |否| N["将上下文追加到 next-step"]
N --> P
C --> |是| E["step 完成"]
T --> |否| E
E --> J{"inbox.nextStep 为空?"}
J --> |是| END["turn 结束"]
J --> |否| P
```

图表来源
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-400](file://packages/core/agent-loop/src/agent.ts#L332-L400)
- [tool-calls.ts](file://packages/core/agent-loop/src/tool-calls.ts)

章节来源
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-400](file://packages/core/agent-loop/src/agent.ts#L332-L400)
- [tool-calls.ts](file://packages/core/agent-loop/src/tool-calls.ts)

### 并发调试与性能分析
- 断点与日志：在 preStep、step、LLM 流迭代、工具执行前后设置断点，观察 turn/step 计数与 signal.aborted 状态。
- 指标采集：利用 session.append 的事件序列号追踪耗时与吞吐，结合 request/header 变更事件定位配置漂移。
- 常见并发问题定位：
  - 重复唤醒：检查 wakeRequested 与 activityDone 是否被正确复用。
  - 取消未生效：确认各异步分支是否调用 signal.throwIfAborted()。
  - 死锁：检查 turn 结束时是否重置 AbortController 与 step，避免旧控制器残留。
- 测试辅助：使用 agent-initiator 与 scope 相关测试用例验证作用域与取消行为。

章节来源
- [agent.spec.ts](file://packages/core/agent-loop/tests/agent.spec.ts)
- [agent-initiator.spec.ts](file://packages/core/agent-loop/tests/agent-initiator.spec.ts)
- [scope.spec.ts](file://packages/core/scope/tests/scope.spec.ts)

## 依赖关系分析
- ReactLoopAgent 依赖：
  - Inbox：消息队列与唤醒。
  - Context/Scope：事件分发、系统提示组装、作用域传播。
  - LLM 适配器：请求构建、流式读取、错误与重试。
  - Session：持久化事件与消息。
  - 工具执行器：工具调用与上下文回写。
- 作用域与 Initiator：
  - withInitiator 将 Agent 推入作用域栈，确保异步分支可访问发起者。
  - activeInitiatorRuns 计数确保资源生命周期正确。

```mermaid
graph LR
A["ReactLoopAgent"] --> B["Inbox"]
A --> C["Context/Scope"]
A --> D["LLM 适配器"]
A --> E["Session"]
A --> F["工具执行器"]
C --> G["AsyncLocalStorage"]
```

图表来源
- [agent.ts:64-193](file://packages/core/agent-loop/src/agent.ts#L64-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-495](file://packages/core/agent-loop/src/agent.ts#L332-L495)

章节来源
- [agent.ts:64-193](file://packages/core/agent-loop/src/agent.ts#L64-L193)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-495](file://packages/core/agent-loop/src/agent.ts#L332-L495)

## 性能考量
- 热路径优化：dispatch 在构造时融合，避免热点路径分配。
- 流式处理：LLM 响应分块追加，减少内存峰值。
- 粘性终止：max-tokens 标记避免不必要的后续步骤，降低无效计算。
- 请求头缓存：首次登录后复用 header，减少重复序列化与比较。
- 工具调用批处理：尽可能在一次 step 中完成多个工具调用，减少往返。

[本节为通用指导，不直接分析具体文件]

## 故障排查指南
- 症状：取消后仍继续执行
  - 检查：各异步分支是否调用 signal.throwIfAborted()。
  - 参考：step 与工具执行前的信号检查。
- 症状：多次唤醒导致重复轮次
  - 检查：wakeRequested 与 activityDone 是否正确复用；maintenance/aborted 场景下是否 latch。
- 症状：上下文丢失
  - 检查：是否在 withInitiator 包裹的函数内执行；preStep 是否正确组装上下文。
- 症状：死锁或卡住
  - 检查：turn 结束时是否重置 AbortController 与 step；inbox 是否仍有 pending 消息。

章节来源
- [agent.ts:134-140](file://packages/core/agent-loop/src/agent.ts#L134-L140)
- [agent.ts:225-330](file://packages/core/agent-loop/src/agent.ts#L225-L330)
- [agent.ts:332-400](file://packages/core/agent-loop/src/agent.ts#L332-L400)

## 结论
该 Agent 实现通过单驱动模型、严格的阶段机、统一的取消信号与作用域传播，实现了高并发下的安全与一致性。Inbox 与 turn/step 调度确保了任务有序推进，while 工具执行与上下文回写形成了灵活的闭环。配合完善的测试与调试手段，可在复杂场景中稳定运行。

[本节为总结性内容，不直接分析具体文件]

## 附录
- 术语
  - Turn：一轮对话，包含若干 Step。
  - Step：一次 LLM 调用及可能的工具执行。
  - InboxTarget：消息投递目标（next-turn/next-step）。
  - AbortSignal：取消信号，贯穿执行链路。
- 最佳实践
  - 始终在 withInitiator 中执行可能产生异步分支的操作。
  - 在关键异步点检查 AbortSignal。
  - 避免在 maintenance 或已中止活动中发送 wakeup。
  - 使用 session.append 的 sourceEventSeqs 关联事件，便于回放与诊断。

[本节为补充说明，不直接分析具体文件]