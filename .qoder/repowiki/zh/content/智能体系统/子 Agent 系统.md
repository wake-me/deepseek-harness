# 子 Agent 系统

<cite>
**本文引用的文件**
- [packages/subagent/subagent/src/index.ts](file://packages/subagent/subagent/src/index.ts)
- [packages/subagent/subagent/src/types.ts](file://packages/subagent/subagent/src/types.ts)
- [packages/subagent/subagent/src/continuation.ts](file://packages/subagent/subagent/src/continuation.ts)
- [packages/subagent/subagent/src/descriptor.ts](file://packages/subagent/subagent/src/descriptor.ts)
- [packages/subagent/subagent/src/child-agent.ts](file://packages/subagent/subagent/src/child-agent.ts)
- [packages/subagent/subagent-spawn-in-process/src/index.ts](file://packages/subagent/subagent-spawn-in-process/src/index.ts)
- [packages/subagent/tool-subagent/src/index.ts](file://packages/subagent/tool-subagent/src/index.ts)
- [docs/subsystems/subagent.md](file://docs/subsystems/subagent.md)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件系统性地介绍子 Agent 系统的架构与使用方法，重点说明主 Agent 如何创建与管理子 Agent，包括：
- 子 Agent 的继承机制、配置传递与作用域隔离
- 子 Agent 的生命周期与父 Agent 的关系
- 子 Agent 间的通信协议（消息投递、中断、报告）
- 权限控制、资源限制与安全隔离
- 常见模式示例：并行执行、串行调用、嵌套子 Agent
- 错误传播与结果聚合策略
- 性能优化建议与调试技巧

## 项目结构
子 Agent 能力由一组包组成，围绕“命名提供者注册 + 一次性/可延续子 Agent 生命周期管理”展开。关键目录与职责如下：
- subagent：服务定义、类型、运行时、可延续管理器、描述符、子代理组合等
- subagent-spawn-in-process / fork-in-process：进程内一次性/从父历史派生的子代理实现
- subagent-acp / codex / claude-code / dsh-sdk：跨进程或外部产品子代理实现
- tool-subagent：面向模型的委托工具（前台等待/后台任务/可延续对话）
- tool-subagent-control / report：子代理控制与子到父的报告通道

```mermaid
graph TB
A["tool-subagent<br/>模型侧委托工具"] --> B["SubagentRuntime<br/>ctx.subagents"]
B --> C["SubagentContinuationManager<br/>可延续子代理编排"]
B --> D["Provider 注册表<br/>spawn/fork/acp/codex/..."]
C --> E["Activation 生命周期<br/>冷启动/唤醒/回收"]
D --> F["In-process Driver<br/>一次性运行驱动"]
D --> G["Out-of-process 适配器<br/>ACP/Codex/Claude/Dash"]
B --> H["持久化枚举<br/>listChildren/listDescendants"]
```

图表来源
- [packages/subagent/subagent/src/index.ts:171-497](file://packages/subagent/subagent/src/index.ts#L171-L497)
- [packages/subagent/subagent/src/continuation.ts:349-800](file://packages/subagent/subagent/src/continuation.ts#L349-L800)
- [packages/subagent/subagent-spawn-in-process/src/index.ts:41-64](file://packages/subagent/subagent-spawn-in-process/src/index.ts#L41-L64)
- [packages/subagent/tool-subagent/src/index.ts:267-468](file://packages/subagent/tool-subagent/src/index.ts#L267-L468)

章节来源
- [docs/subsystems/subagent.md:1-735](file://docs/subsystems/subagent.md#L1-L735)
- [packages/subagent/subagent/src/index.ts:1-500](file://packages/subagent/subagent/src/index.ts#L1-L500)

## 核心组件
- SubagentRuntime（服务入口）
  - 提供 start、startContinuable、followup、interrupt、reportFrom、listChildren、listDescendants、registerProvider 等能力
  - 负责能力校验、描述符快照、生命周期事件发射、可延续管理器装配
- SubagentContinuationManager（可延续子代理编排）
  - 维护稳定 childId、Activation 驻留期、冷恢复、父子所有权图、子优先释放、结算通知
  - 通过 Agent inbox 作为唯一队列，保证顺序与一致性
- Provider（子代理提供者）
  - 声明 capabilities、inheritsParentContext，实现 start 与可选 prepareContinuable
- 描述符 Descriptor
  - 版本化的 session 事件，标识 one-shot/continuable 及可恢复的组合信息
- 子代理组合 ChildAgent
  - 深度预算、会话元数据、AgentOptions 解析、作用域注入（persona、toolFilter）、委派策略种子

章节来源
- [packages/subagent/subagent/src/index.ts:171-497](file://packages/subagent/subagent/src/index.ts#L171-L497)
- [packages/subagent/subagent/src/continuation.ts:349-800](file://packages/subagent/subagent/src/continuation.ts#L349-L800)
- [packages/subagent/subagent/src/types.ts:19-325](file://packages/subagent/subagent/src/types.ts#L19-L325)
- [packages/subagent/subagent/src/descriptor.ts:1-315](file://packages/subagent/subagent/src/descriptor.ts#L1-L315)
- [packages/subagent/subagent/src/child-agent.ts:1-238](file://packages/subagent/subagent/src/child-agent.ts#L1-L238)

## 架构总览
子 Agent 系统采用“服务 + 提供者 + 编排器”的分层设计：
- 模型侧通过 tool-subagent 暴露统一工具接口，选择 provider 并决定前台/后台/可延续模式
- SubagentRuntime 做能力校验、描述符快照、事件发射，并将一次性委托交给具体 provider
- 可延续子代理由 SubagentContinuationManager 统一管理 Activation、冷恢复、消息路由、中断与报告
- 子代理会话通过 descriptor 持久化身份与可恢复组合，支持枚举与冷启动

```mermaid
sequenceDiagram
participant M as "模型"
participant T as "tool-subagent"
participant R as "SubagentRuntime"
participant P as "Provider"
participant C as "ContinuationManager"
participant S as "Session/Agent"
M->>T : 调用 subagent(描述, 提示, 选项)
T->>R : start(name, request) 或 startContinuable(spec)
alt 一次性
R->>P : start(resolvedRequest)
P->>S : 创建子 Agent/会话
S-->>P : 发布后句柄
P-->>R : SubagentRun
R-->>T : 返回 run
T->>R : await result()/dispose()
R-->>T : SubagentResult(stopReason, output, structured?)
else 可延续
R->>C : startContinuable(spec)
C->>P : prepareContinuable(request)
C->>S : 创建/冷恢复并投递初始消息
C-->>R : {childId, messageId}
R-->>T : 返回子代理ID
T-->>M : 立即返回后台/可延续
end
```

图表来源
- [packages/subagent/tool-subagent/src/index.ts:267-468](file://packages/subagent/tool-subagent/src/index.ts#L267-L468)
- [packages/subagent/subagent/src/index.ts:414-426](file://packages/subagent/subagent/src/index.ts#L414-L426)
- [packages/subagent/subagent/src/continuation.ts:403-457](file://packages/subagent/subagent/src/continuation.ts#L403-L457)
- [packages/subagent/subagent-spawn-in-process/src/index.ts:41-64](file://packages/subagent/subagent-spawn-in-process/src/index.ts#L41-L64)

## 详细组件分析

### 一次性子代理（One-shot）
- 请求与能力校验
  - SubagentStartRequest 携带 label、prompt、parent、signal、agentOptions、outputSchema、maxDepth、toolFilter、persona
  - SubagentRuntime.start 在委托前校验 capabilities 与 maxDepth，生成描述符并交由 provider.start
- Provider 契约
  - start 返回 SubagentRun；localAgent 表示本地进程子代理；result 承载最终输出与 stopReason
- 结果与终止原�
  - SubagentResult.output 为最后非空助手消息内容；structured 仅在满足 outputSchema 时存在
  - stopReason 为合并扩展联合，未知值视为失败

```mermaid
flowchart TD
Start(["开始: start(name, request)"]) --> CapCheck{"能力校验通过?"}
CapCheck -- 否 --> Err["抛出 UNSUPPORTED_CAPABILITY"]
CapCheck -- 是 --> Desc["生成描述符 snapshot"]
Desc --> CallProvider["调用 provider.start(resolved)"]
CallProvider --> Publish{"是否已发布子会话?"}
Publish -- 否 --> Cleanup["清理未发布资源并拒绝"]
Publish -- 是 --> ReturnRun["返回 SubagentRun"]
ReturnRun --> AwaitResult["await result()"]
AwaitResult --> Stop{"stopReason"}
Stop --> |completed| Ok["成功输出/结构化结果"]
Stop --> |aborted/error/max-tokens/refusal| Fail["映射为 isError 并附带部分输出"]
```

图表来源
- [packages/subagent/subagent/src/index.ts:414-426](file://packages/subagent/subagent/src/index.ts#L414-L426)
- [packages/subagent/subagent/src/types.ts:217-275](file://packages/subagent/subagent/src/types.ts#L217-L275)
- [packages/subagent/tool-subagent/src/index.ts:112-197](file://packages/subagent/tool-subagent/src/index.ts#L112-L197)

章节来源
- [packages/subagent/subagent/src/types.ts:93-158](file://packages/subagent/subagent/src/types.ts#L93-L158)
- [packages/subagent/subagent/src/index.ts:414-426](file://packages/subagent/subagent/src/index.ts#L414-L426)
- [packages/subagent/subagent/src/types.ts:217-275](file://packages/subagent/subagent/src/types.ts#L217-L275)

### 可延续子代理（Continuable）
- 概念与状态
  - 一个持久 Session + 至多一个进程内 Activation（驻留期），Activation 可能执行多个 FIFO turn
  - 状态：running/waiting/settled，由 Agent 静默与 ownedChildren 集合推导
- 启动与后续消息
  - startContinuable 预留 childId、快照描述符、准备 provider 的 detached spec、创建/冷恢复并提交初始消息，返回 {childId, messageId}
  - followup 根据 Activation 驻留情况入队/唤醒/冷恢复，确保唯一队列顺序
- 中断与报告
  - interrupt(target, authority) 授权后立即下发 cancel，不等待目标静默
  - reportFrom(child, content, options) 将选定内容以用户消息形式投递给直接父 Agent，支持 quiet/wakeup 两种调度策略
- 结算通知
  - 当 Activation 结算时，向父发送一条不可扩展的 runtime 账户消息，说明结束原因与最终助手内容

```mermaid
sequenceDiagram
participant P as "父 Agent"
participant R as "SubagentRuntime"
participant C as "ContinuationManager"
participant S as "子 Agent/Session"
P->>R : startContinuable({provider,label,request,signal})
R->>C : startContinuable(spec)
C->>C : 预留 childId/快照描述符
C->>R : prepareContinuable(provider, req)
R-->>C : ContinuableCreateSpec
C->>S : 创建/冷恢复并投递初始消息
C-->>R : {childId, messageId}
R-->>P : 返回子代理ID
P->>R : followup(parent, childId, content, options)
R->>C : followup(...)
alt 有 Activation
C->>S : 入队/唤醒
else 无 Activation
C->>S : 冷恢复并投递
end
C-->>R : accepted messageId
R-->>P : 返回 messageId
```

图表来源
- [packages/subagent/subagent/src/continuation.ts:403-457](file://packages/subagent/subagent/src/continuation.ts#L403-L457)
- [packages/subagent/subagent/src/continuation.ts:476-505](file://packages/subagent/subagent/src/continuation.ts#L476-L505)
- [packages/subagent/subagent/src/index.ts:212-238](file://packages/subagent/subagent/src/index.ts#L212-L238)

章节来源
- [packages/subagent/subagent/src/continuation.ts:1-800](file://packages/subagent/subagent/src/continuation.ts#L1-L800)
- [packages/subagent/subagent/src/index.ts:212-238](file://packages/subagent/subagent/src/index.ts#L212-L238)

### 继承机制、配置传递与作用域隔离
- 继承与上下文
  - inheritsParentContext 仅描述“会话历史是否被播种”，不代表工具/服务/权限继承
  - fork 后端会传入父已完成回合的前缀作为 seed；spawn 不继承会话历史
- 配置传递
  - resolveChildAgentOptions 继承 parent.provider/model/maxTokens，并可被 per-child 覆盖，同时写入 subagentDepth
  - childSessionMeta 记录 cwd、agentPreset、origin、delegationDepth、seedLength
- 作用域隔离
  - applyChildComposition 在子创建窗口中：加入父 preset、注入委派范围提示、按子粒度安装 persona 与 toolFilter
  - 委派策略种子：captureDelegatedPolicyOverrides 捕获 sandbox/mode 与 approval/policy，并以 source:'delegation' 追加到子日志

```mermaid
classDiagram
class ChildAgent {
+resolveChildAgentOptions(parent, requested, depth)
+childSessionMeta(parent, depth, seedLength)
+applyChildComposition(childCtx, parent, composition)
+captureDelegatedPolicyOverrides(parent)
+appendDelegatedPolicyOverrides(session, overrides)
}
class Composition {
+persona? : string
+toolFilter? : ToolRestriction
}
ChildAgent --> Composition : "应用"
```

图表来源
- [packages/subagent/subagent/src/child-agent.ts:68-175](file://packages/subagent/subagent/src/child-agent.ts#L68-L175)
- [packages/subagent/subagent/src/child-agent.ts:199-225](file://packages/subagent/subagent/src/child-agent.ts#L199-L225)

章节来源
- [packages/subagent/subagent/src/child-agent.ts:1-238](file://packages/subagent/subagent/src/child-agent.ts#L1-L238)
- [packages/subagent/subagent-spawn-in-process/src/index.ts:41-64](file://packages/subagent/subagent-spawn-in-process/src/index.ts#L41-L64)

### 权限控制、资源限制与安全隔离
- 深度限制
  - resolveChildDepth 基于父 delegationDepth+1 计算，若超过 maxDepth 则抛出 SubagentDepthError
  - 工具层默认 maxDepth=3，可通过配置关闭或交由 provider-managed
- 工具过滤
  - toolFilter 在子创建窗口通过 tools.restrict() 生效，对子可见性与执行均拦截
- 委派策略
  - 子代理的 sandbox/mode 与 approval/policy 在委派边界固定，子无法自行扩大权限
- 安全隔离
  - 子代理拥有独立 scope 与 session，父/兄弟不可见其内部注册；cold resume 仅重放必要元数据

章节来源
- [packages/subagent/subagent/src/child-agent.ts:48-83](file://packages/subagent/subagent/src/child-agent.ts#L48-L83)
- [packages/subagent/tool-subagent/src/index.ts:267-300](file://packages/subagent/tool-subagent/src/index.ts#L267-L300)
- [packages/subagent/subagent/src/child-agent.ts:199-225](file://packages/subagent/subagent/src/child-agent.ts#L199-L225)

### 子代理间通信协议
- 消息投递
  - followup 是唯一续命通道，经 Agent inbox 排队，保证顺序与可观测性
- 中断
  - interrupt 使用 keepInbox=true 取消当前 turn，已认领工作不重入队，空闲后继续处理排队消息
- 报告
  - reportFrom 将子代理选定的内容包装为用户消息投递给直接父，quiet 不唤醒，wakeup 唤醒父
- 结算通知
  - 子代理结算时，runtime 向父发送不可扩展的结算消息，说明结束原因与最终助手内容

章节来源
- [packages/subagent/subagent/src/continuation.ts:507-693](file://packages/subagent/subagent/src/continuation.ts#L507-L693)

### 模式示例
- 并行执行
  - 通过多次调用 ctx.subagents.start 或 startContinuable 并发启动多个子代理，各自独立运行与结算
- 串行调用
  - 在前台模式下 await run.result，或在可延续模式下先 startContinuable，再依次 followup 推进
- 嵌套子代理
  - 子代理内部再次调用工具进行委托，形成树状层级；通过 listDescendants 可枚举完整子树

章节来源
- [packages/subagent/tool-subagent/src/index.ts:369-430](file://packages/subagent/tool-subagent/src/index.ts#L369-L430)
- [docs/subsystems/subagent.md:287-305](file://docs/subsystems/subagent.md#L287-L305)

### 错误传播与结果聚合
- 一次性子代理
  - 非 completed 的 stopReason 表示输出可能不完整，工具层将其映射为 isError，并附带部分文本输出
- 可延续子代理
  - 中断/冷恢复/结算均有明确语义；报告与结算消息不会改变子代理 turn 的完成状态
- 聚合策略
  - 前台模式直接收集结果；后台/可延续模式通过 job_output 或后续 followup 获取中间进展，最终以结算通知汇总

章节来源
- [packages/subagent/tool-subagent/src/index.ts:112-197](file://packages/subagent/tool-subagent/src/index.ts#L112-L197)
- [packages/subagent/subagent/src/types.ts:217-275](file://packages/subagent/subagent/src/types.ts#L217-L275)

## 依赖关系分析
- 模块耦合
  - tool-subagent 依赖 SubagentRuntime 与 provider；runtime 依赖 continuation manager、descriptor、child-agent 组合逻辑
  - 各 provider（spawn/fork/acp/codex/...）实现 SubagentProvider 接口，共享同一服务契约
- 外部依赖
  - 会话存储、持久化、Agent 循环、工具注册、系统提示等通过 Cordis 注入

```mermaid
graph LR
Tool["tool-subagent"] --> Runtime["SubagentRuntime"]
Runtime --> Cont["ContinuationManager"]
Runtime --> Prov["Provider 注册表"]
Prov --> Spawn["spawn-in-process"]
Prov --> Fork["fork-in-process"]
Prov --> ACP["acp"]
Prov --> Codex["codex"]
Prov --> Claude["claude-code"]
Prov --> SDK["dsh-sdk"]
Runtime --> Desc["Descriptor"]
Runtime --> Child["ChildAgent"]
```

图表来源
- [packages/subagent/tool-subagent/src/index.ts:267-468](file://packages/subagent/tool-subagent/src/index.ts#L267-L468)
- [packages/subagent/subagent/src/index.ts:171-497](file://packages/subagent/subagent/src/index.ts#L171-L497)
- [packages/subagent/subagent/src/descriptor.ts:1-315](file://packages/subagent/subagent/src/descriptor.ts#L1-L315)
- [packages/subagent/subagent/src/child-agent.ts:1-238](file://packages/subagent/subagent/src/child-agent.ts#L1-L238)

章节来源
- [packages/subagent/subagent/src/index.ts:171-497](file://packages/subagent/subagent/src/index.ts#L171-L497)
- [packages/subagent/tool-subagent/src/index.ts:267-468](file://packages/subagent/tool-subagent/src/index.ts#L267-L468)

## 性能考虑
- 避免不必要的冷恢复
  - followup 命中已有 Activation 时直接入队/唤醒，减少重建成本
- 批量启动
  - 并行 start 多个一次性子代理，利用并发提升吞吐；注意资源上限与令牌预算
- 结构化输出
  - 使用 outputSchema 可减少往返与解析开销，但需确保 provider 支持
- 工具过滤最小化
  - 仅允许必要工具，降低 prompt 大小与执行路径复杂度
- 深度限制
  - 合理设置 maxDepth，防止过深嵌套导致资源膨胀

[本节为通用指导，无需特定文件引用]

## 故障排查指南
- 常见问题定位
  - 能力不支持：检查 provider.capabilities 与请求字段匹配（如 outputSchema、depthLimit、toolFilter、persona）
  - 深度超限：确认 resolveChildDepth 与 maxDepth 配置
  - 中断无效：确认 authority 是否为 exact live ancestor 或正确的 user parentSessionId
  - 报告未送达：检查 direct parent 是否存活，delivery 策略 quiet/wakeup 是否符合预期
- 诊断手段
  - 使用 listChildren/listDescendants 查看子代理状态与位置
  - 观察 subagent/start 与 subagent/end 事件对，核对 provider、id、stopReason
  - 检查 descriptor 是否成功写入子会话日志，确保可枚举与冷恢复

章节来源
- [packages/subagent/subagent/src/index.ts:481-496](file://packages/subagent/subagent/src/index.ts#L481-L496)
- [packages/subagent/subagent/src/continuation.ts:528-568](file://packages/subagent/subagent/src/continuation.ts#L528-L568)
- [packages/subagent/subagent/src/descriptor.ts:259-315](file://packages/subagent/subagent/src/descriptor.ts#L259-L315)

## 结论
子 Agent 系统通过清晰的服务契约、可插拔的提供者与强大的可延续编排，实现了灵活、安全、可扩展的子代理能力。借助描述符与会话持久化，系统支持冷恢复与枚举；通过深度限制、工具过滤与委派策略种子，保障权限与资源隔离。结合前台/后台/可延续三种模式，可满足并行、串行与嵌套等多种业务场景。

[本节为总结性内容，无需特定文件引用]

## 附录
- 常用 API 速览
  - 一次性：ctx.subagents.start(name, request) → SubagentRun → result()/dispose()
  - 可延续：ctx.subagents.startContinuable(spec) → {childId, messageId}
  - 后续消息：ctx.subagents.followup(parent, childId, content, options)
  - 中断：ctx.subagents.interrupt(targetSessionId, authority)
  - 报告：ctx.subagents.reportFrom(child, content, options)
  - 枚举：ctx.subagents.listChildren(parentSessionId), listDescendants(rootSessionId)

章节来源
- [packages/subagent/subagent/src/index.ts:212-360](file://packages/subagent/subagent/src/index.ts#L212-L360)
- [docs/subsystems/subagent.md:478-649](file://docs/subsystems/subagent.md#L478-L649)