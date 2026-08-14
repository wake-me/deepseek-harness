---
kind: configuration_system
name: 配置系统：Cordis 插件化装配 + Settings 命名空间分层解析
category: configuration_system
scope:
    - '**'
source_files:
    - packages/settings/settings/src/index.ts
    - packages/settings/settings-file/src/index.ts
    - apps/cli/src/args.ts
    - apps/cli/src/profile-boot.ts
    - examples/headless-agent/cordis.yml
    - docs/subsystems/settings.md
---

## 1. 使用的系统与方案

仓库采用两层配置体系：
- **应用装配层（Composition）**：基于 Cordis 框架，通过 `cordis.yml` 声明式注册插件、注入配置，并以 patch 列表形式叠加多层覆盖。CLI 入口 `apps/cli/src/profile-boot.ts` 将 bundle 层、profile 自身层、`$DSH_HOME/cordis.patch.yml` 用户层、`--patch` 覆盖层以及 `DSH_TELEMETRY_DISABLED` 开关按固定顺序组合为最终装配树。
- **运行时设置层（User Settings）**：由 `packages/settings/settings` 提供抽象 `SettingsProvider`，以“命名空间（namespace）+ schemastery schema”为单位注册；`packages/settings/settings-file` 实现 YAML/JSON 文件后端，默认路径 `$DSH_HOME/settings.yaml`，支持 chokidar 热重载与跨进程写锁。

两者分工明确：`cordis.yml` 决定“挂载哪些能力”，`settings.yaml` 决定“每个能力的用户级参数”。

## 2. 关键文件与包

- `packages/settings/settings/src/index.ts` — `SettingsProvider` 抽象基类、命名空间注册、三层合并（schema defaults → base → user）、变更事件、冲突检测（`expectedRevision`）、`deepEqualJson` 比较、`installSettingsSection` 辅助安装器。
- `packages/settings/settings-file/src/index.ts` — `FileSettingsProvider`，YAML/JSON 文档持久化、comment-preserving 增量写入、chokidar 监听、`withFileLock` 互斥、`prepareDocument` 自动创建空文档。
- `apps/cli/src/args.ts` — Commander 驱动的 `dsh` 命令行解析，区分 `profile` / `dump-config` / `plugin` 三种调用模式，`--patch` 重复收集。
- `apps/cli/src/profile-boot.ts` — 组装 profile 的 patch 栈（bundle → profile → home → overlays），注入 `DSH_LAUNCH_ENVIRONMENT_KEY` 和 `ctx.cmdlineArgs`，并启动 HMR 监听 `cordis.patch.yml` 与 `$DSH_HOME/cordis.patch.yml`。
- `examples/headless-agent/cordis.yml` — 示例装配，展示 `settings`、`credentials`、`llm-deepseek`、`subprocess`、`persistence` 等插件的声明式注册。
- `docs/subsystems/settings.md` — Settings 子系统的官方文档，描述命名空间、注册选项、descriptor、事件契约。

## 3. 架构与约定

### 3.1 装配层（Cordis Composition）
- 根配置文件统一命名为 `cordis.yml`，位于 profile 目录或示例根。
- 装配顺序严格固定：`bundlePatches`（来自 `package.json` 的 `dsh.profile.bundles`）→ `profile.patches` → `homePatches`（`$DSH_HOME/cordis.patch.yml`）→ `overlays`（`--patch` 传入）→ 遥测开关补丁。
- CLI 不消费内部参数：所有非 launcher 标志透传给被启动的应用，由注入的 app 插件自行解析。
- 运行时可热重载用户 patch 层（`watchUserPatches`），但 bundle 层在 reload 时保持在下方，不会被用户编辑覆盖。
- 遥测开关通过环境变量 `DSH_TELEMETRY_DISABLED` 生成一个 disable patch，任何非空值即关闭。

### 3.2 设置层（Settings Provider）
- 命名空间必须是 lowercase kebab-case（正则 `/^[a-z][a-z0-9-]*$/`），通过 `settingsNamespace()` 品牌化。
- 解析顺序：**schema 默认值** → 注册时的 `base`（composition entry 的子集）→ 用户文档中的该 namespace section。三者通过 `mergeLayers` 递归合并，数组与非对象直接替换。
- 写入路径：`update(patch)` 合并到用户层、`replace(section)` 全量替换、`mutate(ops[])` 对仅持有红acted 视图的 UI 暴露 path op（`set`/`unset`）。
- 并发安全：每 namespace 独立串行写队列；外部编辑通过 chokidar 触发 `publish`，内部写先 `persist` 再 `bumpRevision` 再 `commit`；跨进程写使用 `withFileLock`。
- 冲突检测：descriptor 携带单调 `revision`，写时可传 `expectedRevision`，不匹配则抛 `SettingsConflictError`。
- 变更通知：`settings/document-updated`（raw 层变化，含 inherited→overridden 语义变化）与 `settings/updated`（resolved 值深相等才不发）。监听失败被捕获并记录，INVARIANT 错误除外。
- 密钥处理：schema 中标记 `role('secret')` 的字段在 `describe({ redactSecrets: true })` 时被剥离并枚举到 `secrets` 槽位，wire 表面必须启用此选项。
- 生命周期：`installSettingsSection(ctx, ns, schema, entry, hooks)` 让消费者在 settings provider 存在时从 `ctx.settings.register` 获取 scope，provider 卸载时回退到 composition entry 并重新评估。

### 3.3 文件存储约定
- 默认文档路径：`resolveDshHome() + '/settings.yaml'`，扩展名 `.yaml/.yml/.json` 三选一。
- 权限：目录 `0o700`，文件 `0o600`，owner-only。
- YAML 写入使用 `yaml.Document` 做 comment-preserving 的 leaf-level diff（`patchNode`），避免破坏用户注释。
- JSON 写入直接 `JSON.stringify(root, null, 2) + '\n'`。

## 4. 约定与约束

| 约束 | 来源/证据 |
|---|---|
| 命名空间必须是小写 kebab-case | `settingsNamespace` 用正则校验，非法时抛 `TypeError` |
| 写入数据必须 JSON 兼容（plain object/array/string/number/boolean/null，无循环引用、无非有限数） | `cloneJsonShaped` 在持久化前逐层校验，非 JSON 类型带路径拒绝 |
| 用户文档根必须是 map（namespace → section） | `parse` 中显式检查并抛 `TypeError` |
| 外部编辑热重载失败不崩溃进程，仅保留 last good document | `refresh` 捕获除 INVARIANT 外的异常并 warn |
| 写操作必须先持久化再 commit，且受 per-namespace 串行队列保护 | `write` 中 `await this.persist(ns, section)` 后再 `bumpRevision`/`commit` |
| 跨进程写使用文件锁 | `persistSection` 包裹在 `withFileLock(this.spec.filename, ...)` 中 |
| wire 表面必须开启 `redactSecrets` | 文档强制要求 “Every wire surface MUST pass this” |
| 配置 dump 不接受 app 参数 | `parseDshArgs` 中 `mode === 'dump-config'` 且 `args.length > 0` 时报错 |
| `--dump-default-config` 与 `--patch` 互斥 | `resolveBoot` 中显式报错 |
| 遥测开关优先级最高（作为 overlay 最后追加） | `composeProfile` 在 `composedOverlays` 末尾 push telemetry patch |
| 用户 patch 层（`cordis.patch.yml` 与 `$DSH_HOME/cordis.patch.yml`）在运行时可热重载 | `watchUserPatches` 在 `runProfile` 中无条件启动 |

## 5. 总结

DeepSeek Harness 的配置系统以 Cordis 插件装配为骨架、以 Settings 命名空间为血肉：`cordis.yml` 声明“运行什么”，`settings.yaml` 声明“如何运行”，两者通过 CLI 的 patch 叠加机制与 `installSettingsSection` 的 fallback 机制协同工作，形成可热重载、可审计、可跨进程协作的多层配置体系。