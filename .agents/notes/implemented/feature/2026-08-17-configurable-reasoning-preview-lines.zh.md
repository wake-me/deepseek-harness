# Agent Note: Think 折叠预览行数可配置

Status: implemented

[English](2026-08-17-configurable-reasoning-preview-lines.md) | 中文

## Problem

折叠态的 Think 行只显示一行推理：`ReasoningRow` 从块中提取 `firstLine`/`latestLine`，CSS 强制 `white-space: nowrap`，再由水平的 `scrollLeft` 跟随器追赶流式尾部（[跟随器为何追踪真实 delta](2026-08-02-web-thinking-tail-scroll.md)）。单行输出让长推理在折叠状态下无法阅读，而且没有任何设置能加宽它。`DisclosureRow` 原语的头部行是固定 24px 的条带，多行预览放不进头部。

## Decision

**行数是持久化的 `ui-conversation` 偏好，默认即单行形态。** `conversation-settings.ts`（由已名不副实的 `submission-settings.ts` 更名而来）新增 `reasoningPreviewLines`：整数 1–8，默认 1，由拥有 `busyEnter` 的同一 Host schema 校验。`ReasoningPreviewPolicy` 把该分节镜像进 `SnapshotStore`，方式与 `ComposerSubmissionPolicy` 完全一致；apply 把策略的 store 传入 `assistant-step` 节点注册的 `inject` `hooks` 分仓，`AssistantNodeView` 以 `useReasoningPreviewLines` 读取，并把行数作为普通 prop 经 `AssistantMarkdown` 下传。暂不提供 Settings 行——行数在 `settings.yaml` 中编辑，与该部署管理此命名空间的既有方式一致。

**取值 1（以及字段缺省时的默认）原样渲染原有行内形态。** 摘要留在 `DisclosureRow` 头部内、与标题同行——结算后取 `firstLine`，流式时取最新的非空行——由单行滚动区横向追赶。头部几何与跟随器与引入该设置前完全一致，因此未配置的部署保持上游外观。

**取值 2–8 仅在该块流式输出期间挂载预览窗口；结算后始终回到行内形态。** 窗口形态同时由 `running` 与行数门控：当推理块是流式尾部时，`ReasoningRow` 先渲染 `DisclosureRow` 头部（图标、标题、箭头，点击/键盘切换不变），其后渲染一个仅折叠且文本非空时存在的预览 `<div>`，承载完整流式文本，受 `max-height: calc(var(--reasoning-preview-lines) * 24px)` 与 `overflow: hidden` 约束，帧节流跟随器把 `scrollTop` 设到尾部（与水平版相同的 overflow-hidden 编程式滚动，转为垂直方向）。点击窗口与点击头部一样触发切换，保留旧的"从摘要展开"交互。结算后窗口卸载，该行渲染为所有已完成行通用的行内首行摘要——多行形态只在"观察模型思考"有价值时存在，长 transcript 无论配置如何都保持单行 Think 行。该判断是现有 props 的纯函数（`running` 来自持久化轮次状态，`previewLines` 来自设置镜像）；未新增组件状态、监听器或 effect，memo 隔离的历史行不因此重渲染。

## Alternatives considered

**任何行数都把摘要留在 `DisclosureRow` 头部内。** 放弃：头部行固定 24px 高是原语与所有其他流程行的约定；按状态撑高它会同时改变 Tool 行和上下文行的形状。把标题与多行预览放进同一行还会让预览宽度缩到标题剩余部分，滚动窗口的折行也与下方各行不一致。

**把多行窗口设为默认。** 放弃：它让每个用户未选择就改变折叠几何，也最大化本 fork 与上游的分叉；更宽的窗口应是用户写下该字段才获得的偏好。

**结算后将窗口裁剪到开头若干行而非回到行内形态。** 放弃：多行形态只在输出移动时划算；结算后它在每条历史行中占据纵向空间却无观察需求，而行内首行摘要已足够服务回看。裁剪 CSS 随此拒绝一并消亡——窗口仅在流式期间存在。

**只裁剪开头、去掉流式尾随。** 放弃：尾随正是模型工作时吞吐可读的关键，它是窗口形态存在的唯一理由。

**为行数引入逐会话 store 或组件局部状态。** 放弃：该偏好跨会话且持久，settings scope 加 inject 绑定的可观察量（既有的 `busyEnter` 模式）才是拥有它的通道；其他做法都会制造第二事实源。

**现在就发布 Settings UI 行。** 推迟：编辑 `settings.yaml` 的部署已经配置此命名空间；选择器行只会增加文案、locale 和表面积，而没有提出需求的消费方。

## Consequences

未配置的部署渲染原有的单行 Think 行，且无论配置如何，所有已完成的行都渲染同一行内形态——只有流式尾部可能挂载多行窗口，其几何来自一个 CSS 变量，因此将来的 Settings 行只需写入持久化字段。流式尾随在两种形态下都保留——行内为水平 `scrollLeft` 钉住，窗口为垂直 `scrollTop` 钉住——保持"追踪真实 delta"的节奏信号。窗口位于 `DisclosureRow` 头部之外且仅在流式期间存在，其他展开行（Tool、上下文）与所有已完成的行不受影响；结算转换只是流式行自身的一次渲染（窗口卸载、行内 span 挂载），对 memo 隔离的兄弟行零影响。已完成的行在行内摘要所在的父块保留完整文本，展开即显示完整推理。`submission-settings.ts` 模块更名为 `conversation-settings.ts`；导入在同一次变更中改写，无兼容层（pre-release 姿态）。

## Testing

`packages/client/ui-conversation/tests/reasoning-row.client.spec.tsx` 钉住两种形态：默认行内摘要且无预览元素、行内水平尾随（节流帧后 `scrollLeft = scrollWidth - clientWidth`）与结算重置、从头部和行内摘要两处展开、窗口垂直尾随（`scrollTop = scrollHeight - clientHeight`）及结算后窗口卸载回到行内首行、流式期间折叠后窗口恢复、配置行数到达 CSS 变量、以及空文本守卫。`tests/reasoning-preview-policy.client.spec.ts` 覆盖 scope 采纳、变更跟随、分节缺席保留与不回写；`tests/host.client.spec.ts` 把持久化分节契约扩展到新字段，含 0、9 与小数拒绝。
