---
kind: external_dependency
name: Agent Client Protocol SDK
slug: agent-client-protocol
category: external_dependency
category_hints:
    - sdk_real_api
scope:
    - '**'
---

### Agent Client Protocol (ACP)
- 角色：dsh 的 ACP 服务器实现，对外暴露标准化接口供其他 agent 或客户端接入。
- 集成方式：`packages/acp` 提供 ACP 协议栈，配合 `examples/acp-agent` 演示用法。