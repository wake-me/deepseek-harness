---
kind: external_dependency
name: Anthropic Claude Agent SDK（含平台 payload）
slug: anthropic-claude-agent-sdk
category: external_dependency
category_hints:
    - auth_protocol
    - client_constraint
scope:
    - '**'
---

### Anthropic Claude Agent SDK
- 角色：dsh 通过 hooks 桥接 Claude Code 的钩子协议，并支持将 subagent 委派给 Claude Code/Codex。
- 集成方式：SDK 及其各平台专属 payload（darwin-arm64/x64、linux-arm64/musl、win32-arm64/x64 等）作为 optionalDependencies 随版本声明；项目所有者已授权分发这些 payload。