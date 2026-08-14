# Shell 沙箱安全

<cite>
**本文引用的文件**
- [packages/sandbox/sandbox/src/index.ts](file://packages/sandbox/sandbox/src/index.ts)
- [packages/sandbox/sandbox-local/README.md](file://packages/sandbox/sandbox-local/README.md)
- [native/landlock-run/packages/entry/src/index.ts](file://native/landlock-run/packages/entry/src/index.ts)
- [native/landlock-run/README.md](file://native/landlock-run/README.md)
- [packages/shell/bash-sandbox/src/index.ts](file://packages/shell/bash-sandbox/src/index.ts)
- [docs/subsystems/shell.md](file://docs/subsystems/shell.md)
- [docs/subsystems/sandbox.md](file://docs/subsystems/sandbox.md)
- [docs/subsystems/subprocess.md](file://docs/subsystems/subprocess.md)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能与资源限制](#性能与资源限制)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录：测试与验证](#附录：测试与验证)

## 简介
本文件系统性阐述 DeepSeek Harness 中 Shell 工具的执行沙箱安全机制，重点覆盖 Linux 平台上的 Landlock 内核模块使用、文件系统访问控制、进程隔离策略，以及跨平台的统一抽象。文档面向不同技术背景的读者，提供从高层架构到代码级实现的渐进式说明，并给出常见威胁的防护建议、最佳实践与审计方法，最后提供可操作的测试与验证指引。

## 项目结构
围绕 Shell 沙箱的关键目录与职责如下：
- 沙箱抽象与服务契约：定义模式、策略、执行结果与错误语义，屏蔽平台差异。
- 本地实现选择器：按平台选择 bwrap/Landlock（Linux）、Seatbelt（macOS）、ACL 受限令牌（Windows），并缓存能力探测结果。
- Landlock 启动器：自限制后执行的可执行二进制，配合 JS 入口封装 CLI 契约与功能探测。
- Bash 沙箱执行器：在本地 bash 执行基础上叠加沙箱包装，负责策略注入、失败分类与结果标注。
- Shell 与子进程服务：提供命令解析、环境变量管理、输出收集、超时与终止等通用能力。

```mermaid
graph TB
subgraph "Shell 执行层"
BSE["Bash 沙箱执行器<br/>packages/shell/bash-sandbox"]
SHELL["Shell 抽象与类型<br/>docs/subsystems/shell.md"]
SUBP["子进程服务<br/>docs/subsystems/subprocess.md"]
end
subgraph "沙箱抽象与本地实现"
SB_IF["沙箱接口与策略<br/>packages/sandbox/sandbox/src/index.ts"]
SB_LOCAL["本地提供者选择器<br/>packages/sandbox/sandbox-local/README.md"]
end
subgraph "Linux Landlock"
LK_ENTRY["JS 入口与探针<br/>native/landlock-run/packages/entry/src/index.ts"]
LK_BIN["Landlock 启动器<br/>native/landlock-run/README.md"]
end
BSE --> SB_IF
BSE --> SHELL
SHELL --> SUBP
SB_IF --> SB_LOCAL
SB_LOCAL --> LK_ENTRY
LK_ENTRY --> LK_BIN
```

**图示来源**
- [packages/sandbox/sandbox/src/index.ts:158-176](file://packages/sandbox/sandbox/src/index.ts#L158-L176)
- [packages/sandbox/sandbox-local/README.md:1-18](file://packages/sandbox/sandbox-local/README.md#L1-L18)
- [native/landlock-run/packages/entry/src/index.ts:21-41](file://native/landlock-run/packages/entry/src/index.ts#L21-L41)
- [native/landlock-run/README.md:1-10](file://native/landlock-run/README.md#L1-L10)
- [packages/shell/bash-sandbox/src/index.ts:44-86](file://packages/shell/bash-sandbox/src/index.ts#L44-L86)
- [docs/subsystems/shell.md:14-16](file://docs/subsystems/shell.md#L14-L16)
- [docs/subsystems/subprocess.md:89-129](file://docs/subsystems/subprocess.md#L89-L129)

**章节来源**
- [docs/subsystems/sandbox.md:9-40](file://docs/subsystems/sandbox.md#L9-L40)
- [docs/subsystems/shell.md:14-16](file://docs/subsystems/shell.md#L14-L16)
- [docs/subsystems/subprocess.md:89-129](file://docs/subsystems/subprocess.md#L89-L129)

## 核心组件
- 沙箱抽象与策略
  - 模式：只读、工作区写入、危险全访问；仅前两种进入受控路径。
  - 策略：每调用一次解析，携带工作区根与会话标识，供后端做会话级隔离。
  - 强制完整性：full/partial/unusable，避免高估边界。
- 本地提供者选择器
  - Linux：优先 bwrap，其次 Landlock；macOS：Seatbelt；Windows：ACL 受限令牌。
  - 功能探测与缓存；不可用时严格失败关闭。
- Landlock 启动器
  - 自限制后 exec 被包装命令；规则集继承至子进程；内核不支持则退出而不运行命令。
  - JS 入口提供 launcherPath、grantArgs、probe 与 CLI 契约常量。
- Bash 沙箱执行器
  - 将 shell 命令通过 ctx.sandbox 包装为受限 argv；区分“沙箱拒绝”和“启动器失败”。
  - 报告 mode、denied、enforcement、runnerFailed 等事实。
- Shell 与子进程服务
  - 明确的工作目录、stdio 模式、超时与终止、输出收集与溢出转储。
  - 清理 DSH_* 环境，合并可信变量，避免凭据泄露。

**章节来源**
- [packages/sandbox/sandbox/src/index.ts:23-72](file://packages/sandbox/sandbox/src/index.ts#L23-L72)
- [packages/sandbox/sandbox/src/index.ts:90-144](file://packages/sandbox/sandbox/src/index.ts#L90-L144)
- [packages/sandbox/sandbox-local/README.md:1-18](file://packages/sandbox/sandbox-local/README.md#L1-L18)
- [native/landlock-run/packages/entry/src/index.ts:21-41](file://native/landlock-run/packages/entry/src/index.ts#L21-L41)
- [native/landlock-run/README.md:1-10](file://native/landlock-run/README.md#L1-L10)
- [packages/shell/bash-sandbox/src/index.ts:44-114](file://packages/shell/bash-sandbox/src/index.ts#L44-L114)
- [docs/subsystems/shell.md:14-16](file://docs/subsystems/shell.md#L14-L16)
- [docs/subsystems/subprocess.md:89-129](file://docs/subsystems/subprocess.md#L89-L129)

## 架构总览
下图展示一次受限 Shell 执行的端到端流程：工具层请求 → 策略解析 → 沙箱提供者包装 → 本地执行器启动 → 子进程运行 → 结果标注与返回。

```mermaid
sequenceDiagram
participant Tool as "工具层"
participant Shell as "Bash 沙箱执行器"
participant Svc as "沙箱抽象(ctx.sandbox)"
participant Prov as "本地提供者(选择器)"
participant Lk as "Landlock 启动器"
participant Proc as "子进程(bash -c)"
Tool->>Shell : resolve(request)
Shell->>Svc : confine(['bash','-c',cmd], policy)
Svc->>Prov : 选择并缓存 runner
Prov-->>Svc : ConfinedArgv(argv, enforcement, denialSignatures, rules)
Svc-->>Shell : ConfinedArgv
Shell->>Proc : spawn(argv)
Proc-->>Shell : 输出/退出码/信号
Shell->>Shell : 分类 runner 失败 vs 沙箱拒绝
Shell-->>Tool : ShellRunResult + sandbox 事实
```

**图示来源**
- [packages/shell/bash-sandbox/src/index.ts:84-114](file://packages/shell/bash-sandbox/src/index.ts#L84-L114)
- [packages/sandbox/sandbox/src/index.ts:158-176](file://packages/sandbox/sandbox/src/index.ts#L158-L176)
- [packages/sandbox/sandbox-local/README.md:1-18](file://packages/sandbox/sandbox-local/README.md#L1-L18)
- [native/landlock-run/packages/entry/src/index.ts:101-127](file://native/landlock-run/packages/entry/src/index.ts#L101-L127)

## 详细组件分析

### 沙箱抽象与策略（SandboxProvider）
- 模式与范围
  - read-only：仅允许必要写入点（如 /dev/null）。
  - workspace-write：允许在工作区根与后端临时区域写入。
  - danger-full-access：不进入受控路径，直接原样执行。
- 策略与根
  - 每次调用解析策略，携带工作区根与会话 ID，用于后端会话级隔离。
- 强制完整性
  - full/partial 描述实际可达到的约束程度，避免误判安全性。
- 失败关闭
  - 无可用后端时抛出特定错误，禁止静默降级为未受控执行。

```mermaid
classDiagram
class SandboxProvider {
+confine(argv, policy) ConfinedArgv
}
class ConfinedArgv {
+argv : string[]
+enforcement : "full"|"partial"
+denialSignatures : string[]
+runnerFailureRules : RunnerFailureRule[]
}
class SandboxExecutionPolicy {
+mode : "read-only"|"workspace-write"|"danger-full-access"
+workspaceRoot : string
+sessionId? : SessionId
}
SandboxProvider --> ConfinedArgv : "返回"
SandboxProvider --> SandboxExecutionPolicy : "消费"
```

**图示来源**
- [packages/sandbox/sandbox/src/index.ts:23-72](file://packages/sandbox/sandbox/src/index.ts#L23-L72)
- [packages/sandbox/sandbox/src/index.ts:90-144](file://packages/sandbox/sandbox/src/index.ts#L90-L144)

**章节来源**
- [packages/sandbox/sandbox/src/index.ts:23-72](file://packages/sandbox/sandbox/src/index.ts#L23-L72)
- [packages/sandbox/sandbox/src/index.ts:90-144](file://packages/sandbox/sandbox/src/index.ts#L90-L144)

### 本地提供者选择器（dsh-sandbox-local）
- 平台适配
  - Linux：bwrap → Landlock；macOS：Seatbelt；Windows：ACL 受限令牌。
- 功能探测与缓存
  - 对候选 runner 进行功能探测，结果缓存于提供者生命周期内。
- 失败关闭与诊断
  - 无法启用受控执行时严格失败；携带 runner 失败规则与拒绝特征，便于上层区分“未运行”和“被拒绝”。

**章节来源**
- [packages/sandbox/sandbox-local/README.md:1-18](file://packages/sandbox/sandbox-local/README.md#L1-L18)

### Landlock 启动器与 JS 入口
- 启动器行为
  - 自限制后 exec 被包装命令；规则集继承至所有子进程；内核不支持则退出而不运行命令。
- JS 入口 API
  - launcherPath：定位平台二进制。
  - grantArgs：生成 --ro/--rw 参数列表。
  - probe：以短超时运行 --probe，判断 full/partial/unusable。
  - 常量：LAUNCHER_BIN、LAUNCHER_FAILURE_EXIT=125。
- CLI 契约
  - 由 JS 入口维护，避免消费者自行拼写标志或解析输出。

```mermaid
flowchart TD
A["调用 probe()"] --> B["spawnSync(launcher, ['--probe'])"]
B --> C{"status == 0 ?"}
C --> |否| U["返回 unusable"]
C --> |是| D{"输出包含 partial ?"}
D --> |是| P["返回 partial"]
D --> |否| F["返回 full"]
```

**图示来源**
- [native/landlock-run/packages/entry/src/index.ts:101-127](file://native/landlock-run/packages/entry/src/index.ts#L101-L127)

**章节来源**
- [native/landlock-run/README.md:1-10](file://native/landlock-run/README.md#L1-L10)
- [native/landlock-run/packages/entry/src/index.ts:21-41](file://native/landlock-run/packages/entry/src/index.ts#L21-L41)
- [native/landlock-run/packages/entry/src/index.ts:101-127](file://native/landlock-run/packages/entry/src/index.ts#L101-L127)

### Bash 沙箱执行器（dsh-bash-sandbox）
- 策略注入
  - 在 resolve 阶段注入 per-call 的沙箱策略；若为危险全访问则绕过受控路径。
- 受限执行
  - 通过 ctx.sandbox.confine 将 bash -c 命令包装为受限 argv；交由本地执行器启动。
- 失败分类
  - 先判定 runner 失败（命令未运行），再判定沙箱拒绝（命令运行但被阻止）。
  - 结果附带 mode、denied、enforcement、runnerFailed 等事实。
- 后台进程
  - start 同样注入策略，并在进程结束时回填 sandbox 事实。

```mermaid
sequenceDiagram
participant T as "工具层"
participant E as "Bash 沙箱执行器"
participant S as "ctx.sandbox"
participant L as "本地执行器"
participant P as "子进程"
T->>E : run(spec)
alt 危险全访问
E->>L : run(spec)
L-->>E : 结果
E-->>T : 结果 + {mode : full-access}
else 受控执行
E->>S : confine(['bash','-c',cmd], policy)
S-->>E : ConfinedArgv
E->>L : run(Argv)
L-->>E : 结果(exitCode/stderr)
E->>E : 分类 runner 失败 vs 拒绝
E-->>T : 结果 + sandbox{mode, denied, enforcement, runnerFailed?}
end
```

**图示来源**
- [packages/shell/bash-sandbox/src/index.ts:84-114](file://packages/shell/bash-sandbox/src/index.ts#L84-L114)
- [packages/shell/bash-sandbox/src/index.ts:116-167](file://packages/shell/bash-sandbox/src/index.ts#L116-L167)

**章节来源**
- [packages/shell/bash-sandbox/src/index.ts:44-114](file://packages/shell/bash-sandbox/src/index.ts#L44-L114)
- [packages/shell/bash-sandbox/src/index.ts:116-167](file://packages/shell/bash-sandbox/src/index.ts#L116-L167)

### Shell 与子进程服务
- 执行规格
  - 明确指定 argv、cwd、stdio、graceMs、AbortSignal、env，避免隐式默认。
- 输出收集
  - 支持内存上限与溢出转储文件，保证可恢复性。
- 终止与回收
  - 统一的 terminate 升级序列（SIGTERM→grace→SIGKILL），跨平台树级终止。
- 环境变量
  - 清理 DSH_* 并合并可信快照，防止凭据泄露与状态污染。

**章节来源**
- [docs/subsystems/shell.md:14-16](file://docs/subsystems/shell.md#L14-L16)
- [docs/subsystems/subprocess.md:89-129](file://docs/subsystems/subprocess.md#L89-L129)
- [docs/subsystems/subprocess.md:132-174](file://docs/subsystems/subprocess.md#L132-L174)
- [docs/subsystems/subprocess.md:221-239](file://docs/subsystems/subprocess.md#L221-L239)

## 依赖关系分析
- 耦合与内聚
  - Bash 沙箱执行器依赖沙箱抽象与本地提供者选择器，内聚了策略注入与结果标注。
  - 本地提供者选择器与 Landlock 启动器解耦，通过 CLI 契约交互，降低漂移风险。
- 外部依赖
  - Linux 平台依赖内核 Landlock 能力；macOS 依赖 Seatbelt；Windows 依赖 ACL 受限令牌。
- 循环依赖
  - 各层单向依赖，无循环引用。

```mermaid
graph LR
BashSB["Bash 沙箱执行器"] --> SBIF["沙箱抽象"]
SBIF --> SBLOC["本地提供者选择器"]
SBLOC --> LKJS["Landlock JS 入口"]
LKJS --> LKBIN["Landlock 启动器"]
BashSB --> ShellDoc["Shell 抽象"]
ShellDoc --> SubpDoc["子进程服务"]
```

**图示来源**
- [packages/shell/bash-sandbox/src/index.ts:44-86](file://packages/shell/bash-sandbox/src/index.ts#L44-L86)
- [packages/sandbox/sandbox/src/index.ts:158-176](file://packages/sandbox/sandbox/src/index.ts#L158-L176)
- [packages/sandbox/sandbox-local/README.md:1-18](file://packages/sandbox/sandbox-local/README.md#L1-L18)
- [native/landlock-run/packages/entry/src/index.ts:21-41](file://native/landlock-run/packages/entry/src/index.ts#L21-L41)

**章节来源**
- [packages/sandbox/sandbox/src/index.ts:158-176](file://packages/sandbox/sandbox/src/index.ts#L158-L176)
- [packages/sandbox/sandbox-local/README.md:1-18](file://packages/sandbox/sandbox-local/README.md#L1-L18)
- [native/landlock-run/packages/entry/src/index.ts:21-41](file://native/landlock-run/packages/entry/src/index.ts#L21-L41)

## 性能与资源限制
- 启动开销
  - Landlock 启动器以短超时进行功能探测，结果缓存，避免重复开销。
- 输出与 I/O
  - 子进程输出采用有界缓冲与溢出转储，避免内存膨胀；stderr 可用于诊断但不影响主输出预算。
- 终止与回收
  - 统一的 tree-scoped 终止策略，确保辅助进程不会泄漏；graceMs 控制优雅退出窗口。
- 网络与进程可见性
  - 当前沙箱模式聚焦文件系统效果；网络与进程可见性不在该词汇表内，需结合其他子系统或容器化方案。

[本节为通用指导，无需具体文件引用]

## 故障排查指南
- 常见错误与归�
  - SANDBOX_UNAVAILABLE：无可用后端或 runner 不可用；检查平台能力、依赖安装与权限。
  - runnerFailed：启动器在命令执行前失败；根据 runnerFailureRules 匹配 stderr 与退出码定位。
  - denied：命令运行但被沙箱拒绝；根据 denialSignatures 识别具体拒绝原因。
- 诊断要点
  - 关注 enforcement 字段：partial 表示部分约束生效，不应视为完全边界。
  - 检查工作区根与会话隔离是否按预期设置。
  - 查看子进程输出与溢出文件，确认是否被截断。
- 处理建议
  - 对于危险全访问模式，仅在明确授权且必要时使用。
  - 调整策略或申请一次性放宽，并通过审批流程记录。

**章节来源**
- [packages/sandbox/sandbox/src/index.ts:118-144](file://packages/sandbox/sandbox/src/index.ts#L118-L144)
- [packages/shell/bash-sandbox/src/index.ts:107-114](file://packages/shell/bash-sandbox/src/index.ts#L107-L114)
- [packages/shell/bash-sandbox/src/index.ts:150-167](file://packages/shell/bash-sandbox/src/index.ts#L150-L167)

## 结论
DeepSeek Harness 通过分层抽象与平台适配，实现了 Shell 工具的细粒度沙箱隔离。Linux 上基于 Landlock 的自限制启动器提供了强约束的文件系统访问控制；跨平台选择器确保在不具备完整能力时仍能提供最大可用保护并严格失败关闭。Bash 沙箱执行器将策略注入、失败分类与结果标注整合，使上层工具获得一致的安全语义。配合子进程服务的资源限制与环境清理，整体形成了可审计、可测试、可扩展的沙箱体系。

[本节为总结，无需具体文件引用]

## 附录：测试与验证
- 能力探测
  - 使用 JS 入口的 probe 函数验证 Landlock 可用性，并记录 full/partial/unusable 结果。
- 单元测试与集成测试
  - 针对 bash-sandbox 的 landlock/bwrap/seatbelt 用例，覆盖 runner 失败、拒绝与正常路径。
  - 校验策略解析、工作区根、会话隔离与输出截断行为。
- 渗透测试建议
  - 构造命令注入、路径遍历、权限提升场景，验证是否被沙箱拒绝或被标记为 runner 失败。
  - 尝试越权访问工作区外路径、敏感系统目录与临时目录，确认仅允许白名单生效。
- 漏洞扫描与审计
  - 定期扫描依赖与二进制包，确保 Landlock 启动器版本与 CLI 契约一致。
  - 审计策略配置与审批日志，确保危险全访问模式的使用可追溯。
- 回归与快照
  - 利用现有 e2e 快照与回归用例，确保新变更不破坏既有安全语义。

[本节为通用指导，无需具体文件引用]