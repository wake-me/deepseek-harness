---
kind: external_dependency
name: E2B 远程沙箱 SDK
slug: e2b
category: external_dependency
category_hints:
    - sdk_real_api
scope:
    - '**'
---

### E2B
- 角色：为 dsh 提供远程代码执行环境（文件系统、子进程、PTY 终端），使 Bash、LSP、Code Mode 等能力可整体迁移到云端沙箱。
- 集成方式：`packages/e2b/e2b`、`fs-e2b`、`subprocess-e2b` 三个包封装 e2b SDK，作为 fs/shell/subprocess 能力的 provider 实现。
- 使用约束：需配置 E2B API key；远程沙箱中文件系统和进程提供方共享同一执行上下文，切换 provider 会联动影响多个子系统。