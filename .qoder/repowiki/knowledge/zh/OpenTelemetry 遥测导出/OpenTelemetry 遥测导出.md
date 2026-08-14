---
kind: external_dependency
name: OpenTelemetry 遥测导出
slug: opentelemetry
category: external_dependency
category_hints:
    - sdk_real_api
scope:
    - '**'
---

### OpenTelemetry
- 角色：dsh 的遥测基础设施，用于导出 agent 运行期日志与指标。
- 集成方式：通过 `@opentelemetry/api` 与 `exporter-logs-otlp-http` 将日志经 OTLP HTTP 协议上报；具体 endpoint 由运行时配置注入。
- 使用约束：仅负责导出，不持有数据；需配合外部 OTLP 接收端部署。