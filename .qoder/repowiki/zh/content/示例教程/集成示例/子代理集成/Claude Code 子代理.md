# Claude Code 子代理

<cite>
**本文引用的文件**
- [packages/subagent/subagent-claude-code/src/index.ts](file://packages/subagent/subagent-claude-code/src/index.ts)
- [packages/subagent/subagent-claude-code/src/run.ts](file://packages/subagent/subagent-claude-code/src/run.ts)
- [packages/subagent/subagent-claude-code/src/process.ts](file://packages/subagent/subagent-claude-code/src/process.ts)
- [packages/subagent/subagent-claude-code/README.md](file://packages/subagent/subagent-claude-code/README.md)
- [packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts](file://packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts)
- [docs/subsystems/subagent.md](file://docs/subsystems/subagent.md)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能与调优](#性能与调优)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录：配置与集成示例](#附录配置与集成示例)

## 简介
本文件面向在 DeepSeek Harness 中集成并运行 Claude Code 子代理的开发者，系统说明其集成方式、配置项、执行环境、API 密钥设置、模型参数传递、会话管理、工具调用机制、错误处理与性能调优建议，以及与 Anthropic API 集成的注意事项和安全最佳实践。Claude Code 子代理通过官方 Claude Agent SDK 启动本地 CLI 进程，将父会话工作目录作为子代理工作空间，并以“一次性任务”的方式提交纯文本指令，最终仅返回严格校验后的最终答案。

## 项目结构
Claude Code 子代理位于 packages/subagent/subagent-claude-code 包内，核心由三个模块组成：
- index.ts：注册子代理提供者，声明能力、注入服务、解析可执行文件并构建运行规格。
- run.ts：实现一次性运行的生命周期，包括提示词校验、SDK 查询选项构造、结果收敛、清理与取消。
- process.ts：将共享子进程句柄投影为 SDK 所需的进程接口，并负责 Windows 批处理包装与环境覆盖。

```mermaid
graph TB
A["应用/工具层"] --> B["子代理运行时<br/>ctx.subagents.start('claude-code')"]
B --> C["Claude Code 提供者<br/>index.ts"]
C --> D["运行编排<br/>run.ts"]
D --> E["SDK 选项与查询<br/>officialQuery(...)"]
E --> F["进程适配层<br/>process.ts"]
F --> G["共享子进程服务<br/>spawn/terminate/waitForExit"]
G --> H["本地 claude CLI 进程"]
H --> I["Anthropic API通过 CLI"]
```

图表来源
- [packages/subagent/subagent-claude-code/src/index.ts:52-91](file://packages/subagent/subagent-claude-code/src/index.ts#L52-L91)
- [packages/subagent/subagent-claude-code/src/run.ts:177-291](file://packages/subagent/subagent-claude-code/src/run.ts#L177-L291)
- [packages/subagent/subagent-claude-code/src/process.ts:51-74](file://packages/subagent/subagent-claude-code/src/process.ts#L51-L74)

章节来源
- [packages/subagent/subagent-claude-code/src/index.ts:1-114](file://packages/subagent/subagent-claude-code/src/index.ts#L1-L114)
- [packages/subagent/subagent-claude-code/src/run.ts:1-291](file://packages/subagent/subagent-claude-code/src/run.ts#L1-L291)
- [packages/subagent/subagent-claude-code/src/process.ts:1-171](file://packages/subagent/subagent-claude-code/src/process.ts#L1-L171)

## 核心组件
- 提供者注册与能力声明
  - 名称：claude-code
  - 能力：无可选启动期能力（输出模式、深度限制、工具过滤、人格均不支持）
  - 继承父上下文：否
  - 注入服务：subagents、subprocess
- 运行编排
  - 提示词校验：仅接受非空文本块序列，拼接为单一字符串
  - SDK 查询选项：禁用持久化会话、禁止 AskUserQuestion、合并安全清洗后的父环境变量并叠加部署级 env
  - 结果收敛：仅接受 subtype=success、is_error=false、result 非空的最终消息；否则映射为 error
  - 取消与清理：本地取消优先，关闭 SDK Query，终止进程树并等待退出
- 进程适配
  - 将共享子进程句柄投影为 SDK 的 SpawnedProcess 接口
  - Windows 下对 .cmd/.bat 使用 cmd.exe 包装并通过环境变量传入原始命令
  - 环境覆盖：对已清洗的环境键进行显式 tombstone 覆盖，避免泄露

章节来源
- [packages/subagent/subagent-claude-code/src/index.ts:52-91](file://packages/subagent/subagent-claude-code/src/index.ts#L52-L91)
- [packages/subagent/subagent-claude-code/src/run.ts:70-127](file://packages/subagent/subagent-claude-code/src/run.ts#L70-L127)
- [packages/subagent/subagent-claude-code/src/process.ts:32-74](file://packages/subagent/subagent-claude-code/src/process.ts#L32-L74)

## 架构总览
下图展示从父会话到 Claude Code CLI 再到 Anthropic API 的完整调用链，以及取消、错误与资源清理路径。

```mermaid
sequenceDiagram
participant Caller as "调用方"
participant SubAgent as "子代理运行时"
participant Provider as "Claude Code 提供者"
participant Runner as "运行编排(run.ts)"
participant SDK as "Claude Agent SDK"
participant Proc as "进程适配(process.ts)"
participant Child as "claude CLI 进程"
participant API as "Anthropic API"
Caller->>SubAgent : start("claude-code", {prompt, signal})
SubAgent->>Provider : start(ResolvedRequest)
Provider->>Runner : startClaudeCodeRun(request, spec)
Runner->>Runner : textTask(prompt)
Runner->>SDK : officialQuery({prompt, options})
SDK->>Proc : spawnClaudeCodeProcess(options)
Proc->>Child : 启动本地 claude CLI
Child-->>SDK : 流式消息(result/错误等)
SDK-->>Runner : 迭代消息
Runner->>Runner : consumeClaudeQuery()
alt 成功且唯一strict success
Runner-->>SubAgent : result={output : [text], stopReason : "completed"}
else 错误或无结果
Runner-->>SubAgent : result={output : [], stopReason : "error"}
end
Note over Runner,Child : dispose时关闭Query并终止进程树
```

图表来源
- [packages/subagent/subagent-claude-code/src/run.ts:203-291](file://packages/subagent/subagent-claude-code/src/run.ts#L203-L291)
- [packages/subagent/subagent-claude-code/src/process.ts:80-171](file://packages/subagent/subagent-claude-code/src/process.ts#L80-L171)
- [packages/subagent/subagent-claude-code/src/index.ts:62-91](file://packages/subagent/subagent-claude-code/src/index.ts#L62-L91)

## 详细组件分析

### 提供者与配置（index.ts）
- 职责
  - 校验 disposeGraceMs 为正有限数且不大于最大定时器延迟
  - 解析父会话 cwd，若缺失则拒绝
  - 通过 subprocess.resolveExecutable 解析 'claude' 可执行文件
  - 组装运行规格（cwd、executable、env、disposeGraceMs、spawn、onError）
  - 调用 startClaudeCodeRun 发布运行
- 配置项
  - env：显式环境变量，叠加在共享清洗后的父环境之上
  - disposeGraceMs：进程树终止宽限时间（毫秒）

```mermaid
flowchart TD
Start(["start()"]) --> CheckCwd{"父会话有cwd吗?"}
CheckCwd --> |否| ErrCwd["抛出错误：缺少工作目录"]
CheckCwd --> |是| Resolve["解析claude可执行文件"]
Resolve --> BuildSpec["构建运行规格(spec)"]
BuildSpec --> Run["startClaudeCodeRun(request, spec)"]
Run --> End(["返回SubagentRun"])
```

图表来源
- [packages/subagent/subagent-claude-code/src/index.ts:62-91](file://packages/subagent/subagent-claude-code/src/index.ts#L62-L91)

章节来源
- [packages/subagent/subagent-claude-code/src/index.ts:26-114](file://packages/subagent/subagent-claude-code/src/index.ts#L26-L114)

### 运行编排（run.ts）
- 提示词校验
  - 仅允许文本块，空或空白将被拒绝
- SDK 查询选项
  - 合并安全清洗后的父环境与部署级 env
  - 禁用 persistSession，禁止 AskUserQuestion
  - 自定义 spawnClaudeCodeProcess 将 SDK 请求转为共享子进程规范
- 结果收敛
  - 遍历完整消息流，仅保留最后一个 strict success 结果
  - 若无结果或失败，统一映射为 error
- 取消与清理
  - 监听 request.signal，建立本地 AbortController
  - 异常路径确保关闭 Query、终止进程树、等待退出，必要时聚合错误

```mermaid
flowchart TD
S(["开始"]) --> V["校验提示词(textTask)"]
V --> Q["发起SDK查询(officialQuery)"]
Q --> Stream["消费消息流(consumeClaudeQuery)"]
Stream --> R{"收到strict success?"}
R --> |是| Ok["返回{output:text, stopReason:'completed'}"]
R --> |否| Err["返回{output:[], stopReason:'error'}"]
S -.-> C["监听request.signal并本地取消"]
C --> T["关闭Query并终止进程树"]
```

图表来源
- [packages/subagent/subagent-claude-code/src/run.ts:70-127](file://packages/subagent/subagent-claude-code/src/run.ts#L70-L127)
- [packages/subagent/subagent-claude-code/src/run.ts:177-291](file://packages/subagent/subagent-claude-code/src/run.ts#L177-L291)

章节来源
- [packages/subagent/subagent-claude-code/src/run.ts:1-291](file://packages/subagent/subagent-claude-code/src/run.ts#L1-L291)

### 进程适配（process.ts）
- 环境覆盖
  - 对已清洗的环境键进行显式 tombstone 覆盖，防止泄露
- 启动规范
  - 校验 cwd 存在且非空
  - Windows 下对 .cmd/.bat 使用 cmd.exe 包装，并将原始命令放入环境变量
  - stdio 固定为 stdin/stdout pipe，stderr inherit
- 进程对象
  - ManagedClaudeCodeProcess 将共享子进程句柄投影为 SDK 的 SpawnedProcess
  - 转发 exit/error 事件，暴露 exitCode/signalCode/killed
  - kill() 去重并委托给共享子进程 terminate

```mermaid
classDiagram
class ManagedClaudeCodeProcess {
+stdin
+stdout
+killed bool
+exitCode number|null
+signalCode Signals|null
+kill(signal) bool
+on(event, listener) void
+once(event, listener) void
+off(event, listener) void
}
class SubprocessHandle {
+pid number
+stdin stream
+stdout stream
+done Promise
+terminate() void
+waitForExit(signal?) Promise~bool~
}
ManagedClaudeCodeProcess --> SubprocessHandle : "封装/委托"
```

图表来源
- [packages/subagent/subagent-claude-code/src/process.ts:80-171](file://packages/subagent/subagent-claude-code/src/process.ts#L80-L171)

章节来源
- [packages/subagent/subagent-claude-code/src/process.ts:1-171](file://packages/subagent/subagent-claude-code/src/process.ts#L1-L171)

### 子代理通用语义（与 subagent 子系统对齐）
- 一次性运行与结果契约
  - 结果包含 output、structured（本提供者不使用）、stopReason
  - stopReason 支持 completed、aborted、error、max-tokens、refusal（本提供者仅产生 completed 或 error）
- 能力与上下文
  - 本提供者不继承父上下文，不提供输出模式、深度限制、工具过滤、人格等能力
  - 子代理独立于父会话的工具与权限，仅继承工作目录与宿主原生设置

章节来源
- [docs/subsystems/subagent.md:308-463](file://docs/subsystems/subagent.md#L308-L463)

## 依赖关系分析
- 内部依赖
  - @deepseek-ai/dsh-subagent：提供子代理运行时、结果收敛、子进程句柄等
  - @deepseek-ai/dsh-subprocess：提供进程创建、环境清洗、终止策略
  - @anthropic-ai/claude-agent-sdk：官方 SDK，用于发起查询与进程定制
- 外部依赖
  - 本地安装的 claude CLI：通过 PATH 解析，Windows 批处理包装
  - Anthropic API：由 CLI 负责鉴权与调用，插件不直接持有密钥

```mermaid
graph LR
A["subagent-claude-code"] --> B["@deepseek-ai/dsh-subagent"]
A --> C["@deepseek-ai/dsh-subprocess"]
A --> D["@anthropic-ai/claude-agent-sdk"]
D --> E["claude CLI"]
E --> F["Anthropic API"]
```

图表来源
- [packages/subagent/subagent-claude-code/src/run.ts:9-36](file://packages/subagent/subagent-claude-code/src/run.ts#L9-L36)
- [packages/subagent/subagent-claude-code/src/process.ts:8-18](file://packages/subagent/subagent-claude-code/src/process.ts#L8-L18)

章节来源
- [packages/subagent/subagent-claude-code/src/run.ts:1-36](file://packages/subagent/subagent-claude-code/src/run.ts#L1-L36)
- [packages/subagent/subagent-claude-code/src/process.ts:1-18](file://packages/subagent/subagent-claude-code/src/process.ts#L1-L18)

## 性能与调优
- 进程与超时
  - 合理设置 disposeGraceMs，使进程树优雅退出，避免僵尸进程
  - 长任务应依赖调用方信号取消，而非内置时钟超时
- 输入与缓存
  - 子代理每次新建独立 CLI 进程与 SDK 查询，不受父会话 KV 缓存影响
  - 尽量精简提示词，减少不必要的上下文与重复信息
- 并发与资源
  - 每个子代理运行独占一个 CLI 进程，注意并发度与系统资源占用
  - 避免在同一工作目录下频繁并行大量写操作导致锁竞争
- 日志与诊断
  - onError 回调会记录子进程错误，便于定位问题
  - 关注 stderr 继承输出，结合系统日志排查环境问题

[本节为通用指导，无需特定文件引用]

## 故障排查指南
- 常见错误与原�
  - 缺少工作目录：父会话未提供 cwd，需在具备工作目录的会话中委派
  - 可执行文件缺失：PATH 中找不到 claude，需安装或调整 PATH
  - 无结果或错误：SDK 返回非 success、is_error=true、result 为空或迭代异常
  - 启动前取消：request.signal 在 SDK 启动前触发，将直接拒绝
- 调试步骤
  - 检查 resolveExecutable 是否成功解析到 claude
  - 确认 env 中是否包含必要的认证变量（如 ANTHROPIC_API_KEY）
  - 观察子进程退出码与信号，定位崩溃或超时
  - 在测试中可通过 mock SDK query 与子进程句柄复现边界情况

章节来源
- [packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts:328-389](file://packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts#L328-L389)
- [packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts:532-618](file://packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts#L532-L618)
- [packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts:620-800](file://packages/subagent/subagent-claude-code/tests/subagent-claude-code.spec.ts#L620-L800)

## 结论
Claude Code 子代理以“一次性任务”的方式将父会话的工作目录与宿主原生设置传递给本地 claude CLI，并通过官方 SDK 完成查询与结果收敛。它强调安全的环境隔离、严格的错误映射与可靠的资源清理。对于需要独立 CLI 行为、产品默认配置与账户状态的场景，该子代理提供了稳定而可控的执行通道。生产环境中应重点关注可执行文件可用性、环境变量安全、取消与超时策略，以及并发下的资源管理。

[本节为总结性内容，无需特定文件引用]

## 附录：配置与集成示例

### 如何启用与配置
- 在宿主组合中加载提供者，并传入必要的环境变量（例如 ANTHROPIC_API_KEY）
- 可选地配置 disposeGraceMs 控制进程树终止宽限
- 通过工具层（dsh-tool-subagent）暴露 subagent_claude_code 工具，指定 provider 为 claude-code

参考配置片段位置
- [packages/subagent/subagent-claude-code/README.md:25-51](file://packages/subagent/subagent-claude-code/README.md#L25-L51)

### 启动流程与上下文传递
- 父会话需提供 cwd，否则拒绝
- 提示词必须为非空文本块序列，会被拼接为单一字符串传给 SDK
- 子代理不继承父会话的工具、人格与权限，仅继承工作目录与宿主原生设置

章节来源
- [packages/subagent/subagent-claude-code/src/index.ts:62-91](file://packages/subagent/subagent-claude-code/src/index.ts#L62-L91)
- [packages/subagent/subagent-claude-code/src/run.ts:70-85](file://packages/subagent/subagent-claude-code/src/run.ts#L70-L85)
- [packages/subagent/subagent-claude-code/README.md:15-23](file://packages/subagent/subagent-claude-code/README.md#L15-L23)

### 执行结果与错误处理
- 成功：唯一 strict success 的 result 文本作为最终输出，stopReason=completed
- 失败：任何 SDK 错误、is_error=true、无结果或迭代异常，统一映射为 stopReason=error
- 取消：本地取消优先，stopReason=aborted

章节来源
- [packages/subagent/subagent-claude-code/src/run.ts:112-127](file://packages/subagent/subagent-claude-code/src/run.ts#L112-L127)
- [packages/subagent/subagent-claude-code/src/run.ts:203-291](file://packages/subagent/subagent-claude-code/src/run.ts#L203-L291)

### 与 Anthropic API 的集成与安全实践
- 认证与端点
  - 插件不直接调用 Anthropic API，而是通过本地 claude CLI；认证与端点由 CLI 与宿主原生设置决定
  - 如需自定义端点或代理，可在 env 中设置相关变量（例如 ANTHROPIC_BASE_URL），但敏感值必须显式传入 env
- 环境变量安全
  - 启动前会对父环境进行安全清洗，再叠加部署级 env；避免泄露敏感变量
  - Windows 批处理包装会将原始命令放入环境变量，避免元字符被误解析
- 会话与缓存
  - 子代理每次新建独立 CLI 进程与 SDK 查询，不持久化会话，也不复用父会话 KV 缓存
- 交互与工具
  - 禁用 AskUserQuestion，其他交互回调未提供；需要人工审批的任务将失败
  - 不继承父会话的工具与权限，子代理拥有独立的工具与权限范围

章节来源
- [packages/subagent/subagent-claude-code/src/process.ts:32-74](file://packages/subagent/subagent-claude-code/src/process.ts#L32-L74)
- [packages/subagent/subagent-claude-code/README.md:25-33](file://packages/subagent/subagent-claude-code/README.md#L25-L33)
- [packages/subagent/subagent-claude-code/README.md:59-99](file://packages/subagent/subagent-claude-code/README.md#L59-L99)