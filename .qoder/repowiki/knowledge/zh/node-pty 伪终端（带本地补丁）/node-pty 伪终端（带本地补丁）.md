---
kind: external_dependency
name: node-pty 伪终端（带本地补丁）
slug: node-pty
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### node-pty
- 角色：提供 PTY 伪终端能力，支撑 dsh 的持久终端、shell 交互等功能。
- 使用约束：原生模块，构建时需对应平台的编译工具链。