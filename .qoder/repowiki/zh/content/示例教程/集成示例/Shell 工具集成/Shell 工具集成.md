# Shell 工具集成

<cite>
**本文引用的文件**
- [packages/shell/README.md](file://packages/shell/README.md)
- [docs/subsystems/shell.md](file://docs/subsystems/shell.md)
- [docs/subsystems/shell.zh.md](file://docs/subsystems/shell.zh.md)
- [packages/shell/tool-bash/README.md](file://packages/shell/tool-bash/README.md)
- [packages/shell/pwsh-local/README.md](file://packages/shell/pwsh-local/README.md)
- [packages/shell/bash-sandbox/README.md](file://packages/shell/bash-sandbox/README.md)
- [docs/subsystems/sandbox.md](file://docs/subsystems/sandbox.md)
- [docs/subsystems/subprocess.md](file://docs/subsystems/subprocess.md)
- [docs/subsystems/tools.md](file://docs/subsystems/tools.md)
- [apps/cli/tests/windows-shell.spec.ts](file://apps/cli/tests/windows-shell.spec.ts)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能与资源管理](#性能与资源管理)
8. [调试与测试最佳实践](#调试与测试最佳实践)
9. [跨平台兼容性](#跨平台兼容性)
10. [故障排查指南](#故障排查指南)
11. [结论](#结论)

## 简介
本文件面向希望开发和使用自定义 Shell 工具的工程师，覆盖 Bash 与 PowerShell 的集成方式、工具注册机制、参数传递与输出处理、交互式命令与管道操作、错误状态与退出码约定、沙箱安全限制与资源管理，以及调试测试、跨平台兼容性与性能优化建议。文档基于仓库中 shell 能力族、子进程抽象、工具管线与沙箱策略等子系统实现进行说明。

## 项目结构
Shell 能力族由“执行器契约 + 具体实现 + 共享环境 + 模型侧工具”组成：
- 契约与服务定义：`ctx.shell`（ShellExecutor）、`ctx.shellEnv`（DSH_* 环境变量注册表）
- 执行器提供者：本地 Bash、沙箱化 Bash、本地 PowerShell
- 模型侧工具：Bash 工具、PowerShell 工具
- 支撑子系统：子进程抽象、工具管线、沙箱策略

```mermaid
graph TB
subgraph "Shell 能力族"
A["dsh-shell<br/>执行器契约"] --> B["dsh-bash-local<br/>本地 Bash 执行器"]
A --> C["dsh-bash-sandbox<br/>沙箱化 Bash 执行器"]
A --> D["dsh-pwsh-local<br/>本地 PowerShell 执行器"]
E["dsh-tool-bash<br/>模型侧 Bash 工具"] --> A
F["dsh-tool-pwsh<br/>模型侧 PowerShell 工具"] --> D
G["dsh-shell-env<br/>受管 DSH_* 环境"] --> E
end
subgraph "支撑子系统"
H["dsh-subprocess<br/>子进程抽象"]
I["dsh-tools<br/>工具管线"]
J["dsh-sandbox / dsh-sandbox-policy<br/>沙箱策略"]
end
B --> H
C --> J
C --> H
D --> H
E --> I
F --> I
```

图示来源
- [packages/shell/README.md:1-20](file://packages/shell/README.md#L1-L20)
- [docs/subsystems/shell.md:1-12](file://docs/subsystems/shell.md#L1-L12)
- [docs/subsystems/subprocess.md:1-16](file://docs/subsystems/subprocess.md#L1-L16)
- [docs/subsystems/sandbox.md:1-12](file://docs/subsystems/sandbox.md#L1-L12)
- [docs/subsystems/tools.md:1-12](file://docs/subsystems/tools.md#L1-L12)

章节来源
- [packages/shell/README.md:1-20](file://packages/shell/README.md#L1-L20)

## 核心组件
- Shell 执行器契约（ShellExecutor）
  - resolve(request) → spec：将可选请求补齐为必填规格
  - run(spec) → ShellRunResult：前台执行，返回独立正交的结果字段（exitCode/signal/timedOut/aborted/timeoutMs/stdout/stderr/sandbox）
  - start(spec) → ShellProcess：后台进程句柄，readOutput() 增量读取，kill() 幂等终止
- 受管环境（ShellEnvRegistry）
  - collect(execution) → DshEnvironment：每次调用重建 DSH_* 快照，注入到执行上下文
- 模型侧工具（bash/pwsh）
  - 暴露参数：command、workdir、timeoutMs、run_in_background、sandbox_permissions（条件可见）、justification（条件必需）
  - 结果呈现：stdout/stderr 尾部、截断提示、超时/信号/退出码标记、沙箱拒绝信息
- 子进程抽象（SubprocessRuntime）
  - spawn/spec/handle：显式 stdio、有界收集、spill 文件、树级终止、done 仅携带退出事实
- 沙箱策略（SandboxProvider/SandboxPolicyService）
  - confine(argv, policy) → ConfinedArgv：按模式限制文件效果；danger-full-access 不经过沙箱
  - 模式：read-only、workspace-write、danger-full-access；执行完整度 full/partial

章节来源
- [docs/subsystems/shell.md:13-221](file://docs/subsystems/shell.md#L13-L221)
- [docs/subsystems/shell.zh.md:13-221](file://docs/subsystems/shell.zh.md#L13-L221)
- [docs/subsystems/subprocess.md:13-240](file://docs/subsystems/subprocess.md#L13-L240)
- [docs/subsystems/sandbox.md:9-156](file://docs/subsystems/sandbox.md#L9-L156)
- [packages/shell/tool-bash/README.md:15-55](file://packages/shell/tool-bash/README.md#L15-L55)

## 架构总览
下图展示一次模型侧 bash 调用的端到端流程：工具层构建请求 → 执行器解析 → 子进程启动 → 输出收集/溢出 → 结果渲染与任务适配（后台）。

```mermaid
sequenceDiagram
participant M as "模型/插件"
participant T as "工具层(dsh-tool-bash)"
participant S as "执行器(ctx.shell)"
participant P as "子进程服务(ctx.subprocess)"
participant X as "外部进程(bash/pwsh)"
participant J as "任务运行时(ctx.jobs)"
M->>T : 调用 bash(command, workdir, timeoutMs, ...)
T->>S : resolve(ShellExecRequest)
S-->>T : ShellExecSpec(已补齐/封顶)
alt 前台执行
T->>S : run(spec)
S->>P : spawn(argv, stdio, cwd, graceMs, signal, env)
P->>X : 启动子进程
X-->>P : stdout/stderr 流
P-->>S : CollectedOutput(可溢出至磁盘)
S-->>T : ShellRunResult(exitCode/signal/timedOut/aborted/...)
T-->>M : 渲染结果(含退出码/超时/截断/沙箱标记)
else 后台执行
T->>S : start(spec)
S->>P : spawn(...)
P->>X : 启动子进程
S-->>T : ShellProcess(句柄)
T->>J : 注册 job(owner=agent, hooks=cancel/done/output)
T-->>M : 返回 jobId
loop 增量读取
T->>S : readOutput()
S-->>T : delta(lossy/spillPath)
T-->>J : 推送增量输出
end
end
```

图示来源
- [docs/subsystems/shell.md:105-221](file://docs/subsystems/shell.md#L105-L221)
- [docs/subsystems/subprocess.md:89-240](file://docs/subsystems/subprocess.md#L89-L240)
- [packages/shell/tool-bash/README.md:27-37](file://packages/shell/tool-bash/README.md#L27-L37)

## 详细组件分析

### Bash 执行器与工具（dsh-bash-local + dsh-tool-bash）
- 参数与默认值
  - command：通过 bash -c 执行；无状态保持，使用 workdir 切换目录而非 cd
  - workdir：优先来自会话 cwd，再回退到执行器配置或进程 cwd
  - timeoutMs：由执行器配置默认值与上限封顶
  - run_in_background：立即返回 jobId，无执行器超时
  - sandbox_permissions/justification：当挂载了沙箱执行器时可见/必需
- 环境与输入
  - 受管 DSH_* 通过 ctx.shellEnv.collect 注入，子进程服务会移除继承的 DSH_* 后再合并
  - stdin/env/stdoutMaxBytes 仅供受信任进程内插件使用，模型侧工具不暴露
- 输出与错误
  - 前台结果包含 stdout/stderr 尾部、截断提示、超时/信号/退出码标记、沙箱拒绝信息
  - 非零退出码仍作为正常结果返回，isError 仅用于基础设施失败（如 spawn 失败、中止）
- 后台任务
  - 将 ShellProcess 适配为通用 job，job 运行时负责 id、所有权、轮询、完成通知与清理

```mermaid
flowchart TD
Start(["开始"]) --> Build["构建 ShellExecRequest"]
Build --> Resolve{"resolve() 补齐/封顶"}
Resolve --> Mode{"前台 or 后台?"}
Mode --> |前台| Run["run(spec)"]
Mode --> |后台| StartProc["start(spec) 返回 ShellProcess"]
Run --> Collect["收集 stdout/stderr(可溢出)"]
Collect --> Result["生成 ShellRunResult"]
StartProc --> JobReg["注册到 ctx.jobs"]
JobReg --> Poll["增量 readOutput() 推送"]
Result --> Render["渲染结果(含退出码/超时/截断/沙箱)"]
Poll --> Done["进程关闭 done"]
```

图示来源
- [docs/subsystems/shell.md:13-221](file://docs/subsystems/shell.md#L13-L221)
- [packages/shell/tool-bash/README.md:15-55](file://packages/shell/tool-bash/README.md#L15-L55)

章节来源
- [packages/shell/tool-bash/README.md:15-55](file://packages/shell/tool-bash/README.md#L15-L55)
- [docs/subsystems/shell.md:13-221](file://docs/subsystems/shell.md#L13-L221)

### PowerShell 执行器（dsh-pwsh-local）
- 每调用启动一次性 pwsh -NoLogo -NoProfile -NonInteractive -Command <command>
- UTF-8 输出固定，避免控制台代码页导致乱码
- 可执行路径解析：优先配置项，其次 PATH、Windows 安装位置、PowerShell 5.1 回退
- 行为镜像 Bash 执行器语义：工作目录、超时/取消分类、模型友好终端环境、后台增量输出
- Windows 特有：强制终止以 exit 1 报告，无信号；UTF-8 前缀语句限制（param/#requires/using 需脚本文件或包裹）

章节来源
- [packages/shell/pwsh-local/README.md:1-58](file://packages/shell/pwsh-local/README.md#L1-L58)

### 沙箱化 Bash（dsh-bash-sandbox）
- 替换 argv 为受限 runner 包装后的命令，交由底层沙箱后端（bwrap/Landlock/Seatbelt/ACL）执行
- 模式与文件效果
  - read-only：禁止写入（允许 /dev/null）
  - workspace-write：允许在工作区根与后端临时目录写入
  - danger-full-access：绕过沙箱，不经过 ctx.sandbox
- 拒绝与失败
  - 拒绝：stderr 匹配后端签名，标记 result.sandbox.denied=true，并附带 mode/enforcement
  - Runner 失败：spawn 阶段或规则命中，前台抛 SANDBOX_UNAVAILABLE，后台记录 runnerFailed
- 策略解析
  - 每次调用解析 SandboxExecutionPolicy（mode/workspaceRoot/sessionId），支持一次性严格放宽与审批

章节来源
- [packages/shell/bash-sandbox/README.md:1-89](file://packages/shell/bash-sandbox/README.md#L1-L89)
- [docs/subsystems/sandbox.md:9-156](file://docs/subsystems/sandbox.md#L9-L156)

### 子进程抽象（dsh-subprocess）
- 完全显式的 spawn spec：argv、cwd、stdio、graceMs、signal、env，无隐式默认
- 输出收集：CollectedOutput 带 truncated/spillPath；offset-based 增量读取，互不消费
- 终止与等待：terminate() 统一 SIGTERM→grace→SIGKILL 升级；waitForExit() 观察整棵进程树
- 退出事实：done 仅携带 exitCode/signal，原因分类由上层决定

章节来源
- [docs/subsystems/subprocess.md:13-240](file://docs/subsystems/subprocess.md#L13-L240)

### 工具管线（dsh-tools）
- ToolDefinition：schema + output + execute + finalizeContent + presentCall/presentResult
- 执行流水线：pre-execute → guards → execute → post-execute → finalizeContent → result
- 调度：parallel/exclusive；并发安全声明 isConcurrencySafe
- 事件：tools/change、tools/code-dispatch-log、tools/execute、tools/post-execute、tools/pre-execute、tools/result

章节来源
- [docs/subsystems/tools.md:9-152](file://docs/subsystems/tools.md#L9-L152)
- [docs/subsystems/tools.md:478-721](file://docs/subsystems/tools.md#L478-L721)

## 依赖关系分析
- 工具层依赖执行器契约；执行器依赖子进程抽象；沙箱执行器额外依赖沙箱策略与后端
- 模型侧工具将后台句柄适配到通用任务运行时，解耦会话与生命周期
- 平台相关实现（pwsh-local）与 POSIX（bash-local）共享同一契约，便于跨平台一致性

```mermaid
graph LR
ToolBash["dsh-tool-bash"] --> Exec["dsh-shell(契约)"]
ToolPwsh["dsh-tool-pwsh"] --> Exec
Exec --> Subproc["dsh-subprocess"]
Exec --> Sandbox["dsh-sandbox / policy"]
Exec --> Jobs["dsh-jobs(后台任务)"]
```

图示来源
- [packages/shell/README.md:1-20](file://packages/shell/README.md#L1-L20)
- [docs/subsystems/shell.md:1-12](file://docs/subsystems/shell.md#L1-L12)
- [docs/subsystems/subprocess.md:1-16](file://docs/subsystems/subprocess.md#L1-L16)
- [docs/subsystems/sandbox.md:1-12](file://docs/subsystems/sandbox.md#L1-L12)

## 性能与资源管理
- 输出边界与溢出
  - 前台 stdout 捕获预算可由受信任调用方提高；stderr 与后台始终使用执行器默认上限
  - 溢出时 text 保留尾部，完整流落盘 spillPath，readOutput 可恢复
- 超时与取消
  - 前台 run 融合配置超时与调用方 AbortSignal，timedOut 与 aborted 互斥且只报告首个原�
  - 后台 start 无执行器超时，需通过 job_kill 或组合销毁来终止
- 资源释放
  - 子进程服务 dispose 时终止所有受管进程并等待退出；executor 重载不影响后台进程
  - 沙箱 runner 失败在后台通过事实通道上报，前台直接抛错
- 编码与平台开销
  - PowerShell 固定 UTF-8 输出，避免重编码成本；避免不必要的 shell 层解析

章节来源
- [docs/subsystems/shell.md:105-221](file://docs/subsystems/shell.md#L105-L221)
- [docs/subsystems/subprocess.md:89-240](file://docs/subsystems/subprocess.md#L89-L240)
- [packages/shell/pwsh-local/README.md:26-37](file://packages/shell/pwsh-local/README.md#L26-L37)

## 调试与测试最佳实践
- 验证平台装配
  - 使用现有测试验证不同平台下 shell 栈的选择与禁用逻辑，确保 bundle 层正确门控
- 沙箱与权限
  - 通过沙箱拒绝标记与 runner 失败信息进行定位；确认策略模式与工作区根是否一致
- 输出与截断
  - 关注 lossy 标志与 spillPath，必要时从 spill 文件恢复完整输出
- 后台任务
  - 使用 job_output/job_list/job_kill 检查增量输出、状态与终止；注意后台无执行器超时
- 环境变量
  - 确认 DSH_* 由 registry 注入，不会被父进程污染；必要时用 list() 枚举贡献者

章节来源
- [apps/cli/tests/windows-shell.spec.ts:35-101](file://apps/cli/tests/windows-shell.spec.ts#L35-L101)
- [packages/shell/tool-bash/README.md:29-37](file://packages/shell/tool-bash/README.md#L29-L37)
- [docs/subsystems/shell.md:219-221](file://docs/subsystems/shell.md#L219-L221)

## 跨平台兼容性
- 平台选择
  - 同一 bundle 在不同平台启用不同的 shell 栈：POSIX 走 bash，Windows 走 pwsh
- 行为对齐
  - pwsh-local 刻意镜像 bash-local 的语义（工作目录、超时/取消分类、终端环境、后台增量输出）
- 差异点
  - Windows 强制终止报告 exit 1 且无信号；PowerShell 5.1 输入编码可能非 UTF-8；某些首行语句限制需要脚本文件或包裹

章节来源
- [apps/cli/tests/windows-shell.spec.ts:43-79](file://apps/cli/tests/windows-shell.spec.ts#L43-L79)
- [packages/shell/pwsh-local/README.md:26-37](file://packages/shell/pwsh-local/README.md#L26-L37)

## 故障排查指南
- 常见错误来源
  - 参数校验失败：command/description/timeoutMs/sandbox_permissions/justification 格式或组合错误
  - 背景执行不可用：未加载 jobs 或 tool 被禁用
  - 沙箱不可用：无可用后端或 runner 拒绝，前台抛 SANDBOX_UNAVAILABLE，后台记录 runnerFailed
  - 基础设施失败：spawn 失败、中止等，isError 为 true
- 诊断要点
  - 检查 result 中的 timedOut/aborted/signal/exitCode 与 stderr 尾部
  - 若 lossy=true，从 spillPath 获取完整输出
  - 沙箱场景查看 mode/denied/enforcement/runnerFailed
  - 后台任务通过 job_output 查看增量输出与完成详情

章节来源
- [packages/shell/tool-bash/README.md:121-139](file://packages/shell/tool-bash/README.md#L121-L139)
- [packages/shell/bash-sandbox/README.md:39-89](file://packages/shell/bash-sandbox/README.md#L39-L89)
- [docs/subsystems/shell.md:105-221](file://docs/subsystems/shell.md#L105-L221)

## 结论
该 Shell 工具集成为 Bash 与 PowerShell 提供了一致的执行契约、安全的受管环境、健壮的输出与错误模型、可扩展的沙箱策略与后台任务集成。通过显式子进程抽象与工具管线，开发者可以可靠地构建、调试和部署跨平台的 Shell 工具，并在安全与性能之间取得平衡。