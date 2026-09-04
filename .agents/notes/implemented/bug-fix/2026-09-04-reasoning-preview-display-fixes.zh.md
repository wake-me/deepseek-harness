# Agent Note: 思考预览窗口高度与折叠摘要修复

Status: implemented

[English](2026-09-04-reasoning-preview-display-fixes.md) | 中文

## 问题

可配置预览窗口移植到 ui-chat 时（ea929237a2）带入了两个显示缺陷。其一，流式窗口无论配置几行都只显示一行——症状与配置值无关，因为 root 高度 calc 对每个值都回落到字面量 `1`。其二，reasoning 以前导换行开头时折叠内联摘要渲染为空白；omlx 服务的 Qwen3.8 每个 reasoning 块都以 `\n` 开头，该模型的所有 settled Think 行都丢失摘要。

## 决策

窗口行数现在只声明一次，声明在行根元素上：`--reasoning-preview-lines` 挂在 root 的内联 style 上，门控条件与 `data-preview` 相同的 `windowed`。两个消费方都在 root 上解析——root 的 `[data-preview]:not([data-expanded])` 高度 calc 读取自身内联声明，窗口的 `max-height` 通过继承读取。移植缺陷在于把属性声明在窗口元素自身：自定义属性只向下继承，为窗口行预留高度的 root calc 永远看不到设在窗口上的值，被 contain 锁定的 root 把窗口裁成一行。回归测试固定声明位置——root 必须携带变量、窗口不得携带——因为 JSDOM 不执行 CSS calc 与继承，观察不到高度链路本身。

`firstLine` 现在先对文本 `trimStart` 再切首行，settled 摘要显示首个非空行。这偏离了上游 `firstLine`（在首个换行处切片，前导换行返回空串）；未来同步保留该 `trimStart`，除非上游自行跳过前导空白。`latestLine` 不动：尾随空白已由其 `trimEnd` 覆盖，前导换行经其 `lastIndexOf` 切片天然跳过。

## 考虑过的替代方案

**用 JS 计算窗口几何。** 否决：移植的设计是零 JS 尾随——flex column 加 `justify-content: flex-end` 从顶部裁剪、保持最新行可见；唯一缺陷是计数变量的声明位置。

**把变量声明在窗口上，并在 root 的 style 属性里重复计数。** 否决：root 上一次声明即可服务两个消费方；重复取值会让高度预留与窗口上限漂移。

**在渲染边界或流投影层规范化前导空白。** rc.8 时代搁置时已否决，仍然否决：两者都为纯展示问题改变存储 reasoning 文本的含义，而该问题归 `firstLine` 所有。

## 后果

配置 2–8 行现在流式时显示对应行数，前导换行模型的 settled 行显示首个非空行。配置一行的行与未配置部署渲染完全等同上游形态。CSS 变量位置由单测断言防护；实际高度链路需要浏览器验证，因为 JSDOM 不执行布局。
