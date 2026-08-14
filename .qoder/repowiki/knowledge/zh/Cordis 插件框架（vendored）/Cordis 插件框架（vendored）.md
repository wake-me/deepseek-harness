---
kind: external_dependency
name: Cordis 插件框架（vendored）
slug: cordis
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### Cordis
- 角色：DeepSeek Harness 的底层运行时与插件编排框架，所有能力（模型、工具、会话日志、agent loop 等）均以插件形式挂载。
- 集成方式：源码 vendored 进 `vendor/`，以 `@deepseek-ai/*` scope 重新发布；通过 `cordis.yml` / `cordis.patch.yml` 组合包机制在运行时按序叠加插件树。
- 维护注意：上游 SHA 清单与同步流程由仓库自身管理，升级需走 vendor 同步脚本而非直接改源码。