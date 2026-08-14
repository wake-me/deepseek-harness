# WebSocket API

<cite>
**本文引用的文件**
- [packages/client/connection/src/index.ts](file://packages/client/connection/src/index.ts)
- [packages/client/connection/src/websocket-downlink.ts](file://packages/client/connection/src/websocket-downlink.ts)
- [packages/client/connection/src/api-path.ts](file://packages/client/connection/src/api-path.ts)
- [packages/client/connection/src/client/web-api-client.ts](file://packages/client/connection/src/client/web-api-client.ts)
- [packages/host/apiproxy/src/api/events.schema.ts](file://packages/host/apiproxy/src/api/events.schema.ts)
- [packages/host/apiproxy/src/api/rpc.schema.ts](file://packages/host/apiproxy/src/api/rpc.schema.ts)
- [packages/host/apiproxy/src/fetch/handler.ts](file://packages/host/apiproxy/src/fetch/handler.ts)
- [packages/client/runtime/src/client/sessions/manager.ts](file://packages/client/runtime/src/client/sessions/manager.ts)
- [packages/client/runtime/src/client/sessions/session.ts](file://packages/client/runtime/src/client/sessions/session.ts)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能与连接池](#性能与连接池)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录：客户端实现要点](#附录客户端实现要点)

## 简介
本文件面向需要接入实时通信的开发者，系统化说明本项目中基于 WebSocket 的事件下行通道。内容涵盖：
- 连接建立与升级路径（HTTP GET 到 WebSocket）
- 消息协议与序列化格式（RPC 信封 + 事件帧）
- 事件订阅机制（Mux 与 Host 两类事件流）
- 会话事件流、智能体状态变更与工具执行进度的推送方式
- 连接管理、错误处理与重连策略
- 客户端完整实现要点与最佳实践
- 连接复用与性能优化建议

## 项目结构
WebSocket 相关能力集中在 client-connection 插件与 host apiproxy 之间：
- 服务端侧：注册 /api HTTP 路由与两个 WebSocket 升级端点，负责鉴权、升级与帧泵送
- 客户端侧：浏览器通过 fetch 发起 RPC，通过 WebSocket 接收 Mux/Host 事件流
- 协议层：统一使用 RPC 信封包裹事件帧，并使用 schema 校验

```mermaid
graph TB
subgraph "浏览器"
C["WebApiClient<br/>openMux/openHost"]
end
subgraph "主机服务"
R["/api 路由<br/>信任检查/426 Upgrade"]
W["WebSocketDownlinks<br/>handleMux/handleHost"]
E["ApiProxy.events.mux/host<br/>事件源"]
end
C --> |GET /api/events.mux -> 426 Upgrade| R
C --> |WS 升级| R
R --> W
W --> E
E --> W
W --> C
```

**图示来源**
- [packages/client/connection/src/index.ts:130-195](file://packages/client/connection/src/index.ts#L130-L195)
- [packages/client/connection/src/websocket-downlink.ts:64-82](file://packages/client/connection/src/websocket-downlink.ts#L64-L82)
- [packages/client/connection/src/client/web-api-client.ts:18-32](file://packages/client/connection/src/client/web-api-client.ts#L18-L32)

**章节来源**
- [packages/client/connection/src/index.ts:130-195](file://packages/client/connection/src/index.ts#L130-L195)
- [packages/client/connection/src/api-path.ts:7-14](file://packages/client/connection/src/api-path.ts#L7-L14)

## 核心组件
- WebApiClient（浏览器端）
  - 使用 fetch 进行上行 RPC
  - 为每个事件流维护一个 WebSocket 连接（downlink-only），仅接收服务器推送
  - 解析并校验 RPC 信封与事件帧，按类型分发
- WebSocketDownlinks（主机端）
  - 持有 ws.Server，处理 /api/events.mux 与 /api/events.host 的升级
  - 将 ApiProxy 的事件迭代器泵送到 WebSocket，失败时发送 stream/error 后关闭
- 路由与鉴权（index.ts）
  - 对 /api 请求进行可信来源校验
  - 对 /api/events.* 的 GET 返回 426 并要求 Upgrade
  - 注册 WebSocket 升级处理器，并在不可信来源时拒绝升级

**章节来源**
- [packages/client/connection/src/client/web-api-client.ts:1-92](file://packages/client/connection/src/client/web-api-client.ts#L1-L92)
- [packages/client/connection/src/websocket-downlink.ts:1-154](file://packages/client/connection/src/websocket-downlink.ts#L1-L154)
- [packages/client/connection/src/index.ts:130-195](file://packages/client/connection/src/index.ts#L130-L195)

## 架构总览
下图展示从浏览器到主机的完整握手与事件流转过程，包括鉴权、升级、帧泵送与错误传播。

```mermaid
sequenceDiagram
participant B as "浏览器 WebApiClient"
participant S as "主机 /api 路由"
participant D as "WebSocketDownlinks"
participant A as "ApiProxy.events"
B->>S : GET /api/events.mux
S-->>B : 426 Upgrade Required (Upgrade : websocket)
B->>S : WS 升级请求
S->>S : 可信来源校验
alt 可信
S->>D : handleMux(req, socket, head)
D->>A : events.mux({rpcId}, signal)
loop 事件流
A-->>D : RpcRequest<MuxFrame>
D-->>B : JSON ServerRequest(含 MuxFrame)
end
else 不可信
S-->>B : 403 Forbidden
end
```

**图示来源**
- [packages/client/connection/src/index.ts:150-194](file://packages/client/connection/src/index.ts#L150-L194)
- [packages/client/connection/src/websocket-downlink.ts:64-82](file://packages/client/connection/src/websocket-downlink.ts#L64-L82)
- [packages/client/connection/src/client/web-api-client.ts:18-32](file://packages/client/connection/src/client/web-api-client.ts#L18-L32)

## 详细组件分析

### 连接建立与升级流程
- 浏览器端通过 openMux/openHost 构造 URL，将 http(s) 切换为 ws(s)，创建 WebSocket 连接到 /api/events.mux 或 /api/events.host
- 若以 HTTP GET 访问，服务端返回 426 并要求 Upgrade；浏览器随后发起 WS 升级
- 主机端在 index.ts 中对请求进行可信来源校验，通过后交由 WebSocketDownlinks 处理升级
- Downlinks 在升级后立即监听首次 message，若收到任何上游消息则立即关闭（downlink-only，禁止上行）

```mermaid
flowchart TD
Start(["开始"]) --> Check["检查请求方法"]
Check --> |GET| Return426["返回 426 要求 Upgrade"]
Check --> |WS 升级| Trust{"可信来源?"}
Trust --> |否| Reject["403 拒绝"]
Trust --> |是| Upgrade["ws.Server.handleUpgrade"]
Upgrade --> FirstMsg{"是否收到消息?"}
FirstMsg --> |是| Close["关闭连接(1008 downlink only)"]
FirstMsg --> |否| Pump["启动帧泵送"]
Pump --> End(["结束"])
```

**图示来源**
- [packages/client/connection/src/index.ts:150-194](file://packages/client/connection/src/index.ts#L150-L194)
- [packages/client/connection/src/websocket-downlink.ts:105-115](file://packages/client/connection/src/websocket-downlink.ts#L105-L115)

**章节来源**
- [packages/client/connection/src/client/web-api-client.ts:34-90](file://packages/client/connection/src/client/web-api-client.ts#L34-L90)
- [packages/client/connection/src/index.ts:150-194](file://packages/client/connection/src/index.ts#L150-L194)
- [packages/client/connection/src/websocket-downlink.ts:105-115](file://packages/client/connection/src/websocket-downlink.ts#L105-L115)

### 消息协议与序列化格式
- 传输单元：RpcRequest<Frame>，包含 rpcId 与 payload
- Frame 分为两类：
  - MuxFrame：会话级事件流（如会话新增、消息增量、工具执行进度等）
  - HostFrame：主机级事件流（如全局状态、系统通知等）
- 两端均使用 schema 校验：
  - 客户端使用 serverRequestSchema 与 muxFrameSchema/hostFrameSchema 解析
  - 服务端使用 events.schema 定义事件类型与错误帧
- 错误帧：type 为 stream/error，携带标准 RpcError（code/message/details）

```mermaid
classDiagram
class RpcRequest {
+string rpcId
+Frame payload
}
class MuxFrame {
+string type
+object data
}
class HostFrame {
+string type
+object data
}
class RpcError {
+string code
+string message
+object details
}
RpcRequest --> MuxFrame : "payload"
RpcRequest --> HostFrame : "payload"
MuxFrame <|-- ErrorFrame : "type='stream/error'"
HostFrame <|-- ErrorFrame : "type='stream/error'"
```

**图示来源**
- [packages/host/apiproxy/src/api/rpc.schema.ts](file://packages/host/apiproxy/src/api/rpc.schema.ts)
- [packages/host/apiproxy/src/api/events.schema.ts:66-92](file://packages/host/apiproxy/src/api/events.schema.ts#L66-L92)
- [packages/client/connection/src/client/web-api-client.ts:51-63](file://packages/client/connection/src/client/web-api-client.ts#L51-L63)

**章节来源**
- [packages/host/apiproxy/src/api/events.schema.ts:66-92](file://packages/host/apiproxy/src/api/events.schema.ts#L66-L92)
- [packages/client/connection/src/client/web-api-client.ts:51-63](file://packages/client/connection/src/client/web-api-client.ts#L51-L63)

### 事件订阅机制与会话事件流
- 两条独立的下行通道：
  - /api/events.mux：会话维度事件（会话生命周期、消息、工具调用进度等）
  - /api/events.host：主机维度事件（全局状态、系统通知等）
- 客户端通过 openMux/openHost 分别获取 AsyncIterable<RpcRequest<...>>，逐条消费
- 当底层事件源抛出异常时，服务端会发送一条 stream/error 帧后关闭连接，客户端需据此触发重连

```mermaid
sequenceDiagram
participant C as "客户端"
participant S as "服务端"
participant E as "事件源"
C->>S : 打开 Mux 通道
S->>E : events.mux()
loop 正常事件
E-->>S : MuxFrame
S-->>C : RpcRequest{payload : MuxFrame}
end
opt 事件源异常
E-->>S : 抛出异常
S-->>C : RpcRequest{payload : stream/error}
S-->>C : 关闭连接
end
```

**图示来源**
- [packages/client/connection/src/websocket-downlink.ts:118-137](file://packages/client/connection/src/websocket-downlink.ts#L118-L137)
- [packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)

**章节来源**
- [packages/client/connection/src/client/web-api-client.ts:18-32](file://packages/client/connection/src/client/web-api-client.ts#L18-L32)
- [packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)

### 智能体状态变更与工具执行进度
- 会话事件流（Mux）承载智能体运行过程中的关键状态变化与工具执行进度，例如：
  - 会话新增/更新
  - 消息增量（文本、图片、代码块等）
  - 工具调用开始/完成/失败
  - 推理/思考片段
- 这些事件由后端事件源产生，经 WebSocketDownlinks 泵送至客户端，客户端根据 type 字段分派到对应处理器

```mermaid
flowchart TD
A["事件源产生事件"] --> B["封装为 RpcRequest<MuxFrame>"]
B --> C["WebSocketDownlinks 写入 Socket"]
C --> D["客户端解析并分发"]
D --> E["UI/业务逻辑更新"]
```

**图示来源**
- [packages/client/connection/src/websocket-downlink.ts:118-137](file://packages/client/connection/src/websocket-downlink.ts#L118-L137)
- [packages/client/connection/src/client/web-api-client.ts:51-63](file://packages/client/connection/src/client/web-api-client.ts#L51-L63)

**章节来源**
- [packages/client/connection/src/websocket-downlink.ts:118-137](file://packages/client/connection/src/websocket-downlink.ts#L118-L137)
- [packages/client/connection/src/client/web-api-client.ts:51-63](file://packages/client/connection/src/client/web-api-client.ts#L51-L63)

### 连接管理与重连策略
- 连接生命周期：
  - 客户端在 onOpen 回调后可开始消费事件
  - 收到 close 或 abort 信号时清理资源
  - 收到 stream/error 视为流失败，应触发重连
- 重连建议：
  - 指数退避重试，避免雪崩
  - 限制最大重试次数与最长间隔
  - 重连前可先尝试恢复会话上下文（如最近一次已知的会话 ID）
- 服务端行为：
  - 事件源异常时发送 stream/error 后关闭连接，确保客户端能感知并恢复

```mermaid
flowchart TD
Start(["连接建立"]) --> Consume["消费事件"]
Consume --> Err{"收到 stream/error ?"}
Err --> |是| Reconnect["指数退避重连"]
Err --> |否| KeepAlive["保持连接"]
Reconnect --> TryAgain{"达到最大重试?"}
TryAgain --> |否| Connect["重新建立连接"]
TryAgain --> |是| Fail["上报错误并停止"]
KeepAlive --> End(["结束"])
Fail --> End
```

**图示来源**
- [packages/client/runtime/src/client/sessions/manager.ts:685-690](file://packages/client/runtime/src/client/sessions/manager.ts#L685-L690)
- [packages/client/runtime/src/client/sessions/session.ts:510-520](file://packages/client/runtime/src/client/sessions/session.ts#L510-L520)
- [packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)

**章节来源**
- [packages/client/runtime/src/client/sessions/manager.ts:685-690](file://packages/client/runtime/src/client/sessions/manager.ts#L685-L690)
- [packages/client/runtime/src/client/sessions/session.ts:510-520](file://packages/client/runtime/src/client/sessions/session.ts#L510-L520)
- [packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)

## 依赖关系分析
- 客户端依赖：
  - web-api-client.ts：封装 WebSocket 读取与帧解析
  - api-path.ts：共享 /api 前缀与事件路径常量
- 服务端依赖：
  - index.ts：挂载 /api 路由与 WebSocket 升级
  - websocket-downlink.ts：实现 downlink-only 的 WebSocket 泵送
  - events.schema.ts：定义事件帧与错误帧结构
  - rpc.schema.ts：定义 RPC 信封结构

```mermaid
graph LR
Client["web-api-client.ts"] --> Paths["api-path.ts"]
Index["index.ts"] --> Downlink["websocket-downlink.ts"]
Downlink --> Schema["events.schema.ts"]
Client --> RpcSchema["rpc.schema.ts"]
Index --> FetchHandler["fetch/handler.ts"]
```

**图示来源**
- [packages/client/connection/src/client/web-api-client.ts:1-92](file://packages/client/connection/src/client/web-api-client.ts#L1-L92)
- [packages/client/connection/src/api-path.ts:7-14](file://packages/client/connection/src/api-path.ts#L7-L14)
- [packages/client/connection/src/index.ts:130-195](file://packages/client/connection/src/index.ts#L130-L195)
- [packages/client/connection/src/websocket-downlink.ts:1-154](file://packages/client/connection/src/websocket-downlink.ts#L1-L154)
- [packages/host/apiproxy/src/api/events.schema.ts:66-92](file://packages/host/apiproxy/src/api/events.schema.ts#L66-L92)
- [packages/host/apiproxy/src/api/rpc.schema.ts](file://packages/host/apiproxy/src/api/rpc.schema.ts)
- [packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)

**章节来源**
- [packages/client/connection/src/index.ts:130-195](file://packages/client/connection/src/index.ts#L130-L195)
- [packages/client/connection/src/websocket-downlink.ts:1-154](file://packages/client/connection/src/websocket-downlink.ts#L1-L154)
- [packages/client/connection/src/client/web-api-client.ts:1-92](file://packages/client/connection/src/client/web-api-client.ts#L1-L92)
- [packages/host/apiproxy/src/api/events.schema.ts:66-92](file://packages/host/apiproxy/src/api/events.schema.ts#L66-L92)
- [packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)

## 性能与连接�
- 连接模型
  - 每条事件流一个 WebSocket 连接（downlink-only），无上行流量，降低握手与拥塞控制开销
  - Mux 与 Host 分离，避免热点事件阻塞其他事件
- 背压与缓冲
  - 客户端使用 inbox 队列与 wake 唤醒机制，避免阻塞事件循环
  - 服务端 pump 过程中遇到写失败会发送 stream/error 并关闭，防止无限堆积
- 连接复用与池化建议
  - 同一页面内尽量复用现有连接，避免频繁创建销毁
  - 多标签页场景可按会话维度复用连接，减少全局限流压力
  - 对高吞吐场景可考虑连接池（按租户/会话分组），配合心跳保活
- 网络与序列化
  - 使用 JSON 传输，注意大对象（如图片 base64）的上行走 HTTP，下行事件尽量精简
  - 合理设置 maxRequestBodyBytes，避免过大请求被拒绝

[本节提供通用指导，不直接分析具体文件]

## 故障排查指南
- 常见问题
  - 426 Upgrade Required：客户端以 HTTP GET 访问事件路径，需改为 WebSocket 升级
  - 403 Forbidden：请求来源不在可信列表，或升级请求未通过信任检查
  - 1008 downlink only：客户端向 downlink 发送了消息，违反协议
  - stream/error：事件源异常，客户端应捕获并重连
- 定位步骤
  - 检查 /api 路由是否注册成功，以及 trustedHosts 配置是否正确
  - 确认浏览器端 openMux/openHost 使用的路径与协议正确
  - 观察服务端日志，确认事件源是否抛出异常并发送 stream/error
  - 验证客户端是否正确解析并忽略未知帧类型

**章节来源**
- [packages/client/connection/src/index.ts:150-194](file://packages/client/connection/src/index.ts#L150-L194)
- [packages/client/connection/src/websocket-downlink.ts:105-115](file://packages/client/connection/src/websocket-downlink.ts#L105-L115)
- [packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)

## 结论
本项目的 WebSocket API 采用“HTTP 上行 + 双通道下行”的设计：
- 上行 RPC 通过 /api 的 fetch 接口完成，具备完善的鉴权与限流
- 下行事件通过 /api/events.mux 与 /api/events.host 两个 downlink-only 的 WebSocket 通道推送
- 所有事件帧使用统一的 RPC 信封与 schema 校验，错误通过 stream/error 标准化传播
- 客户端需实现健壮的重连与错误处理，服务端在事件源异常时主动关闭连接

该设计在保证安全性的同时，提供了高吞吐、低延迟的实时通信能力，适用于会话事件、智能体状态与工具执行进度的实时推送。

[本节总结性内容，不直接分析具体文件]

## 附录：客户端实现要点
- 建立连接
  - 使用 openMux/openHost 分别连接 /api/events.mux 与 /api/events.host
  - 在 onOpen 回调中开始消费事件
- 解析与分发
  - 使用 serverRequestSchema 解析信封，再用 muxFrameSchema/hostFrameSchema 解析 payload
  - 根据 payload.type 分发给对应处理器
- 错误与重连
  - 捕获 stream/error 帧，记录错误信息并触发重连
  - 实现指数退避与最大重试次数
- 资源清理
  - 在 close/abort 事件中移除监听器并关闭连接
- 示例参考（路径）
  - 浏览器端 WebSocket 读取与解析：[packages/client/connection/src/client/web-api-client.ts:34-90](file://packages/client/connection/src/client/web-api-client.ts#L34-L90)
  - 事件流泵送与错误处理：[packages/client/connection/src/websocket-downlink.ts:118-137](file://packages/client/connection/src/websocket-downlink.ts#L118-L137)
  - 事件源异常时的错误帧生成：[packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)

**章节来源**
- [packages/client/connection/src/client/web-api-client.ts:34-90](file://packages/client/connection/src/client/web-api-client.ts#L34-L90)
- [packages/client/connection/src/websocket-downlink.ts:118-137](file://packages/client/connection/src/websocket-downlink.ts#L118-L137)
- [packages/host/apiproxy/src/fetch/handler.ts:201-219](file://packages/host/apiproxy/src/fetch/handler.ts#L201-L219)