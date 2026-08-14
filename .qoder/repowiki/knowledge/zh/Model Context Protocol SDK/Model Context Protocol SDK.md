---
kind: external_dependency
name: Model Context Protocol SDK
slug: model-context-protocol
category: external_dependency
category_hints:
    - sdk_real_api
scope:
    - '**'
---

### Model Context Protocol (MCP)
- 角色：dsh 的 MCP 客户端/服务端实现，允许 agent 发现并调用外部 MCP 服务提供的工具与资源。
- 集成方式：通过 `packages/mcp` 暴露为 dsh 的能力 provider，遵循 MCP 标准协议进行通信。